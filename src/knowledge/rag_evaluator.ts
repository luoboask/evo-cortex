/**
 * RAG 检索评估与自动调优
 *
 * 评估检索质量，自动调节检索参数：
 * - 检索结果评分（命中率、覆盖度、相关性）
 * - 参数自调优（top_k, embedding mode, 搜索范围）
 * - 质量趋势追踪
 * - 自适应降级策略
 */

import * as fs from 'fs';
import * as path from 'path';
import { getKnowledgeStorageDir } from '../utils/plugin-context';
import type { PluginContext } from '../utils/plugin-context';

// ========== 类型定义 ==========

export interface RetrievalResult {
  id: string;
  content: string;
  score: number;
  source: string;   // 'embedding' | 'keyword' | 'tfidf'
  layer: string;
}

export interface RetrievalMetrics {
  query: string;
  resultCount: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  hitRate: number;        // 有结果的比例
  coverage: number;       // 覆盖的层级数量
  latencyMs: number;      // 检索耗时
  keywordRatio: number;   // keyword 降级比例（0-1）
  timestamp: string;
}

export interface TuningParams {
  topK: number;
  embeddingMode: 'auto' | 'semantic' | 'keyword';
  searchLayers: ('monthly' | 'weekly' | 'daily' | 'session')[];
  relevanceThreshold: number;
  useKeywordFallback: boolean;
}

export interface EvaluationReport {
  totalQueries: number;
  avgQuality: number;
  qualityTrend: 'improving' | 'stable' | 'degrading';
  tuningChanges: TuningChange[];
  recommendations: string[];
  generatedAt: string;
}

export interface TuningChange {
  param: string;
  oldValue: any;
  newValue: any;
  reason: string;
  timestamp: string;
  qualityImpact: number;  // 质量变化量（正数表示改善）
}

// ========== 配置 ==========

export interface RagEvalConfig {
  enabled: boolean;
  evaluationWindow: number;      // 评估窗口（查询次数）
  minQualityThreshold: number;   // 最低质量阈值触发调优
  targetQuality: number;         // 目标质量分数
  autoTune: boolean;             // 是否自动调优
  maxTopK: number;               // topK 上限
  minTopK: number;               // topK 下限
}

const DEFAULT_CONFIG: RagEvalConfig = {
  enabled: true,
  evaluationWindow: 20,
  minQualityThreshold: 0.3,
  targetQuality: 0.7,
  autoTune: true,
  maxTopK: 20,
  minTopK: 3
};

// ========== RAG 评估器 ==========

export class RagEvaluator {
  private config: RagEvalConfig;
  private metrics: RetrievalMetrics[] = [];
  private currentParams: TuningParams;
  private tuningHistory: TuningChange[] = [];
  private storagePath: string;

  constructor(ctx: PluginContext, config?: Partial<RagEvalConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始检索参数
    this.currentParams = {
      topK: 5,
      embeddingMode: 'auto',
      searchLayers: ['monthly', 'weekly', 'daily', 'session'],
      relevanceThreshold: 0.3,
      useKeywordFallback: true
    };

    // 存储路径
    const knowledgeDir = getKnowledgeStorageDir(ctx);
    this.storagePath = path.join(knowledgeDir, 'rag_eval.json');
    this.loadState();
  }

  /**
   * 记录一次检索的指标
   */
  recordRetrieval(
    query: string,
    results: RetrievalResult[],
    latencyMs: number
  ): RetrievalMetrics {
    const keywordCount = results.filter(r => r.source === 'keyword').length;
    const metrics: RetrievalMetrics = {
      query,
      resultCount: results.length,
      avgScore: results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0,
      maxScore: results.length > 0 ? Math.max(...results.map(r => r.score)) : 0,
      minScore: results.length > 0 ? Math.min(...results.map(r => r.score)) : 0,
      hitRate: results.length > 0 ? 1.0 : 0.0,
      coverage: new Set(results.map(r => r.layer)).size / 4, // 4 层
      latencyMs,
      keywordRatio: results.length > 0 ? keywordCount / results.length : 0,
      timestamp: new Date().toISOString()
    };

    this.metrics.push(metrics);

    // 保留最近的 N 次记录
    if (this.metrics.length > this.config.evaluationWindow * 3) {
      this.metrics = this.metrics.slice(-this.config.evaluationWindow * 2);
    }

    // 检查是否需要调优
    if (this.config.autoTune && this.metrics.length % this.config.evaluationWindow === 0) {
      this.evaluateAndTune();
    }

    this.saveState();
    return metrics;
  }

  /**
   * 获取当前检索参数
   */
  getTuningParams(): TuningParams {
    return { ...this.currentParams };
  }

  /**
   * 评估检索质量并自动调优
   */
  evaluateAndTune(): EvaluationReport {
    const window = this.metrics.slice(-this.config.evaluationWindow);
    if (window.length === 0) {
      return this.generateReport([]);
    }

    // 计算综合质量分数
    const avgQuality = this.calculateQualityScore(window);
    const recommendations: string[] = [];
    const changes: TuningChange[] = [];

    // 根据质量分数调整参数
    if (this.config.autoTune) {
      // 1. 命中率低 → 扩大搜索范围或增加 topK
      const avgHitRate = window.reduce((s, m) => s + m.hitRate, 0) / window.length;
      if (avgHitRate < this.config.minQualityThreshold) {
        const oldTopK = this.currentParams.topK;
        const newTopK = Math.min(oldTopK + 2, this.config.maxTopK);
        if (newTopK !== oldTopK) {
          this.currentParams.topK = newTopK;
          changes.push({
            param: 'topK',
            oldValue: oldTopK,
            newValue: newTopK,
            reason: `命中率过低 (${(avgHitRate * 100).toFixed(0)}%)，扩大检索范围`,
            timestamp: new Date().toISOString(),
            qualityImpact: 0
          });
        }

        // 如果已经是最大 topK，尝试启用关键词降级
        if (newTopK >= this.config.maxTopK && !this.currentParams.useKeywordFallback) {
          this.currentParams.useKeywordFallback = true;
          changes.push({
            param: 'useKeywordFallback',
            oldValue: false,
            newValue: true,
            reason: 'topK 已达上限，启用关键词降级',
            timestamp: new Date().toISOString(),
            qualityImpact: 0
          });
        }
      }

      // 2. 覆盖度低 → 检查是否有层级被跳过
      const avgCoverage = window.reduce((s, m) => s + m.coverage, 0) / window.length;
      if (avgCoverage < 0.5 && this.currentParams.searchLayers.length < 4) {
        const allLayers: TuningParams['searchLayers'] = ['monthly', 'weekly', 'daily', 'session'];
        const missingLayers = allLayers.filter(l => !this.currentParams.searchLayers.includes(l));
        if (missingLayers.length > 0) {
          this.currentParams.searchLayers.push(missingLayers[0]);
          changes.push({
            param: 'searchLayers',
            oldValue: this.currentParams.searchLayers.filter(l => l !== missingLayers[0]),
            newValue: [...this.currentParams.searchLayers],
            reason: `覆盖度过低，添加 ${missingLayers[0]} 层`,
            timestamp: new Date().toISOString(),
            qualityImpact: 0
          });
        }
      }

      // 3. 检索延迟过高 → 减少搜索层或降低 topK
      const avgLatency = window.reduce((s, m) => s + m.latencyMs, 0) / window.length;
      if (avgLatency > 5000 && this.currentParams.topK > this.config.minTopK) {
        const oldTopK = this.currentParams.topK;
        const newTopK = Math.max(oldTopK - 1, this.config.minTopK);
        if (newTopK !== oldTopK) {
          this.currentParams.topK = newTopK;
          changes.push({
            param: 'topK',
            oldValue: oldTopK,
            newValue: newTopK,
            reason: `延迟过高 (${avgLatency.toFixed(0)}ms)，缩减检索范围`,
            timestamp: new Date().toISOString(),
            qualityImpact: 0
          });
        }
      }

      // 4. 质量很好 → 可以尝试更精确的模式
      if (avgQuality > this.config.targetQuality && this.currentParams.topK > 5) {
        const oldTopK = this.currentParams.topK;
        const newTopK = Math.max(oldTopK - 1, 5);
        if (newTopK !== oldTopK) {
          this.currentParams.topK = newTopK;
          changes.push({
            param: 'topK',
            oldValue: oldTopK,
            newValue: newTopK,
            reason: `质量优秀 (${(avgQuality * 100).toFixed(0)}%)，尝试精确检索`,
            timestamp: new Date().toISOString(),
            qualityImpact: 0
          });
        }
      }

      // 5. embedding 模式自适应（基于 keywordRatio）
      const avgKeywordRatio = window.reduce((s, m) => s + m.keywordRatio, 0) / window.length;
      if (avgKeywordRatio > 0.7 && this.currentParams.embeddingMode === 'auto') {
        // embedding 大部分时间不可用，降级到 keyword
        this.currentParams.embeddingMode = 'keyword';
        changes.push({
          param: 'embeddingMode',
          oldValue: 'auto',
          newValue: 'keyword',
          reason: `embedding 不可用比例过高 (${(avgKeywordRatio * 100).toFixed(0)}%)`,
          timestamp: new Date().toISOString(),
          qualityImpact: 0
        });
      } else if (avgKeywordRatio < 0.2 && this.currentParams.embeddingMode === 'keyword') {
        // embedding 恢复了
        this.currentParams.embeddingMode = 'auto';
        changes.push({
          param: 'embeddingMode',
          oldValue: 'keyword',
          newValue: 'auto',
          reason: 'embedding 可用，恢复自动模式',
          timestamp: new Date().toISOString(),
          qualityImpact: 0
        });
      }

      // 计算调优后的质量影响
      for (const change of changes) {
        change.qualityImpact = avgQuality - (this.metrics.length > this.config.evaluationWindow * 2
          ? this.calculateQualityScore(this.metrics.slice(-this.config.evaluationWindow * 2, -this.config.evaluationWindow))
          : avgQuality);
      }
    }

    // 计算平均延迟用于建议生成
    const avgLatency = window.reduce((s, m) => s + m.latencyMs, 0) / window.length;

    // 生成建议
    if (avgQuality < 0.3) {
      recommendations.push('检索质量偏低，建议检查记忆数据完整性');
    }
    if (this.currentParams.topK >= this.config.maxTopK) {
      recommendations.push('topK 已达上限，建议增加记忆数据量');
    }
    if (avgLatency > 5000) {
      recommendations.push('检索延迟较高，考虑增加 embedding 缓存命中率');
    }

    // 追踪调优变化
    this.tuningHistory.push(...changes);
    if (this.tuningHistory.length > 100) {
      this.tuningHistory = this.tuningHistory.slice(-50);
    }

    const report = this.generateReport(recommendations, changes);
    this.saveState();
    return report;
  }

  /**
   * 生成评估报告
   */
  private generateReport(recommendations: string[], changes?: TuningChange[]): EvaluationReport {
    const window = this.metrics.slice(-this.config.evaluationWindow);
    const avgQuality = window.length > 0 ? this.calculateQualityScore(window) : 0;

    return {
      totalQueries: this.metrics.length,
      avgQuality,
      qualityTrend: this.detectTrend(window),
      tuningChanges: changes || this.tuningHistory.slice(-5),
      recommendations,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 计算综合质量分数 (0-1)
   */
  private calculateQualityScore(metrics: RetrievalMetrics[]): number {
    if (metrics.length === 0) return 0;

    const avgHitRate = metrics.reduce((s, m) => s + m.hitRate, 0) / metrics.length;
    const avgScore = metrics.reduce((s, m) => s + m.avgScore, 0) / metrics.length;
    const avgCoverage = metrics.reduce((s, m) => s + m.coverage, 0) / metrics.length;

    // 质量 = 命中率 * 0.4 + 相关度 * 0.4 + 覆盖率 * 0.2
    return avgHitRate * 0.4 + avgScore * 0.4 + avgCoverage * 0.2;
  }

  /**
   * 检测质量趋势
   */
  private detectTrend(metrics: RetrievalMetrics[]): 'improving' | 'stable' | 'degrading' {
    if (metrics.length < 4) return 'stable';

    const half = Math.floor(metrics.length / 2);
    const firstHalf = this.calculateQualityScore(metrics.slice(0, half));
    const secondHalf = this.calculateQualityScore(metrics.slice(half));

    const diff = secondHalf - firstHalf;
    if (diff > 0.05) return 'improving';
    if (diff < -0.05) return 'degrading';
    return 'stable';
  }

  // ========== 持久化 ==========

  private saveState(): void {
    try {
      const state = {
        metrics: this.metrics.slice(-this.config.evaluationWindow * 2),
        params: this.currentParams,
        tuningHistory: this.tuningHistory.slice(-50),
        savedAt: new Date().toISOString()
      };
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        const state = JSON.parse(raw);
        this.metrics = state.metrics || [];
        this.currentParams = state.params || this.currentParams;
        this.tuningHistory = state.tuningHistory || [];
        console.log(`[RagEvaluator] State loaded: ${this.metrics.length} metrics, ${this.tuningHistory.length} changes`);
      }
    } catch { /* ignore */ }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.metrics = [];
    this.tuningHistory = [];
    this.currentParams = {
      topK: 5,
      embeddingMode: 'auto',
      searchLayers: ['monthly', 'weekly', 'daily', 'session'],
      relevanceThreshold: 0.3,
      useKeywordFallback: true
    };
    this.saveState();
    console.log('[RagEvaluator] State reset');
  }
}
