/**
 * 分形思考引擎
 * 
 * 模式识别、元规则生成、置信度计算
 */

export interface PatternRule {
  id: string;
  seedPhrases: string[];
  threshold: number;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  domain: 'code' | 'learning' | 'general';
}

export interface FractalAnalysis {
  level: number;
  levelName: string;
  description: string;
  inputData: string;
  outputData: string;
  timestamp: string;
  confidence: number;
  metadata?: Record<string, any>;
}

export interface MetaRule {
  id: string;
  rule: string;
  source: string;
  confidence: number;
  createdAt: string;
  applications: number;
  successRate: number;
}

export interface PatternMatch {
  ruleId: string;
  count: number;
  instances: string[];
  severity: string;
}

// 预定义的模式识别规则
export const DEFAULT_PATTERN_RULES: PatternRule[] = [
  // 代码领域
  {
    id: 'recurring_bug',
    seedPhrases: ['修复 Bug', '错误修复', '问题解决', '缺陷修复', 'BUG_FIX', '修复了', 'bug', 'fix', 'error'],
    threshold: 2,
    description: '重复出现的 Bug',
    severity: 'high',
    domain: 'code'
  },
  {
    id: 'feature_bloat',
    seedPhrases: ['新增功能', '功能实现', '添加', 'FEATURE', 'new feature', 'added', 'implement'],
    threshold: 3,
    description: '功能快速增加，可能需要重构',
    severity: 'medium',
    domain: 'code'
  },
  {
    id: 'code_improvement',
    seedPhrases: ['优化', '改进', '重构', 'CODE_IMPROVED', 'optimize', 'improve', 'refactor', 'enhance'],
    threshold: 2,
    description: '持续代码改进，技术债务累积',
    severity: 'medium',
    domain: 'code'
  },

  // 学习领域
  {
    id: 'learning_gap',
    seedPhrases: ['学习', '教程', '文档', '不明白', 'LEARNING', 'learn', 'study', 'tutorial'],
    threshold: 3,
    description: '学习需求累积，可能需要知识整理',
    severity: 'medium',
    domain: 'learning'
  },
  {
    id: 'knowledge_update',
    seedPhrases: ['更新', '过期', '废弃', 'OUTDATED', 'update', 'deprecated', 'obsolete'],
    threshold: 2,
    description: '知识可能需要更新',
    severity: 'high',
    domain: 'learning'
  },

  // 通用领域
  {
    id: 'recurring_question',
    seedPhrases: ['如何', '怎么', '为什么', '什么', 'HOW', 'WHY', 'WHAT', '如何配置', '如何使用'],
    threshold: 3,
    description: '重复出现的问题，可能需要文档化',
    severity: 'medium',
    domain: 'general'
  },
  {
    id: 'user_frustration',
    seedPhrases: ['不行', '错误', '失败', '报错', 'ERROR', 'failed', 'not working', 'broken'],
    threshold: 2,
    description: '用户挫折感累积，需要关注',
    severity: 'high',
    domain: 'general'
  }
];

export class FractalThinkingEngine {
  private rules: PatternRule[];
  private events: string[];
  private metaRules: MetaRule[];
  private maxEvents: number = 100;

  constructor(rules?: PatternRule[]) {
    this.rules = rules || DEFAULT_PATTERN_RULES;
    this.events = [];
    this.metaRules = [];
  }

  /**
   * 记录事件
   */
  recordEvent(event: string): void {
    this.events.push(event);

    // 限制事件数量
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * 批量记录事件
   */
  recordEvents(events: string[]): void {
    for (const event of events) {
      this.recordEvent(event);
    }
  }

  /**
   * 分析模式
   */
  analyzePatterns(): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const rule of this.rules) {
      const instances: string[] = [];

      for (const event of this.events) {
        const eventLower = event.toLowerCase();
        const matched = rule.seedPhrases.some(phrase =>
          eventLower.includes(phrase.toLowerCase())
        );

        if (matched) {
          instances.push(event);
        }
      }

      if (instances.length >= rule.threshold) {
        matches.push({
          ruleId: rule.id,
          count: instances.length,
          instances,
          severity: rule.severity
        });
      }
    }

    return matches.sort((a, b) => b.count - a.count);
  }

  /**
   * 生成元规则
   */
  generateMetaRules(): MetaRule[] {
    const patterns = this.analyzePatterns();
    const newMetaRules: MetaRule[] = [];

    for (const pattern of patterns) {
      const rule = this.rules.find(r => r.id === pattern.ruleId);
      if (!rule) continue;

      // 生成元规则
      const metaRule = this.createMetaRule(pattern, rule);
      newMetaRules.push(metaRule);
      this.metaRules.push(metaRule);
    }

    return newMetaRules;
  }

  /**
   * 执行分形思考
   */
  think(): FractalAnalysis[] {
    const analyses: FractalAnalysis[] = [];

    // Level 1: 表面模式
    const patterns = this.analyzePatterns();
    if (patterns.length > 0) {
      analyses.push({
        level: 1,
        levelName: '表面模式',
        description: `检测到 ${patterns.length} 个重复模式`,
        inputData: JSON.stringify(patterns.map(p => p.ruleId)),
        outputData: JSON.stringify(patterns),
        timestamp: new Date().toISOString(),
        confidence: this.calculateConfidence(patterns)
      });
    }

    // Level 2: 深层原因
    if (patterns.length >= 2) {
      const rootCauses = this.analyzeRootCauses(patterns);
      analyses.push({
        level: 2,
        levelName: '深层原因',
        description: `分析出 ${rootCauses.length} 个潜在根因`,
        inputData: JSON.stringify(patterns.map(p => p.ruleId)),
        outputData: JSON.stringify(rootCauses),
        timestamp: new Date().toISOString(),
        confidence: this.calculateConfidence(patterns) * 0.8
      });
    }

    // Level 3: 解决方案
    if (patterns.length >= 3) {
      const solutions = this.generateSolutions(patterns);
      analyses.push({
        level: 3,
        levelName: '解决方案',
        description: `生成 ${solutions.length} 个改进建议`,
        inputData: JSON.stringify(patterns.map(p => p.ruleId)),
        outputData: JSON.stringify(solutions),
        timestamp: new Date().toISOString(),
        confidence: this.calculateConfidence(patterns) * 0.6
      });
    }

    return analyses;
  }

  /**
   * 获取所有元规则
   */
  getMetaRules(): MetaRule[] {
    return this.metaRules;
  }

  /**
   * 获取最近的事件
   */
  getRecentEvents(limit: number = 10): string[] {
    return this.events.slice(-limit);
  }

  /**
   * 清空事件
   */
  clearEvents(): void {
    this.events = [];
  }

  // ========== 私有方法 ==========

  private createMetaRule(pattern: PatternMatch, rule: PatternRule): MetaRule {
    const ruleTemplates: Record<string, string> = {
      recurring_bug: '当重复出现 Bug 时，应该先进行根因分析，而不是直接修复症状',
      feature_bloat: '功能快速增长时，需要定期进行重构和技术债务清理',
      code_improvement: '持续改进是好的，但需要注意改进的优先级和影响范围',
      learning_gap: '学习需求累积时，应该创建系统化的学习路径和文档',
      knowledge_update: '发现过时知识时，应该建立定期审查和更新机制',
      recurring_question: '重复出现的问题应该被文档化，创建 FAQ 或指南',
      user_frustration: '用户挫折感累积时，需要优先解决核心问题并提供清晰的反馈'
    };

    return {
      id: `meta_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      rule: ruleTemplates[rule.id] || `检测到模式：${rule.description}`,
      source: rule.id,
      confidence: this.calculateConfidence([pattern]),
      createdAt: new Date().toISOString(),
      applications: 0,
      successRate: 0
    };
  }

  private calculateConfidence(patterns: PatternMatch[]): number {
    if (patterns.length === 0) return 0;

    const totalInstances = patterns.reduce((sum, p) => sum + p.count, 0);
    const patternCount = patterns.length;

    // 基于实例数量和模式数量的置信度
    const instanceScore = Math.min(totalInstances / 10, 1);
    const patternScore = Math.min(patternCount / 5, 1);

    return (instanceScore * 0.6 + patternScore * 0.4);
  }

  private analyzeRootCauses(patterns: PatternMatch[]): string[] {
    const causes: string[] = [];

    for (const pattern of patterns) {
      if (pattern.count >= 3) {
        causes.push(`模式 ${pattern.ruleId} 出现 ${pattern.count} 次，可能存在系统性问题`);
      }
    }

    return causes;
  }

  private generateSolutions(patterns: PatternMatch[]): string[] {
    const solutions: string[] = [];

    for (const pattern of patterns) {
      switch (pattern.ruleId) {
        case 'recurring_bug':
          solutions.push('建立自动化测试覆盖，预防回归');
          break;
        case 'feature_bloat':
          solutions.push('制定重构计划，清理技术债务');
          break;
        case 'learning_gap':
          solutions.push('创建学习路径图，系统化知识管理');
          break;
        case 'recurring_question':
          solutions.push('编写 FAQ 文档，减少重复问题');
          break;
        case 'user_frustration':
          solutions.push('优先解决核心问题，改善用户体验');
          break;
      }
    }

    return solutions;
  }
}
