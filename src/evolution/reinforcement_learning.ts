/**
 * 强化学习模块
 * 
 * 简单的 Q-Learning 实现
 */

export interface QLearningConfig {
  learningRate: number;
  discountFactor: number;
  explorationRate: number;
  explorationDecay: number;
  minExplorationRate: number;
}

export interface QLearningResult {
  action: string;
  reward: number;
  totalReward: number;
  episodes: number;
}

export class QLearning {
  private qTable: Map<string, Map<string, number>>;
  private config: QLearningConfig;
  private totalEpisodes: number = 0;
  private totalReward: number = 0;

  constructor(config?: Partial<QLearningConfig>) {
    this.config = {
      learningRate: 0.1,
      discountFactor: 0.9,
      explorationRate: 1.0,
      explorationDecay: 0.995,
      minExplorationRate: 0.01,
      ...config
    };
    this.qTable = new Map();
  }

  /**
   * 选择动作（epsilon-greedy 策略）
   */
  chooseAction(state: string, actions: string[]): string {
    // 探索
    if (Math.random() < this.config.explorationRate) {
      return actions[Math.floor(Math.random() * actions.length)];
    }

    // 利用
    const stateQ = this.qTable.get(state);
    if (!stateQ || stateQ.size === 0) {
      return actions[Math.floor(Math.random() * actions.length)];
    }

    // 选择 Q 值最大的动作
    let bestAction = actions[0];
    let bestQ = -Infinity;

    for (const action of actions) {
      const q = stateQ.get(action) || 0;
      if (q > bestQ) {
        bestQ = q;
        bestAction = action;
      }
    }

    return bestAction;
  }

  /**
   * 更新 Q 值
   */
  update(
    state: string,
    action: string,
    reward: number,
    nextState: string,
    nextActions: string[]
  ): void {
    if (!this.qTable.has(state)) {
      this.qTable.set(state, new Map());
    }
    if (!this.qTable.has(nextState)) {
      this.qTable.set(nextState, new Map());
    }

    const stateQ = this.qTable.get(state)!;
    const nextStateQ = this.qTable.get(nextState)!;

    const currentQ = stateQ.get(action) || 0;
    const maxNextQ = nextActions.length > 0
      ? Math.max(...nextActions.map(a => nextStateQ.get(a) || 0))
      : 0;

    // Q-Learning 更新公式
    const newQ = currentQ + this.config.learningRate * (
      reward + this.config.discountFactor * maxNextQ - currentQ
    );

    stateQ.set(action, newQ);

    // 衰减探索率
    this.config.explorationRate = Math.max(
      this.config.minExplorationRate,
      this.config.explorationRate * this.config.explorationDecay
    );
  }

  /**
   * 训练一个 episode
   */
  trainEpisode(
    state: string,
    actions: string[],
    getReward: (action: string) => number,
    getNextState: (action: string) => string,
    getNextActions: (state: string) => string[]
  ): QLearningResult {
    const action = this.chooseAction(state, actions);
    const reward = getReward(action);
    const nextState = getNextState(action);
    const nextActions = getNextActions(nextState);

    this.update(state, action, reward, nextState, nextActions);

    this.totalEpisodes++;
    this.totalReward += reward;

    return {
      action,
      reward,
      totalReward: this.totalReward,
      episodes: this.totalEpisodes
    };
  }

  /**
   * 获取最优策略
   */
  getOptimalPolicy(state: string, actions: string[]): Map<string, number> {
    const stateQ = this.qTable.get(state);
    if (!stateQ) {
      const policy = new Map<string, number>();
      for (const action of actions) {
        policy.set(action, 1.0 / actions.length);
      }
      return policy;
    }

    // 使用 softmax 策略
    const policy = new Map<string, number>();
    const temperature = 0.1;
    let sumExp = 0;
    const exps: Array<[string, number]> = [];

    for (const action of actions) {
      const q = stateQ.get(action) || 0;
      const exp = Math.exp(q / temperature);
      exps.push([action, exp]);
      sumExp += exp;
    }

    for (const [action, exp] of exps) {
      policy.set(action, exp / sumExp);
    }

    return policy;
  }

  /**
   * 获取 Q 表
   */
  getQTable(): Map<string, Map<string, number>> {
    return this.qTable;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    episodes: number;
    totalReward: number;
    avgReward: number;
    explorationRate: number;
    qTableSize: number;
  } {
    return {
      episodes: this.totalEpisodes,
      totalReward: this.totalReward,
      avgReward: this.totalEpisodes > 0 ? this.totalReward / this.totalEpisodes : 0,
      explorationRate: this.config.explorationRate,
      qTableSize: this.qTable.size
    };
  }

  /**
   * 重置
   */
  reset(): void {
    this.qTable.clear();
    this.totalEpisodes = 0;
    this.totalReward = 0;
    this.config.explorationRate = 1.0;
  }
}

/**
 * 奖励函数工厂
 */
export class RewardFactory {
  /**
   * 知识质量奖励
   */
  static knowledgeQuality(isAccurate: boolean, isTimely: boolean): number {
    let reward = 0;
    if (isAccurate) reward += 1.0;
    if (isTimely) reward += 0.5;
    if (!isAccurate) reward -= 1.0;
    if (!isTimely) reward -= 0.3;
    return reward;
  }

  /**
   * 记忆相关性奖励
   */
  static memoryRelevance(similarity: number): number {
    return similarity * 2 - 1; // 映射到 [-1, 1]
  }

  /**
   * 用户满意度奖励
   */
  static userSatisfaction(satisfied: boolean, responseTime: number): number {
    let reward = satisfied ? 1.0 : -1.0;
    reward -= responseTime * 0.1; // 响应时间惩罚
    return reward;
  }
}
