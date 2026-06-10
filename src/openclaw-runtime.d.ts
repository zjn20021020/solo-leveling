// Ambient placeholder declarations for OpenClaw peer dependencies. The real types
// are provided by the OpenClaw runtime when the plugin is loaded; locally we only
// need tsc to accept the imports without requiring openclaw to be installed.

declare module "openclaw/plugin-sdk/plugin-entry" {
  export type OpenClawPluginApi = any;
  export type OpenClawPluginConfigSchema = any;
  export function definePluginEntry(def: {
    id: string;
    name: string;
    description: string;
    kind?: string;
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    register: (api: OpenClawPluginApi) => void;
  }): unknown;
}
