/**
 * Evo-Cortex 统一错误处理
 */

import { getLogger } from './logger';

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  // 通用错误
  UNKNOWN = 'EVO_UNKNOWN',
  INVALID_CONFIG = 'EVO_INVALID_CONFIG',
  MISSING_DEPENDENCY = 'EVO_MISSING_DEPENDENCY',
  
  // 记忆系统错误
  MEMORY_NOT_FOUND = 'EVO_MEMORY_NOT_FOUND',
  MEMORY_WRITE_FAILED = 'EVO_MEMORY_WRITE_FAILED',
  MEMORY_SEARCH_FAILED = 'EVO_MEMORY_SEARCH_FAILED',
  
  // 知识系统错误
  KNOWLEDGE_NOT_FOUND = 'EVO_KNOWLEDGE_NOT_FOUND',
  KNOWLEDGE_WRITE_FAILED = 'EVO_KNOWLEDGE_WRITE_FAILED',
  KNOWLEDGE_SEARCH_FAILED = 'EVO_KNOWLEDGE_SEARCH_FAILED',
  
  // 进化系统错误
  EVOLUTION_FAILED = 'EVO_EVOLUTION_FAILED',
  META_RULE_GENERATION_FAILED = 'EVO_META_RULE_GENERATION_FAILED',
  
  // 工具错误
  TOOL_EXECUTION_FAILED = 'EVO_TOOL_EXECUTION_FAILED',
  TOOL_NOT_FOUND = 'EVO_TOOL_NOT_FOUND',
  
  // Cron 错误
  CRON_EXECUTION_FAILED = 'EVO_CRON_EXECUTION_FAILED',
  CRON_NOT_FOUND = 'EVO_CRON_NOT_FOUND',
}

/**
 * Evo-Cortex 自定义错误类
 */
export class EvoCortexError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: any;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    context?: any
  ) {
    super(message);
    this.name = 'EvoCortexError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();

    // 保持正确的原型链
    Object.setPrototypeOf(this, EvoCortexError.prototype);

    // 捕获堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EvoCortexError);
    }
  }

  /**
   * 转换为 JSON 格式（用于日志记录）
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /**
   * 创建未知错误
   */
  static unknown(message: string, context?: any): EvoCortexError {
    return new EvoCortexError(message, ErrorCode.UNKNOWN, context);
  }

  /**
   * 创建配置错误
   */
  static invalidConfig(message: string, context?: any): EvoCortexError {
    return new EvoCortexError(message, ErrorCode.INVALID_CONFIG, context);
  }

  /**
   * 创建内存相关错误
   */
  static memoryError(
    message: string,
    code: ErrorCode = ErrorCode.MEMORY_NOT_FOUND,
    context?: any
  ): EvoCortexError {
    return new EvoCortexError(message, code, context);
  }

  /**
   * 创建工具执行错误
   */
  static toolError(
    message: string,
    code: ErrorCode = ErrorCode.TOOL_EXECUTION_FAILED,
    context?: any
  ): EvoCortexError {
    return new EvoCortexError(message, code, context);
  }
}

/**
 * 错误处理器
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: Array<EvoCortexError> = [];
  private maxLogSize = 100;

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * 处理错误
   */
  handle(error: Error | EvoCortexError, context?: any): void {
    const evoError = error instanceof EvoCortexError
      ? error
      : EvoCortexError.unknown(error.message, context);

    // 记录错误
    this.errorLog.push(evoError);

    // 限制日志大小
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // 输出到控制台（生产环境可以发送到错误收集服务）
    getLogger({ component: 'ErrorHandler' }).error(`${evoError.code}: ${evoError.message}`, {
      context: evoError.context || context,
      timestamp: evoError.timestamp,
    });
  }

  /**
   * 获取最近的错误日志
   */
  getRecentErrors(limit: number = 10): Array<EvoCortexError> {
    return this.errorLog.slice(-limit);
  }

  /**
   * 清除错误日志
   */
  clearErrors(): void {
    this.errorLog = [];
  }

  /**
   * 导出错误日志（用于调试）
   */
  exportErrors(): string {
    return JSON.stringify(this.errorLog.map(e => e.toJSON()), null, 2);
  }
}

/**
 * 便捷的错误处理函数
 */
export function handleError(error: Error | EvoCortexError, context?: any): void {
  ErrorHandler.getInstance().handle(error, context);
}

/**
 * 安全执行函数（捕获异常并转换为 EvoCortexError）
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  errorCode: ErrorCode = ErrorCode.UNKNOWN,
  errorMessage?: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const evoError = error instanceof EvoCortexError
      ? error
      : new EvoCortexError(
          errorMessage || (error as Error).message,
          errorCode,
          { originalError: error }
        );
    
    handleError(evoError);
    return null;
  }
}
