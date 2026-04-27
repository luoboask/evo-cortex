/**
 * 索引构建器
 *
 * 整合 FTS 全文搜索 + 向量语义搜索
 * 支持全量重建和增量更新
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
import { PluginContext, getDataDir, getMemoryStorageDir } from '../utils/plugin-context';
import { FtsIndex, FtsDocument } from './fts_index';
import { VectorIndexStore, VectorDocument } from './vector_index';
import { getEmbedding, getEmbeddingsBatch, getEmbeddingLevel } from './embedding_provider';
import { SearchableDocument } from './semantic_search';

// ========== 类型 ==========

export interface IndexBuildResult {
  success: boolean;
  mode: 'full' | 'incremental' | 'database';
  filesScanned: number;
  filesIndexed: number;
  filesUpdated: number;
  filesSkipped: number;
  dbRowsScanned: number;
  dbRowsIndexed: number;
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
  private dbIndexState: Record<string, { indexedAt: string; table: string }> = {}; // wm_xxx / ltm_xxx → 索引状态

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

    return {
      fts,
      vector,
      fileState: { total: 0, indexed: [] },
      lastBuild: undefined
    };
  }

  /**
   * 从 memory.db 直接索引（跳过 .md 中间层）
   * 索引 working_memory（活跃） + long_term_memory（晋升）
   * 通过 dbIndexState 做增量更新，避免重复索引
   */
  async buildFromDb(): Promise<IndexBuildResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const result: IndexBuildResult = {
      success: true,
      mode: 'database',
      filesScanned: 0, filesIndexed: 0, filesUpdated: 0, filesSkipped: 0,
      dbRowsScanned: 0, dbRowsIndexed: 0,
      ftsCount: 0, vectorCount: 0,
      embeddingLevel: getEmbeddingLevel(),
      durationMs: 0, errors
    };

    try {
      const dataDir = getDataDir(this.ctx);
      const dbPath = path.join(dataDir, 'memory.db');
      if (!fs.existsSync(dbPath)) {
        console.log('[IndexBuilder] buildFromDb skipped: memory.db not found');
        return result;
      }

      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
      const dbAll = (sql: string, params: any[] = []): Promise<any[]> =>
        new Promise((resolve, reject) =>
          db.all(sql, params, (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])));

      // 读取 WM + LTM 条目，排除已索引的（增量）
      const indexedIds = Object.keys(this.dbIndexState);
      const whereClause = indexedIds.length > 0
        ? `WHERE id NOT IN (${indexedIds.map(() => '?').join(',')})`
        : '';
      const params = indexedIds.length > 0 ? indexedIds : [];

      const [wmRows, ltmRows] = await Promise.all([
        dbAll(`SELECT id, type, title, content, importance, tags, source, source_ref, created_at FROM working_memory ${whereClause}`, params),
        dbAll(`SELECT id, type, title, content, importance, tags, source, source_ref, created_at, consolidated_from FROM long_term_memory ${whereClause}`, params),
      ]);
      db.close();

      result.dbRowsScanned = wmRows.length + ltmRows.length;
      if (result.dbRowsScanned === 0) {
        console.log(`[IndexBuilder] buildFromDb: no new rows to index`);
        return result;
      }

      // 合并为文档列表，用 original_id 去重（WM 晋升到 LTM 后 WM 条目被删除）
      const allRows = [
        ...wmRows.map((r: any) => ({ ...r, _table: 'working_memory' })),
        ...ltmRows.map((r: any) => ({ ...r, _table: 'long_term_memory' })),
      ];

      const ftsDocs: FtsDocument[] = [];
      const vecDocs: VectorDocument[] = [];

      for (const row of allRows) {
        const docId = `db_${row.id}`;
        const content = row.content || '';
        if (!content || content.trim().length < 10) continue; // 跳过太短的条目

        ftsDocs.push({
          id: docId,
          content,
          metadata: { type: row.type, table: row._table, importance: row.importance, source: row.source }
        });

        // 向量索引：内容分块（每块 ~500 字符）
        const chunks = this.splitContent(content);
        for (let i = 0; i < chunks.length; i++) {
          vecDocs.push({
            id: `${docId}_chunk_${i}`,
            content: chunks[i],
            embedding: [],
            metadata: { type: row.type, table: row._table, chunk: i }
          });
        }

        this.dbIndexState[row.id] = { indexedAt: new Date().toISOString(), table: row._table };
        result.dbRowsIndexed++;
      }

      // 批量索引 FTS
      if (ftsDocs.length > 0) {
        result.ftsCount = await this.ftsIndex.indexBatch(ftsDocs);
      }

      // 批量计算向量 embedding
      if (vecDocs.length > 0) {
        const texts = vecDocs.map(d => d.content);
        const embeddings = await getEmbeddingsBatch(texts);
        let vecCount = 0;
        for (let i = 0; i < vecDocs.length; i++) {
          if (embeddings[i]) {
            vecDocs[i].embedding = embeddings[i]!;
            await this.vectorStore.upsert(vecDocs[i]);
            vecCount++;
          }
        }
        result.vectorCount = vecCount;
      }

      // 清理已删除的 WM 条目索引（WM 晋升后被删除，但索引可能残留）
      // 修复：row.id 本身已含 wm_ 前缀，直接用 db_${oldWmId}
      const ltmConsolidatedFrom = ltmRows
        .filter((r: any) => r.consolidated_from)
        .map((r: any) => r.consolidated_from);
      for (const oldWmId of ltmConsolidatedFrom) {
        const oldDocId = `db_${oldWmId}`;
        await this.ftsIndex.remove(oldDocId);
        await this.vectorStore.remove(oldDocId);
        delete this.dbIndexState[oldWmId];
      }

      // 迁移清理：删除旧版文件扫描遗留的 file_* 条目（rebuild/update 已删除）
      // 每次运行都会检查，幂等操作，无 file_* 条目时开销可忽略
      const fileDocIds = await this.ftsIndex.listByPrefix('file_');
      let cleanedFiles = 0;
      for (const docId of fileDocIds) {
        await this.ftsIndex.remove(docId);
        await this.vectorStore.remove(docId);
        cleanedFiles++;
      }
      if (cleanedFiles > 0) {
        console.log(`[IndexBuilder] migrated ${cleanedFiles} legacy file-scan entries from FTS index`);
      }

      // 清理 dbIndexState 中已不存在的条目（TTL 删除、手动删除等）
      // 注意：需要查询全部 DB ID（不是仅新行），否则会把正常已索引条目误判为 stale
      const allDbIds = new Set<string>();
      if (dbPath && fs.existsSync(dbPath)) {
        const checkDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        const checkDbAll = (sql: string): Promise<string[]> =>
          new Promise((resolve, reject) =>
            checkDb.all(sql, [], (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows?.map((r: any) => r.id as string) || [])));
        const [allWmIds, allLtmIds] = await Promise.all([
          checkDbAll('SELECT id FROM working_memory'),
          checkDbAll('SELECT id FROM long_term_memory'),
        ]);
        checkDb.close();
        for (const id of allWmIds) allDbIds.add(id);
        for (const id of allLtmIds) allDbIds.add(id);
      }
      let staleCleaned = 0;
      for (const indexedId of Object.keys(this.dbIndexState)) {
        if (allDbIds.size > 0 && !allDbIds.has(indexedId)) {
          const staleDocId = `db_${indexedId}`;
          await this.ftsIndex.remove(staleDocId);
          await this.vectorStore.remove(staleDocId);
          delete this.dbIndexState[indexedId];
          staleCleaned++;
        }
      }
      if (staleCleaned > 0) {
        console.log(`[IndexBuilder] cleaned ${staleCleaned} stale index entries (deleted from DB)`);
      }

      result.durationMs = Date.now() - startTime;
      console.log(`[IndexBuilder] buildFromDb: scanned=${result.dbRowsScanned}, indexed=${result.dbRowsIndexed}, fts=${result.ftsCount}, vec=${result.vectorCount} in ${result.durationMs}ms`);
    } catch (err: any) {
      errors.push(`buildFromDb failed: ${err.message}`);
      result.success = false;
      result.durationMs = Date.now() - startTime;
      console.error('[IndexBuilder] buildFromDb error:', err);
    }

    this.saveState();
    return result;
  }

  /**
   * 关闭资源
   */
  close(): void {
    this.ftsIndex.close();
    this.vectorStore.close();
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

  /** 加载状态 */
  private loadState(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        const state = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
        this.dbIndexState = state.dbIndexState || {};
      }
    } catch { this.dbIndexState = {}; }
  }

  /** 保存状态 */
  private saveState(): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({
        dbIndexState: this.dbIndexState
      }, null, 2), 'utf-8');
    } catch (err) {
      console.error('[IndexBuilder] Save state error:', err);
    }
  }
}
