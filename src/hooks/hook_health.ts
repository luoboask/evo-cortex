/**
 * Hook Health — 钩子健康监测 + 自适应降级
 *
 * 插件的核心优势是钩子，但钩子必须稳定：
 * - 记录每次钩子的延迟、成功率
 * - 嵌入 API 故障时自动熔断（不阻塞正常对话）
 * - 检索质量持续下降时自动降级
 */

// ========== 熔断器 ==========

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

export class CircuitBreaker {
  private state: CircuitBreakerState = { failures: 0, lastFailure: 0, state: 'closed' };
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(threshold = 3, cooldownMs = 5 * 60 * 1000) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }

  canExecute(): boolean {
    if (this.state.state === 'closed') return true;
    if (this.state.state === 'open') {
      if (Date.now() - this.state.lastFailure > this.cooldownMs) {
        this.state.state = 'half-open';
        return true;
      }
      return false;
    }
    // half-open: allow one attempt
    return true;
  }

  recordSuccess(): void {
    this.state.failures = 0;
    this.state.state = 'closed';
  }

  recordFailure(): void {
    this.state.failures++;
    this.state.lastFailure = Date.now();
    if (this.state.failures >= this.threshold) {
      this.state.state = 'open';
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  reset(): void {
    this.state = { failures: 0, lastFailure: 0, state: 'closed' };
  }
}

// ========== Hook 指标 ==========

export interface HookMetrics {
  hookName: string;
  calls: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  lastError: string | null;
  lastChecked: string;
}

const metricsMap = new Map<string, HookMetrics>();

function getMetrics(hookName: string): HookMetrics {
  if (!metricsMap.has(hookName)) {
    metricsMap.set(hookName, {
      hookName, calls: 0, successes: 0, failures: 0,
      totalLatencyMs: 0, lastError: null, lastChecked: new Date().toISOString()
    });
  }
  return metricsMap.get(hookName)!;
}

/**
 * 包裹钩子调用：记录指标 + 自动 catch。
 * fallback 为必需参数，保证总是返回 T。
 */
export async function safeHook<T>(
  hookName: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  const m = getMetrics(hookName);
  const start = Date.now();
  m.calls++;

  try {
    const result = await fn();
    m.successes++;
    m.totalLatencyMs += Date.now() - start;
    return result;
  } catch (err) {
    m.failures++;
    m.totalLatencyMs += Date.now() - start;
    m.lastError = err instanceof Error ? err.message : String(err);
    m.lastChecked = new Date().toISOString();
    console.error(`[HookHealth] ${hookName} failed:`, m.lastError);
    return fallback;
  }
}

/**
 * 获取所有钩子的健康摘要
 */
export function getHookHealthSummary(): Array<{
  hook: string;
  successRate: number;
  avgLatencyMs: number;
  state: string;
  lastError: string | null;
}> {
  return [...metricsMap.values()].map(m => ({
    hook: m.hookName,
    successRate: m.calls > 0 ? m.successes / m.calls : 0,
    avgLatencyMs: m.successes > 0 ? Math.round(m.totalLatencyMs / m.successes) : 0,
    state: m.failures > 3 ? 'degraded' : 'healthy',
    lastError: m.lastError
  }));
}

/**
 * 重置指标
 */
export function resetHookMetrics(): void {
  metricsMap.clear();
}
