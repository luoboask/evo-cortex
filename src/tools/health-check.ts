/**
 * Health Check - 健康检查工具
 * 
 * 提供插件状态诊断和性能指标
 */

import * as fs from 'fs';
import * as path from 'path';
import { PluginContext, getMemoryStorageDir, getKnowledgeStorageDir, getDataDir } from '../utils/plugin-context';
import { MemoryHub } from '../memory/memory_hub';
import { KnowledgeSystem } from '../knowledge/knowledge_system';
import { Cache } from '../utils/cache';

export interface HealthReport {
  status: 'healthy' | 'warning' | 'error';
  timestamp: string;
  agentId: string;
  components: {
    memory: ComponentHealth;
    knowledge: ComponentHealth;
    storage: StorageHealth;
    performance: PerformanceMetrics;
  };
  recommendations: string[];
}

export interface ComponentHealth {
  status: 'healthy' | 'warning' | 'error';
  enabled: boolean;
  issues: string[];
}

export interface StorageHealth {
  status: 'healthy' | 'warning' | 'error';
  memorySize?: number;
  knowledgeSize?: number;
  totalSize: number;
  issues: string[];
}

export interface PerformanceMetrics {
  searchLatency?: number; // ms
  cacheHitRate?: number; // percentage
  memoryUsage?: number; // MB
}

/**
 * 执行健康检查
 */
export async function runHealthCheck(
  ctx: PluginContext,
  config: any,
  searchCache: Cache
): Promise<HealthReport> {
  const report: HealthReport = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    agentId: ctx.agentId,
    components: {
      memory: { status: 'healthy', enabled: true, issues: [] },
      knowledge: { status: 'healthy', enabled: true, issues: [] },
      storage: { status: 'healthy', totalSize: 0, issues: [] },
      performance: {}
    },
    recommendations: []
  };

  // ========== 检查记忆系统 ==========
  try {
    const memoryHub = new MemoryHub(ctx, config.memory);
    const stats = memoryHub.getStats();
    
    if (stats.total === 0) {
      report.components.memory.issues.push('No memories stored yet');
    } else if (stats.total > 10000) {
      report.components.memory.status = 'warning';
      report.components.memory.issues.push(`Large number of memories (${stats.total}), consider compression`);
      report.recommendations.push('Run memory compression to reduce storage');
    }
  } catch (error: any) {
    report.components.memory.status = 'error';
    report.components.memory.issues.push(`Memory system error: ${error.message}`);
    report.status = 'error';
  }

  // ========== 检查知识图谱 ==========
  try {
    const dataDir = getDataDir(ctx);
    const ks = new KnowledgeSystem(ctx.agentId, dataDir);
    await ks.init();
    const stats = await ks.getStats();
    
    if (stats.entities === 0) {
      report.components.knowledge.issues.push('No knowledge entities yet');
    }
  } catch (error: any) {
    report.components.knowledge.status = 'error';
    report.components.knowledge.issues.push(`Knowledge system error: ${error.message}`);
    report.status = 'error';
  }

  // ========== 检查存储 ==========
  try {
    const memoryDir = getMemoryStorageDir(ctx);
    const knowledgeDir = getKnowledgeStorageDir(ctx);
    
    const memorySize = getDirectorySize(memoryDir);
    const knowledgeSize = getDirectorySize(knowledgeDir);
    
    report.components.storage.memorySize = memorySize;
    report.components.storage.knowledgeSize = knowledgeSize;
    report.components.storage.totalSize = (memorySize || 0) + (knowledgeSize || 0);
    
    // 警告：存储空间过大
    if (report.components.storage.totalSize > 100 * 1024 * 1024) { // 100MB
      report.components.storage.status = 'warning';
      report.components.storage.issues.push('Storage size exceeds 100MB');
      report.recommendations.push('Consider cleaning up old memories or compressing data');
    }
    
    // 错误：目录不存在或不可写
    if (!fs.existsSync(memoryDir)) {
      report.components.storage.status = 'error';
      report.components.storage.issues.push('Memory directory does not exist');
    } else if (!isWritable(memoryDir)) {
      report.components.storage.status = 'error';
      report.components.storage.issues.push('Memory directory is not writable');
    }
  } catch (error: any) {
    report.components.storage.status = 'error';
    report.components.storage.issues.push(`Storage check error: ${error.message}`);
  }

  // ========== 性能指标 ==========
  try {
    // 缓存命中率
    report.components.performance.cacheHitRate = calculateCacheHitRate(searchCache);
    
    // 简单性能测试
    const startTime = Date.now();
    await quickSearchTest(ctx, config.memory);
    report.components.performance.searchLatency = Date.now() - startTime;
    
    if (report.components.performance.searchLatency > 1000) {
      report.recommendations.push('Search latency is high, consider optimizing or reducing data');
    }
  } catch (error: any) {
    report.components.performance.searchLatency = -1;
  }

  // ========== 确定总体状态 ==========
  if (report.components.memory.status === 'error' || 
      report.components.knowledge.status === 'error' ||
      report.components.storage.status === 'error') {
    report.status = 'error';
  } else if (report.components.memory.status === 'warning' || 
             report.components.knowledge.status === 'warning' ||
             report.components.storage.status === 'warning') {
    report.status = 'warning';
  }

  return report;
}

// ========== 辅助函数 ==========

function getDirectorySize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  
  let totalSize = 0;
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        totalSize += fs.statSync(fullPath).size;
      }
    }
  };
  
  walk(dirPath);
  return totalSize;
}

function isWritable(dirPath: string): boolean {
  try {
    const testFile = path.join(dirPath, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

function calculateCacheHitRate(cache: Cache): number {
  // 简化实现：返回缓存使用率
  const stats = cache.getStats();
  if (stats.maxEntries === 0) return 0;
  return Math.round((stats.size / stats.maxEntries) * 100);
}

async function quickSearchTest(ctx: PluginContext, config: any): Promise<void> {
  const memoryHub = new MemoryHub(ctx, config);
  await memoryHub.search('test', 1);
}

/**
 * 格式化健康报告为人类可读文本
 */
export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [];
  
  // 标题
  const statusEmoji = {
    healthy: '✅',
    warning: '⚠️',
    error: '❌'
  };
  
  lines.push(`${statusEmoji[report.status]} 健康检查报告 (${report.agentId})`);
  lines.push(`时间：${new Date(report.timestamp).toLocaleString('zh-CN')}`);
  lines.push('');
  
  // 组件状态
  lines.push('📊 组件状态:');
  lines.push(`  记忆系统：${getStatusText(report.components.memory)}`);
  lines.push(`  知识图谱：${getStatusText(report.components.knowledge)}`);
  lines.push(`  存储系统：${getStatusText(report.components.storage)}`);
  lines.push('');
  
  // 性能指标
  if (report.components.performance.searchLatency !== undefined) {
    lines.push('⚡ 性能指标:');
    lines.push(`  搜索延迟：${report.components.performance.searchLatency}ms`);
    if (report.components.performance.cacheHitRate !== undefined) {
      lines.push(`  缓存使用率：${report.components.performance.cacheHitRate}%`);
    }
    lines.push('');
  }
  
  // 存储大小
  if (report.components.storage.totalSize > 0) {
    lines.push('💾 存储使用:');
    lines.push(`  总大小：${formatBytes(report.components.storage.totalSize)}`);
    if (report.components.storage.memorySize) {
      lines.push(`  记忆：${formatBytes(report.components.storage.memorySize)}`);
    }
    if (report.components.storage.knowledgeSize) {
      lines.push(`  知识：${formatBytes(report.components.storage.knowledgeSize)}`);
    }
    lines.push('');
  }
  
  // 问题列表
  const allIssues = [
    ...report.components.memory.issues,
    ...report.components.knowledge.issues,
    ...report.components.storage.issues
  ];
  
  if (allIssues.length > 0) {
    lines.push('⚠️ 发现的问题:');
    allIssues.forEach((issue, i) => {
      lines.push(`  ${i + 1}. ${issue}`);
    });
    lines.push('');
  }
  
  // 建议
  if (report.recommendations.length > 0) {
    lines.push('💡 建议:');
    report.recommendations.forEach((rec, i) => {
      lines.push(`  ${i + 1}. ${rec}`);
    });
    lines.push('');
  }
  
  return lines.join('\n');
}

function getStatusText(component: ComponentHealth | StorageHealth): string {
  const emoji = {
    healthy: '✅',
    warning: '⚠️',
    error: '❌'
  };
  return `${emoji[component.status]} ${component.status.toUpperCase()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
