/**
 * 专家求解器
 * 
 * 领域专家注册、问题路由、解决方案评估
 */

export interface Expert {
  id: string;
  name: string;
  domains: string[];
  description: string;
  solve: (problem: string, context?: Record<string, any>) => Promise<string>;
  confidence: number;
  successCount: number;
  failCount: number;
}

export interface Problem {
  id: string;
  description: string;
  domain?: string;
  context?: Record<string, any>;
  timestamp: string;
}

export interface Solution {
  problemId: string;
  expertId: string;
  solution: string;
  confidence: number;
  rating?: number;
  timestamp: string;
}

export class ExpertRegistry {
  private experts: Map<string, Expert>;

  constructor() {
    this.experts = new Map();
  }

  /**
   * 注册专家
   */
  register(expert: Expert): void {
    this.experts.set(expert.id, expert);
    console.log(`[ExpertRegistry] Registered expert: ${expert.name} (${expert.domains.join(', ')})`);
  }

  /**
   * 注销专家
   */
  unregister(expertId: string): boolean {
    return this.experts.delete(expertId);
  }

  /**
   * 获取专家
   */
  getExpert(expertId: string): Expert | undefined {
    return this.experts.get(expertId);
  }

  /**
   * 获取所有专家
   */
  getAllExperts(): Expert[] {
    return Array.from(this.experts.values());
  }

  /**
   * 按领域查找专家
   */
  findByDomain(domain: string): Expert[] {
    return Array.from(this.experts.values()).filter(
      e => e.domains.includes(domain)
    );
  }

  /**
   * 获取专家数量
   */
  getExpertCount(): number {
    return this.experts.size;
  }
}

export class ProblemRouter {
  private registry: ExpertRegistry;
  private solutions: Map<string, Solution[]>;

  constructor(registry: ExpertRegistry) {
    this.registry = registry;
    this.solutions = new Map();
  }

  /**
   * 路由问题到最佳专家
   */
  async routeProblem(problem: Problem): Promise<Solution | null> {
    // 查找相关领域的专家
    let candidates: Expert[] = [];

    if (problem.domain) {
      candidates = this.registry.findByDomain(problem.domain);
    }

    if (candidates.length === 0) {
      // 如果没有指定领域或找不到，使用所有专家
      candidates = this.registry.getAllExperts();
    }

    if (candidates.length === 0) {
      console.warn('[ProblemRouter] No experts available');
      return null;
    }

    // 选择最佳专家（基于置信度和成功率）
    const bestExpert = this.selectBestExpert(candidates);

    // 求解
    try {
      const solutionText = await bestExpert.solve(problem.description, problem.context);
      const solution: Solution = {
        problemId: problem.id,
        expertId: bestExpert.id,
        solution: solutionText,
        confidence: bestExpert.confidence,
        timestamp: new Date().toISOString()
      };

      // 保存解决方案
      if (!this.solutions.has(problem.id)) {
        this.solutions.set(problem.id, []);
      }
      this.solutions.get(problem.id)!.push(solution);

      console.log(`[ProblemRouter] Routed problem ${problem.id} to ${bestExpert.name}`);
      return solution;
    } catch (error) {
      console.error(`[ProblemRouter] Expert ${bestExpert.name} failed:`, error);
      bestExpert.failCount++;
      return null;
    }
  }

  /**
   * 评估解决方案
   */
  rateSolution(problemId: string, solutionIndex: number, rating: number): void {
    const solutions = this.solutions.get(problemId);
    if (!solutions || !solutions[solutionIndex]) return;

    solutions[solutionIndex].rating = rating;

    // 更新专家统计
    const solution = solutions[solutionIndex];
    const expert = this.registry.getExpert(solution.expertId);
    if (expert) {
      if (rating >= 3) {
        expert.successCount++;
      } else {
        expert.failCount++;
      }
    }
  }

  /**
   * 获取问题的解决方案
   */
  getSolutions(problemId: string): Solution[] {
    return this.solutions.get(problemId) || [];
  }

  // ========== 私有方法 ==========

  private selectBestExpert(candidates: Expert[]): Expert {
    return candidates.sort((a, b) => {
      const scoreA = this.calculateExpertScore(a);
      const scoreB = this.calculateExpertScore(b);
      return scoreB - scoreA;
    })[0];
  }

  private calculateExpertScore(expert: Expert): number {
    const total = expert.successCount + expert.failCount;
    const successRate = total > 0 ? expert.successCount / total : 0.5;

    return expert.confidence * 0.4 + successRate * 0.6;
  }
}

/**
 * 专家求解器（组合 Registry + Router）
 */
export class ExpertSolver {
  registry: ExpertRegistry;
  router: ProblemRouter;

  constructor() {
    this.registry = new ExpertRegistry();
    this.router = new ProblemRouter(this.registry);
  }

  /**
   * 注册专家
   */
  registerExpert(expert: Expert): void {
    this.registry.register(expert);
  }

  /**
   * 解决问题
   */
  async solve(problem: Problem): Promise<Solution | null> {
    return this.router.routeProblem(problem);
  }

  /**
   * 评估解决方案
   */
  rateSolution(problemId: string, solutionIndex: number, rating: number): void {
    this.router.rateSolution(problemId, solutionIndex, rating);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    experts: number;
    problems: number;
    solutions: number;
  } {
    return {
      experts: this.registry.getExpertCount(),
      problems: this.router['solutions'].size,
      solutions: Array.from(this.router['solutions'].values()).reduce(
        (sum, sols) => sum + sols.length,
        0
      )
    };
  }
}
