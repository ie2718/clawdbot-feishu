// Feishu config schema - type-based (no zod for runtime simplicity)
// The config is validated at the plugin-sdk level using the clawdbot.plugin.json schema

export type FeishuGroupConfig = {
  enabled?: boolean;
  name?: string;
  requireMention?: boolean;
  allowFrom?: string[];
};

export type FeishuAccountConfig = {
  name?: string;
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  appSecretFile?: string;
  encryptKey?: string;
  verificationToken?: string;
  webhookPath?: string;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: string[];
  groupPolicy?: "open" | "allowlist";
  groupAllowFrom?: string[];
  groups?: Record<string, FeishuGroupConfig>;
  mediaMaxMb?: number;
};

export type FeishuConfig = FeishuAccountConfig & {
  accounts?: Record<string, FeishuAccountConfig>;
  defaultAccount?: string;
};
