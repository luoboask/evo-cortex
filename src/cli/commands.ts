/**
 * CLI Commands - Evo-Cortex 插件命令行接口
 * 
 * 提供直接通过 CLI 调用插件功能的命令
 */

import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/core";
import { buildPluginContext } from "../utils/plugin-context";
import { MemoryHub } from "../memory/memory_hub";
import { KnowledgeGraph } from "../knowledge/knowledge_graph";
import { SessionScanner } from "./../memory/session_scanner";

export function registerCliCommands(ctx: OpenClawPluginCliContext, config: any) {
  const { program, logger } = ctx;

  // ========== knowledge-search 命令 ==========
  program
    .command('knowledge-search <query> [domain]')
    .description('检索领域知识 - 支持实体和关系查询')
    .option('--agent <agent>', '指定 Agent ID（默认：当前 agent）')
    .option('--top-k <number>', '返回结果数量', '5')
    .option('--json', '输出 JSON 格式')
    .action(async (query: string, domain: string | undefined, options: any) => {
      try {
        const pluginCtx = buildPluginContext({
          agentId: options.agent || 'main',
          workspaceDir: ctx.workspaceDir,
          storageBaseDir: process.env.HOME ? `${process.env.HOME}/.openclaw` : '/tmp/.openclaw'
        });
        
        const knowledgeGraph = new KnowledgeGraph(pluginCtx, config.knowledge);
        const results = await knowledgeGraph.search(query, domain);
        
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          console.log(`\n📖 知识检索结果："${query}"${domain ? ` (领域：${domain})` : ''}\n`);
          if (results.length === 0) {
            console.log('未找到相关知识。\n');
          } else {
            results.forEach((result, i) => {
              console.log(`${i + 1}. ${result.entity.name} (${result.entity.type})`);
              console.log(`   相关性：${(result.score * 100).toFixed(1)}%`);
              if (result.relations.length > 0) {
                console.log(`   关联：${result.relations.map(r => r.type).join(', ')}`);
              }
              console.log();
            });
          }
        }
      } catch (error: any) {
        logger.error(`知识检索失败：${error.message}`);
        process.exit(1);
      }
    });

  // ========== scan-sessions 命令 ==========
  program
    .command('scan-sessions')
    .description('扫描并导入 Agent 会话到记忆系统')
    .option('--agent <agent>', '指定 Agent ID（默认：当前 agent）')
    .option('--full', '全量扫描（重置状态）')
    .option('--json', '输出 JSON 格式')
    .action(async (options: any) => {
      try {
        const pluginCtx = buildPluginContext({
          agentId: options.agent || 'main',
          workspaceDir: ctx.workspaceDir,
          storageBaseDir: process.env.HOME ? `${process.env.HOME}/.openclaw` : '/tmp/.openclaw'
        });
        
        const sessionScanner = new SessionScanner(pluginCtx);
        
        if (options.full) {
          sessionScanner.resetState();
          console.log('🔄 已重置扫描状态\n');
        }
        
        console.log('🔍 开始扫描会话...\n');
        const result = await sessionScanner.scan();
        
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('\n📊 扫描结果:\n');
          console.log(`  扫描会话数：${result.scanned}`);
          console.log(`  新增会话：${result.newSessions}`);
          console.log(`  更新会话：${result.updatedSessions}`);
          console.log(`  跳过会话：${result.skipped}`);
          console.log(`  保存记忆：${result.memoriesSaved}`);
          console.log();
        }
      } catch (error: any) {
        logger.error(`会话扫描失败：${error.message}`);
        process.exit(1);
      }
    });

  // ========== memory-stats 命令 ==========
  program
    .command('memory-stats')
    .description('查看记忆系统统计信息')
    .option('--agent <agent>', '指定 Agent ID（默认：当前 agent）')
    .option('--json', '输出 JSON 格式')
    .action(async (options: any) => {
      try {
        const pluginCtx = buildPluginContext({
          agentId: options.agent || 'main',
          workspaceDir: ctx.workspaceDir,
          storageBaseDir: process.env.HOME ? `${process.env.HOME}/.openclaw` : '/tmp/.openclaw'
        });
        
        const memoryHub = new MemoryHub(pluginCtx, config.memory);
        const stats = memoryHub.getStats();
        
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(`\n💭 记忆统计 (${pluginCtx.agentId})\n`);
          console.log(`  总记忆数：${stats.total}`);
          console.log('\n  按类型分布:');
          for (const [type, count] of Object.entries(stats.byType)) {
            console.log(`    ${type}: ${count}`);
          }
          console.log();
        }
      } catch (error: any) {
        logger.error(`获取统计失败：${error.message}`);
        process.exit(1);
      }
    });

  // ========== knowledge-stats 命令 ==========
  program
    .command('knowledge-stats')
    .description('查看知识图谱统计信息')
    .option('--agent <agent>', '指定 Agent ID（默认：当前 agent）')
    .option('--json', '输出 JSON 格式')
    .action(async (options: any) => {
      try {
        const pluginCtx = buildPluginContext({
          agentId: options.agent || 'main',
          workspaceDir: ctx.workspaceDir,
          storageBaseDir: process.env.HOME ? `${process.env.HOME}/.openclaw` : '/tmp/.openclaw'
        });
        
        const knowledgeGraph = new KnowledgeGraph(pluginCtx, config.knowledge);
        const stats = knowledgeGraph.getStats();
        
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(`\n📚 知识图谱统计 (${pluginCtx.agentId})\n`);
          console.log(`  实体总数：${stats.totalEntities}`);
          console.log(`  关系总数：${stats.totalRelations}`);
          console.log('\n  按类型分布:');
          for (const [type, count] of Object.entries(stats.byType)) {
            console.log(`    ${type}: ${count}`);
          }
          console.log();
        }
      } catch (error: any) {
        logger.error(`获取统计失败：${error.message}`);
        process.exit(1);
      }
    });
}
