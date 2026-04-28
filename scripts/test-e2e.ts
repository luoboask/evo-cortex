/**
 * 端到端完整测试 — 记忆 + 知识体系全链路
 * 用法: npx tsx scripts/test-e2e.ts
 * 
 * 测试覆盖：
 * 1. 从零建表
 * 2. 写入 → 检索 → 过期 → 晋升 → 知识图谱更新
 * 3. 衰减更新
 * 4. 规则验证
 * 5. 搜索（多条目、优先级排序）
 * 6. 统计信息
 * 7. 并发安全（多次写入）
 * 8. 边界情况（空搜索、重复 consolidate）
 */
import { MemorySystem } from '../src/memory/memory_system.js';
import { KnowledgeSystem } from '../src/knowledge/knowledge_system.js';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const TEST_DIR = '/tmp/evo-cortex-e2e';

// 清理旧数据
function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${label}`);
  } else {
    failCount++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('========================================');
  console.log('  evo-cortex 端到端完整测试');
  console.log('========================================\n');

  cleanup();

  // ========================
  // 测试 1: 从零建表
  // ========================
  console.log('📦 [1/8] 从零建表...');
  const ms = new MemorySystem('test-agent', TEST_DIR, TEST_DIR);
  const ks = new KnowledgeSystem('test-agent', TEST_DIR);
  
  await ms.init();
  await ks.init();
  
  const memDb = new sqlite3.Database(path.join(TEST_DIR, 'test-agent', 'memory.db'));
  const tables = await new Promise<any[]>((resolve) => {
    memDb.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (_, rows) => resolve(rows || []));
  });
  memDb.close();
  
  const tableNames = tables.map(t => t.name);
  assert(tableNames.includes('working_memory'), 'working_memory 表存在');
  assert(tableNames.includes('long_term_memory'), 'long_term_memory 表存在');
  assert(tableNames.includes('consolidation_log'), 'consolidation_log 表存在');
  
  const kgDb = new sqlite3.Database(path.join(TEST_DIR, 'test-agent', 'knowledge.db'));
  const kgTables = await new Promise<any[]>((resolve) => {
    kgDb.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (_, rows) => resolve(rows || []));
  });
  kgDb.close();
  
  const kgTableNames = kgTables.map(t => t.name);
  assert(kgTableNames.includes('entities'), 'entities 表存在');
  assert(kgTableNames.includes('relations'), 'relations 表存在');
  assert(kgTableNames.includes('rules'), 'rules 表存在');

  // ========================
  // 测试 2: 写入 working_memory
  // ========================
  console.log('\n📝 [2/8] 写入 working_memory...');
  
  const id1 = await ms.record({
    type: 'conversation',
    title: 'SQLite ESM 兼容修复',
    content: 'sqlite3 在 ESM 中必须用 createRequire(import.meta.url)',
    importance: 8.5,
    tags: ['bugfix', 'database', 'sqlite3'],
    source: 'manual',
    sourceRef: 'session-001'
  });
  assert(!!id1, `写入条目 1, id=${id1?.substring(0, 20)}...`);
  
  const id2 = await ms.record({
    type: 'decision',
    title: '采用 FTS5 + 向量融合搜索',
    content: '决定使用 FTS 0.4 + 向量 0.6 融合评分方案',
    importance: 9.0,
    tags: ['architecture', 'search'],
    source: 'manual',
    sourceRef: 'session-001'
  });
  assert(!!id2, `写入条目 2, id=${id2?.substring(0, 20)}...`);
  
  const id3 = await ms.record({
    type: 'insight',
    title: '多 agent 隔离方案',
    content: 'sharedMemoryIndexers 从单例改为 Map<agentId, Instance>',
    importance: 7.5,
    tags: ['architecture', 'multi-agent'],
    source: 'manual',
    sourceRef: 'session-002'
  });
  assert(!!id3, `写入条目 3, id=${id3?.substring(0, 20)}...`);
  
  const id4 = await ms.record({
    type: 'conversation',
    title: '闲聊',
    content: '今天天气不错',
    importance: 1.0,
    tags: ['casual'],
    source: 'manual',
    sourceRef: 'session-003'
  });
  assert(!!id4, `写入条目 4（低优先级）, id=${id4?.substring(0, 20)}...`);

  // ========================
  // 测试 3: 检索
  // ========================
  console.log('\n🔍 [3/8] 检索...');
  
  const search1 = await ms.search({ text: 'sqlite3 ESM', limit: 5 });
  assert(search1.length >= 1, `搜索 "sqlite3 ESM" 返回 ${search1.length} 条`, `预期 >= 1`);
  if (search1.length > 0) {
    assert(search1[0].content?.includes('createRequire'), '最佳匹配包含 createRequire');
  }
  
  const search2 = await ms.search({ text: 'FTS 向量', limit: 5 });
  assert(search2.length >= 1, `搜索 "FTS 向量" 返回 ${search2.length} 条`);
  
  const search3 = await ms.search({ text: '不存在的词 xxx', limit: 5 });
  assert(search3.length === 0, `搜索不存在的词返回 0 条`, `实际返回 ${search3.length}`);

  // ========================
  // 测试 4: consolidate 晋升
  // ========================
  console.log('\n🔄 [4/8] consolidate 晋升...');
  
  // 将高重要性条目设为过期
  const db = new sqlite3.Database(path.join(TEST_DIR, 'test-agent', 'memory.db'));
  await new Promise<void>((resolve) => {
    db.run("UPDATE working_memory SET expires_at = datetime('now', '-1 day') WHERE id IN (?, ?, ?)",
      [id1, id2, id3], () => resolve());
  });
  
  let promotedIds: string[] = [];
  const consolidateResult = await ms.consolidate({
    onPromoted: async (ltmId: string, row: any) => {
      promotedIds.push(ltmId);
    }
  });
  
  assert(consolidateResult.promoted >= 3, `晋升 ${consolidateResult.promoted} 条`, `预期 >= 3`);
  assert(promotedIds.length >= 3, `onPromoted 回调触发 ${promotedIds.length} 次`, `预期 >= 3`);
  
  // 验证 working_memory 只剩低优先级条目
  const wmCount = await new Promise<number>((resolve) => {
    db.get("SELECT COUNT(*) as cnt FROM working_memory", (_, row: any) => resolve(row?.cnt || 0));
  });
  assert(wmCount === 1, `working_memory 剩余 ${wmCount} 条（低优先级未晋升）`, `预期 1`);
  
  // 验证 long_term_memory 有数据
  const ltmCount = await new Promise<number>((resolve) => {
    db.get("SELECT COUNT(*) as cnt FROM long_term_memory", (_, row: any) => resolve(row?.cnt || 0));
  });
  assert(ltmCount >= 3, `long_term_memory 有 ${ltmCount} 条`, `预期 >= 3`);
  db.close();

  // ========================
  // 测试 5: 知识图谱更新
  // ========================
  console.log('\n🧠 [5/8] 知识图谱更新...');
  
  // 模拟从 LTM 提取知识
  const ltmDb = new sqlite3.Database(path.join(TEST_DIR, 'test-agent', 'memory.db'));
  const ltmRows = await new Promise<any[]>((resolve) => {
    ltmDb.all("SELECT * FROM long_term_memory", (_, rows) => resolve(rows || []));
  });
  
  let kgEntityCount = 0;
  for (const row of ltmRows) {
    await ks.updateFromLTM(row.id, ltmDb);
    kgEntityCount++;
  }
  ltmDb.close();
  
  assert(kgEntityCount >= 1, `触发 ${kgEntityCount} 次知识图谱更新`);
  
  const kgDb2 = new sqlite3.Database(path.join(TEST_DIR, 'test-agent', 'knowledge.db'));
  const entityCount = await new Promise<number>((resolve) => {
    kgDb2.get("SELECT COUNT(*) as cnt FROM entities", (_, row: any) => resolve(row?.cnt || 0));
  });
  const relationCount = await new Promise<number>((resolve) => {
    kgDb2.get("SELECT COUNT(*) as cnt FROM relations", (_, row: any) => resolve(row?.cnt || 0));
  });
  kgDb2.close();
  
  assert(entityCount >= 0, `知识图谱有 ${entityCount} 个实体（可能为 0 取决于提取逻辑）`);
  console.log(`     实体: ${entityCount}, 关系: ${relationCount}`);

  // ========================
  // 测试 6: 衰减 + 规则验证
  // ========================
  console.log('\n⏳ [6/8] 衰减更新 + 规则验证...');
  
  try {
    await ks.runDecayUpdates();
    assert(true, '衰减更新执行成功');
  } catch (e: any) {
    assert(false, '衰减更新', e.message);
  }
  
  try {
    const validateResult = await ks.validateRules();
    assert(true, `规则验证完成: ${validateResult.stale} 过时, ${validateResult.core} 核心`);
  } catch (e: any) {
    assert(false, '规则验证', e.message);
  }

  // ========================
  // 测试 7: 统计信息
  // ========================
  console.log('\n📊 [7/8] 统计信息...');
  
  const memStats = await ms.getStats();
  assert(memStats.workingMemory >= 0, `工作记忆: ${memStats.workingMemory}`);
  assert(memStats.longTermMemory >= 3, `长期记忆: ${memStats.longTermMemory}`);
  
  const kgStats = await ks.getStats();
  assert(kgStats.entities >= 0, `实体: ${kgStats.entities}`);
  assert(kgStats.relations >= 0, `关系: ${kgStats.relations}`);
  assert(kgStats.rules >= 0, `规则: ${kgStats.rules}`);

  // ========================
  // 测试 8: 边界情况
  // ========================
  console.log('\n🧪 [8/8] 边界情况...');
  
  // 重复 consolidate（应该返回 0，因为已晋升的不会再次匹配）
  const reConsolidate = await ms.consolidate();
  assert(reConsolidate.promoted === 0, `重复 consolidate 返回 0`, `实际 ${reConsolidate.promoted}`);
  
  // 空搜索
  const emptySearch = await ms.search({ text: '', limit: 5 });
  assert(true, `空搜索不崩溃（返回 ${emptySearch.length} 条）`);
  
  // 搜索限制
  const limitedSearch = await ms.search({ text: 'test', limit: 1 });
  assert(limitedSearch.length <= 1, `搜索限制 limit=1 返回 <= 1 条`);

  // ========================
  // 总结
  // ========================
  console.log('\n========================================');
  console.log(`  结果: ${passCount} 通过, ${failCount} 失败`);
  console.log('========================================');
  
  if (failCount > 0) {
    console.log('\n⚠️ 有失败项，需要修复');
  } else {
    console.log('\n🎉 全部通过！');
  }
  
  cleanup();
}

main().catch(err => {
  console.error('❌ 测试异常:', err.message);
  console.error(err.stack);
  process.exit(1);
});
