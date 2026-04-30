/**
 * Evolution Scheduler - 进化调度器
 *
 * 功能：
 * - 分形思考（每小时）
 * - 领域知识整理（每天 2AM）
 * - 领域知识审查（每周日 6AM）
 * - 记忆压缩（每日/每周/月）
 * - 主动学习检测
 * - 进化报告生成
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { PluginContext, getEvolutionStorageDir, getDataDir } from "../utils/plugin-context";
import { getLogger } from "../utils/logger";

const sqlite3 = createRequire(import.meta.url)('sqlite3').verbose();

// 停用词表，用于词频分析时过滤
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from',
  'this', 'that', 'they', 'with', 'will', 'each', 'make', 'like',
  'just', 'over', 'such', 'more', 'than', 'them', 'very', 'when',
  'come', 'could', 'would', 'there', 'which', 'their', 'about',
  'what', 'said', 'some', 'time', 'into', 'also', 'other', 'only',
  'then', 'because', 'after', 'before', 'these', 'those', 'during',
  'through', 'between', 'should', 'already', 'nothing', 'everything',
  'something', 'however', 'without', 'still', 'always', 'never',
  'often', 'usually', 'sometimes', 'really', 'quite', 'rather',
  'maybe', 'perhaps', 'although', 'unless', 'since', 'while',
]);

export interface EvolutionConfig {
  enabled: boolean;
  fractal_thinking: boolean;
  active_learning: boolean;
}

interface MetaRule {
  id: string;
  pattern: string;
  action: string;
  confidence: number;
  createdAt: string;
  timesTriggered: number;
}

export class EvolutionScheduler {
  private ctx: PluginContext;
  private storageDir: string;
  private logger = getLogger({ component: 'EvolutionScheduler' });
  private recentEvents: Array<{ timestamp: string; content: string }> = [];

  constructor(ctx: PluginContext, _config?: Partial<EvolutionConfig>) {
    this.ctx = ctx;

    // 使用绝对路径初始化存储目录
    this.storageDir = getEvolutionStorageDir(ctx);
    this.ensureDirectory(this.storageDir);

    this.logger.info(`Initialized for agent: ${ctx.agentId}, storage: ${this.storageDir}`);
  }

  /**
   * 执行分形思考
   */
  async runFractalThinking(): Promise<void> {
    this.logger.info(`Running fractal thinking for agent ${this.ctx.agentId}`);

    // 分析最近事件，生成元规则
    const metaRules = await this.analyzePatterns();

    // 持久化元规则
    await this.persistMetaRules(metaRules);

    this.logger.info(`Generated ${metaRules.length} meta rules`);
  }

  /**
   * 整理领域知识
   * - 从 knowledge.db 读取实体、关系、规则
   * - 生成知识组织状态摘要报告
   * - 统计各类别的数量和状态
   */
  async organizeDomainKnowledge(): Promise<void> {
    this.logger.info(`Organizing domain knowledge for agent ${this.ctx.agentId}`);

    const dataDir = getDataDir(this.ctx);
    const dbPath = path.join(dataDir, 'knowledge.db');

    if (!fs.existsSync(dbPath)) {
      this.logger.info('knowledge.db not found, skipping organization');
      return;
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    try {
      const report = {
        totalEntities: 0,
        totalRelations: 0,
        totalRules: 0,
        entityTypes: {} as Record<string, number>,
        relationTypes: {} as Record<string, number>,
        ruleTypes: {} as Record<string, number>,
        highImportanceEntities: 0,
        lowConfidenceRules: 0,
        organizedAt: new Date().toISOString()
      };

      // 统计实体
      const entities: any[] = await new Promise((resolve, reject) => {
        db.all(`SELECT id, name, type, importance, mention_count, created_at FROM entities`, [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || []));
      });

      report.totalEntities = entities.length;
      for (const entity of entities) {
        report.entityTypes[entity.type] = (report.entityTypes[entity.type] || 0) + 1;
        if (entity.importance >= 7) {
          report.highImportanceEntities++;
        }
      }

      // 统计关系
      const relations: any[] = await new Promise((resolve, reject) => {
        db.all(`SELECT id, type, strength, used_count FROM relations`, [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || []));
      });

      report.totalRelations = relations.length;
      for (const rel of relations) {
        report.relationTypes[rel.type] = (report.relationTypes[rel.type] || 0) + 1;
      }

      // 统计规则
      const rules: any[] = await new Promise((resolve, reject) => {
        db.all(`SELECT id, type, confidence, support_count, violation_count FROM rules`, [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || []));
      });

      report.totalRules = rules.length;
      for (const rule of rules) {
        report.ruleTypes[rule.type] = (report.ruleTypes[rule.type] || 0) + 1;
        if (rule.confidence < 0.3) {
          report.lowConfidenceRules++;
        }
      }

      // 写入整理报告
      const reportPath = path.join(this.storageDir, 'organization_report.json');
      try {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
      } catch { /* ignore */ }

      this.logger.info(
        `Organized: ${report.totalEntities} entities (${Object.keys(report.entityTypes).length} types), ` +
        `${report.totalRelations} relations, ${report.totalRules} rules, ` +
        `${report.lowConfidenceRules} low-confidence rules`
      );
    } finally {
      db.close();
    }
  }

  /**
   * 审查领域知识
   * - 从 knowledge.db 读取实体、关系、规则
   * - 验证规则（置信度过低的标记为过时）
   * - 检查实体质量和新鲜度
   * - 生成审查报告
   */
  async reviewDomainKnowledge(): Promise<void> {
    this.logger.info(`Reviewing domain knowledge for agent ${this.ctx.agentId}`);

    const dataDir = getDataDir(this.ctx);
    const dbPath = path.join(dataDir, 'knowledge.db');

    if (!fs.existsSync(dbPath)) {
      this.logger.info('knowledge.db not found, skipping review');
      return;
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const review = {
        totalEntities: 0,
        totalRelations: 0,
        totalRules: 0,
        staleEntities: 0,       // 超过 30 天未更新
        orphanRelations: 0,     // 关系指向不存在的实体
        entityTypes: {} as Record<string, number>,
        ruleValidation: {
          core: 0,              // confidence >= 0.8
          normal: 0,            // 0.3 <= confidence < 0.8
          outdated: 0,          // confidence < 0.3
        },
        highImportanceEntities: [] as Array<{ id: string; name: string; importance: number }>,
        lowConfidenceRules: [] as Array<{ id: string; title: string; confidence: number }>,
        reviewedAt: new Date().toISOString(),
        cutoffDate
      };

      // 读取实体并检查新鲜度
      const entities: any[] = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, name, type, importance, mention_count, last_mentioned, created_at FROM entities`,
          [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])
        );
      });

      const entityIds = new Set<string>();
      review.totalEntities = entities.length;

      for (const entity of entities) {
        entityIds.add(entity.id);
        review.entityTypes[entity.type] = (review.entityTypes[entity.type] || 0) + 1;

        // 检查新鲜度
        const lastMentioned = entity.last_mentioned || entity.created_at;
        if (lastMentioned && new Date(lastMentioned) < new Date(cutoffDate)) {
          review.staleEntities++;
        }

        // 收集高重要性实体
        if (entity.importance >= 8) {
          review.highImportanceEntities.push({
            id: entity.id,
            name: entity.name,
            importance: entity.importance
          });
        }
      }

      // 读取关系并检查孤立关系
      const relations: any[] = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, source_id, target_id, type, strength FROM relations`,
          [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])
        );
      });

      review.totalRelations = relations.length;
      for (const rel of relations) {
        if (!entityIds.has(rel.source_id)) {
          review.orphanRelations++;
        }
        if (!entityIds.has(rel.target_id)) {
          review.orphanRelations++;
        }
      }

      // 读取规则并验证
      const rules: any[] = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, type, title, condition, action, confidence, support_count, violation_count FROM rules`,
          [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])
        );
      });

      review.totalRules = rules.length;
      for (const rule of rules) {
        const confidence = rule.confidence || 0.5;
        if (confidence >= 0.8) {
          review.ruleValidation.core++;
        } else if (confidence >= 0.3) {
          review.ruleValidation.normal++;
        } else {
          review.ruleValidation.outdated++;
          review.lowConfidenceRules.push({
            id: rule.id,
            title: rule.title || 'untitled',
            confidence: confidence
          });
        }
      }

      // 写入审查报告
      const reportPath = path.join(this.storageDir, 'review_report.json');
      try {
        fs.writeFileSync(reportPath, JSON.stringify(review, null, 2), 'utf-8');
      } catch { /* ignore */ }

      this.logger.info(
        `Reviewed: ${review.totalEntities} entities (${review.staleEntities} stale), ` +
        `${review.totalRelations} relations (${review.orphanRelations} orphan), ` +
        `${review.totalRules} rules (${review.ruleValidation.outdated} outdated)`
      );
    } finally {
      db.close();
    }
  }

  /**
   * 主动学习检测
   */
  async runActiveLearning(): Promise<void> {
    this.logger.info(`Running active learning for agent ${this.ctx.agentId}`);
    
    // 检测学习机会
    const learningOpportunities = await this.detectLearningOpportunities();
    
    if (learningOpportunities.length > 0) {
      this.logger.info(`Found ${learningOpportunities.length} learning opportunities`);
    }
  }

  /**
   * 添加事件到队列
   */
  addEvent(content: string): void {
    this.recentEvents.push({
      timestamp: new Date().toISOString(),
      content
    });
    
    // 保持最近 100 个事件
    if (this.recentEvents.length > 100) {
      this.recentEvents.shift();
    }
  }

  // ========== 私有方法 ==========

  /**
   * 分析事件模式，生成元规则
   * 从 memory.db 中读取 working_memory 和 long_term_memory 的实际数据
   */
  private async analyzePatterns(): Promise<MetaRule[]> {
    const rules: MetaRule[] = [];
    const dataDir = getDataDir(this.ctx);
    const dbPath = path.join(dataDir, 'memory.db');

    if (!fs.existsSync(dbPath)) {
      this.logger.info('memory.db not found, skipping pattern analysis');
      return rules;
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    try {
      // 读取最近 100 条 working_memory 条目
      const workingRows: any[] = await new Promise((resolve, reject) => {
        db.all(
          `SELECT content, type, importance, created_at FROM working_memory ORDER BY created_at DESC LIMIT 100`,
          [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])
        );
      });

      // 读取最近 100 条 long_term_memory 条目
      const ltmRows: any[] = await new Promise((resolve, reject) => {
        db.all(
          `SELECT content, type, importance, created_at FROM long_term_memory ORDER BY created_at DESC LIMIT 100`,
          [],
          (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows || [])
        );
      });

      // 合并所有内容用于词频分析
      const allContent = [...workingRows, ...ltmRows];

      if (allContent.length === 0) {
        this.logger.info('No memory entries found for pattern analysis');
        return rules;
      }

      // 词频分析
      const wordCount = new Map<string, number>();
      const typeCount = new Map<string, number>();
      const contentSamples: string[] = [];

      for (const entry of allContent) {
        // 词频统计
        const words = entry.content.toLowerCase().split(/\s+/);
        for (const word of words) {
          // 过滤掉太短的词和常见停用词
          const cleaned = word.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '');
          if (cleaned.length > 3 && !STOP_WORDS.has(cleaned)) {
            wordCount.set(cleaned, (wordCount.get(cleaned) || 0) + 1);
          }
        }

        // 类型统计
        if (entry.type) {
          typeCount.set(entry.type, (typeCount.get(entry.type) || 0) + 1);
        }

        // 保留内容样本用于生成规则
        contentSamples.push(entry.content.slice(0, 200));
      }

      // 生成基于高频词汇的元规则
      const topWords = [...wordCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      for (const [word, count] of topWords) {
        rules.push({
          id: `rule_${Date.now()}_${word}`,
          pattern: `frequent_term:${word}`,
          action: `focus_on_${word}`,
          confidence: Math.min(count / 10, 1.0),
          createdAt: new Date().toISOString(),
          timesTriggered: 0
        });
      }

      // 生成基于内容类型的元规则
      for (const [type, count] of typeCount.entries()) {
        rules.push({
          id: `rule_${Date.now()}_type_${type}`,
          pattern: `content_type:${type}`,
          action: `prioritize_${type}_content`,
          confidence: Math.min(count / 20, 1.0),
          createdAt: new Date().toISOString(),
          timesTriggered: 0
        });
      }

      this.logger.info(
        `Analyzed ${allContent.length} memory entries: ` +
        `${workingRows.length} working, ${ltmRows.length} long-term, ` +
        `${topWords.length} top terms identified`
      );
    } finally {
      db.close();
    }

    return rules;
  }

  /**
   * 检测学习机会
   */
  private async detectLearningOpportunities(): Promise<Array<{ type: string; description: string }>> {
    const opportunities: Array<{ type: string; description: string }> = [];
    
    // 简单实现：检查是否有未回答的问题
    const questionPattern = /[?？]/g;
    for (const event of this.recentEvents) {
      if (questionPattern.test(event.content)) {
        opportunities.push({
          type: "unanswered_question",
          description: event.content.slice(0, 100)
        });
      }
    }
    
    return opportunities;
  }

  /**
   * 持久化元规则
   */
  private async persistMetaRules(rules: MetaRule[]): Promise<void> {
    try {
      const filePath = path.join(this.storageDir, "meta_rules.json");
      
      let existing: MetaRule[] = [];
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        existing = JSON.parse(content);
      }
      
      // 合并新规则
      const merged = [...existing, ...rules];
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
      
      this.logger.info(`Persisted ${rules.length} meta rules to: ${filePath}`);
    } catch (error) {
      this.logger.error('Persist meta rules error', error);
    }
  }

  /**
   * 确保目录存在
   */
  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      this.logger.info(`Created storage directory: ${dirPath}`);
    }
  }
}
