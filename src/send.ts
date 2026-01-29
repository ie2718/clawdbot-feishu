import type { ClawdbotConfig } from "clawdbot/plugin-sdk";

import { resolveFeishuAccount } from "./accounts.js";
import { 
  sendMessage, 
  replyMessage, 
  uploadImage, 
  downloadImage, 
  uploadFile, 
  downloadFile,
  type FeishuFetch,
} from "./api.js";
import type { FeishuReceiveIdType, FeishuImageType, FeishuFileType } from "./types.js";

export type FeishuSendOptions = {
  appId?: string;
  appSecret?: string;
  accountId?: string;
  cfg?: ClawdbotConfig;
  receiveIdType?: FeishuReceiveIdType;
  replyToMessageId?: string;
  /** Sender's user ID (open_id, user_id, or union_id) to @mention when replying */
  mentionUserId?: string;
  mediaUrl?: string;
  verbose?: boolean;
  fetch?: FeishuFetch;
};

export type FeishuSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

function resolveSendContext(options: FeishuSendOptions): {
  appId: string;
  appSecret: string;
  fetcher?: FeishuFetch;
} {
  if (options.cfg) {
    const account = resolveFeishuAccount({
      cfg: options.cfg,
      accountId: options.accountId,
    });
    const appId = options.appId || account.appId;
    const appSecret = options.appSecret || account.appSecret;
    return { appId, appSecret, fetcher: options.fetch };
  }

  const appId = options.appId ?? "";
  const appSecret = options.appSecret ?? "";
  return { appId, appSecret, fetcher: options.fetch };
}

/**
 * Normalize a Feishu target by stripping channel prefix.
 * Handles targets like "feishu:oc_xxx", "lark:ou_xxx", "fs:xxx"
 */
function normalizeTarget(target: string): string {
  return target.trim().replace(/^(feishu|lark|fs):/i, "");
}

/**
 * Determine the receive_id_type based on the target format.
 */
function inferReceiveIdType(target: string): FeishuReceiveIdType {
  const trimmed = normalizeTarget(target);
  // chat_id starts with "oc_"
  if (trimmed.startsWith("oc_")) return "chat_id";
  // open_id starts with "ou_"
  if (trimmed.startsWith("ou_")) return "open_id";
  // union_id starts with "on_"
  if (trimmed.startsWith("on_")) return "union_id";
  // user_id is typically numeric or alphanumeric
  if (/^[a-zA-Z0-9]+$/.test(trimmed) && !trimmed.includes("@")) return "user_id";
  // email contains @
  if (trimmed.includes("@")) return "email";
  // default to open_id
  return "open_id";
}

/**
 * Build a Feishu interactive card with markdown content.
 * Card messages support rich markdown formatting in Feishu.
 * @param content - The markdown content to display
 * @param mentionUserId - Optional user ID to @mention at the beginning of the message
 */
function buildMarkdownCard(content: string, mentionUserId?: string): string {
  // Build the markdown content with optional @mention
  // Feishu @mention syntax: <at id=user_id></at>
  let markdownContent = content;
  if (mentionUserId?.trim()) {
    // Add @mention at the beginning of the message
    markdownContent = `<at id=${mentionUserId}></at> ${content}`;
  }

  const card = {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: "markdown",
        content: markdownContent,
      },
    ],
  };
  return JSON.stringify(card);
}

/**
 * Send a message to a Feishu user or chat.
 * Uses interactive card format for markdown support.
 */
export async function sendMessageFeishu(
  to: string,
  text: string,
  options: FeishuSendOptions = {},
): Promise<FeishuSendResult> {
  const { appId, appSecret, fetcher } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Feishu app credentials configured" };
  }

  if (!to?.trim()) {
    return { ok: false, error: "No recipient provided" };
  }

  const normalizedTo = normalizeTarget(to);
  const receiveIdType = options.receiveIdType ?? inferReceiveIdType(normalizedTo);

  // Build interactive card message content for markdown support
  // Include @mention when replying to a specific message
  const content = buildMarkdownCard(text, options.replyToMessageId ? options.mentionUserId : undefined);

  try {
    // If replying to a specific message
    if (options.replyToMessageId) {
      const response = await replyMessage(
        appId,
        appSecret,
        options.replyToMessageId,
        { msg_type: "interactive", content },
        { fetch: fetcher },
      );

      if (response.code === 0 && response.data) {
        return { ok: true, messageId: response.data.message_id };
      }
      return { ok: false, error: response.msg ?? "Failed to reply" };
    }

    // Send new message as interactive card
    const response = await sendMessage(
      appId,
      appSecret,
      { receive_id: normalizedTo, msg_type: "interactive", content },
      receiveIdType,
      { fetch: fetcher },
    );

    if (response.code === 0 && response.data) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: response.msg ?? "Failed to send message" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send an image message to a Feishu user or chat.
 * Note: Requires uploading image first via /im/v1/images, then sending with image_key.
 * For simplicity, this currently only supports image_key (pre-uploaded images).
 */
export async function sendImageFeishu(
  to: string,
  imageKey: string,
  options: FeishuSendOptions = {},
): Promise<FeishuSendResult> {
  const { appId, appSecret, fetcher } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Feishu app credentials configured" };
  }

  if (!to?.trim()) {
    return { ok: false, error: "No recipient provided" };
  }

  if (!imageKey?.trim()) {
    return { ok: false, error: "No image key provided" };
  }

  const normalizedTo = normalizeTarget(to);
  const receiveIdType = options.receiveIdType ?? inferReceiveIdType(normalizedTo);
  const content = JSON.stringify({ image_key: imageKey.trim() });

  try {
    const response = await sendMessage(
      appId,
      appSecret,
      { receive_id: normalizedTo, msg_type: "image", content },
      receiveIdType,
      { fetch: fetcher },
    );

    if (response.code === 0 && response.data) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: response.msg ?? "Failed to send image" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Image Upload/Download
// ─────────────────────────────────────────────────────────────────────────────

export type FeishuUploadResult = {
  ok: boolean;
  imageKey?: string;
  fileKey?: string;
  error?: string;
};

export type FeishuDownloadResult = {
  ok: boolean;
  data?: ArrayBuffer;
  contentType?: string;
  fileName?: string;
  error?: string;
};

/**
 * Upload an image to Feishu and get an image_key.
 * The image_key can then be used to send image messages.
 */
export async function uploadImageFeishu(
  imageData: Buffer | ArrayBuffer | Blob,
  options: FeishuSendOptions & { imageType?: FeishuImageType } = {},
): Promise<FeishuUploadResult> {
  const { appId, appSecret, fetcher } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Feishu app credentials configured" };
  }

  try {
    const response = await uploadImage(
      appId,
      appSecret,
      imageData,
      options.imageType ?? "message",
      { fetch: fetcher },
    );

    if (response.code === 0 && response.data?.image_key) {
      return { ok: true, imageKey: response.data.image_key };
    }

    return { ok: false, error: response.msg ?? "Failed to upload image" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Download an image from Feishu using its image_key.
 */
export async function downloadImageFeishu(
  imageKey: string,
  options: FeishuSendOptions = {},
): Promise<FeishuDownloadResult> {
  const { appId, appSecret, fetcher } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Feishu app credentials configured" };
  }

  if (!imageKey?.trim()) {
    return { ok: false, error: "No image key provided" };
  }

  try {
    const result = await downloadImage(
      appId,
      appSecret,
      imageKey.trim(),
      { fetch: fetcher },
    );

    return { ok: true, data: result.data, contentType: result.contentType };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File Upload/Download
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a file to Feishu and get a file_key.
 * The file_key can then be used to send file messages.
 */
export async function uploadFileFeishu(
  fileData: Buffer | ArrayBuffer | Blob,
  fileName: string,
  fileType: FeishuFileType,
  options: FeishuSendOptions = {},
): Promise<FeishuUploadResult> {
  const { appId, appSecret, fetcher } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Feishu app credentials configured" };
  }

  try {
    const response = await uploadFile(
      appId,
      appSecret,
      fileData,
      fileName,
      fileType,
      { fetch: fetcher },
    );

    if (response.code === 0 && response.data?.file_key) {
      return { ok: true, fileKey: response.data.file_key };
    }

    return { ok: false, error: response.msg ?? "Failed to upload file" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Download a file from Feishu using its file_key.
 */
export async function downloadFileFeishu(
  fileKey: string,
  options: FeishuSendOptions = {},
): Promise<FeishuDownloadResult> {
  const { appId, appSecret, fetcher } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Feishu app credentials configured" };
  }

  if (!fileKey?.trim()) {
    return { ok: false, error: "No file key provided" };
  }

  try {
    const result = await downloadFile(
      appId,
      appSecret,
      fileKey.trim(),
      { fetch: fetcher },
    );

    return { 
      ok: true, 
      data: result.data, 
      contentType: result.contentType,
      fileName: result.fileName,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send a file message to a Feishu user or chat.
 * Requires uploading file first via uploadFileFeishu, then sending with file_key.
 */
export async function sendFileFeishu(
  to: string,
  fileKey: string,
  options: FeishuSendOptions = {},
): Promise<FeishuSendResult> {
  const { appId, appSecret, fetcher } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Feishu app credentials configured" };
  }

  if (!to?.trim()) {
    return { ok: false, error: "No recipient provided" };
  }

  if (!fileKey?.trim()) {
    return { ok: false, error: "No file key provided" };
  }

  const normalizedTo = normalizeTarget(to);
  const receiveIdType = options.receiveIdType ?? inferReceiveIdType(normalizedTo);
  const content = JSON.stringify({ file_key: fileKey.trim() });

  try {
    const response = await sendMessage(
      appId,
      appSecret,
      { receive_id: normalizedTo, msg_type: "file", content },
      receiveIdType,
      { fetch: fetcher },
    );

    if (response.code === 0 && response.data) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: response.msg ?? "Failed to send file" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Upload an image and send it in one operation.
 * Convenience function that combines uploadImageFeishu and sendImageFeishu.
 */
export async function uploadAndSendImageFeishu(
  to: string,
  imageData: Buffer | ArrayBuffer | Blob,
  options: FeishuSendOptions & { imageType?: FeishuImageType } = {},
): Promise<FeishuSendResult> {
  // First upload the image
  const uploadResult = await uploadImageFeishu(imageData, options);
  if (!uploadResult.ok || !uploadResult.imageKey) {
    return { ok: false, error: uploadResult.error ?? "Failed to upload image" };
  }

  // Then send the image message
  return sendImageFeishu(to, uploadResult.imageKey, options);
}

/**
 * Upload a file and send it in one operation.
 * Convenience function that combines uploadFileFeishu and sendFileFeishu.
 */
export async function uploadAndSendFileFeishu(
  to: string,
  fileData: Buffer | ArrayBuffer | Blob,
  fileName: string,
  fileType: FeishuFileType,
  options: FeishuSendOptions = {},
): Promise<FeishuSendResult> {
  // First upload the file
  const uploadResult = await uploadFileFeishu(fileData, fileName, fileType, options);
  if (!uploadResult.ok || !uploadResult.fileKey) {
    return { ok: false, error: uploadResult.error ?? "Failed to upload file" };
  }

  // Then send the file message
  return sendFileFeishu(to, uploadResult.fileKey, options);
}
