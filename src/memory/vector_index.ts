/**
 * 持久化向量索引
 *
 * 使用 SQLite 存储 embedding，支持余弦相似度搜索
 * 解决 SemanticSearch 仅内存存储、重启丢失的问题
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { getDataDir, PluginContext } from '../utils/plugin-context';
import { getLogger } from '../utils/logger';

// ========== 类型 ==========

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, any>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, any>;
}

// ========== VectorIndexStore ==========

export class VectorIndexStore {
  private logger = getLogger({ component: 'VectorIndexStore' });
  private dbPath: string;
  private db: any = null;
  private initialized = false;

  constructor(ctx: PluginContext) {
    const dataDir = getDataDir(ctx);
    const indexDir = path.join(dataDir, 'vector_index');
    if (!fs.existsSync(indexDir)) fs.mkdirSync(indexDir, { recursive: true });
    this.dbPath = path.join(indexDir, 'vectors.sqlite');
  }

  /** 初始化数据库 */
  init(): void {
    if (this.initialized) return;
    const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
    this.db = new sqlite3.Database(this.dbPath);
    this.db.serialize(() => {
      // 向量存储表
      this.db.run(`CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        source TEXT DEFAULT 'plugin',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);

      // 元数据表
      this.db.run(`CREATE TABLE IF NOT EXISTS vector_metadata (
        vector_id TEXT PRIMARY KEY,
        metadata_json TEXT,
        FOREIGN KEY (vector_id) REFERENCES vectors(id) ON DELETE CASCADE
      )`);

      // 索引：按 dimensions 过滤（不同模型维度不同，不能混搜）
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_vectors_dims ON vectors(dimensions)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_vectors_source ON vectors(source)`);
    });
    this.initialized = true;
    this.logger.info(`Initialized: ${this.dbPath}`);
  }

  /** 确保已初始化 */
  private ensureInit(): void {
    if (!this.initialized) this.init();
  }

  /**
   * 存储单个向量
   */
  upsert(doc: VectorDocument): Promise<void> {
    this.ensureInit();
    return new Promise((resolve, reject) => {
      // 将 number[] 转为 Buffer（Float32）
      const buf = this.embeddingToBuffer(doc.embedding);

      this.db.run(
        `INSERT OR REPLACE INTO vectors (id, content, embedding, dimensions, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [doc.id, doc.content, buf, doc.embedding.length],
        (err: Error | null) => {
          if (err) return reject(err);

          // 更新元数据
          if (doc.metadata) {
            this.db.run(
              `INSERT OR REPLACE INTO vector_metadata (vector_id, metadata_json) VALUES (?, ?)`,
              [doc.id, JSON.stringify(doc.metadata)],
              (err2: Error | null) => { err2 ? reject(err2) : resolve(); }
            );
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 批量存储向量
   */
  async upsertBatch(docs: VectorDocument[]): Promise<number> {
    let count = 0;
    for (const doc of docs) {
      await this.upsert(doc);
      count++;
    }
    return count;
  }

  /**
   * 搜索：余弦相似度 topK
   */
  async search(queryEmbedding: number[], topK: number = 10): Promise<VectorSearchResult[]> {
    this.ensureInit();
    const dims = queryEmbedding.length;

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db.all(
        `SELECT id, content, embedding, dimensions FROM vectors WHERE dimensions = ?`,
        [dims],
        (err: Error | null, rows: any[]) => { err ? reject(err) : resolve(rows || []); }
      );
    });

    // Batch-fetch all metadata in a single query (fix N+1)
    const ids = rows.map(r => r.id);
    const metadataMap = new Map<string, Record<string, any>>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const metaRows = await new Promise<any[]>((res, rej) => {
        this.db.all(
          `SELECT vector_id, metadata_json FROM vector_metadata WHERE vector_id IN (${placeholders})`,
          ids,
          (err: Error | null, mr: any[]) => { err ? rej(err) : res(mr || []); }
        );
      });
      for (const mr of metaRows) {
        try {
          if (mr.metadata_json) metadataMap.set(mr.vector_id, JSON.parse(mr.metadata_json));
        } catch { /* ignore */ }
      }
    }

    // 内存中计算余弦相似度
    const results: VectorSearchResult[] = [];
    for (const row of rows) {
      const stored = this.bufferToEmbedding(row.embedding);
      if (stored.length !== dims) continue;

      const score = this.cosineSimilarity(queryEmbedding, stored);
      results.push({
        id: row.id,
        content: row.content,
        score,
        metadata: metadataMap.get(row.id)
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * 删除向量
   */
  remove(id: string): Promise<boolean> {
    this.ensureInit();
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM vectors WHERE id = ?`, [id], function(this: any, err: Error | null) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      });
    });
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    dimensions: Record<number, number>;
    sources: Record<string, number>;
    dbSize: number;
  }> {
    this.ensureInit();

    const [totalRow, dimsRow, sourcesRow] = await Promise.all([
      new Promise<any>((res, rej) => {
        this.db.get(`SELECT count(*) as total FROM vectors`, (err: Error | null, row: any) => err ? rej(err) : res(row));
      }),
      new Promise<any[]>((res, rej) => {
        this.db.all(`SELECT dimensions, count(*) as cnt FROM vectors GROUP BY dimensions`, (err: Error | null, rows: any[]) => err ? rej(err) : res(rows || []));
      }),
      new Promise<any[]>((res, rej) => {
        this.db.all(`SELECT source, count(*) as cnt FROM vectors GROUP BY source`, (err: Error | null, rows: any[]) => err ? rej(err) : res(rows || []));
      }),
    ]);

    const dimensions: Record<number, number> = {};
    for (const r of dimsRow) dimensions[r.dimensions] = r.cnt;

    const sources: Record<string, number> = {};
    for (const r of sourcesRow) sources[r.source] = r.cnt;

    let dbSize = 0;
    try { dbSize = fs.statSync(this.dbPath).size; } catch { /* ignore */ }

    return {
      total: totalRow?.total || 0,
      dimensions,
      sources,
      dbSize
    };
  }

  /**
   * 清空索引
   */
  clear(): Promise<void> {
    this.ensureInit();
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM vectors; DELETE FROM vector_metadata;`, (err: Error | null) => {
        err ? reject(err) : resolve();
      });
    });
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  // ========== 私有工具方法 ==========

  /** number[] → Buffer (Float32Array) */
  private embeddingToBuffer(embedding: number[]): Buffer {
    return Buffer.from(new Float32Array(embedding).buffer);
  }

  /** Buffer → number[] */
  private bufferToEmbedding(buf: Buffer): number[] {
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}
