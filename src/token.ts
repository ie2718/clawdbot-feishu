import { existsSync, readFileSync } from "node:fs";

import type { FeishuConfig, FeishuCredentialSource } from "./types.js";

export type FeishuCredentialResolution = {
  appId: string;
  appSecret: string;
  source: FeishuCredentialSource;
};

/**
 * Resolve Feishu app credentials from env, config, or config file.
 * Priority: env > config > configFile.
 */
export function resolveFeishuCredentials(
  config?: FeishuConfig,
  accountId?: string,
): FeishuCredentialResolution {
  // 1. Try environment variables (only for default account)
  const envAppId = process.env.FEISHU_APP_ID?.trim();
  const envAppSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (envAppId && envAppSecret && (!accountId || accountId === "default")) {
    return { appId: envAppId, appSecret: envAppSecret, source: "env" };
  }

  if (!config) {
    return { appId: "", appSecret: "", source: "none" };
  }

  // 2. Get account-specific or base config
  const accountConfig = accountId && config.accounts?.[accountId];
  const effectiveConfig = accountConfig || config;

  // 3. Try direct config values
  const configAppId = effectiveConfig.appId?.trim();
  const configAppSecret = effectiveConfig.appSecret?.trim();
  if (configAppId && configAppSecret) {
    return { appId: configAppId, appSecret: configAppSecret, source: "config" };
  }

  // 4. Try reading from file
  const secretFile = effectiveConfig.appSecretFile?.trim();
  if (configAppId && secretFile) {
    try {
      if (existsSync(secretFile)) {
        const fileSecret = readFileSync(secretFile, "utf8").trim();
        if (fileSecret) {
          return { appId: configAppId, appSecret: fileSecret, source: "configFile" };
        }
      }
    } catch {
      // ignore file read errors
    }
  }

  return { appId: "", appSecret: "", source: "none" };
}

/**
 * Resolve encrypt key for event decryption.
 */
export function resolveFeishuEncryptKey(
  config?: FeishuConfig,
  accountId?: string,
): string {
  // Try environment variable first
  const envKey = process.env.FEISHU_ENCRYPT_KEY?.trim();
  if (envKey && (!accountId || accountId === "default")) {
    return envKey;
  }

  if (!config) return "";

  const accountConfig = accountId && config.accounts?.[accountId];
  const effectiveConfig = accountConfig || config;
  return effectiveConfig.encryptKey?.trim() || "";
}

/**
 * Resolve verification token for webhook validation.
 */
export function resolveFeishuVerificationToken(
  config?: FeishuConfig,
  accountId?: string,
): string {
  // Try environment variable first
  const envToken = process.env.FEISHU_VERIFICATION_TOKEN?.trim();
  if (envToken && (!accountId || accountId === "default")) {
    return envToken;
  }

  if (!config) return "";

  const accountConfig = accountId && config.accounts?.[accountId];
  const effectiveConfig = accountConfig || config;
  return effectiveConfig.verificationToken?.trim() || "";
}
