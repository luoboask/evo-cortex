/**
 * Knowledge System Unit Tests
 */
import { KnowledgeSystem } from "../src/knowledge/knowledge_system";
import * as fs from "fs";
import * as path from "path";

// 测试目录
const TEST_DIR = "knowledge/test-agent";
const TEST_DATA_DIR = TEST_DIR;

describe("KnowledgeSystem", () => {
  let knowledgeSystem: KnowledgeSystem;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    knowledgeSystem = new KnowledgeSystem("test-agent", TEST_DATA_DIR);
    knowledgeSystem.init().catch(() => {});
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("addEntity", () => {
    it("should add an entity", async () => {
      const entity = await knowledgeSystem.addEntity({
        name: "TypeScript",
        type: "programming",
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe("TypeScript");
      expect(entity.type).toBe("programming");
    });
  });

  describe("addEntities", () => {
    it("should add multiple entities", async () => {
      const entities = await knowledgeSystem.addEntities([
        { name: "React", type: "programming" },
        { name: "Vue", type: "programming" }
      ]);

      expect(entities.length).toBe(2);
    });
  });

  describe("addRelation", () => {
    it("should add a relation between entities", async () => {
      const e1 = await knowledgeSystem.addEntity({
        name: "Node.js",
        type: "programming",
      });

      const e2 = await knowledgeSystem.addEntity({
        name: "JavaScript",
        type: "programming",
      });

      const relation = await knowledgeSystem.addRelation({
        from: e1.id,
        to: e2.id,
        type: "depends_on"
      });

      expect(relation.id).toBeDefined();
      expect(relation.type).toBe("depends_on");
    });
  });

  describe("search", () => {
    it("should find entities by query", async () => {
      await knowledgeSystem.addEntity({
        name: "Machine Learning",
        type: "science",
      });

      const results = await knowledgeSystem.searchEntities("Machine");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity.name).toBe("Machine Learning");
    });

    it("should filter by domain", async () => {
      await knowledgeSystem.addEntity({
        name: "React",
        type: "programming",
      });

      await knowledgeSystem.addEntity({
        name: "Physics",
        type: "science",
      });

      const results = await knowledgeSystem.searchEntities("React", "science");

      expect(results.length).toBe(0);
    });
  });

  describe("getEntity", () => {
    it("should retrieve an entity by id", async () => {
      const added = await knowledgeSystem.addEntity({
        name: "TestEntity",
        type: "other",
      });

      const retrieved = await knowledgeSystem.getEntity(added.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe("TestEntity");
    });

    it("should return null for non-existent id", async () => {
      const retrieved = await knowledgeSystem.getEntity("nonexistent");

      expect(retrieved).toBeNull();
    });
  });

  describe("deleteEntity", () => {
    it("should delete an entity", async () => {
      const entity = await knowledgeSystem.addEntity({
        name: "ToDelete",
        type: "other",
      });

      const deleted = await knowledgeSystem.deleteEntity(entity.id);

      expect(deleted).toBe(true);

      const retrieved = await knowledgeSystem.getEntity(entity.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("extractEntitiesFromText", () => {
    it("should extract entities from text", async () => {
      const text = "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.";

      const entities = await knowledgeSystem.extractEntitiesFromText(text);

      expect(entities.length).toBeGreaterThan(0);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      await knowledgeSystem.addEntity({ name: "E1", type: "programming" });
      await knowledgeSystem.addEntity({ name: "E2", type: "science" });

      const stats = await knowledgeSystem.getStats();

      expect(stats.entities).toBe(2);
    });
  });
});
