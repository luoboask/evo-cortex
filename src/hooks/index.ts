/**
 * Hooks - 钩子函数
 * 
 * 当前活跃钩子：
 * - beforeToolCallHook: 工具调用前安全检查
 * 
 * 已移除（死代码）：
 * - messageReceivedHook → 已内联到 index.ts 的 message_received handler
 * - messageSentHook → 功能已整合到 index.ts 的 hook 管线中
 */

import { safeHook, getHookHealthSummary } from "./hook_health";
import type { Logger } from "../utils/logger";

/**
 * 工具调用前钩子：熔断安全检查（记录敏感工具调用，不阻塞）
 */
export async function beforeToolCallHook(
  toolCall: any,
  logger?: Logger
): Promise<Record<string, any>> {
  return safeHook('beforeToolCallHook', () => {
    const toolName = toolCall.name || "";
    const sensitiveTools = ["delete_file", "exec", "send_email", "system.run"];
    if (sensitiveTools.includes(toolName)) {
      logger?.hook('before_tool_call', `Sensitive tool: ${toolName}`);
    }
    return Promise.resolve({ block: false });
  }, { block: false });
}

/**
 * 获取钩子健康状态（供诊断用）
 */
export { getHookHealthSummary };
