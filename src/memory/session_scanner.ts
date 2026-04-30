/**
 * 会话扫描器 v4 — 增量存储 + 智能晋升
 * 
 * 职责：
 * 1. 每 5 分钟扫描 .jsonl 会话文件，增量导入
 * 2. 新会话存为 working_session（工作会话）
 * 3. 自动判断是否晋升为 long_term（长期会话）
 *    - 消息数 ≥ 10 条
 *    - 或对话时长 ≥ 30 分钟
 *    - 或包含关键技术讨论（代码/配置/错误）
 * 4. 提取用户偏好 → preferences 表
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { PluginContext, getDataDir } from '../utils/plugin-context';
import { MemoryHub } from './memory_hub';
import type { KnowledgeSystem } from '../knowledge/knowledge_system';
import { getLogger } from '../utils/logger';

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
  promoted: number;
  workingSessions: number;
  preferencesExtracted: number;
}

export interface SessionState {
  hash: string;
  userMessageCount: number;
  lastScanned: string;
  lastMessageIndex: number;
}

export interface ScanState {
  [sessionId: string]: SessionState;
}

export interface WorkingMemoryEntry {
  id: string;
  type: string;
  title: string | null;
  content: string;
  importance: number;
  tags: string;
  source: string;
  source_ref: string | null;
  created_at: string;
  expires_at: string | null;
}

export class SessionScanner {
  private ctx: PluginContext;
  private sessionsDir: string;
  private stateFile: string;
  private state: ScanState;
  private memoryHub: MemoryHub | null = null;
  private dbPath: string;
  private agentId: string;
  private logger = getLogger({ component: 'SessionScanner' });

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
    this.agentId = ctx.agentId;

    const homeDir = process.env.HOME || '/tmp';
    this.sessionsDir = path.join(homeDir, '.openclaw', 'agents', ctx.agentId, 'sessions');

    const dataDir = getDataDir(ctx);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.stateFile = path.join(dataDir, '.session_scan_state.json');
    this.state = this.loadState();
    this.dbPath = path.join(dataDir, 'memory.db');
  }

  /**
   * 扫描所有会话 + 整合工作记忆
   */
  async scan(_knowledgeGraph?: KnowledgeSystem): Promise<ScanResult> {
    const result: ScanResult = {
      scanned: 0,
      newSessions: 0,
      updatedSessions: 0,
      skipped: 0,
      memoriesSaved: 0,
      promoted: 0,
      workingSessions: 0,
      preferencesExtracted: 0
    };

    // 扫描会话文件 + 增量存储
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
        result.memoriesSaved += saved.saved;
        result.promoted += saved.promoted;
        result.workingSessions += saved.working;
        result.preferencesExtracted += saved.prefs;

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

    this.logger.info(
      `${this.agentId}: ` +
      `${result.scanned} scanned, ${result.newSessions} new, ` +
      `${result.updatedSessions} updated, ${result.skipped} skipped, ` +
      `${result.memoriesSaved} memories, ` +
      `${result.workingSessions} working, ${result.promoted} promoted, ` +
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
  async consolidateWorkingMemory(_knowledgeGraph?: KnowledgeSystem): Promise<number> {
    if (!fs.existsSync(this.dbPath)) return 0;

    const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
    const db = new sqlite3.Database(this.dbPath);

    try {
      // 查询未过期的工作记忆（排除最新 100 条，保护近期对话）
      // 注意：working_memory 表没有 session_id 列，改用 type + source_ref 分组
      const entries: WorkingMemoryEntry[] = await new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM working_memory WHERE expires_at > datetime('now') AND id NOT IN (SELECT id FROM working_memory ORDER BY created_at DESC LIMIT 100) ORDER BY type, created_at`,
          [],
          (err: Error | null, rows: WorkingMemoryEntry[]) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      if (entries.length === 0) return 0;

      // 按 type 分组（conversation / decision / bugfix / insight 等）
      const byType = new Map<string, WorkingMemoryEntry[]>();
      for (const entry of entries) {
        const list = byType.get(entry.type) || [];
        list.push(entry);
        byType.set(entry.type, list);
      }

      let consolidated = 0;
      const lazyHub = await this.getMemoryHub();

      for (const [entryType, typeEntries] of byType) {
        // 去重：去除内容高度相似的条目
        const deduplicated = this.deduplicateEntries(typeEntries);

        if (deduplicated.length === 0) continue;

        // 合并：将短对话合并为连贯记录
        const merged = this.mergeEntries(deduplicated);

        for (const m of merged) {
          // 写入长期记忆
          await lazyHub.add({
            content: m.content,
            type: entryType as any,
            timestamp: m.timestamp,
            metadata: {
              source: 'working_memory_consolidation',
              originalCount: m.originalCount
            }
          });

          // 提取偏好（仅对 conversation 类型）
          if (entryType === 'conversation') {
            const prefs = this.extractPreferences(m.content);
            for (const pref of prefs) {
              this.savePreference(pref, db);
            }
          }

          consolidated++;
        }

        // 标记已整合的工作记忆（设置 expires_at 为过去时间，让它自然清理）
        const ids = typeEntries.map(e => e.id);
        const placeholders = ids.map(() => '?').join(',');
        await new Promise<void>((resolve, reject) => {
          db.run(
            `UPDATE working_memory SET expires_at = datetime('now', '-1 hour') WHERE id IN (${placeholders})`,
            ids,
            (err: Error | null) => err ? reject(err) : resolve()
          );
        });
      }

      return consolidated;
    } catch (err) {
      this.logger.error('WM consolidation error', err);
      return 0;
    } finally {
      db.close();
    }
  }

  /**
   * 去重：先做 hash 预过滤，再 O(n^2) 相似度检查
   */
  private deduplicateEntries(entries: WorkingMemoryEntry[]): WorkingMemoryEntry[] {
    if (entries.length <= 1) return entries;

    // Step 1: Hash-based dedup of normalized content (O(n))
    const hashSeen = new Map<string, WorkingMemoryEntry>();
    const candidates: WorkingMemoryEntry[] = [];
    for (const entry of entries) {
      const normalized = entry.content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
      if (hashSeen.has(normalized)) continue;
      hashSeen.set(normalized, entry);
      candidates.push(entry);
    }
    if (candidates.length <= 1) return candidates;

    // Step 2: O(n^2) similarity only on hash-deduped candidates
    const result: WorkingMemoryEntry[] = [];
    for (const entry of candidates) {
      const isDuplicate = result.some(existing => {
        const a = entry.content.toLowerCase();
        const b = existing.content.toLowerCase();
        if (a.includes(b) || b.includes(a)) return true;

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
    type: string;
  }> {
    if (entries.length === 0) return [];

    const MAX_CONTENT_LENGTH = 3000;
    const merged: Array<{ content: string; timestamp: string; originalCount: number; type: string }> = [];
    let current = entries[0];
    let currentCount = 1;

    for (let i = 1; i < entries.length; i++) {
      const next = entries[i];
      const combined = current.content + '\n\n' + next.content;

      if (combined.length <= MAX_CONTENT_LENGTH) {
        currentCount++;
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
          originalCount: currentCount,
          type: current.type
        });
        current = next;
        currentCount = 1;
      }
    }

    // 输出最后一组
    merged.push({
      content: current.content.slice(0, MAX_CONTENT_LENGTH),
      timestamp: current.created_at,
      originalCount: currentCount,
      type: current.type
    });

    return merged;
  }

  /**
   * 从对话中提取用户偏好（增强版）
   * 
   * 分类体系：
   * - communication: 沟通风格（语言、详细程度、语气等）
   * - code_example: 代码示例偏好（语言、框架、风格）
   * - format: 格式偏好（表格、列表、markdown等）
   * - tech_stack: 技术栈（前端、后端、数据库、工具）
   * - workflow: 工作流偏好（先讨论再实现、直接给代码等）
   * - like: 明确表达过的好感
   * - dislike: 明确表达过的反感
   */
  /**
   * 从文本中提取用户偏好（静态方法，供 agent_end 等外部调用）
   */
  static extractFromText(content: string): Array<{
    category: string;
    key: string;
    value: string;
    confidence: number;
  }> {
    const prefs: Array<{ category: string; key: string; value: string; confidence: number }> = [];
    const seen = new Set<string>();
    const addPref = (category: string, key: string, value: string, confidence: number) => {
      const normValue = value.trim().replace(/[。！？\n]/g, '').slice(0, 100);
      if (!normValue || normValue.length < 2) return;
      const dedupKey = `${category}:${key}:${normValue.toLowerCase()}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      prefs.push({ category, key, value: normValue, confidence });
    };

    // 明确表达喜好
    const likePatterns = [
      { regex: /我\s*(?:比较)?\s*(?:喜欢|偏好|倾向|习惯|更倾向)\s*(?:用|使用)?\s*([^\s，。！？]{2,20})/g, category: 'like', key: 'preference' },
      { regex: /统一用\s*([^\s，。！]{2,20})/g, category: 'like', key: 'language' },
    ];

    // 语言偏好（特殊处理）
    const langPatterns = [
      { regex: /用\s*(中文|英文|简体中文|繁体中文|日语|韩语)\s*(交流|回复|回答|对话|写|交互)/g, category: 'communication', key: 'language' },
      { regex: /(中文|英文|简体中文|繁体中文|日语)\s*(优先|为主|默认)/g, category: 'communication', key: 'language' },
      { regex: /统一用\s*(中文|英文|简体中文|繁体中文)/g, category: 'communication', key: 'language' },
    ];

    const allPatterns = [
      ...likePatterns.map(p => ({ ...p })),
      ...langPatterns,
    ];

    for (const pattern of allPatterns) {
      const regex = typeof pattern.regex === 'string' ? new RegExp(pattern.regex, 'gi') : pattern.regex;
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const value = match[1] || match[0];
        if (value && value.length >= 2 && value.length <= 50) {
          addPref(pattern.category, pattern.key, value.trim(), pattern.category === 'communication' ? 0.8 : 0.7);
        }
      }
    }

    return prefs;
  }

  /**
   * 实例方法：从文本中提取用户偏好（内部调用静态方法）
   */
  private extractPreferences(content: string): Array<{
    category: string;
    key: string;
    value: string;
    confidence: number;
  }> {
    const prefs: Array<{ category: string; key: string; value: string; confidence: number }> = [];
    const seen = new Set<string>(); // 去重

    const addPref = (category: string, key: string, value: string, confidence: number) => {
      const normValue = value.trim().replace(/[。！？\n]/g, '').slice(0, 100);
      if (!normValue || normValue.length < 2) return;
      const dedupKey = `${category}:${key}:${normValue.toLowerCase()}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      prefs.push({ category, key, value: normValue, confidence });
    };

    // ==================== 1. 明确表达喜好 ====================
    const likePatterns = [
      // 我喜欢/偏好/习惯/倾向于...
      { regex: /我\s*(?:比较)?\s*(?:喜欢|偏好|倾向|习惯(?:用)?|更倾向)/g, category: 'like', key: 'preference' },
      // 我觉得...比较好/比较好用
      { regex: /我\s*觉得\s*([^,，]{2,20})\s*(?:比较|更)?\s*(?:好|好用|不错|不错用|合适)/g, category: 'like', key: 'opinion' },
      // ...不错/挺好的/很好用
      { regex: /([^\n]{2,20})\s*(?:不错|挺好的|很好用|蛮好|很赞|很棒)/g, category: 'like', key: 'praise' },
    ];

    const dislikePatterns = [
      // 我不喜欢/不想/不要/避免/别用/不要用
      { regex: /我\s*(?:不|别|很少)\s*(?:喜欢|想|想要|需要|倾向|习惯|推荐)/g, category: 'dislike', key: 'preference' },
      // 不要用/别用/尽量避免/不太喜欢
      { regex: /(?:不要|别|避免|尽量别|不太喜欢|不太想)\s*(?:用)?\s*([^\n。！？]{2,30})/g, category: 'dislike', key: 'avoid' },
      // ...不好/不太好用/不太行
      { regex: /([^\n]{2,20})\s*(?:不太好|不太好用|不太行|不好用|太麻烦|太复杂|太繁琐)/g, category: 'dislike', key: 'complaint' },
    ];

    // ==================== 2. 沟通风格 ====================
    const communicationPatterns = [
      // 语言偏好
      { regex: /用\s*(中文|英文|简体|繁体|英文|日语|日语)\s*(交流|回复|回答|对话|写)/g, key: 'language' },
      // 简洁/详细要求
      { regex: /(?:回答|回复|解释|说明)\s*(?:尽量|尽量|尽可能|尽量|最好)\s*([^\n。！？]{2,20})/g, key: 'detail_level' },
      { regex: /(?:(?:简洁|简短|精炼|详细|详细|全面|完整)\s*(?:一些|一点|地|的|回复|回答|解释|说明))/g, key: 'detail_level' },
      // 语气/风格
      { regex: /(?:(?:口语|书面|正式|非正式|轻松|严肃|专业|通俗)\s*(?:化|风格|一点|一些))/g, key: 'tone' },
    ];

    // ==================== 3. 代码示例偏好 ====================
    const codePatterns = [
      // 语言偏好
      { regex: /用\s*([^\s\n]{1,10})\s*(?:写|实现|做|给出|示例|代码)/g, key: 'language' },
      // 代码风格
      { regex: /(?:(?:函数式|面向对象|声明式|命令式|响应式)\s*(?:风格|编程|写法))/g, key: 'style' },
      // 注释要求
      { regex: /(?:(?:加上|写好|加上|附带|包含)\s*(?:详细)?\s*(?:注释|说明|文档))/g, key: 'comments' },
    ];

    // ==================== 4. 格式偏好 ====================
    const formatPatterns = [
      // 格式要求
      { regex: /用\s*([^\s\n]{1,10})\s*(?:格式|方式|风格|排版)/g, key: 'format' },
      // 表格/列表/代码块偏好
      { regex: /(?:(?:用|使用|给出)\s*(?:表格|列表|代码块|示例|对比表|对照表))/g, key: 'format' },
      { regex: /(?:(?:markdown|Markdown|MD)\s*(?:格式|语法|排版))/g, key: 'format' },
    ];

    // ==================== 5. 技术栈 ====================
    const techKeywords: Record<string, string> = {
      'React': 'frontend', 'Vue': 'frontend', 'Angular': 'frontend', 'Svelte': 'frontend', 'Next\.js': 'frontend', 'Nuxt': 'frontend',
      'Node\.js': 'backend', 'Django': 'backend', 'Flask': 'backend', 'Spring': 'backend', 'Express': 'backend', 'FastAPI': 'backend',
      'PostgreSQL': 'database', 'MySQL': 'database', 'MongoDB': 'database', 'Redis': 'database', 'SQLite': 'database',
      'TypeScript': 'language', 'Python': 'language', 'Go': 'language', 'Java': 'language', 'Rust': 'language', 'Ruby': 'language',
      'Docker': 'devops', 'Kubernetes': 'devops', 'CI/CD': 'devops', 'GitHub Actions': 'devops',
      'Tailwind': 'frontend', 'Bootstrap': 'frontend', 'Ant Design': 'frontend', 'Material UI': 'frontend',
    };

    // ==================== 6. 工作流偏好 ====================
    const workflowPatterns = [
      // 先讨论再实现
      { regex: /(?:(?:先|首先)\s*(?:讨论|分析|思考|确认|了解|梳理)[^\n]{0,10}(?:再|然后再|然后再|然后再|之后再))\s*([^\n。！？]{2,20})/g, key: 'approach' },
      // 直接给方案
      { regex: /(?:直接|直接给|不用问|不用讨论)[^\n]{0,10}(?:方案|代码|实现|结果)/g, key: 'approach' },
      // 分步骤
      { regex: /(?:分步|按步骤|一步步|逐步|一步一步)[^\n]{0,10}(?:实现|做|来|进行|解释)/g, key: 'approach' },
    ];

    // 执行所有模式匹配
    const allPatterns = [
      ...likePatterns.map(p => ({ ...p, category: p.category || 'like' })),
      ...dislikePatterns.map(p => ({ ...p, category: p.category || 'dislike' })),
    ];

    for (const pattern of allPatterns) {
      const regex = typeof pattern.regex === 'string' ? new RegExp(pattern.regex, 'gi') : pattern.regex;
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const value = match[1] || match[0];
        if (value && value.length >= 2 && value.length <= 50) {
          addPref(pattern.category, pattern.key, value.trim(), 0.7);
        }
      }
    }

    // 通信风格
    for (const pattern of communicationPatterns) {
      const regex = typeof pattern.regex === 'string' ? new RegExp(pattern.regex, 'gi') : pattern.regex;
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const value = match[1] || match[2] || match[0];
        if (value && value.length >= 2 && value.length <= 50) {
          addPref('communication', pattern.key, value.trim(), 0.6);
        }
      }
    }

    // 代码示例
    for (const pattern of codePatterns) {
      const regex = typeof pattern.regex === 'string' ? new RegExp(pattern.regex, 'gi') : pattern.regex;
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const value = match[1] || match[0];
        if (value && value.length >= 2 && value.length <= 50) {
          addPref('code_example', pattern.key, value.trim(), 0.6);
        }
      }
    }

    // 格式偏好
    for (const pattern of formatPatterns) {
      const regex = typeof pattern.regex === 'string' ? new RegExp(pattern.regex, 'gi') : pattern.regex;
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const value = match[1] || match[0];
        if (value && value.length >= 2 && value.length <= 50) {
          addPref('format', pattern.key, value.trim(), 0.7);
        }
      }
    }

    // 技术栈
    for (const [keyword, domain] of Object.entries(techKeywords)) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      if (regex.test(content)) {
        addPref('tech_stack', domain, keyword, 0.5);
      }
    }

    // 工作流
    for (const pattern of workflowPatterns) {
      const regex = typeof pattern.regex === 'string' ? new RegExp(pattern.regex, 'gi') : pattern.regex;
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const value = match[1] || match[0];
        if (value && value.length >= 2 && value.length <= 50) {
          addPref('workflow', pattern.key, value.trim(), 0.6);
        }
      }
    }

    return prefs;
  }

  /**
   * 保存偏好到 SQLite
   * 若传入 db 参数则复用已有连接，否则自行打开/关闭
   */
  private savePreference(pref: { category: string; key: string; value: string; confidence: number }, db?: any): void {
    // preferences 写到 knowledge.db，不是 memory.db
    const kgPath = this.dbPath.replace('memory.db', 'knowledge.db');
    if (!fs.existsSync(kgPath)) return;

    const ownDb = !db;
    if (ownDb) {
      const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();
      db = new sqlite3.Database(kgPath);
    }

    try {
      const prefId = `${pref.category}:${pref.key}:${Date.now()}`;
      db.run(
        `INSERT OR REPLACE INTO preferences (id, category, value, confidence, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'session_scan', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
        [prefId, pref.category, pref.value, pref.confidence],
        (err: Error | null) => {
          if (err) this.logger.error('Save pref error', err);
        }
      );
    } finally {
      if (ownDb) {
        db.close();
      }
    }
  }

  /**
   * 重置扫描状态
   */
  resetState(): void {
    this.state = {};
    this.saveState();
    this.logger.info('Reset scan state');
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
      this.logger.error(`Error parsing ${filePath}`, error);
      return null;
    }
  }

  /**
   * 处理单个会话文件：增量导入 + 判断存储层级
   */
  private async processSession(
    session: SessionInfo,
    existingState?: SessionState
  ): Promise<{ saved: number; promoted: number; working: number; prefs: number }> {
    const result = { saved: 0, promoted: 0, working: 0, prefs: 0 };

    try {
      const content = fs.readFileSync(session.filePath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.trim());

      interface ParsedMessage {
        type: string;
        content: string;
        timestamp?: string;
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
        } catch { /* skip */ }
      }

      const startIndex = existingState?.lastMessageIndex || 0;
      const newMessages = messages.slice(startIndex);
      if (newMessages.length === 0) return result;

      const lazyHub = await this.getMemoryHub();

      // 合并为一条会话摘要
      const userMsgs = newMessages.filter(m => m.type === 'user');
      const assistantMsgs = newMessages.filter(m => m.type === 'assistant');

      const summary = this.buildSessionSummary(userMsgs, assistantMsgs, session);

      // 判断存储层级
      const promotion = this.shouldPromote(newMessages, session);
      const memoryType = promotion ? 'long_term' : 'working_session';

      await lazyHub.add({
        content: summary,
        type: memoryType as any,
        timestamp: newMessages[0].timestamp || new Date().toISOString(),
        metadata: {
          sessionId: session.id,
          source: 'session_scan',
          userMessageCount: userMsgs.length,
          assistantMessageCount: assistantMsgs.length,
          promoted: promotion
        }
      });

      result.saved = 1;
      if (promotion) result.promoted++; else result.working++;

      // 提取偏好
      const prefs = this.extractPreferences(summary);
      for (const pref of prefs) {
        this.savePreference(pref);
        result.prefs++;
      }

      return result;
    } catch (error) {
      this.logger.error(`Error processing ${session.id}`, error);
      return result;
    }
  }

  /**
   * 构建会话摘要
   */
  private buildSessionSummary(
    userMsgs: Array<{ content: string; timestamp?: string }>,
    assistantMsgs: Array<{ content: string; timestamp?: string }>,
    _session: SessionInfo
  ): string {
    const MAX_PREVIEW = 500;
    const parts: string[] = [];

    // 用户问题摘要
    if (userMsgs.length > 0) {
      const topics = userMsgs.map(m => m.content.slice(0, 200));
      parts.push(`用户问了 ${userMsgs.length} 个问题：\n${topics.join('\n---\n')}`);
    }

    // AI 回复摘要
    if (assistantMsgs.length > 0) {
      const replies = assistantMsgs.map(m => m.content.slice(0, MAX_PREVIEW));
      parts.push(`AI 回复了 ${assistantMsgs.length} 次：\n${replies.join('\n---\n')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * 判断会话是否应该晋升为长期记忆
   *
   * 晋升条件（满足任一即可）：
   * 1. 消息数 ≥ 10 条（深度对话）
   * 2. 对话时长 ≥ 30 分钟
   * 3. 包含技术关键词（代码/配置/错误/调试）
   */
  private shouldPromote(
    messages: Array<{ type: string; content: string; timestamp?: string }>,
    _session: SessionInfo
  ): boolean {
    const userMsgs = messages.filter(m => m.type === 'user');
    const assistantMsgs = messages.filter(m => m.type === 'assistant');
    const totalMsgs = userMsgs.length + assistantMsgs.length;

    // 条件 1: 消息数 ≥ 10
    if (totalMsgs >= 10) return true;

    // 条件 2: 对话时长 ≥ 30 分钟
    const timestamps = messages
      .map(m => m.timestamp)
      .filter(Boolean)
      .map(t => new Date(t!).getTime())
      .sort((a, b) => a - b);
    
    if (timestamps.length >= 2) {
      const durationMin = (timestamps[timestamps.length - 1] - timestamps[0]) / 60000;
      if (durationMin >= 30) return true;
    }

    // 条件 3: 包含技术关键词
    const techKeywords = /代码 | 配置 | 错误 | bug|debug|error|fix|修复 | 部署 | 编译 | 测试 | 优化 | 重构 | 架构 | 设计 | 实现|function|class|interface|type /i;
    const allContent = messages.map(m => m.content).join('\n');
    if (techKeywords.test(allContent)) return true;

    return false;
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
      this.logger.error('Save state error', error);
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
