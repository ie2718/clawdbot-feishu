import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  ClawdbotConfig,
  WizardPrompter,
} from "clawdbot/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  promptAccountId,
} from "clawdbot/plugin-sdk";

import {
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
} from "./accounts.js";

const channel = "feishu" as const;

function setFeishuDmPolicy(
  cfg: ClawdbotConfig,
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled",
) {
  const allowFrom = dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.feishu?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...cfg.channels?.feishu,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  } as ClawdbotConfig;
}

async function noteFeishuCredentialsHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Open Feishu Open Platform: https://open.feishu.cn/app",
      "2) Create an enterprise self-built application",
      "3) Add bot capability and configure permissions",
      "4) Get App ID and App Secret from Credentials page",
      "5) Set event subscription to 'Long Connection' (WebSocket)",
      "Tip: you can also set FEISHU_APP_ID and FEISHU_APP_SECRET in your env.",
    ].join("\n"),
    "Feishu app credentials",
  );
}

async function promptFeishuAllowFrom(params: {
  cfg: ClawdbotConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<ClawdbotConfig> {
  const { cfg, prompter, accountId } = params;
  const resolved = resolveFeishuAccount({ cfg, accountId });
  const existingAllowFrom = resolved.config.allowFrom ?? [];
  const entry = await prompter.text({
    message: "Feishu allowFrom (open_id or user_id)",
    placeholder: "ou_xxxxxxxxxx",
    initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "Required";
      // Accept ou_, on_, or alphanumeric user_id
      if (!/^(ou_|on_)?[a-zA-Z0-9]+$/.test(raw)) return "Use a valid Feishu user id";
      return undefined;
    },
  });
  const normalized = String(entry).trim();
  const merged = [
    ...existingAllowFrom.map((item) => String(item).trim()).filter(Boolean),
    normalized,
  ];
  const unique = [...new Set(merged)];

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: {
          ...cfg.channels?.feishu,
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: unique,
        },
      },
    } as ClawdbotConfig;
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...cfg.channels?.feishu,
        enabled: true,
        accounts: {
          ...(cfg.channels?.feishu?.accounts ?? {}),
          [accountId]: {
            ...(cfg.channels?.feishu?.accounts?.[accountId] ?? {}),
            enabled: (cfg.channels?.feishu?.accounts as Record<string, { enabled?: boolean }> | undefined)?.[accountId]?.enabled ?? true,
            dmPolicy: "allowlist",
            allowFrom: unique,
          },
        },
      },
    },
  } as ClawdbotConfig;
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Feishu",
  channel,
  policyKey: "channels.feishu.dmPolicy",
  allowFromKey: "channels.feishu.allowFrom",
  getCurrent: (cfg) => (cfg.channels?.feishu?.dmPolicy ?? "pairing") as "pairing",
  setPolicy: (cfg, policy) => setFeishuDmPolicy(cfg as ClawdbotConfig, policy),
  promptAllowFrom: async ({ cfg, prompter, accountId }) => {
    const id =
      accountId && normalizeAccountId(accountId)
        ? normalizeAccountId(accountId) ?? DEFAULT_ACCOUNT_ID
        : resolveDefaultFeishuAccountId(cfg as ClawdbotConfig);
    return promptFeishuAllowFrom({
      cfg: cfg as ClawdbotConfig,
      prompter,
      accountId: id,
    });
  },
};

export const feishuOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  dmPolicy,
  getStatus: async ({ cfg }) => {
    // Check if credentials are configured in the config file (not just env vars)
    // This ensures the configure prompts are shown even when env vars are set
    const configuredInFile = listFeishuAccountIds(cfg as ClawdbotConfig).some((accountId) => {
      const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId });
      // Only consider configured if credentials are in the config file
      return Boolean(account.config.appId?.trim() && (account.config.appSecret?.trim() || account.config.appSecretFile?.trim()));
    });
    const hasCredentials = listFeishuAccountIds(cfg as ClawdbotConfig).some((accountId) => {
      const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId });
      return Boolean(account.appId && account.appSecret);
    });
    return {
      channel,
      configured: configuredInFile,
      statusLines: [`Feishu: ${hasCredentials ? "configured" : "needs credentials"}`],
      selectionHint: hasCredentials ? "recommended · configured" : "recommended · enterprise-ready",
      quickstartScore: configuredInFile ? 1 : 8,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const feishuOverride = accountOverrides.feishu?.trim();
    const defaultFeishuAccountId = resolveDefaultFeishuAccountId(cfg as ClawdbotConfig);
    let feishuAccountId = feishuOverride
      ? normalizeAccountId(feishuOverride)
      : defaultFeishuAccountId;
    if (shouldPromptAccountIds && !feishuOverride) {
      feishuAccountId = await promptAccountId({
        cfg: cfg as ClawdbotConfig,
        prompter,
        label: "Feishu",
        currentId: feishuAccountId,
        listAccountIds: listFeishuAccountIds,
        defaultAccountId: defaultFeishuAccountId,
      });
    }

    let next = cfg as ClawdbotConfig;
    const resolvedAccount = resolveFeishuAccount({ cfg: next, accountId: feishuAccountId });
    const accountConfigured = Boolean(resolvedAccount.appId && resolvedAccount.appSecret);
    const allowEnv = feishuAccountId === DEFAULT_ACCOUNT_ID;
    const canUseEnv =
      allowEnv &&
      Boolean(process.env.FEISHU_APP_ID?.trim()) &&
      Boolean(process.env.FEISHU_APP_SECRET?.trim());

    let appId: string | null = null;
    let appSecret: string | null = null;

    // Always show credential help for new users
    if (!accountConfigured) {
      await noteFeishuCredentialsHelp(prompter);
    }

    // Determine credential source and prompt accordingly
    const envAppId = process.env.FEISHU_APP_ID?.trim() || "";
    const envAppSecret = process.env.FEISHU_APP_SECRET?.trim() || "";
    const configAppId = resolvedAccount.config.appId?.trim() || "";
    const configAppSecret = resolvedAccount.config.appSecret?.trim() || "";

    if (canUseEnv && !configAppId) {
      // Env vars available and no config - ask if user wants to use env vars
      const keepEnv = await prompter.confirm({
        message: `FEISHU_APP_ID (${envAppId.slice(0, 8)}...) detected. Use env vars?`,
        initialValue: true,
      });
      if (!keepEnv) {
        // User wants to enter custom credentials
        appId = String(
          await prompter.text({
            message: "Enter Feishu App ID",
            placeholder: "cli_xxxxxxxxxx",
            initialValue: envAppId,
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        appSecret = String(
          await prompter.text({
            message: "Enter Feishu App Secret",
            initialValue: envAppSecret,
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
      // If keepEnv is true, appId/appSecret remain null, which means use env vars
    } else {
      // Always prompt for credentials - either no env vars or config already has credentials
      // This ensures prompts are shown even when reinstalling the plugin
      appId = String(
        await prompter.text({
          message: "Enter Feishu App ID",
          placeholder: "cli_xxxxxxxxxx",
          initialValue: configAppId || envAppId || undefined,
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      appSecret = String(
        await prompter.text({
          message: "Enter Feishu App Secret",
          initialValue: configAppSecret || envAppSecret || undefined,
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    // Prompt for DM policy
    const selectedDmPolicy = (await prompter.select({
      message: "Select DM access policy",
      options: [
        { value: "open", label: "open - Anyone can message the bot" },
        { value: "allowlist", label: "allowlist - Only specific users can message" },
        { value: "pairing", label: "pairing - Users need approval to message" },
        { value: "disabled", label: "disabled - Disable DM" },
      ],
      initialValue: resolvedAccount.config.dmPolicy ?? "open",
    })) as "open" | "allowlist" | "pairing" | "disabled";

    // If allowlist is selected, prompt for allowFrom
    let allowFrom: string[] | undefined;
    if (selectedDmPolicy === "allowlist") {
      const existingAllowFrom = resolvedAccount.config.allowFrom ?? [];
      const allowFromInput = String(
        await prompter.text({
          message: "Enter allowed user IDs (comma-separated, e.g., ou_xxx,ou_yyy)",
          placeholder: "ou_xxxxxxxxxx",
          initialValue: existingAllowFrom.length > 0 ? existingAllowFrom.join(",") : undefined,
          validate: (value) => (value?.trim() ? undefined : "Required for allowlist policy"),
        }),
      ).trim();
      allowFrom = allowFromInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // Build the final config
    if (appId && appSecret) {
      if (feishuAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            feishu: {
              ...next.channels?.feishu,
              enabled: true,
              appId,
              appSecret,
              dmPolicy: selectedDmPolicy,
              ...(allowFrom ? { allowFrom } : {}),
            },
          },
        } as ClawdbotConfig;
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            feishu: {
              ...next.channels?.feishu,
              enabled: true,
              accounts: {
                ...(next.channels?.feishu?.accounts ?? {}),
                [feishuAccountId]: {
                  ...(next.channels?.feishu?.accounts?.[feishuAccountId] ?? {}),
                  enabled: true,
                  appId,
                  appSecret,
                  dmPolicy: selectedDmPolicy,
                  ...(allowFrom ? { allowFrom } : {}),
                },
              },
            },
          },
        } as ClawdbotConfig;
      }
    } else {
      // Using env vars - still need to set dmPolicy
      if (feishuAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            feishu: {
              ...next.channels?.feishu,
              enabled: true,
              dmPolicy: selectedDmPolicy,
              ...(allowFrom ? { allowFrom } : {}),
            },
          },
        } as ClawdbotConfig;
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            feishu: {
              ...next.channels?.feishu,
              enabled: true,
              accounts: {
                ...(next.channels?.feishu?.accounts ?? {}),
                [feishuAccountId]: {
                  ...(next.channels?.feishu?.accounts?.[feishuAccountId] ?? {}),
                  enabled: true,
                  dmPolicy: selectedDmPolicy,
                  ...(allowFrom ? { allowFrom } : {}),
                },
              },
            },
          },
        } as ClawdbotConfig;
      }
    }

    // WebSocket mode - no webhook configuration needed

    return { cfg: next, accountId: feishuAccountId };
  },
};
