/**
 * OpenClaw Plugin API type definition
 * 
 * This is our own definition since OpenClawPluginApi is not exported
 * from the distributed SDK.
 */

export interface PluginTool {
  name: string;
  description: string;
  parameters: any;
  execute: (id: string, params: any) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

export interface PluginHook {
  (data: any): Promise<Record<string, any>>;
}

export interface PluginCron {
  id: string;
  schedule: string;
  task: () => Promise<void>;
}

export interface PluginConfig {
  [key: string]: any;
}

export interface OpenClawPluginApi {
  pluginConfig: PluginConfig;
  registrationMode: "full" | "setup-only" | "setup-runtime" | "cli-metadata";
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  registerTool(tool: PluginTool, options?: { optional?: boolean }): void;
  registerHook(event: string, handler: PluginHook): void;
  registerCron(cron: PluginCron): void;
  registerService(service: any): void;
  registerHttpRoute(route: any): void;
  registerCli(cli: any): void;
  registerCommand(command: any): void;
  on(event: string, handler: Function): void;
}
