/**
 * Type declarations for clawdbot/plugin-sdk module.
 * This file provides TypeScript type definitions for the clawdbot plugin SDK.
 */

declare module "clawdbot/plugin-sdk" {
  // ─────────────────────────────────────────────────────────────────────────────
  // Core Config Types
  // ─────────────────────────────────────────────────────────────────────────────

  export type ClawdbotConfig = {
    channels?: {
      feishu?: {
        enabled?: boolean;
        accounts?: Record<string, unknown>;
        allowFrom?: string[];
        dmPolicy?: string;
        defaultAccount?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    commands?: {
      useAccessGroups?: boolean;
      [key: string]: unknown;
    };
    session?: {
      store?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Plugin API Types
  // ─────────────────────────────────────────────────────────────────────────────

  export type PluginRuntime = {
    logging: {
      shouldLogVerbose(): boolean;
    };
    channel: {
      commands: {
        shouldComputeCommandAuthorized(body: string, cfg: ClawdbotConfig): boolean;
        isControlCommandMessage(body: string, cfg: ClawdbotConfig): boolean;
        resolveCommandAuthorizedFromAuthorizers(params: {
          useAccessGroups: boolean;
          authorizers: Array<{ configured: boolean; allowed: boolean }>;
        }): boolean | undefined;
      };
      pairing: {
        readAllowFromStore(channel: string): Promise<string[]>;
        upsertPairingRequest(params: {
          channel: string;
          id: string;
          meta?: { name?: string };
        }): Promise<{ code: string; created: boolean }>;
        buildPairingReply(params: {
          channel: string;
          idLine: string;
          code: string;
        }): string;
      };
      routing: {
        resolveAgentRoute(params: {
          cfg: ClawdbotConfig;
          channel: string;
          accountId: string;
          peer: { kind: string; id: string };
        }): { agentId: string; sessionKey: string; accountId: string };
      };
      session: {
        resolveStorePath(
          store: string | undefined,
          params: { agentId: string },
        ): string;
        readSessionUpdatedAt(params: {
          storePath: string;
          sessionKey: string;
        }): number | undefined;
        recordInboundSession(params: {
          storePath: string;
          sessionKey: string;
          ctx: Record<string, unknown>;
          onRecordError: (err: unknown) => void;
        }): Promise<void>;
      };
      reply: {
        resolveEnvelopeFormatOptions(cfg: ClawdbotConfig): Record<string, unknown>;
        formatAgentEnvelope(params: {
          channel: string;
          from: string;
          timestamp?: number;
          previousTimestamp?: number;
          envelope: Record<string, unknown>;
          body: string;
        }): string;
        finalizeInboundContext(ctx: Record<string, unknown>): Record<string, unknown>;
        dispatchReplyWithBufferedBlockDispatcher(params: {
          ctx: Record<string, unknown>;
          cfg: ClawdbotConfig;
          dispatcherOptions: {
            deliver: (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }) => Promise<void>;
            onError: (err: unknown, info: { kind: string }) => void;
          };
        }): Promise<void>;
      };
      text: {
        resolveMarkdownTableMode(params: {
          cfg: ClawdbotConfig;
          channel: string;
          accountId: string;
        }): MarkdownTableMode;
        convertMarkdownTables(text: string, mode: MarkdownTableMode): string;
        resolveChunkMode(cfg: ClawdbotConfig, channel: string, accountId: string): string;
        chunkMarkdownTextWithMode(text: string, limit: number, mode: string): string[];
      };
    };
  };

  export type MarkdownTableMode = "code" | "list" | "plain";

  export type ClawdbotPluginApi = {
    runtime: PluginRuntime;
    registerChannel<TAccount = unknown>(params: { plugin: ChannelPlugin<TAccount>; dock: ChannelDock }): void;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Channel Types
  // ─────────────────────────────────────────────────────────────────────────────

  export type ChannelAccountSnapshot = {
    accountId: string;
    name?: string;
    enabled: boolean;
    configured: boolean;
    credentialSource?: string;
    running?: boolean;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
    lastInboundAt?: number | null;
    lastOutboundAt?: number | null;
    probe?: unknown;
    lastProbeAt?: number | null;
    verificationToken?: string;
    webhookPath?: string;
    [key: string]: unknown;
  };

  export type ChannelRuntime = {
    running?: boolean;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
    lastInboundAt?: number | null;
    lastOutboundAt?: number | null;
    log?: (message: string) => void;
    error?: (message: string) => void;
    [key: string]: unknown;
  };

  export type ChannelDock = {
    id: string;
    capabilities: {
      chatTypes: ("direct" | "group")[];
      media?: boolean;
      blockStreaming?: boolean;
    };
    outbound?: {
      textChunkLimit?: number;
    };
    config?: {
      resolveAllowFrom?: (params: { cfg: ClawdbotConfig; accountId: string }) => string[];
      formatAllowFrom?: (params: { allowFrom: string[] }) => string[];
    };
    groups?: {
      resolveRequireMention?: () => boolean;
    };
    threading?: {
      resolveReplyToMode?: () => string;
    };
  };

  export type ChannelPlugin<TAccount> = {
    id: string;
    meta: {
      id: string;
      label: string;
      selectionLabel?: string;
      docsPath?: string;
      docsLabel?: string;
      blurb?: string;
      aliases?: string[];
      order?: number;
      quickstartAllowFrom?: boolean;
    };
    onboarding?: ChannelOnboardingAdapter;
    capabilities: {
      chatTypes: ("direct" | "group")[];
      media?: boolean;
      reactions?: boolean;
      threads?: boolean;
      polls?: boolean;
      nativeCommands?: boolean;
      blockStreaming?: boolean;
    };
    reload?: {
      configPrefixes?: string[];
    };
    config?: {
      listAccountIds?: (cfg: ClawdbotConfig) => string[];
      resolveAccount?: (cfg: ClawdbotConfig, accountId: string) => TAccount;
      defaultAccountId?: (cfg: ClawdbotConfig) => string;
      setAccountEnabled?: (params: { cfg: ClawdbotConfig; accountId: string; enabled: boolean }) => ClawdbotConfig;
      deleteAccount?: (params: { cfg: ClawdbotConfig; accountId: string }) => ClawdbotConfig;
      isConfigured?: (account: TAccount) => boolean;
      describeAccount?: (account: TAccount) => ChannelAccountSnapshot;
      resolveAllowFrom?: (params: { cfg: ClawdbotConfig; accountId: string }) => string[];
      formatAllowFrom?: (params: { allowFrom: string[] }) => string[];
    };
    security?: {
      resolveDmPolicy?: (params: { cfg: ClawdbotConfig; accountId?: string; account: TAccount }) => {
        policy: string;
        allowFrom: string[];
        policyPath: string;
        allowFromPath: string;
        approveHint?: string;
        normalizeEntry?: (raw: string) => string;
      };
    };
    groups?: {
      resolveRequireMention?: () => boolean;
    };
    threading?: {
      resolveReplyToMode?: () => string;
    };
    messaging?: {
      normalizeTarget?: (raw: string) => string | undefined;
      targetResolver?: {
        looksLikeId?: (raw: string) => boolean;
        hint?: string;
      };
    };
    directory?: {
      self?: () => Promise<unknown>;
      listPeers?: (params: {
        cfg: ClawdbotConfig;
        accountId: string;
        query?: string;
        limit?: number;
      }) => Promise<Array<{ kind: string; id: string }>>;
      listGroups?: (params: {
        cfg: ClawdbotConfig;
        accountId: string;
        query?: string;
        limit?: number;
      }) => Promise<Array<{ kind: string; id: string }>>;
    };
    setup?: {
      resolveAccountId?: (params: { accountId: string }) => string;
      applyAccountName?: (params: { cfg: ClawdbotConfig; accountId: string; name?: string }) => ClawdbotConfig;
      validateInput?: (params: { accountId: string; input: Record<string, unknown> }) => string | null;
      applyAccountConfig?: (params: { cfg: ClawdbotConfig; accountId: string; input: Record<string, unknown> }) => ClawdbotConfig;
    };
    pairing?: {
      idLabel?: string;
      normalizeAllowEntry?: (entry: string) => string;
      notifyApproval?: (params: { cfg: ClawdbotConfig; id: string }) => Promise<void>;
    };
    outbound?: {
      deliveryMode?: string;
      chunker?: (text: string, limit: number) => string[];
      chunkerMode?: string;
      textChunkLimit?: number;
      sendText?: (params: {
        to: string;
        text: string;
        accountId?: string;
        cfg: ClawdbotConfig;
      }) => Promise<{
        channel: string;
        ok: boolean;
        messageId: string;
        error?: Error;
      }>;
      sendMedia?: (params: {
        to: string;
        text: string;
        mediaUrl?: string;
        accountId?: string;
        cfg: ClawdbotConfig;
      }) => Promise<{
        channel: string;
        ok: boolean;
        messageId: string;
        error?: Error;
      }>;
    };
    status?: {
      defaultRuntime?: {
        accountId: string;
        running: boolean;
        lastStartAt: number | null;
        lastStopAt: number | null;
        lastError: string | null;
      };
      collectStatusIssues?: (accounts: ChannelAccountSnapshot[]) => ChannelStatusIssue[];
      buildChannelSummary?: (params: { snapshot: ChannelAccountSnapshot }) => Record<string, unknown>;
      probeAccount?: (params: { account: TAccount; timeoutMs?: number }) => Promise<unknown>;
      buildAccountSnapshot?: (params: { account: TAccount; runtime?: ChannelRuntime }) => ChannelAccountSnapshot;
    };
    gateway?: {
      startAccount?: (ctx: {
        account: TAccount;
        accountId: string;
        cfg: ClawdbotConfig;
        runtime: ChannelRuntime;
        abortSignal: AbortSignal;
        log?: { info: (msg: string) => void };
        setStatus: (patch: Record<string, unknown>) => void;
      }) => Promise<{ stop: () => void }>;
    };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Status Types
  // ─────────────────────────────────────────────────────────────────────────────

  export type ChannelStatusIssue = {
    severity?: "error" | "warning" | "info";
    code?: string;
    channel?: string;
    kind?: string;
    message: string;
    fix?: string;
    accountId?: string;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Onboarding Types
  // ─────────────────────────────────────────────────────────────────────────────

  export type WizardPrompter = {
    text(params: {
      message: string;
      placeholder?: string;
      initialValue?: string;
      validate?: (value: string) => string | undefined;
    }): Promise<string>;
    confirm(params: {
      message: string;
      initialValue?: boolean;
    }): Promise<boolean>;
    note(message: string, title?: string): Promise<void>;
    select<T extends string>(params: {
      message: string;
      options: Array<{ value: T; label: string }>;
      initialValue?: T;
    }): Promise<T>;
  };

  export type ChannelOnboardingDmPolicy = {
    label: string;
    channel: string;
    policyKey: string;
    allowFromKey: string;
    getCurrent: (cfg: ClawdbotConfig) => "pairing" | "allowlist" | "open" | "disabled";
    setPolicy: (cfg: ClawdbotConfig, policy: "pairing" | "allowlist" | "open" | "disabled") => ClawdbotConfig;
    promptAllowFrom: (params: {
      cfg: ClawdbotConfig;
      prompter: WizardPrompter;
      accountId?: string;
    }) => Promise<ClawdbotConfig>;
  };

  export type ChannelOnboardingAdapter = {
    channel: string;
    dmPolicy?: ChannelOnboardingDmPolicy;
    getStatus: (params: { cfg: ClawdbotConfig }) => Promise<{
      channel: string;
      configured: boolean;
      statusLines: string[];
      selectionHint?: string;
      quickstartScore?: number;
    }>;
    configure: (params: {
      cfg: ClawdbotConfig;
      prompter: WizardPrompter;
      accountOverrides: Record<string, string | undefined>;
      shouldPromptAccountIds?: boolean;
      forceAllowFrom?: boolean;
    }) => Promise<{ cfg: ClawdbotConfig; accountId: string }>;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper Functions
  // ─────────────────────────────────────────────────────────────────────────────

  export const DEFAULT_ACCOUNT_ID: string;
  export const PAIRING_APPROVED_MESSAGE: string;

  export function normalizeAccountId(accountId?: string | null): string;

  export function emptyPluginConfigSchema(): Record<string, unknown>;

  export function applyAccountNameToChannelSection(params: {
    cfg: ClawdbotConfig;
    channelKey: string;
    accountId: string;
    name?: string;
  }): ClawdbotConfig;

  export function setAccountEnabledInConfigSection(params: {
    cfg: ClawdbotConfig;
    sectionKey: string;
    accountId: string;
    enabled: boolean;
    allowTopLevel?: boolean;
  }): ClawdbotConfig;

  export function deleteAccountFromConfigSection(params: {
    cfg: ClawdbotConfig;
    sectionKey: string;
    accountId: string;
    clearBaseFields?: string[];
  }): ClawdbotConfig;

  export function formatPairingApproveHint(channel: string): string;

  export function migrateBaseNameToDefaultAccount(params: {
    cfg: ClawdbotConfig;
    channelKey: string;
  }): ClawdbotConfig;

  export function addWildcardAllowFrom(allowFrom?: string[]): string[];

  export function promptAccountId(params: {
    cfg: ClawdbotConfig;
    prompter: WizardPrompter;
    label: string;
    currentId: string;
    listAccountIds: (cfg: ClawdbotConfig) => string[];
    defaultAccountId: string;
  }): Promise<string>;
}
