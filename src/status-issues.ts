import type { ChannelStatusIssue } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "clawdbot/plugin-sdk";

type FeishuAccountSnapshot = {
  accountId?: string;
  enabled?: boolean;
  configured?: boolean;
  credentialSource?: string;
  verificationToken?: string;
  webhookPath?: string;
};

export function collectFeishuStatusIssues(
  accounts: FeishuAccountSnapshot[],
): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];

  for (const entry of accounts) {
    const accountId = String(entry.accountId ?? DEFAULT_ACCOUNT_ID);
    const enabled = entry.enabled !== false;
    const configured = entry.configured === true;

    if (!enabled) continue;

    if (!configured) {
      issues.push({
        channel: "feishu",
        accountId,
        kind: "config",
        message: "Feishu app credentials are missing.",
        fix: "Set channels.feishu.appId and channels.feishu.appSecret (or use env vars FEISHU_APP_ID/FEISHU_APP_SECRET).",
      });
      continue;
    }

    if (!entry.verificationToken) {
      issues.push({
        channel: "feishu",
        accountId,
        kind: "config",
        message: "Feishu verification token is missing.",
        fix: "Set channels.feishu.verificationToken from the Events and Callbacks page in Feishu Open Platform.",
      });
    }

    if (!entry.webhookPath) {
      issues.push({
        channel: "feishu",
        accountId,
        kind: "config",
        message: "Feishu webhook path is not configured.",
        fix: "Set channels.feishu.webhookPath (default: /feishu/callback).",
      });
    }
  }

  return issues;
}
