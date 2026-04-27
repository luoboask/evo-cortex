import { MemoryIndexer } from './src/memory/memory_indexer.ts';
import { SemanticSearch } from './src/memory/semantic_search.ts';
import { MemoryHub } from './src/memory/memory_hub.ts';
import { buildPluginContext, getDataDir } from './src/utils/plugin-context.ts';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const ctx = buildPluginContext({
    agentId: 'cortex-test-agent',
    workspaceDir: '/Users/dhr/.openclaw/workspace-cortex-test-agent'
  });

  // === 测试1: MemoryIndexer ===
  console.log('=== Test 1: MemoryIndexer ===');
  const indexer = new MemoryIndexer(ctx);
  indexer.init();
  const docs = indexer.scanDirectory('/Users/dhr/.openclaw/workspace-cortex-test-agent/memory/cortex-test-agent', /\.md$/);
  console.log(`Indexed ${docs.length} documents`);

  const r1 = indexer.search('cron', 3);
  console.log(`Search "cron": ${r1.length} results`);
  r1.forEach(r => console.log(`  - ${r.path.split('/').pop()}`));

  const stats = indexer.getStats();
  console.log(`Stats: ${stats.documents} docs, types: ${JSON.stringify(stats.types)}`);

  // === 测试2: TF-IDF 状态 ===
  console.log('\n=== Test 2: TF-IDF state ===');
  const tfidfDir = path.join(getDataDir(ctx), 'tfidf');
  const vocabPath = path.join(tfidfDir, 'vocabulary.json');
  if (fs.existsSync(vocabPath)) {
    const vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
    console.log(`TF-IDF: ${vocab.vocabulary?.length || 0} terms, ${vocab.docCount || 0} docs`);
    console.log(`Sample: ${(vocab.vocabulary || []).slice(0, 8).join(', ')}`);
  } else {
    console.log('No TF-IDF vocabulary found');
  }

  // === 测试3: SemanticSearch (keyword fallback) ===
  console.log('\n=== Test 3: SemanticSearch keyword mode ===');
  const semSearch = new SemanticSearch(undefined, 1000);
  
  const sampleDocs = [
    { id: 'doc1', content: 'evo-cortex 插件的 cron 任务管理系统，包含 10 个定时任务' },
    { id: 'doc2', content: 'memory_search 使用 FTS5 全文搜索和 bge-m3 embedding' },
    { id: 'doc3', content: 'sqlite3 在 ESM 模块中需要使用 require 动态加载' },
    { id: 'doc4', content: 'session-scan 已从 cron 迁移到 message_received hook' },
    { id: 'doc5', content: '夜间进化流水线整合了分散的 cron 任务，产出高价值事件' },
  ];

  for (const doc of sampleDocs) {
    await semSearch.addDocument(doc);
  }
  console.log(`Added ${sampleDocs.length} docs, count: ${semSearch.getDocumentCount()}`);

  const results = await semSearch.search('cron 任务管理', 3);
  console.log(`Search "cron 任务管理": ${results.length} results`);
  results.forEach(r => console.log(`  - [${(r.similarity * 100).toFixed(1)}%] ${r.id}: ${r.content.slice(0, 50)}`));

  // === 测试4: MemoryHub ===
  console.log('\n=== Test 4: MemoryHub ===');
  const hub = new MemoryHub(ctx, { top_k: 5 });
  await new Promise(r => setTimeout(r, 500));
  const hubStats = hub.getStats();
  console.log(`MemoryHub: ${hubStats.total} entries, byType: ${JSON.stringify(hubStats.byType)}`);
  console.log(`Embedding level: ${hubStats.embeddingLevel}`);

  // 测试搜索
  const searchResults = await hub.search('cron timeout', 3);
  console.log(`Search "cron timeout": ${searchResults.length} results`);
  searchResults.forEach(r => console.log(`  - [${(r.score * 100).toFixed(1)}%] layer=${r.layer}: ${r.entry.content.slice(0, 60)}...`));

  // === 测试5: 最近日记标题 ===
  console.log('\n=== Test 5: Recent daily summary ===');
  const summary = await hub.getRecentDailySummary(2);
  if (summary) {
    console.log(summary.slice(0, 300));
  } else {
    console.log('No recent daily notes found');
  }

  console.log('\n=== All tests completed ===');
}

main().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
