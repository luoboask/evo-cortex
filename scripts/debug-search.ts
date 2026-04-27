import { createRequire } from 'module';
const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
import * as path from 'path';

const TEST_DIR = '/tmp/evo-cortex-debug-search';
import fs from 'fs';
if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

async function main() {
  const db = new sqlite3.Database(path.join(TEST_DIR, 'memory.db'));
  await new Promise<void>(r => db.run(`
    CREATE TABLE IF NOT EXISTS long_term_memory (
      id TEXT PRIMARY KEY, type TEXT, title TEXT, content TEXT, 
      importance REAL, recall_count INTEGER DEFAULT 0, created_at TEXT
    )
  `, r));
  
  // Insert the exact test data from round 2
  const testRows = [
    ['ltm_1', 'bugfix', '修复 FTS5 rowid', 'FTS5 表必须使用整数 rowid 映射', 8.5],
    ['ltm_2', 'decision', '向量融合搜索方案', '采用 FTS 0.4 + 向量 0.6 融合评分', 9.0],
    ['ltm_3', 'insight', '多 agent 隔离', 'sharedMemoryIndexers 使用 Map<agentId, Instance> 实现隔离', 7.5],
    ['ltm_4', 'conversation', 'EmbeddingProvider guard', 'memorySearchConfig 初始值必须是 undefined 而非 null', 8.0],
    ['ltm_5', 'preference', '用户偏好', '用户喜欢中文交互，不喜欢英文界面', 7.0],
  ];
  
  for (const row of testRows) {
    await new Promise<void>(r => db.run(
      `INSERT INTO long_term_memory (id, type, title, content, importance) VALUES (?, ?, ?, ?, ?)`,
      row, r
    ));
  }
  
  // Test "embedding null" search
  console.log('=== 测试: "embedding null" ===');
  const terms1 = ['embedding', 'null'];
  const params1 = terms1.flatMap(t => [`%${t}%`, `%${t}%`]);
  const likeClause = `(content LIKE ? OR content LIKE ? OR title LIKE ? OR title LIKE ?)`;
  
  const rows1 = await new Promise<any[]>((resolve) => {
    db.all(
      `SELECT id, title, content FROM long_term_memory WHERE ${likeClause}`,
      params1,
      (_, rows) => resolve(rows || [])
    );
  });
  console.log(`  结果: ${rows1.length} 条`);
  for (const r of rows1) {
    console.log(`    id=${r.id}, title="${r.title}", content="${r.content.substring(0, 50)}..."`);
  }
  
  // Test "agent 隔离 Map" search  
  console.log('\n=== 测试: "agent 隔离 Map" ===');
  const terms2 = ['agent', '隔离', 'Map'];
  const params2 = terms2.flatMap(t => [`%${t}%`, `%${t}%`]);
  
  const rows2 = await new Promise<any[]>((resolve) => {
    db.all(
      `SELECT id, title, content FROM long_term_memory WHERE ${likeClause}`,
      params2,
      (_, rows) => resolve(rows || [])
    );
  });
  console.log(`  结果: ${rows2.length} 条`);
  for (const r of rows2) {
    console.log(`    id=${r.id}, title="${r.title}", content="${r.content.substring(0, 50)}..."`);
  }
  
  // Debug: check what's actually in the DB
  console.log('\n=== DB 内容 ===');
  const allRows = await new Promise<any[]>((resolve) => {
    db.all(`SELECT id, title, content FROM long_term_memory`, (_, rows) => resolve(rows || []));
  });
  for (const r of allRows) {
    console.log(`  ${r.id}: title="${r.title}", content="${r.content}"`);
  }
  
  db.close();
}

main().catch(console.error);
