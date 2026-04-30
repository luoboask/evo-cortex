/**
 * 质量评分器
 * 
 * 评估知识和记忆的质量
 */

export interface QualityScore {
  overall: number;
  accuracy: number;
  relevance: number;
  timeliness: number;
  completeness: number;
  details: string[];
}

export interface QualityConfig {
  weights: {
    accuracy: number;
    relevance: number;
    timeliness: number;
    completeness: number;
  };
  thresholds: {
    high: number;
    medium: number;
    low: number;
  };
}

const DEFAULT_CONFIG: QualityConfig = {
  weights: {
    accuracy: 0.35,
    relevance: 0.30,
    timeliness: 0.20,
    completeness: 0.15
  },
  thresholds: {
    high: 0.8,
    medium: 0.5,
    low: 0.3
  }
};

export class QualityScorer {
  private config: QualityConfig;

  constructor(config?: Partial<QualityConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      weights: { ...DEFAULT_CONFIG.weights, ...config?.weights },
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...config?.thresholds }
    };
  }

  /**
   * 评估知识质量
   */
  scoreKnowledge(
    content: string,
    metadata: {
      accuracy?: boolean;
      relevance?: number;
      createdAt?: string;
      updatedAt?: string;
      hasExamples?: boolean;
      hasReferences?: boolean;
    }
  ): QualityScore {
    const details: string[] = [];

    // 准确性评分
    const accuracy = metadata.accuracy !== undefined
      ? (metadata.accuracy ? 1.0 : 0.2)
      : this.estimateAccuracy(content);
    details.push(`准确性：${(accuracy * 100).toFixed(0)}%`);

    // 相关性评分
    const relevance = metadata.relevance ?? this.estimateRelevance(content);
    details.push(`相关性：${(relevance * 100).toFixed(0)}%`);

    // 时效性评分
    const timeliness = this.calculateTimeliness(
      metadata.createdAt,
      metadata.updatedAt
    );
    details.push(`时效性：${(timeliness * 100).toFixed(0)}%`);

    // 完整性评分
    const completeness = this.calculateCompleteness(
      content,
      metadata.hasExamples,
      metadata.hasReferences
    );
    details.push(`完整性：${(completeness * 100).toFixed(0)}%`);

    // 计算总分
    const overall =
      accuracy * this.config.weights.accuracy +
      relevance * this.config.weights.relevance +
      timeliness * this.config.weights.timeliness +
      completeness * this.config.weights.completeness;

    return {
      overall,
      accuracy,
      relevance,
      timeliness,
      completeness,
      details
    };
  }

  /**
   * 评估记忆质量
   */
  scoreMemory(
    content: string,
    metadata: {
      type: string;
      createdAt: string;
      hasContext?: boolean;
      isActionable?: boolean;
    }
  ): QualityScore {
    const details: string[] = [];

    // 记忆内容长度作为完整性指标
    const completeness = Math.min(content.length / 500, 1.0);
    details.push(`完整性：${(completeness * 100).toFixed(0)}%`);

    // 相关性（基于内容密度）
    const relevance = this.estimateRelevance(content);
    details.push(`相关性：${(relevance * 100).toFixed(0)}%`);

    // 时效性
    const timeliness = this.calculateTimeliness(metadata.createdAt);
    details.push(`时效性：${(timeliness * 100).toFixed(0)}%`);

    // 准确性（基于是否有上下文）
    const accuracy = metadata.hasContext ? 0.8 : 0.5;
    details.push(`准确性：${(accuracy * 100).toFixed(0)}%`);

    const overall =
      accuracy * this.config.weights.accuracy +
      relevance * this.config.weights.relevance +
      timeliness * this.config.weights.timeliness +
      completeness * this.config.weights.completeness;

    return {
      overall,
      accuracy,
      relevance,
      timeliness,
      completeness,
      details
    };
  }

  /**
   * 判断质量等级
   */
  getQualityLevel(score: number): 'high' | 'medium' | 'low' {
    if (score >= this.config.thresholds.high) return 'high';
    if (score >= this.config.thresholds.medium) return 'medium';
    return 'low';
  }

  /**
   * 筛选低质量内容
   */
  filterLowQuality<_T>(
    items: Array<{ id: string; content: string; metadata: any }>,
    scorer: (content: string, metadata: any) => QualityScore,
    threshold?: number
  ): Array<{ id: string; score: QualityScore }> {
    const minScore = threshold ?? this.config.thresholds.low;
    const lowQuality: Array<{ id: string; score: QualityScore }> = [];

    for (const item of items) {
      const score = scorer(item.content, item.metadata);
      if (score.overall < minScore) {
        lowQuality.push({ id: item.id, score });
      }
    }

    return lowQuality;
  }

  // ========== 私有方法 ==========

  private estimateAccuracy(content: string): number {
    // 简单启发式：长度适中、有结构的内容更可能准确
    const length = content.length;
    if (length < 10) return 0.3;
    if (length < 50) return 0.6;
    if (length < 500) return 0.8;
    return 0.7; // 过长可能包含噪声
  }

  private estimateRelevance(content: string): number {
    // 基于关键词密度
    const words = content.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const density = uniqueWords.size / Math.max(words.length, 1);

    // 理想密度在 0.5-0.8 之间
    if (density >= 0.5 && density <= 0.8) return 0.9;
    if (density >= 0.3 && density <= 0.9) return 0.7;
    return 0.4;
  }

  private calculateTimeliness(createdAt?: string, updatedAt?: string): number {
    if (!createdAt) return 0.5;

    const created = new Date(createdAt).getTime();
    const now = Date.now();
    const ageDays = (now - created) / (1000 * 60 * 60 * 24);

    // 如果最近更新过，提高时效性
    if (updatedAt) {
      const updated = new Date(updatedAt).getTime();
      const updateAgeDays = (now - updated) / (1000 * 60 * 60 * 24);
      if (updateAgeDays < 7) return 0.9;
      if (updateAgeDays < 30) return 0.7;
    }

    // 基于年龄衰减
    if (ageDays < 7) return 0.9;
    if (ageDays < 30) return 0.7;
    if (ageDays < 90) return 0.5;
    if (ageDays < 365) return 0.3;
    return 0.1;
  }

  private calculateCompleteness(
    content: string,
    hasExamples?: boolean,
    hasReferences?: boolean
  ): number {
    let score = 0.5; // 基础分

    if (content.length > 100) score += 0.2;
    if (content.length > 500) score += 0.1;
    if (hasExamples) score += 0.1;
    if (hasReferences) score += 0.1;

    return Math.min(score, 1.0);
  }
}
