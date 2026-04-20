/**
 * OpenClaw Plugin SDK Type Declarations
 * 
 * 这些是 OpenClaw 插件 SDK 的类型声明
 * 实际使用时会被 OpenClaw 运行时替换
 */

declare module "openclaw/plugin-sdk/plugin-entry" {
  import { TypeBoxType } from "@sinclair/typebox";
  
  export interface PluginConfig {
    agent_name: string;
    memory?: {
      enabled?: boolean;
      top_k?: number;
      auto_store?: boolean;
    };
    evolution?: {
      enabled?: boolean;
      fractal_thinking?: boolean;
      active_learning?: boolean;
    };
    knowledge?: {
      enabled?: boolean;
      auto_expand?: boolean;
    };
  }
  
  export interface ToolParameter {
    name: string;
    description: string;
    parameters: TypeBoxType;
    execute: (id: string, params: any) => Promise<{
      content: Array<{ type: string; text: string }>;
    }>;
  }
  
  export interface ToolOptions {
    optional?: boolean;
  }
  
  export interface CronJob {
    id: string;
    schedule: string;
    description: string;
    task: () => Promise<void>;
  }
  
  export interface HookResult {
    system_prompt_addition?: string;
    context?: any;
    memories?: any[];
    knowledge?: any[];
    block?: boolean;
    reason?: string;
  }
  
  export interface PluginAPI {
    registerTool(tool: ToolParameter, options?: ToolOptions): void;
    registerHook(
      event: "message_received" | "message_sent" | "before_tool_call",
      handler: (data: any) => Promise<HookResult>
    ): void;
    registerCron(cron: CronJob): void;
    registerHttpRoute(path: string, handler: Function): void;
    registerCli(command: string, handler: Function): void;
  }
  
  export interface PluginEntry {
    id: string;
    name: string;
    description: string;
    register: (api: PluginAPI, config: PluginConfig) => Promise<void>;
  }
  
  export function definePluginEntry(entry: PluginEntry): PluginEntry;
}
