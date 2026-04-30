import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { Type } from "@sinclair/typebox";
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { MemoryHub } from "./memory/memory_hub";
import { MemorySystem } from "./memory/memory_system";
import { KnowledgeSystem } from "./knowledge/knowledge_system";
import { beforeToolCallHook } from "./hooks";
import { MemoryIndexer } from "./memory/memory_indexer";
import { IndexBuilder } from "./memory/index_builder";
import { SessionScanner } from "./memory/session_scanner";
import { WebCrawler } from "./knowledge/web_crawler";
import { buildPluginContext, getDataDir, PluginContext } from "./utils/plugin-context";
import { getLogger } from "./utils/logger";
import { validateConfig } from "./utils/config-validator";
import { getCache } from "./utils/cache";
import { runHealthCheck, formatHealthReport } from "./tools/health-check";
import { checkAndPrompt, markAsConfigured, isCronConfigured } from "./utils/cron-auto-setup";
import { EvolutionScheduler } from "./evolution/scheduler";

// Agent-isolated MemoryIndexer singletons: one per agent
const sharedMemoryIndexers = new Map<string, MemoryIndexer>();

function getOrCreateSharedMemoryIndexer(ctx: PluginContext): MemoryIndexer {
  const agentId = ctx.agentId;
  let indexer = sharedMemoryIndexers.get(agentId);
  if (!indexer) {
    indexer = new MemoryIndexer(ctx);
    indexer.init();
    sharedMemoryIndexers.set(agentId, indexer);
  }
  return indexer;
}

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
            description: "API 不可用时的降级策略: fts=全文搜索 | keyword=关键词匹配",
            default: "fts",
            enum: ["fts", "keyword"]
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

    // 检查并提示配置定时任务（仅在首次加载时）
    if (api.workspaceDir && !isCronConfigured(api.workspaceDir)) {
      checkAndPrompt(api.workspaceDir, 'current-agent');
      markAsConfigured(api.workspaceDir);
    }

    // Helper: resolve workspace directory for a given agent
    function resolveWorkspace(agentId: string, hookCtx?: any): string {
      if (hookCtx?.workspaceDir && hookCtx.workspaceDir !== '/') return hookCtx.workspaceDir;
      if (api.workspaceDir) return path.join(api.workspaceDir, '..', `workspace-${agentId}`);
      return path.join(process.env.HOME || '', '.openclaw', `workspace-${agentId}`);
    }

    // 初始化全局缓存
    const searchCache = getCache('search_results', { maxEntries: 500, defaultTTL: 10 * 60 * 1000 });

    // Agent-isolated IndexBuilder singletons: one per agent
    const sharedIndexBuilders = new Map<string, IndexBuilder>();
    // 延迟初始化：在第一次搜索时按 agentId 创建
    const initIndexBuilder = (pluginCtx: PluginContext) => {
      const agentId = pluginCtx.agentId;
      let builder = sharedIndexBuilders.get(agentId);
      if (!builder) {
        try {
          builder = new IndexBuilder(pluginCtx);
          sharedIndexBuilders.set(agentId, builder);
        } catch {
          return null;
        }
      }
      return builder;
    };

    // Agent-isolated SessionScanner singletons: one per agent
    const sharedScanners = new Map<string, SessionScanner>();
    function getOrCreateScanner(agentId: string, workspaceDir: string): SessionScanner {
      let scanner = sharedScanners.get(agentId);
      if (!scanner) {
        const ctx = { agentId, workspaceDir, storageBaseDir: process.env.HOME || '/tmp' } as any;
        scanner = new SessionScanner(ctx);
        sharedScanners.set(agentId, scanner);
      }
      return scanner;
    }

    // Agent-isolated EvolutionScheduler singletons
    const sharedSchedulers = new Map<string, EvolutionScheduler>();
    function getOrCreateScheduler(agentId: string, workspaceDir: string): EvolutionScheduler {
      let scheduler = sharedSchedulers.get(agentId);
      if (!scheduler) {
        const ctx = { agentId, workspaceDir, storageBaseDir: process.env.HOME || '/tmp' } as any;
        scheduler = new EvolutionScheduler(ctx, config.evolution);
        sharedSchedulers.set(agentId, scheduler);
      }
      return scheduler;
    }

    // ========== 注册工具 ==========

    // 1. 记忆搜索工具
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'search_memory',
        verbose: config.verbose
      });
      const memoryHub = getOrCreateHub(pluginCtx.agentId, pluginCtx.workspaceDir);
      if (memoryHub) {
        const indexBuilder = initIndexBuilder(pluginCtx);
        if (indexBuilder) {
          try { memoryHub.setIndexBuilder(indexBuilder); } catch {}
        }
      }

      return {
        name: "search_memory",
        description: "搜索历史记忆 - 支持语义搜索和关键词匹配",
        parameters: Type.Object({
          query: Type.String({ description: "搜索查询" }),
          top_k: Type.Optional(Type.Number({ description: "返回结果数量", default: 5 }))
        }),
        async execute(_id: string, params: any) {
          try {
            if (!memoryHub) {
              return { content: [{ type: "text" as const, text: "MemoryHub not available" }] };
            }
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
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'search_knowledge',
        verbose: config.verbose
      });
      const dataDir = getDataDir(pluginCtx);
      const ks = new KnowledgeSystem(pluginCtx.agentId, dataDir);
      ks.init().catch(err => console.error('[evo-cortex] KnowledgeSystem init error:', err));

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
            let results = await ks.searchEntities(params.query);
            // Apply domain filter if specified
            if (params.domain) {
              results = results.filter((r: any) => r.entity?.type === params.domain);
            }
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

    // 3. 索引管理工具（使用共享 IndexBuilder）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'manage_index',
        verbose: config.verbose
      });

      return {
        name: "manage_index",
        description: "管理记忆索引 - 查看统计信息、从数据库重建索引",
        parameters: Type.Object({
          action: Type.String({
            description: "操作类型",
            enum: ["stats", "rebuild_db"]
          })
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Action: ${params.action}`);
            const memoryIndexer = getOrCreateSharedMemoryIndexer(pluginCtx);

            if (params.action === "stats") {
              const stats = memoryIndexer.getStats();
              // 同时获取 FTS + vector 统计
              try {
                const builder = memoryIndexer.getIndexBuilder();
                builder.init();
                const indexStats = await builder.getStats();
                return {
                  content: [{
                    type: "text" as const,
                    text: JSON.stringify({ json: stats, fts_vector: indexStats }, null, 2)
                  }]
                };
              } catch {
                return {
                  content: [{
                    type: "text" as const,
                    text: JSON.stringify(stats, null, 2)
                  }]
                };
              }
            }

            if (params.action === "rebuild_db") {
              const builder = memoryIndexer.getIndexBuilder();
              builder.init();
              const result = await builder.buildFromDb();

              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify(result, null, 2)
                }]
              };
            }

            return {
              content: [{
                type: "text" as const,
                text: "Unknown action. Supported: stats, rebuild_db"
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

    // 3b. 统一搜索工具（使用共享 IndexBuilder）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'search_index',
        verbose: config.verbose
      });

      return {
        name: "search_index",
        description: "统一搜索记忆索引 - FTS 全文 + 向量语义融合搜索",
        parameters: Type.Object({
          query: Type.String({ description: "搜索查询" }),
          top_k: Type.Optional(Type.Number({ description: "返回结果数量", default: 5 })),
          embedding_enabled: Type.Optional(Type.Boolean({
            description: "是否启用向量搜索",
            default: true
          }))
        }),
        async execute(_id: string, params: any) {
          try {
            toolLogger.debug(`Unified search: "${params.query}" (top_k: ${params.top_k || 5})`);
            const memoryIndexer = getOrCreateSharedMemoryIndexer(pluginCtx);
            const builder = memoryIndexer.getIndexBuilder();
            builder.init();
            const results = await builder.unifiedSearch(
              params.query,
              params.top_k || 5,
              params.embedding_enabled !== false
            );
            toolLogger.info(`Found ${results.length} results`);

            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify(results, null, 2)
              }]
            };
          } catch (error: any) {
            toolLogger.error('Unified search failed', error);
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
      const pluginCtx = buildPluginContext(ctx, api);
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
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({ agentId: pluginCtx.agentId, component: 'memory_compress', verbose: config.verbose });
      const memoryHub = getOrCreateHub(pluginCtx.agentId, pluginCtx.workspaceDir);

      return {
        name: "memory_compress",
        description: "执行记忆压缩（daily/weekly/monthly）",
        parameters: Type.Object({
          granularity: Type.String({ description: "压缩粒度", enum: ["daily", "weekly", "monthly"] })
        }),
        async execute(_id: string, params: any) {
          try {
            if (!memoryHub) {
              return { content: [{ type: "text" as const, text: "MemoryHub not available" }] };
            }
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
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({ agentId: pluginCtx.agentId, component: 'memory_cleanup', verbose: config.verbose });
      const memoryHub = getOrCreateHub(pluginCtx.agentId, pluginCtx.workspaceDir);

      return {
        name: "memory_cleanup",
        description: "按保留策略清理过期记忆（14d/8w/2m）",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            if (!memoryHub) {
              return { content: [{ type: "text" as const, text: "MemoryHub not available" }] };
            }
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
    api.registerTool((_ctx: OpenClawPluginToolContext) => {
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
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
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

    // 12. 长期记忆搜索工具（基于 memory.db）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'search_long_term_memory',
        verbose: config.verbose
      });

      return {
        name: "search_long_term_memory",
        description: "搜索长期记忆（memory.db） - 支持重要性评分和动态排序",
        parameters: Type.Object({
          query: Type.String({ description: "搜索查询" }),
          types: Type.Optional(Type.String({ description: "记忆类型过滤（逗号分隔）" })),
          min_importance: Type.Optional(Type.Number({ description: "最低重要性分数", default: 0 })),
          limit: Type.Optional(Type.Number({ description: "返回结果数量", default: 10 }))
        }),
        async execute(_id: string, params: any) {
          try {
            const { ms } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            if (!ms) {
              return { content: [{ type: "text" as const, text: "MemorySystem not available" }] };
            }
            const queryTypes = params.types ? params.types.split(',').map((t: string) => t.trim()) : undefined;
            const results = await ms.search({
              text: params.query,
              types: queryTypes,
              minImportance: params.min_importance || 0,
              limit: params.limit || 10
            });
            toolLogger.info(`Found ${results.length} long-term memories`);
            return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('Long-term memory search failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 13. 实体列表工具（基于 knowledge.db）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'list_entities',
        verbose: config.verbose
      });

      return {
        name: "list_entities",
        description: "列出知识图谱实体 - 支持搜索和类型过滤",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "搜索查询" })),
          type: Type.Optional(Type.String({ description: "实体类型过滤" }))
        }),
        async execute(_id: string, params: any) {
          try {
            const { ks } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            if (!ks) {
              return { content: [{ type: "text" as const, text: "KnowledgeSystem not available" }] };
            }
            let results;
            if (params.query) {
              results = await ks.searchEntities(params.query);
            } else {
              // 列出所有实体（通过空搜索）
              results = await ks.searchEntities('');
            }
            if (params.type) {
              results = results.filter((e: any) => e.type === params.type);
            }
            toolLogger.info(`Found ${results.length} entities`);
            return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('List entities failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 14. 规则列表工具（基于 knowledge.db）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'list_rules',
        verbose: config.verbose
      });

      return {
        name: "list_rules",
        description: "列出知识规则 - 支持搜索",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "搜索查询" }))
        }),
        async execute(_id: string, params: any) {
          try {
            const { ks } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            if (!ks) {
              return { content: [{ type: "text" as const, text: "KnowledgeSystem not available" }] };
            }
            const results = params.query
              ? await ks.searchRules(params.query)
              : await ks.searchRules('');
            toolLogger.info(`Found ${results.length} rules`);
            return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('List rules failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 15. 记忆晋升工具 — 将工作记忆晋升到长期记忆，并触发知识提取
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'consolidate_memory',
        verbose: config.verbose
      });

      return {
        name: "consolidate_memory",
        description: "将 working_memory 中最新 100 条之后且 importance >= 7 的记录晋升到长期记忆，并触发知识图谱更新",
        parameters: Type.Object({
          run_knowledge_update: Type.Optional(Type.Boolean({ description: "是否触发知识系统更新", default: true }))
        }),
        async execute(_id: string, params: any) {
          try {
            const { ms } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            const { ks } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            if (!ms) {
              return { content: [{ type: "text" as const, text: "MemorySystem not available" }] };
            }

            const runKg = params.run_knowledge_update !== false;
            let kgUpdated = 0;

            const result = await ms.consolidate({
              onPromoted: async (ltmId: string, _row: any) => {
                if (!runKg || !ks) return;
                const memoryDb = (ms as any).db;
                if (memoryDb) {
                  await ks.updateFromLTM(ltmId, memoryDb);
                  kgUpdated++;
                }
              }
            });
            toolLogger.info(`Consolidated ${result.promoted} entries to long-term memory`);

            const stats = await ms.getStats();
            return { content: [{ type: "text" as const, text: JSON.stringify({
              promoted: result.promoted,
              knowledge_updated: kgUpdated,
              stats: { workingMemory: stats.workingMemory, longTermMemory: stats.longTermMemory }
            }, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('Consolidate failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 16. 记忆统计工具
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'memory_stats',
        verbose: config.verbose
      });

      return {
        name: "memory_stats",
        description: "查看记忆系统统计信息（工作记忆、长期记忆、实体、关系、规则）",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            const { ms } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            const { ks } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            const result: any = {};
            if (ms) {
              result.memory = await ms.getStats();
            }
            if (ks) {
              result.knowledge = await ks.getStats();
            }
            if (Object.keys(result).length === 0) {
              return { content: [{ type: "text" as const, text: "No memory systems available" }] };
            }
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('Memory stats failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 17. 知识衰减工具（cron 调用）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'decay_memory',
        verbose: config.verbose
      });

      return {
        name: "decay_memory",
        description: "对知识图谱中的实体和关系执行衰减更新（30天未提及的实体重要性 ×0.95，60天未使用的关系强度 ×0.9）",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            const { ks } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            if (!ks) {
              return { content: [{ type: "text" as const, text: "KnowledgeSystem not available" }] };
            }
            await ks.runDecayUpdates();
            toolLogger.info('Decay updates completed');
            const stats = await ks.getStats();
            return { content: [{ type: "text" as const, text: JSON.stringify({
              status: 'completed',
              entities: stats.entities,
              relations: stats.relations,
              rules: stats.rules
            }, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('Decay failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 18. 规则验证工具（cron 调用）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'validate_rules',
        verbose: config.verbose
      });

      return {
        name: "validate_rules",
        description: "验证知识图谱中的规则：标记 confidence<0.4 为过时，confidence>0.8 为核心规则",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            const { ks } = getOrCreateMemory(pluginCtx.agentId, pluginCtx.workspaceDir);
            if (!ks) {
              return { content: [{ type: "text" as const, text: "KnowledgeSystem not available" }] };
            }
            const result = await ks.validateRules();
            toolLogger.info(`Validated rules: ${result.stale} stale, ${result.core} core`);
            return { content: [{ type: "text" as const, text: JSON.stringify({
              status: 'completed',
              stale_marked: result.stale,
              core_marked: result.core
            }, null, 2) }] };
          } catch (error: any) {
            toolLogger.error('Validation failed', error);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
          }
        }
      };
    });

    // 19. 分形思考工具（cron 调用）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'fractal_thinking',
        verbose: config.verbose
      });

      return {
        name: "fractal_thinking",
        description: "执行分形思考：分析近期事件模式，生成元规则",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            const scheduler = getOrCreateScheduler(pluginCtx.agentId, pluginCtx.workspaceDir);
            await scheduler.runFractalThinking();
            toolLogger.info('Fractal thinking completed');
            return { content: [{ type: "text" as const, text: '分形思考已完成，请查看元规则文件' }] };
          } catch (error: any) {
            toolLogger.error('Fractal thinking failed', error);
            return { content: [{ type: "text" as const, text: `分形思考失败: ${error.message}` }] };
          }
        }
      };
    });

    // 20. 领域整理工具（cron 调用）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'domain_organize',
        verbose: config.verbose
      });

      return {
        name: "domain_organize",
        description: "整理领域知识：提取、组织知识图谱",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            const scheduler = getOrCreateScheduler(pluginCtx.agentId, pluginCtx.workspaceDir);
            await scheduler.organizeDomainKnowledge();
            toolLogger.info('Domain organization completed');
            return { content: [{ type: "text" as const, text: '领域知识整理已完成' }] };
          } catch (error: any) {
            toolLogger.error('Domain organization failed', error);
            return { content: [{ type: "text" as const, text: `领域知识整理失败: ${error.message}` }] };
          }
        }
      };
    });

    // 21. 领域审查工具（cron 调用）
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const pluginCtx = buildPluginContext(ctx, api);
      const toolLogger = getLogger({
        agentId: pluginCtx.agentId,
        component: 'domain_review',
        verbose: config.verbose
      });

      return {
        name: "domain_review",
        description: "审查领域知识：验证规则、检查一致性",
        parameters: Type.Object({}),
        async execute(_id: string) {
          try {
            const scheduler = getOrCreateScheduler(pluginCtx.agentId, pluginCtx.workspaceDir);
            await scheduler.reviewDomainKnowledge();
            toolLogger.info('Domain review completed');
            return { content: [{ type: "text" as const, text: '领域知识审查已完成' }] };
          } catch (error: any) {
            toolLogger.error('Domain review failed', error);
            return { content: [{ type: "text" as const, text: `领域知识审查失败: ${error.message}` }] };
          }
        }
      };
    });

    // ========== 统一实例缓存（MemorySystem 为主，KnowledgeSystem 共享）==========
    const msCache = new Map<string, MemorySystem>();
    const ksCache = new Map<string, KnowledgeSystem>();
    const hubCache = new Map<string, MemoryHub>();

    function getOrCreateHub(agentId: string, workspaceDir: string): MemoryHub | null {
      let hub = hubCache.get(agentId);
      if (!hub) {
        try {
          const pluginCtx = { agentId, workspaceDir, storageBaseDir: process.env.HOME || '/tmp' } as any;
          hub = new MemoryHub(pluginCtx, config.memory || {}, config.embedding, config.retention);
          hubCache.set(agentId, hub);
        } catch { return null; }
      }
      return hub;
    }

    function getOrCreateMemory(agentId: string, workspaceDir: string): { ms: MemorySystem | null; ks: KnowledgeSystem | null } {
      // MemorySystem
      let ms: MemorySystem | undefined = msCache.get(agentId);
      if (!ms) {
        try {
          const dataDir = path.join(workspaceDir, 'data');
          ms = new MemorySystem(agentId, dataDir, workspaceDir);
          ms.init().catch(e => getLogger({ agentId, component: 'memory_system' }).warn(`MemorySystem init failed: ${e.message}`));
          try {
            const indexer = getOrCreateSharedMemoryIndexer({ agentId, workspaceDir } as any);
            const builder = indexer.getIndexBuilder();
            const hookLogger = getLogger({ component: 'memory_system_search' });
            ms.setIndexBuilder(builder, hookLogger);
          } catch { /* IndexBuilder 不可用时降级为 LIKE 搜索 */ }
          msCache.set(agentId, ms);
        } catch { /* ignore */ }
      }
      // KnowledgeSystem
      let ks: KnowledgeSystem | undefined = ksCache.get(agentId);
      if (!ks) {
        try {
          const dataDir = path.join(workspaceDir, 'data');
          ks = new KnowledgeSystem(agentId, dataDir);
          ks.init().catch(e => getLogger({ agentId, component: 'knowledge_system' }).warn(`KnowledgeSystem init failed: ${e.message}`));
          ksCache.set(agentId, ks);
        } catch { /* ignore */ }
      }
      return { ms: msCache.get(agentId) || null, ks: ksCache.get(agentId) || null };
    }

    // ========== Hooks ==========

    // 1. message:received — 极简版：注入用户偏好 + 最近记忆标题摘要（可执行语义搜索，超时保护2s）
    const prefCache = new Map<string, { content: string; ts: number }>();
    const PREF_TTL = 5 * 60 * 1000;       // 有偏好时缓存 5 分钟
    const EMPTY_PREF_TTL = 2 * 60 * 1000; // 空结果缓存 2 分钟
    const _prefDbCache = new Map<string, any>(); // sqlite3 connection cache

    function cleanupPrefDbCache(): void {
      for (const db of _prefDbCache.values()) {
        try { db.close(); } catch { /* ignore */ }
      }
      _prefDbCache.clear();
    }

    async function loadPrefs(workspaceDir: string, agentId: string): Promise<string | null> {
      const cacheKey = agentId;
      const cached = prefCache.get(cacheKey);
      if (cached) {
        const ttl = cached.content === '' ? EMPTY_PREF_TTL : PREF_TTL;
        if (Date.now() - cached.ts < ttl) return cached.content;
      }

      try {
        const dataDir = path.join(workspaceDir, 'data', agentId);
        const kgPath = path.join(dataDir, 'knowledge.db');
        if (!fs.existsSync(kgPath)) {
          // 文件不存在也缓存，避免每次消息都检查文件系统
          prefCache.set(cacheKey, { content: '', ts: Date.now() });
          return null;
        }

        // 复用 sqlite 连接
        let db = _prefDbCache.get(agentId);
        if (!db) {
          const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
          db = new sqlite3.Database(kgPath);
          _prefDbCache.set(agentId, db);
        }

        const rows = await new Promise<any[]>((resolve, reject) => {
          db.all('SELECT category, value, confidence FROM preferences WHERE confidence >= 0.3 ORDER BY confidence DESC, updated_at DESC LIMIT 10', (err: Error | null, rows: any[]) => {
            if (err) return reject(err);
            resolve(rows || []);
          });
        });

        if (rows.length === 0) {
          // 缓存空结果 2 分钟，避免每次消息都查 DB
          prefCache.set(cacheKey, { content: '', ts: Date.now() });
          return null;
        }

        const lines = rows.map(r => `- [${r.category}] ${r.value} (conf=${r.confidence.toFixed(1)})`);
        const injection = `\n=== 用户偏好 ===\n${lines.join('\n')}\n=== 结束 ===\n`;
        prefCache.set(cacheKey, { content: injection, ts: Date.now() });
        return injection;
      } catch {
        return null;
      }
    }

    // 轻量级 shouldEnhance 判断（内联版本，避免导入 hooks 模块）
    function shouldEnhanceMessage(content: string): boolean {
      if (!content || content.trim().length < 4) return false;
      const lower = content.toLowerCase();
      const triggers = [
        "之前做过", "之前说过", "还记得", "记得吗", "上次", "以前",
        "推荐", "建议", "方案", "怎么", "如何", "什么", "哪个",
        "继续", "然后", "接下来", "还有", "补充", "详细",
        "history", "remember", "previous", "last time", "continue",
        "recommend", "suggest", "more", "detail"
      ];
      return triggers.some(t => lower.includes(t.toLowerCase()));
    }

    api.on(
      "message_received",
      async (message: any, hookCtx: any) => {
        try {
          const sessionKey = message?.sessionKey || hookCtx?.sessionKey || '';
          const parts = sessionKey.split(':');
          const agentId = parts.length >= 2 ? parts[1] : 'main';
          const workspaceDir = resolveWorkspace(agentId, hookCtx);
          const injectionParts: string[] = [];

          // --- 1. 用户偏好注入（缓存读取，独立降级）---
          try {
            if (fs.existsSync(workspaceDir)) {
              const prefs = await loadPrefs(workspaceDir, agentId);
              if (prefs) injectionParts.push(prefs);
            }
          } catch (err: any) {
            logger.debug(`hook: pref injection skipped: ${err.message}`);
          }

          // --- 2. 不再在此记录对话，由 agent_end hook 负责（AI 回复后正确配对）---
          // --- 2b. session scan 已移至 agent_end（message:received 专注读取增强）---

          // --- 3. 最近记忆摘要（MemoryHub 读取，~2ms，独立降级）---
          try {
            const { ms } = getOrCreateMemory(agentId, workspaceDir);
            if (ms) {
              const summary = await ms.getRecentDailySummary(2);
              if (summary) injectionParts.push(`\n=== 最近记忆 ===\n${summary}\n=== 结束 ===\n`);
            }
          } catch (err: any) {
            logger.debug(`hook: recent summary skipped: ${err.message}`);
          }

          // --- 4. 元规则注入（自进化闭环：rules → 上下文增强）---
          try {
            const userContent = message?.context?.content || message?.content || message?.text || '';
            if (userContent && userContent.trim().length >= 4) {
              const dataDirPath = path.join(workspaceDir, 'data', agentId);
              const kgDbPath = path.join(dataDirPath, 'knowledge.db');
              if (fs.existsSync(kgDbPath)) {
                // 用 createRequire 兼容 ESM
                const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
                const db = new sqlite3.Database(kgDbPath, sqlite3.OPEN_READONLY);
                const rules: any[] = await new Promise((resolve, reject) => {
                  db.all(
                    `SELECT id, type, title, condition, action, confidence FROM rules WHERE confidence >= 0.6 ORDER BY confidence DESC LIMIT 5`,
                    (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])
                  );
                });
                db.close();

                if (rules.length > 0) {
                  const lowerContent = userContent.toLowerCase();
                  const matchedRules = rules.filter((r: any) => {
                    if (!r.condition) return true;
                    const condLower = r.condition.toLowerCase();
                    const condKeywords = condLower.split(/[^\w\u4e00-\u9fff]+/).filter((k: string) => k.length >= 2);
                    return condKeywords.some((kw: string) => lowerContent.includes(kw));
                  });

                  if (matchedRules.length > 0) {
                    const ruleLines = matchedRules.map((r: any) =>
                      `• [${r.title}] ${r.action}`
                    ).join('\n');
                    injectionParts.push(`\n=== 适用规则（自进化） ===\n${ruleLines}\n=== 结束 ===\n`);
                  }
                }
              }
            }
          } catch (err: any) {
            logger.debug(`hook: rule injection skipped: ${err.message}`);
          }

          // --- 5. 语义检索增强（共享超时保护 + 独立降级）---
          try {
            const userContent = message?.context?.content || message?.content || message?.text || '';
            if (shouldEnhanceMessage(userContent)) {
              const searchDeadline = Date.now() + 2000; // 总预算 2s，记忆+知识共享

              // 辅助：根据剩余时间创建 Promise.race 超时
              const remainingTimeout = () => {
                const remaining = Math.max(0, searchDeadline - Date.now());
                return new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('search timeout')), remaining)
                );
              };

              let memories: any[] | undefined;
              try {
                const { ms } = getOrCreateMemory(agentId, workspaceDir);
                if (ms) {
                  memories = await Promise.race([
                    ms.search({ text: userContent, limit: 3 }),
                    remainingTimeout()
                  ]) as any[];
                } else {
                  throw new Error('MemorySystem unavailable');
                }
              } catch {
                // MemorySystem 不可用，直接查询 memory.db（A3 修复）
                const dataDir = path.join(workspaceDir, 'data', agentId);
                const memDbPath = path.join(dataDir, 'memory.db');
                if (fs.existsSync(memDbPath)) {
                  const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
                  const db = new sqlite3.Database(memDbPath, sqlite3.OPEN_READONLY);
                  try {
                    const terms = userContent.split(/\s+/).filter(Boolean).slice(0, 3);
                    const likes = terms.map((_t: string) => `content LIKE ?`).join(' OR ');
                    const params = terms.flatMap((t: string) => `%${t}%`);
                    memories = await Promise.race([
                      new Promise<any[]>((resolve, reject) => {
                        db.all(
                          `SELECT id, type, title, content, importance FROM working_memory WHERE ${likes} ORDER BY importance DESC LIMIT 3`,
                          params,
                          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])
                        );
                      }),
                      remainingTimeout()
                    ]) as any[];
                  } finally {
                    db.close();
                  }
                }
              }

              if (memories && memories.length > 0) {
                const contextLines = memories.slice(0, 3).map((m: any, i: number) => {
                  const title = m.title || m.topic || `记忆${i + 1}`;
                  const snippet = (m.content || m.summary || '').substring(0, 200);
                  return `[${title}] ${snippet}`;
                }).join('\n');
                injectionParts.push(`\n=== 相关记忆 ===\n${contextLines}\n=== 结束 ===\n`);
              }

              // 知识图谱搜索（独立降级，使用剩余时间预算）
              try {
                const { ks } = getOrCreateMemory(agentId, workspaceDir);
                if (ks) {
                  const knowledge = await Promise.race([
                    ks.searchEntities(userContent),
                    remainingTimeout()
                  ]) as any[];
                  if (knowledge && knowledge.length > 0) {
                    const kgLines = knowledge.slice(0, 3).map((k: any, _i: number) => {
                      const name = k.entity?.name || k.name || '未知';
                      const type = k.entity?.type || k.type || 'unknown';
                      const desc = (k.entity?.description || k.description || '').substring(0, 150);
                      return `${name} (${type}): ${desc}`;
                    }).join('\n');
                    injectionParts.push(`\n=== 相关知识 ===\n${kgLines}\n=== 结束 ===\n`);
                  }
                }
              } catch (err: any) {
                // 知识搜索失败不影响记忆检索结果，静默降级
                getLogger({ component: 'message_received' }).debug(`knowledge search skipped: ${err.message}`);
              }
            }
          } catch (err: any) {
            // 搜索超时或失败不影响正常对话，静默降级
            if (err.message !== 'search timeout') {
              getLogger({ component: 'message_received' }).debug(`semantic search skipped: ${err.message}`);
            }
          }

          if (injectionParts.length === 0) return {};
          return { system_prompt_addition: injectionParts.join('\n') };
        } catch (error: any) {
          // 终极保护：即使上面所有 try/catch 都没拦住，外层也要返回空对象而不是抛异常
          logger.error('message_received hook failed', error);
          return {};
        }
      }
    );

    // 3. agent_end — AI 回复完成后记录完整对话对（用户问 → AI 答）
    // 需要 allowConversationAccess: true（已在 openclaw.json 配置）
    api.on(
      "agent_end",
      async (event: any, ctx: any) => {
        try {
          const sessionKey = ctx?.sessionKey || '';
          const parts = sessionKey.split(':');
          const agentId = parts.length >= 2 ? parts[1] : 'main';
          // 允许所有 agent（包括 main）使用此插件
          if (!agentId) return;

          const workspaceDir = resolveWorkspace(agentId, ctx);
          const logger = getLogger({ component: 'agent_end', agentId });

          // 从 event.messages 中提取最后一条用户消息和 AI 回复
          const messages = event?.messages || [];
          let lastUserMsg = '';
          let lastAiMsg = '';

          // 清洗用户消息：兼容 TUI、webchat 等多种格式，提取纯文本内容
          const cleanContent = (raw: string): string => {
            const lines = raw.split('\n');
            let inCodeFence = false;
            let messageParts: string[] = [];
            let inSenderBlock = false;
            for (const line of lines) {
              const trimmed = line.trim();
              // 跳过 code fence
              if (trimmed.startsWith('```')) { inCodeFence = !inCodeFence; continue; }
              if (inCodeFence) continue;
              // 跳过 TUI Sender 元数据块
              if (trimmed.startsWith('Sender')) { inSenderBlock = true; continue; }
              if (inSenderBlock) {
                if (trimmed.startsWith('```') || (trimmed.startsWith('[') && /\d{4}-\d{2}-\d{2}/.test(trimmed))) {
                  inSenderBlock = false;
                  // 如果是时间戳行，继续处理
                } else {
                  continue;
                }
              }
              // 跳过 JSON 元数据
              if (trimmed.startsWith('{') || trimmed.startsWith('}') || trimmed.startsWith('"') || trimmed.endsWith(',')) continue;
              // 识别时间戳行：提取时间戳后面的消息正文
              const tsMatch = trimmed.match(/^\[\w+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}[\s\w:+-]*\]\s*(.*)/);
              if (tsMatch) {
                if (tsMatch[1]) messageParts.push(tsMatch[1]);
                continue;
              }
              // 收集正文行
              if (trimmed.length > 0) messageParts.push(trimmed);
            }
            const cleaned = messageParts.join(' ').trim();
            return cleaned || raw;
          };

          // 从后往前找最后一条 user 和最后一条 assistant 消息
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const role = msg?.role;
            let content = msg?.content || '';
            if (Array.isArray(content)) {
              content = content
                .filter((t: any) => t.type === 'text')
                .map((t: any) => t.text)
                .join(' ');
            }
            if (role === 'assistant' && !lastAiMsg && content && content.length > 5) {
              lastAiMsg = content;
            }
            if (role === 'user' && !lastUserMsg && content && content.length > 2) {
              lastUserMsg = cleanContent(content);
            }
            if (lastUserMsg && lastAiMsg) break;
          }

          if (!lastAiMsg && !lastUserMsg) return;

          const { ms } = getOrCreateMemory(agentId, workspaceDir);
          if (ms) {
            const pairContent = lastUserMsg && lastAiMsg
              ? `User: ${lastUserMsg}\n\nAI: ${lastAiMsg}`
              : lastUserMsg
                ? `User: ${lastUserMsg}`
                : `AI: ${lastAiMsg}`;
            ms.record({
              type: 'conversation',
              content: pairContent,
              source: 'hook',
              sourceRef: agentId,
            }).catch((err: any) => logger.debug(`record failed: ${err.message}`));
            logger.info(`agent_end: recorded pair (user=${lastUserMsg.length > 0}, ai=${lastAiMsg.length > 0})`);

            // 知识自动提取需通过 consolidate_memory 工具（从 LTM 到 knowledge.db）

            // 持久化到 memory/*.md（异步，不阻塞回复）
            try {
              ms.persistToMarkdown({
                type: 'conversation',
                content: pairContent,
                source: 'hook',
                sourceRef: agentId,
              }).catch((err: any) => logger.debug(`persist failed: ${err.message}`));
            } catch (err: any) {
              logger.debug(`persist skipped: ${err.message}`);
            }
          }

          // --- 当前会话偏好提取（不依赖 session scanner）---
          try {
            if (lastUserMsg && lastUserMsg.length > 5) {
              const prefs = SessionScanner.extractFromText(lastUserMsg);
              if (prefs.length > 0) {
                const { ks } = getOrCreateMemory(agentId, workspaceDir);
                if (ks) {
                  for (const pref of prefs) {
                    await ks.savePreference(pref);
                  }
                  logger.info(`agent_end: saved ${prefs.length} pref(s) via KnowledgeSystem: ${prefs.map(p => `[${p.category}] ${p.value}`).join(', ')}`);
                }
              }
            }
          } catch (err: any) {
            logger.debug(`agent_end: preference extraction skipped: ${err.message}`);
          }

          // --- session scanner：使用缓存实例，fire-and-forget ---
          try {
            const scanner = getOrCreateScanner(agentId, workspaceDir);
            scanner.scan().then(r => {
              if (r.newSessions > 0 || r.preferencesExtracted > 0 || r.promoted > 0) {
                logger.info(`session scan: ${r.scanned} scanned, ${r.newSessions} new, ${r.preferencesExtracted} prefs, ${r.promoted} promoted`);
              }
            }).catch(err => logger.debug(`session scan failed: ${err.message}`));
          } catch (err: any) {
            logger.debug(`session scanner skipped: ${err.message}`);
          }
        } catch (err: any) {
          logger.debug(`agent_end hook error: ${err.message}`);
        }
      },
      { priority: 50 }
    );

    // 4. before:tool_call hook — 工具调用前安全检查
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

    // 插件卸载时清理缓存的 DB 连接
    process.once('SIGTERM', cleanupPrefDbCache);
    process.once('SIGINT', cleanupPrefDbCache);

    logger.debug('All tools, hooks, and crons registered successfully');
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
// memory_hub 保留兼容层
export { MemoryHub, MemoryConfig, MemorySearchResult, CleanupReport, CompressionReport } from './memory/memory_hub';
// memory_system 新系统（重命名避免冲突）
export { MemorySystem } from './memory/memory_system';
export type { MemoryEntry as MemorySystemEntry, SearchResult as MemorySearchResultV2, SearchQuery as MemorySearchQuery } from './memory/memory_system';
// knowledge_graph 已迁移到 knowledge_system，类型通过 knowledge_system 导出
export type { KnowledgeConfig, KnowledgeSearchResult } from './knowledge/knowledge_system';
// knowledge_system 新系统
export { KnowledgeSystem } from './knowledge/knowledge_system';
export type { KnowledgeEntity as KnowledgeEntityV2, KnowledgeRelation as KnowledgeRelationV2, KnowledgeRule, SearchQuery as KnowledgeSearchQuery } from './knowledge/knowledge_system';
export * from './evolution/scheduler';
