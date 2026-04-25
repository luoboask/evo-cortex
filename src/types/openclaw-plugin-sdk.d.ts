/**
 * Type declarations for openclaw/plugin-sdk/core
 * This module is provided at runtime by OpenClaw gateway
 */

declare module 'openclaw/plugin-sdk/core' {
  export interface OpenClawPluginApi {
    [key: string]: any;
  }

  export interface OpenClawPluginCliContext {
    [key: string]: any;
  }

  export interface OpenClawPluginToolContext {
    [key: string]: any;
  }

  export function definePlugin(factory: (api: OpenClawPluginApi) => any): any;
}
