/**
 * SQLite 数据库工具类
 * 
 * 提供统一的数据库访问层
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface DatabaseConfig {
  dbPath: string;
  readonly?: boolean;
  verbose?: boolean;
}

export class SQLiteDB {
  private db: Database.Database;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    
    // 确保目录存在
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(config.dbPath, {
      readonly: config.readonly || false,
      verbose: config.verbose ? console.log : undefined
    });

    // 启用 WAL 模式提高并发性能
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    console.log(`[SQLiteDB] Connected to ${config.dbPath}`);
  }

  /**
   * 执行 DDL 语句
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * 准备语句
   */
  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  /**
   * 执行插入/更新/删除
   */
  run(sql: string, params?: any[]): Database.RunResult {
    const stmt = this.db.prepare(sql);
    return stmt.run(...(params || []));
  }

  /**
   * 查询单行
   */
  get<T = any>(sql: string, params?: any[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...(params || [])) as T;
  }

  /**
   * 查询多行
   */
  all<T = any>(sql: string, params?: any[]): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params || [])) as T[];
  }

  /**
   * 事务执行
   */
  transaction(fn: (...args: any[]) => void): (...args: any[]) => void {
    return this.db.transaction(fn);
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
    console.log(`[SQLiteDB] Closed ${this.config.dbPath}`);
  }

  /**
   * 获取数据库实例
   */
  getDatabase(): Database.Database {
    return this.db;
  }
}
