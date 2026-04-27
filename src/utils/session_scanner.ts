/**
 * Lightweight on-demand session scanner (TypeScript)
 * Triggered by message:received hook, zero LLM calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

// Dynamic require for sqlite3 (ESM compat)
const sqlite3 = require('sqlite3').verbose();
const Database = sqlite3.Database;

interface ScanState {
  processed_sessions: string[];
  last_scan_at: string;
}

function loadState(dataDir: string): ScanState {
  const stateFile = path.join(dataDir, '.session_scan_state.json');
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { processed_sessions: [], last_scan_at: '' };
}

function saveState(dataDir: string, state: ScanState): void {
  const stateFile = path.join(dataDir, '.session_scan_state.json');
  state.last_scan_at = new Date().toISOString();
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

function parseSessionFile(filePath: string): Array<{ role: string; content: string; timestamp: string }> {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
    const messages: Array<{ role: string; content: string; timestamp: string }> = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const msg = entry.message || {};
        const role = msg.role || 'unknown';
        const raw = msg.content || '';
        const timestamp = entry.timestamp || '';

        let text = '';
        if (Array.isArray(raw)) {
          text = raw
            .filter((item: any) => item?.type === 'text')
            .map((item: any) => item.text || '')
            .join('\n');
        } else if (typeof raw === 'string') {
          text = raw;
        }

        if (text && text.length > 0) {
          messages.push({ role, content: text, timestamp });
        }
      } catch { /* skip malformed lines */ }
    }
    return messages;
  } catch {
    return [];
  }
}

function isCronTask(content: string): boolean {
  return content.includes('[cron:') ||
         content.includes('SCRIPT MODE') ||
         content.includes('no LLM analysis') ||
         content.includes('无需 LLM') ||
         content.includes('纯脚本');
}

function extractPreferences(messages: Array<{ role: string; content: string }>): Array<{ key: string; value: string; confidence: number }> {
  const patterns = [
    // Chinese patterns
    { regex: /(喜欢|偏好|倾向|习惯)\s*[：:]\s*(.+)/gi, type: 'preference' },
    { regex: /(不?喜欢|讨厌|反感|不要|别用)\s*[：:]\s*(.+)/gi, type: 'negative' },
    { regex: /用\s*(\S+?)\s*(?:交流|沟通|写|回复|对话)/gi, type: 'language' },
    { regex: /(?:格式|排版|样式|写法)\s*[：:]\s*(.+)/gi, type: 'format' },
    { regex: /技术栈\s*[：:]\s*(.+)/gi, type: 'tech_stack' },
    { regex: /前端\s*[：:]\s*(.+)/gi, type: 'tech_stack' },
    { regex: /后端\s*[：:]\s*(.+)/gi, type: 'tech_stack' },
    // English patterns
    { regex: /(?:prefer|like|want)\s*[:：]\s*(.+)/gi, type: 'preference' },
    { regex: /(?:dislike|hate|avoid)\s*[:：]\s*(.+)/gi, type: 'preference' },
    { regex: /(?:use|with)\s+(\S+?)\s+(?:language|lang)/gi, type: 'language' },
    { regex: /(?:format|style|layout)\s*[:：]\s*(.+)/gi, type: 'format' },
    { regex: /do not\s+(.+)/gi, type: 'negative' },
  ];

  const preferences: Array<{ key: string; value: string; confidence: number }> = [];

  for (const msg of messages) {
    if (msg.role !== 'user') continue;

    for (const p of patterns) {
      const matches = msg.content.matchAll(p.regex);
      for (const match of matches) {
        const value = match[1]?.trim();
        if (value && value.length > 1 && value.length < 100) {
          preferences.push({
            key: p.type,
            value: value.substring(0, 100),
            confidence: 0.7
          });
        }
      }
    }
  }

  return preferences;
}

function ensureTables(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS working_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      message_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      content TEXT,
      message_index INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT,
      value TEXT,
      confidence REAL DEFAULT 0.5,
      confirmed INTEGER DEFAULT 0,
      extracted_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function insertWorkingMemory(db: any, sessionId: string, content: string, messageCount: number): number | null {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  try {
    const stmt = db.prepare(
      "INSERT INTO working_memory (session_id, content, created_at, expires_at, message_count) VALUES (?, ?, datetime('now'), ?, ?)"
    );
    stmt.run(sessionId, content, expiresAt, messageCount);
    return (db as any).lastID;
  } catch {
    return null;
  }
}

function insertSessionMessages(db: any, sessionId: string, messages: Array<{ role: string; content: string }>): number {
  let count = 0;
  try {
    const stmt = db.prepare(
      "INSERT INTO session_messages (session_id, role, content, message_index) VALUES (?, ?, ?, ?)"
    );
    for (let i = 0; i < Math.min(messages.length, 20); i++) {
      const msg = messages[i];
      if (msg.content && msg.content.length > 0) {
        stmt.run(sessionId, msg.role, msg.content.substring(0, 2000), i);
        count++;
      }
    }
  } catch { /* ignore */ }
  return count;
}

function insertPreferences(db: any, prefs: Array<{ key: string; value: string; confidence: number }>): number {
  let count = 0;
  try {
    const stmt = db.prepare(
      "INSERT INTO preferences (key, value, confidence) VALUES (?, ?, ?)"
    );
    for (const p of prefs) {
      stmt.run(p.key, p.value, p.confidence);
      count++;
    }
  } catch { /* ignore */ }
  return count;
}

export interface ScanResult {
  new_sessions: number;
  working_memory_written: number;
  messages_written: number;
  preferences_extracted: number;
  skipped_cron: number;
  duration_ms: number;
}

export async function scanNewSessions(
  agentId: string,
  dataDir: string,
  sessionsPath: string,
  prefFile: string,
  logger?: Logger
): Promise<ScanResult> {
  const startTime = Date.now();
  const result: ScanResult = {
    new_sessions: 0,
    working_memory_written: 0,
    messages_written: 0,
    preferences_extracted: 0,
    skipped_cron: 0,
    duration_ms: 0
  };

  const state = loadState(dataDir);

  if (!fs.existsSync(sessionsPath)) {
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const files = fs.readdirSync(sessionsPath).filter(f => f.endsWith('.jsonl') && !f.includes('.trajectory'));
  if (files.length === 0) {
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const dbPath = path.join(dataDir, 'cortex.db');
  const db = new sqlite3.Database(dbPath);
  ensureTables(db);

  const allPreferences: Array<{ key: string; value: string; confidence: number }> = [];

  for (const file of files) {
    const sessionId = file.replace('.jsonl', '');

    if (state.processed_sessions.includes(sessionId)) {
      continue;
    }

    const filePath = path.join(sessionsPath, file);
    const messages = parseSessionFile(filePath);

    if (messages.length === 0) {
      state.processed_sessions.push(sessionId);
      continue;
    }

    const content = messages.map(m => m.content).join(' ');
    if (isCronTask(content)) {
      result.skipped_cron++;
      state.processed_sessions.push(sessionId);
      continue;
    }

    const wmContent = messages
      .filter(m => m.content.length < 5000)
      .map(m => `[${m.role}]: ${m.content.substring(0, 500)}`)
      .join('\n\n');

    // 不再写入 working_memory — hook 已通过 MemorySystem.record() 实时写入 memory.db
    // scanner 仅保留 session_messages 存档 + preferences 提取
    result.messages_written += insertSessionMessages(db, sessionId, messages);

    const prefs = extractPreferences(messages);
    allPreferences.push(...prefs);

    state.processed_sessions.push(sessionId);
    result.new_sessions++;
  }

  if (allPreferences.length > 0) {
    result.preferences_extracted = insertPreferences(db, allPreferences);

    try {
      const existing = fs.existsSync(prefFile) ? fs.readFileSync(prefFile, 'utf-8') : '';
      const lines = existing.split('\n').filter(l => l.trim());

      for (const p of allPreferences) {
        const marker = `- [ ] ${p.value}`;
        if (!lines.some(l => l.includes(p.value))) {
          lines.push(marker);
        }
      }

      fs.writeFileSync(prefFile, lines.join('\n'), 'utf-8');
    } catch { /* ignore */ }
  }

  db.close();
  saveState(dataDir, state);

  result.duration_ms = Date.now() - startTime;

  logger?.info(`session_scan: ${result.new_sessions} new, ${result.working_memory_written} WM, ${result.messages_written} msgs, ${result.preferences_extracted} prefs in ${result.duration_ms}ms`);

  return result;
}
