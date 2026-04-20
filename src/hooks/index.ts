/**
 * Hooks - 钩子函数
 * 
 * 实现对话前、对话后、工具调用前的增强逻辑
 * 
 * 改进：
 * 1. 接受 agentId 参数，为每个 agent 创建独立的记忆和知识实例
 * 2. 使用统一的 Logger 系统
 * 3. 日志中包含 agentId 以便调试
 */

import { MemoryHub } from "../memory/memory_hub";
import { KnowledgeGraph } from "../knowledge/knowledge_graph";
import type { Logger } from "../utils/logger";

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
  const agentTag = agentId ? `[${agentId}]` : '';
  
  // 判断是否需要检索增强
  if (!shouldEnhance(content)) {
    logger?.debug('Message does not require enhancement');
    return {};
  }
  
  try {
    // 1. 检索相关记忆
    const memories = await memoryHub.search(content, 5);
    
    // 2. 检索领域知识
    const knowledge = await knowledgeGraph.search(content);
    
    // 3. 构建增强上下文
    const context = buildEnhancedContext(content, memories, knowledge);
    
    logger?.hook('message_received', `Enhanced with ${memories.length} memories, ${knowledge.length} knowledge`);
    
    return {
      system_prompt_addition: context,
      memories: memories,
      knowledge: knowledge
    };
  } catch (error) {
    logger?.error('Enhancement failed', error);
    return {};
  }
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
    
    // 2. 提取概念到知识图谱
    const concepts = extractConcepts(content);
    if (concepts.length > 0) {
      await knowledgeGraph.addEntities(
        concepts.map(name => ({
          name,
          type: "concept",
          createdAt: new Date().toISOString()
        }))
      );
      logger?.hook('message_sent', `Stored memory, extracted ${concepts.length} concepts`);
    } else {
      logger?.hook('message_sent', 'Stored memory');
    }
    
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
  
  // 敏感工具检查
  const sensitiveTools = ["delete_file", "exec", "send_email", "system.run"];
  if (sensitiveTools.includes(toolName)) {
    logger?.hook('before_tool_call', `Sensitive tool detected: ${toolName}`);
    // 可以添加额外的安全检查或日志
  }
  
  return { block: false };
}

// ========== 辅助函数 ==========

/**
 * 判断是否需要增强
 */
function shouldEnhance(message: string): boolean {
  // 触发词：历史查询、配置询问、复杂问题
  const triggers = [
    // 中文触发词
    "之前", "记得", "如何", "怎么", "为什么", "什么", "哪里", "何时", 
    "谁", "哪些", "多少", "怎样", "干嘛", "干吗",
    // 英文触发词
    "history", "remember", "how", "why", "what", "where", "when", 
    "who", "which", "previous", "before"
  ];
  
  const hasTrigger = triggers.some(t => 
    message.toLowerCase().includes(t.toLowerCase())
  );
  const isLongMessage = message.length > 20;
  
  return hasTrigger || isLongMessage;
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
  
  // 添加历史记忆
  if (memories.length > 0) {
    context += "💭 历史记忆:\n";
    memories.slice(0, 3).forEach((m, i) => {
      const content = m.entry?.content || m.content || "";
      context += `${i + 1}. ${content.slice(0, 100)}...\n`;
    });
    context += "\n";
  }
  
  // 添加领域知识
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
 * 提取概念（简单实现）
 */
function extractConcepts(text: string): string[] {
  // TODO: 使用 NLP 或 AI 模型提取概念
  // 当前简单实现：提取可能的技术术语
  
  const concepts: string[] = [];
  
  // 匹配大写字母开头的词组（英文术语）
  const englishPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const englishMatches = text.match(englishPattern);
  if (englishMatches) {
    concepts.push(...englishMatches);
  }
  
  // 匹配中文术语（简单启发式）
  const chinesePattern = /[\u4e00-\u9fa5]{2,}/g;
  const chineseMatches = text.match(chinesePattern);
  if (chineseMatches) {
    // 过滤常见词，保留可能的术语
    const stopWords = [
      "我们", "他们", "这个", "那个", "什么", "怎么", 
      "可以", "需要", "应该", "可能", "一个", "一些",
      "如果", "那么", "但是", "所以", "因为", "虽然"
    ];
    const filtered = chineseMatches.filter(c => !stopWords.includes(c));
    concepts.push(...filtered.slice(0, 5));
  }
  
  // 去重
  return [...new Set(concepts)];
}
