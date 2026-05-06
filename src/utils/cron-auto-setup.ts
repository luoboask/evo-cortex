/**
 * Cron Auto-Setup Utility
 * 
 * 在插件首次加载时检查并提示用户配置定时任务
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from './logger';

const logger = getLogger({ component: 'CronAutoSetup' });

const CRON_SETUP_MARKER = '.evo-cortex-crons-configured';

export interface CronDefinition {
  id: string;
  schedule: string;
  description: string;
  message: string;
}

// 从 openclaw.plugin.json 读取推荐的 cron 配置
export const RECOMMENDED_CRONS: CronDefinition[] = [
  {
    id: 'hourly-fractal',
    schedule: '0 * * * *',
    description: '每小时分形思考',
    message: '请运行分形思考，分析对话模式，生成元规则'
  },
  {
    id: 'daily-review',
    schedule: '0 9 * * *',
    description: '每日知识审查',
    message: '请审查知识图谱，优化知识结构'
  },
  {
    id: 'active-learning',
    schedule: '0 4 * * *',
    description: '每日主动学习',
    message: '请检测学习机会，识别知识缺口'
  }
];

/**
 * 检查是否已配置定时任务
 */
export function isCronConfigured(workspaceDir: string): boolean {
  const markerPath = path.join(workspaceDir, CRON_SETUP_MARKER);
  return fs.existsSync(markerPath);
}

/**
 * 标记已配置定时任务
 */
export function markAsConfigured(workspaceDir: string): void {
  const markerPath = path.join(workspaceDir, CRON_SETUP_MARKER);
  fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
}

/**
 * 获取配置提示信息
 */
export function getSetupPrompt(agentId: string): string {
  return `
╔═══════════════════════════════════════════════════════════╗
║  🧬 Evo-Cortex: 定时任务未配置                            ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  检测到您首次启用 Evo-Cortex 插件，但尚未配置定时任务。   ║
║                                                           ║
║  为了启用完整的自进化能力，请运行以下命令：               ║
║                                                           ║
║  bash ~/.openclaw/extensions/evo-cortex/scripts/          ║
║         setup-crons.sh ${agentId.padEnd(20)} ║
║                                                           ║
║  这将为您配置：                                           ║
║  • 每小时分形思考（生成元规则）                           ║
║  • 每日知识审查（优化知识结构）                           ║
║  • 每日主动学习（检测学习机会）                           ║
║                                                           ║
║  如果不想自动配置，可以忽略此消息。                       ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`.trim();
}

/**
 * 检查并显示配置提示（仅在首次加载时）
 */
export function checkAndPrompt(workspaceDir: string, agentId: string): void {
  if (!isCronConfigured(workspaceDir)) {
    logger.info(getSetupPrompt(agentId));
    logger.info('此消息只会显示一次。');
  }
}

/**
 * 自动生成安装脚本的说明文档
 */
export function generateReadmeSection(): string {
  return `
## ⚙️ 自动配置定时任务

Evo-Cortex 需要定时任务来执行进化功能。首次启用时会自动提示配置。

### 手动配置

\`\`\`bash
# 为指定 agent 配置所有必要的定时任务
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons.sh <agent-id>

# 示例
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons.sh main
\`\`\`

### 配置的任务

- **hourly-fractal** - 每小时分形思考，生成元规则
- **daily-review** - 每日知识审查，优化知识结构  
- **active-learning** - 每日主动学习，检测知识缺口
- **weekly-compress** - 每周记忆压缩（可选）
- **monthly-cycle** - 每月进化周期（可选）

### 验证配置

\`\`\`bash
# 查看任务列表
openclaw cron list | grep <agent-id>

# 手动触发测试
openclaw cron run <task-id>
\`\`\`
`.trim();
}
