/**
 * Feishu Open Platform API client.
 * @see https://open.feishu.cn/document
 */

import type {
  FeishuApiResponse,
  FeishuBotInfo,
  FeishuReceiveIdType,
  FeishuSendMessageParams,
  FeishuSendMessageResponse,
  FeishuTokenResponse,
  FeishuUploadImageResponse,
  FeishuUploadFileResponse,
  FeishuUpdateMessageResponse,
  FeishuImageType,
  FeishuFileType,
} from "./types.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

export type FeishuFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class FeishuApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly msg?: string,
  ) {
    super(message);
    this.name = "FeishuApiError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────────────────────────────────────

type CachedToken = {
  token: string;
  expiresAt: number;
};

// Token cache per app_id
const tokenCache = new Map<string, CachedToken>();

/**
 * Get tenant access token (cached with expiry buffer).
 */
export async function getTenantAccessToken(
  appId: string,
  appSecret: string,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<string> {
  const cacheKey = appId;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();

  // Return cached token if still valid (with 5 minute buffer)
  if (cached && cached.expiresAt > now + 5 * 60 * 1000) {
    return cached.token;
  }

  const url = `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`;
  const controller = new AbortController();
  const timeoutId = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const fetcher = options?.fetch ?? fetch;

  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: controller.signal,
    });

    const data = (await response.json()) as FeishuApiResponse<FeishuTokenResponse> & FeishuTokenResponse;

    // Feishu returns token at top level, not in data
    const token = data.tenant_access_token;
    const expire = data.expire ?? 7200;

    if (!token) {
      throw new FeishuApiError(
        data.msg ?? "Failed to get tenant access token",
        data.code,
        data.msg,
      );
    }

    // Cache the token
    tokenCache.set(cacheKey, {
      token,
      expiresAt: now + expire * 1000,
    });

    return token;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Clear cached token for an app.
 */
export function clearTokenCache(appId: string): void {
  tokenCache.delete(appId);
}

// ─────────────────────────────────────────────────────────────────────────────
// API Calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an authenticated API call to Feishu.
 */
export async function callFeishuApi<T = unknown>(
  endpoint: string,
  token: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    timeoutMs?: number;
    fetch?: FeishuFetch;
  },
): Promise<FeishuApiResponse<T>> {
  let url = `${FEISHU_API_BASE}${endpoint}`;
  if (options?.query) {
    const params = new URLSearchParams(options.query);
    url = `${url}?${params.toString()}`;
  }

  const controller = new AbortController();
  const timeoutId = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const fetcher = options?.fetch ?? fetch;

  try {
    const response = await fetcher(url, {
      method: options?.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const data = (await response.json()) as FeishuApiResponse<T>;

    if (data.code !== 0) {
      throw new FeishuApiError(data.msg ?? `Feishu API error: ${endpoint}`, data.code, data.msg);
    }

    return data;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Get bot info for validation.
 */
export async function getBotInfo(
  appId: string,
  appSecret: string,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<FeishuApiResponse<FeishuBotInfo>> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  return callFeishuApi<FeishuBotInfo>("/bot/v3/info", token, {
    method: "GET",
    timeoutMs: options?.timeoutMs,
    fetch: options?.fetch,
  });
}

/**
 * Send a message to a user or chat.
 */
export async function sendMessage(
  appId: string,
  appSecret: string,
  params: FeishuSendMessageParams,
  receiveIdType: FeishuReceiveIdType = "open_id",
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<FeishuApiResponse<FeishuSendMessageResponse>> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  return callFeishuApi<FeishuSendMessageResponse>("/im/v1/messages", token, {
    method: "POST",
    query: { receive_id_type: receiveIdType },
    body: params as unknown as Record<string, unknown>,
    timeoutMs: options?.timeoutMs,
    fetch: options?.fetch,
  });
}

/**
 * Reply to a message.
 */
export async function replyMessage(
  appId: string,
  appSecret: string,
  messageId: string,
  params: Omit<FeishuSendMessageParams, "receive_id">,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<FeishuApiResponse<FeishuSendMessageResponse>> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  return callFeishuApi<FeishuSendMessageResponse>(`/im/v1/messages/${messageId}/reply`, token, {
    method: "POST",
    body: params as unknown as Record<string, unknown>,
    timeoutMs: options?.timeoutMs,
    fetch: options?.fetch,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Message Support (Update Message Card)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a sent message card (for streaming-like updates).
 * Only works for interactive card messages sent by the bot.
 * @see https://open.feishu.cn/document/server-docs/im-v1/message-card/patch
 */
export async function updateMessageCard(
  appId: string,
  appSecret: string,
  messageId: string,
  content: string,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<FeishuApiResponse<FeishuUpdateMessageResponse>> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  return callFeishuApi<FeishuUpdateMessageResponse>(`/im/v1/messages/${messageId}`, token, {
    method: "PATCH",
    body: { content },
    timeoutMs: options?.timeoutMs,
    fetch: options?.fetch,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Image Upload/Download
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload an image to Feishu.
 * Returns image_key that can be used to send image messages.
 * @see https://open.feishu.cn/document/server-docs/im-v1/image/create
 */
export async function uploadImage(
  appId: string,
  appSecret: string,
  imageData: Buffer | ArrayBuffer | Blob,
  imageType: FeishuImageType = "message",
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<FeishuApiResponse<FeishuUploadImageResponse>> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  const url = `${FEISHU_API_BASE}/im/v1/images`;

  const controller = new AbortController();
  const timeoutId = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const fetcher = options?.fetch ?? fetch;

  try {
    // Create FormData for multipart upload
    const formData = new FormData();
    formData.append("image_type", imageType);

    // Handle different input types
    let blob: Blob;
    if (imageData instanceof Blob) {
      blob = imageData;
    } else if (Buffer.isBuffer(imageData)) {
      blob = new Blob([imageData]);
    } else {
      blob = new Blob([imageData]);
    }
    formData.append("image", blob, "image.png");

    const response = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
      signal: controller.signal,
    });

    const data = (await response.json()) as FeishuApiResponse<FeishuUploadImageResponse>;

    if (data.code !== 0) {
      throw new FeishuApiError(data.msg ?? "Failed to upload image", data.code, data.msg);
    }

    return data;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Download an image from Feishu.
 * @see https://open.feishu.cn/document/server-docs/im-v1/image/get
 */
export async function downloadImage(
  appId: string,
  appSecret: string,
  imageKey: string,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<{ data: ArrayBuffer; contentType?: string }> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  const url = `${FEISHU_API_BASE}/im/v1/images/${imageKey}`;

  const controller = new AbortController();
  const timeoutId = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const fetcher = options?.fetch ?? fetch;

  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new FeishuApiError(`Failed to download image: ${response.status}`, response.status);
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const data = await response.arrayBuffer();

    return { data, contentType };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File Upload/Download
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a file to Feishu.
 * Returns file_key that can be used to send file messages.
 * @see https://open.feishu.cn/document/server-docs/im-v1/file/create
 */
export async function uploadFile(
  appId: string,
  appSecret: string,
  fileData: Buffer | ArrayBuffer | Blob,
  fileName: string,
  fileType: FeishuFileType,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<FeishuApiResponse<FeishuUploadFileResponse>> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  const url = `${FEISHU_API_BASE}/im/v1/files`;

  const controller = new AbortController();
  const timeoutId = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const fetcher = options?.fetch ?? fetch;

  try {
    const formData = new FormData();
    formData.append("file_type", fileType);
    formData.append("file_name", fileName);

    let blob: Blob;
    if (fileData instanceof Blob) {
      blob = fileData;
    } else if (Buffer.isBuffer(fileData)) {
      blob = new Blob([fileData]);
    } else {
      blob = new Blob([fileData]);
    }
    formData.append("file", blob, fileName);

    const response = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
      signal: controller.signal,
    });

    const data = (await response.json()) as FeishuApiResponse<FeishuUploadFileResponse>;

    if (data.code !== 0) {
      throw new FeishuApiError(data.msg ?? "Failed to upload file", data.code, data.msg);
    }

    return data;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Download a file from Feishu.
 * @see https://open.feishu.cn/document/server-docs/im-v1/file/get
 */
export async function downloadFile(
  appId: string,
  appSecret: string,
  fileKey: string,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<{ data: ArrayBuffer; contentType?: string; fileName?: string }> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  const url = `${FEISHU_API_BASE}/im/v1/files/${fileKey}`;

  const controller = new AbortController();
  const timeoutId = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const fetcher = options?.fetch ?? fetch;

  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new FeishuApiError(`Failed to download file: ${response.status}`, response.status);
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    const fileNameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\s]+)/i);
    const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : undefined;
    const data = await response.arrayBuffer();

    return { data, contentType, fileName };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Get message content by message ID.
 * Useful for retrieving image/file keys from received messages.
 * @see https://open.feishu.cn/document/server-docs/im-v1/message/get
 */
export async function getMessage(
  appId: string,
  appSecret: string,
  messageId: string,
  options?: { timeoutMs?: number; fetch?: FeishuFetch },
): Promise<FeishuApiResponse<FeishuSendMessageResponse>> {
  const token = await getTenantAccessToken(appId, appSecret, options);
  return callFeishuApi<FeishuSendMessageResponse>(`/im/v1/messages/${messageId}`, token, {
    method: "GET",
    timeoutMs: options?.timeoutMs,
    fetch: options?.fetch,
  });
}
