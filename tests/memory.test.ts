/**
 * Memory Hub Unit Tests
 */
import { MemoryHub, MemoryEntry } from "../src/memory/memory_hub";
import * as fs from "fs";
import * as path from "path";

// 测试目录
const TEST_DIR = "memory/test-agent";
const TEST_STORAGE = TEST_DIR;

describe("MemoryHub", () => {
  let memoryHub: MemoryHub;

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    memoryHub = new MemoryHub("test-agent");
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("add", () => {
    it("should add a memory entry", async () => {
      const entry = await memoryHub.add({
        content: "Test memory content",
        type: "session",
        timestamp: new Date().toISOString()
      });

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe("Test memory content");
      expect(entry.type).toBe("session");
    });

    it("should persist memory to file", async () => {
      await memoryHub.add({
        content: "Persistent memory",
        type: "session",
        timestamp: new Date().toISOString()
      });

      const today = new Date().toISOString().split("T")[0];
      const filePath = path.join(TEST_STORAGE, `${today}.md`);

      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("search", () => {
    it("should find memories by keyword", async () => {
      await memoryHub.add({
        content: "TypeScript is a typed superset of JavaScript",
        type: "session",
        timestamp: new Date().toISOString()
      });

      await memoryHub.add({
        content: "Python is a high-level programming language",
        type: "session",
        timestamp: new Date().toISOString()
      });

      const results = await memoryHub.search("TypeScript");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.content).toContain("TypeScript");
    });

    it("should return empty for no matches", async () => {
      await memoryHub.add({
        content: "Some content",
        type: "session",
        timestamp: new Date().toISOString()
      });

      const results = await memoryHub.search("nonexistent");

      expect(results.length).toBe(0);
    });
  });

  describe("getRecent", () => {
    it("should return recent memories in order", async () => {
      const now = new Date().toISOString();
      await memoryHub.add({ content: "First", type: "session", timestamp: now });
      await memoryHub.add({ content: "Second", type: "session", timestamp: now });
      await memoryHub.add({ content: "Third", type: "session", timestamp: now });

      const recent = await memoryHub.getRecent(2);

      expect(recent.length).toBe(2);
    });
  });

  describe("delete", () => {
    it("should delete a memory by id", async () => {
      const entry = await memoryHub.add({
        content: "To be deleted",
        type: "session",
        timestamp: new Date().toISOString()
      });

      const deleted = await memoryHub.delete(entry.id!);

      expect(deleted).toBe(true);
    });

    it("should return false for non-existent id", async () => {
      const deleted = await memoryHub.delete("nonexistent-id");

      expect(deleted).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      await memoryHub.add({ content: "Content 1", type: "session", timestamp: new Date().toISOString() });
      await memoryHub.add({ content: "Content 2", type: "daily", timestamp: new Date().toISOString() });

      const stats = memoryHub.getStats();

      expect(stats.total).toBe(2);
      expect(stats.byType.session).toBe(1);
      expect(stats.byType.daily).toBe(1);
    });
  });

  describe("compress", () => {
    it("should compress memories", async () => {
      await memoryHub.add({ content: "Memory 1", type: "session", timestamp: new Date().toISOString() });
      await memoryHub.add({ content: "Memory 2", type: "session", timestamp: new Date().toISOString() });

      const result = await memoryHub.compress("daily");

      expect(result.compressed).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
    });
  });
});
