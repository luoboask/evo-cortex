/**
 * Embedding 缓存系统
 * 
 * LRU 缓存，支持多 Agent 隔离
 */

export interface EmbeddingCacheConfig {
  maxSize: number;
  ttlMs: number;
}

interface CacheEntry {
  embedding: number[];
  timestamp: number;
  lastAccess: number;
}

export class EmbeddingCache {
  private cache: Map<string, CacheEntry>;
  private config: EmbeddingCacheConfig;
  private hits: number = 0;
  private misses: number = 0;

  constructor(config?: Partial<EmbeddingCacheConfig>) {
    this.config = {
      maxSize: 10000,
      ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 天
      ...config
    };
    this.cache = new Map();
  }

  /**
   * 获取 Embedding
   */
  get(text: string): number[] | null {
    const key = this.hashText(text);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // 更新访问时间
    entry.lastAccess = Date.now();
    this.hits++;
    return entry.embedding;
  }

  /**
   * 设置 Embedding
   */
  set(text: string, embedding: number[]): void {
    const key = this.hashText(text);

    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.config.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now(),
      lastAccess: Date.now()
    });
  }

  /**
   * 获取或计算 Embedding
   */
  async getOrCompute(
    text: string,
    computeFunc: (text: string) => Promise<number[]>
  ): Promise<number[]> {
    const cached = this.get(text);
    if (cached) {
      return cached;
    }

    const embedding = await computeFunc(text);
    this.set(text, embedding);
    return embedding;
  }

  /**
   * 批量获取
   */
  getBatch(texts: string[]): Map<string, number[] | null> {
    const results = new Map<string, number[] | null>();
    for (const text of texts) {
      results.set(text, this.get(text));
    }
    return results;
  }

  /**
   * 批量设置
   */
  setBatch(embeddings: Map<string, number[]>): void {
    for (const [text, embedding] of embeddings) {
      this.set(text, embedding);
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0
    };
  }

  /**
   * 清理过期条目
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.config.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    console.log(`[EmbeddingCache] Cleaned ${cleaned} expired entries`);
    return cleaned;
  }

  // ========== 私有方法 ==========

  private hashText(text: string): string {
    // 简单哈希
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为 32 位整数
    }
    return hash.toString(36);
  }

  private evictOldest(): void {
    // 删除最早访问的条目
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vector dimensions must match');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
