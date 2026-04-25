/**
 * Knowledge Graph v2 - 知识图谱
 *
 * 功能：
 * - 实体和关系管理
 * - 语义关联推理（共现分析 + 语义相似度）
 * - 知识检索（语义搜索 + 关键词降级）
 * - 持久化到文件系统
 */

import * as fs from "fs";
import * as path from "path";
import { PluginContext, getKnowledgeStorageDir } from "../utils/plugin-context";
import { SemanticSearch, SearchableDocument } from "../memory/semantic_search";
import { getEmbedding, getEmbeddingLevel, keywordScore } from "../memory/embedding_provider";
import { cosineSimilarity } from "../memory/embedding_cache";

export interface KnowledgeEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
  properties?: Record<string, any>;
  createdAt: string;
  embedding?: number[];
}

export interface KnowledgeRelation {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: number;
  properties?: Record<string, any>;
}

export interface KnowledgeSearchResult {
  entity: KnowledgeEntity;
  relations: KnowledgeRelation[];
  score: number;
}

export interface KnowledgeConfig {
  enabled: boolean;
  auto_expand: boolean;
}

export class KnowledgeGraph {
  private ctx: PluginContext;
  private config: KnowledgeConfig;
  private entities: Map<string, KnowledgeEntity> = new Map();
  private relations: KnowledgeRelation[] = [];
  private storageDir: string;
  private semanticSearch: SemanticSearch;

  constructor(ctx: PluginContext, config?: Partial<KnowledgeConfig>) {
    this.ctx = ctx;
    this.config = { enabled: true, auto_expand: true, ...config };
    this.storageDir = getKnowledgeStorageDir(ctx);
    this.ensureDirectory(this.storageDir);

    this.semanticSearch = new SemanticSearch(
      async (text: string) => {
        const emb = await getEmbedding(text);
        if (emb) return emb;
        throw new Error('no embedding');
      },
      2000
    );

    console.log(`[KnowledgeGraph] Initialized for agent: ${ctx.agentId}`);
    this.load();
  }

  // ========== 实体操作 ==========

  async addEntity(entity: Omit<KnowledgeEntity, "id">): Promise<KnowledgeEntity> {
    const newEntity: KnowledgeEntity = { ...entity, id: this.generateId() };
    this.entities.set(newEntity.id, newEntity);
    await this.addToSemanticSearch(newEntity);
    await this.persistEntity(newEntity);

    if (this.config.auto_expand) {
      await this.inferRelations(newEntity);
    }
    return newEntity;
  }

  async addEntities(entities: Array<Omit<KnowledgeEntity, "id">>): Promise<KnowledgeEntity[]> {
    const added: KnowledgeEntity[] = [];
    for (const e of entities) added.push(await this.addEntity(e));
    return added;
  }

  async addRelation(relation: Omit<KnowledgeRelation, "id">): Promise<KnowledgeRelation> {
    const newRel: KnowledgeRelation = { ...relation, id: this.generateId() };
    this.relations.push(newRel);
    await this.persistRelation(newRel);
    return newRel;
  }

  // ========== 智能推理 ==========

  /**
   * 关系推理 v2 — 从"同类型连线"升级为：
   * 1. 语义相似度推理：embedding 相似度 > 0.7 → "related_to"
   * 2. 共现分析：同一对话中频繁出现 → "co_occurs"
   * 3. 层级推理：技术→框架→库 → "includes"
   * 4. 类型推断：同类型 + 语义接近 → "similar_to"
   */
  private async inferRelations(entity: KnowledgeEntity): Promise<void> {
    const candidates = [...this.entities.values()].filter(e => e.id !== entity.id);
    if (candidates.length === 0) return;

    // 1. 语义相似度推理
    await this.inferBySemanticSimilarity(entity, candidates);

    // 2. 类型层级推理
    this.inferByTypeHierarchy(entity, candidates);
  }

  /** 基于 embedding 相似度推断关系 */
  private async inferBySemanticSimilarity(entity: KnowledgeEntity, candidates: KnowledgeEntity[]): Promise<void> {
    // 优先使用已有 embedding
    let entityEmb = entity.embedding;
    if (!entityEmb) {
      try { entityEmb = await getEmbedding(`${entity.name} ${entity.description || ''} ${entity.type}`); }
      catch { return; }
    }
    if (!entityEmb) return;

    for (const candidate of candidates) {
      let candEmb = candidate.embedding;
      if (!candEmb) {
        try { candEmb = await getEmbedding(`${candidate.name} ${candidate.description || ''} ${candidate.type}`); }
        catch { continue; }
      }
      if (!candEmb || candEmb.length !== entityEmb.length) continue;

      const sim = cosineSimilarity(entityEmb, candEmb);

      if (sim > 0.85) {
        // 极高相似度 → similar_to
        const existing = this.relations.find(r =>
          (r.from === entity.id && r.to === candidate.id) ||
          (r.from === candidate.id && r.to === entity.id)
        );
        if (!existing) {
          await this.addRelation({
            from: entity.id, to: candidate.id, type: 'similar_to',
            confidence: sim
          });
        }
      } else if (sim > 0.6 && entity.type === candidate.type) {
        // 同类型 + 中等相似度 → related_to
        const existing = this.relations.find(r =>
          (r.from === entity.id && r.to === candidate.id && r.type === 'related_to') ||
          (r.from === candidate.id && r.to === entity.id && r.type === 'related_to')
        );
        if (!existing) {
          await this.addRelation({
            from: entity.id, to: candidate.id, type: 'related_to',
            confidence: sim
          });
        }
      }
    }
  }

  /** 基于类型层级推断关系 */
  private inferByTypeHierarchy(entity: KnowledgeEntity, candidates: KnowledgeEntity[]): void {
    const typeHierarchy: Record<string, string[]> = {
      'technology': ['framework', 'library', 'tool', 'language', 'database'],
      'framework': ['library'],
      'language': ['framework', 'library'],
    };

    for (const candidate of candidates) {
      const parentTypes = typeHierarchy[entity.type] || [];
      const childTypes = typeHierarchy[candidate.type] || [];

      // entity 是 candidate 的父类型
      if (parentTypes.includes(candidate.type)) {
        const existing = this.hasRelation(entity.id, candidate.id, 'includes');
        if (!existing) {
          this.relations.push({
            id: this.generateId(), from: entity.id, to: candidate.id,
            type: 'includes', confidence: 0.7
          });
        }
      }
      // candidate 是 entity 的父类型
      if (childTypes.includes(entity.type)) {
        const existing = this.hasRelation(candidate.id, entity.id, 'includes');
        if (!existing) {
          this.relations.push({
            id: this.generateId(), from: candidate.id, to: entity.id,
            type: 'includes', confidence: 0.7
          });
        }
      }
    }
  }

  /** 从对话内容提取共现关系 */
  async extractCooccurrence(content: string, entityIds: string[]): Promise<void> {
    if (entityIds.length < 2) return;

    // 出现在同一对话中的实体，增加共现关系
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const existing = this.hasRelation(entityIds[i], entityIds[j], 'co_occurs');
        if (!existing) {
          await this.addRelation({
            from: entityIds[i], to: entityIds[j], type: 'co_occurs',
            confidence: 0.3 // 初始低置信度，多次共现后提升
          });
        } else {
          // 提升已有共现关系的置信度
          existing.confidence = Math.min(existing.confidence + 0.1, 0.9);
          await this.persistRelation(existing);
        }
      }
    }
  }

  private hasRelation(from: string, to: string, type: string): KnowledgeRelation | undefined {
    return this.relations.find(r =>
      ((r.from === from && r.to === to) || (r.from === to && r.to === from)) && r.type === type
    );
  }

  // ========== 搜索 ==========

  async search(query: string, domain?: string): Promise<KnowledgeSearchResult[]> {
    const results: KnowledgeSearchResult[] = [];

    // 尝试语义搜索
    try {
      const semanticResults = await this.semanticSearch.search(query, 10);
      for (const sr of semanticResults) {
        const entity = this.entities.get(sr.id);
        if (!entity) continue;
        if (domain && entity.type !== domain) continue;
        results.push({ entity, relations: this.getRelationsForEntity(entity.id), score: sr.similarity });
      }
    } catch { /* fall through */ }

    // 降级：关键词
    if (results.length === 0) {
      for (const entity of this.entities.values()) {
        if (domain && entity.type !== domain) continue;
        const textToSearch = `${entity.name} ${entity.description || ''} ${entity.type}`;
        const score = keywordScore(query, textToSearch);
        if (score > 0) {
          results.push({ entity, relations: this.getRelationsForEntity(entity.id), score });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 10);
  }

  /** 查询实体及其关联 */
  async getEntityWithRelations(id: string): Promise<{ entity: KnowledgeEntity | undefined; relations: KnowledgeRelation[]; related: KnowledgeEntity[] }> {
    const entity = this.entities.get(id);
    if (!entity) return { entity: undefined, relations: [], related: [] };

    const relations = this.getRelationsForEntity(id);
    const relatedIds = new Set<string>();
    for (const r of relations) {
      relatedIds.add(r.from === id ? r.to : r.from);
    }
    const related = [...relatedIds].map(rid => this.entities.get(rid)).filter(Boolean) as KnowledgeEntity[];

    return { entity, relations, related };
  }

  /** 图谱统计 */
  getGraphStats(): {
    totalEntities: number;
    totalRelations: number;
    byType: Record<string, number>;
    relationTypes: Record<string, number>;
    avgConfidence: number;
    connectedEntities: number;
  } {
    const byType: Record<string, number> = {};
    const relationTypes: Record<string, number> = {};
    const connected = new Set<string>();

    for (const e of this.entities.values()) byType[e.type] = (byType[e.type] || 0) + 1;
    for (const r of this.relations) {
      relationTypes[r.type] = (relationTypes[r.type] || 0) + 1;
      connected.add(r.from);
      connected.add(r.to);
    }

    const avgConf = this.relations.length > 0
      ? this.relations.reduce((s, r) => s + r.confidence, 0) / this.relations.length
      : 0;

    return {
      totalEntities: this.entities.size,
      totalRelations: this.relations.length,
      byType, relationTypes,
      avgConfidence: avgConf,
      connectedEntities: connected.size
    };
  }

  getEntity(id: string): KnowledgeEntity | undefined { return this.entities.get(id); }

  async deleteEntity(id: string): Promise<boolean> {
    const deleted = this.entities.delete(id);
    if (deleted) {
      this.relations = this.relations.filter(r => r.from !== id && r.to !== id);
      this.semanticSearch.removeDocument(id);
    }
    return deleted;
  }

  async clear(): Promise<void> {
    this.entities.clear();
    this.relations = [];
    this.semanticSearch.clear();
  }

  getStats(): {
    totalEntities: number; totalRelations: number;
    byType: Record<string, number>;
    searchIndex: ReturnType<SemanticSearch['getStats']>;
  } {
    const byType: Record<string, number> = {};
    for (const e of this.entities.values()) byType[e.type] = (byType[e.type] || 0) + 1;
    return { totalEntities: this.entities.size, totalRelations: this.relations.length, byType, searchIndex: this.semanticSearch.getStats() };
  }

  // ========== 私有方法 ==========

  private generateId(): string {
    return `ent_${this.ctx.agentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getRelationsForEntity(entityId: string): KnowledgeRelation[] {
    return this.relations.filter(r => r.from === entityId || r.to === entityId);
  }

  private async addToSemanticSearch(entity: KnowledgeEntity): Promise<void> {
    try {
      await this.semanticSearch.addDocument({
        id: entity.id,
        content: `${entity.name} ${entity.description || ''} ${entity.type}`,
        embedding: entity.embedding,
        metadata: { type: entity.type, createdAt: entity.createdAt }
      });
    } catch { /* non-critical */ }
  }

  private async persistEntity(entity: KnowledgeEntity): Promise<void> {
    try {
      const filePath = path.join(this.storageDir, "entities.json");
      let entities: KnowledgeEntity[] = [];
      if (fs.existsSync(filePath)) entities = JSON.parse(fs.readFileSync(filePath, "utf8"));
      entities.push(entity);
      fs.writeFileSync(filePath, JSON.stringify(entities, null, 2), "utf8");
    } catch (err) { console.error("[KnowledgeGraph] Persist entity error:", err); }
  }

  async persistRelation(relation: KnowledgeRelation): Promise<void> {
    try {
      const filePath = path.join(this.storageDir, "relations.json");
      let relations: KnowledgeRelation[] = [];
      if (fs.existsSync(filePath)) relations = JSON.parse(fs.readFileSync(filePath, "utf8"));
      relations.push(relation);
      fs.writeFileSync(filePath, JSON.stringify(relations, null, 2), "utf8");
    } catch (err) { console.error("[KnowledgeGraph] Persist relation error:", err); }
  }

  private load(): void {
    try {
      const entitiesPath = path.join(this.storageDir, "entities.json");
      if (fs.existsSync(entitiesPath)) {
        const entities: KnowledgeEntity[] = JSON.parse(fs.readFileSync(entitiesPath, "utf8"));
        for (const e of entities) {
          this.entities.set(e.id, e);
          this.addToSemanticSearch(e).catch(() => {});
        }
      }
      const relationsPath = path.join(this.storageDir, "relations.json");
      if (fs.existsSync(relationsPath)) {
        this.relations = JSON.parse(fs.readFileSync(relationsPath, "utf8"));
      }
      console.log(`[KnowledgeGraph] Loaded ${this.entities.size} entities, ${this.relations.length} relations`);
    } catch (err) { console.error("[KnowledgeGraph] Load error:", err); }
  }

  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  }
}
