#!/usr/bin/env node
// 增量索引更新脚本 — 供 cron job 调用
// 直接调用 IndexBuilder.update()，不依赖插件工具系统

const path = require('path');

async function main() {
  // 动态导入编译后的模块
  const { IndexBuilder } = require(path.join(__dirname, '../dist/memory/index_builder'));
  const { getMemoryStorageDir } = require(path.join(__dirname, '../dist/utils/plugin-context'));
  
  const agentId = process.argv[2] || 'cortex-test-agent';
  const home = process.env.HOME || process.env.USERPROFILE;
  const workspaceDir = path.join(home, '.openclaw', `workspace-${agentId}`);
  
  const ctx = { agentId, workspaceDir, dataDir: '', pluginsDir: '', openclawRoot: path.join(home, '.openclaw') };
  const memoryDir = getMemoryStorageDir(ctx);
  
  console.log(`[incremental-update] agent=${agentId}, memoryDir=${memoryDir}`);
  
  const builder = new IndexBuilder(ctx);
  builder.init();
  
  const result = await builder.update([memoryDir]);
  console.log(`[incremental-update] ${result.total} files scanned, ${result.added} added, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`);
  
  builder.close();
  
  if (result.errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[incremental-update] FATAL: ${err.message}`);
  process.exit(2);
});
