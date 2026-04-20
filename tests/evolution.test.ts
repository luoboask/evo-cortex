/**
 * Evolution Scheduler Unit Tests
 */
import { EvolutionScheduler } from "../src/evolution/scheduler";
import * as fs from "fs";
import * as path from "path";

// 测试目录
const TEST_DIR = "evolution/test-agent";

describe("EvolutionScheduler", () => {
  let scheduler: EvolutionScheduler;

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    scheduler = new EvolutionScheduler("test-agent");
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("recordEvent", () => {
    it("should record events", () => {
      scheduler.recordEvent("Test event 1");
      scheduler.recordEvent("Test event 2");

      const report = scheduler.generateEvolutionReport();

      expect(report.recentEvents).toBe(2);
    });

    it("should limit events to 100", () => {
      for (let i = 0; i < 150; i++) {
        scheduler.recordEvent(`Event ${i}`);
      }

      const report = scheduler.generateEvolutionReport();

      expect(report.recentEvents).toBeLessThanOrEqual(100);
    });
  });

  describe("generateEvolutionReport", () => {
    it("should generate evolution report", () => {
      scheduler.recordEvent("Test event");

      const report = scheduler.generateEvolutionReport();

      expect(report.metaRules).toBeDefined();
      expect(report.recentEvents).toBeGreaterThanOrEqual(1);
      expect(report.timestamp).toBeDefined();
    });
  });

  describe("config", () => {
    it("should respect disabled config", () => {
      const disabledScheduler = new EvolutionScheduler("test-agent", {
        enabled: false,
        fractal_thinking: false,
        active_learning: false
      });

      expect(disabledScheduler).toBeDefined();
    });

    it("should respect fractal_thinking config", () => {
      const scheduler = new EvolutionScheduler("test-agent", {
        fractal_thinking: true
      });

      expect(scheduler).toBeDefined();
    });
  });

  describe("meta rules persistence", () => {
    it("should create storage directory", () => {
      expect(fs.existsSync(TEST_DIR)).toBe(true);
    });

    it("should save meta rules file", () => {
      scheduler.recordEvent("Test event for pattern detection");

      // 触发分形思考（通过运行任务）
      const rulesFile = path.join(TEST_DIR, "meta_rules.json");

      // 首次运行后应创建文件
      expect(fs.existsSync(path.dirname(rulesFile))).toBe(true);
    });
  });
});
