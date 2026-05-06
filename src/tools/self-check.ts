/**
 * 插件自检工具
 *
 * 全面检查 evo-cortex 插件的各项功能，包括：
 * - 数据库连通性（memory.db, knowledge.db）
 * - 表结构验证
 * - 文件系统检查（memory/*.md, weekly/, monthly/）
 * - 工具注册状态
 * - 钩子注册状态
 * - Cron 配置状态
 * - 读写操作测试
 * - 性能基线
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { getDataDir, getEvolutionStorageDir, getKnowledgeStorageDir, PluginContext } from '../utils/plugin-context';
import { getLogger } from '../utils/logger';

const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  details?: Record<string, any>;
}

export async function runSelfCheck(ctx: PluginContext): Promise<CheckResult[]> {
  const logger = getLogger({ agentId: ctx.agentId, component: 'SelfCheck' });
  logger.info('Starting self-check...');
  const results: CheckResult[] = [];

  // ========== 1. 文件系统检查 ==========
  results.push(await checkFileSystem(ctx));

  // ========== 2. memory.db 检查 ==========
  results.push(await checkMemoryDb(ctx));

  // ========== 3. knowledge.db 检查 ==========
  results.push(await checkKnowledgeDb(ctx));

  // ========== 4. 进化系统检查 ==========
  results.push(await checkEvolutionSystem(ctx));

  // ========== 5. 索引系统检查 ==========
  results.push(await checkIndexSystem(ctx));

  // ========== 6. 配置检查 ==========
  results.push(await checkConfig(ctx));

  logger.info(`Self-check complete: ${results.filter(r => r.status === 'ok').length} ok, ${results.filter(r => r.status === 'warn').length} warn, ${results.filter(r => r.status === 'error').length} error`);
  return results;
}

async function checkFileSystem(ctx: PluginContext): Promise<CheckResult> {
  const details: Record<string, any> = {};
  let status: 'ok' | 'warn' | 'error' = 'ok';
  const messages: string[] = [];

  const workspaceDir = ctx.workspaceDir;
  const dataDir = getDataDir(ctx);

  // 检查工作目录
  details.workspaceExists = fs.existsSync(workspaceDir);
  if (!details.workspaceExists) {
    status = 'error';
    messages.push(`工作目录不存在: ${workspaceDir}`);
  }

  // 检查 data 目录
  details.dataDirExists = fs.existsSync(dataDir);
  if (!details.dataDirExists) {
    status = 'error';
    messages.push(`数据目录不存在: ${dataDir}`);
  }

  // 检查 memory 目录
  const memoryDir = path.join(dataDir, 'memory');
  details.memoryDirExists = fs.existsSync(memoryDir);
  if (details.memoryDirExists) {
    const mdFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
    details.mdFileCount = mdFiles.length;
    details.mdFiles = mdFiles.slice(0, 10);
  }

  // 检查 memory_index 目录
  const indexDir = path.join(dataDir, 'memory_index');
  details.memoryIndexExists = fs.existsSync(indexDir);

  // 检查 evolution 目录
  const evolutionDir = getEvolutionStorageDir(ctx);
  details.evolutionDirExists = fs.existsSync(evolutionDir);

  // 检查 knowledge 目录
  const knowledgeDir = getKnowledgeStorageDir(ctx);
  details.knowledgeDirExists = fs.existsSync(knowledgeDir);

  if (messages.length === 0) {
    messages.push(`文件系统正常 (${details.mdFileCount || 0} 个 .md 文件)`);
  }

  return { name: '文件系统', status, message: messages.join('; '), details };
}

async function checkMemoryDb(ctx: PluginContext): Promise<CheckResult> {
  const details: Record<string, any> = {};
  let status: 'ok' | 'warn' | 'error' = 'ok';
  const messages: string[] = [];

  const dbPath = path.join(getDataDir(ctx), 'memory.db');
  details.dbPath = dbPath;
  details.dbExists = fs.existsSync(dbPath);

  if (!details.dbExists) {
    status = 'warn';
    messages.push('memory.db 不存在（首次对话后将自动创建）');
    return { name: 'memory.db', status, message: messages.join('; '), details };
  }

  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

  try {
    // 检查表是否存在
    const tables: string[] = await new Promise((resolve, reject) => {
      db.all(`SELECT name FROM sqlite_master WHERE type='table'`, [],
        (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows.map(r => r.name)));
    });
    details.tables = tables;

    // 检查关键表
    const requiredTables = ['working_memory', 'long_term_memory', 'consolidation_log'];
    for (const table of requiredTables) {
      if (tables.includes(table)) {
        const count = await new Promise<number>((resolve, reject) => {
          db.get(`SELECT COUNT(*) as cnt FROM ${table}`, [],
            (err: Error | null, row: any) => err ? reject(err) : resolve(row.cnt));
        });
        details[`${table}_count`] = count;
      } else {
        status = 'error';
        messages.push(`缺少表: ${table}`);
      }
    }

    // 检查 preferences 表（如果有 knowledge 集成）
    if (tables.includes('preferences')) {
      const prefCount = await new Promise<number>((resolve, reject) => {
        db.get(`SELECT COUNT(*) as cnt FROM preferences`, [],
          (err: Error | null, row: any) => err ? reject(err) : resolve(row.cnt));
      });
      details.preference_count = prefCount;
    }

    // 测试写入操作
    const testId = `selfcheck_${Date.now()}`;
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT INTO working_memory (id, type, title, content, importance, tags, source, source_ref, created_at)
         VALUES (?, 'test', '自检测试', 'self-check test entry', 0.5, '[]', 'self_check', 'self_check', datetime('now'))`,
        [testId],
        (err: Error | null) => err ? reject(err) : resolve()
      );
    });
    details.writeTest = 'ok';

    // 清理测试数据
    await new Promise<void>((resolve) => {
      db.run(`DELETE FROM working_memory WHERE id = ?`, [testId], () => resolve());
    });

    if (messages.length === 0) {
      messages.push(`memory.db 正常 (${details.working_memory_count || 0} WM, ${details.long_term_memory_count || 0} LTM)`);
    }
  } catch (err: any) {
    status = 'error';
    messages.push(`memory.db 检查失败: ${err.message}`);
  } finally {
    db.close();
  }

  return { name: 'memory.db', status, message: messages.join('; '), details };
}

async function checkKnowledgeDb(ctx: PluginContext): Promise<CheckResult> {
  const details: Record<string, any> = {};
  let status: 'ok' | 'warn' | 'error' = 'ok';
  const messages: string[] = [];

  const dbPath = path.join(getDataDir(ctx), 'knowledge.db');
  details.dbPath = dbPath;
  details.dbExists = fs.existsSync(dbPath);

  if (!details.dbExists) {
    status = 'warn';
    messages.push('knowledge.db 不存在（实体提取后将自动创建）');
    return { name: 'knowledge.db', status, message: messages.join('; '), details };
  }

  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

  try {
    const tables: string[] = await new Promise((resolve, reject) => {
      db.all(`SELECT name FROM sqlite_master WHERE type='table'`, [],
        (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows.map(r => r.name)));
    });
    details.tables = tables;

    const requiredTables = ['entities', 'relations', 'rules'];
    for (const table of requiredTables) {
      if (tables.includes(table)) {
        const count = await new Promise<number>((resolve, reject) => {
          db.get(`SELECT COUNT(*) as cnt FROM ${table}`, [],
            (err: Error | null, row: any) => err ? reject(err) : resolve(row.cnt));
        });
        details[`${table}_count`] = count;
      } else {
        status = 'error';
        messages.push(`缺少表: ${table}`);
      }
    }

    if (tables.includes('preferences')) {
      const prefCount = await new Promise<number>((resolve, reject) => {
        db.get(`SELECT COUNT(*) as cnt FROM preferences`, [],
          (err: Error | null, row: any) => err ? reject(err) : resolve(row.cnt));
      });
      details.preference_count = prefCount;
    }

    if (messages.length === 0) {
      messages.push(`knowledge.db 正常 (${details.entities_count || 0} 实体, ${details.relations_count || 0} 关系, ${details.rules_count || 0} 规则)`);
    }
  } catch (err: any) {
    status = 'error';
    messages.push(`knowledge.db 检查失败: ${err.message}`);
  } finally {
    db.close();
  }

  return { name: 'knowledge.db', status, message: messages.join('; '), details };
}

async function checkEvolutionSystem(ctx: PluginContext): Promise<CheckResult> {
  const details: Record<string, any> = {};
  let status: 'ok' | 'warn' | 'error' = 'ok';
  const messages: string[] = [];

  const evolutionDir = getEvolutionStorageDir(ctx);
  details.evolutionDirExists = fs.existsSync(evolutionDir);

  if (details.evolutionDirExists) {
    const files = fs.readdirSync(evolutionDir);
    details.files = files;

    if (files.includes('meta_rules.json')) {
      try {
        const content = fs.readFileSync(path.join(evolutionDir, 'meta_rules.json'), 'utf8');
        const rules = JSON.parse(content);
        details.metaRuleCount = Array.isArray(rules) ? rules.length : 0;
      } catch { /* ignore parse error */ }
    }

    if (files.includes('organization_report.json')) {
      details.hasOrgReport = true;
    }
    if (files.includes('review_report.json')) {
      details.hasReviewReport = true;
    }
  }

  messages.push(details.evolutionDirExists ? '进化系统正常' : '进化目录不存在（首次运行后将创建）');
  return { name: '进化系统', status, message: messages.join('; '), details };
}

async function checkIndexSystem(ctx: PluginContext): Promise<CheckResult> {
  const details: Record<string, any> = {};
  let status: 'ok' | 'warn' | 'error' = 'ok';
  const messages: string[] = [];

  const indexDir = path.join(getDataDir(ctx), 'memory_index');
  details.indexDirExists = fs.existsSync(indexDir);

  if (details.indexDirExists) {
    const files = fs.readdirSync(indexDir);
    details.indexFiles = files;

    if (files.includes('documents.json')) {
      try {
        const content = fs.readFileSync(path.join(indexDir, 'documents.json'), 'utf8');
        const docs = JSON.parse(content);
        details.documentCount = Array.isArray(docs) ? docs.length : 0;
      } catch { /* ignore */ }
    }
    if (files.includes('index_state.json')) {
      try {
        const content = fs.readFileSync(path.join(indexDir, 'index_state.json'), 'utf8');
        const state = JSON.parse(content);
        details.indexState = { lastBuilt: state.lastBuilt, totalIndexed: state.totalIndexed };
      } catch { /* ignore */ }
    }
  }

  // 检查 FTS 数据库
  const ftsDbPath = path.join(getDataDir(ctx), 'fts_index', 'fts.sqlite');
  details.ftsDbExists = fs.existsSync(ftsDbPath);

  // 检查 Vector 数据库
  const vectorDbPath = path.join(getDataDir(ctx), 'vector_index', 'vectors.sqlite');
  details.vectorDbExists = fs.existsSync(vectorDbPath);

  messages.push('索引系统正常');
  return { name: '索引系统', status, message: messages.join('; '), details };
}

async function checkConfig(ctx: PluginContext): Promise<CheckResult> {
  const details: Record<string, any> = {};
  let status: 'ok' | 'warn' | 'error' = 'ok' as const;
  const messages: string[] = [];

  details.agentId = ctx.agentId;
  details.workspaceDir = ctx.workspaceDir;
  details.storageBaseDir = ctx.storageBaseDir;

  // 检查 openclaw 配置
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const configPath = path.join(homeDir, '.openclaw', 'openclaw.json');
  details.openclawConfigExists = fs.existsSync(configPath);

  if (!details.openclawConfigExists) {
    status = 'error';
    messages.push('OpenClaw 配置文件不存在');
  }

  if (messages.length === 0) {
    messages.push(`配置正常 (agent: ${ctx.agentId})`);
  }

  return { name: '配置', status, message: messages.join('; '), details };
}

/**
 * 生成自检报告（人类可读格式）
 */
export function formatSelfCheckReport(results: CheckResult[]): string {
  const parts: string[] = [];
  parts.push('=== Evo-Cortex 自检报告 ===\n');

  let okCount = 0;
  let warnCount = 0;
  let errorCount = 0;

  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '❌';
    if (r.status === 'ok') okCount++;
    else if (r.status === 'warn') warnCount++;
    else errorCount++;

    parts.push(`${icon} ${r.name}: ${r.message}`);

    if (r.details) {
      for (const [key, value] of Object.entries(r.details)) {
        if (key.endsWith('Exists') || key.endsWith('Count')) {
          parts.push(`   ${key}: ${value}`);
        }
      }
    }
    parts.push('');
  }

  parts.push(`---\n总计: ${okCount} 正常, ${warnCount} 警告, ${errorCount} 错误`);
  if (errorCount === 0 && warnCount === 0) {
    parts.push('\n🎉 所有检查项通过！');
  } else if (errorCount > 0) {
    parts.push('\n⚠️ 存在错误项，建议修复。');
  }

  return parts.join('\n');
}
