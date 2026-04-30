/**
 * KnowledgeSystem — 知识体系 (Phase 2)
 *
 * 基于 knowledge.db 的知识图谱：
 * - entities：实体（带重要性、提及次数、衰减）
 * - relations：关系（带强度、证据、衰减）
 * - rules：规则（带置信度、支持/违反计数）
 * - entity_ltm_links：实体与长期记忆的关联
 *
 * 核心功能：
 * - 从长期记忆更新知识（实体提取、关系发现、规则评估）
 * - 实体/关系/规则搜索
 * - 衰减更新（长期未提及的实体/关系自动降权）
 * - 规则验证（置信度过低标记过时，过高标记核心）
 *
 * ESM 兼容：sqlite3 通过 createRequire 加载
 */

import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();

// ========== 类型定义 ==========

export interface KnowledgeEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
  aliases?: string[];
  importance: number;
  mentionCount: number;
  lastMentioned?: string;
  firstSeenFrom?: string;
  createdAt: string;
}

export interface KnowledgeRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  strength: number;
  evidence?: string[];
  usedCount: number;
  lastUsed?: string;
  createdAt: string;
}

export interface KnowledgeRule {
  id: string;
  type: string;
  title: string;
  condition?: string;
  action: string;
  confidence: number;
  supportCount: number;
  violationCount: number;
  usedCount: number;
  lastUsed?: string;
  lastValidated?: string;
  createdAt: string;
}

export interface SearchQuery {
  text: string;
  types?: string[];
  minImportance?: number;
  limit?: number;
}

// ========== 兼容旧 knowledge_graph.ts 的类型 ==========

export interface KnowledgeConfig {
  enabled: boolean;
  auto_expand: boolean;
}

export interface KnowledgeSearchResult {
  entity: KnowledgeEntity;
  relations: KnowledgeRelation[];
  score: number;
}

// ========== 实体类型关键词映射 ==========

const ENTITY_TYPE_KEYWORDS: Record<string, RegExp[]> = {
  technology: [
    /\b(React|Vue|Angular|Node\.?js|TypeScript|JavaScript|Python|Go|Rust|Java|Kotlin|Swift)\b/,
    /\b(Docker|Kubernetes|AWS|GCP|Azure|Vercel|Netlify)\b/,
    /\b(REST|GraphQL|gRPC|WebSocket|HTTP\/2)\b/,
    /\b(PostgreSQL|MySQL|Redis|MongoDB|SQLite|Elasticsearch|SQLite3)\b/,
    // 数据库/搜索相关：FTS5、B-tree、WAL 等
    /\b(FTS[0-9]?|Full-Text Search|B-tree|WAL|rowid)\b/,
  ],
  concept: [
    /\b(架构|设计模式|最佳实践|重构|测试|部署|CI\/CD|DevOps)\b/,
    /\b(microservice|monolith|serverless|edge computing)\b/,
    // 通用技术概念：隔离、融合、晋升、衰减等中文术语（2+ 字技术词）
    /\b(隔离|融合|晋升|衰减|向量|嵌入|索引|缓存|单例|并发|原子|事务)\b/,
  ],
  person: [
    /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/, // 英文人名
  ],
  tool: [
    /\b(vscode|vim|git|npm|yarn|pnpm|webpack|vite|esbuild)\b/,
    /\b(OpenClaw|evo-cortex|lossless-claw)\b/,
    // 代码级驼峰标识符：首字母小写，中间至少一个大写，总长 >= 8
    /\b[a-z]+[A-Z][a-zA-Z]{2,}\b/g,
  ],
  config: [
    // 配置键/环境变量/标志位：memorySearchConfig、timeoutSeconds 等（驼峰+长度>=8）
    /\b[a-z]+[A-Z][a-zA-Z]{2,}(?:Config|Seconds|Timeout|Provider|Builder|Scanner|System|Index|Manager)\b/g,
  ],
};

// 常见停用词（不提取为实体）
const STOP_WORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where', 'Which', 'Who', 'Why',
  'How', 'Have', 'Has', 'Had', 'Will', 'Would', 'Could', 'Should', 'Can', 'May', 'Must',
  'Please', 'Thank', 'Hello', 'Good', 'Yes', 'No', 'Not', 'Also', 'Just', 'Very',
  'More', 'Most', 'Less', 'Least', 'Much', 'Many', 'Some', 'Any', 'All', 'Each',
  'Every', 'Both', 'Either', 'Neither', 'Other', 'Another', 'Such', 'Only', 'Same',
  'Own', 'Back', 'Front', 'Left', 'Right', 'Top', 'Bottom', 'First', 'Last', 'Next',
  'Old', 'New', 'High', 'Low', 'Big', 'Small', 'Long', 'Short', 'Fast', 'Slow',
  'Hard', 'Easy', 'Real', 'True', 'False', 'Free', 'Full', 'Half', 'Early', 'Late',
  'Like', 'Make', 'Take', 'Come', 'Go', 'See', 'Know', 'Think', 'Say', 'Get', 'Give',
  'Find', 'Tell', 'Ask', 'Work', 'Try', 'Use', 'Call', 'Keep', 'Let', 'Begin', 'Show',
  'Hear', 'Play', 'Run', 'Move', 'Live', 'Believe', 'Hold', 'Bring', 'Happen', 'Write',
  'Provide', 'Sit', 'Stand', 'Lose', 'Pay', 'Meet', 'Include', 'Continue', 'Set', 'Learn',
  'Change', 'Lead', 'Understand', 'Watch', 'Follow', 'Stop', 'Create', 'Speak', 'Read',
  'Allow', 'Add', 'Spend', 'Grow', 'Open', 'Walk', 'Win', 'Offer', 'Remember', 'Love',
  'Consider', 'Appear', 'Buy', 'Wait', 'Serve', 'Die', 'Send', 'Expect', 'Build', 'Stay',
  'Fall', 'Cut', 'Reach', 'Kill', 'Remain', 'Suggest', 'Raise', 'Pass', 'Sell', 'Require',
  'Report', 'Decide', 'Pull', 'from', 'with', 'about', 'after', 'before', 'into', 'upon',
  'over', 'under', 'between', 'through', 'during', 'without', 'within', 'along', 'across',
  'behind', 'beyond', 'below', 'above', 'here', 'there',
]);

// ========== KnowledgeSystem ==========

export class KnowledgeSystem {
  private db: any;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(agentId: string, dataDir: string) {
    this.dbPath = path.join(dataDir, agentId, 'knowledge.db');
  }

  /** 初始化数据库 */
  async init(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise<void>((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err: Error | null) => {
        if (err) {
          reject(new Error(`KnowledgeSystem init failed: ${err.message}`));
          return;
        }
        this.db.run('PRAGMA journal_mode=WAL', () => {});
        this.db.run('PRAGMA busy_timeout=5000', () => {
          // 自愈建表 — 保证新 agent 或 DB 被删后自动重建（幂等）
          this.db.run(`
            CREATE TABLE IF NOT EXISTS entities (
              id            TEXT PRIMARY KEY,
              name          TEXT NOT NULL,
              type          TEXT NOT NULL DEFAULT 'concept',
              description   TEXT,
              aliases       TEXT DEFAULT '[]',
              importance    REAL DEFAULT 0.5,
              mention_count INTEGER DEFAULT 0,
              last_mentioned TEXT,
              first_seen_from TEXT,
              created_at    TEXT DEFAULT (datetime('now'))
            )`, () => {});
          this.db.run(`
            CREATE TABLE IF NOT EXISTS relations (
              id          TEXT PRIMARY KEY,
              source_id   TEXT NOT NULL,
              target_id   TEXT NOT NULL,
              type        TEXT NOT NULL DEFAULT 'related',
              strength    REAL DEFAULT 0.5,
              evidence    TEXT DEFAULT '[]',
              used_count  INTEGER DEFAULT 0,
              last_used   TEXT,
              created_at  TEXT DEFAULT (datetime('now')),
              UNIQUE(source_id, target_id, type)
            )`, () => {});
          this.db.run(`
            CREATE TABLE IF NOT EXISTS rules (
              id            TEXT PRIMARY KEY,
              type          TEXT NOT NULL DEFAULT 'pattern',
              title         TEXT NOT NULL DEFAULT '',
              condition     TEXT,
              action        TEXT NOT NULL DEFAULT '',
              confidence    REAL DEFAULT 0.5,
              support_count INTEGER DEFAULT 0,
              violation_count INTEGER DEFAULT 0,
              used_count    INTEGER DEFAULT 0,
              last_used     TEXT,
              last_validated TEXT,
              created_at    TEXT DEFAULT (datetime('now'))
            )`, () => {});
          this.db.run(`
            CREATE TABLE IF NOT EXISTS entity_ltm_links (
              entity_id  TEXT NOT NULL,
              ltm_id     TEXT NOT NULL,
              role       TEXT DEFAULT 'context',
              PRIMARY KEY (entity_id, ltm_id)
            )`, () => {});
          this.db.run(`
            CREATE TABLE IF NOT EXISTS preferences (
              id          TEXT PRIMARY KEY,
              category    TEXT NOT NULL,
              value       TEXT NOT NULL,
              confidence  REAL DEFAULT 0.5,
              source      TEXT,
              created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
              updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )`, () => {});
          this.db.run('CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)', () => {});
          this.db.run('CREATE INDEX IF NOT EXISTS idx_entities_importance ON entities(importance DESC)', () => {});
          this.db.run('CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id)', () => {});
          this.db.run('CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id)', () => {});
          this.db.run('CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type)', () => {});
          this.db.run('CREATE INDEX IF NOT EXISTS idx_rules_confidence ON rules(confidence DESC)', () => {
            this.initialized = true;
            resolve();
          });
        });
      });
    });
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

  // ========== 从长期记忆更新知识 ==========

  /**
   * 从长期记忆更新知识体系
   * 1. 从 long_term_memory 读取
   * 2. 实体提取
   * 3. 实体 upsert
   * 4. entity_ltm_links 写入
   * 5. 关系发现（共现分析）
   * 6. 规则评估
   */
  async updateFromLTM(ltmId: string, memoryDb: any): Promise<void> {
    await this.ensureInit();

    // 1. 读取长期记忆内容
    const ltm = await this.getLTMById(ltmId, memoryDb);
    if (!ltm) return;

    // 2. 实体提取
    const entities = this.extractEntities(ltm.content);
    if (entities.length === 0) return;

    // 3. 实体 upsert + 4. entity_ltm_links
    const entityIds: string[] = [];
    for (const entity of entities) {
      const id = await this.upsertEntity(entity, ltmId);
      entityIds.push(id);
    }

    // 5. 关系发现（共现分析）
    await this.discoverRelations(entityIds, ltmId);

    // 6. 规则评估
    await this.evaluateRules(ltm, memoryDb);
  }

  /** 从 memory.db 读取长期记忆 */
  private getLTMById(ltmId: string, memoryDb: any): Promise<any> {
    return new Promise((resolve) => {
      memoryDb.get(
        `SELECT id, type, title, content, importance, tags FROM long_term_memory WHERE id = ?`,
        [ltmId],
        (err: Error | null, row: any) => {
          if (err || !row) resolve(null);
          else resolve(row);
        }
      );
    });
  }

  // ========== 实体提取 ==========

  /**
   * Phase 1: 简单关键词匹配
   * 提取: 大写英文词, 技术术语, 中文关键词
   * 返回标准化实体列表
   */
  extractEntities(content: string): Array<{ id: string; name: string; type: string; role: string }> {
    const entities = new Map<string, { name: string; type: string; role: string }>();

    // 1. 技术术语匹配（按类型分类）
    for (const [type, patterns] of Object.entries(ENTITY_TYPE_KEYWORDS)) {
      for (const pattern of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          for (const match of matches) {
            const normalized = match.trim();
            if (normalized.length > 1 && !STOP_WORDS.has(normalized)) {
              const key = normalized.toLowerCase();
              if (!entities.has(key)) {
                entities.set(key, { name: normalized, type, role: 'context' });
              }
            }
          }
        }
      }
    }

    // 2. 大写英文词提取（驼峰/全大写缩写）
    const camelMatches = content.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
    if (camelMatches) {
      for (const match of camelMatches) {
        const key = match.toLowerCase();
        if (!entities.has(key) && !STOP_WORDS.has(match)) {
          entities.set(key, { name: match, type: 'concept', role: 'context' });
        }
      }
    }

    // 3. 全大写缩写（2-6 字母）
    const acronymMatches = content.match(/\b[A-Z]{2,6}\b/g);
    if (acronymMatches) {
      for (const match of acronymMatches) {
        const key = match.toLowerCase();
        if (!entities.has(key)) {
          entities.set(key, { name: match, type: 'concept', role: 'context' });
        }
      }
    }

    // 4. 中文关键词提取（4-20 字连续中文，排除常见停用词）
    const chineseMatches = content.match(/[\u4e00-\u9fff]{4,20}/g);
    if (chineseMatches) {
      const chineseStopWords = new Set([
        '我们可以', '他们', '这个', '那个', '这些', '那些', '因为', '所以',
        '如果', '但是', '虽然', '然而', '因此', '然后', '接着', '首先',
        '最后', '总之', '大概', '可能', '应该', '必须', '需要', '可以',
        '能够', '已经', '正在', '将会', '曾经', '现在', '未来', '过去',
        '这里', '那里', '哪里', '什么', '怎么', '如何', '为什么', '多少',
      ]);
      for (const match of chineseMatches) {
        if (chineseStopWords.has(match)) continue;
        const key = match;
        if (!entities.has(key)) {
          entities.set(key, { name: match, type: 'concept', role: 'context' });
        }
      }
    }

    // 转换为带 ID 的实体列表
    return Array.from(entities.values()).map(e => ({
      id: `ent_${e.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_')}`,
      name: e.name,
      type: e.type,
      role: e.role,
    }));
  }

  // ========== 实体 upsert ==========

  /**
   * INSERT OR REPLACE INTO entities
   * mention_count++
   */
  private async upsertEntity(entity: { id: string; name: string; type: string; role: string }, ltmId: string): Promise<string> {
    const now = new Date().toISOString();

    // 先检查是否存在
    const existing = await this.getEntityById(entity.id);
    if (existing) {
      // 更新：mention_count++, last_mentioned
      await this.runAsync(
        `UPDATE entities SET mention_count = mention_count + 1, last_mentioned = ? WHERE id = ?`,
        [now, entity.id]
      );
    } else {
      // 插入新实体
      await this.runAsync(
        `INSERT INTO entities (id, name, type, importance, mention_count, last_mentioned, first_seen_from, created_at)
         VALUES (?, ?, ?, 0.5, 1, ?, ?, ?)`,
        [entity.id, entity.name, entity.type, now, ltmId, now]
      );
    }

    // entity_ltm_links
    await this.runAsync(
      `INSERT OR IGNORE INTO entity_ltm_links (entity_id, ltm_id, role) VALUES (?, ?, ?)`,
      [entity.id, ltmId, entity.role]
    );

    return entity.id;
  }

  /** 根据 ID 获取实体 */
  private getEntityById(id: string): Promise<any> {
    return new Promise((resolve) => {
      this.db.get(`SELECT * FROM entities WHERE id = ?`, [id], (err: Error | null, row: any) => {
        if (err || !row) resolve(null);
        else resolve(row);
      });
    });
  }

  /**
   * 打开或复用另一个数据库连接（用于跨库查询）
   * MemorySystem 调用 updateFromLTM 时传入 memory.db 的句柄
   */
  static openMemoryDb(dbPath: string): any {
    return new sqlite3.Database(dbPath);
  }

  /** 安全关闭数据库连接 */
  static closeDb(db: any): void {
    try { db.close(); } catch { /* ignore */ }
  }

  // ========== 关系发现 ==========

  /**
   * 共现分析：同事件中出现的实体两两组合
   * - 如果已存在：strength += 0.1, evidence 追加
   * - 如果不存在：INSERT strength=0.3
   */
  private async discoverRelations(entityIds: string[], ltmId: string): Promise<void> {
    if (entityIds.length < 2) return;

    const now = new Date().toISOString();

    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const sourceId = entityIds[i];
        const targetId = entityIds[j];

        // 确保 sourceId < targetId（无向图）
        const [s, t] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];

        const existing = await this.getRelation(s, t);
        if (existing) {
          // 增强已有关系
          const newStrength = Math.min(existing.strength + 0.1, 1.0);
          const evidence = JSON.parse(existing.evidence || '[]');
          if (!evidence.includes(ltmId)) {
            evidence.push(ltmId);
          }
          await this.runAsync(
            `UPDATE relations SET strength = ?, evidence = ?, last_used = ? WHERE id = ?`,
            [newStrength, JSON.stringify(evidence), now, existing.id]
          );
        } else {
          // 插入新关系
          const relId = `rel_${s}_${t}_${Date.now()}`;
          await this.runAsync(
            `INSERT INTO relations (id, source_id, target_id, type, strength, evidence, created_at)
             VALUES (?, ?, ?, 'co_occurs', 0.3, ?, ?)`,
            [relId, s, t, JSON.stringify([ltmId]), now]
          );
        }
      }
    }
  }

  /** 获取两个实体间的关系 */
  private getRelation(sourceId: string, targetId: string): Promise<any> {
    return new Promise((resolve) => {
      this.db.get(
        `SELECT * FROM relations WHERE source_id = ? AND target_id = ?`,
        [sourceId, targetId],
        (err: Error | null, row: any) => {
          if (err || !row) resolve(null);
          else resolve(row);
        }
      );
    });
  }

  // ========== 规则评估 ==========

  /**
   * 规则评估：从长期记忆中发现模式，生成规则。
   *
   * 策略（替代原来的按 ltm.type 粗分组）：
   * 1. 基于实体共现频率：同一组实体频繁一起出现 → 生成关联规则
   * 2. 基于记忆类型统计：按 type 统计后生成行为模式规则（不再仅看 conversation）
   * 3. 基于关键词密度：某类关键词在多条记忆中反复出现 → 生成关注规则
   *
   * >= 3 次 → 生成或更新规则
   * confidence = support / (support + violation + 1)
   */
  private async evaluateRules(ltm: any, memoryDb: any): Promise<void> {
    await this.ensureInit();
    if (!ltm || !ltm.content) return;

    // --- 策略 1: 按类型统计（改进版，按不同 type 分别统计）---
    const typeStats = await new Promise<any[]>((resolve) => {
      memoryDb.all(
        `SELECT type, COUNT(*) as cnt FROM long_term_memory GROUP BY type HAVING cnt >= 3`,
        [],
        (_err: Error | null, rows: any[]) => {
          resolve(rows || []);
        }
      );
    });

    for (const stat of typeStats) {
      const type = stat.type;
      const existingRule = await new Promise<any>((resolve) => {
        this.db.get(
          `SELECT * FROM rules WHERE type = ? AND title LIKE ?`,
          [type, `%${type}%`],
          (_err: Error | null, row: any) => {
            resolve(row || null);
          }
        );
      });

      if (existingRule) {
        await this.runAsync(
          `UPDATE rules SET support_count = support_count + 1, confidence = (support_count + 1) * 1.0 / (support_count + violation_count + 2) WHERE id = ?`,
          [existingRule.id]
        );
      } else {
        const ruleId = `rule_type_${type}_${Date.now()}`;
        const now = new Date().toISOString();
        await this.runAsync(
          `INSERT INTO rules (id, type, title, action, confidence, support_count, created_at)
           VALUES (?, 'pattern', '频繁出现: ${type}', '关注此类型模式', 0.6, ?, ?)`,
          [ruleId, stat.cnt, now]
        );
      }
    }

    // --- 策略 2: 从当前 LTM 内容中提取模式关键词 ---
    // 检测是否包含高频技术术语组合，生成关联规则提示
    const entities = this.extractEntities(ltm.content);
    if (entities.length >= 2) {
      // 取前 3 个实体组合成关联规则线索（不直接插入关系，仅记录为规则候选）
      const keyEntities = entities.slice(0, 3).map(e => e.name).join(' + ');
      const ruleSearchTerm = `%${keyEntities.slice(0, 50)}%`;
      const existingPattern = await new Promise<any>((resolve) => {
        this.db.get(
          `SELECT * FROM rules WHERE title LIKE ? AND type = 'pattern_candidate'`,
          [ruleSearchTerm],
          (_err: Error | null, row: any) => {
            resolve(row || null);
          }
        );
      });

      if (existingPattern) {
        await this.runAsync(
          `UPDATE rules SET support_count = support_count + 1, confidence = MIN(confidence + 0.1, 1.0) WHERE id = ?`,
          [existingPattern.id]
        );
      } else {
        const ruleId = `rule_pattern_${Date.now()}`;
        const now = new Date().toISOString();
        await this.runAsync(
          `INSERT INTO rules (id, type, title, action, confidence, support_count, created_at)
           VALUES (?, 'pattern_candidate', '实体关联: ${keyEntities}', '待验证共现模式', 0.5, 1, ?)`,
          [ruleId, now]
        );
      }
    }
  }

  // ========== 搜索实体 ==========

  /** FTS 或 LIKE 搜索 entities */
  async searchEntities(query: string): Promise<KnowledgeEntity[]> {
    await this.ensureInit();

    const searchTerm = `%${query}%`;

    return new Promise<KnowledgeEntity[]>((resolve, _reject) => {
      this.db.all(
        `SELECT * FROM entities WHERE name LIKE ? OR description LIKE ? OR type LIKE ?
         ORDER BY importance DESC, mention_count DESC
         LIMIT 20`,
        [searchTerm, searchTerm, searchTerm],
        (err: Error | null, rows: any[]) => {
          if (err) {
            resolve([]);
            return;
          }
          resolve(rows.map(this.mapEntityRow));
        }
      );
    });
  }

  // ========== 搜索关系 ==========

  /** 搜索 relations + entities 关联 */
  async searchRelations(query: SearchQuery): Promise<any[]> {
    await this.ensureInit();

    const searchTerm = `%${query.text}%`;
    const limit = query.limit || 20;

    return new Promise<any[]>((resolve, _reject) => {
      this.db.all(
        `SELECT r.*,
          s.name as source_name, s.type as source_type,
          t.name as target_name, t.type as target_type
         FROM relations r
         JOIN entities s ON r.source_id = s.id
         JOIN entities t ON r.target_id = t.id
         WHERE r.type LIKE ? OR s.name LIKE ? OR t.name LIKE ?
         ORDER BY r.strength DESC
         LIMIT ?`,
        [searchTerm, searchTerm, searchTerm, limit],
        (err: Error | null, rows: any[]) => {
          if (err) {
            resolve([]);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  // ========== 搜索规则 ==========

  /** 搜索 rules */
  async searchRules(query: string): Promise<KnowledgeRule[]> {
    await this.ensureInit();

    const searchTerm = `%${query}%`;

    return new Promise<KnowledgeRule[]>((resolve, _reject) => {
      this.db.all(
        `SELECT * FROM rules WHERE title LIKE ? OR type LIKE ? OR action LIKE ?
         ORDER BY confidence DESC
         LIMIT 20`,
        [searchTerm, searchTerm, searchTerm],
        (err: Error | null, rows: any[]) => {
          if (err) {
            resolve([]);
            return;
          }
          resolve(rows.map(this.mapRuleRow));
        }
      );
    });
  }

  // ========== 衰减更新 ==========

  /**
   * entities: importance *= 0.95 WHERE 30天未提及
   * relations: strength *= 0.9 WHERE 60天无新证据
   */
  async runDecayUpdates(): Promise<void> {
    await this.ensureInit();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // 实体衰减
    await this.runAsync(
      `UPDATE entities SET importance = MAX(importance * 0.95, 0.01) WHERE last_mentioned < ? OR last_mentioned IS NULL`,
      [thirtyDaysAgo]
    );

    // 关系衰减
    await this.runAsync(
      `UPDATE relations SET strength = MAX(strength * 0.9, 0.01) WHERE last_used < ? OR last_used IS NULL`,
      [sixtyDaysAgo]
    );
  }

  // ========== 规则验证 ==========

  /**
   * confidence < 0.4 → 标记过时
   * confidence > 0.8 → 标记核心规则
   */
  async validateRules(): Promise<{ stale: number; core: number }> {
    await this.ensureInit();

    const now = new Date().toISOString();

    // 标记过时规则
    const staleResult = await this.runAsyncResult(
      `UPDATE rules SET last_validated = ? WHERE confidence < 0.4`,
      [now]
    );

    // 标记核心规则
    const coreResult = await this.runAsyncResult(
      `UPDATE rules SET last_validated = ? WHERE confidence > 0.8`,
      [now]
    );

    return {
      stale: staleResult.changes || 0,
      core: coreResult.changes || 0,
    };
  }

  // ========== 统计信息 ==========

  async getStats(): Promise<{
    entities: number;
    relations: number;
    rules: number;
    entityLinks: number;
    byType: Record<string, number>;
  }> {
    await this.ensureInit();

    const byTypeRow = await new Promise<Record<string, number>>((resolve) => {
      this.db.all(`SELECT type, COUNT(*) as cnt FROM entities GROUP BY type`, [], (_err: Error | null, rows: any[]) => {
        const result: Record<string, number> = {};
        if (rows) {
          for (const row of rows) {
            result[row.type] = row.cnt;
          }
        }
        resolve(result);
      });
    });

    const counts = await new Promise<any>((resolve) => {
      this.db.get(
        `SELECT
          (SELECT COUNT(*) FROM entities) as entities,
          (SELECT COUNT(*) FROM relations) as relations,
          (SELECT COUNT(*) FROM rules) as rules,
          (SELECT COUNT(*) FROM entity_ltm_links) as entityLinks`,
        [],
        (_err: Error | null, row: any) => {
          resolve(row || { entities: 0, relations: 0, rules: 0, entityLinks: 0 });
        }
      );
    });

    return { ...counts, byType: byTypeRow };
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

  private runAsyncResult(sql: string, params: any[]): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this.db.run(sql, params, function (this: any, err: Error | null) {
        if (err) reject(err);
        else resolve({ changes: this?.changes || 0 });
      });
    });
  }

  private mapEntityRow(row: any): KnowledgeEntity {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description || undefined,
      aliases: this.safeJsonParse(row.aliases),
      importance: row.importance,
      mentionCount: row.mention_count,
      lastMentioned: row.last_mentioned || undefined,
      firstSeenFrom: row.first_seen_from || undefined,
      createdAt: row.created_at,
    };
  }

  private mapRuleRow(row: any): KnowledgeRule {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      condition: row.condition || undefined,
      action: row.action,
      confidence: row.confidence,
      supportCount: row.support_count,
      violationCount: row.violation_count,
      usedCount: row.used_count,
      lastUsed: row.last_used || undefined,
      lastValidated: row.last_validated || undefined,
      createdAt: row.created_at,
    };
  }

  private safeJsonParse(val: any): string[] {
    if (!val) return [];
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
