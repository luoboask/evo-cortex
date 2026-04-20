/**
 * Knowledge Graph Unit Tests
 */
import { KnowledgeGraph } from "../src/knowledge/knowledge_graph";
import * as fs from "fs";
import * as path from "path";

// 测试目录
const TEST_DIR = "knowledge/test-agent";

describe("KnowledgeGraph", () => {
  let knowledgeGraph: KnowledgeGraph;

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    knowledgeGraph = new KnowledgeGraph("test-agent");
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("addEntity", () => {
    it("should add an entity", async () => {
      const entity = await knowledgeGraph.addEntity({
        name: "TypeScript",
        type: "programming",
        createdAt: new Date().toISOString()
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe("TypeScript");
      expect(entity.type).toBe("programming");
    });

    it("should persist entity to file", async () => {
      await knowledgeGraph.addEntity({
        name: "JavaScript",
        type: "programming",
        createdAt: new Date().toISOString()
      });

      const entitiesFile = path.join(TEST_DIR, "entities.json");

      expect(fs.existsSync(entitiesFile)).toBe(true);
    });
  });

  describe("addEntities", () => {
    it("should add multiple entities", async () => {
      const entities = await knowledgeGraph.addEntities([
        { name: "React", type: "programming", createdAt: new Date().toISOString() },
        { name: "Vue", type: "programming", createdAt: new Date().toISOString() }
      ]);

      expect(entities.length).toBe(2);
    });
  });

  describe("addRelation", () => {
    it("should add a relation between entities", async () => {
      const e1 = await knowledgeGraph.addEntity({
        name: "Node.js",
        type: "programming",
        createdAt: new Date().toISOString()
      });

      const e2 = await knowledgeGraph.addEntity({
        name: "JavaScript",
        type: "programming",
        createdAt: new Date().toISOString()
      });

      const relation = await knowledgeGraph.addRelation({
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
      await knowledgeGraph.addEntity({
        name: "Machine Learning",
        type: "science",
        createdAt: new Date().toISOString()
      });

      const results = await knowledgeGraph.search("Machine");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity.name).toBe("Machine Learning");
    });

    it("should filter by domain", async () => {
      await knowledgeGraph.addEntity({
        name: "React",
        type: "programming",
        createdAt: new Date().toISOString()
      });

      await knowledgeGraph.addEntity({
        name: "Physics",
        type: "science",
        createdAt: new Date().toISOString()
      });

      const results = await knowledgeGraph.search("React", "science");

      expect(results.length).toBe(0);
    });
  });

  describe("getEntity", () => {
    it("should retrieve an entity by id", async () => {
      const added = await knowledgeGraph.addEntity({
        name: "TestEntity",
        type: "other",
        createdAt: new Date().toISOString()
      });

      const retrieved = await knowledgeGraph.getEntity(added.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe("TestEntity");
    });

    it("should return null for non-existent id", async () => {
      const retrieved = await knowledgeGraph.getEntity("nonexistent");

      expect(retrieved).toBeNull();
    });
  });

  describe("deleteEntity", () => {
    it("should delete an entity", async () => {
      const entity = await knowledgeGraph.addEntity({
        name: "ToDelete",
        type: "other",
        createdAt: new Date().toISOString()
      });

      const deleted = await knowledgeGraph.deleteEntity(entity.id);

      expect(deleted).toBe(true);

      const retrieved = await knowledgeGraph.getEntity(entity.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("extractEntitiesFromText", () => {
    it("should extract entities from text", async () => {
      const text = "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.";

      const entities = await knowledgeGraph.extractEntitiesFromText(text);

      expect(entities.length).toBeGreaterThan(0);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      await knowledgeGraph.addEntity({ name: "E1", type: "programming", createdAt: new Date().toISOString() });
      await knowledgeGraph.addEntity({ name: "E2", type: "science", createdAt: new Date().toISOString() });

      const stats = knowledgeGraph.getStats();

      expect(stats.entities).toBe(2);
    });
  });
});
