/**
 * 索引构建测试脚本
 * 用法: node test-index-build.mjs
 */

import { IndexBuilder } from './dist/memory/index_builder.js';
import { buildPluginContext } from './dist/utils/plugin-context.js';
import * as fs from 'fs';
import * as path from 'path';

const AGENT_ID = 'cortex-test-agent';
const WORKSPACE = path.join(process.env.HOME, '.openclaw', `workspace-${AGENT_ID}`);

// 模拟 PluginContext
const ctx = {
  agentId: AGENT_ID,
  workspaceDir: WORKSPACE,
  pluginConfig: {},
  logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} }
};

async function main() {
  console.log('=== Evo-Cortex 索引构建测试 ===\n');
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`Workspace: ${WORKSPACE}\n`);

  const builder = new IndexBuilder(ctx);
  builder.init();

  // 扫描目录
  const memDir = path.join(WORKSPACE, 'memory', AGENT_ID);
  const weeklyDir = path.join(memDir, 'weekly');
  const dirs = [memDir].filter(d => fs.existsSync(d));
  console.log(`扫描目录: ${dirs.join(', ')}\n`);

  // 全量重建
  console.log('🔨 全量重建索引...');
  const result = await builder.rebuild(dirs);
  console.log(JSON.stringify(result, null, 2));

  // 统计
  console.log('\n📊 索引统计:');
  const stats = await builder.getStats();
  console.log(JSON.stringify(stats, null, 2));

  // 测试搜索
  console.log('\n🔍 测试搜索: "cortex"');
  const searchResults = await builder.unifiedSearch('cortex', 3, false);
  console.log(`找到 ${searchResults.length} 条结果:`);
  for (const r of searchResults) {
    console.log(`  [${r.source}] score=${r.score.toFixed(4)} id=${r.id}`);
    console.log(`    ${r.content.slice(0, 100)}...`);
  }

  console.log('\n🔍 测试搜索: "evo-cortex 插件"');
  const searchResults2 = await builder.unifiedSearch('evo-cortex 插件', 3, false);
  console.log(`找到 ${searchResults2.length} 条结果:`);
  for (const r of searchResults2) {
    console.log(`  [${r.source}] score=${r.score.toFixed(4)} id=${r.id}`);
    console.log(`    ${r.content.slice(0, 100)}...`);
  }

  builder.close();
  console.log('\n✅ 测试完成');
}

main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
