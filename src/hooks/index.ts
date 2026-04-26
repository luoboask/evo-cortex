/**
 * Hooks - 钩子函数
 * 
 * 实现对话前、对话后、工具调用前的增强逻辑
 * 
 * v1.4.0 改进：
 * 1. 用户偏好缓存（5 分钟 TTL，避免每次消息读文件）
 * 2. 扩大 shouldEnhance 触发范围（覆盖更多对话场景）
 * 3. 恢复简化版 extractConcepts（提取实体关键词）
 * 4. 工作记忆写入节流（10s 内同内容不重复写）
 * 5. 过滤条件优化（放宽长度限制）
 */

import { MemoryHub } from "../memory/memory_hub";
import { KnowledgeGraph } from "../knowledge/knowledge_graph";
import type { Logger } from "../utils/logger";
import * as fs from 'fs';
import * as path from 'path';

// ========== 缓存系统 ==========

/** 用户偏好缓存 */
interface PrefCache {
  content: string;
  mtime: number;
  timestamp: number;
}
const prefCache = new Map<string, PrefCache>();
const PREF_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

/** 工作记忆写入节流 */
const wmThrottle = new Map<string, number>();
const WM_THROTTLE_MS = 10000; // 10 秒

/** 检查缓存是否有效 */
function isPrefCacheValid(key: string, filePath: string): boolean {
  const cached = prefCache.get(key);
  if (!cached) return false;
  try {
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs !== cached.mtime) return false;
  } catch { return false; }
  return Date.now() - cached.timestamp < PREF_CACHE_TTL;
}

/**
 * 从 USER_PREFERENCES.md 提取指定章节的已选项
 */
function extractCheckedItems(content: string, sectionName: string): string[] {
  const regex = new RegExp(`## ${sectionName}[\\s\\S]*?(?=##|$)`, 'i');
  const match = content.match(regex);
  if (!match) return [];
  
  const checked = match[0]
    .split('\n')
    .filter(line => /\[x\]/i.test(line))
    .map(line => line.replace(/^[ \t-]*\[x\][ \t]*/i, '').trim())
    .filter(Boolean);
  
  return checked;
}

/**
 * 加载用户偏好文件并构建提示词注入（带缓存）
 */
async function loadUserPreferences(
  workspaceDir: string | undefined,
  agentId: string | undefined,
  logger?: Logger
): Promise<string | null> {
  if (!workspaceDir || !agentId) {
    return null;
  }
  
  const prefFile = path.join(workspaceDir, 'USER_PREFERENCES.md');
  const cacheKey = `${agentId}:${prefFile}`;
  
  // 检查缓存
  if (isPrefCacheValid(cacheKey, prefFile)) {
    return prefCache.get(cacheKey)!.content;
  }
  
  if (!fs.existsSync(prefFile)) {
    prefCache.delete(cacheKey);
    logger?.debug('User preferences file not found');
    return null;
  }
  
  try {
    const content = fs.readFileSync(prefFile, 'utf-8');
    const stat = fs.statSync(prefFile);
    
    const communicationStyle = extractCheckedItems(content, '沟通风格');
    const codeExamples = extractCheckedItems(content, '代码示例');
    const formatPrefs = extractCheckedItems(content, '格式偏好');
    const techStackFrontend = extractCheckedItems(content, '前端');
    const techStackBackend = extractCheckedItems(content, '后端');
    const techStackDatabase = extractCheckedItems(content, '数据库');
    const explicitLikes = extractCheckedItems(content, '明确表达过的喜好');
    
    const allPrefs = [
      ...communicationStyle,
      ...codeExamples,
      ...formatPrefs,
      ...techStackFrontend,
      ...techStackBackend,
      ...techStackDatabase,
      ...explicitLikes
    ];
    
    if (allPrefs.length === 0) {
      prefCache.delete(cacheKey);
      logger?.debug('No checked preferences found');
      return null;
    }
    
    let injection = '\n\n=== 用户偏好 ===\n';
    
    if (communicationStyle.length > 0) {
      injection += `沟通风格：${communicationStyle.join(', ')}\n`;
    }
    if (codeExamples.length > 0) {
      injection += `代码示例：${codeExamples.join(', ')}\n`;
    }
    if (formatPrefs.length > 0) {
      injection += `格式偏好：${formatPrefs.join(', ')}\n`;
    }
    
    const techStack = [
      ...techStackFrontend.map(t => `前端:${t}`),
      ...techStackBackend.map(t => `后端:${t}`),
      ...techStackDatabase.map(t => `数据库:${t}`)
    ];
    if (techStack.length > 0) {
      injection += `技术栈：${techStack.join(', ')}\n`;
    }
    
    if (explicitLikes.length > 0) {
      injection += `其他喜好：${explicitLikes.join(', ')}\n`;
    }
    
    injection += '请严格遵循以上用户偏好进行回复。\n';
    injection += '==================\n\n';
    
    // 更新缓存
    prefCache.set(cacheKey, { content: injection, mtime: stat.mtimeMs, timestamp: Date.now() });
    
    logger?.hook('user_preferences_loaded', `Loaded ${allPrefs.length} preferences for agent ${agentId}`);
    
    return injection;
  } catch (error: any) {
    logger?.error('Failed to load user preferences', error);
    return null;
  }
}

/** 安全加载 sqlite3，未安装时返回 null */
function getSqlite3(): any {
  try {
    return require('sqlite3').verbose();
  } catch {
    return null;
  }
}

/** 安全写入工作记忆（sqlite3 可选 + 节流） */
function safeWriteWorkingMemory(
  dbPath: string,
  agentId: string,
  content: string,
  logger?: Logger
): void {
  // 节流：10s 内同内容不重复写
  const throttleKey = `${agentId}:${content.slice(0, 100)}`;
  const lastWrite = wmThrottle.get(throttleKey);
  if (lastWrite && Date.now() - lastWrite < WM_THROTTLE_MS) {
    return;
  }
  wmThrottle.set(throttleKey, Date.now());
  
  const sqlite3 = getSqlite3();
  if (!sqlite3) {
    logger?.debug('sqlite3 not available, skipping working memory write');
    return;
  }
  
  let db: any;
  try {
    db = new sqlite3.Database(dbPath);
    db.run(
      `INSERT INTO working_memory (session_id, content, created_at, expires_at, message_count)
       VALUES (?, ?, datetime('now'), datetime('now', '+2 hours'), 1)`,
      [agentId || 'unknown', content],
      (err: Error | null) => {
        if (err) logger?.debug('Failed to write working memory', err);
        else logger?.hook('working_memory_written', `Saved: ${content.substring(0, 50)}`);
        try { db.close(); } catch { /* ignore double-close */ }
      }
    );
  } catch (err) {
    logger?.debug('Failed to open working memory db', err);
    if (db) { try { db.close(); } catch { /* ignore */ } }
  }
}

/** 过滤函数：判断是否是真实对话 */
function isRealConversation(text: string): boolean {
  if (!text || text.length < 5) return false;
  if (text.includes('[cron:')) return false;
  if (text.includes('[SCRIPT MODE]')) return false;
  if (text.includes('[toolCall]')) return false;
  if (text.includes('[toolResult]')) return false;
  if (text.includes('Sender (untrusted metadata)')) return false;
  if (text.includes('openclaw-tui')) return false;
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return false;
  }
  if (text.length > 2000) return false;
  return true;
}

/**
 * 对话前钩子：检索记忆和知识，增强上下文
 */
export async function messageReceivedHook(
  message: any,
  memoryHub: MemoryHub,
  knowledgeGraph: KnowledgeGraph,
  agentId?: string,
  logger?: Logger
): Promise<Record<string, any>> {
  const content = message.content || "";
  
  // 自动加载用户偏好
  const preferences = await loadUserPreferences(
    (memoryHub as any).ctx?.workspaceDir,
    agentId,
    logger
  );
  
  // 双向写入工作记忆（sqlite3 可选）
  const workspaceDir = (memoryHub as any).ctx?.workspaceDir || '';
  const dbPath = path.join(workspaceDir, 'data', agentId || 'default', 'cortex.db');
  
  // 1. 保存上一轮 AI 回复（如果有）
  if (message.context?.lastResponse && isRealConversation(message.context.lastResponse)) {
    safeWriteWorkingMemory(dbPath, agentId || 'unknown', `AI: ${message.context.lastResponse}`, logger);
  }
  
  // 2. 保存当前用户问题
  if (content && content.length > 0 && isRealConversation(content)) {
    safeWriteWorkingMemory(dbPath, agentId || 'unknown', `User: ${content}`, logger);
  }
  
  // 判断是否需要检索增强
  const needsEnhancement = shouldEnhance(content);
  
  if (!needsEnhancement && !preferences) {
    logger?.debug('Message does not require enhancement and no preferences loaded');
    return {};
  }
  
  // 构建返回结果
  const result: Record<string, any> = {};
  
  if (preferences) {
    result.system_prompt_addition = preferences;
  }
  
  if (needsEnhancement) {
    try {
      const memories = await memoryHub.search(content, 5);
      const knowledge = await knowledgeGraph.search(content);
      const context = buildEnhancedContext(content, memories, knowledge);
      
      if (context) {
        result.system_prompt_addition = (result.system_prompt_addition || '') + context;
      }
      
      result.memories = memories;
      result.knowledge = knowledge;
      
      logger?.hook('message_received', `Enhanced with ${memories.length} memories, ${knowledge.length} knowledge${preferences ? ', user preferences loaded' : ''}`);
    } catch (error) {
      logger?.error('Enhancement failed', error);
    }
  } else {
    logger?.hook('message_received', preferences ? 'User preferences loaded' : 'No enhancement needed');
  }
  
  return result;
}

/**
 * 对话后钩子：存储记忆和提取知识
 */
export async function messageSentHook(
  message: any,
  memoryHub: MemoryHub,
  knowledgeGraph: KnowledgeGraph,
  agentId?: string,
  logger?: Logger
): Promise<Record<string, any>> {
  const content = message.content || "";
  
  try {
    // 1. 存储对话到记忆
    await memoryHub.add({
      content: content,
      type: "session",
      timestamp: new Date().toISOString()
    });
    
    // 实时写入工作记忆（sqlite3 可选）
    const workspaceDir = (memoryHub as any).ctx?.workspaceDir || '';
    const dbPath = path.join(workspaceDir, 'data', agentId || 'default', 'cortex.db');
    safeWriteWorkingMemory(dbPath, agentId || 'unknown', content, logger);
    
    // 2. 提取概念到知识图谱（v1.4.0 简化版）
    const concepts = extractConcepts(content);
    if (concepts.length > 0) {
      for (const concept of concepts.slice(0, 10)) {
        await knowledgeGraph.addEntity({
          name: concept,
          type: 'keyword',
          description: concept,
          createdAt: new Date().toISOString()
        });
      }
      logger?.hook('concept_extracted', `Extracted ${concepts.length} concepts`);
    }
    
    logger?.hook('message_sent', 'Stored memory');
    
    return {};
  } catch (error) {
    logger?.error('Memory storage failed', error);
    return {};
  }
}

/**
 * 工具调用前钩子：安全检查
 */
export async function beforeToolCallHook(
  toolCall: any,
  logger?: Logger
): Promise<Record<string, any>> {
  const toolName = toolCall.name || "";
  
  const sensitiveTools = ["delete_file", "exec", "send_email", "system.run"];
  if (sensitiveTools.includes(toolName)) {
    logger?.hook('before_tool_call', `Sensitive tool detected: ${toolName}`);
  }
  
  return { block: false };
}

// ========== 辅助函数 ==========

/**
 * 判断是否需要检索增强
 * v1.4.0: 扩大触发范围，覆盖更多对话场景
 */
function shouldEnhance(message: string): boolean {
  const lower = message.toLowerCase();
  
  // 直接询问历史/记忆
  const historyTriggers = [
    "之前做过", "之前说过", "还记得", "记得吗", "上次", "以前",
    "history", "remember", "previous", "before", "last time"
  ];
  if (historyTriggers.some(t => lower.includes(t.toLowerCase()))) return true;
  
  // 询问建议/推荐/方案（需要上下文）
  const suggestionTriggers = [
    "推荐", "建议", "方案", "怎么", "如何", "什么", "哪个",
    "recommend", "suggest", "how", "what", "which"
  ];
  if (suggestionTriggers.some(t => lower.includes(t.toLowerCase()))) return true;
  
  // 追问/继续（需要上下文）
  const followUpTriggers = [
    "继续", "然后", "接下来", "还有", "补充", "详细",
    "continue", "then", "next", "more", "detail"
  ];
  if (followUpTriggers.some(t => lower.includes(t.toLowerCase()))) return true;
  
  return false;
}

/**
 * 构建增强上下文
 */
function buildEnhancedContext(
  message: string,
  memories: any[],
  knowledge: any[]
): string {
  let context = "📚 相关信息:\n\n";
  
  if (memories.length > 0) {
    context += "💭 历史记忆:\n";
    memories.slice(0, 3).forEach((m, i) => {
      const content = m.entry?.content || m.content || "";
      context += `${i + 1}. ${content.slice(0, 100)}...\n`;
    });
    context += "\n";
  }
  
  if (knowledge.length > 0) {
    context += "📖 领域知识:\n";
    knowledge.slice(0, 3).forEach((k, i) => {
      const name = k.entity?.name || k.name || "";
      const type = k.entity?.type || k.type || "unknown";
      context += `${i + 1}. ${name} (${type})\n`;
    });
    context += "\n";
  }
  
  return context;
}

/**
 * 提取概念（v1.4.0 简化版：提取实体关键词）
 * 规则：
 * 1. 大写字母开头的词（英文实体）
 * 2. URL、文件路径
 * 3. 代码标识符（驼峰/下划线）
 */
function extractConcepts(text: string): string[] {
  const concepts = new Set<string>();
  
  // 1. 提取 URL
  const urlMatches = text.match(/https?:\/\/[^\s)]+/g);
  if (urlMatches) urlMatches.forEach(u => concepts.add(u));
  
  // 2. 提取文件路径
  const pathMatches = text.match(/[\/~][\w\-./]+/g);
  if (pathMatches) pathMatches.forEach(p => {
    if (p.length > 3 && p.length < 100) concepts.add(p);
  });
  
  // 3. 提取大写字母开头的词（英文实体名）
  const wordMatches = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g);
  if (wordMatches) {
    const stopWords = new Set(['The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where', 'Which', 'Who', 'Why', 'How', 'Have', 'Has', 'Had', 'Will', 'Would', 'Could', 'Should', 'Can', 'May', 'Must', 'Shall', 'Need', 'Dare', 'Ought', 'Used', 'From', 'With', 'About', 'After', 'Before', 'Into', 'Upon', 'Over', 'Under', 'Between', 'Through', 'During', 'Without', 'Within', 'Along', 'Across', 'Behind', 'Beyond', 'Below', 'Above', 'Here', 'There', 'Please', 'Thank', 'Thanks', 'Hello', 'Good', 'Yes', 'No', 'Not', 'Also', 'Just', 'Very', 'More', 'Most', 'Less', 'Least', 'Much', 'Many', 'Some', 'Any', 'All', 'Each', 'Every', 'Both', 'Either', 'Neither', 'Other', 'Another', 'Such', 'Only', 'Same', 'Own', 'Back', 'Front', 'Left', 'Right', 'Top', 'Bottom', 'First', 'Last', 'Next', 'Old', 'New', 'High', 'Low', 'Big', 'Small', 'Long', 'Short', 'Fast', 'Slow', 'Hard', 'Easy', 'Real', 'True', 'False', 'Free', 'Full', 'Half', 'Early', 'Late', 'Ready', 'Able', 'Like', 'Make', 'Take', 'Come', 'Go', 'See', 'Know', 'Think', 'Say', 'Get', 'Give', 'Find', 'Tell', 'Ask', 'Work', 'Try', 'Use', 'Call', 'Keep', 'Let', 'Begin', 'Show', 'Hear', 'Play', 'Run', 'Move', 'Live', 'Believe', 'Hold', 'Bring', 'Happen', 'Write', 'Provide', 'Sit', 'Stand', 'Lose', 'Pay', 'Meet', 'Include', 'Continue', 'Set', 'Learn', 'Change', 'Lead', 'Understand', 'Watch', 'Follow', 'Stop', 'Create', 'Speak', 'Read', 'Allow', 'Add', 'Spend', 'Grow', 'Open', 'Walk', 'Win', 'Offer', 'Remember', 'Love', 'Consider', 'Appear', 'Buy', 'Wait', 'Serve', 'Die', 'Send', 'Expect', 'Build', 'Stay', 'Fall', 'Cut', 'Reach', 'Kill', 'Remain', 'Suggest', 'Raise', 'Pass', 'Sell', 'Require', 'Report', 'Decide', 'Pull']);
    wordMatches.forEach(w => {
      if (!stopWords.has(w) && w.length > 2) concepts.add(w);
    });
  }
  
  // 4. 提取代码标识符（驼峰/下划线）
  const codeMatches = text.match(/\b[a-z][a-zA-Z0-9_]{2,}\b/g);
  if (codeMatches) codeMatches.forEach(c => {
    if (c.includes('_') || /[a-z][A-Z]/.test(c)) concepts.add(c);
  });
  
  return Array.from(concepts);
}
