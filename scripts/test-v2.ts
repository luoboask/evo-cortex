/**
 * 快速验证脚本 — 测试 evo-cortex 重构后核心功能
 * 用法: npx tsx scripts/test-v2.ts
 */
import { MemorySystem } from '../src/memory/memory_system.js';
import { KnowledgeSystem } from '../src/knowledge/knowledge_system.js';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const testDbDir = '/tmp/evo-cortex-test-v2';

// 清理旧数据
if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true });
fs.mkdirSync(testDbDir, { recursive: true });

async function main() {
  console.log('=== evo-cortex v2 快速验证 ===\n');

  // --- 测试 1: init() 自动建表（从零启动）---
  console.log('[1/5] init() 自动建表...');
  const ms = new MemorySystem('test-agent', testDbDir);
  const ks = new KnowledgeSystem('test-agent', testDbDir);
  await ms.init();
  await ks.init();
  console.log('  ✅ MemorySystem.init() 成功');
  console.log('  ✅ KnowledgeSystem.init() 成功');

  // 验证表确实存在
  const db = new sqlite3.Database(path.join(testDbDir, 'test-agent', 'memory.db'));
  const tables = await new Promise<any[]>((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => err ? reject(err) : resolve(rows));
  });
  const tableNames = tables.map(t => t.name).sort();
  console.log(`  memory.db 表: ${tableNames.join(', ')}`);
  const expectedTables = ['working_memory', 'long_term_memory', 'consolidation_log'];
  const hasAllTables = expectedTables.every(t => tableNames.includes(t));
  console.log(hasAllTables ? '  ✅ 所有表自动创建' : `  ❌ 缺少表: ${expectedTables.filter(t => !tableNames.includes(t)).join(', ')}`);
  db.close();

  // --- 测试 2: record() 写入 working_memory ---
  console.log('\n[2/5] record() 写入 working_memory...');
  const entryId = await ms.record({
    type: 'conversation',
    title: '测试对话',
    content: '这是一条测试消息，用于验证 record 功能',
    importance: 8.0,  // 必须 >= 7.0 才能被 consolidate 晋升
    tags: ['test', 'v2'],
    source: 'test',
    sourceRef: 'test-session-001'
  });
  console.log(`  ✅ 写入成功, id=${entryId}`);

  // --- 测试 3: search() 检索 ---
  console.log('\n[3/5] search() 检索...');
  const results = await ms.search({ text: '测试消息', limit: 5 });
  console.log(`  ✅ 搜索返回 ${results.length} 条结果`);
  if (results.length > 0) {
    console.log(`  最佳匹配: ${results[0].content?.substring(0, 40)}...`);
  }

  // --- 测试 4: consolidate() + onPromoted 回调 ---
  console.log('\n[4/5] consolidate() + onPromoted 回调...');
  // 先把刚写入的条目设为过期
  const wmDb = new sqlite3.Database(path.join(testDbDir, 'test-agent', 'memory.db'));
  await new Promise<void>((resolve, reject) => {
    wmDb.run("UPDATE working_memory SET expires_at = datetime('now', '-1 day') WHERE id = ?", [entryId], (err) => err ? reject(err) : resolve());
  });
  wmDb.close();

  let callbackFired = 0;
  const result = await ms.consolidate({
    onPromoted: async (ltmId, row) => {
      callbackFired++;
      console.log(`  📢 onPromoted 回调触发: ltmId=${ltmId.substring(0, 25)}..., row.id=${row.id}`);
    }
  });
  console.log(`  ✅ 晋升 ${result.promoted} 条, 回调触发 ${callbackFired} 次`);

  // 验证 working_memory 已清空, long_term_memory 有数据
  const memDb = new sqlite3.Database(path.join(testDbDir, 'test-agent', 'memory.db'));
  const wmCount = await new Promise<number>((resolve, reject) => {
    memDb.get("SELECT COUNT(*) as cnt FROM working_memory", (err, row: any) => err ? reject(err) : resolve(row.cnt));
  });
  const ltmCount = await new Promise<number>((resolve, reject) => {
    memDb.get("SELECT COUNT(*) as cnt FROM long_term_memory", (err, row: any) => err ? reject(err) : resolve(row.cnt));
  });
  memDb.close();
  console.log(`  working_memory: ${wmCount} 条 (预期 0) ${wmCount === 0 ? '✅' : '❌'}`);
  console.log(`  long_term_memory: ${ltmCount} 条 (预期 >= 1) ${ltmCount >= 1 ? '✅' : '❌'}`);

  // --- 测试 5: KnowledgeSystem.updateFromLTM() ---
  console.log('\n[5/5] KnowledgeSystem.updateFromLTM()...');
  const memDb2 = new sqlite3.Database(path.join(testDbDir, 'test-agent', 'memory.db'));
  await ks.updateFromLTM('test-ltm-001', memDb2);
  memDb2.close();

  const kgDb2 = new sqlite3.Database(path.join(testDbDir, 'test-agent', 'knowledge.db'));
  const entityCount = await new Promise<number>((resolve, reject) => {
    kgDb2.get("SELECT COUNT(*) as cnt FROM entities", (err, row: any) => err ? reject(err) : resolve(row.cnt));
  });
  kgDb2.close();
  console.log(`  ✅ 知识图谱新增 ${entityCount} 个实体`);

  // --- 总结 ---
  console.log('\n=== 验证完成 ===');
  const allPassed = hasAllTables && result.promoted >= 1 && callbackFired >= 1 && wmCount === 0 && ltmCount >= 1;
  console.log(allPassed ? '✅ 全部通过！' : '⚠️ 部分测试未通过，请检查上方详情');

  // 清理测试数据
  fs.rmSync(testDbDir, { recursive: true });
  console.log('测试数据已清理');
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
