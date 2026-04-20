/**
 * Configuration Validator - 配置验证工具
 * 
 * 提供配置验证和默认值合并功能
 */

import type { MemoryConfig } from "../memory/memory_hub";
import type { KnowledgeConfig } from "../knowledge/knowledge_graph";
import type { EvolutionConfig } from "../evolution/scheduler";

export interface EvoCortexConfig {
  agent_name?: string;  // 已废弃
  verbose?: boolean;
  memory?: Partial<MemoryConfig>;
  knowledge?: Partial<KnowledgeConfig>;
  evolution?: Partial<EvolutionConfig>;
}

export interface ValidatedConfig {
  verbose: boolean;
  memory: MemoryConfig;
  knowledge: KnowledgeConfig;
  evolution: EvolutionConfig;
  warnings: string[];
}

const DEFAULT_CONFIG: ValidatedConfig = {
  verbose: false,
  memory: {
    enabled: true,
    top_k: 5,
    auto_store: true
  },
  knowledge: {
    enabled: true,
    auto_expand: true
  },
  evolution: {
    enabled: true,
    fractal_thinking: true,
    active_learning: true
  },
  warnings: []
};

/**
 * 验证并合并配置
 */
export function validateConfig(input: any): ValidatedConfig {
  const config: ValidatedConfig = {
    ...DEFAULT_CONFIG,
    warnings: []
  };

  if (!input || typeof input !== 'object') {
    return config;
  }

  // 检查废弃字段
  if (input.agent_name) {
    config.warnings.push(
      "'agent_name' is deprecated. The plugin now automatically detects the current agent."
    );
  }

  // 合并 verbose 配置
  if (typeof input.verbose === 'boolean') {
    config.verbose = input.verbose;
  }

  // 合并 memory 配置
  if (input.memory && typeof input.memory === 'object') {
    config.memory = {
      ...config.memory,
      ...validateMemoryConfig(input.memory)
    };
  }

  // 合并 knowledge 配置
  if (input.knowledge && typeof input.knowledge === 'object') {
    config.knowledge = {
      ...config.knowledge,
      ...validateKnowledgeConfig(input.knowledge)
    };
  }

  // 合并 evolution 配置
  if (input.evolution && typeof input.evolution === 'object') {
    config.evolution = {
      ...config.evolution,
      ...validateEvolutionConfig(input.evolution)
    };
  }

  return config;
}

/**
 * 验证记忆配置
 */
function validateMemoryConfig(input: any): Partial<MemoryConfig> {
  const config: Partial<MemoryConfig> = {};

  if (typeof input.enabled === 'boolean') {
    config.enabled = input.enabled;
  }

  if (typeof input.top_k === 'number' && input.top_k > 0 && input.top_k <= 100) {
    config.top_k = input.top_k;
  } else if (input.top_k !== undefined) {
    console.warn(`[Config] Invalid memory.top_k: ${input.top_k}. Must be 1-100.`);
  }

  if (typeof input.auto_store === 'boolean') {
    config.auto_store = input.auto_store;
  }

  return config;
}

/**
 * 验证知识配置
 */
function validateKnowledgeConfig(input: any): Partial<KnowledgeConfig> {
  const config: Partial<KnowledgeConfig> = {};

  if (typeof input.enabled === 'boolean') {
    config.enabled = input.enabled;
  }

  if (typeof input.auto_expand === 'boolean') {
    config.auto_expand = input.auto_expand;
  }

  return config;
}

/**
 * 验证进化配置
 */
function validateEvolutionConfig(input: any): Partial<EvolutionConfig> {
  const config: Partial<EvolutionConfig> = {};

  if (typeof input.enabled === 'boolean') {
    config.enabled = input.enabled;
  }

  if (typeof input.fractal_thinking === 'boolean') {
    config.fractal_thinking = input.fractal_thinking;
  }

  if (typeof input.active_learning === 'boolean') {
    config.active_learning = input.active_learning;
  }

  return config;
}

/**
 * 获取配置摘要（用于日志）
 */
export function getConfigSummary(config: ValidatedConfig): string {
  const parts: string[] = [];
  
  if (config.memory.enabled) parts.push('memory');
  if (config.knowledge.enabled) parts.push('knowledge');
  if (config.evolution.enabled) parts.push('evolution');
  if (config.verbose) parts.push('verbose');
  
  return parts.join(', ') || 'none';
}

/**
 * 检查配置是否有效（无严重错误）
 */
export function isConfigValid(config: ValidatedConfig): boolean {
  // 当前只要没有抛出异常就认为有效
  // 可以添加更多验证逻辑
  return true;
}
