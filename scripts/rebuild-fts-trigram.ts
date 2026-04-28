#!/usr/bin/env node
/**
 * 重建 FTS 索引：删除旧 virtual table，用 trigram tokenizer 重建，
 * 然后把 memory.db 中的 working_memory 和 long_term_memory 重新索引。
 */
import { createRequire } from 'module';
const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
import * as path from 'path';

const agentId = process.argv[2] || 'cortex-test-agent';
const dataDir = path.join(process.env.HOME || '', '.openclaw', 'workspace-' + agentId, 'data', agentId);
const ftsDbPath = path.join(dataDir, 'fts_index', 'fts.sqlite');
const memoryDbPath = path.join(dataDir, 'memory.db');

console.log(`📂 FTS DB: ${ftsDbPath}`);
console.log(`📂 Memory DB: ${memoryDbPath}`);

const ftsDb = new sqlite3.Database(ftsDbPath);
const memDb = new sqlite3.Database(memoryDbPath);

// 1. 删除旧 FTS5 虚拟表和辅助表
console.log('\n🗑️  删除旧 FTS 索引...');
ftsDb.serialize(() => {
  ftsDb.run('DROP TABLE IF EXISTS fts_content');
  ftsDb.run('DROP TABLE IF EXISTS fts_docs');
});

// 2. 重建 FTS5 虚拟表（trigram）
console.log('🔨 重建 FTS5 虚拟表（trigram）...');
ftsDb.serialize(() => {
  ftsDb.run(`CREATE VIRTUAL TABLE fts_content USING fts5(
    content,
    metadata,
    tokenize='trigram'
  )`);
  ftsDb.run(`CREATE TABLE IF NOT EXISTS fts_docs (
    id TEXT PRIMARY KEY,
    fts_rowid INTEGER,
    content TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
});

// 3. 从 memory.db 读取所有工作记忆和长期记忆
console.log('\n📖 从 memory.db 读取文档...');

function getAllDocs(db, tableName, idColumn) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT ${idColumn} as id, content, type, source FROM ${tableName}`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

Promise.all([
  getAllDocs(memDb, 'working_memory', 'id'),
  getAllDocs(memDb, 'long_term_memory', 'id'),
]).then(([wmDocs, ltmDocs]) => {
  const allDocs = [
    ...wmDocs.map((d: any) => ({ ...d, table: 'working_memory' })),
    ...ltmDocs.map((d: any) => ({ ...d, table: 'long_term_memory' })),
  ];
  console.log(`📄 总计 ${allDocs.length} 条文档（WM: ${wmDocs.length}, LTM: ${ltmDocs.length}）`);

  // 4. 插入 FTS 索引
  let inserted = 0;
  const insertStmt = ftsDb.prepare(`INSERT INTO fts_content(content, metadata) VALUES (?, ?)`);
  const insertDocStmt = ftsDb.prepare(`INSERT INTO fts_docs(id, fts_rowid, content, metadata_json) VALUES (?, ?, ?, ?)`);

  function insertNext(index) {
    if (index >= allDocs.length) {
      insertStmt.finalize();
      insertDocStmt.finalize();
      console.log(`\n✅ 索引完成！共插入 ${inserted} 条文档`);
      // 5. 验证
      ftsDb.get("SELECT COUNT(*) as total FROM fts_content", (err, row: any) => {
        console.log(`📊 FTS 文档总数: ${row?.total || 0}`);
        // 6. 测试中文搜索
        const testTerms = ['还记得', '重构', '测试', 'memory', '方案'];
        let done = 0;
        for (const term of testTerms) {
          ftsDb.all(`
            SELECT d.id, substr(d.content, 1, 60) as preview
            FROM fts_content
            JOIN fts_docs d ON fts_content.rowid = d.fts_rowid
            WHERE fts_content MATCH ?
            ORDER BY rank LIMIT 2
          `, [term], (err, rows: any[]) => {
            console.log(`  🔍 "${term}": ${rows?.length || 0} 结果${rows?.length ? ' — ' + rows[0]?.preview?.substring(0, 50) : ''}`);
            done++;
            if (done === testTerms.length) {
              ftsDb.close();
              memDb.close();
            }
          });
        }
      });
      return;
    }

    const doc = allDocs[index];
    const metadata = JSON.stringify({ type: doc.type || 'unknown', source: doc.table, id: doc.id });
    const content = (doc.content || '').substring(0, 10000); // 限制长度
    if (!content.trim()) {
      insertNext(index + 1);
      return;
    }

    insertStmt.run(content, metadata, function (err) {
      if (err) {
        console.error(`  ❌ 插入失败 [${doc.id}]: ${err.message}`);
        insertNext(index + 1);
        return;
      }
      const ftsRowid = this.lastID;
      insertDocStmt.run(doc.id, ftsRowid, content, metadata, (err2) => {
        if (err2) {
          console.error(`  ❌ 文档记录失败 [${doc.id}]: ${err2.message}`);
        } else {
          inserted++;
        }
        insertNext(index + 1);
      });
    });
  }

  insertNext(0);
}).catch(err => {
  console.error('❌ 错误:', err.message);
  ftsDb.close();
  memDb.close();
});
