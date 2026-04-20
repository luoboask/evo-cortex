/**
 * Knowledge Graph - 知识图谱
 *
 * 功能：
 * - 存储领域知识
 * - 实体和关系管理
 * - 知识检索和扩展
 * - 持久化到文件系统
 * - 实体提取和关系推理
 */

import * as fs from "fs";
import * as path from "path";
import { PluginContext, getKnowledgeStorageDir } from "../utils/plugin-context";

export interface KnowledgeEntity {
  id: string;
  name: string;
  type: string;
  properties?: Record<string, any>;
  createdAt: string;
}

export interface KnowledgeRelation {
  id: string;
  from: string;
  to: string;
  type: string;
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

// 领域分类
export const DOMAIN_CATEGORIES = [
  "programming",
  "science",
  "math",
  "history",
  "language",
  "technology",
  "business",
  "health",
  "other"
];

export class KnowledgeGraph {
  private ctx: PluginContext;
  private config: KnowledgeConfig;
  private entities: Map<string, KnowledgeEntity> = new Map();
  private relations: KnowledgeRelation[] = [];
  private storageDir: string;

  constructor(ctx: PluginContext, config?: Partial<KnowledgeConfig>) {
    this.ctx = ctx;
    this.config = {
      enabled: true,
      auto_expand: true,
      ...config
    };

    // 使用绝对路径初始化存储目录
    this.storageDir = getKnowledgeStorageDir(ctx);
    this.ensureDirectory(this.storageDir);

    console.log(`[KnowledgeGraph] Initialized for agent: ${ctx.agentId}, storage: ${this.storageDir}`);

    // 加载持久化数据
    this.load();
  }
  
  /**
   * 添加实体
   */
  async addEntity(entity: Omit<KnowledgeEntity, "id">): Promise<KnowledgeEntity> {
    const newEntity: KnowledgeEntity = {
      ...entity,
      id: this.generateId()
    };

    this.entities.set(newEntity.id, newEntity);

    // 持久化到文件系统
    await this.persistEntity(newEntity);

    // 自动推理关系
    if (this.config.auto_expand) {
      await this.autoInferRelations(newEntity);
    }

    console.log(`[KnowledgeGraph] Added entity: ${newEntity.name} (${newEntity.type})`);
    return newEntity;
  }

  /**
   * 批量添加实体
   */
  async addEntities(entities: Array<Omit<KnowledgeEntity, "id">>): Promise<KnowledgeEntity[]> {
    const added: KnowledgeEntity[] = [];
    for (const entity of entities) {
      const newEntity = await this.addEntity(entity);
      added.push(newEntity);
    }
    return added;
  }

  /**
   * 添加关系
   */
  async addRelation(relation: Omit<KnowledgeRelation, "id">): Promise<KnowledgeRelation> {
    const newRelation: KnowledgeRelation = {
      ...relation,
      id: this.generateId()
    };

    this.relations.push(newRelation);
    await this.persistRelation(newRelation);

    console.log(`[KnowledgeGraph] Added relation: ${relation.from} -> ${relation.to} (${relation.type})`);
    return newRelation;
  }

  /**
   * 搜索知识
   */
  async search(query: string, domain?: string): Promise<KnowledgeSearchResult[]> {
    const results: KnowledgeSearchResult[] = [];

    for (const entity of this.entities.values()) {
      // 领域筛选
      if (domain && entity.type !== domain) continue;

      // 简单匹配
      const score = this.calculateRelevance(entity, query);
      if (score > 0) {
        const entityRelations = this.getRelationsForEntity(entity.id);
        results.push({
          entity,
          relations: entityRelations,
          score
        });
      }
    }

    // 按相关性排序
    results.sort((a, b) => b.score - a.score);

    console.log(`[KnowledgeGraph] Search "${query}" returned ${results.length} results for agent ${this.ctx.agentId}`);
    return results.slice(0, 10);
  }

  /**
   * 获取实体
   */
  getEntity(id: string): KnowledgeEntity | undefined {
    return this.entities.get(id);
  }

  /**
   * 删除实体
   */
  async deleteEntity(id: string): Promise<boolean> {
    const deleted = this.entities.delete(id);
    if (deleted) {
      // 删除相关关系
      this.relations = this.relations.filter(r => r.from !== id && r.to !== id);
      console.log(`[KnowledgeGraph] Deleted entity: ${id}`);
    }
    return deleted;
  }

  /**
   * 清空所有知识
   */
  async clear(): Promise<void> {
    this.entities.clear();
    this.relations = [];
    console.log(`[KnowledgeGraph] Cleared all knowledge for agent ${this.ctx.agentId}`);
  }

  /**
   * 获取统计信息
   */
  getStats(): { 
    totalEntities: number; 
    totalRelations: number; 
    byType: Record<string, number> 
  } {
    const byType: Record<string, number> = {};
    for (const entity of this.entities.values()) {
      byType[entity.type] = (byType[entity.type] || 0) + 1;
    }

    return {
      totalEntities: this.entities.size,
      totalRelations: this.relations.length,
      byType
    };
  }

  // ========== 私有方法 ==========

  private generateId(): string {
    return `ent_${this.ctx.agentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateRelevance(entity: KnowledgeEntity, query: string): number {
    const queryLower = query.toLowerCase();
    const nameLower = entity.name.toLowerCase();
    
    // 完全匹配
    if (nameLower === queryLower) return 1.0;
    
    // 包含匹配
    if (nameLower.includes(queryLower)) return 0.8;
    
    // 部分匹配
    const queryWords = queryLower.split(/\s+/);
    let matches = 0;
    for (const word of queryWords) {
      if (nameLower.includes(word)) {
        matches++;
      }
    }
    
    return matches / queryWords.length * 0.5;
  }

  private getRelationsForEntity(entityId: string): KnowledgeRelation[] {
    return this.relations.filter(r => r.from === entityId || r.to === entityId);
  }

  /**
   * 自动推理关系（简单实现）
   */
  private async autoInferRelations(entity: KnowledgeEntity): Promise<void> {
    // TODO: 实现更智能的关系推理
    // 当前简单实现：查找名称相似的实体
    
    for (const existing of this.entities.values()) {
      if (existing.id === entity.id) continue;
      
      // 如果类型相同，可能有关联
      if (existing.type === entity.type) {
        await this.addRelation({
          from: entity.id,
          to: existing.id,
          type: "related_to"
        });
      }
    }
  }

  /**
   * 持久化实体到文件系统
   */
  private async persistEntity(entity: KnowledgeEntity): Promise<void> {
    try {
      const filePath = path.join(this.storageDir, "entities.json");
      
      let entities: KnowledgeEntity[] = [];
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        entities = JSON.parse(content);
      }
      
      entities.push(entity);
      fs.writeFileSync(filePath, JSON.stringify(entities, null, 2), "utf8");
      
      console.log(`[KnowledgeGraph] Persisted entity to: ${filePath}`);
    } catch (error) {
      console.error("[KnowledgeGraph] Persist entity error:", error);
    }
  }

  /**
   * 持久化关系到文件系统
   */
  private async persistRelation(relation: KnowledgeRelation): Promise<void> {
    try {
      const filePath = path.join(this.storageDir, "relations.json");
      
      let relations: KnowledgeRelation[] = [];
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        relations = JSON.parse(content);
      }
      
      relations.push(relation);
      fs.writeFileSync(filePath, JSON.stringify(relations, null, 2), "utf8");
      
      console.log(`[KnowledgeGraph] Persisted relation to: ${filePath}`);
    } catch (error) {
      console.error("[KnowledgeGraph] Persist relation error:", error);
    }
  }

  /**
   * 加载持久化的数据
   */
  private load(): void {
    try {
      // 加载实体
      const entitiesPath = path.join(this.storageDir, "entities.json");
      if (fs.existsSync(entitiesPath)) {
        const content = fs.readFileSync(entitiesPath, "utf8");
        const entities: KnowledgeEntity[] = JSON.parse(content);
        for (const entity of entities) {
          this.entities.set(entity.id, entity);
        }
      }

      // 加载关系
      const relationsPath = path.join(this.storageDir, "relations.json");
      if (fs.existsSync(relationsPath)) {
        const content = fs.readFileSync(relationsPath, "utf8");
        this.relations = JSON.parse(content);
      }

      console.log(`[KnowledgeGraph] Loaded ${this.entities.size} entities, ${this.relations.length} relations from storage`);
    } catch (error) {
      console.error("[KnowledgeGraph] Load error:", error);
    }
  }

  /**
   * 确保目录存在
   */
  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[KnowledgeGraph] Created storage directory: ${dirPath}`);
    }
  }
}
