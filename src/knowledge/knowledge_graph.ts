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
import { getEmbedding, getEmbeddingLevel, simpleKeywordMatch } from "../memory/embedding_provider";
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
      try { const emb = await getEmbedding(`${entity.name} ${entity.description || ''} ${entity.type}`); entityEmb = emb || undefined; }
      catch { return; }
    }
    if (!entityEmb) return;

    for (const candidate of candidates) {
      let candEmb = candidate.embedding;
      if (!candEmb) {
        try { const emb = await getEmbedding(`${candidate.name} ${candidate.description || ''} ${candidate.type}`); candEmb = emb || undefined; }
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
        const score = simpleKeywordMatch(query, textToSearch);
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
        const raw = JSON.parse(fs.readFileSync(entitiesPath, "utf8"));
        // Handle both array format and wrapped object format { entities: [...], metadata: {...} }
        const entities: KnowledgeEntity[] = Array.isArray(raw) ? raw : (raw.entities || []);
        for (const e of entities) {
          this.entities.set(e.id, e);
          this.addToSemanticSearch(e).catch(() => {});
        }
      }
      const relationsPath = path.join(this.storageDir, "relations.json");
      if (fs.existsSync(relationsPath)) {
        const raw = JSON.parse(fs.readFileSync(relationsPath, "utf8"));
        this.relations = Array.isArray(raw) ? raw : (raw.relations || []);
      }
      console.log(`[KnowledgeGraph] Loaded ${this.entities.size} entities, ${this.relations.length} relations`);
    } catch (err) { console.error("[KnowledgeGraph] Load error:", err); }
  }

  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  }

  // ========== 图算法 ==========

  /**
   * 查找两个实体之间的最短路径（BFS）
   * @returns 路径数组 [fromId, ...intermediate, toId] 或 null
   */
  findPath(fromId: string, toId: string, relationTypes?: string[]): string[] | null {
    if (fromId === toId) return [fromId];
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return null;

    const allowedTypes = relationTypes ? new Set(relationTypes) : null;
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      // 找邻居（过滤关系类型）
      const neighbors = this.relations
        .filter(r => {
          if (allowedTypes && !allowedTypes.has(r.type)) return false;
          return r.from === id || r.to === id;
        })
        .map(r => r.from === id ? r.to : r.from);

      for (const neighbor of neighbors) {
        if (neighbor === toId) return [...path, neighbor];
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push({ id: neighbor, path: [...path, neighbor] });
      }
    }

    return null;
  }

  /**
   * 计算度中心性（每个实体的连接数）
   * @returns 按中心性排序的实体列表 { id, degree, centrality }
   */
  degreeCentrality(): Array<{ id: string; name: string; degree: number; centrality: number }> {
    const degree = new Map<string, number>();

    // 初始化所有实体度为 0
    for (const e of this.entities.values()) degree.set(e.id, 0);

    // 统计关系数（无向图）
    for (const r of this.relations) {
      degree.set(r.from, (degree.get(r.from) || 0) + 1);
      degree.set(r.to, (degree.get(r.to) || 0) + 1);
    }

    const n = this.entities.size;
    return [...degree.entries()]
      .map(([id, deg]) => ({
        id,
        name: this.entities.get(id)?.name || id,
        degree: deg,
        centrality: n > 1 ? deg / (n - 1) : 0
      }))
      .sort((a, b) => b.degree - a.degree);
  }

  /**
   * 查找连通分量（图是否分成多个独立子图）
   * @returns 连通分量列表，每个分量包含实体 ID 数组
   */
  connectedComponents(): string[][] {
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const entityId of this.entities.keys()) {
      if (visited.has(entityId)) continue;

      // BFS 遍历这个分量
      const component: string[] = [];
      const queue = [entityId];
      visited.add(entityId);

      while (queue.length > 0) {
        const id = queue.shift()!;
        component.push(id);

        // 找邻居（无向）
        const neighbors = this.relations
          .filter(r => r.from === id || r.to === id)
          .map(r => r.from === id ? r.to : r.from);

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    return components;
  }

  /**
   * 导出图谱为 JSON（含实体、关系、统计信息）
   */
  exportGraph(): {
    entities: KnowledgeEntity[];
    relations: KnowledgeRelation[];
    stats: {
      totalEntities: number;
      totalRelations: number;
      byType: Record<string, number>;
      relationTypes: Record<string, number>;
      avgConfidence: number;
      connectedEntities: number;
    };
    centrality: Array<{ id: string; name: string; degree: number; centrality: number }>;
    components: string[][];
    exportedAt: string;
  } {
    return {
      entities: [...this.entities.values()],
      relations: [...this.relations],
      stats: this.getGraphStats(),
      centrality: this.degreeCentrality().slice(0, 10), // top 10
      components: this.connectedComponents(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * 导出图谱为 Markdown 可读格式
   */
  exportMarkdown(): string {
    const lines: string[] = [
      `# Knowledge Graph - ${this.ctx.agentId}`,
      ``,
      `## 统计`,
      ``,
    ];

    const stats = this.getGraphStats();
    lines.push(`- 实体总数: ${stats.totalEntities}`);
    lines.push(`- 关系总数: ${stats.totalRelations}`);
    lines.push(`- 平均置信度: ${(stats.avgConfidence * 100).toFixed(1)}%`);
    lines.push(`- 已连接实体: ${stats.connectedEntities}`);
    lines.push(``);

    // 实体按类型分组
    lines.push(`## 实体`);
    lines.push(``);
    for (const [type, entities] of Object.entries(
      [...this.entities.values()].reduce((acc, e) => {
        (acc[e.type] ||= []).push(e);
        return acc;
      }, {} as Record<string, KnowledgeEntity[]>)
    )) {
      lines.push(`### ${type} (${entities.length})`);
      lines.push(``);
      for (const e of entities) {
        lines.push(`- **${e.name}** \`[${e.id.slice(-9)}]\``);
        if (e.description) lines.push(`  ${e.description}`);
      }
      lines.push(``);
    }

    // 关系
    lines.push(`## 关系`);
    lines.push(``);
    lines.push(`| From | Type | To | Confidence |`);
    lines.push(`|------|------|----|------------|`);
    for (const r of this.relations.sort((a, b) => b.confidence - a.confidence)) {
      const fromName = this.entities.get(r.from)?.name || r.from.slice(-9);
      const toName = this.entities.get(r.to)?.name || r.to.slice(-9);
      lines.push(`| ${fromName} | ${r.type} | ${toName} | ${(r.confidence * 100).toFixed(0)}% |`);
    }
    lines.push(``);

    return lines.join('\n');
  }
}
