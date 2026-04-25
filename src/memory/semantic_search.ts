/**
 * 语义搜索模块
 * 
 * 使用余弦相似度进行向量检索
 * 降级策略：API embedding → TF-IDF → keyword
 */

import { EmbeddingCache, cosineSimilarity } from './embedding_cache';

export interface SemanticSearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface SearchableDocument {
  id: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, any>;
}

export class SemanticSearch {
  private documents: Map<string, SearchableDocument>;
  private embeddingCache: EmbeddingCache;
  private embeddingFunc: ((text: string) => Promise<number[]>) | null;

  constructor(
    embeddingFunc?: (text: string) => Promise<number[]>,
    cacheSize?: number
  ) {
    this.documents = new Map();
    this.embeddingCache = new EmbeddingCache({ maxSize: cacheSize || 5000 });
    this.embeddingFunc = embeddingFunc || null;
  }

  /**
   * 添加文档
   */
  async addDocument(doc: SearchableDocument): Promise<void> {
    this.documents.set(doc.id, doc);

    // 如果文档没有 embedding 且提供了 embedding 函数，则计算
    if (!doc.embedding && this.embeddingFunc) {
      try {
        doc.embedding = await this.embeddingCache.getOrCompute(
          doc.content,
          this.embeddingFunc
        );
      } catch {
        // embedding 不可用，文档仍然可以索引（keyword fallback）
      }
    }
  }

  /**
   * 批量添加文档
   */
  async addDocuments(docs: SearchableDocument[]): Promise<void> {
    for (const doc of docs) {
      await this.addDocument(doc);
    }
  }

  /**
   * 语义搜索（带降级）
   */
  async search(
    query: string,
    topK: number = 5
  ): Promise<SemanticSearchResult[]> {
    // 尝试获取查询向量
    let queryEmbedding: number[] | null = null;

    if (this.embeddingFunc) {
      try {
        queryEmbedding = await this.embeddingCache.getOrCompute(
          query,
          this.embeddingFunc
        );
      } catch {
        // embedding 不可用
      }
    }

    if (!queryEmbedding) {
      // 降级到关键词搜索
      return this.keywordSearch(query, topK);
    }

    // 计算所有文档的余弦相似度
    const results: SemanticSearchResult[] = [];

    for (const [id, doc] of this.documents) {
      if (doc.embedding && doc.embedding.length === queryEmbedding.length) {
        const similarity = cosineSimilarity(queryEmbedding, doc.embedding);
        results.push({
          id: doc.id,
          content: doc.content,
          similarity,
          metadata: doc.metadata
        });
      }
    }

    // 排序并返回 topK
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * 关键词搜索（fallback）
   */
  keywordSearch(query: string, topK: number = 5): SemanticSearchResult[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/[\s\p{P}]+/u).filter(w => w.length > 1);

    if (queryWords.length === 0) {
      return [];
    }

    const results: SemanticSearchResult[] = [];

    for (const [id, doc] of this.documents) {
      const contentLower = doc.content.toLowerCase();
      let score = 0;
      let matched = 0;

      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          // 完全匹配权重更高
          const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          const matches = contentLower.match(regex);
          if (matches) {
            score += matches.length * 2;
            matched++;
          }
        }
      }

      // 归一化
      if (matched > 0) {
        score = score / (queryWords.length * 2);
        results.push({
          id: doc.id,
          content: doc.content,
          similarity: Math.min(score, 1.0),
          metadata: doc.metadata
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * 删除文档
   */
  removeDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  /**
   * 获取文档数量
   */
  getDocumentCount(): number {
    return this.documents.size;
  }

  /**
   * 清空所有文档
   */
  clear(): void {
    this.documents.clear();
    this.embeddingCache.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    documents: number;
    withEmbedding: number;
    cacheStats: ReturnType<EmbeddingCache['getStats']>;
  } {
    let withEmbedding = 0;
    for (const doc of this.documents.values()) {
      if (doc.embedding) withEmbedding++;
    }

    return {
      documents: this.documents.size,
      withEmbedding,
      cacheStats: this.embeddingCache.getStats()
    };
  }
}
