/**
 * 性能监控工具
 */

export interface PerformanceMetrics {
  label: string;
  duration: number;
  timestamp: string;
  metadata?: any;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Array<PerformanceMetrics> = [];
  private timers: Map<string, number> = new Map();
  private maxMetricsSize = 1000;

  private constructor() {}

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * 开始计时
   */
  startTimer(label: string): (metadata?: any) => void {
    const startTime = performance.now();
    this.timers.set(label, startTime);

    // 返回停止计时的函数
    return (metadata?: any) => this.stopTimer(label, metadata);
  }

  /**
   * 停止计时并记录
   */
  stopTimer(label: string, metadata?: any): number {
    const startTime = this.timers.get(label);
    
    if (startTime === undefined) {
      console.warn(`[Perf] Timer "${label}" not started`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.timers.delete(label);

    const metric: PerformanceMetrics = {
      label,
      duration,
      timestamp: new Date().toISOString(),
      metadata,
    };

    this.metrics.push(metric);

    // 限制指标数量
    if (this.metrics.length > this.maxMetricsSize) {
      this.metrics.shift();
    }

    // 输出慢操作警告
    if (duration > 1000) {
      console.warn(`[Perf] Slow operation: ${label} took ${duration.toFixed(2)}ms`);
    }

    return duration;
  }

  /**
   * 记录一次性指标
   */
  record(label: string, duration: number, metadata?: any): void {
    this.metrics.push({
      label,
      duration,
      timestamp: new Date().toISOString(),
      metadata,
    });

    if (this.metrics.length > this.maxMetricsSize) {
      this.metrics.shift();
    }
  }

  /**
   * 获取最近的指标
   */
  getRecentMetrics(limit: number = 100): Array<PerformanceMetrics> {
    return this.metrics.slice(-limit);
  }

  /**
   * 获取平均耗时
   */
  getAverageDuration(label: string): number {
    const labeledMetrics = this.metrics.filter(m => m.label === label);
    
    if (labeledMetrics.length === 0) {
      return 0;
    }

    const total = labeledMetrics.reduce((sum, m) => sum + m.duration, 0);
    return total / labeledMetrics.length;
  }

  /**
   * 获取百分位耗时（P50, P90, P99）
   */
  getPercentile(label: string, percentile: number): number {
    const labeledMetrics = this.metrics.filter(m => m.label === label);
    
    if (labeledMetrics.length === 0) {
      return 0;
    }

    const sorted = labeledMetrics.map(m => m.duration).sort((a, b) => a - b);
    const index = Math.floor(sorted.length * (percentile / 100));
    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    const report: string[] = [
      '📊 Evo-Cortex Performance Report',
      `Generated: ${new Date().toLocaleString('zh-CN')}`,
      '',
    ];

    // 按标签分组
    const grouped = new Map<string, Array<PerformanceMetrics>>();
    for (const metric of this.metrics) {
      const group = grouped.get(metric.label) || [];
      group.push(metric);
      grouped.set(metric.label, group);
    }

    // 输出每个操作的统计
    for (const [label, metrics] of grouped.entries()) {
      const durations = metrics.map(m => m.duration);
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const count = metrics.length;

      report.push(`${label}:`);
      report.push(`  Count: ${count}`);
      report.push(`  Avg: ${avg.toFixed(2)}ms`);
      report.push(`  Min: ${min.toFixed(2)}ms`);
      report.push(`  Max: ${max.toFixed(2)}ms`);
      report.push(`  P50: ${this.getPercentile(label, 50).toFixed(2)}ms`);
      report.push(`  P90: ${this.getPercentile(label, 90).toFixed(2)}ms`);
      report.push(`  P99: ${this.getPercentile(label, 99).toFixed(2)}ms`);
      report.push('');
    }

    return report.join('\n');
  }

  /**
   * 清除所有指标
   */
  clearMetrics(): void {
    this.metrics = [];
    this.timers.clear();
  }

  /**
   * 导出指标（用于分析）
   */
  exportMetrics(): string {
    return JSON.stringify(this.metrics, null, 2);
  }
}

/**
 * 性能装饰器
 */
export function measurePerformance(label?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const metricLabel = label || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const perf = PerformanceMonitor.getInstance();
      const stopTimer = perf.startTimer(metricLabel);

      try {
        const result = await originalMethod.apply(this, args);
        stopTimer();
        return result;
      } catch (error) {
        stopTimer({ error: true });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * 便捷的性能监控函数
 */
export async function measure<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const perf = PerformanceMonitor.getInstance();
  const stopTimer = perf.startTimer(label);

  try {
    const result = await fn();
    stopTimer();
    return result;
  } catch (error) {
    stopTimer({ error: true });
    throw error;
  }
}
