/**
 * 索引构建器
 *
 * 整合 FTS 全文搜索 + 向量语义搜索
 * 支持全量重建和增量更新
 */

import * as fs from 'fs';
import * as path from 'path';
import { PluginContext, getDataDir, getMemoryStorageDir } from '../utils/plugin-context';
import { FtsIndex, FtsDocument } from './fts_index';
import { VectorIndexStore, VectorDocument } from './vector_index';
import { getEmbedding, getEmbeddingsBatch, getEmbeddingLevel } from './embedding_provider';
import { SearchableDocument } from './semantic_search';

// ========== 类型 ==========

export interface IndexBuildResult {
  success: boolean;
  mode: 'full' | 'incremental';
  filesScanned: number;
  filesIndexed: number;
  filesUpdated: number;
  filesSkipped: number;
  ftsCount: number;
  vectorCount: number;
  embeddingLevel: string;
  durationMs: number;
  errors: string[];
}

export interface IndexStats {
  fts: { total: number; avgContentLength: number; dbSize: number };
  vector: { total: number; dimensions: Record<number, number>; sources: Record<string, number>; dbSize: number };
  fileState: { total: number; indexed: string[] };
  lastBuild?: string;
}

export interface UnifiedSearchResult {
  id: string;
  content: string;
  score: number;
  source: 'fts' | 'vector' | 'combined';
  snippet?: string;
  metadata?: Record<string, any>;
}

// ========== IndexBuilder ==========

export class IndexBuilder {
  private ctx: PluginContext;
  private ftsIndex: FtsIndex;
  private vectorStore: VectorIndexStore;
  private statePath: string;
  private fileState: Record<string, { mtime: number; indexedAt: string }> = {};

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
    this.ftsIndex = new FtsIndex(ctx);
    this.vectorStore = new VectorIndexStore(ctx);

    const dataDir = getDataDir(ctx);
    this.statePath = path.join(dataDir, 'index_state.json');
    this.loadState();
  }

  /** 初始化 */
  init(): void {
    this.ftsIndex.init();
    this.vectorStore.init();
  }

  /**
   * 全量重建索引
   */
  async rebuild(memoryDirs: string[]): Promise<IndexBuildResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log('[IndexBuilder] Starting full rebuild...');

    // 清空旧索引
    await this.ftsIndex.clear();
    await this.vectorStore.clear();
    this.fileState = {};

    // 扫描并索引
    const result = await this.doIndex(memoryDirs, 'full', errors);
    result.durationMs = Date.now() - startTime;

    if (errors.length > 0) {
      result.success = false;
    }

    this.saveState();
    console.log(`[IndexBuilder] Full rebuild complete: ${result.filesIndexed} indexed, ${result.filesSkipped} skipped, ${errors.length} errors in ${result.durationMs}ms`);
    return result;
  }

  /**
   * 增量更新索引
   */
  async update(memoryDirs: string[]): Promise<IndexBuildResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log('[IndexBuilder] Starting incremental update...');

    const result = await this.doIndex(memoryDirs, 'incremental', errors);
    result.durationMs = Date.now() - startTime;

    if (errors.length > 0) {
      result.success = false;
    }

    this.saveState();
    console.log(`[IndexBuilder] Incremental update complete: ${result.filesIndexed} indexed, ${result.filesUpdated} updated, ${result.filesSkipped} skipped, ${errors.length} errors in ${result.durationMs}ms`);
    return result;
  }

  /**
   * 统一搜索：向量优先，FTS 降级
   *
   * 策略：
   *   1. embedding 可用 → 向量语义搜索 + FTS 补充（融合评分）
   *   2. embedding 不可用 → 纯 FTS 全文搜索（BM25 排序）
   */
  async unifiedSearch(query: string, topK: number = 10, embeddingEnabled: boolean = true): Promise<UnifiedSearchResult[]> {
    const results: Map<string, UnifiedSearchResult> = new Map();
    let searchMode: 'vector+fts' | 'fts-only' = 'fts-only';

    // 1. 尝试向量语义搜索
    if (embeddingEnabled) {
      try {
        const queryEmb = await getEmbedding(query);
        if (queryEmb) {
          searchMode = 'vector+fts';
          const vecResults = await this.vectorStore.search(queryEmb, topK * 2);
          for (const r of vecResults) {
            results.set(r.id, {
              id: r.id,
              content: r.content,
              score: r.score,
              source: 'vector',
              metadata: r.metadata
            });
          }
        }
      } catch (err: any) {
        console.warn(`[IndexBuilder] Vector search failed, falling back to FTS: ${err.message}`);
      }
    }

    // 2. FTS 全文搜索（向量搜索时补充，不可用时作为主搜索）
    const ftsResults = await this.ftsIndex.search(query, topK * 2);
    for (const r of ftsResults) {
      const score = Math.max(0, 1 / (1 + Math.abs(r.rank)));
      const existing = results.get(r.id);
      if (existing) {
        // 融合：向量 0.6 + FTS 0.4
        existing.score = existing.score * 0.6 + score * 0.4;
        existing.source = 'combined';
      } else {
        results.set(r.id, {
          id: r.id,
          content: r.content,
          score,
          source: searchMode === 'vector+fts' ? 'fts' : 'fts',
          snippet: r.snippet,
          metadata: r.metadata
        });
      }
    }

    // 排序并返回 topK
    const sorted = Array.from(results.values()).sort((a, b) => b.score - a.score);
    console.log(`[IndexBuilder] Search "${query}": mode=${searchMode}, results=${sorted.length}`);
    return sorted.slice(0, topK);
  }

  /**
   * 获取索引统计
   */
  async getStats(): Promise<IndexStats> {
    const [fts, vector] = await Promise.all([
      this.ftsIndex.getStats(),
      this.vectorStore.getStats()
    ]);

    const indexedFiles = Object.keys(this.fileState);
    const lastEntry = indexedFiles.length > 0
      ? this.fileState[indexedFiles[indexedFiles.length - 1]]
      : undefined;

    return {
      fts,
      vector,
      fileState: {
        total: indexedFiles.length,
        indexed: indexedFiles.slice(-20) // 最近 20 个
      },
      lastBuild: lastEntry?.indexedAt
    };
  }

  /**
   * 关闭资源
   */
  close(): void {
    this.ftsIndex.close();
    this.vectorStore.close();
  }

  // ========== 私有方法 ==========

  /** 执行索引 */
  private async doIndex(memoryDirs: string[], mode: 'full' | 'incremental', errors: string[]): Promise<IndexBuildResult> {
    const result: IndexBuildResult = {
      success: true,
      mode,
      filesScanned: 0,
      filesIndexed: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      ftsCount: 0,
      vectorCount: 0,
      embeddingLevel: getEmbeddingLevel(),
      durationMs: 0,
      errors
    };

    // 收集所有需要索引的文档
    const docsToIndex: FtsDocument[] = [];
    const vecDocsToIndex: VectorDocument[] = [];

    for (const dir of memoryDirs) {
      if (!fs.existsSync(dir)) continue;

      const files = this.collectMdFiles(dir);
      result.filesScanned += files.length;

      for (const filePath of files) {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        const state = this.fileState[filePath];

        // 增量模式：跳过未变更文件
        if (mode === 'incremental' && state && state.mtime === mtime) {
          result.filesSkipped++;
          continue;
        }

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const docId = `file_${this.hashPath(filePath)}`;

          docsToIndex.push({
            id: docId,
            content,
            metadata: { path: filePath, type: 'file', mtime: stat.mtime.toISOString() }
          });

          // 向量索引：将内容分块（每块 ~500 字符）
          const chunks = this.splitContent(content);
          for (let i = 0; i < chunks.length; i++) {
            vecDocsToIndex.push({
              id: `${docId}_chunk_${i}`,
              content: chunks[i],
              embedding: [], // 稍后批量计算
              metadata: { path: filePath, chunk: i, totalChunks: chunks.length }
            });
          }

          this.fileState[filePath] = {
            mtime,
            indexedAt: new Date().toISOString()
          };

          if (state) {
            result.filesUpdated++;
          } else {
            result.filesIndexed++;
          }
        } catch (err: any) {
          errors.push(`Failed to index ${filePath}: ${err.message}`);
        }
      }
    }

    // 批量索引 FTS
    if (docsToIndex.length > 0) {
      result.ftsCount = await this.ftsIndex.indexBatch(docsToIndex);
    }

    // 批量计算向量 embedding
    if (vecDocsToIndex.length > 0) {
      const texts = vecDocsToIndex.map(d => d.content);
      const embeddings = await getEmbeddingsBatch(texts);

      let vecCount = 0;
      for (let i = 0; i < vecDocsToIndex.length; i++) {
        if (embeddings[i]) {
          vecDocsToIndex[i].embedding = embeddings[i]!;
          await this.vectorStore.upsert(vecDocsToIndex[i]);
          vecCount++;
        }
      }
      result.vectorCount = vecCount;
    }

    return result;
  }

  /** 递归收集 .md 文件 */
  private collectMdFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // 跳过隐藏目录和 archive
          if (entry.name.startsWith('.') || entry.name === 'archive') continue;
          files.push(...this.collectMdFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch { /* ignore */ }
    return files;
  }

  /** 将内容分块 */
  private splitContent(content: string, chunkSize: number = 500): string[] {
    // 按段落分割，合并到 chunkSize
    const paragraphs = content.split(/\n\s*\n/);
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length > chunkSize && current.length > 0) {
        chunks.push(current.trim());
        current = para;
      } else {
        current = current ? current + '\n\n' + para : para;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    // 如果单个段落超过 chunkSize，强制切分
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length > chunkSize * 2) {
        for (let i = 0; i < chunk.length; i += chunkSize) {
          finalChunks.push(chunk.slice(i, i + chunkSize));
        }
      } else {
        finalChunks.push(chunk);
      }
    }

    return finalChunks;
  }

  /** 路径哈希 */
  private hashPath(p: string): string {
    let hash = 0;
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      hash = ((hash << 5) - hash) + c;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /** 加载状态 */
  private loadState(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        this.fileState = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
      }
    } catch { this.fileState = {}; }
  }

  /** 保存状态 */
  private saveState(): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.fileState, null, 2), 'utf-8');
    } catch (err) {
      console.error('[IndexBuilder] Save state error:', err);
    }
  }
}
