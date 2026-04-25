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
import { PluginContext, getEvolutionStorageDir, getKnowledgeStorageDir } from "../utils/plugin-context";

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
  private config: EvolutionConfig;
  private storageDir: string;
  private recentEvents: Array<{ timestamp: string; content: string }> = [];

  constructor(ctx: PluginContext, config?: Partial<EvolutionConfig>) {
    this.ctx = ctx;
    this.config = {
      enabled: true,
      fractal_thinking: true,
      active_learning: true,
      ...config
    };

    // 使用绝对路径初始化存储目录
    this.storageDir = getEvolutionStorageDir(ctx);
    this.ensureDirectory(this.storageDir);

    console.log(`[EvolutionScheduler] Initialized for agent: ${ctx.agentId}, storage: ${this.storageDir}`);
  }

  /**
   * 执行分形思考
   */
  async runFractalThinking(): Promise<void> {
    console.log(`[EvolutionScheduler] Running fractal thinking for agent ${this.ctx.agentId}`);
    
    // 分析最近事件，生成元规则
    const metaRules = await this.analyzePatterns();
    
    // 持久化元规则
    await this.persistMetaRules(metaRules);
    
    console.log(`[EvolutionScheduler] Generated ${metaRules.length} meta rules`);
  }

  /**
   * 整理领域知识
   */
  async organizeDomainKnowledge(): Promise<void> {
    console.log(`[EvolutionScheduler] Organizing domain knowledge for agent ${this.ctx.agentId}`);
    
    // 扫描知识目录，识别重复和过时知识
    const knowledgeDir = getKnowledgeStorageDir(this.ctx);
    
    if (!fs.existsSync(knowledgeDir)) {
      console.log("[EvolutionScheduler] No knowledge directory found");
      return;
    }
    
    // TODO: 实现知识整理逻辑
    console.log("[EvolutionScheduler] Domain organization complete");
  }

  /**
   * 审查领域知识
   */
  async reviewDomainKnowledge(): Promise<void> {
    console.log(`[EvolutionScheduler] Reviewing domain knowledge for agent ${this.ctx.agentId}`);
    
    const knowledgeDir = getKnowledgeStorageDir(this.ctx);
    
    if (!fs.existsSync(knowledgeDir)) {
      console.log("[EvolutionScheduler] No knowledge directory found");
      return;
    }
    
    // TODO: 实现知识审查逻辑
    console.log("[EvolutionScheduler] Domain review complete");
  }

  /**
   * 主动学习检测
   */
  async runActiveLearning(): Promise<void> {
    console.log(`[EvolutionScheduler] Running active learning for agent ${this.ctx.agentId}`);
    
    // 检测学习机会
    const learningOpportunities = await this.detectLearningOpportunities();
    
    if (learningOpportunities.length > 0) {
      console.log(`[EvolutionScheduler] Found ${learningOpportunities.length} learning opportunities`);
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
   */
  private async analyzePatterns(): Promise<MetaRule[]> {
    const rules: MetaRule[] = [];
    
    // 简单实现：统计高频词汇
    const wordCount = new Map<string, number>();
    
    for (const event of this.recentEvents) {
      const words = event.content.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 4) {
          wordCount.set(word, (wordCount.get(word) || 0) + 1);
        }
      }
    }
    
    // 生成规则
    const topWords = [...wordCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    for (const [word, count] of topWords) {
      rules.push({
        id: `rule_${Date.now()}_${word}`,
        pattern: word,
        action: `focus_on_${word}`,
        confidence: Math.min(count / 10, 1.0),
        createdAt: new Date().toISOString(),
        timesTriggered: 0
      });
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
      
      console.log(`[EvolutionScheduler] Persisted ${rules.length} meta rules to: ${filePath}`);
    } catch (error) {
      console.error("[EvolutionScheduler] Persist meta rules error:", error);
    }
  }

  /**
   * 确保目录存在
   */
  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[EvolutionScheduler] Created storage directory: ${dirPath}`);
    }
  }
}
