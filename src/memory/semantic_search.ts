/**
 * 语义搜索模块
 * 
 * 使用余弦相似度进行向量检索
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
      doc.embedding = await this.embeddingCache.getOrCompute(
        doc.content,
        this.embeddingFunc
      );
    }

    console.log(`[SemanticSearch] Added document: ${doc.id}`);
  }

  /**
   * 批量添加文档
   */
  async addDocuments(docs: SearchableDocument[]): Promise<void> {
    for (const doc of docs) {
      await this.addDocument(doc);
    }
    console.log(`[SemanticSearch] Added ${docs.length} documents`);
  }

  /**
   * 语义搜索
   */
  async search(
    query: string,
    topK: number = 5
  ): Promise<SemanticSearchResult[]> {
    if (!this.embeddingFunc) {
      console.warn('[SemanticSearch] No embedding function provided, falling back to keyword search');
      return this.keywordSearch(query, topK);
    }

    // 获取查询向量
    const queryEmbedding = await this.embeddingCache.getOrCompute(
      query,
      this.embeddingFunc
    );

    // 计算所有文档的相似度
    const results: SemanticSearchResult[] = [];

    for (const [id, doc] of this.documents) {
      if (doc.embedding) {
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
    const queryWords = queryLower.split(/\s+/);

    const results: SemanticSearchResult[] = [];

    for (const [id, doc] of this.documents) {
      const contentLower = doc.content.toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          score++;
        }
      }

      if (score > 0) {
        results.push({
          id: doc.id,
          content: doc.content,
          similarity: score / queryWords.length
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
    cacheStats: ReturnType<EmbeddingCache['getStats']>;
  } {
    return {
      documents: this.documents.size,
      cacheStats: this.embeddingCache.getStats()
    };
  }
}
