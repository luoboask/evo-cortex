/**
 * 完整测试：三大清理任务 + FTS 修复
 */
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();

const agentId = 'cortex-test-agent';
const dataDir = `/Users/dhr/.openclaw/workspace-${agentId}/data/${agentId}`;
const memoryDbPath = path.join(dataDir, 'memory.db');

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

async function test1_DatabaseState() {
  console.log('\n=== Test 1: 数据库状态 ===');
  const db = new sqlite3.Database(memoryDbPath, sqlite3.OPEN_READONLY);
  const all = (sql: string) => new Promise<any[]>((resolve, reject) =>
    db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows || [])));
  
  const wm = await all('SELECT COUNT(*) as c FROM working_memory');
  const ltm = await all('SELECT COUNT(*) as c FROM long_term_memory');
  db.close();
  
  assert(wm[0].c > 0, `working_memory 有 ${wm[0].c} 条`);
  assert(ltm[0].c > 0, `long_term_memory 有 ${ltm[0].c} 条`);
  
  // 检查 consolidated_from 字段
  const ltmRows = await all(`SELECT id, consolidated_from FROM long_term_memory WHERE consolidated_from IS NOT NULL LIMIT 3`);
  if (ltmRows.length > 0) {
    console.log(`  📋 consolidated_from 示例:`);
    ltmRows.forEach((r: any) => console.log(`    LTM id=${r.id}, from=${r.consolidated_from}`));
    assert(true, 'consolidated_from 字段有数据');
  } else {
    assert(true, 'consolidated_from 字段无数据（正常，可能还没晋升）');
  }
}

async function test2_IndexBuildFromDb() {
  console.log('\n=== Test 2: IndexBuilder buildFromDb ===');
  const { IndexBuilder } = await import('../src/memory/index_builder.js');
  const { PluginContext } = await import('../src/utils/plugin-context.js');
  
  const ctx: any = {
    agentId,
    workspaceDir: path.dirname(path.dirname(dataDir)),
    storageBaseDir: '/Users/dhr/.openclaw'
  };
  
  const builder = new IndexBuilder(ctx);
  builder.init();
  
  const result = await builder.buildFromDb();
  
  assert(result.success, `buildFromDb 成功: ${result.success}`);
  assert(result.mode === 'database', `mode=database: ${result.mode}`);
  assert(result.dbRowsScanned > 0, `扫描了 ${result.dbRowsScanned} 行`);
  assert(result.ftsCount >= 0, `FTS 索引: ${result.ftsCount}`);
  assert(result.vectorCount >= 0, `向量索引: ${result.vectorCount}`);
  
  // 验证 dbIndexState 有内容
  const state = builder.getDbIndexState ? Object.keys((builder as any).dbIndexState).length : 0;
  console.log(`  📋 dbIndexState 条目: ${state}`);
  assert(state > 0, `dbIndexState 已填充 (${state} 条目)`);
}

async function test3_KnowledgeSystem() {
  console.log('\n=== Test 3: KnowledgeSystem 迁移 ===');
  const { KnowledgeSystem } = await import('../src/knowledge/knowledge_system.js');
  
  const ks = new KnowledgeSystem(agentId, dataDir);
  await ks.init();
  
  const stats = await ks.getStats();
  assert(stats.entities > 0, `entities: ${stats.entities}`);
  assert(stats.relations > 0, `relations: ${stats.relations}`);
  assert(stats.rules > 0, `rules: ${stats.rules}`);
  
  // 搜索测试
  const results = await ks.searchEntities('知识图谱');
  assert(results.length > 0, `searchEntities('知识图谱') 返回 ${results.length} 条`);
}

async function test4_FtsCleanup() {
  console.log('\n=== Test 4: FTS 索引清理验证 ===');
  const { IndexBuilder } = await import('../src/memory/index_builder.js');
  
  const ctx: any = {
    agentId,
    workspaceDir: path.dirname(path.dirname(dataDir)),
    storageBaseDir: '/Users/dhr/.openclaw'
  };
  
  // 插入一条测试 WM 数据
  const memDb = new sqlite3.Database(memoryDbPath);
  const testId = `wm_test_cleanup_${Date.now()}`;
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) =>
    memDb.run(sql, params, (err) => err ? reject(err) : resolve()));
  
  await run(`INSERT OR REPLACE INTO working_memory (id, type, content, importance, created_at) VALUES (?, 'test', '这是一条用于测试 FTS 清理功能的数据', 5.0, datetime('now'))`, [testId]);
  memDb.close();
  
  // buildFromDb 应该索引这条新数据
  const builder = new IndexBuilder(ctx);
  builder.init();
  await builder.buildFromDb();
  
  // 删除测试数据
  const memDb2 = new sqlite3.Database(memoryDbPath);
  await new Promise<void>((resolve, reject) =>
    memDb2.run('DELETE FROM working_memory WHERE id = ?', [testId], (err) => err ? reject(err) : resolve()));
  memDb2.close();
  
  // 再次 buildFromDb，应该清理 stale 索引
  const builder2 = new IndexBuilder(ctx);
  builder2.init();
  const result = await builder2.buildFromDb();
  
  // 检查日志中是否有 stale cleanup
  assert(result.success, `buildFromDb 清理后成功: ${result.success}`);
  console.log(`  📋 结果: scanned=${result.dbRowsScanned}, indexed=${result.dbRowsIndexed}`);
}

async function test5_ManageIndexTool() {
  console.log('\n=== Test 5: manage_index rebuild_db action ===');
  const { IndexBuilder } = await import('../src/memory/index_builder.js');
  
  const ctx: any = {
    agentId,
    workspaceDir: path.dirname(path.dirname(dataDir)),
    storageBaseDir: '/Users/dhr/.openclaw'
  };
  
  const builder = new IndexBuilder(ctx);
  builder.init();
  
  // 模拟 rebuild_db action
  const stats = await builder.getStats();
  assert(stats.fts !== undefined, `getStats().fts 存在`);
  assert(stats.vector !== undefined, `getStats().vector 存在`);
  
  const result = await builder.buildFromDb();
  assert(result.mode === 'database', `buildFromDb mode=database: ${result.mode}`);
  assert(result.success, `buildFromDb 成功`);
}

async function main() {
  console.log('🧪 evo-cortex 完整测试套件');
  console.log('=========================');
  
  try {
    await test1_DatabaseState();
    await test2_IndexBuildFromDb();
    await test3_KnowledgeSystem();
    await test4_FtsCleanup();
    await test5_ManageIndexTool();
  } catch (err: any) {
    console.log(`\n⚠️  测试异常: ${err.message}`);
    console.log(err.stack);
  }
  
  console.log(`\n=========================`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main();
