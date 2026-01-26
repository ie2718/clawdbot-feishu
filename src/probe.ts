import { getBotInfo, FeishuApiError, type FeishuFetch } from "./api.js";
import type { FeishuBotInfo } from "./types.js";

export type FeishuProbeResult = {
  ok: boolean;
  bot?: FeishuBotInfo;
  error?: string;
  elapsedMs: number;
};

/**
 * Probe Feishu API to verify credentials and get bot info.
 */
export async function probeFeishu(
  appId: string,
  appSecret: string,
  timeoutMs = 5000,
  fetcher?: FeishuFetch,
): Promise<FeishuProbeResult> {
  if (!appId?.trim() || !appSecret?.trim()) {
    return { ok: false, error: "No credentials provided", elapsedMs: 0 };
  }

  const startTime = Date.now();

  try {
    const response = await getBotInfo(appId.trim(), appSecret.trim(), { timeoutMs, fetch: fetcher });
    const elapsedMs = Date.now() - startTime;

    if (response.code === 0 && response.data) {
      return { ok: true, bot: response.data, elapsedMs };
    }

    return { ok: false, error: response.msg ?? "Invalid response from Feishu API", elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;

    if (err instanceof FeishuApiError) {
      return { ok: false, error: err.msg ?? err.message, elapsedMs };
    }

    if (err instanceof Error) {
      if (err.name === "AbortError") {
        return { ok: false, error: `Request timed out after ${timeoutMs}ms`, elapsedMs };
      }
      return { ok: false, error: err.message, elapsedMs };
    }

    return { ok: false, error: String(err), elapsedMs };
  }
}
