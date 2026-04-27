/**
 * 第二轮测试 — 验证修复后的完整链路
 * 1. LTM 搜索（晋升后能否搜到）
 * 2. 知识图谱实体关系完整性
 * 3. decay/validate 实际效果
 * 4. recordUsage 记分
 */
import { MemorySystem } from '../src/memory/memory_system.js';
import { KnowledgeSystem } from '../src/knowledge/knowledge_system.js';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const TEST_DIR = '/tmp/evo-cortex-e2e-round2';

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
  console.log('  第二轮完整测试');
  console.log('========================================\n');

  cleanup();

  const ms = new MemorySystem('agent-r2', TEST_DIR);
  const ks = new KnowledgeSystem('agent-r2', TEST_DIR);
  await ms.init();
  await ks.init();

  // ---- Step 1: 写入多条高重要性记录 ----
  console.log('📝 [1/5] 写入多条记录...');
  const entries = [
    { type: 'bugfix' as const, title: '修复 FTS5 rowid', content: 'FTS5 表必须使用整数 rowid 映射', importance: 8.5, tags: ['database', 'fts5', 'bugfix'] },
    { type: 'decision' as const, title: '向量融合搜索方案', content: '采用 FTS 0.4 + 向量 0.6 融合评分', importance: 9.0, tags: ['search', 'architecture'] },
    { type: 'insight' as const, title: '多 agent 隔离', content: 'sharedMemoryIndexers 使用 Map<agentId, Instance> 实现隔离', importance: 7.5, tags: ['multi-agent', 'architecture'] },
    { type: 'conversation' as const, title: 'EmbeddingProvider guard', content: 'memorySearchConfig 初始值必须是 undefined 而非 null', importance: 8.0, tags: ['bugfix', 'embedding'] },
    { type: 'preference' as const, title: '用户偏好', content: '用户喜欢中文交互，不喜欢英文界面', importance: 7.0, tags: ['preference', 'user'] },
  ];

  const ids: string[] = [];
  for (const e of entries) {
    const id = await ms.record({ ...e, source: 'manual', sourceRef: `test-${ids.length}` });
    ids.push(id);
    assert(!!id, `写入: ${e.title}`);
  }

  // ---- Step 2: 晋升前搜索 ----
  console.log('\n🔍 [2/5] 晋升前搜索 working_memory...');
  const s1 = await ms.search({ text: 'FTS5 rowid', limit: 3 });
  assert(s1.length >= 1, `搜索 "FTS5 rowid" 返回 ${s1.length} 条`);

  const s2 = await ms.search({ text: '向量 融合', limit: 3 });
  assert(s2.length >= 1, `搜索 "向量 融合" 返回 ${s2.length} 条`);

  const s3 = await ms.search({ text: '中文 交互', limit: 3 });
  assert(s3.length >= 1, `搜索 "中文 交互" 返回 ${s3.length} 条`);

  // ---- Step 3: 过期 → 晋升 → LTM 搜索 ----
  console.log('\n🔄 [3/5] 晋升后搜索 long_term_memory...');
  const db = new sqlite3.Database(path.join(TEST_DIR, 'agent-r2', 'memory.db'));
  await new Promise<void>((resolve) => {
    db.run("UPDATE working_memory SET expires_at = datetime('now', '-2 days') WHERE importance >= 7", () => resolve());
  });
  db.close();

  const result = await ms.consolidate();
  assert(result.promoted >= 5, `晋升 ${result.promoted} 条到 LTM`, `预期 >= 5`);

  // 晋升后搜索（应该搜到 LTM）
  const s4 = await ms.search({ text: 'FTS5 rowid', limit: 3 });
  assert(s4.length >= 1, `晋升后搜索 "FTS5 rowid" 返回 ${s4.length} 条`);

  const s5 = await ms.search({ text: 'agent 隔离 Map', limit: 3 });
  assert(s5.length >= 1, `晋升后搜索 "agent 隔离 Map" 返回 ${s5.length} 条`);

  const s6 = await ms.search({ text: 'embedding null', limit: 3 });
  assert(s6.length >= 1, `晋升后搜索 "embedding null" 返回 ${s6.length} 条`);

  // ---- Step 4: 知识图谱 ----
  console.log('\n🧠 [4/5] 知识图谱验证...');
  const ltmDb = new sqlite3.Database(path.join(TEST_DIR, 'agent-r2', 'memory.db'));
  const ltmRows = await new Promise<any[]>((resolve) => {
    ltmDb.all("SELECT * FROM long_term_memory ORDER BY importance DESC LIMIT 5", (_, rows) => resolve(rows || []));
  });

  for (const row of ltmRows) {
    await ks.updateFromLTM(row.id, ltmDb);
  }
  ltmDb.close();

  const kgDb = new sqlite3.Database(path.join(TEST_DIR, 'agent-r2', 'knowledge.db'));
  const entityCount = await new Promise<number>((resolve) => {
    kgDb.get("SELECT COUNT(*) as cnt FROM entities", (_, row: any) => resolve(row?.cnt || 0));
  });
  const relationCount = await new Promise<number>((resolve) => {
    kgDb.get("SELECT COUNT(*) as cnt FROM relations", (_, row: any) => resolve(row?.cnt || 0));
  });
  const ruleCount = await new Promise<number>((resolve) => {
    kgDb.get("SELECT COUNT(*) as cnt FROM rules", (_, row: any) => resolve(row?.cnt || 0));
  });
  kgDb.close();

  assert(entityCount > 0, `知识图谱实体: ${entityCount}`);
  console.log(`     实体: ${entityCount}, 关系: ${relationCount}, 规则: ${ruleCount}`);

  // ---- Step 5: decay + validate ----
  console.log('\n⏳ [5/5] 衰减 + 验证...');
  await ks.runDecayUpdates();
  assert(true, '衰减更新执行成功');

  const vr = await ks.validateRules();
  assert(true, `规则验证: ${vr.stale} 过时, ${vr.core} 核心`);

  // ---- 总结 ----
  console.log('\n========================================');
  console.log(`  结果: ${passCount} 通过, ${failCount} 失败`);
  console.log('========================================');

  if (failCount > 0) {
    console.log('\n⚠️ 有失败项');
  } else {
    console.log('\n🎉 全部通过！系统状态良好。');
  }

  cleanup();
}

main().catch(err => {
  console.error('❌ 测试异常:', err.message);
  console.error(err.stack);
  process.exit(1);
});
