import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { Type } from "@sinclair/typebox";
import { MemoryHub } from "./memory/memory_hub";
import { KnowledgeGraph } from "./knowledge/knowledge_graph";
import { EvolutionScheduler } from "./evolution/scheduler";
import {
  messageReceivedHook,
  messageSentHook,
  beforeToolCallHook
} from "./hooks";
import { MemoryIndexer } from "./memory/memory_indexer";
import { SessionScanner } from "./memory/session_scanner";
import { WebCrawler } from "./knowledge/web_crawler";
import { buildPluginContext, getMemoryStorageDir, getKnowledgeStorageDir, getDataDir } from "./utils/plugin-context";
import { getLogger } from "./utils/logger";
import { validateConfig, getConfigSummary } from "./utils/config-validator";
import type { RetentionPolicy } from "./utils/config-validator";
import { getCache } from "./utils/cache";
import { runHealthCheck, formatHealthReport } from "./tools/health-check";
import { checkAndPrompt, markAsConfigured, isCronConfigured } from "./utils/cron-auto-setup";

// 全局标志：确保废弃警告只显示一次
let deprecationWarningShown = false;

const plugin = {
  id: "evo-cortex",
  name: "Evo-Cortex Plugin",
  description: "完整的记忆、学习和进化能力 - Give Your Agent a Brain",
  configSchema: {
    type: "object" as const,
    additionalProperties: true,
    properties: {
      agent_name: {
        type: "string",
        description: "⚠️ 已废弃：插件现在会自动从上下文获取 agent ID",
        deprecated: true
      },
      memory: {
        type: "object",
        description: "记忆系统配置",
        properties: {
          enabled: { type: "boolean", default: true },
          top_k: { type: "number", description: "搜索结果数量", default: 5 },
          auto_store: { type: "boolean", description: "是否自动存储对话", default: true }
        }
      },
      retention: {
        type: "object",
        description: "记忆保留策略 - 分层清理",
        properties: {
          daily: { type: "number", description: "日记忆保留天数", default: 14 },
          weekly: { type: "number", description: "周摘要保留周数", default: 8 },
          monthly: { type: "number", description: "月概述保留月数", default: 2 }
        }
      },
      evolution: {
        type: "object",
        description: "进化系统配置",
        properties: {
          enabled: { type: "boolean", default: true },
          fractal_thinking: { type: "boolean", description: "是否启用分形思考", default: true },
          active_learning: { type: "boolean", description: "是否启用主动学习", default: true }
        }
      },
      knowledge: {
        type: "object",
        description: "知识系统配置",
        properties: {
          enabled: { type: "boolean", default: true },
          auto_expand: { type: "boolean", description: "是否自动扩展知识图谱", default: true }
        }
      },
      embedding: {
        type: "object",
        description: "语义搜索配置 - 控制记忆和知识搜索的搜索模式",
        properties: {
          enabled: { type: "boolean", description: "是否启用语义搜索", default: true },
          mode: { 
            type: "string", 
            description: "搜索模式: auto=自动降级 | semantic=仅语义 | keyword=仅关键词",
            default: "auto",
            enum: ["auto", "semantic", "keyword"]
          },
          fallback: { 
            type: "string", 
            description: "API 不可用时的降级策略: tfidf=本地TF-IDF | keyword=关键词匹配",
            default: "tfidf",
            enum: ["tfidf", "keyword"]
          }
        }
      },
      verbose: {
        type: "boolean",
        description: "启用详细日志模式",
        default: false
      }
    },
    required: []
  },

  /**
   * 插件注册函数
   *
   * 关键改进：
   * 1. 不再硬编码 agent 名称，使用工厂函数动态获取上下文
   * 2. 所有路径使用绝对路径，避免 process.cwd() 问题
   * 3. 钩子和工具都为每个 agent 创建独立实例
   * 4. 添加 CLI 命令支持
   * 5. 使用统一日志系统
   */
  register(api: OpenClawPluginApi) {
    // 验证并合并配置
    const rawConfig = (api.pluginConfig as any) || {};
    const config = validateConfig(rawConfig);

    const logger = getLogger({
      agentId: 'main', // 初始化为 main，实际使用时会动态获取
      component: 'Plugin',
      verbose: config.verbose
    });

    // 显示配置警告（只在首次加载时）
    for (const warning of config.warnings) {
      if (!deprecationWarningShown) {
        logger.warn(warning, true);
      }
    }
    deprecationWarningShown = true;

    logger.info(`Plugin registered. Enabled modules: ${getConfigSummary(config)}`);
    logger.debug(`Workspace: ${api.workspaceDir || 'default'}`);

    // 检查并提示配置定时任务（仅在首次加载时）
    if (api.workspaceDir && !isCronConfigured(api.workspaceDir)) {
      checkAndPrompt(api.workspaceDir, 'current-agent');
      // 标记为已提示，避免每次加载都显示
      markAsConfigured(api.workspaceDir);
    }

    // 初始化全局缓存
    const searchCache = getCache('search_results', { maxEntries: 500, defaultTTL: 10 * 60 * 1000 });

    // ========== 注册工具（使用工厂函数模式）==========

    // 1. 记忆搜索工具
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'search_memory',
        verbose: config.verbose
      });
      const memoryHub = new MemoryHub(pluginCtx, config.memory || {}, config.embedding, config.retention);

      return {
        name: "search_memory",
        description: "搜索历史记忆 - 支持语义搜索和关键词匹配",
        parameters: Type.Object({
          query: Type.String({ description: "搜索查询" }),
          top_k: Type.Optional(Type.Number({ description: "返回结果数量", default: 5 }))
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Searching for: "${params.query}" (top_k: ${params.top_k || 5})`);
            const results = await memoryHub.search(params.query, params.top_k || 5);
            toolLogger.info(`Found ${results.length} results`);

            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify(results, null, 2)
              }]
            };
          } catch (error: any) {
            toolLogger.error('Search failed', error);
            return {
              content: [{
                type: "text" as const,
                text: `Error searching memory: ${error.message}`
              }]
            };
          }
        }
      };
    });

    // 2. 知识检索工具
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'search_knowledge',
        verbose: config.verbose
      });
      const knowledgeGraph = new KnowledgeGraph(pluginCtx, config.knowledge);

      return {
        name: "search_knowledge",
        description: "检索领域知识 - 支持实体和关系查询",
        parameters: Type.Object({
          query: Type.String({ description: "搜索查询" }),
          domain: Type.Optional(Type.String({ description: "领域筛选" }))
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Searching knowledge: "${params.query}"${params.domain ? ` (domain: ${params.domain})` : ''}`);
            const results = await knowledgeGraph.search(params.query, params.domain);
            toolLogger.info(`Found ${results.length} results`);

            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify(results, null, 2)
              }]
            };
          } catch (error: any) {
            toolLogger.error('Search failed', error);
            return {
              content: [{
                type: "text" as const,
                text: `Error searching knowledge: ${error.message}`
              }]
            };
          }
        }
      };
    });

    // 3. 索引管理工具
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'manage_index',
        verbose: config.verbose
      });
      const memoryIndexer = new MemoryIndexer(pluginCtx);
      memoryIndexer.init();

      return {
        name: "manage_index",
        description: "管理记忆索引 - 查看统计信息",
        parameters: Type.Object({
          action: Type.String({
            description: "操作类型",
            enum: ["stats"]
          })
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Action: ${params.action}`);

            if (params.action === "stats") {
              const stats = memoryIndexer.getStats();
              toolLogger.info(`Stats: ${stats.documents} documents`);

              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify(stats, null, 2)
                }]
              };
            }

            return {
              content: [{
                type: "text" as const,
                text: "Unknown action. Supported: stats"
              }]
            };
          } catch (error: any) {
            toolLogger.error('Index operation failed', error);
            return {
              content: [{
                type: "text" as const,
                text: `Error: ${error.message}`
              }]
            };
          }
        }
      };
    });

    // 10. 会话扫描工具
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'scan_sessions',
        verbose: config.verbose
      });
      const sessionScanner = new SessionScanner(pluginCtx);

      return {
        name: "scan_sessions",
        description: "扫描并导入 Agent 会话到记忆系统",
        parameters: Type.Object({
          full: Type.Optional(Type.Boolean({
            description: "是否全量扫描（重置状态）",
            default: false
          }))
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Scanning sessions (full: ${params.full || false})`);

            if (params.full) {
              sessionScanner.resetState();
              toolLogger.info('Scan state reset');
            }

            const result = await sessionScanner.scan();
            toolLogger.info(`Scan complete: ${result.scanned} scanned, ${result.newSessions} new`);

            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error: any) {
            toolLogger.error('Session scan failed', error);
            return {
              content: [{
                type: "text" as const,
                text: `Error scanning sessions: ${error.message}`
              }]
            };
          }
        }
      };
    });

    // 7. 记忆压缩工具
    api.registerTool((ctx) => {
      const pluginCtx = buildPluginContext(ctx);
      const toolLogger = getLogger({ agentId: pluginCtx.agentId, component: 'memory_compress', verbose: config.verbose });
      const memoryHub = new MemoryHub(pluginCtx, config.memory || {}, config.embedding, config.retention);

      return {
        name: "memory_compress",
        description: "执行记忆压缩（daily/weekly/monthly）",
        parameters: Type.Object({
          granularity: Type.String({ description: "压缩粒度", enum: ["daily", "weekly", "monthly"] })
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Compressing: ${params.granularity}`);
            let report;
            if (params.granularity === 'daily') report = await memoryHub.compressDaily();
            else if (params.granularity === 'weekly') report = await memoryHub.compressWeekly();
            else report = await memoryHub.compressMonthly();
            return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('Compression failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 8. 记忆清理工具
    api.registerTool((ctx) => {
      const pluginCtx = buildPluginContext(ctx);
      const toolLogger = getLogger({ agentId: pluginCtx.agentId, component: 'memory_cleanup', verbose: config.verbose });
      const memoryHub = new MemoryHub(pluginCtx, config.memory || {}, config.embedding, config.retention);

      return {
        name: "memory_cleanup",
        description: "按保留策略清理过期记忆（14d/8w/2m）",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            const report = memoryHub.cleanup();
            toolLogger.info(`Cleanup: ${report.dailyRemoved}d ${report.weeklyRemoved}w ${report.monthlyRemoved}m removed`);
            return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('Cleanup failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 9. 网络爬取工具（不需要 agent 上下文）
    api.registerTool(() => {
      const toolLogger = getLogger({
        component: 'crawl_web',
        verbose: config.verbose
      });
      const webCrawler = new WebCrawler();

      return {
        name: "crawl_web",
        description: "抓取网页内容并提取知识",
        parameters: Type.Object({
          url: Type.String({ description: "网页 URL" })
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Crawling: ${params.url}`);
            const knowledge = await webCrawler.extractKnowledge(params.url);
            toolLogger.info(`Successfully crawled ${params.url}`);

            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify(knowledge, null, 2)
              }]
            };
          } catch (error: any) {
            toolLogger.error('Web crawl failed', error);
            return {
              content: [{
                type: "text" as const,
                text: `Failed to crawl: ${error.message}`
              }]
            };
          }
        }
      };
    });

    // 11. 健康检查工具
    api.registerTool((ctx) => {
      const pluginCtx = buildPluginContext(ctx);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'health_check',
        verbose: config.verbose
      });

      return {
        name: "health_check",
        description: "执行插件健康检查，诊断问题并提供优化建议",
        parameters: Type.Object({
          format: Type.Optional(Type.String({
            description: "输出格式：json 或 text",
            enum: ["json", "text"],
            default: "text"
          }))
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug('Running health check...');

            const report = await runHealthCheck(pluginCtx, config, searchCache);

            if (params.format === 'json') {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify(report, null, 2)
                }]
              };
            } else {
              const formatted = formatHealthReport(report);
              toolLogger.info(`Health check complete: ${report.status}`);

              return {
                content: [{
                  type: "text" as const,
                  text: formatted
                }]
              };
            }
          } catch (error: any) {
            toolLogger.error('Health check failed', error);
            return {
              content: [{
                type: "text" as const,
                text: `Health check failed: ${error.message}`
              }]
            };
          }
        }
      };
    });

    // ========== 实例缓存（避免每次 hook 都重建）==========
    const hubCache = new Map<string, { memoryHub: MemoryHub; knowledgeGraph: KnowledgeGraph }>();

    function getOrCreateHub(agentId: string, pluginCtx: any): { memoryHub: MemoryHub; knowledgeGraph: KnowledgeGraph } {
      let cached = hubCache.get(agentId);
      if (!cached) {
        cached = {
          memoryHub: new MemoryHub(pluginCtx, config.memory, config.embedding, config.retention),
          knowledgeGraph: new KnowledgeGraph(pluginCtx, config.knowledge)
        };
        hubCache.set(agentId, cached);
      }
      return cached;
    }

    // 1. message_received hook - 保存对话到记忆
    api.registerHook(
      "message:received",
      async (message: any, hookCtx: any) => {
        try {
          const pluginCtx = buildPluginContext(hookCtx, api);
          const hookLogger = getLogger({
            agentId: pluginCtx.agentId,
            component: 'message_received',
            verbose: config.verbose
          });

          const { memoryHub, knowledgeGraph } = getOrCreateHub(pluginCtx.agentId, pluginCtx);

          const result = await messageReceivedHook(message, memoryHub, knowledgeGraph, pluginCtx.agentId, hookLogger);

          if (result.system_prompt_addition) {
            hookLogger.hook('message_received', `Enhanced with ${result.memories?.length || 0} memories, ${result.knowledge?.length || 0} knowledge`);
          }

          return result;
        } catch (error: any) {
          logger.error('message_received hook failed', error);
          return {};
        }
      },
      {
        name: "evo-cortex-message-received",
        description: "Save conversation to memory and enhance context with knowledge graph",
        entry: {
          hook: {
            name: "evo-cortex-message-received",
            description: "Save conversation to memory and enhance context with knowledge graph"
          }
        }
      }
    );

    // 2. message:sent hook - 消息发出后存储记忆、提取概念
    api.registerHook(
      "message:sent",
      async (message: any, hookCtx: any) => {
        try {
          const pluginCtx = buildPluginContext(hookCtx, api);
          const hookLogger = getLogger({
            agentId: pluginCtx.agentId,
            component: 'message_sent',
            verbose: config.verbose
          });
          const { memoryHub, knowledgeGraph } = getOrCreateHub(pluginCtx.agentId, pluginCtx);

          const result = await messageSentHook(message, memoryHub, knowledgeGraph, pluginCtx.agentId, hookLogger);
          hookLogger.hook('message_sent', 'Memory stored after message sent');

          return result;
        } catch (error: any) {
          logger.error('message_sent hook failed', error);
          return {};
        }
      },
      {
        name: "evo-cortex-message-sent",
        description: "Store memory and extract concepts after message sent",
        entry: {
          hook: {
            name: "evo-cortex-message-sent",
            description: "Store memory and extract concepts after message sent"
          }
        }
      }
    );

    // 3. before:tool_call hook - 工具调用前安全检查
    api.registerHook(
      "before:tool_call",
      async (toolCall: any) => {
        try {
          const hookLogger = getLogger({ component: 'before_tool_call' });

          const result = await beforeToolCallHook(toolCall, hookLogger);

          if (result.block) {
            hookLogger.hook('before_tool_call', `Blocked sensitive tool: ${toolCall.name}`);
          }

          return result;
        } catch (error: any) {
          logger.error('before_tool_call hook failed', error);
          return { block: false };
        }
      },
      {
        name: "evo-cortex-before-tool-call",
        description: "Security check before tool execution",
        entry: {
          hook: {
            name: "evo-cortex-before-tool-call",
            description: "Security check before tool execution"
          }
        }
      }
    );

    // ========== 定时任务说明 ==========
    // Cron 需要通过 openclaw cron 命令单独配置
    // 示例：
    // openclaw cron add --schedule "0 * * * *" --payload '{"kind":"agentTurn","message":"运行分形思考"}' --sessionTarget isolated

    logger.info('Use openclaw cron to configure scheduled tasks');
    logger.info('All tools, hooks, and crons registered successfully');
  },
};

export default plugin;

// ========== 类型导出（供其他插件复用）==========
export * from './utils/errors';
export * from './utils/performance';
export * from './utils/logger';
export * from './utils/cache';
export * from './utils/config-validator';
export * from './utils/plugin-context';
export * from './memory/memory_hub';
export * from './knowledge/knowledge_graph';
export * from './evolution/scheduler';
