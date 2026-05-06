/**
 * MemorySystem — 统一记忆系统 (v2)
 *
 * 主存储：SQLite (memory.db)
 * - working_memory：短期缓存（24h 过期，重要性评分）
 * - long_term_memory：长期记忆（重要性 >= 7 晋升）
 * - consolidation_log：晋升日志
 *
 * Markdown 持久备份：
 * - record() 可选写入 memory/YYYY-MM-DD.md 作为持久备份
 * - getRecentDailySummary() 优先读 SQLite，fallback 到 .md 文件
 *
 * 核心功能：
 * - 统一写入入口（自动计算重要性）
 * - 工作记忆刷新（活跃会话延长过期）
 * - 晋升机制（工作 → 长期）
 * - 意图识别 + 动态排序搜索（FTS + 向量融合）
 * - Markdown 持久备份（可选）
 *
 * ESM 兼容：sqlite3 通过 createRequire 加载
 */

import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { getLogger } from '../utils/logger';

const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();

// ========== 类型定义 ==========

export interface MemoryEntry {
  id?: string;
  type: 'conversation' | 'decision' | 'bugfix' | 'insight' | 'preference' | 'error' | 'observation';
  title?: string;
  content: string;
  source: 'hook' | 'scan' | 'manual' | 'cron';
  sourceRef?: string;
  tags?: string[];
  importance?: number; // 调用方可显式指定 (0-10)，覆盖自动评分
  timestamp?: string;
}

export interface SearchResult {
  id: string;
  type: string;
  targetType: 'event' | 'entity' | 'relation' | 'rule';
  title?: string;
  content?: string;
  importance: number;
  recall_count?: number;
  used_count?: number;
  created_at: string;
  dynamicScore?: number;
}

export interface SearchQuery {
  text: string;
  types?: string[];
  minImportance?: number;
  limit?: number;
}

// ========== 重要性评分权重 ==========

const TYPE_WEIGHTS: Record<string, number> = {
  decision: 3,
  bugfix: 2.5,
  preference: 2.5,
  insight: 2,
  error: 1.5,
  observation: 1,
  conversation: 0.5,
};

const SOURCE_WEIGHTS: Record<string, number> = {
  manual: 2,
  hook: 1,
  scan: 0.5,
  cron: 0.3,
};

const KEYWORD_BONUS = 1.5;
const KEYWORD_PATTERN = /记住|重要|必须|关键|偏好|喜欢|决定|remember|important|must|key|prefer|like|decide/i;

const BASE_SCORE = 3.0;
const MAX_SCORE = 10;

// ========== MemorySystem ==========

export class MemorySystem {
  private db: any;
  private dbPath: string;
  private initialized: boolean = false;
  private indexBuilder: any | null = null;  // 可选的 IndexBuilder 引用（用于 FTS+向量搜索）
  private indexLogger: any | null = null;    // 可选的日志记录器
  private storageDir: string;               // markdown 持久备份目录
  private backupEnabled: boolean = true;    // 是否启用 markdown 备份

  constructor(agentId: string, dataDir: string, workspaceDir: string) {
    this.dbPath = path.join(dataDir, agentId, 'memory.db');
    // Markdown 持久备份目录：workspace/memory/
    this.storageDir = path.join(workspaceDir, 'memory');
  }

  /** 初始化数据库（确保表、索引存在，支持从零启动） */
  async init(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise<void>((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err: Error | null) => {
        if (err) {
          reject(new Error(`MemorySystem init failed: ${err.message}`));
          return;
        }
        // 启用 WAL 模式提升并发性能
        this.db.run('PRAGMA journal_mode=WAL', () => {});
        this.db.run('PRAGMA busy_timeout=5000', () => {
          // 创建表（CREATE TABLE IF NOT EXISTS — 保证从零启动能力）
          this.db.run(`
            CREATE TABLE IF NOT EXISTS working_memory (
              id          TEXT PRIMARY KEY,
              type        TEXT NOT NULL DEFAULT 'conversation',
              title       TEXT,
              content     TEXT NOT NULL,
              importance  REAL DEFAULT 5.0,
              tags        TEXT DEFAULT '[]',
              source      TEXT DEFAULT 'scan',
              source_ref  TEXT,
              created_at  TEXT DEFAULT (datetime('now')),
              expires_at  TEXT
            )
          `, () => {});
          this.db.run(`
            CREATE TABLE IF NOT EXISTS long_term_memory (
              id          TEXT PRIMARY KEY,
              type        TEXT NOT NULL DEFAULT 'conversation',
              title       TEXT NOT NULL DEFAULT '',
              content     TEXT NOT NULL,
              importance  REAL NOT NULL,
              tags        TEXT DEFAULT '[]',
              source      TEXT DEFAULT 'scan',
              source_ref  TEXT,
              recalled_at TEXT,
              recall_count INTEGER DEFAULT 0,
              created_at  TEXT DEFAULT (datetime('now')),
              consolidated_from TEXT
            )
          `, () => {});
          this.db.run(`
            CREATE TABLE IF NOT EXISTS consolidation_log (
              id              TEXT PRIMARY KEY,
              working_id      TEXT NOT NULL,
              long_term_id    TEXT NOT NULL,
              reason          TEXT,
              importance      REAL,
              created_at      TEXT DEFAULT (datetime('now'))
            )
          `, () => {});
          // 索引
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_wm_expires ON working_memory(expires_at)`, () => {});
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_wm_importance ON working_memory(importance DESC)`, () => {});
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_ltm_importance ON long_term_memory(importance DESC)`, () => {});
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_ltm_recall ON long_term_memory(recalled_at)`, () => {
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_wm_created ON working_memory(created_at DESC)`, () => {
              this.initialized = true;
              resolve();
            });
          });
        });
      });
    });
  }

  /** 设置 IndexBuilder 以启用 FTS+向量融合搜索 */
  setIndexBuilder(builder: any, logger?: any): void {
    this.indexBuilder = builder;
    this.indexLogger = logger || null;
  }

  /** 关闭数据库 */
  async close(): Promise<void> {
    if (!this.db) return;
    return new Promise<void>((resolve) => {
      this.db.close(() => {
        this.db = null;
        this.initialized = false;
        resolve();
      });
    });
  }

  // ========== 统一写入入口 ==========

  /**
   * 记录一条记忆到 working_memory
   * 1. 生成 ID
   * 2. 计算重要性
   * 3. 写入 working_memory
   * 4. 异步触发后续处理（不阻塞）
   */
  async record(entry: MemoryEntry): Promise<string> {
    await this.ensureInit();

    const importance = this.scoreImportance(entry);
    const tags = JSON.stringify(entry.tags || []);
    const now = new Date().toISOString();
    const id = `wm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise<string>((resolve, reject) => {
      this.db.run(
        `INSERT INTO working_memory (id, type, title, content, importance, tags, source, source_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, entry.type, entry.title || '', entry.content, importance, tags, entry.source, entry.sourceRef || null, now],
        (err: Error | null) => {
          if (err) {
            reject(new Error(`MemorySystem.record failed: ${err.message}`));
            return;
          }
          // 异步触发后续处理（不阻塞）
          this.onRecorded(id, entry, importance).catch((e: Error) => {
            // P2: fire-and-forget 带日志，不吞错误
            getLogger({ component: 'MemorySystem' }).warn(`onRecorded failed: ${e.message}`);
          });
          resolve(id);
        }
      );
    });
  }

  /** 记录后异步处理（可扩展：触发知识提取等） */
  private async onRecorded(_id: string, _entry: MemoryEntry, _importance: number): Promise<void> {
    // Phase 3 可扩展：触发知识系统更新
  }

  // ========== 重要性评分 ==========

  /**
   * 计算记忆重要性分数
   * - 基础分 3.0
   * - 类型权重：decision=3, bugfix=2.5, preference=2.5, insight=2, error=1.5, observation=1, conversation=0.5
   * - 来源权重：manual=2, hook=1, scan=0.5, cron=0.3
   * - 关键词加成：记住/重要/必须/关键/偏好/喜欢/决定 → +1.5
   * - 返回 min(score, 10)
   */
  private scoreImportance(entry: MemoryEntry): number {
    // 调用方显式指定 importance 时，直接使用（尊重外部评分）
    if (entry.importance !== undefined) {
      return Math.min(Math.max(entry.importance, 0), 10);
    }
    // 否则按类型/来源/关键词自动评分
    let score = BASE_SCORE;
    score += TYPE_WEIGHTS[entry.type] || 0;
    score += SOURCE_WEIGHTS[entry.source] || 0;
    if (KEYWORD_PATTERN.test(entry.content) || (entry.title && KEYWORD_PATTERN.test(entry.title))) {
      score += KEYWORD_BONUS;
    }
    return Math.min(score, MAX_SCORE);
  }

  // ========== 晋升：工作 → 长期 ==========

  /**
   * 将 working_memory 中最新 100 条之后的记录（importance >= 7）晋升到 long_term_memory
   * 使用事务保护，返回 { promoted, promotedIds }
   */
  async consolidate(options?: {
    onPromoted?: (ltmId: string, row: any) => Promise<void>;
  }): Promise<{ promoted: number; promotedIds: string[] }> {
    await this.ensureInit();

    return new Promise<{ promoted: number; promotedIds: string[] }>((resolve, reject) => {
      // 1. 最新 100 条之后的记录，importance >= 7 即晋升
      this.db.all(
        `SELECT id, type, title, content, importance, tags, source, source_ref, created_at FROM working_memory WHERE importance >= 7 AND id NOT IN (SELECT id FROM working_memory ORDER BY created_at DESC LIMIT 100)`,
        [],
        async (err: Error | null, rows: any[]) => {
          if (err) {
            reject(new Error(`consolidate query failed: ${err.message}`));
            return;
          }

          if (rows.length === 0) {
            resolve({ promoted: 0, promotedIds: [] });
            return;
          }

          // 2. 用事务包裹所有写入操作，确保原子性
          const runInTransaction = async (): Promise<{ promoted: number; promotedIds: string[]; rows: any[] }> => {
            await this.runAsync('BEGIN IMMEDIATE', []);
            const promotedIds: string[] = [];
            const promotedRows: any[] = [];
            try {
              for (const row of rows) {
                const ltmId = `ltm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // INSERT INTO long_term_memory
                await this.runAsync(
                  `INSERT OR IGNORE INTO long_term_memory (id, type, title, content, importance, tags, source, source_ref, created_at, consolidated_from)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [ltmId, row.type, row.title || '', row.content, row.importance, row.tags, row.source, row.source_ref, row.created_at, row.id]
                );

                // INSERT INTO consolidation_log
                await this.runAsync(
                  `INSERT INTO consolidation_log (id, working_id, long_term_id, reason, importance)
                   VALUES (?, ?, ?, 'importance_threshold', ?)`,
                  [logId, row.id, ltmId, row.importance]
                );

                // DELETE FROM working_memory
                await this.runAsync(
                  `DELETE FROM working_memory WHERE id = ?`,
                  [row.id]
                );

                promotedIds.push(ltmId);
                promotedRows.push(row);
              }
              await this.runAsync('COMMIT', []);
            } catch (e) {
              // 事务回滚：任何失败都回退全部操作
              try { await this.runAsync('ROLLBACK', []); } catch { /* ignore */ }
              throw e;
            }
            return { promoted: promotedIds.length, promotedIds, rows: promotedRows };
          };

          try {
            const result = await runInTransaction();
            const { promoted, promotedIds, rows } = result;

            // 3. 事务成功后，对每个晋升条目调用回调（如知识图谱更新）
            // 回调失败不影响已提交的晋升（独立降级）
            if (options?.onPromoted && promoted > 0) {
              for (let i = 0; i < promotedIds.length; i++) {
                try {
                  await options.onPromoted(promotedIds[i], rows[i]);
                } catch (cbErr: any) {
                  this.indexLogger?.warn?.(`consolidate onPromoted callback failed for ${promotedIds[i]}: ${cbErr.message}`);
                }
              }
            }

            resolve({ promoted, promotedIds });
          } catch (e: any) {
            reject(new Error(`consolidate transaction failed: ${e.message}`));
          }
        }
      );
    });
  }

  // ========== 搜索 ==========

  /**
   * 统一搜索入口
   * 1. 意图识别 (classifyIntent)
   * 2. 路由到对应层
   * 3. FTS 关键词搜索
   * 4. 动态排序
   * 5. 记录使用
   * 6. 返回
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    await this.ensureInit();

    const limit = query.limit || 10;
    const intent = this.classifyIntent(query.text);
    const results: SearchResult[] = [];

    // 确定激活的搜索源数量，用于公平分配 limit
    const hasIndexBuilder = this.indexBuilder != null;
    const activeSources = 2 + (hasIndexBuilder ? 1 : 0);  // LTM + WM + 可选 IndexBuilder
    const perSourceLimit = Math.max(1, Math.ceil(limit / activeSources));

    // 根据意图路由到不同层，每源共享限流额度
    if (intent === 'event' || intent === 'general') {
      const ltmResults = await this.searchLTM(query, perSourceLimit);
      results.push(...ltmResults);
    }

    if (intent === 'entity' || intent === 'general') {
      const wmResults = await this.searchWM(query, Math.max(1, Math.ceil(perSourceLimit * 0.5)));
      results.push(...wmResults);
    }

    // 如果设置了 IndexBuilder，搜索 markdown 文件并合并结果（不重复搜索）
    if (hasIndexBuilder && (intent === 'general' || intent === 'event')) {
      const fileResults = await this.searchIndex(query, perSourceLimit);
      results.push(...fileResults);
    }

    // 去重
    const seen = new Set<string>();
    const unique = results.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    // 动态排序
    const ranked = this.rank(unique, limit);

    // 记录使用
    await this.recordUsage(ranked.filter(r => r.targetType === 'event'));

    return ranked;
  }

  /**
   * 搜索 IndexBuilder 索引的 markdown 文件（FTS+向量融合）
   */
  private async searchIndex(query: SearchQuery, limit: number): Promise<SearchResult[]> {
    if (!this.indexBuilder) return [];

    try {
      const ibResults = await this.indexBuilder.unifiedSearch(query.text, limit);
      return ibResults.map((_r: any) => ({
        id: `idx_${_r.id}`,
        type: 'indexed_file',
        targetType: 'event' as const,
        title: _r.metadata?.filename || _r.id,
        content: _r.content,
        importance: Math.min(_r.score * 10, 10),  // 归一化到 0-10 范围，与 importance 对齐
        recall_count: 0,
        created_at: _r.metadata?.modifiedAt || new Date().toISOString(),
        dynamicScore: _r.score,
      }));
    } catch (err: any) {
      this.indexLogger?.debug?.(`IndexBuilder search failed: ${err.message}`);
      return [];
    }
  }

  /** 搜索长期记忆 */
  private async searchLTM(query: SearchQuery, limit: number): Promise<SearchResult[]> {
    const minImportance = query.minImportance || 0;
    const typeFilter = query.types
      ? `AND type IN (${query.types.map(() => '?').join(', ')})`
      : '';

    const typeParams = query.types || [];

    // 将搜索词拆分为多个 LIKE 条件（OR 连接，任一命中即可）
    const terms = query.text.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    // (content LIKE '%a%' OR content LIKE '%b%' OR title LIKE '%a%' OR title LIKE '%b%')
    const contentLikes = terms.map((_t) => `content LIKE ?`).join(' OR ');
    const titleLikes = terms.map((_t) => `title LIKE ?`).join(' OR ');
    const likeClause = `(${contentLikes} OR ${titleLikes})`;

    const likeParams = [...terms.map(t => `%${t}%`), ...terms.map(t => `%${t}%`)]; // content terms + title terms
    const params = [...typeParams, ...likeParams, limit * 2];

    return new Promise<SearchResult[]>((resolve, _reject) => {
      this.db.all(
        `SELECT id, type, title, content, importance, recall_count, created_at
         FROM long_term_memory
         WHERE importance >= ? ${typeFilter}
           AND ${likeClause}
         ORDER BY importance DESC, recall_count DESC, created_at DESC
         LIMIT ?`,
        [minImportance, ...params],
        (err: Error | null, rows: any[]) => {
          if (err) {
            getLogger({ component: 'MemorySystem' }).warn(`searchLTM failed: ${err.message}`);
            resolve([]);
            return;
          }
          resolve(rows.map(row => ({
            id: row.id,
            type: row.type,
            targetType: 'event' as const,
            title: row.title || undefined,
            content: row.content,
            importance: row.importance,
            recall_count: row.recall_count || 0,
            created_at: row.created_at,
          })));
        }
      );
    });
  }

  /** 搜索工作记忆 */
  private async searchWM(query: SearchQuery, limit: number): Promise<SearchResult[]> {
    // 将搜索词拆分为多个 LIKE 条件（OR 连接，任一命中即可）
    const terms = query.text.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const contentLikes = terms.map((_t) => `content LIKE ?`).join(' OR ');
    const titleLikes = terms.map((_t) => `title LIKE ?`).join(' OR ');
    const likeClause = `(${contentLikes} OR ${titleLikes})`;

    const params = [...terms.map(t => `%${t}%`), ...terms.map(t => `%${t}%`), limit]; // content terms + title terms + limit

    return new Promise<SearchResult[]>((resolve, _reject) => {
      this.db.all(
        `SELECT id, type, title, content, importance, created_at
         FROM working_memory
         WHERE ${likeClause}
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`,
        [...params],
        (err: Error | null, rows: any[]) => {
          if (err) {
            getLogger({ component: 'MemorySystem' }).warn(`searchWM failed: ${err.message}`);
            resolve([]);
            return;
          }
          resolve(rows.map(row => ({
            id: row.id,
            type: row.type,
            targetType: 'event' as const,
            title: row.title || undefined,
            content: row.content,
            importance: row.importance,
            created_at: row.created_at,
          })));
        }
      );
    });
  }

  // ========== 意图识别 ==========

  /**
   * 根据查询文本识别搜索意图
   * - 包含 "是什么" → entity
   * - 包含 "之前/发生过/记得" → event
   * - 包含 "关系/关联" → relation
   * - 包含 "应该/怎么做/建议" → rule
   * - 其他 → general
   */
  private classifyIntent(text: string): 'entity' | 'event' | 'relation' | 'rule' | 'general' {
    const lower = text.toLowerCase();

    // entity: 是什么/who is/what is
    if (/是什么|是什么东西|who is|what is|定义|概念/.test(lower)) return 'entity';

    // event: 之前/发生过/记得/之前做过
    if (/之前|发生过|记得|上次|以前|history|remember|previous|before|last time/.test(lower)) return 'event';

    // relation: 关系/关联
    if (/关系|关联|联系|connection|relation|关联/.test(lower)) return 'relation';

    // rule: 应该/怎么做/建议
    if (/应该|怎么做|建议|如何|how to|suggest|recommend|方案/.test(lower)) return 'rule';

    return 'general';
  }

  // ========== 动态排序 ==========

  /**
   * 动态排序：score = importance * 0.5 + min(recall_count * 0.15, 3) + freshnessBoost + usageBoost
   */
  private rank(results: SearchResult[], limit: number): SearchResult[] {
    const scored = results.map(r => {
      const freshness = this.freshnessBoost(r.created_at);
      const usage = this.usageBoost(r.recall_count || 0);
      const dynamicScore = r.importance * 0.5
        + Math.min((r.recall_count || 0) * 0.15, 3)
        + freshness
        + usage;
      return { ...r, dynamicScore };
    });

    scored.sort((a, b) => (b.dynamicScore || 0) - (a.dynamicScore || 0));
    return scored.slice(0, limit);
  }

  /** 新鲜度加成：<1天=1.0, <7天=0.5, <30天=0.2, 其他=0.0 */
  private freshnessBoost(createdAt: string): number {
    const age = Date.now() - new Date(createdAt).getTime();
    const days = age / (24 * 60 * 60 * 1000);
    if (days < 1) return 1.0;
    if (days < 7) return 0.5;
    if (days < 30) return 0.2;
    return 0.0;
  }

  /** 使用加成：min(usedCount * 0.1, 1.5) */
  private usageBoost(usedCount: number): number {
    return Math.min(usedCount * 0.1, 1.5);
  }

  // ========== 记录使用 ==========

  /** 更新 recall_count 和 recalled_at */
  private async recordUsage(results: SearchResult[]): Promise<void> {
    const now = new Date().toISOString();
    for (const r of results) {
      try {
        await this.runAsync(
          `UPDATE long_term_memory SET recall_count = COALESCE(recall_count, 0) + 1, recalled_at = ? WHERE id = ?`,
          [now, r.id]
        );
      } catch {
        // 静默失败，不影响搜索
      }
    }
  }

  // ========== 辅助方法 ==========

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.init();
  }

  private runAsync(sql: string, params: any[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** 获取统计信息 */
  async getStats(): Promise<{
    workingMemory: number;
    longTermMemory: number;
    consolidationLog: number;
    avgImportance: number;
  }> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT
          (SELECT COUNT(*) FROM working_memory) as workingMemory,
          (SELECT COUNT(*) FROM long_term_memory) as longTermMemory,
          (SELECT COUNT(*) FROM consolidation_log) as consolidationLog,
          (SELECT COALESCE(AVG(importance), 0) FROM long_term_memory) as avgImportance`,
        [],
        (err: Error | null, row: any) => {
          if (err) reject(new Error(`getStats failed: ${err.message}`));
          else resolve(row);
        }
      );
    });
  }

  // ========== Markdown 持久备份 ==========
  /** 将记忆条目持久化到 markdown 文件（每日备份） */
  async persistToMarkdown(entry: MemoryEntry): Promise<void> {
    if (!this.backupEnabled) return;
    try {
      const now = new Date();
      const timestamp = entry.timestamp || now.toISOString();
      const dateStr = timestamp.split('T')[0];
      const id = entry.id || `wm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const memoryDir = this.storageDir;
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
      }
      const dailyFile = path.join(memoryDir, `${dateStr}.md`);

      const entryBlock = [
        '---',
        `id: ${id}`,
        `type: ${entry.type}`,
        `timestamp: ${timestamp}`,
        `## ${entry.title || entry.type}`,
        '',
        entry.content,
        '---',
        '',
      ].join('\n');

      // Check for duplicate before appending
      const content = fs.existsSync(dailyFile) ? fs.readFileSync(dailyFile, 'utf-8') : '';
      if (!content.includes(entry.content.slice(0, 50))) {
        fs.appendFileSync(dailyFile, entryBlock, 'utf-8');
      }
    } catch {
      // 备份失败不影响主流程，静默忽略
    }
  }

  /** 从 SQLite 读取最近记忆摘要（替代 MemoryHub.getRecentDailySummary） */
  async getRecentDailySummary(days: number = 2): Promise<string | null> {
    await this.ensureInit();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // 1. 从 long_term_memory 读取最近 N 天的记录，按日期分组，每天最多取 5 条最重要的
    const ltmEntries = await new Promise<any[]>((resolve) => {
      this.db.all(
        `SELECT id, type, title, content, importance, source, created_at
         FROM long_term_memory
         WHERE date(created_at) >= date(?)
         ORDER BY importance DESC, created_at DESC
         LIMIT 15`,
        [cutoffStr],
        (_err: Error | null, rows: any[]) => resolve(rows || [])
      );
    });

    // 按日期分组并限制每天条目数
    const byDate = new Map<string, any[]>();
    for (const entry of ltmEntries) {
      const dateKey = entry.created_at.split('T')[0];
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      if (byDate.get(dateKey)!.length < 5) {
        byDate.get(dateKey)!.push(entry);
      }
    }

    // 2. 从 working_memory 读取最近记录（最多 5 条，按重要性排序）
    const wmEntries = await new Promise<any[]>((resolve) => {
      this.db.all(
        `SELECT id, type, title, content, importance, source, created_at
         FROM working_memory
         ORDER BY importance DESC, created_at DESC
         LIMIT 5`,
        [],
        (_err: Error | null, rows: any[]) => resolve(rows || [])
      );
    });

    // 构建摘要字符串（供 hook 注入 system prompt）
    const parts: string[] = [];

    if (wmEntries.length > 0) {
      parts.push('💬 近期工作记忆：');
      for (const entry of wmEntries) {
        const preview = entry.content.length > 150 ? entry.content.slice(0, 150) + '...' : entry.content;
        parts.push(`- [${entry.type}] ${entry.title || '(无标题)'} (重要性: ${entry.importance})\n  ${preview}`);
      }
    }

    const sortedDates = Array.from(byDate.keys()).sort().reverse();
    if (sortedDates.length > 0) {
      parts.push('');
      parts.push('📋 最近记忆摘要：');
      for (const date of sortedDates) {
        const entries = byDate.get(date)!;
        parts.push(`\n**${date}** (${entries.length} 条)`);
        for (const entry of entries) {
          const preview = entry.content.length > 120 ? entry.content.slice(0, 120) + '...' : entry.content;
          parts.push(`- [${entry.type}] ${entry.title || '(无标题)'}: ${preview}`);
        }
      }
    }

    if (parts.length === 0) return null;
    return parts.join('\n');
  }

  /** 清理低重要性工作记忆（替代 MemoryHub.cleanup 的 SQLite 版本） */
  cleanupWorkingMemory(threshold: number = 3): { deleted: number } {
    if (!this.initialized || !this.db) return { deleted: 0 };

    try {
      // 删除低重要性记录（保护最新 100 条）
      this.db.exec(`
        DELETE FROM working_memory
        WHERE importance < ${threshold}
          AND id NOT IN (
            SELECT id FROM working_memory
            ORDER BY created_at DESC LIMIT 100
          )
      `);
      const deleted = this.db.changes;
      return { deleted };
    } catch (err: any) {
      getLogger({ component: 'MemorySystem' }).warn(`cleanupWorkingMemory failed: ${err.message}`);
      return { deleted: 0 };
    }
  }
}
