/**
 * 简易存储工具
 * 
 * 使用 JSON 文件替代 SQLite
 */

import * as fs from 'fs';
import * as path from 'path';

export interface StorageConfig {
  dataDir: string;
}

export class SimpleStorage {
  private dataDir: string;

  constructor(config: StorageConfig) {
    this.dataDir = config.dataDir;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 保存数据
   */
  save(key: string, data: any): void {
    const filePath = path.join(this.dataDir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * 加载数据
   */
  load<T = any>(key: string): T | null {
    const filePath = path.join(this.dataDir, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * 删除数据
   */
  remove(key: string): void {
    const filePath = path.join(this.dataDir, `${key}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * 列出所有 key
   */
  listKeys(): string[] {
    if (!fs.existsSync(this.dataDir)) return [];
    return fs.readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * 获取数据目录
   */
  getDataDir(): string {
    return this.dataDir;
  }
}
