/**
 * Embedding Provider - 统一 API Embedding
 *
 * 策略：
 *   - 优先使用 OpenClaw memorySearch 配置（Ollama bge-m3）
 *   - 降级到 DashScope API
 *   - 都不可用时返回 null → 调用方走 FTS 全文搜索
 *
 * 不再提供 TF-IDF / 关键词兜底，统一由 FTS 作为降级方案。
 */

import * as fs from 'fs';
import * as path from 'path';

// ========== 配置 ==========

interface MemorySearchConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

let memorySearchConfig: MemorySearchConfig | null | undefined = undefined;
let memorySearchAvailable = false;

// DashScope 配置
const DASHSCOPE_EMBEDDING_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const DASHSCOPE_EMBEDDING_MODEL = 'text-embedding-v3';
const DASHSCOPE_OPENAI_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
const DASHSCOPE_OPENAI_MODEL = 'text-embedding-v3';

let dashscopeApiKey: string | null = null;
let dashscopeApiAvailable = false;

// 请求去重
type PendingRequest = Promise<number[] | null>;
const pendingRequests = new Map<string, PendingRequest>();

// ========== 配置加载 ==========

/**
 * 从 OpenClaw 配置读取 memorySearch 设置
 */
function loadMemorySearchConfig(): MemorySearchConfig | null {
  if (memorySearchConfig !== undefined && memorySearchConfig !== null) return memorySearchConfig;
  if (memorySearchConfig === null && memorySearchConfig !== undefined) return null;

  const homeDir = process.env.HOME || '/tmp';
  const configPath = path.join(homeDir, '.openclaw', 'openclaw.json');

  try {
    if (!fs.existsSync(configPath)) {
      memorySearchConfig = null;
      return null;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    const ms = config.agents?.defaults?.memorySearch;
    if (!ms) {
      memorySearchConfig = null;
      return null;
    }

    memorySearchConfig = {
      enabled: true,
      provider: ms.provider || 'openai',
      baseUrl: ms.remote?.baseUrl || 'http://localhost:11434/v1',
      model: ms.model || 'bge-m3',
      apiKey: ms.remote?.apiKey || '',
    };

    console.log(`[EmbeddingProvider] OpenClaw memorySearch: provider=${memorySearchConfig.provider}, model=${memorySearchConfig.model}, baseUrl=${memorySearchConfig.baseUrl}`);
    return memorySearchConfig;
  } catch (err) {
    console.error('[EmbeddingProvider] Failed to load memorySearch config:', err);
    memorySearchConfig = null;
    return null;
  }
}

/**
 * 从 OpenClaw 配置加载 DashScope API Key
 */
function loadDashScopeKey(): string | null {
  if (dashscopeApiKey !== null && dashscopeApiKey !== undefined) return dashscopeApiKey;

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

// ========== API 调用 ==========

/**
 * 尝试 OpenClaw memorySearch 配置的 embedding（Ollama bge-m3）
 */
async function tryOllamaEmbedding(texts: string[]): Promise<(number[] | null)[]> {
  const msConfig = loadMemorySearchConfig();
  if (!msConfig) return texts.map(() => null);

  try {
    const embeddingUrl = `${msConfig.baseUrl.replace(/\/$/, '')}/embeddings`;
    const resp = await fetch(embeddingUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(msConfig.apiKey ? { 'Authorization': `Bearer ${msConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: msConfig.model,
        input: texts,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      console.warn(`[EmbeddingProvider] Ollama embedding failed: ${resp.status}`);
      return texts.map(() => null);
    }

    const data: any = await resp.json();
    if (data.data) {
      memorySearchAvailable = true;
      const results: (number[] | null)[] = new Array(texts.length).fill(null);
      for (const item of data.data) {
        if (item.index !== undefined && item.embedding) {
          results[item.index] = item.embedding;
        }
      }
      // 静默成功 - 避免每条日志都输出
      return results;
    }
  } catch (err: any) {
    console.warn(`[EmbeddingProvider] Ollama embedding error: ${err.message}`);
  }
  return texts.map(() => null);
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

// ========== 公开接口 ==========

/**
 * 单条 embedding（兼容旧接口）
 */
export async function getApiEmbedding(text: string): Promise<number[] | null> {
  const results = await getApiEmbeddingBatch([text]);
  return results[0];
}

/**
 * 批量 embedding（最多 25 条）
 * 自动去重相同文本的请求，合并为一次 API 调用。
 */
export async function getApiEmbeddingBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  if (texts.length > 25) {
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
      const promise = (async () => {
        // 优先 OpenClaw memorySearch (Ollama)
        let result = await tryOllamaEmbedding([text]);
        if (result[0]) return result[0];
        // 降级 DashScope OpenAI 兼容
        result = await tryOpenAICompatible([text]);
        if (result[0]) return result[0];
        // 再降级 DashScope 原生
        result = await tryDashScopeNative([text]);
        return result[0];
      })();

      promise.finally(() => pendingRequests.delete(text));
      pendingRequests.set(text, promise);
      textToPromise.set(text, promise);
    }
  }

  const uniqueResults = await Promise.all(uniqueTexts.map(t => textToPromise.get(t)!));
  const resultMap = new Map<string, number[] | null>();
  uniqueTexts.forEach((text, i) => resultMap.set(text, uniqueResults[i]));

  return texts.map(text => resultMap.get(text) || null);
}

/**
 * 生成 embedding
 * 返回 null 表示 embedding 不可用，调用方应走 FTS 降级
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  return getApiEmbedding(text);
}

/**
 * 批量生成 embeddings
 * 返回数组中可能包含 null，表示对应文本无法获取 embedding
 */
export async function getEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  return getApiEmbeddingBatch(texts);
}

/**
 * 获取当前 embedding 状态
 */
export function getEmbeddingLevel(): string {
  if (memorySearchAvailable) return 'api (OpenClaw memorySearch / Ollama bge-m3)';
  if (dashscopeApiAvailable) return 'api (DashScope)';
  return 'unavailable (will fallback to FTS)';
}

/**
 * 检查 embedding 是否可用
 */
export function isEmbeddingAvailable(): boolean {
  return memorySearchAvailable || dashscopeApiAvailable;
}

/**
 * 简单关键词匹配评分（替代 keywordScore）
 * 用于 embedding 不可用时的降级搜索
 */
export function simpleKeywordMatch(query: string, content: string): number {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  const contentLower = content.toLowerCase();

  if (queryWords.length === 0) return 0;

  let matched = 0;
  for (const word of queryWords) {
    if (contentLower.includes(word)) {
      matched++;
    }
  }
  return matched / queryWords.length;
}
