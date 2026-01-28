import type {
  ChannelAccountSnapshot,
  ChannelDock,
  ChannelPlugin,
  ClawdbotConfig,
} from "clawdbot/plugin-sdk";
import {
  applyAccountNameToChannelSection,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
} from "clawdbot/plugin-sdk";

import {
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
  type ResolvedFeishuAccount,
} from "./accounts.js";
import { feishuOnboardingAdapter } from "./onboarding.js";
import { probeFeishu } from "./probe.js";
import { sendMessageFeishu } from "./send.js";
import { collectFeishuStatusIssues } from "./status-issues.js";

const meta = {
  id: "feishu",
  label: "Feishu",
  selectionLabel: "Feishu (飞书)",
  docsPath: "/channels/feishu",
  docsLabel: "feishu",
  blurb: "Enterprise messaging platform with Bot API.",
  aliases: ["lark", "fs"],
  order: 81,
  quickstartAllowFrom: true,
};

function normalizeFeishuMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(feishu|lark|fs):/i, "");
}

export const feishuDock: ChannelDock = {
  id: "feishu",
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 4000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }: { cfg: ClawdbotConfig; accountId: string }) =>
      (resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId }).config.allowFrom ?? []).map(
        (entry: string) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }: { allowFrom: string[] }) =>
      allowFrom
        .map((entry: string) => String(entry).trim())
        .filter(Boolean)
        .map((entry: string) => entry.replace(/^(feishu|lark|fs):/i, ""))
        .map((entry: string) => entry.toLowerCase()),
  },
  groups: {
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const feishuPlugin: ChannelPlugin<ResolvedFeishuAccount> = {
  id: "feishu",
  meta,
  onboarding: feishuOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.feishu"] },
  config: {
    listAccountIds: (cfg) => listFeishuAccountIds(cfg as ClawdbotConfig),
    resolveAccount: (cfg, accountId) =>
      resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultFeishuAccountId(cfg as ClawdbotConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as ClawdbotConfig,
        sectionKey: "feishu",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as ClawdbotConfig,
        sectionKey: "feishu",
        accountId,
        clearBaseFields: ["appId", "appSecret", "appSecretFile", "encryptKey", "verificationToken", "name"],
      }),
    isConfigured: (account) => Boolean(account.appId?.trim() && account.appSecret?.trim()),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.appId?.trim() && account.appSecret?.trim()),
      credentialSource: account.credentialSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }: { cfg: ClawdbotConfig; accountId: string }) =>
      (resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId }).config.allowFrom ?? []).map(
        (entry: string) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }: { allowFrom: string[] }) =>
      allowFrom
        .map((entry: string) => String(entry).trim())
        .filter(Boolean)
        .map((entry: string) => entry.replace(/^(feishu|lark|fs):/i, ""))
        .map((entry: string) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg as ClawdbotConfig).channels?.feishu?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.feishu.accounts.${resolvedAccountId}.`
        : "channels.feishu.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("feishu"),
        normalizeEntry: (raw) => raw.replace(/^(feishu|lark|fs):/i, ""),
      };
    },
  },
  groups: {
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeFeishuMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        // Feishu IDs: oc_ (chat), ou_ (open_id), on_ (union_id)
        return /^(oc_|ou_|on_)[a-zA-Z0-9]+$/.test(trimmed);
      },
      hint: "<open_id|user_id|chat_id>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }: {
      cfg: ClawdbotConfig;
      accountId: string;
      query?: string;
      limit?: number;
    }) => {
      const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId });
      const q = query?.trim().toLowerCase() || "";
      const peers: Array<{ kind: string; id: string }> = Array.from(
        new Set(
          (account.config.allowFrom ?? [])
            .map((entry: string) => String(entry).trim())
            .filter((entry: string) => Boolean(entry) && entry !== "*")
            .map((entry: string) => entry.replace(/^(feishu|lark|fs):/i, "")),
        ),
      )
        .filter((id: string) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id: string) => ({ kind: "user" as string, id }));
      return peers;
    },
    listGroups: async ({ cfg, accountId, query, limit }: {
      cfg: ClawdbotConfig;
      accountId: string;
      query?: string;
      limit?: number;
    }) => {
      const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId });
      const groups = account.config.groups ?? {};
      const q = query?.trim().toLowerCase() || "";
      const entries: Array<{ kind: string; id: string }> = Object.keys(groups)
        .filter((key: string) => key && key !== "*")
        .filter((key: string) => (q ? key.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id: string) => ({ kind: "group" as string, id }));
      return entries;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: "feishu",
        accountId,
        name,
      }),
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return "FEISHU_APP_ID/FEISHU_APP_SECRET can only be used for the default account.";
      }
      if (!input.useEnv && !input.appId) {
        return "Feishu requires appId (or --use-env).";
      }
      if (!input.useEnv && !input.appSecret && !input.appSecretFile) {
        return "Feishu requires appSecret or --secret-file (or --use-env).";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }: {
      cfg: ClawdbotConfig;
      accountId: string;
      input: Record<string, unknown>;
    }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: "feishu",
        accountId,
        name: input.name as string | undefined,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig,
              channelKey: "feishu",
            })
          : namedConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            feishu: {
              ...next.channels?.feishu,
              enabled: true,
              ...(input.useEnv
                ? {}
                : input.appSecretFile
                  ? { appId: input.appId, appSecretFile: input.appSecretFile }
                  : input.appSecret
                    ? { appId: input.appId, appSecret: input.appSecret }
                    : {}),
              ...(input.encryptKey ? { encryptKey: input.encryptKey } : {}),
              ...(input.verificationToken ? { verificationToken: input.verificationToken } : {}),
              ...(input.webhookPath ? { webhookPath: input.webhookPath } : {}),
            },
          },
        } as ClawdbotConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          feishu: {
            ...next.channels?.feishu,
            enabled: true,
            accounts: {
              ...(next.channels?.feishu?.accounts ?? {}),
              [accountId]: {
                ...(next.channels?.feishu?.accounts?.[accountId] ?? {}),
                enabled: true,
                ...(input.appSecretFile
                  ? { appId: input.appId, appSecretFile: input.appSecretFile }
                  : input.appSecret
                    ? { appId: input.appId, appSecret: input.appSecret }
                    : {}),
                ...(input.encryptKey ? { encryptKey: input.encryptKey } : {}),
                ...(input.verificationToken ? { verificationToken: input.verificationToken } : {}),
                ...(input.webhookPath ? { webhookPath: input.webhookPath } : {}),
              },
            },
          },
        },
      } as ClawdbotConfig;
    },
  },
  pairing: {
    idLabel: "feishuUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(feishu|lark|fs):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig });
      if (!account.appId || !account.appSecret) throw new Error("Feishu credentials not configured");
      await sendMessageFeishu(id, PAIRING_APPROVED_MESSAGE, {
        appId: account.appId,
        appSecret: account.appSecret,
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      if (!text) return [];
      if (limit <= 0 || text.length <= limit) return [text];
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > limit) {
        const window = remaining.slice(0, limit);
        const lastNewline = window.lastIndexOf("\n");
        const lastSpace = window.lastIndexOf(" ");
        let breakIdx = lastNewline > 0 ? lastNewline : lastSpace;
        if (breakIdx <= 0) breakIdx = limit;
        const rawChunk = remaining.slice(0, breakIdx);
        const chunk = rawChunk.trimEnd();
        if (chunk.length > 0) chunks.push(chunk);
        const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
        const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
        remaining = remaining.slice(nextStart).trimStart();
      }
      if (remaining.length) chunks.push(remaining);
      return chunks;
    },
    chunkerMode: "text",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const result = await sendMessageFeishu(to, text, {
        accountId: accountId ?? undefined,
        cfg: cfg as ClawdbotConfig,
      });
      return {
        channel: "feishu",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      // For now, just send text with media URL as link
      // Full media upload requires /im/v1/images endpoint
      const messageText = mediaUrl ? `${text}\n\n${mediaUrl}` : text;
      const result = await sendMessageFeishu(to, messageText, {
        accountId: accountId ?? undefined,
        cfg: cfg as ClawdbotConfig,
      });
      return {
        channel: "feishu",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: collectFeishuStatusIssues,
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      credentialSource: snapshot.credentialSource ?? "none",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) =>
      probeFeishu(account.appId, account.appSecret, timeoutMs),
    buildAccountSnapshot: ({ account, runtime }: {
      account: ResolvedFeishuAccount;
      runtime?: { running?: boolean; lastStartAt?: number | null; lastStopAt?: number | null; lastError?: string | null; lastInboundAt?: number | null; lastOutboundAt?: number | null };
    }) => {
      const configured = Boolean(account.appId?.trim() && account.appSecret?.trim());
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        credentialSource: account.credentialSource,
        verificationToken: account.config.verificationToken ?? undefined,
        webhookPath: account.config.webhookPath ?? undefined,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.config.dmPolicy ?? "pairing",
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      let feishuBotLabel = "";
      try {
        const probe = await probeFeishu(account.appId, account.appSecret, 2500);
        const name = probe.ok ? probe.bot?.app_name?.trim() : null;
        if (name) feishuBotLabel = ` (${name})`;
        ctx.setStatus({
          accountId: account.accountId,
          bot: probe.bot,
        });
      } catch {
        // ignore probe errors
      }
      ctx.log?.info(`[${account.accountId}] starting provider${feishuBotLabel}`);
      const { monitorFeishuProvider } = await import("./monitor.js");
      return monitorFeishuProvider({
        account,
        config: ctx.cfg as ClawdbotConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        webhookPath: account.config.webhookPath,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
  },
};
