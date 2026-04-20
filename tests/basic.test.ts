/**
 * Evo-Cortex 基础测试
 */

describe('Evo-Cortex Basic', () => {
  describe('Configuration', () => {
    it('should have valid package.json', () => {
      const pkg = require('../package.json');
      
      expect(pkg.name).toBe('@evo-agents/evo-cortex');
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(pkg.license).toBe('MIT');
    });

    it('should have required scripts', () => {
      const pkg = require('../package.json');
      
      expect(pkg.scripts.test).toBeDefined();
      expect(pkg.scripts.lint).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should create EvoCortexError correctly', async () => {
      const { EvoCortexError, ErrorCode } = await import('../src/utils/errors');
      
      const error = new EvoCortexError(
        'Test error',
        ErrorCode.UNKNOWN,
        { test: true }
      );

      expect(error.name).toBe('EvoCortexError');
      expect(error.code).toBe(ErrorCode.UNKNOWN);
      expect(error.message).toBe('Test error');
      expect(error.context).toEqual({ test: true });
      expect(error.timestamp).toBeDefined();
    });

    it('should handle errors correctly', async () => {
      const { handleError, ErrorHandler } = await import('../src/utils/errors');
      
      const handler = ErrorHandler.getInstance();
      const initialCount = handler.getRecentErrors().length;

      handleError(new Error('Test error'));

      const newCount = handler.getRecentErrors().length;
      expect(newCount).toBeGreaterThan(initialCount);
    });
  });

  describe('Performance Monitor', () => {
    it('should measure performance correctly', async () => {
      const { PerformanceMonitor } = await import('../src/utils/performance');
      
      const perf = PerformanceMonitor.getInstance();
      perf.clearMetrics();

      const stopTimer = perf.startTimer('test-operation');
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const duration = stopTimer();
      
      expect(duration).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThan(1000); // Should not be too slow
    });

    it('should generate performance report', async () => {
      const { PerformanceMonitor } = await import('../src/utils/performance');
      
      const perf = PerformanceMonitor.getInstance();
      perf.clearMetrics();

      // Record some metrics
      perf.record('test-op', 100);
      perf.record('test-op', 150);
      perf.record('test-op', 200);

      const report = perf.generateReport();
      
      expect(report).toContain('Performance Report');
      expect(report).toContain('test-op');
      expect(report).toContain('Avg:');
    });
  });
});
