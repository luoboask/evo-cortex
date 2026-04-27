/**
 * 数据迁移脚本 — 从 cortex.db 迁移到 memory.db 和 knowledge.db
 *
 * Phase 1 已手动执行，此脚本保留供参考和验证使用。
 *
 * 用法：npx tsx scripts/migrate.ts [agentId]
 * 默认 agentId: cortex-test-agent
 */

import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();

const agentId = process.argv[2] || 'cortex-test-agent';
const workspaceDir = path.join(process.env.HOME || '', '.openclaw', `workspace-${agentId}`);
const dataDir = path.join(workspaceDir, 'data', agentId);

const cortexDbPath = path.join(dataDir, 'cortex.db');
const memoryDbPath = path.join(dataDir, 'memory.db');
const knowledgeDbPath = path.join(dataDir, 'knowledge.db');

async function main() {
  console.log(`=== evo-cortex 数据迁移 ===`);
  console.log(`Agent: ${agentId}`);
  console.log(`Data dir: ${dataDir}`);
  console.log('');

  // 检查源数据库
  if (!fs.existsSync(cortexDbPath)) {
    console.error(`❌ cortex.db 不存在: ${cortexDbPath}`);
    process.exit(1);
  }

  // 检查目标数据库是否已存在
  const memoryExists = fs.existsSync(memoryDbPath);
  const knowledgeExists = fs.existsSync(knowledgeDbPath);

  if (memoryExists && knowledgeExists) {
    console.log('✅ memory.db 和 knowledge.db 已存在，跳过迁移');
    // 验证数据
    await verifyMigration();
    return;
  }

  // 创建目标目录
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 迁移 working_memory
  if (!memoryExists) {
    console.log('📦 迁移 working_memory...');
    await migrateWorkingMemory();
  }

  // 迁移 knowledge
  if (!knowledgeExists) {
    console.log('📦 迁移 knowledge...');
    await migrateKnowledge();
  }

  // 验证
  await verifyMigration();
}

async function migrateWorkingMemory() {
  const srcDb = new sqlite3.Database(cortexDbPath);
  const dstDb = new sqlite3.Database(memoryDbPath);

  // 创建目标表
  await runStmt(dstDb, `
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
  `);

  await runStmt(dstDb, `
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
  `);

  await runStmt(dstDb, `
    CREATE TABLE IF NOT EXISTS consolidation_log (
      id              TEXT PRIMARY KEY,
      working_id      TEXT NOT NULL,
      long_term_id    TEXT NOT NULL,
      reason          TEXT,
      importance      REAL,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // 从 cortex.db 读取 working_memory 并迁移
  const rows = await allStmt(srcDb, `SELECT * FROM working_memory`);
  console.log(`  找到 ${rows.length} 条 working_memory 记录`);

  const insertStmt = dstDb.prepare(`
    INSERT OR IGNORE INTO working_memory (id, type, title, content, importance, tags, source, source_ref, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    insertStmt.run(
      row.id || `wm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      row.type || 'conversation',
      row.title || '',
      row.content,
      row.importance || 5.0,
      row.tags || '[]',
      row.source || 'scan',
      row.session_id || null, // session_id → source_ref
      row.created_at || new Date().toISOString(),
      row.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    );
  }

  insertStmt.finalize();

  // 创建索引
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_wm_expires ON working_memory(expires_at)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_wm_importance ON working_memory(importance DESC)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_ltm_importance ON long_term_memory(importance DESC)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_ltm_recall ON long_term_memory(recalled_at)`);

  srcDb.close();
  dstDb.close();

  console.log(`  ✅ 迁移完成`);
}

async function migrateKnowledge() {
  const srcDb = new sqlite3.Database(cortexDbPath);
  const dstDb = new sqlite3.Database(knowledgeDbPath);

  // 创建目标表
  await runStmt(dstDb, `
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
    )
  `);

  await runStmt(dstDb, `
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
    )
  `);

  await runStmt(dstDb, `
    CREATE TABLE IF NOT EXISTS rules (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL DEFAULT 'pattern',
      title           TEXT NOT NULL DEFAULT '',
      condition       TEXT,
      action          TEXT NOT NULL DEFAULT '',
      confidence      REAL DEFAULT 0.5,
      support_count   INTEGER DEFAULT 0,
      violation_count INTEGER DEFAULT 0,
      used_count      INTEGER DEFAULT 0,
      last_used       TEXT,
      last_validated  TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  await runStmt(dstDb, `
    CREATE TABLE IF NOT EXISTS entity_ltm_links (
      entity_id  TEXT NOT NULL,
      ltm_id     TEXT NOT NULL,
      role       TEXT DEFAULT 'context',
      PRIMARY KEY (entity_id, ltm_id)
    )
  `);

  // 创建索引
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_entities_importance ON entities(importance DESC)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type)`);
  await runStmt(dstDb, `CREATE INDEX IF NOT EXISTS idx_rules_confidence ON rules(confidence DESC)`);

  srcDb.close();
  dstDb.close();

  console.log(`  ✅ 知识数据库结构创建完成`);
}

async function verifyMigration() {
  if (!fs.existsSync(memoryDbPath) || !fs.existsSync(knowledgeDbPath)) {
    console.log('❌ 迁移未完成');
    return;
  }

  const memDb = new sqlite3.Database(memoryDbPath);
  const knDb = new sqlite3.Database(knowledgeDbPath);

  // 统计
  const wmCount = await getStmt(memDb, `SELECT COUNT(*) as cnt FROM working_memory`);
  const ltmCount = await getStmt(memDb, `SELECT COUNT(*) as cnt FROM long_term_memory`);
  const entCount = await getStmt(knDb, `SELECT COUNT(*) as cnt FROM entities`);
  const relCount = await getStmt(knDb, `SELECT COUNT(*) as cnt FROM relations`);
  const ruleCount = await getStmt(knDb, `SELECT COUNT(*) as cnt FROM rules`);

  console.log('');
  console.log('=== 迁移验证 ===');
  console.log(`working_memory: ${wmCount.cnt} 条`);
  console.log(`long_term_memory: ${ltmCount.cnt} 条`);
  console.log(`entities: ${entCount.cnt} 个`);
  console.log(`relations: ${relCount.cnt} 条`);
  console.log(`rules: ${ruleCount.cnt} 条`);
  console.log('');
  console.log('✅ 迁移验证完成');

  memDb.close();
  knDb.close();
}

// ========== 辅助函数 ==========

function runStmt(db: any, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function allStmt(db: any, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: any[]) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function getStmt(db: any, sql: string): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(sql, (err: Error | null, row: any) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

main().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
