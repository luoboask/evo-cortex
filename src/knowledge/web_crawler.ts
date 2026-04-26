/**
 * 网络知识爬取器
 *
 * 抓取网页内容，提取正文和关键词
 * 带文件系统缓存，默认 24 小时过期
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CrawledPage {
  url: string;
  title: string;
  content: string;
  markdown: string;
  keywords: string[];
  publishedAt?: string;
  crawledAt: string;
  metadata: Record<string, any>;
}

export interface CrawlConfig {
  timeout?: number;
  maxRetries?: number;
  cacheDir?: string;
  cacheTtlMs?: number;       // 缓存过期时间（默认 24h）
  maxCacheEntries?: number;  // 最大缓存条目数（默认 500）
}

export class WebCrawler {
  private config: Required<CrawlConfig>;
  private inMemoryCache: Map<string, { page: CrawledPage; expiresAt: number }>;

  constructor(config?: CrawlConfig) {
    this.config = {
      timeout: config?.timeout || 30000,
      maxRetries: config?.maxRetries || 3,
      cacheDir: config?.cacheDir || '/tmp/web-cache',
      cacheTtlMs: config?.cacheTtlMs || 24 * 60 * 60 * 1000,
      maxCacheEntries: config?.maxCacheEntries || 500
    };
    this.inMemoryCache = new Map();
    this.ensureCacheDir();
  }

  /** 确保缓存目录存在 */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.config.cacheDir)) {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
    }
  }

  /** 根据 URL 生成缓存文件名（SHA-256 哈希） */
  private getCacheFilePath(url: string): string {
    const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
    return path.join(this.config.cacheDir, `${hash}.json`);
  }

  /** 写入缓存元数据索引（用于 LRU 清理） */
  private updateCacheIndex(url: string, filePath: string): void {
    const indexPath = path.join(this.config.cacheDir, '_index.json');
    let index: Array<{ url: string; file: string; at: number }> = [];
    try {
      if (fs.existsSync(indexPath)) {
        index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    // 移除旧条目
    index = index.filter(e => e.url !== url);
    index.push({ url, file: filePath, at: Date.now() });
    // 限制索引大小
    if (index.length > this.config.maxCacheEntries) {
      const removed = index.splice(0, index.length - this.config.maxCacheEntries);
      for (const r of removed) {
        try { fs.unlinkSync(r.file); } catch { /* ignore */ }
      }
    }
    try {
      fs.writeFileSync(indexPath, JSON.stringify(index), 'utf-8');
    } catch { /* ignore */ }
  }

  /**
   * 抓取单个网页
   */
  async crawl(url: string): Promise<CrawledPage> {
    const page: CrawledPage = {
      url,
      title: '',
      content: '',
      markdown: '',
      keywords: [],
      crawledAt: new Date().toISOString(),
      metadata: {}
    };

    // 尝试获取缓存
    const cached = this.getCache(url);
    if (cached) {
      console.log(`[WebCrawler] Cache hit: ${url}`);
      return cached;
    }

    // 抓取网页
    let attempts = 0;
    let html = '';

    while (attempts < this.config.maxRetries) {
      try {
        html = await this.fetchPage(url);
        break;
      } catch (error) {
        attempts++;
        if (attempts >= this.config.maxRetries) {
          throw new Error(`Failed to fetch ${url} after ${attempts} attempts: ${error}`);
        }
        await this.sleep(1000 * attempts);
      }
    }

    // 解析内容
    page.title = this.extractTitle(html);
    page.content = this.extractContent(html);
    page.markdown = this.htmlToMarkdown(html);
    page.keywords = this.extractKeywords(page.content);
    page.publishedAt = this.extractPublishedAt(html);

    // 缓存
    this.setCache(url, page);

    console.log(`[WebCrawler] Crawled: ${url} (${page.title})`);
    return page;
  }

  /**
   * 批量抓取
   */
  async crawlBatch(urls: string[], concurrency: number = 3): Promise<CrawledPage[]> {
    const results: CrawledPage[] = [];
    const queue = [...urls];

    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const promises = batch.map(url =>
        this.crawl(url).catch(error => {
          console.error(`[WebCrawler] Failed to crawl ${url}:`, error);
          return null;
        })
      );

      const batchResults = await Promise.all(promises);
      for (const result of batchResults) {
        if (result) {
          results.push(result);
        }
      }
    }

    console.log(`[WebCrawler] Batch crawled: ${results.length}/${urls.length}`);
    return results;
  }

  /**
   * 从 URL 提取知识到记忆
   */
  async extractKnowledge(url: string): Promise<{
    title: string;
    summary: string;
    keywords: string[];
    content: string;
  }> {
    const page = await this.crawl(url);

    return {
      title: page.title,
      summary: page.content.slice(0, 500),
      keywords: page.keywords,
      content: page.markdown
    };
  }

  // ========== 私有方法 ==========

  /**
   * 获取网页 HTML
   */
  private async fetchPage(url: string): Promise<string> {
    // 使用 fetch API
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(this.config.timeout)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * 提取标题
   */
  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : '';
  }

  /**
   * 提取正文内容（简单实现）
   */
  private extractContent(html: string): string {
    // 移除脚本和样式
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.slice(0, 10000); // 限制长度
  }

  /**
   * HTML 转 Markdown（简单实现）
   */
  private htmlToMarkdown(html: string): string {
    let md = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
        const hashes = '#'.repeat(parseInt(level));
        return `\n\n${hashes} ${content.replace(/<[^>]+>/g, '')}\n\n`;
      })
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return md;
  }

  /**
   * 提取关键词
   */
  private extractKeywords(content: string): string[] {
    // 简单实现：词频统计
    const words = content
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);

    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'this', 'that', 'these', 'those', 'it', 'its', 'of', 'with', 'by', 'from',
      '我们', '他们', '这个', '那个', '什么', '怎么', '的', '了', '是', '在', '有'
    ]);

    const freq: Record<string, number> = {};
    for (const word of words) {
      if (!stopWords.has(word)) {
        freq[word] = (freq[word] || 0) + 1;
      }
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * 提取发布时间
   */
  private extractPublishedAt(html: string): string | undefined {
    const patterns = [
      /<time[^>]*datetime="([^"]+)"/i,
      /"datePublished"\s*:\s*"([^"]+)"/i,
      /"dateCreated"\s*:\s*"([^"]+)"/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * 获取缓存：内存 → 文件系统
   */
  private getCache(url: string): CrawledPage | null {
    // 1. 内存缓存
    const memCached = this.inMemoryCache.get(url);
    if (memCached && memCached.expiresAt > Date.now()) {
      return memCached.page;
    }
    if (memCached) {
      this.inMemoryCache.delete(url);
    }

    // 2. 文件系统缓存
    const cacheFile = this.getCacheFilePath(url);
    if (!fs.existsSync(cacheFile)) return null;

    try {
      const raw = fs.readFileSync(cacheFile, 'utf-8');
      const data = JSON.parse(raw);
      // 检查过期
      if (Date.now() - data.cachedAt > this.config.cacheTtlMs) {
        fs.unlinkSync(cacheFile);
        return null;
      }
      // 加载回内存
      this.inMemoryCache.set(url, { page: data.page, expiresAt: data.cachedAt + this.config.cacheTtlMs });
      return data.page;
    } catch {
      try { fs.unlinkSync(cacheFile); } catch { /* ignore */ }
      return null;
    }
  }

  /**
   * 设置缓存：内存 + 文件系统
   */
  private setCache(url: string, page: CrawledPage): void {
    // 内存缓存
    this.inMemoryCache.set(url, { page, expiresAt: Date.now() + this.config.cacheTtlMs });

    // 文件系统缓存
    const cacheFile = this.getCacheFilePath(url);
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({ page, cachedAt: Date.now() }), 'utf-8');
      this.updateCacheIndex(url, cacheFile);
    } catch { /* ignore - cache write is non-critical */ }
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
