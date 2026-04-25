/**
 * Memory Hub v2 - 记忆中心
 *
 * 分层架构：Day → Week → Month → MEMORY.md
 * 自动清理：14d/8w/2m 过期策略
 * 语义搜索：DashScope embedding → TF-IDF → keyword
 */

import * as fs from "fs";
import * as path from "path";
import { PluginContext, getMemoryStorageDir } from "../utils/plugin-context";
import { SemanticSearch, SearchableDocument } from "./semantic_search";
import { getEmbedding, initTfIdf, trainTfIdf, getEmbeddingLevel, keywordScore } from "./embedding_provider";
import { EmbeddingCache, cosineSimilarity } from "./embedding_cache";
import type { EmbeddingConfig, RetentionPolicy } from "../utils/config-validator";

// ========== 配置 ==========

export interface MemoryConfig {
  enabled: boolean;
  top_k: number;
  auto_store: boolean;
}

const DEFAULT_RETENTION: RetentionPolicy = { daily: 14, weekly: 8, monthly: 2 };

// ========== 类型 ==========

export interface MemoryEntry {
  id?: string;
  content: string;
  type: "session" | "daily" | "weekly" | "monthly" | "compressed";
  timestamp: string;
  metadata?: Record<string, any>;
  embedding?: number[];
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  source: string;
  layer: "monthly" | "weekly" | "daily" | "session";
}

export interface CleanupReport {
  dailyRemoved: number;
  weeklyRemoved: number;
  monthlyRemoved: number;
  totalRemaining: number;
}

export interface CompressionReport {
  granularity: string;
  compressed: number;
  summary: string;
}

// ========== MemoryHub ==========

export class MemoryHub {
  private ctx: PluginContext;
  private config: MemoryConfig;
  private embeddingConfig: EmbeddingConfig;
  private retention: RetentionPolicy;
  private memories: MemoryEntry[] = [];
  private storageDir: string;
  private semanticSearch: SemanticSearch;
  private embeddingCache: EmbeddingCache;
  private embeddingAvailable: boolean = false;
  private lastEmbeddingAttempt: number = 0;
  private embeddingRetryInterval: number = 5 * 60 * 1000;

  constructor(ctx: PluginContext, config?: Partial<MemoryConfig>, embeddingConfig?: Partial<EmbeddingConfig>, retention?: Partial<RetentionPolicy>) {
    this.ctx = ctx;
    this.config = { enabled: true, top_k: 5, auto_store: true, ...config };
    this.retention = { ...DEFAULT_RETENTION, ...retention };

    this.storageDir = getMemoryStorageDir(ctx);
    this.ensureDirectory(this.storageDir);

    this.embeddingConfig = { enabled: true, mode: "auto", fallback: "tfidf", ...embeddingConfig };
    this.embeddingCache = new EmbeddingCache({ maxSize: 5000, ttlMs: 24 * 60 * 60 * 1000 });

    const embeddingFunc = this.embeddingConfig.enabled && this.embeddingConfig.mode !== "keyword"
      ? async (text: string) => {
          const cached = this.embeddingCache.get(text);
          if (cached) return cached;

          if (!this.embeddingAvailable && Date.now() - this.lastEmbeddingAttempt < this.embeddingRetryInterval) {
            throw new Error('embedding cooldown');
          }

          try {
            const embedding = await getEmbedding(text);
            if (embedding) {
              this.embeddingAvailable = true;
              this.embeddingCache.set(text, embedding);
              return embedding;
            }
          } catch { /* fall through */ }

          this.embeddingAvailable = false;
          this.lastEmbeddingAttempt = Date.now();
          throw new Error('no embedding available');
        }
      : null;

    this.semanticSearch = new SemanticSearch(embeddingFunc, 5000);
    // 异步加载，不阻塞构造函数
    this.load().catch(err => console.error('[MemoryHub] Load error:', err));
  }

  // ========== 写入 ==========

  async add(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    const mem: MemoryEntry = { ...entry, id: this.generateId() };
    this.memories.push(mem);
    await this.addToSemanticSearch(mem);
    await this.persist(mem);
    return mem;
  }

  async addBatch(entries: Omit<MemoryEntry, "id">[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    for (const entry of entries) {
      const mem: MemoryEntry = { ...entry, id: this.generateId() };
      this.memories.push(mem);
      results.push(mem);
    }
    if (this.memories.length >= 3) {
      trainTfIdf(this.ctx, this.memories.map(m => ({ id: m.id!, content: m.content })));
    }
    for (const m of results) {
      await this.addToSemanticSearch(m);
      await this.persist(m);
    }
    return results;
  }

  // ========== 分层搜索 ==========

  /**
   * 分层搜索：Monthly → Weekly → Daily → Session
   * 先从高层找概述，再从底层找细节
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    const limit = topK || this.config.top_k;
    if (this.memories.length === 0) return [];

    // 按月记忆搜索
    const monthly = this.searchByLayer('monthly', query, Math.ceil(limit * 0.2));

    // 按周记忆搜索
    const weekly = this.searchByLayer('weekly', query, Math.ceil(limit * 0.3));

    // 按日/会话记忆搜索（语义 + 降级）
    const dailyResults = await this.searchDetailed(query, limit);

    // 合并结果：月 → 周 → 日
    const results: MemorySearchResult[] = [...monthly, ...weekly, ...dailyResults];
    // 去重：相同内容只保留最高分
    const seen = new Set<string>();
    const unique: MemorySearchResult[] = [];
    for (const r of results) {
      const key = r.entry.id!;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(r);
      }
    }

    return unique.slice(0, limit);
  }

  /** 搜索特定层级 */
  private searchByLayer(layer: 'monthly' | 'weekly', query: string, topK: number): MemorySearchResult[] {
    const layerMemories = this.memories.filter(m => m.type === layer);
    return layerMemories
      .map(m => ({ entry: m, score: keywordScore(query, m.content), source: layer, layer }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** 搜索日/会话层（支持语义搜索） */
  private async searchDetailed(query: string, limit: number): Promise<MemorySearchResult[]> {
    const detailedMemories = this.memories.filter(m => m.type === 'session' || m.type === 'daily');
    if (detailedMemories.length === 0) return [];

    const mode = this.embeddingConfig.mode;
    const enabled = this.embeddingConfig.enabled;

    if (!enabled || mode === 'keyword') {
      return detailedMemories.map(m => ({ entry: m, score: keywordScore(query, m.content), source: 'keyword', layer: 'session' as const }))
        .filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    }

    // 临时语义搜索
    try {
      const queryEmbedding = await this.getQueryEmbedding(query);
      if (queryEmbedding) {
        const results: MemorySearchResult[] = [];
        for (const m of detailedMemories) {
          if (m.embedding && m.embedding.length === queryEmbedding.length) {
            const sim = cosineSimilarity(queryEmbedding, m.embedding);
            results.push({ entry: m, score: sim, source: `semantic (${getEmbeddingLevel()})`, layer: 'session' });
          }
        }
        if (results.length > 0) {
          results.sort((a, b) => b.score - a.score);
          return results.slice(0, limit);
        }
      }
    } catch { /* fall through */ }

    return detailedMemories.map(m => ({ entry: m, score: keywordScore(query, m.content), source: 'keyword', layer: 'session' as const }))
      .filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private async getQueryEmbedding(query: string): Promise<number[] | null> {
    const cached = this.embeddingCache.get(query);
    if (cached) return cached;
    try {
      const emb = await getEmbedding(query);
      if (emb) { this.embeddingCache.set(query, emb); this.embeddingAvailable = true; }
      return emb;
    } catch { this.lastEmbeddingAttempt = Date.now(); return null; }
  }

  // ========== 分层压缩 ==========

  /**
   * 日压缩：将 session 记忆合并为 daily 摘要
   * 保留原始细节，生成每日概述
   */
  async compressDaily(): Promise<CompressionReport> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dateStr = yesterday.toISOString().split('T')[0];

    const sessionMemories = this.memories.filter(m =>
      m.type === 'session' && m.timestamp.startsWith(dateStr)
    );

    if (sessionMemories.length === 0) {
      return { granularity: 'daily', compressed: 0, summary: '' };
    }

    const summary = this.generateSummary(sessionMemories, 'daily');

    // 写入 weekly 目录
    const weeklyDir = path.join(this.storageDir, '..', 'weekly');
    this.ensureDirectory(weeklyDir);

    const dailyEntry: MemoryEntry = {
      id: this.generateId(),
      content: summary,
      type: 'daily',
      timestamp: yesterday.toISOString(),
      metadata: { originalCount: sessionMemories.length, date: dateStr, agent: this.ctx.agentId }
    };

    await this.add(dailyEntry);

    // 标记原始 session 为 compressed
    for (const m of sessionMemories) m.type = 'compressed';

    return { granularity: 'daily', compressed: sessionMemories.length, summary };
  }

  /**
   * 周压缩：将 daily 摘要合并为 weekly 摘要
   */
  async compressWeekly(): Promise<CompressionReport> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const dailyMemories = this.memories.filter(m =>
      m.type === 'daily' && new Date(m.timestamp) >= weekAgo
    );

    if (dailyMemories.length === 0) {
      return { granularity: 'weekly', compressed: 0, summary: '' };
    }

    const summary = this.generateSummary(dailyMemories, 'weekly');

    const weeklyEntry: MemoryEntry = {
      id: this.generateId(),
      content: summary,
      type: 'weekly',
      timestamp: now.toISOString(),
      metadata: { originalCount: dailyMemories.length, period: `${weekAgo.toISOString().split('T')[0]} → ${dateStr(now)}`, agent: this.ctx.agentId }
    };

    await this.add(weeklyEntry);
    for (const m of dailyMemories) m.type = 'compressed';

    return { granularity: 'weekly', compressed: dailyMemories.length, summary };
  }

  /**
   * 月压缩：将 weekly 摘要合并为 monthly 概述
   */
  async compressMonthly(): Promise<CompressionReport> {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const weeklyMemories = this.memories.filter(m =>
      m.type === 'weekly' && new Date(m.timestamp) >= monthAgo
    );

    if (weeklyMemories.length === 0) {
      return { granularity: 'monthly', compressed: 0, summary: '' };
    }

    const summary = this.generateSummary(weeklyMemories, 'monthly');

    const monthlyEntry: MemoryEntry = {
      id: this.generateId(),
      content: summary,
      type: 'monthly',
      timestamp: now.toISOString(),
      metadata: { originalCount: weeklyMemories.length, period: `${monthAgo.toISOString().split('T')[0]} → ${dateStr(now)}`, agent: this.ctx.agentId }
    };

    await this.add(monthlyEntry);
    for (const m of weeklyMemories) m.type = 'compressed';

    return { granularity: 'monthly', compressed: weeklyMemories.length, summary };
  }

  // ========== 自动清理 ==========

  /**
   * 按保留策略清理过期记忆
   * - daily: 超过 14 天 → 删除（已有 weekly 摘要替代）
   * - weekly: 超过 8 周 → 删除（已有 monthly 替代）
   * - monthly: 超过 2 月 → 删除
   * - compressed: 立即删除
   */
  cleanup(): CleanupReport {
    const now = new Date();
    const dailyCutoff = new Date(now.getTime() - this.retention.daily * 24 * 60 * 60 * 1000);
    const weeklyCutoff = new Date(now.getTime() - this.retention.weekly * 7 * 24 * 60 * 60 * 1000);
    const monthlyCutoff = new Date(now.getTime() - this.retention.monthly * 30 * 24 * 60 * 60 * 1000);

    let dailyRemoved = 0, weeklyRemoved = 0, monthlyRemoved = 0;

    this.memories = this.memories.filter(m => {
      const ts = new Date(m.timestamp);

      if (m.type === 'compressed') {
        return false; // 立即清理
      }
      if (m.type === 'daily' && ts < dailyCutoff) {
        dailyRemoved++;
        this.semanticSearch.removeDocument(m.id!);
        return false;
      }
      if (m.type === 'weekly' && ts < weeklyCutoff) {
        weeklyRemoved++;
        this.semanticSearch.removeDocument(m.id!);
        return false;
      }
      if (m.type === 'monthly' && ts < monthlyCutoff) {
        monthlyRemoved++;
        this.semanticSearch.removeDocument(m.id!);
        return false;
      }
      return true;
    });

    return { dailyRemoved, weeklyRemoved, monthlyRemoved, totalRemaining: this.memories.length };
  }

  // ========== 基础操作 ==========

  async getRecent(limit: number = 10): Promise<MemoryEntry[]> {
    return [...this.memories].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    const idx = this.memories.findIndex(m => m.id === id);
    if (idx !== -1) {
      this.memories.splice(idx, 1);
      this.semanticSearch.removeDocument(id);
      return true;
    }
    return false;
  }

  async clear(): Promise<void> {
    this.memories = [];
    this.semanticSearch.clear();
    this.embeddingCache.clear();
  }

  getStats(): {
    total: number; byType: Record<string, number>;
    embeddingLevel: string; retention: RetentionPolicy
  } {
    const byType: Record<string, number> = {};
    for (const m of this.memories) byType[m.type] = (byType[m.type] || 0) + 1;
    return { total: this.memories.length, byType, embeddingLevel: getEmbeddingLevel(), retention: this.retention };
  }

  // ========== 私有方法 ==========

  private async addToSemanticSearch(entry: MemoryEntry): Promise<void> {
    try {
      await this.semanticSearch.addDocument({
        id: entry.id!, content: entry.content, embedding: entry.embedding,
        metadata: { type: entry.type, timestamp: entry.timestamp }
      });
    } catch { /* non-critical */ }
  }

  private generateId(): string {
    return `mem_${this.ctx.agentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async persist(entry: MemoryEntry): Promise<void> {
    try {
      const dateStr = dateStr(new Date(entry.timestamp));
      // 按类型分目录存储
      const subDir = entry.type === 'weekly' ? 'weekly' :
                     entry.type === 'monthly' ? 'monthly' : '';
      const dir = subDir ? path.join(this.storageDir, '..', subDir) : this.storageDir;
      this.ensureDirectory(dir);
      const filePath = path.join(dir, `${dateStr}.md`);
      fs.appendFileSync(filePath, this.formatMemoryAsMarkdown(entry) + '\n', 'utf8');
    } catch (err) { console.error('[MemoryHub] Persist error:', err); }
  }

  private async load(): Promise<void> {
    try {
      if (!fs.existsSync(this.storageDir)) {
        return;
      }

      const rawEntries: MemoryEntry[] = [];

      // 加载各层记忆
      const dirsToScan = [
        this.storageDir,
        path.join(this.storageDir, '..', 'weekly'),
        path.join(this.storageDir, '..', 'monthly'),
      ];

      for (const dir of dirsToScan) {
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
          const content = fs.readFileSync(path.join(dir, file), 'utf8');
          rawEntries.push(...this.parseMarkdownFile(content));
        }
      }

      this.memories = rawEntries;
      initTfIdf(this.ctx);
      if (this.memories.length >= 3) {
        trainTfIdf(this.ctx, this.memories.map(m => ({ id: m.id!, content: m.content })));
      }
      for (const entry of this.memories) this.addToSemanticSearch(entry).catch(() => {});
    } catch (err) { console.error('[MemoryHub] Load error:', err); }
  }

  private formatMemoryAsMarkdown(entry: MemoryEntry): string {
    return [
      `---`, `id: ${entry.id}`, `type: ${entry.type}`,
      `timestamp: ${entry.timestamp}`, `agent: ${this.ctx.agentId}`, `---`,
      ``, `## ${entry.id}`, ``, entry.content, ``, `---`, ``
    ].join('\n');
  }

  private parseMarkdownFile(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    for (const block of content.split('---').filter(b => b.trim())) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;
      const entry: MemoryEntry = { id: undefined, content: '', type: 'session', timestamp: new Date().toISOString() };
      let inBody = false;
      for (const line of lines) {
        if (line.startsWith('id:')) entry.id = line.replace('id:', '').trim();
        else if (line.startsWith('type:')) entry.type = line.replace('type:', '').trim() as any;
        else if (line.startsWith('timestamp:')) entry.timestamp = line.replace('timestamp:', '').trim();
        else if (line.startsWith('##')) inBody = true;
        else if (inBody && line.trim()) entry.content += line + '\n';
      }
      if (entry.id && entry.content) { entry.content = entry.content.trim(); entries.push(entry); }
    }
    return entries;
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private generateSummary(entries: MemoryEntry[], granularity: string): string {
    const topics = new Map<string, number>();
    for (const e of entries) {
      for (const w of e.content.toLowerCase().split(/\s+/)) {
        if (w.length > 3) topics.set(w, (topics.get(w) || 0) + 1);
      }
    }
    const top = [...topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t).join(', ');
    return `[${granularity.toUpperCase()} SUMMARY] Agent: ${this.ctx.agentId}. Topics: ${top}. Entries: ${entries.length}`;
  }
}

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}
