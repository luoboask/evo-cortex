#!/usr/bin/env node
/**
 * Evo-Cortex Evolution Runner
 * 
 * 直接执行进化任务的脚本，无需通过 LLM agent
 * 优势：
 * - 减少大模型调用次数
 * - 执行速度快（秒级 vs 分钟级）
 * - 结果可预测、一致
 * - 资源消耗低
 * 
 * 用法:
 *   npx tsx evolution-runner.ts <task-type> <agent-id>
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取参数
const TASK_TYPE = process.argv[2];
const AGENT_ID = process.argv[3] || 'main';

if (!TASK_TYPE) {
  console.error('❌ 错误：缺少任务类型参数');
  console.error('用法：npx tsx evolution-runner.ts <task-type> <agent-id>');
  console.error('\n支持的任务类型:');
  console.error('  hourly-fractal    - 每小时分形思考');
  console.error('  daily-review      - 每日知识审查');
  console.error('  active-learning   - 主动学习');
  console.error('  daily-compress    - 每日记忆压缩');
  console.error('  weekly-compress   - 每周记忆压缩');
  console.error('  monthly-cycle     - 月度进化周期');
  process.exit(1);
}

// 基础路径
const WORKSPACE_ROOT = path.join(process.env.HOME || '/tmp', '.openclaw');
const AGENT_WORKSPACE = path.join(WORKSPACE_ROOT, `workspace-${AGENT_ID}`);

console.log(`🧬 Evo-Cortex Evolution Runner`);
console.log(`任务类型：${TASK_TYPE}`);
console.log(`Agent: ${AGENT_ID}`);
console.log(`工作目录：${AGENT_WORKSPACE}`);
console.log('---\n');

// ========== 工具函数 ==========

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ 创建目录：${dirPath}`);
  }
}

function readRecentConversations(hours: number = 24): string[] {
  const memoryDir = path.join(AGENT_WORKSPACE, 'memory', AGENT_ID);
  const conversations: string[] = [];
  
  if (!fs.existsSync(memoryDir)) {
    console.log(`⚠️  记忆目录不存在：${memoryDir}`);
    return conversations;
  }
  
  // 读取最近的记忆文件
  const files = fs.readdirSync(memoryDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, Math.ceil(hours / 24) + 1);
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(memoryDir, file), 'utf8');
    conversations.push(content);
  }
  
  console.log(`📖 读取了 ${conversations.length} 个记忆文件`);
  return conversations;
}

function readKnowledgeGraph(): any[] {
  const knowledgeFile = path.join(AGENT_WORKSPACE, 'knowledge', AGENT_ID, 'entities.json');
  
  if (!fs.existsSync(knowledgeFile)) {
    console.log(`⚠️  知识图谱文件不存在：${knowledgeFile}`);
    return [];
  }
  
  const content = fs.readFileSync(knowledgeFile, 'utf8');
  const entities = JSON.parse(content);
  
  console.log(`📚 读取了 ${entities.length} 个知识实体`);
  return entities;
}

function saveMetaRules(rules: Array<{pattern: string, rule: string, example: string}>): void {
  const evolutionDir = path.join(AGENT_WORKSPACE, 'evolution', AGENT_ID);
  ensureDir(evolutionDir);
  
  const timestamp = new Date().toISOString().split('T')[0];
  const filePath = path.join(evolutionDir, `meta-rules-${timestamp}.md`);
  
  const content = [
    `# Meta-Rules for ${AGENT_ID}`,
    `Generated: ${new Date().toLocaleString('zh-CN')}`,
    ``,
    `---`,
    ``
  ].join('\n');
  
  const rulesContent = rules.map((rule, i) => 
    [`## Meta-Rule ${i + 1}: ${rule.pattern}`,
     ``,
     `**Rule**: ${rule.rule}`,
     ``,
     `**Example**: ${rule.example}`,
     ``
    ].join('\n')
  ).join('\n');
  
  fs.appendFileSync(filePath, rulesContent, 'utf8');
  console.log(`✅ 保存了 ${rules.length} 条元规则到：${filePath}`);
}

function compressMemories(conversations: string[], period: string): string {
  // 简单实现：提取关键词和摘要
  const allText = conversations.join('\n');
  const words = allText.split(/[\s\n]+/);
  
  // 统计词频
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    if (word.length > 2 && !/^[\u4e00-\u9fa5]+$/.test(word)) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }
  
  // 取前 20 个高频词
  const topWords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word)
    .join(', ');
  
  const summary = [
    `# ${period} Summary`,
    `Generated: ${new Date().toLocaleString('zh-CN')}`,
    ``,
    `## Key Topics`,
    topWords,
    ``,
    `## Statistics`,
    `- Total conversations: ${conversations.length}`,
    `- Time period: ${period}`,
    ``,
    `## Insights`,
    `- 待实现：使用 LLM 生成深度洞察`,
    ``
  ].join('\n');
  
  return summary;
}

// ========== 任务实现 ==========

async function runHourlyFractal(): Promise<void> {
  console.log('🔮 执行任务：每小时分形思考\n');
  
  // 读取最近 2 小时的对话
  const conversations = readRecentConversations(2);
  
  if (conversations.length === 0) {
    console.log('ℹ️  没有足够的对话数据，跳过本次执行');
    return;
  }
  
  // 简单模式识别（实际应该用 LLM，但这里用规则简化）
  const allText = conversations.join('\n').toLowerCase();
  const patterns: Array<{pattern: string, rule: string, example: string}> = [];
  
  // 检测常见模式
  if (allText.includes('error') || allText.includes('失败')) {
    patterns.push({
      pattern: '错误处理模式',
      rule: '遇到错误时：1) 阅读完整错误信息 2) 检查当前状态 3) 尝试建议的修复方法',
      example: 'Git push 失败 → 查看错误提示 → 先 pull 再 push'
    });
  }
  
  if (allText.includes('搜索') || allText.includes('search')) {
    patterns.push({
      pattern: '搜索验证模式',
      rule: '搜索操作后应验证：1) 确认搜索范围正确 2) 检查结果相关性 3) 必要时调整搜索策略',
      example: '记忆搜索无结果 → 检查 agent 上下文 → 确认索引状态'
    });
  }
  
  if (allText.includes('配置') || allText.includes('config')) {
    patterns.push({
      pattern: '配置变更模式',
      rule: '修改配置后必须：1) 验证语法正确 2) 重启相关服务 3) 确认生效',
      example: '修改 cron 配置 → 检查语法 → 重启 gateway → 验证任务创建成功'
    });
  }
  
  // 如果没有检测到模式，生成一个通用规则
  if (patterns.length === 0) {
    patterns.push({
      pattern: '持续改进模式',
      rule: '定期回顾最近的工作，识别可以优化的流程和方法',
      example: '每小时花 5 分钟回顾，记录发现的问题和改进点'
    });
  }
  
  saveMetaRules(patterns);
  console.log('\n✅ 分形思考完成');
}

async function runDailyReview(): Promise<void> {
  console.log('📋 执行任务：每日知识审查\n');
  
  const entities = readKnowledgeGraph();
  
  if (entities.length === 0) {
    console.log('ℹ️  知识图谱为空，跳过本次执行');
    return;
  }
  
  // 简单的知识质量检查
  const issues: string[] = [];
  
  // 检查重复名称
  const names = new Set<string>();
  const duplicates: string[] = [];
  for (const entity of entities) {
    if (names.has(entity.name)) {
      duplicates.push(entity.name);
    } else {
      names.add(entity.name);
    }
  }
  
  if (duplicates.length > 0) {
    issues.push(`发现 ${duplicates.length} 个重复实体：${duplicates.slice(0, 5).join(', ')}`);
  }
  
  // 检查过时内容（简单实现：检查 createdAt 是否超过 30 天）
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const oldEntities = entities.filter(e => {
    const created = new Date(e.createdAt).getTime();
    return created < thirtyDaysAgo;
  });
  
  if (oldEntities.length > 0) {
    issues.push(`发现 ${oldEntities.length} 个可能过时的实体（创建超过 30 天）`);
  }
  
  // 输出审查报告
  const report = [
    `# Daily Review Report`,
    `Generated: ${new Date().toLocaleString('zh-CN')}`,
    ``,
    `## Summary`,
    `- Total entities: ${entities.length}`,
    `- Issues found: ${issues.length}`,
    ``,
    `## Issues`,
    ...issues.map(i => `- ${i}`),
    ``,
    `## Recommendations`,
    `- 合并重复实体`,
    `- 审查并更新过时内容`,
    `- 添加缺失的知识连接`,
    ``
  ].join('\n');
  
  const reviewDir = path.join(AGENT_WORKSPACE, 'evolution', AGENT_ID);
  ensureDir(reviewDir);
  
  const filePath = path.join(reviewDir, `daily-review-${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(filePath, report, 'utf8');
  
  console.log(`✅ 审查完成，发现 ${issues.length} 个问题`);
  console.log(`📄 报告保存到：${filePath}`);
}

async function runActiveLearning(): Promise<void> {
  console.log('🎯 执行任务：主动学习\n');
  
  const conversations = readRecentConversations(24);
  const entities = readKnowledgeGraph();
  
  if (conversations.length === 0) {
    console.log('ℹ️  没有对话数据，跳过本次执行');
    return;
  }
  
  // 分析知识缺口（简单实现）
  const allText = conversations.join('\n');
  const gaps: string[] = [];
  
  // 检测频繁出现但未在知识图谱中的概念
  const frequentTerms = ['API', '配置', '优化', '调试', '部署'];
  const existingNames = entities.map(e => e.name.toLowerCase());
  
  for (const term of frequentTerms) {
    const count = (allText.match(new RegExp(term, 'gi')) || []).length;
    const exists = existingNames.some(name => name.includes(term.toLowerCase()));
    
    if (count > 3 && !exists) {
      gaps.push(`频繁提及 "${term}" (${count}次)，但知识图谱中缺少相关条目`);
    }
  }
  
  // 输出学习建议
  const report = [
    `# Active Learning Report`,
    `Generated: ${new Date().toLocaleString('zh-CN')}`,
    ``,
    `## Knowledge Gaps`,
    ...gaps.map(g => `- ${g}`),
    ``,
    `## Recommended Actions`,
    `- 补充缺失的知识条目`,
    `- 建立相关概念的连接`,
    `- 深入学习频繁出现的主题`,
    ``
  ].join('\n');
  
  const learningDir = path.join(AGENT_WORKSPACE, 'evolution', AGENT_ID);
  ensureDir(learningDir);
  
  const filePath = path.join(learningDir, `active-learning-${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(filePath, report, 'utf8');
  
  console.log(`✅ 主动学习完成，发现 ${gaps.length} 个知识缺口`);
  console.log(`📄 报告保存到：${filePath}`);
}

async function runCompression(period: 'daily' | 'weekly'): Promise<void> {
  console.log(`🗜️ 执行任务：${period === 'daily' ? '每日' : '每周'}记忆压缩\n`);
  
  const hours = period === 'daily' ? 24 : 24 * 7;
  const conversations = readRecentConversations(hours);
  
  if (conversations.length === 0) {
    console.log('ℹ️  没有对话数据，跳过本次执行');
    return;
  }
  
  const summary = compressMemories(conversations, period === 'daily' ? 'Last 24h' : 'Last 7 days');
  
  const compressDir = path.join(AGENT_WORKSPACE, 'evolution', AGENT_ID);
  ensureDir(compressDir);
  
  const timestamp = new Date().toISOString().split('T')[0];
  const suffix = period === 'daily' ? 'daily' : 'weekly';
  const filePath = path.join(compressDir, `compress-${suffix}-${timestamp}.md`);
  
  fs.writeFileSync(filePath, summary, 'utf8');
  
  console.log(`✅ 压缩完成`);
  console.log(`📄 摘要保存到：${filePath}`);
  console.log(`📊 原始对话：${conversations.length} 条`);
}

async function runMonthlyCycle(): Promise<void> {
  console.log('🔄 执行任务：月度进化周期\n');
  
  const evolutionDir = path.join(AGENT_WORKSPACE, 'evolution', AGENT_ID);
  
  if (!fs.existsSync(evolutionDir)) {
    console.log('ℹ️  进化目录不存在，跳过本次执行');
    return;
  }
  
  // 读取本月生成的所有元规则
  const files = fs.readdirSync(evolutionDir)
    .filter(f => f.startsWith('meta-rules-') && f.includes(new Date().toISOString().slice(0, 7)));
  
  if (files.length === 0) {
    console.log('ℹ️  本月没有生成元规则，跳过本次执行');
    return;
  }
  
  // 整合元规则
  const allRules: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(evolutionDir, file), 'utf8');
    allRules.push(content);
  }
  
  // 生成月度报告
  const report = [
    `# Monthly Evolution Report`,
    `Generated: ${new Date().toLocaleString('zh-CN')}`,
    ``,
    `## Summary`,
    `- Meta-rule files: ${files.length}`,
    `- Period: ${new Date().toISOString().slice(0, 7)}`,
    ``,
    `## Meta-Rules Generated`,
    `(See attached files for details)`,
    ``,
    `## Next Month Focus`,
    `- Continue applying existing rules`,
    `- Identify new patterns`,
    `- Refine outdated rules`,
    ``
  ].join('\n');
  
  const filePath = path.join(evolutionDir, `monthly-report-${new Date().toISOString().slice(0, 7)}.md`);
  fs.writeFileSync(filePath, report, 'utf8');
  
  console.log(`✅ 月度周期完成`);
  console.log(`📄 报告保存到：${filePath}`);
  console.log(`📊 整合了 ${files.length} 个元规则文件`);
}

// ========== 主流程 ==========

(async () => {
  try {
    switch (TASK_TYPE) {
      case 'hourly-fractal':
        await runHourlyFractal();
        break;
      
      case 'daily-review':
        await runDailyReview();
        break;
      
      case 'active-learning':
        await runActiveLearning();
        break;
      
      case 'daily-compress':
        await runCompression('daily');
        break;
      
      case 'weekly-compress':
        await runCompression('weekly');
        break;
      
      case 'monthly-cycle':
        await runMonthlyCycle();
        break;
      
      default:
        console.error(`❌ 未知任务类型：${TASK_TYPE}`);
        process.exit(1);
    }
    
    console.log('\n✨ 任务执行完成');
  } catch (error: any) {
    console.error(`\n❌ 任务执行失败：${error.message}`);
    process.exit(1);
  }
})();
