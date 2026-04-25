/**
 * Plugin Context Utilities
 * 
 * 提供正确的上下文获取方法，避免硬编码和 process.cwd() 问题
 */

import * as path from "path";

export interface PluginContext {
  agentId: string;
  workspaceDir: string;
  agentDir?: string;
  storageBaseDir: string;  // ~/.openclaw 或配置的根目录
}

/**
 * 从 OpenClaw API 上下文中提取插件所需的路径信息
 * @param apiContext 当前上下文（如 hookCtx）
 * @param fallbackContext 回退上下文（如 api 对象），用于补充缺失的 workspaceDir/agentDir
 */
export function buildPluginContext(
  apiContext: {
    agentId?: string;
    workspaceDir?: string;
    agentDir?: string;
    config?: any;
  },
  fallbackContext?: {
    workspaceDir?: string;
    agentDir?: string;
  }
): PluginContext {
  const agentId = apiContext.agentId || "main";
  // 修复：确保 workspaceDir 始终是有效路径
  // 优先级：apiContext.workspaceDir > fallbackContext.workspaceDir > apiContext.agentDir > fallbackContext.agentDir > process.cwd()
  const workspaceDir = apiContext.workspaceDir && apiContext.workspaceDir.length > 0
    ? apiContext.workspaceDir
    : (fallbackContext?.workspaceDir && fallbackContext.workspaceDir.length > 0)
      ? fallbackContext.workspaceDir
      : (apiContext.agentDir ? path.dirname(apiContext.agentDir)
        : (fallbackContext?.agentDir ? path.dirname(fallbackContext.agentDir)
          : process.cwd()));
  const agentDir = apiContext.agentDir || fallbackContext?.agentDir;
  
  // 存储基础目录：使用绝对路径 ~/.openclaw/{type}/{agentId}
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const storageBaseDir = path.join(homeDir, ".openclaw");
  
  return {
    agentId,
    workspaceDir,
    agentDir,
    storageBaseDir
  };
}

/**
 * 获取记忆存储目录（绝对路径）
 * 修复：使用 workspace 目录而非 storageBaseDir，与 OpenClaw 索引系统保持一致
 */
export function getMemoryStorageDir(ctx: PluginContext, subDir?: string): string {
  // 使用 workspace 目录，这样 OpenClaw 的索引系统可以正确检索
  const base = path.join(ctx.workspaceDir, "memory", ctx.agentId);
  return subDir ? path.join(base, subDir) : base;
}

/**
 * 获取知识存储目录（绝对路径）
 * 修复：使用 workspace 目录，保持数据一致性
 */
export function getKnowledgeStorageDir(ctx: PluginContext, subDir?: string): string {
  // 使用 workspace 目录，便于管理和备份
  const base = path.join(ctx.workspaceDir, "knowledge", ctx.agentId);
  return subDir ? path.join(base, subDir) : base;
}

/**
 * 获取进化数据存储目录（绝对路径）
 * 修复：使用 workspace 目录，保持数据一致性
 */
export function getEvolutionStorageDir(ctx: PluginContext, subDir?: string): string {
  // 使用 workspace 目录
  const base = path.join(ctx.workspaceDir, "evolution", ctx.agentId);
  return subDir ? path.join(base, subDir) : base;
}

/**
 * 获取数据目录（用于 session scanner 等）
 */
export function getDataDir(ctx: PluginContext, subDir?: string): string {
  // 已经在 workspace 目录下
  const base = path.join(ctx.workspaceDir, "data", ctx.agentId);
  return subDir ? path.join(base, subDir) : base;
}
