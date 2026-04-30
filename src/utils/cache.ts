/**
 * Cache - 轻量级缓存系统
 * 
 * 提供内存缓存，减少重复计算和 IO 操作
 */

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl?: number; // Time to live in ms
}

export interface CacheOptions {
  maxEntries?: number;
  defaultTTL?: number; // ms
}

export class Cache<K = string, V = any> {
  private cache = new Map<K, CacheEntry<V>>();
  private maxEntries: number;
  private defaultTTL: number;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries || 1000;
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 5 minutes
  }

  /**
   * 获取缓存值
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * 设置缓存值
   */
  set(key: K, value: V, ttl?: number): void {
    // 如果超过最大条目数，删除最旧的 10%
    if (this.cache.size >= this.maxEntries) {
      this.evict(0.1);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL
    });
  }

  /**
   * 检查键是否存在（不过期）
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * 删除缓存
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    maxEntries: number;
    oldestEntry?: number;
    newestEntry?: number;
  } {
    const timestamps = Array.from(this.cache.values()).map(e => e.timestamp);
    
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined
    };
  }

  /**
   * 强制清理过期条目
   */
  cleanup(): number {
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  // ========== 私有方法 ==========

  private isExpired(entry: CacheEntry<V>): boolean {
    if (entry.ttl === undefined || entry.ttl <= 0) {
      return false; // 永不过期
    }
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private evict(percentage: number): void {
    const toRemove = Math.floor(this.cache.size * percentage);
    if (toRemove <= 0) return;

    // Single-pass: collect keys sorted by timestamp
    const keysWithTime: Array<[K, number]> = [];
    for (const [key, entry] of this.cache) {
      keysWithTime.push([key, entry.timestamp]);
    }
    keysWithTime.sort((a, b) => a[1] - b[1]);

    for (let i = 0; i < toRemove && i < keysWithTime.length; i++) {
      this.cache.delete(keysWithTime[i][0]);
    }
  }
}

// 全局缓存实例
const globalCaches = new Map<string, Cache>();

/**
 * 获取或创建全局缓存
 */
export function getCache(name: string, options?: CacheOptions): Cache {
  if (!globalCaches.has(name)) {
    globalCaches.set(name, new Cache(options));
  }
  return globalCaches.get(name)!;
}

/**
 * 清理所有全局缓存
 */
export function cleanupAllCaches(): number {
  let total = 0;
  for (const cache of globalCaches.values()) {
    total += cache.cleanup();
  }
  return total;
}
