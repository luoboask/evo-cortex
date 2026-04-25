/**
 * 会话扫描器 v3 — 带工作记忆整合
 * 
 * 职责：
 * 1. 扫描 .jsonl 会话文件，增量导入
 * 2. 整合工作记忆 (working_memory) → 长期记忆
 * 3. 提取用户偏好 → preferences 表
 * 4. 提取概念 → 知识图谱
 */

import * as fs from 'fs';
import * as path from 'path';
import { PluginContext, getDataDir } from '../utils/plugin-context';
import { MemoryHub } from './memory_hub';
import type { KnowledgeGraph } from '../knowledge/knowledge_graph';

export interface SessionInfo {
  id: string;
  filePath: string;
  userMessageCount: number;
  lastModified: number;
  hash: string;
}

export interface ScanResult {
  scanned: number;
  newSessions: number;
  updatedSessions: number;
  skipped: number;
  memoriesSaved: number;
  workingMemoryConsolidated: number;
  preferencesExtracted: number;
}

export interface ScanState {
  [sessionId: string]: {
    hash: string;
    userMessageCount: number;
    lastScanned: string;
    lastMessageIndex: number;
  };
}

export interface WorkingMemoryEntry {
  id: number;
  session_id: string;
  content: string;
  created_at: string;
  expires_at: string;
  message_count: number;
}

export class SessionScanner {
  private ctx: PluginContext;
  private sessionsDir: string;
  private stateFile: string;
  private state: ScanState;
  private memoryHub: MemoryHub | null = null;
  private dbPath: string;
  private workspaceDir: string;
  private agentId: string;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
    this.agentId = ctx.agentId;
    this.workspaceDir = ctx.workspaceDir;

    const homeDir = process.env.HOME || '/tmp';
    this.sessionsDir = path.join(homeDir, '.openclaw', 'agents', ctx.agentId, 'sessions');

    const dataDir = getDataDir(ctx);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.stateFile = path.join(dataDir, '.session_scan_state.json');
    this.state = this.loadState();
    this.dbPath = path.join(dataDir, 'cortex.db');
  }

  /**
   * 扫描所有会话 + 整合工作记忆
   */
  async scan(knowledgeGraph?: KnowledgeGraph): Promise<ScanResult> {
    const result: ScanResult = {
      scanned: 0,
      newSessions: 0,
      updatedSessions: 0,
      skipped: 0,
      memoriesSaved: 0,
      workingMemoryConsolidated: 0,
      preferencesExtracted: 0
    };

    // 第一步：整合工作记忆 → 长期记忆
    result.workingMemoryConsolidated = await this.consolidateWorkingMemory(knowledgeGraph);

    // 第二步：扫描会话文件
    if (fs.existsSync(this.sessionsDir)) {
      const sessionFiles = this.getSessionFiles();
      result.scanned = sessionFiles.length;

      for (const file of sessionFiles) {
        const sessionInfo = this.parseSessionFile(file);
        if (!sessionInfo) continue;

        const stateKey = sessionInfo.id;
        const existingState = this.state[stateKey];

        if (existingState && existingState.hash === sessionInfo.hash) {
          result.skipped++;
          continue;
        }

        const saved = await this.processSession(sessionInfo, existingState);
        result.memoriesSaved += saved;

        this.state[stateKey] = {
          hash: sessionInfo.hash,
          userMessageCount: sessionInfo.userMessageCount,
          lastScanned: new Date().toISOString(),
          lastMessageIndex: sessionInfo.userMessageCount
        };

        if (!existingState) {
          result.newSessions++;
        } else {
          result.updatedSessions++;
        }
      }
    }

    this.saveState();

    console.log(
      `[SessionScanner] ${this.agentId}: ` +
      `${result.scanned} scanned, ${result.newSessions} new, ` +
      `${result.updatedSessions} updated, ${result.skipped} skipped, ` +
      `${result.memoriesSaved} memories, ` +
      `${result.workingMemoryConsolidated} WM consolidated, ` +
      `${result.preferencesExtracted} prefs extracted`
    );

    return result;
  }

  /**
   * 核心：工作记忆 → 长期记忆整合管道
   * 
   * 流程：
   * 1. 查询即将过期的工作记忆（剩余 < 30min）
   * 2. 按 session_id 分组
   * 3. 每组去重 + 合并相似内容
   * 4. 提炼摘要写入长期记忆
   * 5. 提取偏好（喜欢/不喜欢/格式要求）
   * 6. 标记已整合的工作记忆（延长 TTL 或标记）
   */
  async consolidateWorkingMemory(knowledgeGraph?: KnowledgeGraph): Promise<number> {
    if (!fs.existsSync(this.dbPath)) return 0;

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(this.dbPath);

    try {
      // 查询所有未过期的工作记忆
      const entries: WorkingMemoryEntry[] = await new Promise((resolve, reject) => {
        db.all(
          'SELECT * FROM working_memory WHERE expires_at > datetime(\'now\') ORDER BY session_id, created_at',
          [],
          (err: Error | null, rows: WorkingMemoryEntry[]) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      if (entries.length === 0) return 0;

      // 按 session_id 分组
      const bySession = new Map<string, WorkingMemoryEntry[]>();
      for (const entry of entries) {
        const list = bySession.get(entry.session_id) || [];
        list.push(entry);
        bySession.set(entry.session_id, list);
      }

      let consolidated = 0;
      const lazyHub = await this.getMemoryHub();

      for (const [sessionId, sessionEntries] of bySession) {
        // 去重：去除内容高度相似的条目
        const deduplicated = this.deduplicateEntries(sessionEntries);

        if (deduplicated.length === 0) continue;

        // 合并：将短的对话合并为连贯记录
        const merged = this.mergeEntries(deduplicated);

        for (const m of merged) {
          // 写入长期记忆
          await lazyHub.add({
            content: m.content,
            type: 'session',
            timestamp: m.timestamp,
            metadata: {
              sessionId,
              source: 'working_memory_consolidation',
              originalCount: m.originalCount
            }
          });

          // 提取偏好
          const prefs = this.extractPreferences(m.content);
          for (const pref of prefs) {
            this.savePreference(pref);
          }

          consolidated++;
        }

        // 标记已整合的工作记忆（设置 expires_at 为过去时间，让它自然清理）
        const ids = sessionEntries.map(e => e.id);
        await new Promise<void>((resolve) => {
          db.run(
            `UPDATE working_memory SET expires_at = datetime('now', '-1 hour') WHERE id IN (${ids.join(',')})`,
            () => resolve()
          );
        });
      }

      return consolidated;
    } catch (err) {
      console.error('[SessionScanner] WM consolidation error:', err);
      return 0;
    } finally {
      db.close();
    }
  }

  /**
   * 去重：去除内容相似度高的条目
   */
  private deduplicateEntries(entries: WorkingMemoryEntry[]): WorkingMemoryEntry[] {
    if (entries.length <= 1) return entries;

    const result: WorkingMemoryEntry[] = [];
    for (const entry of entries) {
      const isDuplicate = result.some(existing => {
        // 简单的相似度检查：如果一条包含另一条的大部分内容，视为重复
        const a = entry.content.toLowerCase();
        const b = existing.content.toLowerCase();
        if (a.includes(b) || b.includes(a)) return true;

        // Jaccard 相似度（按词）
        const wordsA = new Set(a.split(/\s+/));
        const wordsB = new Set(b.split(/\s+/));
        const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
        const union = new Set([...wordsA, ...wordsB]);
        const similarity = intersection.size / union.size;
        return similarity > 0.7;
      });

      if (!isDuplicate) {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * 合并：将相邻的短对话合并
   */
  private mergeEntries(entries: WorkingMemoryEntry[]): Array<{
    content: string;
    timestamp: string;
    originalCount: number;
  }> {
    if (entries.length === 0) return [];

    const MAX_CONTENT_LENGTH = 3000;
    const merged: Array<{ content: string; timestamp: string; originalCount: number }> = [];
    let current = entries[0];

    for (let i = 1; i < entries.length; i++) {
      const next = entries[i];
      const combined = current.content + '\n\n' + next.content;

      if (combined.length <= MAX_CONTENT_LENGTH) {
        current = {
          ...current,
          content: combined,
          expires_at: next.expires_at
        };
      } else {
        // 当前组满了，输出
        merged.push({
          content: current.content.slice(0, MAX_CONTENT_LENGTH),
          timestamp: current.created_at,
          originalCount: 1
        });
        current = next;
      }
    }

    // 输出最后一组
    merged.push({
      content: current.content.slice(0, MAX_CONTENT_LENGTH),
      timestamp: current.created_at,
      originalCount: 1
    });

    return merged;
  }

  /**
   * 从对话中提取用户偏好
   */
  private extractPreferences(content: string): Array<{
    category: string;
    key: string;
    value: string;
    confidence: number;
  }> {
    const prefs: Array<{ category: string; key: string; value: string; confidence: number }> = [];

    // 偏好模式匹配
    const patterns = [
      // 明确表达喜好
      { regex: /我(喜欢|偏好|习惯|习惯用|倾向于).{0,5}([^\n。！？]{2,30})/g, category: 'preference', key: 'like' },
      { regex: /我不(喜欢|喜欢用|想要|需要|倾向).{0,5}([^\n。！？]{2,30})/g, category: 'preference', key: 'dislike' },
      // 格式要求
      { regex: /用(.{1,5})(格式|方式|风格).{0,3}([^\n。！？]{2,20})/g, category: 'format', key: 'style' },
      // 技术栈
      { regex: /(React|Vue|Angular|Python|Go|Java|Rust|TypeScript|Node\.js)/g, category: 'tech', key: 'stack' },
    ];

    for (const pattern of patterns) {
      const matches = content.matchAll(pattern.regex);
      for (const match of matches) {
        const value = match[match.length - 1] || match[0];
        if (value && value.length >= 2 && value.length <= 50) {
          prefs.push({
            category: pattern.category,
            key: `${pattern.key}_${Date.now()}`,
            value: value.trim(),
            confidence: 0.6
          });
        }
      }
    }

    return prefs;
  }

  /**
   * 保存偏好到 SQLite
   */
  private savePreference(pref: { category: string; key: string; value: string; confidence: number }): void {
    if (!fs.existsSync(this.dbPath)) return;

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(this.dbPath);

    db.run(
      `INSERT OR REPLACE INTO preferences (category, key, value, confidence, extracted_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [pref.category, pref.key, pref.value, pref.confidence],
      (err: Error | null) => {
        if (err) console.error('[SessionScanner] Save pref error:', err);
      }
    );

    db.close();
  }

  /**
   * 重置扫描状态
   */
  resetState(): void {
    this.state = {};
    this.saveState();
    console.log(`[SessionScanner] Reset scan state`);
  }

  // ========== 私有方法 ==========

  private async getMemoryHub(): Promise<MemoryHub> {
    if (!this.memoryHub) {
      this.memoryHub = new MemoryHub(this.ctx);
    }
    return this.memoryHub;
  }

  private getSessionFiles(): string[] {
    if (!fs.existsSync(this.sessionsDir)) return [];

    const files: string[] = [];
    const entries = fs.readdirSync(this.sessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.includes('.lock')) {
        files.push(path.join(this.sessionsDir, entry.name));
      }
    }

    return files.sort();
  }

  private parseSessionFile(filePath: string): SessionInfo | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.trim());

      let userMessageCount = 0;
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'user' && obj.content) userMessageCount++;
        } catch {
          // skip
        }
      }

      if (userMessageCount === 0) return null;

      const contentHash = this.hashContent(content);
      const fileName = path.basename(filePath, '.jsonl');

      return {
        id: fileName,
        filePath,
        userMessageCount,
        lastModified: fs.statSync(filePath).mtimeMs,
        hash: contentHash
      };
    } catch (error) {
      console.error(`[SessionScanner] Error parsing ${filePath}:`, error);
      return null;
    }
  }

  private async processSession(
    session: SessionInfo,
    existingState?: ScanState
  ): Promise<number> {
    try {
      const content = fs.readFileSync(session.filePath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.trim());

      interface ParsedMessage {
        type: string;
        content: string;
        timestamp?: string;
        tool?: string;
      }

      const messages: ParsedMessage[] = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);

          if (obj.type === 'user' && obj.content) {
            const textContent = this.extractTextContent(obj.content);
            if (textContent && textContent.length > 5) {
              messages.push({ type: 'user', content: textContent, timestamp: obj.timestamp });
            }
          } else if (
            (obj.type === 'assistant' || obj.type === 'agent') && obj.content
          ) {
            const textContent = this.extractTextContent(obj.content);
            if (textContent && textContent.length > 5) {
              messages.push({ type: 'assistant', content: textContent, timestamp: obj.timestamp });
            }
          }
        } catch {
          // skip
        }
      }

      const startIndex = existingState?.lastMessageIndex || 0;
      const newMessages = messages.slice(startIndex);

      if (newMessages.length === 0) return 0;

      let saved = 0;
      const lazyHub = await this.getMemoryHub();

      for (let i = 0; i < newMessages.length; i++) {
        const msg = newMessages[i];
        if (msg.type === 'user') {
          let aiReply = '';
          if (i + 1 < newMessages.length && newMessages[i + 1].type === 'assistant') {
            aiReply = '\n\n--- AI 回复 ---\n\n' + newMessages[i + 1].content.slice(0, 2000);
          }

          await lazyHub.add({
            content: `Q: ${msg.content.slice(0, 2000)}${aiReply}`,
            type: 'session',
            timestamp: msg.timestamp || new Date().toISOString(),
            metadata: {
              sessionId: session.id,
              messageIndex: startIndex + i,
              source: 'session_scan'
            }
          });
          saved++;
        }
      }

      return saved;
    } catch (error) {
      console.error(`[SessionScanner] Error processing ${session.id}:`, error);
      return 0;
    }
  }

  private extractTextContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text || '')
        .join('\n');
    }
    return '';
  }

  private loadState(): ScanState {
    if (fs.existsSync(this.stateFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      } catch {
        // ignore
      }
    }
    return {};
  }

  private saveState(): void {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      console.error('[SessionScanner] Save state error:', error);
    }
  }

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
