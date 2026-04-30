/**
 * Logger - 统一日志系统
 * 
 * 提供结构化的日志输出，支持不同级别和 Agent 标签
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  agentId?: string;
  component?: string;
  verbose?: boolean;
}

export class Logger {
  private agentTag: string;
  private component: string;
  private verbose: boolean;
  private shownWarnings = new Set<string>();

  constructor(options: LoggerOptions = {}) {
    this.agentTag = options.agentId ? `[${options.agentId}]` : '';
    this.component = options.component || 'Evo-Cortex';
    this.verbose = options.verbose || false;
  }

  /**
   * Debug 级别日志（仅在 verbose 模式显示）
   */
  debug(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.log(`[DEBUG${this.agentTag}:${this.component}] ${message}`, ...args);
    }
  }

  /**
   * Info 级别日志
   */
  info(message: string, ...args: any[]): void {
    console.log(`[INFO${this.agentTag}:${this.component}] ${message}`, ...args);
  }

  /**
   * Warning 级别日志（可配置为只显示一次）
   */
  warn(message: string, once?: boolean): void {
    if (once) {
      if (this.shownWarnings.has(message)) {
        return;
      }
      this.shownWarnings.add(message);
    }
    console.warn(`[WARN${this.agentTag}:${this.component}] ${message}`);
  }

  /**
   * Error 级别日志
   */
  error(message: string, error?: any): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR${this.agentTag}:${this.component}] ${message}: ${errorMsg}`);
  }

  /**
   * 钩子专用日志
   */
  hook(hookName: string, message: string, ...args: any[]): void {
    console.log(`[Hook${this.agentTag}:${hookName}] ${message}`, ...args);
  }

  /**
   * 工具专用日志
   */
  tool(toolName: string, message: string, ...args: any[]): void {
    console.log(`[Tool${this.agentTag}:${toolName}] ${message}`, ...args);
  }

  /**
   * 创建子日志器（用于不同组件）
   */
  child(component: string): Logger {
    return new Logger({
      agentId: this.agentTag ? this.agentTag.slice(1, -1) : undefined,
      component,
      verbose: this.verbose
    });
  }
}

// 全局日志实例缓存
const loggers = new Map<string, Logger>();

/**
 * 获取或创建日志器
 */
export function getLogger(options: LoggerOptions = {}): Logger {
  const key = `${options.agentId || 'default'}:${options.component || 'Evo-Cortex'}`;
  
  if (!loggers.has(key)) {
    loggers.set(key, new Logger(options));
  }
  
  return loggers.get(key)!;
}

/**
 * 设置全局 verbose 模式
 */
export function setVerboseMode(verbose: boolean): void {
  for (const [key, _logger] of loggers.entries()) {
    // 重建日志器以更新 verbose 设置
    const options = key.split(':');
    loggers.set(key, new Logger({
      agentId: options[0] !== 'default' ? options[0] : undefined,
      component: options[1],
      verbose
    }));
  }
}
