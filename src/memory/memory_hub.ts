/**
 * Memory Hub - 记忆中心
 *
 * 功能：
 * - 存储会话记忆
 * - 搜索历史记忆
 * - 管理记忆生命周期
 * - 持久化到文件系统
 * - 记忆压缩（每日/每周/月）
 */

import * as fs from "fs";
import * as path from "path";
import { PluginContext, getMemoryStorageDir } from "../utils/plugin-context";

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
}

export interface MemoryConfig {
  enabled: boolean;
  top_k: number;
  auto_store: boolean;
}

export class MemoryHub {
  private ctx: PluginContext;
  private config: MemoryConfig;
  private memories: MemoryEntry[] = [];
  private storageDir: string;

  constructor(ctx: PluginContext, config?: Partial<MemoryConfig>) {
    this.ctx = ctx;
    this.config = {
      enabled: true,
      top_k: 5,
      auto_store: true,
      ...config
    };

    // 使用绝对路径初始化存储目录
    this.storageDir = getMemoryStorageDir(ctx);
    this.ensureDirectory(this.storageDir);

    console.log(`[MemoryHub] Initialized for agent: ${ctx.agentId}, storage: ${this.storageDir}`);

    // 加载持久化数据
    this.load();
  }

  /**
   * 添加记忆
   */
  async add(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    const memoryEntry: MemoryEntry = {
      ...entry,
      id: this.generateId()
    };

    this.memories.push(memoryEntry);

    // 持久化到文件系统
    await this.persist(memoryEntry);

    console.log(`[MemoryHub] Added memory: ${memoryEntry.id}`);
    return memoryEntry;
  }
  
  /**
   * 搜索记忆
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    const limit = topK || this.config.top_k;
    
    // 简单的关键词匹配（后续替换为语义搜索）
    const results = this.memories
      .filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)
      .map(m => ({
        entry: m,
        score: this.calculateRelevance(m.content, query),
        source: "memory_hub"
      }));
    
    console.log(`[MemoryHub] Search "${query}" returned ${results.length} results for agent ${this.ctx.agentId}`);
    return results;
  }
  
  /**
   * 获取最近记忆
   */
  async getRecent(limit: number = 10): Promise<MemoryEntry[]> {
    return this.memories
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }
  
  /**
   * 删除记忆
   */
  async delete(id: string): Promise<boolean> {
    const index = this.memories.findIndex(m => m.id === id);
    if (index !== -1) {
      this.memories.splice(index, 1);
      console.log(`[MemoryHub] Deleted memory: ${id}`);
      return true;
    }
    return false;
  }
  
  /**
   * 清空所有记忆
   */
  async clear(): Promise<void> {
    this.memories = [];
    console.log(`[MemoryHub] Cleared all memories for agent ${this.ctx.agentId}`);
  }
  
  /**
   * 获取记忆统计
   */
  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const m of this.memories) {
      byType[m.type] = (byType[m.type] || 0) + 1;
    }
    
    return {
      total: this.memories.length,
      byType
    };
  }
  
  // ========== 私有方法 ==========

  private generateId(): string {
    return `mem_${this.ctx.agentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateRelevance(content: string, query: string): number {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();

    let matches = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matches++;
      }
    }

    return matches / queryWords.length;
  }

  /**
   * 持久化记忆到文件系统
   * 格式：~/.openclaw/memory/{agentId}/YYYY-MM-DD.md
   */
  private async persist(entry: MemoryEntry): Promise<void> {
    try {
      const date = new Date(entry.timestamp);
      const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
      const filePath = path.join(this.storageDir, `${dateStr}.md`);

      // 构建 Markdown 内容
      const content = this.formatMemoryAsMarkdown(entry);

      // 追加到文件
      fs.appendFileSync(filePath, content, "utf8");
      console.log(`[MemoryHub] Persisted memory to: ${filePath}`);
    } catch (error) {
      console.error("[MemoryHub] Persist error:", error);
    }
  }

  /**
   * 加载持久化的记忆
   */
  private load(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        console.log("[MemoryHub] No storage directory found, starting fresh");
        return;
      }

      // 读取所有 md 文件
      const files = fs.readdirSync(this.storageDir).filter(f => f.endsWith(".md"));

      for (const file of files) {
        const filePath = path.join(this.storageDir, file);
        const content = fs.readFileSync(filePath, "utf8");
        const entries = this.parseMarkdownFile(content);

        this.memories.push(...entries);
      }

      console.log(`[MemoryHub] Loaded ${this.memories.length} memories from storage`);
    } catch (error) {
      console.error("[MemoryHub] Load error:", error);
    }
  }

  /**
   * 格式化记忆为 Markdown
   */
  private formatMemoryAsMarkdown(entry: MemoryEntry): string {
    const frontmatter = [
      "---",
      `id: ${entry.id}`,
      `type: ${entry.type}`,
      `timestamp: ${entry.timestamp}`,
      `agent: ${this.ctx.agentId}`,
      "---",
      ""
    ].join("\n");

    const body = [
      frontmatter,
      `## ${entry.id}`,
      "",
      entry.content,
      "",
      "---",
      ""
    ].join("\n");

    return body;
  }

  /**
   * 解析 Markdown 文件
   */
  private parseMarkdownFile(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const blocks = content.split("---").filter(b => b.trim());

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 2) continue;

      // 解析 frontmatter
      const entry: MemoryEntry = {
        id: undefined,
        content: "",
        type: "session",
        timestamp: new Date().toISOString()
      };

      let inBody = false;
      for (const line of lines) {
        if (line.startsWith("id:")) {
          entry.id = line.replace("id:", "").trim();
        } else if (line.startsWith("type:")) {
          entry.type = line.replace("type:", "").trim() as any;
        } else if (line.startsWith("timestamp:")) {
          entry.timestamp = line.replace("timestamp:", "").trim();
        } else if (line.startsWith("##")) {
          inBody = true;
        } else if (inBody && line.trim()) {
          entry.content += line + "\n";
        }
      }

      if (entry.id && entry.content) {
        entry.content = entry.content.trim();
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * 确保目录存在
   */
  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[MemoryHub] Created storage directory: ${dirPath}`);
    }
  }

  /**
   * 压缩记忆（每日/每周/月）
   * 返回压缩后的摘要
   */
  async compress(
    granularity: "daily" | "weekly" | "monthly"
  ): Promise<{ compressed: number; summary: string }> {
    const now = new Date();
    let startDate: Date;
    let periodName: string;

    switch (granularity) {
      case "daily":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        periodName = "day";
        break;
      case "weekly":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        periodName = "week";
        break;
      case "monthly":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        periodName = "month";
        break;
    }

    // 筛选时间段内的记忆
    const toCompress = this.memories.filter(
      m => new Date(m.timestamp) >= startDate
    );

    if (toCompress.length === 0) {
      return { compressed: 0, summary: "No memories to compress" };
    }

    // 生成摘要
    const summary = this.generateSummary(toCompress, granularity);

    // 创建压缩记忆
    const compressedEntry: MemoryEntry = {
      id: this.generateId(),
      content: summary,
      type: granularity,
      timestamp: now.toISOString(),
      metadata: {
        originalCount: toCompress.length,
        period: `${startDate.toISOString().split("T")[0]} to ${now.toISOString().split("T")[0]}`,
        agent: this.ctx.agentId
      }
    };

    // 删除原始记忆（可选）
    // 更新类型为压缩
    for (const m of toCompress) {
      m.type = "compressed";
    }

    // 持久化压缩记忆
    await this.persist(compressedEntry);

    console.log(
      `[MemoryHub] Compressed ${toCompress.length} memories into ${granularity} summary for agent ${this.ctx.agentId}`
    );

    return {
      compressed: toCompress.length,
      summary
    };
  }

  /**
   * 生成记忆摘要
   */
  private generateSummary(
    entries: MemoryEntry[],
    granularity: string
  ): string {
    // 简单实现：提取关键信息
    const topics = new Map<string, number>();

    for (const entry of entries) {
      // 提取关键词
      const words = entry.content.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 3) {
          topics.set(word, (topics.get(word) || 0) + 1);
        }
      }
    }

    // 排序取前 10 个主题
    const topTopics = [...topics.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => topic)
      .join(", ");

    return `[${granularity.toUpperCase()} SUMMARY] Agent: ${this.ctx.agentId}. Topics: ${topTopics}. Total entries: ${entries.length}`;
  }
}
