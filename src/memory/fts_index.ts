/**
 * FTS5 全文搜索索引
 *
 * 使用 SQLite FTS5 实现高效全文搜索
 * 支持中英文混合搜索，BM25 排序
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { getDataDir, PluginContext } from '../utils/plugin-context';

// ========== 类型 ==========

export interface FtsDocument {
  id: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface FtsSearchResult {
  id: string;
  content: string;
  rank: number;
  snippet?: string;
  metadata?: Record<string, any>;
}

// ========== FtsIndex ==========

export class FtsIndex {
  private dbPath: string;
  private db: any = null;
  private initialized = false;

  constructor(ctx: PluginContext) {
    const dataDir = getDataDir(ctx);
    const indexDir = path.join(dataDir, 'fts_index');
    if (!fs.existsSync(indexDir)) fs.mkdirSync(indexDir, { recursive: true });
    this.dbPath = path.join(indexDir, 'fts.sqlite');
  }

  /** 初始化数据库和 FTS5 虚拟表 */
  init(): void {
    if (this.initialized) return;
    const require = createRequire(import.meta.url);
    const sqlite3 = require('sqlite3').verbose();
    this.db = new sqlite3.Database(this.dbPath);
    this.db.serialize(() => {
      // FTS5 虚拟表 - 使用 unicode61 分词器（支持中文逐字切分）
      this.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
        content,
        metadata,
        tokenize='unicode61'
      )`);

      // 辅助表：存储文档 ID、内容和 FTS5 rowid 映射
      this.db.run(`CREATE TABLE IF NOT EXISTS fts_docs (
        id TEXT PRIMARY KEY,
        fts_rowid INTEGER,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
    });
    this.initialized = true;
    console.log(`[FtsIndex] Initialized: ${this.dbPath}`);
  }

  /** 确保已初始化 */
  private ensureInit(): void {
    if (!this.initialized) this.init();
  }

  /**
   * 索引单个文档
   */
  async index(doc: FtsDocument): Promise<void> {
    this.ensureInit();
    return new Promise((resolve, reject) => {
      const self = this;
      // 1. 先插入 FTS5 表，自动生成 rowid
      this.db.run(
        `INSERT OR REPLACE INTO fts_content(content, metadata) VALUES (?, ?)`,
        [doc.content, doc.metadata ? JSON.stringify(doc.metadata) : null],
        function(err: Error | null) {
          if (err) return reject(err);
          // @ts-ignore - sqlite3 Statement 'this' context
          const ftsRowid = this.lastID;
          // 2. 再插入辅助表，保存 rowid 映射
          self.db.run(
            `INSERT OR REPLACE INTO fts_docs (id, fts_rowid, content, metadata_json, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`,
            [doc.id, ftsRowid, doc.content, doc.metadata ? JSON.stringify(doc.metadata) : null],
            (err2: Error | null) => { err2 ? reject(err2) : resolve(); }
          );
        }
      );
    });
  }

  /**
   * 批量索引文档（串行插入以保证事务正确性）
   */
  async indexBatch(docs: FtsDocument[]): Promise<number> {
    this.ensureInit();
    const self = this;
    let count = 0;

    return new Promise((resolve, reject) => {
      self.db.serialize(() => {
        self.db.run('BEGIN', (beginErr: Error | null) => {
          if (beginErr) return reject(beginErr);
          insertNext(0);
        });

        function insertNext(i: number) {
          if (i >= docs.length) {
            self.db.run('COMMIT', (commitErr: Error | null) => {
              commitErr ? reject(commitErr) : resolve(count);
            });
            return;
          }

          const doc = docs[i];
          self.db.run(
            `INSERT INTO fts_content(content, metadata) VALUES (?, ?)`,
            [doc.content, doc.metadata ? JSON.stringify(doc.metadata) : null],
            function(err: Error | null) {
              if (err) {
                self.db.run('ROLLBACK');
                return reject(err);
              }
              // @ts-ignore - sqlite3 Statement 'this' context
              const ftsRowid = this.lastID;
              self.db.run(
                `INSERT OR REPLACE INTO fts_docs (id, fts_rowid, content, metadata_json, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`,
                [doc.id, ftsRowid, doc.content, doc.metadata ? JSON.stringify(doc.metadata) : null],
                (err2: Error | null) => {
                  if (err2) return reject(err2);
                  count++;
                  insertNext(i + 1);
                }
              );
            }
          );
        }
      });
    });
  }

  /**
   * FTS5 全文搜索（BM25 排序）
   */
  async search(query: string, topK: number = 10): Promise<FtsSearchResult[]> {
    this.ensureInit();

    // 转义 FTS5 特殊字符
    const escaped = query
      .replace(/[\-\+\=<>!@~\(\)"\*\?]/g, ' ')
      .trim();

    if (escaped.length === 0) return [];

    // FTS5 查询：使用 MATCH + BM25 排序
    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db.all(
        `SELECT d.id, d.content, d.metadata_json,
                bm25(fts_content) as rank
         FROM fts_content
         JOIN fts_docs d ON fts_content.rowid = d.fts_rowid
         WHERE fts_content MATCH ?
         ORDER BY rank
         LIMIT ?`,
        [escaped, topK],
        (err: Error | null, rows: any[]) => { err ? reject(err) : resolve(rows || []); }
      );
    });

    return rows.map(row => {
      let metadata: Record<string, any> | undefined;
      try {
        if (row.metadata_json) metadata = JSON.parse(row.metadata_json);
      } catch { /* ignore */ }

      // 生成摘要片段
      let snippet: string | undefined;
      try {
        snippet = this.generateSnippet(row.content, escaped);
      } catch { /* ignore */ }

      return {
        id: row.id,
        content: row.content,
        rank: row.rank,
        snippet,
        metadata
      };
    });
  }

  /**
   * 按前缀列出文档 ID（用于迁移清理）
   */
  listByPrefix(prefix: string): Promise<string[]> {
    this.ensureInit();
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id FROM fts_docs WHERE id LIKE ?',
        [`${prefix}%`],
        (err: Error | null, rows: any[]) => {
          if (err) return reject(err);
          resolve((rows || []).map((r: any) => r.id as string));
        }
      );
    });
  }

  /**
   * 删除文档
   */
  remove(id: string): Promise<boolean> {
    this.ensureInit();
    return new Promise((resolve, reject) => {
      // 先获取 fts_rowid
      this.db.get(`SELECT fts_rowid FROM fts_docs WHERE id = ?`, [id], (err: Error | null, row: any) => {
        if (err) return reject(err);
        if (!row || !row.fts_rowid) return resolve(false);
        const ftsRowid = row.fts_rowid;
        // 删除辅助表记录
        this.db.run(`DELETE FROM fts_docs WHERE id = ?`, [id], (err2: Error | null) => {
          if (err2) return reject(err2);
          // 从 FTS5 中删除（FTS5 需要通过 rowid 删除）
          this.db.run(`DELETE FROM fts_content WHERE rowid = ?`, [ftsRowid], (err3: Error | null) => {
            if (err3) return reject(err3);
            resolve(true);
          });
        });
      });
    });
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    avgContentLength: number;
    dbSize: number;
  }> {
    this.ensureInit();

    const row = await new Promise<any>((resolve, reject) => {
      this.db.get(
        `SELECT count(*) as total, avg(length(content)) as avgLen FROM fts_docs`,
        (err: Error | null, row: any) => err ? reject(err) : resolve(row)
      );
    });

    let dbSize = 0;
    try { dbSize = fs.statSync(this.dbPath).size; } catch { /* ignore */ }

    return {
      total: row?.total || 0,
      avgContentLength: Math.round(row?.avgLen || 0),
      dbSize
    };
  }

  /**
   * 清空索引
   */
  clear(): Promise<void> {
    this.ensureInit();
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM fts_docs`, (err: Error | null) => {
        if (err) return reject(err);
        // FTS5 不支持直接 DELETE，需要重建
        this.db.run(`DROP TABLE IF EXISTS fts_content`, (err2: Error | null) => {
          if (err2) return reject(err2);
          this.db.run(`CREATE VIRTUAL TABLE fts_content USING fts5(
            content,
            metadata,
            tokenize='unicode61'
          )`, (err3: Error | null) => {
            err3 ? reject(err3) : resolve();
          });
        });
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

  /**
   * 生成搜索摘要片段
   */
  private generateSnippet(content: string, query: string, maxLen: number = 200): string {
    const words = query.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return content.slice(0, maxLen);

    // 找到第一个匹配词的位置
    let bestPos = -1;
    for (const word of words) {
      const pos = content.toLowerCase().indexOf(word.toLowerCase());
      if (pos >= 0 && (bestPos < 0 || pos < bestPos)) {
        bestPos = pos;
      }
    }

    if (bestPos < 0) return content.slice(0, maxLen);

    // 以匹配位置为中心截取片段
    const halfLen = Math.floor(maxLen / 2);
    const start = Math.max(0, bestPos - halfLen);
    const end = Math.min(content.length, bestPos + halfLen);
    let snippet = content.slice(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet;
  }
}
