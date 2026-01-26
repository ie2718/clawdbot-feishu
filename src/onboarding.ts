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
      "5) Configure event subscription with your webhook URL",
      "Tip: you can also set FEISHU_APP_ID and FEISHU_APP_SECRET in your env.",
      "Docs: https://docs.clawd.bot/channels/feishu",
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
            enabled: cfg.channels?.feishu?.accounts?.[accountId]?.enabled ?? true,
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
    const configured = listFeishuAccountIds(cfg as ClawdbotConfig).some((accountId) => {
      const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId });
      return Boolean(account.appId && account.appSecret);
    });
    return {
      channel,
      configured,
      statusLines: [`Feishu: ${configured ? "configured" : "needs credentials"}`],
      selectionHint: configured ? "recommended · configured" : "recommended · enterprise-ready",
      quickstartScore: configured ? 1 : 8,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds, forceAllowFrom }) => {
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
    const hasConfigCredentials = Boolean(
      resolvedAccount.config.appId && (resolvedAccount.config.appSecret || resolvedAccount.config.appSecretFile),
    );

    let appId: string | null = null;
    let appSecret: string | null = null;

    if (!accountConfigured) {
      await noteFeishuCredentialsHelp(prompter);
    }
    if (canUseEnv && !resolvedAccount.config.appId) {
      const keepEnv = await prompter.confirm({
        message: "FEISHU_APP_ID/FEISHU_APP_SECRET detected. Use env vars?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            feishu: {
              ...next.channels?.feishu,
              enabled: true,
            },
          },
        } as ClawdbotConfig;
      } else {
        appId = String(
          await prompter.text({
            message: "Enter Feishu App ID",
            placeholder: "cli_xxxxxxxxxx",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        appSecret = String(
          await prompter.text({
            message: "Enter Feishu App Secret",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else if (hasConfigCredentials) {
      const keep = await prompter.confirm({
        message: "Feishu credentials already configured. Keep them?",
        initialValue: true,
      });
      if (!keep) {
        appId = String(
          await prompter.text({
            message: "Enter Feishu App ID",
            placeholder: "cli_xxxxxxxxxx",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        appSecret = String(
          await prompter.text({
            message: "Enter Feishu App Secret",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else {
      appId = String(
        await prompter.text({
          message: "Enter Feishu App ID",
          placeholder: "cli_xxxxxxxxxx",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      appSecret = String(
        await prompter.text({
          message: "Enter Feishu App Secret",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

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
                },
              },
            },
          },
        } as ClawdbotConfig;
      }
    }

    // Prompt for webhook configuration
    const wantsWebhook = await prompter.confirm({
      message: "Configure webhook settings? (needed for receiving messages)",
      initialValue: true,
    });
    if (wantsWebhook) {
      const encryptKey = String(
        await prompter.text({
          message: "Encrypt Key (from Events and Callbacks page, optional)",
          placeholder: "Leave empty if not using encryption",
        }),
      ).trim();
      const verificationToken = String(
        await prompter.text({
          message: "Verification Token (from Events and Callbacks page)",
          validate: (value) => (value?.trim() ? undefined : "Required for webhook verification"),
        }),
      ).trim();
      const webhookPath = String(
        await prompter.text({
          message: "Webhook path on gateway",
          initialValue: "/feishu/callback",
        }),
      ).trim();

      if (feishuAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            feishu: {
              ...next.channels?.feishu,
              ...(encryptKey ? { encryptKey } : {}),
              ...(verificationToken ? { verificationToken } : {}),
              ...(webhookPath ? { webhookPath } : {}),
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
              accounts: {
                ...(next.channels?.feishu?.accounts ?? {}),
                [feishuAccountId]: {
                  ...(next.channels?.feishu?.accounts?.[feishuAccountId] ?? {}),
                  ...(encryptKey ? { encryptKey } : {}),
                  ...(verificationToken ? { verificationToken } : {}),
                  ...(webhookPath ? { webhookPath } : {}),
                },
              },
            },
          },
        } as ClawdbotConfig;
      }
    }

    if (forceAllowFrom) {
      next = await promptFeishuAllowFrom({
        cfg: next,
        prompter,
        accountId: feishuAccountId,
      });
    }

    return { cfg: next, accountId: feishuAccountId };
  },
};
