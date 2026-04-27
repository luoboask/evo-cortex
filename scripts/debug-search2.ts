import { createRequire } from 'module';
const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
import * as path from 'path';

const TEST_DIR = '/tmp/evo-cortex-debug-search2';
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
  
  // Test 1: "embedding null" with correct SQL
  const terms = ['embedding', 'null'];
  const contentLikes = terms.map(t => `content LIKE ?`).join(' OR ');
  const titleLikes = terms.map(t => `title LIKE ?`).join(' OR ');
  const likeClause = `(${contentLikes} OR ${titleLikes})`;
  const params = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
  
  console.log('=== LIKE clause ===');
  console.log(likeClause);
  console.log('=== params ===');
  console.log(params);
  console.log('=== params count ===');
  console.log(params.length);
  
  const sql = `SELECT id, title, content FROM long_term_memory WHERE ${likeClause}`;
  console.log('=== SQL ===');
  console.log(sql);
  
  const rows = await new Promise<any[]>((resolve) => {
    db.all(sql, params, (_, rows) => resolve(rows || []));
  });
  console.log(`=== 结果: ${rows.length} 条 ===`);
  
  // Test 2: verify LIKE '%null%' works
  console.log('\n=== Direct LIKE null ===');
  const rows2 = await new Promise<any[]>((resolve) => {
    db.all(`SELECT id, content FROM long_term_memory WHERE content LIKE '%null%'`, (_, rows) => resolve(rows || []));
  });
  console.log(`Direct LIKE '%null%': ${rows2.length} 条`);
  for (const r of rows2) {
    console.log(`  ${r.id}: "${r.content}"`);
  }
  
  // Test 3: check if 'null' in content bytes
  console.log('\n=== Check content bytes for ltm_4 ===');
  const row = await new Promise<any>((resolve) => {
    db.get(`SELECT content FROM long_term_memory WHERE id = 'ltm_4'`, (_, row) => resolve(row));
  });
  console.log(`Content: "${row?.content}"`);
  console.log(`Includes 'null': ${(row?.content || '').includes('null')}`);
  console.log(`Includes '非': ${(row?.content || '').includes('非')}`);
  console.log(`Content char codes at end: ${[...(row?.content || '')].slice(-10).map(c => c.charCodeAt(0))}`);
  
  // Test 4: check if LIKE '%null%' is the issue
  console.log('\n=== Test LIKE null param ===');
  const rows3 = await new Promise<any[]>((resolve) => {
    db.all(`SELECT id, content FROM long_term_memory WHERE content LIKE ?`, ['%null%'], (_, rows) => resolve(rows || []));
  });
  console.log(`Param LIKE: ${rows3.length} 条`);
  
  // Test 5: "agent 隔离 Map"
  console.log('\n=== Test "agent 隔离 Map" ===');
  const terms2 = ['agent', '隔离', 'Map'];
  const contentLikes2 = terms2.map(t => `content LIKE ?`).join(' OR ');
  const titleLikes2 = terms2.map(t => `title LIKE ?`).join(' OR ');
  const likeClause2 = `(${contentLikes2} OR ${titleLikes2})`;
  const params2 = terms2.flatMap(t => [`%${t}%`, `%${t}%`]);
  console.log('SQL:', `SELECT id, title FROM long_term_memory WHERE ${likeClause2}`);
  console.log('Params:', params2);
  const rows4 = await new Promise<any[]>((resolve) => {
    db.all(`SELECT id, title, content FROM long_term_memory WHERE ${likeClause2}`, params2, (_, rows) => resolve(rows || []));
  });
  console.log(`Results: ${rows4.length} 条`);
  for (const r of rows4) {
    console.log(`  ${r.id}: title="${r.title}"`);
  }
  
  db.close();
}

main().catch(console.error);
