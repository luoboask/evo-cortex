/**
 * Evolution Scheduler Unit Tests
 */
import { EvolutionScheduler } from "../src/evolution/scheduler";
import { PluginContext } from "../src/utils/plugin-context";
import * as fs from "fs";
import * as path from "path";

// 测试目录
const TEST_DIR = "evolution/test-agent";

function makeCtx(): PluginContext {
  return {
    agentId: "test-agent",
    workspaceDir: TEST_DIR,
    storageBaseDir: TEST_DIR,
  };
}

describe("EvolutionScheduler", () => {
  let scheduler: EvolutionScheduler;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    scheduler = new EvolutionScheduler(makeCtx());
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("initialization", () => {
    it("should create storage directory", () => {
      expect(fs.existsSync(TEST_DIR)).toBe(true);
    });

    it("should be defined", () => {
      expect(scheduler).toBeDefined();
    });
  });

  describe("config", () => {
    it("should accept enabled config", () => {
      const s = new EvolutionScheduler(makeCtx(), {
        enabled: false,
        fractal_thinking: false,
        active_learning: false
      });
      expect(s).toBeDefined();
    });

    it("should accept partial config", () => {
      const s = new EvolutionScheduler(makeCtx(), {
        fractal_thinking: true
      });
      expect(s).toBeDefined();
    });
  });

  describe("runFractalThinking", () => {
    it("should run without error", async () => {
      await expect(scheduler.runFractalThinking()).resolves.not.toThrow();
    });
  });

  describe("runDomainOrganize", () => {
    it("should run without error", async () => {
      await expect(scheduler.runDomainOrganize()).resolves.not.toThrow();
    });
  });

  describe("runDomainReview", () => {
    it("should run without error", async () => {
      await expect(scheduler.runDomainReview()).resolves.not.toThrow();
    });
  });
});
