/**
 * 会话扫描器
 *
 * 扫描 OpenClaw Agent 会话，增量保存到记忆系统
 */

import * as fs from 'fs';
import * as path from 'path';
import { PluginContext, getDataDir } from '../utils/plugin-context';
import { MemoryHub } from './memory_hub';

export interface SessionInfo {
  id: string;
  filePath: string;
  messageCount: number;
  lastModified: number;
  hash: string;
}

export interface ScanResult {
  scanned: number;
  newSessions: number;
  updatedSessions: number;
  skipped: number;
  memoriesSaved: number;
}

export interface ScanState {
  [sessionId: string]: {
    hash: string;
    messageCount: number;
    lastScanned: string;
  };
}

export class SessionScanner {
  private ctx: PluginContext;
  private sessionsDir: string;
  private stateFile: string;
  private state: ScanState;
  private memoryHub: MemoryHub;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;

    // OpenClaw 会话目录
    const openclawRoot = ctx.storageBaseDir;
    this.sessionsDir = path.join(
      openclawRoot,
      'agents',
      ctx.agentId,
      'sessions'
    );

    // 状态文件 - 使用 workspace 下的 data 目录
    const dataDir = getDataDir(ctx);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.stateFile = path.join(dataDir, '.session_scan_state.json');

    // 加载状态
    this.state = this.loadState();

    // 初始化记忆中心
    this.memoryHub = new MemoryHub(ctx);
  }

  /**
   * 扫描所有会话
   */
  async scan(): Promise<ScanResult> {
    const result: ScanResult = {
      scanned: 0,
      newSessions: 0,
      updatedSessions: 0,
      skipped: 0,
      memoriesSaved: 0
    };

    // 检查会话目录
    if (!fs.existsSync(this.sessionsDir)) {
      console.log(`[SessionScanner] No sessions directory found for agent ${this.ctx.agentId}`);
      return result;
    }

    // 获取所有会话文件
    const sessionFiles = this.getSessionFiles();
    result.scanned = sessionFiles.length;

    for (const file of sessionFiles) {
      const sessionInfo = this.parseSessionFile(file);
      if (!sessionInfo) continue;

      const stateKey = sessionInfo.id;
      const existingState = this.state[stateKey];

      // 判断是否需要扫描
      if (existingState && existingState.hash === sessionInfo.hash) {
        result.skipped++;
        continue;
      }

      // 处理会话
      await this.processSession(sessionInfo);

      // 更新状态
      this.state[stateKey] = {
        hash: sessionInfo.hash,
        messageCount: sessionInfo.messageCount,
        lastScanned: new Date().toISOString()
      };

      if (!existingState) {
        result.newSessions++;
      } else {
        result.updatedSessions++;
      }
    }

    // 保存状态
    this.saveState();

    console.log(
      `[SessionScanner] Scan complete for agent ${this.ctx.agentId}: ` +
      `${result.scanned} scanned, ${result.newSessions} new, ` +
      `${result.updatedSessions} updated, ${result.skipped} skipped`
    );

    return result;
  }

  /**
   * 重置扫描状态
   */
  resetState(): void {
    this.state = {};
    this.saveState();
    console.log(`[SessionScanner] Reset scan state for agent ${this.ctx.agentId}`);
  }

  // ========== 私有方法 ==========

  /**
   * 获取所有会话文件
   */
  private getSessionFiles(): string[] {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    const files: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          files.push(fullPath);
        }
      }
    };

    walk(this.sessionsDir);
    return files;
  }

  /**
   * 解析会话文件
   */
  private parseSessionFile(filePath: string): SessionInfo | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const messages = JSON.parse(content);
      
      if (!Array.isArray(messages) || messages.length === 0) {
        return null;
      }

      const contentHash = this.hashContent(content);
      const fileName = path.basename(filePath, '.json');

      return {
        id: fileName,
        filePath,
        messageCount: messages.length,
        lastModified: fs.statSync(filePath).mtimeMs,
        hash: contentHash
      };
    } catch (error) {
      console.error(`[SessionScanner] Error parsing ${filePath}:`, error);
      return null;
    }
  }

  /**
   * 处理会话内容
   */
  private async processSession(session: SessionInfo): Promise<void> {
    try {
      const content = fs.readFileSync(session.filePath, 'utf8');
      const messages = JSON.parse(content);

      // 将对话内容保存到记忆
      const conversationText = messages
        .map((m: any) => `${m.role}: ${m.content}`)
        .join('\n\n');

      await this.memoryHub.add({
        content: conversationText.slice(0, 5000), // 限制长度
        type: 'session',
        timestamp: new Date(session.lastModified).toISOString(),
        metadata: {
          sessionId: session.id,
          messageCount: session.messageCount,
          source: 'session_scan'
        }
      });
    } catch (error) {
      console.error(`[SessionScanner] Error processing session ${session.id}:`, error);
    }
  }

  /**
   * 加载状态
   */
  private loadState(): ScanState {
    if (fs.existsSync(this.stateFile)) {
      try {
        const content = fs.readFileSync(this.stateFile, 'utf8');
        return JSON.parse(content);
      } catch (error) {
        console.error('[SessionScanner] Load state error:', error);
      }
    }
    return {};
  }

  /**
   * 保存状态
   */
  private saveState(): void {
    try {
      fs.writeFileSync(
        this.stateFile,
        JSON.stringify(this.state, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('[SessionScanner] Save state error:', error);
    }
  }

  /**
   * 计算内容哈希（简单实现）
   */
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
