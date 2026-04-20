/**
 * 因果推理引擎
 * 
 * 贝叶斯网络、因果发现、反事实推理
 */

export interface CausalNode {
  id: string;
  states: string[];
  parents: string[];
  cpt: Record<string, Record<string, number>>; // 条件概率表
}

export interface CausalEdge {
  from: string;
  to: string;
  strength: number;
}

export interface Evidence {
  [nodeId: string]: string;
}

export interface InferenceResult {
  [nodeId: string]: Record<string, number>;
}

export class BayesianNetwork {
  nodes: Map<string, CausalNode>;
  edges: CausalEdge[];

  constructor() {
    this.nodes = new Map();
    this.edges = [];
  }

  /**
   * 添加节点
   */
  addNode(nodeId: string, states: string[]): void {
    this.nodes.set(nodeId, {
      id: nodeId,
      states,
      parents: [],
      cpt: {}
    });
  }

  /**
   * 添加因果边
   */
  addEdge(fromNode: string, toNode: string, strength: number = 1.0): boolean {
    const from = this.nodes.get(fromNode);
    const to = this.nodes.get(toNode);

    if (!from || !to) return false;

    this.edges.push({ from: fromNode, to: toNode, strength });
    to.parents.push(fromNode);

    console.log(`[BayesianNetwork] Added edge: ${fromNode} -> ${toNode}`);
    return true;
  }

  /**
   * 设置条件概率
   */
  setConditionalProbability(
    nodeId: string,
    parentConfig: Record<string, string>,
    probabilities: Record<string, number>
  ): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const key = JSON.stringify(parentConfig, Object.keys(parentConfig).sort());
    node.cpt[key] = probabilities;
  }

  /**
   * 贝叶斯推断
   */
  infer(evidence: Evidence): InferenceResult {
    const posterior: InferenceResult = {};

    for (const [nodeId, node] of this.nodes) {
      if (evidence[nodeId]) {
        // 观察到的节点
        posterior[nodeId] = {};
        for (const state of node.states) {
          posterior[nodeId][state] = state === evidence[nodeId] ? 1.0 : 0.0;
        }
      } else {
        // 未观察到的节点，基于父节点计算
        posterior[nodeId] = this.calculatePosterior(nodeId, evidence, posterior);
      }
    }

    return posterior;
  }

  /**
   * 计算后验概率
   */
  private calculatePosterior(
    nodeId: string,
    evidence: Evidence,
    posterior: InferenceResult
  ): Record<string, number> {
    const node = this.nodes.get(nodeId);
    if (!node) return {};

    // 如果没有父节点，返回均匀分布
    if (node.parents.length === 0) {
      const uniform: Record<string, number> = {};
      for (const state of node.states) {
        uniform[state] = 1.0 / node.states.length;
      }
      return uniform;
    }

    // 获取父节点状态
    const parentStates: Record<string, string> = {};
    for (const parentId of node.parents) {
      parentStates[parentId] = evidence[parentId] || this.mostLikelyState(parentId, posterior);
    }

    // 查找条件概率
    const key = JSON.stringify(parentStates, Object.keys(parentStates).sort());
    const cpt = node.cpt[key];

    if (cpt) {
      return { ...cpt };
    }

    // 如果没有匹配的 CPT，返回均匀分布
    const uniform: Record<string, number> = {};
    for (const state of node.states) {
      uniform[state] = 1.0 / node.states.length;
    }
    return uniform;
  }

  /**
   * 获取最可能的状态
   */
  private mostLikelyState(nodeId: string, posterior: InferenceResult): string {
    const probs = posterior[nodeId];
    if (!probs) return '';

    let maxProb = 0;
    let maxState = '';

    for (const [state, prob] of Object.entries(probs)) {
      if (prob > maxProb) {
        maxProb = prob;
        maxState = state;
      }
    }

    return maxState;
  }

  /**
   * 反事实推理
   */
  counterfactual(evidence: Evidence, intervention: Evidence): InferenceResult {
    // 应用干预（do-算子）
    const intervenedEvidence = { ...evidence, ...intervention };
    return this.infer(intervenedEvidence);
  }

  /**
   * 发现因果关系（简单实现：基于共现）
   */
  discoverCausalRelationships(
    observations: Array<Record<string, string>>,
    threshold: number = 0.7
  ): CausalEdge[] {
    const nodeIds = Array.from(this.nodes.keys());
    const discoveredEdges: CausalEdge[] = [];

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = 0; j < nodeIds.length; j++) {
        if (i === j) continue;

        const cause = nodeIds[i];
        const effect = nodeIds[j];

        // 计算条件概率 P(effect | cause)
        const causeEffectCount = observations.filter(
          o => o[cause] && o[effect]
        ).length;
        const causeCount = observations.filter(o => o[cause]).length;

        if (causeCount > 0) {
          const probability = causeEffectCount / causeCount;
          if (probability >= threshold) {
            discoveredEdges.push({
              from: cause,
              to: effect,
              strength: probability
            });
          }
        }
      }
    }

    return discoveredEdges;
  }

  /**
   * 获取网络结构
   */
  getStructure(): { nodes: string[]; edges: CausalEdge[] } {
    return {
      nodes: Array.from(this.nodes.keys()),
      edges: this.edges
    };
  }
}

/**
 * 因果推理引擎
 */
export class CausalReasoningEngine {
  private networks: Map<string, BayesianNetwork>;

  constructor() {
    this.networks = new Map();
  }

  /**
   * 创建因果网络
   */
  createNetwork(id: string): BayesianNetwork {
    const network = new BayesianNetwork();
    this.networks.set(id, network);
    console.log(`[CausalReasoning] Created network: ${id}`);
    return network;
  }

  /**
   * 获取因果网络
   */
  getNetwork(id: string): BayesianNetwork | undefined {
    return this.networks.get(id);
  }

  /**
   * 执行因果推断
   */
  infer(networkId: string, evidence: Evidence): InferenceResult | null {
    const network = this.networks.get(networkId);
    if (!network) return null;

    return network.infer(evidence);
  }

  /**
   * 执行反事实推理
   */
  counterfactual(
    networkId: string,
    evidence: Evidence,
    intervention: Evidence
  ): InferenceResult | null {
    const network = this.networks.get(networkId);
    if (!network) return null;

    return network.counterfactual(evidence, intervention);
  }

  /**
   * 发现因果关系
   */
  discoverCausalRelationships(
    networkId: string,
    observations: Array<Record<string, string>>,
    threshold?: number
  ): CausalEdge[] {
    const network = this.networks.get(networkId);
    if (!network) return [];

    return network.discoverCausalRelationships(observations, threshold);
  }

  /**
   * 获取所有网络
   */
  getNetworks(): string[] {
    return Array.from(this.networks.keys());
  }
}
