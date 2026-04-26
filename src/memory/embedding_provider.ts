/**
 * Embedding Provider - 三级降级策略
 * 
 * Level 1: DashScope bge-m3 API (真正的语义向量)
 * Level 2: TF-IDF 本地计算 (无需 API)
 * Level 3: 简单关键词匹配 (兜底)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDataDir, PluginContext } from '../utils/plugin-context';

// ========== Level 1: API Embedding ==========

const DASHSCOPE_EMBEDDING_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const DASHSCOPE_EMBEDDING_MODEL = 'text-embedding-v3';
const DASHSCOPE_OPENAI_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
const DASHSCOPE_OPENAI_MODEL = 'text-embedding-v3';

let dashscopeApiKey: string | null = null;
let dashscopeApiAvailable = false;

// 请求去重：相同文本的并发请求共享同一个 Promise
type PendingRequest = Promise<number[] | null>;
const pendingRequests = new Map<string, PendingRequest>();

/**
 * 从 OpenClaw 配置加载 DashScope API Key
 */
function loadDashScopeKey(): string | null {
  if (dashscopeApiKey !== null) return dashscopeApiKey;

  const homeDir = process.env.HOME || '/tmp';
  const configPath = path.join(homeDir, '.openclaw', 'openclaw.json');

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const providers = config.models?.providers || {};
      const bailian = providers.bailian || providers.dashscope;
      if (bailian?.apiKey) {
        dashscopeApiKey = bailian.apiKey;
      }
    }
  } catch {
    // ignore
  }

  if (!dashscopeApiKey) {
    dashscopeApiKey = process.env.DASHSCOPE_API_KEY || null;
  }

  return dashscopeApiKey;
}

/**
 * 尝试 DashScope OpenAI 兼容模式（支持批量）
 */
async function tryOpenAICompatible(texts: string[]): Promise<(number[] | null)[]> {
  const key = loadDashScopeKey();
  if (!key) return texts.map(() => null);

  try {
    const resp = await fetch(DASHSCOPE_OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: DASHSCOPE_OPENAI_MODEL,
        input: texts,
        dimensions: 1024,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return texts.map(() => null);

    const data: any = await resp.json();
    if (data.data) {
      dashscopeApiAvailable = true;
      // 按原始顺序返回，缺失的补 null
      const results: (number[] | null)[] = new Array(texts.length).fill(null);
      for (const item of data.data) {
        if (item.index !== undefined && item.embedding) {
          results[item.index] = item.embedding;
        }
      }
      return results;
    }
  } catch {
    // fall through
  }
  return texts.map(() => null);
}

/**
 * 尝试 DashScope 原生 API（支持批量）
 */
async function tryDashScopeNative(texts: string[]): Promise<(number[] | null)[]> {
  const key = loadDashScopeKey();
  if (!key) return texts.map(() => null);

  try {
    const resp = await fetch(DASHSCOPE_EMBEDDING_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'X-DashScope-DataInspection': 'enable',
      },
      body: JSON.stringify({
        model: DASHSCOPE_EMBEDDING_MODEL,
        input: { texts },
        parameters: { text_type: 'query' },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return texts.map(() => null);

    const data: any = await resp.json();
    if (data.output?.embeddings) {
      dashscopeApiAvailable = true;
      const results: (number[] | null)[] = new Array(texts.length).fill(null);
      for (const emb of data.output.embeddings) {
        if (emb.text_index !== undefined && emb.embedding) {
          results[emb.text_index] = emb.embedding;
        } else if (emb.embedding) {
          // 没有 index 时按顺序填充（兼容旧版响应格式）
          const emptyIdx = results.findIndex(r => r === null);
          if (emptyIdx >= 0) results[emptyIdx] = emb.embedding;
        }
      }
      return results;
    }
  } catch {
    // fall through
  }
  return texts.map(() => null);
}

/**
 * Level 1: 调用 DashScope embedding API（单条，兼容旧接口）
 */
export async function getApiEmbedding(text: string): Promise<number[] | null> {
  const results = await getApiEmbeddingBatch([text]);
  return results[0];
}

/**
 * Level 1: 批量调用 DashScope embedding API（最多 25 条）
 * 自动去重相同文本的请求，合并为一次 API 调用。
 */
export async function getApiEmbeddingBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  if (texts.length > 25) {
    // 超过限制时分批处理
    const results: (number[] | null)[] = [];
    for (let i = 0; i < texts.length; i += 25) {
      const batch = texts.slice(i, i + 25);
      results.push(...await getApiEmbeddingBatch(batch));
    }
    return results;
  }

  // 请求去重：相同文本共享 Promise
  const uniqueTexts = [...new Set(texts)];
  const uniquePromises: PendingRequest[] = [];
  const textToPromise = new Map<string, PendingRequest>();

  for (const text of uniqueTexts) {
    const existing = pendingRequests.get(text);
    if (existing) {
      textToPromise.set(text, existing);
    } else {
      // 创建新请求：优先 OpenAI 兼容模式，降级到原生
      const promise = (async () => {
        let result = await tryOpenAICompatible([text]);
        if (result[0]) return result[0];
        result = await tryDashScopeNative([text]);
        return result[0];
      })();

      // 清理机制：请求完成后从 pending 中移除
      promise.finally(() => pendingRequests.delete(text));
      pendingRequests.set(text, promise);
      textToPromise.set(text, promise);
    }
  }

  // 等待所有唯一请求完成，然后映射回原始顺序
  const uniqueResults = await Promise.all(uniqueTexts.map(t => textToPromise.get(t)!));
  const resultMap = new Map<string, number[] | null>();
  uniqueTexts.forEach((text, i) => resultMap.set(text, uniqueResults[i]));

  return texts.map(text => resultMap.get(text) || null);
}

// ========== Level 2: TF-IDF Local Embedding ==========

interface TfIdfVocabulary {
  [term: string]: number; // IDF value
}

interface TfIdfDocument {
  id: string;
  terms: Map<string, number>; // term → TF
  vector: number[];
}

class TfIdfEngine {
  private vocabulary: string[] = [];
  private idf: number[] = [];
  private documents: TfIdfDocument[] = [];
  private docCount: number = 0;

  /**
   * 中文分词（简易版：按字/词边界切分）
   */
  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '与', '或', '但', '如果',
      '那么', '因为', '所以', '虽然', '但是', '这个', '那个', '什么', '怎么',
      '可以', '需要', '应该', '可能', '一个', '一些', '我们', '他们',
      '的', '吗', '呢', '吧', '啊', '哦', '嗯', '哈', '呀', '嘛',
      '不', '没', '很', '更', '最', '太', '非常', '都', '也', '又',
      '还', '就', '才', '会', '能', '要', '想', '看', '到', '去',
      '来', '上', '下', '中', '对', '从', '被', '把', '给', '向',
      '为', '以', '而', '且', '或', '与', '及', '等', '如', '若',
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
      'and', 'or', 'but', 'if', 'as', 'it', 'this', 'that', 'not',
      'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    ]);

    // 提取中文字符序列（>=2 字）
    const chineseMatches = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const m of chineseMatches) {
      // 进一步拆分为 bi-gram
      for (let i = 0; i < m.length - 1; i++) {
        const bigram = m.substring(i, i + 2);
        if (!stopWords.has(bigram)) tokens.push(bigram);
      }
      // 单字如果长度>=3也保留
      if (m.length >= 3) {
        for (const c of m) {
          if (!stopWords.has(c)) tokens.push(c);
        }
      }
    }

    // 提取英文单词
    const englishMatches = text.match(/[a-zA-Z]{3,}/g) || [];
    for (const m of englishMatches) {
      if (!stopWords.has(m.toLowerCase())) tokens.push(m.toLowerCase());
    }

    // 提取数字序列
    const numberMatches = text.match(/\d{2,}/g) || [];
    tokens.push(...numberMatches);

    return tokens;
  }

  /**
   * 训练 IDF
   */
  train(documents: Array<{ id: string; content: string }>): void {
    const termDocFreq = new Map<string, number>();
    this.documents = [];
    this.docCount = documents.length;

    for (const doc of documents) {
      const tokens = this.tokenize(doc.content);
      const termFreq = new Map<string, number>();
      const seenTerms = new Set<string>();

      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) || 0) + 1);
        if (!seenTerms.has(token)) {
          seenTerms.add(token);
          termDocFreq.set(token, (termDocFreq.get(token) || 0) + 1);
        }
      }

      this.documents.push({ id: doc.id, terms: termFreq, vector: [] });
    }

    // 构建词汇表
    this.vocabulary = [...termDocFreq.keys()].sort();

    // 计算 IDF: log(N / df)
    this.idf = this.vocabulary.map(term => {
      const df = termDocFreq.get(term) || 0;
      return Math.log((this.docCount + 1) / (df + 1)) + 1;
    });
  }

  /**
   * 将文本转为 TF-IDF 向量
   */
  encode(text: string): number[] {
    if (this.vocabulary.length === 0) {
      // 未训练，返回简单的字符频率向量 (256 维)
      return this.simpleCharFreq(text);
    }

    const tokens = this.tokenize(text);
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    const vector = this.vocabulary.map((term, i) => {
      const tf = termFreq.get(term) || 0;
      // TF-IDF with L2 normalization hint
      return tf > 0 ? tf * this.idf[i] : 0;
    });

    // L2 normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /**
   * 简单字符频率向量（无训练时的兜底）
   */
  private simpleCharFreq(text: string): number[] {
    const vector = new Array(256).fill(0);
    for (const char of text) {
      const code = char.charCodeAt(0) % 256;
      vector[code]++;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }
    return vector;
  }

  /**
   * 持久化训练数据
   */
  save(ctx: PluginContext): void {
    try {
      const dataDir = getDataDir(ctx);
      const tfidfDir = path.join(dataDir, 'tfidf');
      if (!fs.existsSync(tfidfDir)) fs.mkdirSync(tfidfDir, { recursive: true });

      const vocabPath = path.join(tfidfDir, 'vocabulary.json');
      const data = {
        vocabulary: this.vocabulary,
        idf: this.idf,
        docCount: this.docCount,
      };
      fs.writeFileSync(vocabPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[TfIdfEngine] Save error:', err);
    }
  }

  /**
   * 加载训练数据
   */
  load(ctx: PluginContext): boolean {
    try {
      const dataDir = getDataDir(ctx);
      const vocabPath = path.join(dataDir, 'tfidf', 'vocabulary.json');
      if (!fs.existsSync(vocabPath)) return false;

      const data = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
      this.vocabulary = data.vocabulary || [];
      this.idf = data.idf || [];
      this.docCount = data.docCount || 0;
      return this.vocabulary.length > 0;
    } catch {
      return false;
    }
  }
}

// ========== Level 3: Keyword Search ==========

function keywordScore(query: string, content: string): number {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  const contentLower = content.toLowerCase();

  let score = 0;
  for (const word of queryWords) {
    if (contentLower.includes(word)) {
      score++;
    }
  }
  return queryWords.length > 0 ? score / queryWords.length : 0;
}

// ========== Unified Provider ==========

const tfidfEngine = new TfIdfEngine();
let tfidfTrained = false;
let tfidfInitFailed = false;

/**
 * 初始化 TF-IDF（加载已有训练数据）
 */
export function initTfIdf(ctx: PluginContext): void {
  if (tfidfInitFailed) return;
  try {
    if (tfidfEngine.load(ctx)) {
      tfidfTrained = true;
      console.log(`[EmbeddingProvider] TF-IDF loaded (${tfidfEngine['vocabulary'].length} terms)`);
    }
  } catch {
    tfidfInitFailed = true;
  }
}

/**
 * 用已有文档训练 TF-IDF
 */
export function trainTfIdf(ctx: PluginContext, documents: Array<{ id: string; content: string }>): void {
  if (documents.length === 0) return;
  tfidfEngine.train(documents);
  tfidfTrained = true;
  tfidfEngine.save(ctx);
  console.log(`[EmbeddingProvider] TF-IDF trained on ${documents.length} documents, ${tfidfEngine['vocabulary'].length} terms`);
}

/**
 * 生成 embedding（三级降级）
 */
export async function getEmbedding(text: string): Promise<number[]> {
  // Level 1: API embedding
  if (dashscopeApiAvailable || dashscopeApiKey === null) {
    const apiResult = await getApiEmbedding(text);
    if (apiResult) return apiResult;
  }

  // Level 2: TF-IDF
  if (tfidfTrained) {
    return tfidfEngine.encode(text);
  }

  // Level 3: Simple char frequency
  return tfidfEngine.encode(text);
}

/**
 * 批量生成 embeddings（自动分桶：API 支持的批量走 API，其余走本地）
 */
export async function getEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];

  // 全部尝试 API 批量调用（内部自动处理分批和去重）
  if (dashscopeApiAvailable || dashscopeApiKey === null) {
    const apiResults = await getApiEmbeddingBatch(texts);

    // 检查是否有 API 返回了结果
    const apiSuccessCount = apiResults.filter(r => r !== null).length;
    if (apiSuccessCount > 0) {
      // 部分成功：对失败的文本尝试本地降级
      const results = [...apiResults];
      for (let i = 0; i < texts.length; i++) {
        if (!results[i]) {
          results[i] = tfidfTrained ? tfidfEngine.encode(texts[i]) : tfidfEngine['simpleCharFreq'](texts[i]);
        }
      }
      return results;
    }
  }

  // API 不可用，全部走本地
  return texts.map(text =>
    tfidfTrained ? tfidfEngine.encode(text) : tfidfEngine['simpleCharFreq'](text)
  );
}

/**
 * 获取当前降级级别
 */
export function getEmbeddingLevel(): string {
  if (dashscopeApiAvailable) return 'api (DashScope bge-m3)';
  if (tfidfTrained) return 'tf-idf (local)';
  return 'keyword (fallback)';
}

export { keywordScore };
