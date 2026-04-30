/**
 * 记忆索引器
 *
 * 使用 JSON 文件存储索引 + FTS5 全文搜索 + 向量语义搜索
 * 兼容旧版 JSON 索引，同时支持新的 FTS + vector 索引
 */

import * as fs from 'fs';
import * as path from 'path';
import { PluginContext, getDataDir } from '../utils/plugin-context';
import { IndexBuilder } from './index_builder';

export interface Document {
  id: string;
  path: string;
  content: string;
  type: string;
  date?: string;
  mtime: number;
}

export interface IndexStats {
  documents: number;
  types: Record<string, number>;
  lastIndexed?: string;
}

export interface FileState {
  [filePath: string]: {
    mtime: number;
    indexedAt: string;
  };
}

export class MemoryIndexer {
  private ctx: PluginContext;
  private indexDir: string;
  private documents: Document[] = [];
  private pathToIndex = new Map<string, number>();
  private fileState: FileState = {};
  private initialized: boolean = false;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
    const dataDir = getDataDir(ctx);
    this.indexDir = path.join(dataDir, 'memory_index');
  }

  /**
   * 初始化
   */
  init(): void {
    if (this.initialized) return;

    if (!fs.existsSync(this.indexDir)) {
      fs.mkdirSync(this.indexDir, { recursive: true });
    }

    // 加载已有索引
    const indexFile = path.join(this.indexDir, 'documents.json');
    if (fs.existsSync(indexFile)) {
      try {
        this.documents = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        this.documents.forEach((doc, i) => this.pathToIndex.set(doc.path, i));
      } catch {
        this.documents = [];
      }
    }

    // 加载文件状态
    const stateFile = path.join(this.indexDir, 'file_state.json');
    if (fs.existsSync(stateFile)) {
      try {
        this.fileState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      } catch {
        this.fileState = {};
      }
    }

    this.initialized = true;
    console.log(`[MemoryIndexer] Initialized with ${this.documents.length} documents for agent ${this.ctx.agentId}`);
  }

  /**
   * 索引单个文档（不立即保存，需调用 saveIndex）
   */
  indexDocument(doc: Document): void {
    if (!this.initialized) this.init();

    const existingIndex = this.pathToIndex.get(doc.path);
    if (existingIndex !== undefined) {
      this.documents[existingIndex] = doc;
    } else {
      this.pathToIndex.set(doc.path, this.documents.length);
      this.documents.push(doc);
    }

    // 更新文件状态
    this.fileState[doc.path] = {
      mtime: doc.mtime,
      indexedAt: new Date().toISOString()
    };
  }

  /**
   * 批量索引文档
   */
  indexDocuments(docs: Document[]): void {
    for (const doc of docs) {
      this.indexDocument(doc);
    }
    this.saveIndex();
    console.log(`[MemoryIndexer] Indexed ${docs.length} documents`);
  }

  /**
   * 扫描并索引目录
   */
  scanDirectory(dirPath: string, pattern?: RegExp): Document[] {
    if (!fs.existsSync(dirPath)) {
      console.log(`[MemoryIndexer] Directory not found: ${dirPath}`);
      return [];
    }

    const docs: Document[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          if (!pattern || pattern.test(entry.name)) {
            const stat = fs.statSync(fullPath);
            const content = fs.readFileSync(fullPath, 'utf8');
            
            docs.push({
              id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              path: fullPath,
              content: content.slice(0, 10000), // 限制长度
              type: path.extname(fullPath).slice(1),
              date: stat.birthtime.toISOString(),
              mtime: stat.mtimeMs
            });
          }
        }
      }
    };

    walk(dirPath);
    this.indexDocuments(docs);
    return docs;
  }

  /**
   * 获取统计信息
   */
  getStats(): IndexStats {
    const types: Record<string, number> = {};
    for (const doc of this.documents) {
      types[doc.type] = (types[doc.type] || 0) + 1;
    }

    return {
      documents: this.documents.length,
      types,
      lastIndexed: this.documents.length > 0 
        ? this.fileState[this.documents[this.documents.length - 1].path]?.indexedAt 
        : undefined
    };
  }

  /**
   * 搜索文档（关键词 fallback）
   */
  search(query: string, limit: number = 10): Document[] {
    const queryLower = query.toLowerCase();

    return this.documents
      .filter(doc => doc.content.toLowerCase().includes(queryLower))
      .slice(0, limit);
  }

  /**
   * 获取 IndexBuilder 实例（用于 FTS + 向量搜索）
   */
  getIndexBuilder(): IndexBuilder {
    return new IndexBuilder(this.ctx);
  }

  /**
   * 根据路径获取文档
   */
  getDocument(path: string): Document | undefined {
    return this.documents.find(d => d.path === path);
  }

  /**
   * 删除文档
   */
  removeDocument(docPath: string): boolean {
    const index = this.pathToIndex.get(docPath);
    if (index !== undefined) {
      this.documents.splice(index, 1);
      this.pathToIndex.delete(docPath);
      // Rebuild map after splice
      this.pathToIndex.clear();
      this.documents.forEach((doc, i) => this.pathToIndex.set(doc.path, i));
      delete this.fileState[docPath];
      this.saveIndex();
      return true;
    }
    return false;
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.documents = [];
    this.fileState = {};
    this.saveIndex();
    console.log('[MemoryIndexer] Cleared all indexes');
  }

  // ========== 私有方法 ==========

  /**
   * 保存索引到文件
   */
  private saveIndex(): void {
    try {
      const indexFile = path.join(this.indexDir, 'documents.json');
      fs.writeFileSync(indexFile, JSON.stringify(this.documents, null, 2), 'utf8');

      const stateFile = path.join(this.indexDir, 'file_state.json');
      fs.writeFileSync(stateFile, JSON.stringify(this.fileState, null, 2), 'utf8');
    } catch (error) {
      console.error('[MemoryIndexer] Save index error:', error);
    }
  }
}
