/**
 * WebSocket-based monitor for Feishu events using long connection mode.
 * Uses the official @larksuiteoapi/node-sdk WSClient for receiving events
 * via WebSocket - no public IP or webhook setup needed.
 *
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/long-connection-mode
 */

import * as Lark from "@larksuiteoapi/node-sdk";

import type { ClawdbotConfig, MarkdownTableMode } from "clawdbot/plugin-sdk";

import type {
  FeishuMessageEvent,
  FeishuReceiveIdType,
  ResolvedFeishuAccount,
  FeishuBotInfo,
} from "./types.js";
import { sendMessage, replyMessage, updateMessageCard, uploadImage, downloadImage } from "./api.js";
import { getFeishuRuntime } from "./runtime.js";

export type FeishuRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type FeishuMonitorOptions = {
  account: ResolvedFeishuAccount;
  config: ClawdbotConfig;
  runtime: FeishuRuntimeEnv;
  abortSignal: AbortSignal;
  /** Custom webhook path for receiving events. */
  webhookPath?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  /** Bot info for mention detection in groups */
  botInfo?: FeishuBotInfo;
};

export type FeishuMonitorResult = {
  stop: () => void;
};

// Feishu card markdown content limit (slightly lower than text to account for JSON overhead)
const FEISHU_CARD_CONTENT_LIMIT = 3800;
const DEFAULT_MEDIA_MAX_MB = 20;
// Minimum interval between streaming updates (in ms) to avoid rate limiting
const STREAMING_UPDATE_INTERVAL_MS = 300;
// Streaming indicator shown while generating
const STREAMING_INDICATOR = " ▌";

/**
 * Build a Feishu interactive card with markdown content.
 * Card messages support rich markdown formatting in Feishu.
 * @param content - The markdown content to display
 * @param mentionUserId - Optional user ID to @mention at the beginning of the message
 * @param isStreaming - If true, adds a streaming indicator (cursor) at the end
 */
function buildMarkdownCard(content: string, mentionUserId?: string, isStreaming = false): string {
  // Build the markdown content with optional @mention
  // Feishu @mention syntax: <at id=user_id></at>
  let markdownContent = content;
  if (mentionUserId?.trim()) {
    // Add @mention at the beginning of the message
    markdownContent = `<at id=${mentionUserId}></at> ${content}`;
  }

  // Add streaming cursor indicator if streaming
  if (isStreaming) {
    markdownContent += STREAMING_INDICATOR;
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
 * Check if the bot is mentioned in a group message.
 * Uses multiple detection methods for reliability.
 */
function isBotMentioned(
  event: FeishuMessageEvent,
  botInfo?: FeishuBotInfo,
): boolean {
  const mentions = event.message.mentions ?? [];
  
  // Check for @all mention
  if (mentions.some((m) => m.name === "@_all")) {
    return true;
  }
  
  // Check if bot is directly mentioned by open_id
  if (botInfo?.open_id) {
    if (mentions.some((m) => m.id.open_id === botInfo.open_id)) {
      return true;
    }
  }
  
  // Fallback: check if any mention has empty id (sometimes bot mentions appear this way)
  // or check mention key patterns that indicate bot mention
  for (const mention of mentions) {
    // Bot mentions often have a specific key format
    if (mention.key && mention.name) {
      // If the mention name matches common bot patterns or the message content
      // starts with the mention, it's likely targeting the bot
      const content = event.message.content;
      try {
        const parsed = JSON.parse(content);
        const text = parsed.text ?? "";
        // Check if the mention appears at the start of the message
        if (text.startsWith(`@${mention.name}`) || text.startsWith(mention.key)) {
          return true;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
  
  return false;
}

/**
 * Extract image keys from a message event.
 */
function extractImageKeys(event: FeishuMessageEvent): string[] {
  const imageKeys: string[] = [];
  
  if (event.message.message_type === "image") {
    try {
      const content = JSON.parse(event.message.content);
      if (content.image_key) {
        imageKeys.push(content.image_key);
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  // Check for images in post messages (rich text)
  if (event.message.message_type === "post") {
    try {
      const content = JSON.parse(event.message.content);
      // Post content has a nested structure with content arrays
      const traverseContent = (items: unknown[]): void => {
        for (const item of items) {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            if (obj.tag === "img" && obj.image_key) {
              imageKeys.push(obj.image_key as string);
            }
            if (Array.isArray(obj.content)) {
              traverseContent(obj.content);
            }
          }
        }
      };
      if (content.content && Array.isArray(content.content)) {
        for (const paragraph of content.content) {
          if (Array.isArray(paragraph)) {
            traverseContent(paragraph);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  return imageKeys;
}

/**
 * Extract file key from a message event.
 */
function extractFileKey(event: FeishuMessageEvent): string | undefined {
  if (event.message.message_type === "file") {
    try {
      const content = JSON.parse(event.message.content);
      return content.file_key;
    } catch {
      // Ignore parse errors
    }
  }
  return undefined;
}

type FeishuCoreRuntime = ReturnType<typeof getFeishuRuntime>;

function logVerbose(core: FeishuCoreRuntime, runtime: FeishuRuntimeEnv, message: string): void {
  if (core.logging.shouldLogVerbose()) {
    runtime.log?.(`[feishu] ${message}`);
  }
}

type FeishuReplyTarget = {
  id: string;
  type: FeishuReceiveIdType;
};

function resolveSenderTarget(event: FeishuMessageEvent): FeishuReplyTarget | null {
  const senderId = event.sender.sender_id;
  if (senderId.open_id) return { id: senderId.open_id, type: "open_id" };
  if (senderId.user_id) return { id: senderId.user_id, type: "user_id" };
  if (senderId.union_id) return { id: senderId.union_id, type: "union_id" };
  return null;
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) return true;
  const normalizedSenderId = senderId.toLowerCase();
  return allowFrom.some((entry) => {
    const normalized = entry.toLowerCase().replace(/^(feishu|lark|fs):/i, "");
    return normalized === normalizedSenderId;
  });
}

/**
 * Process a message event from Feishu WebSocket.
 */
async function processMessageEvent(
  event: FeishuMessageEvent,
  account: ResolvedFeishuAccount,
  config: ClawdbotConfig,
  runtime: FeishuRuntimeEnv,
  core: FeishuCoreRuntime,
  mediaMaxMb: number,
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
  botInfo?: FeishuBotInfo,
): Promise<void> {
  const { sender, message } = event;

  // Parse message content based on message type
  let textContent = "";
  let imageKeys: string[] = [];
  let fileKey: string | undefined;
  
  try {
    const content = JSON.parse(message.content);
    
    if (message.message_type === "text") {
      textContent = content.text ?? "";
    } else if (message.message_type === "image") {
      // Image message - extract image key
      imageKeys = extractImageKeys(event);
      textContent = "[Image]"; // Placeholder text for image messages
    } else if (message.message_type === "file") {
      // File message - extract file key
      fileKey = extractFileKey(event);
      textContent = content.file_name ? `[File: ${content.file_name}]` : "[File]";
    } else if (message.message_type === "post") {
      // Rich text message - extract text and images
      imageKeys = extractImageKeys(event);
      // Extract text from post content
      const extractText = (items: unknown[]): string => {
        let result = "";
        for (const item of items) {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            if (obj.tag === "text" && typeof obj.text === "string") {
              result += obj.text;
            } else if (obj.tag === "at" && typeof obj.user_name === "string") {
              result += `@${obj.user_name}`;
            }
          }
        }
        return result;
      };
      if (content.content && Array.isArray(content.content)) {
        for (const paragraph of content.content) {
          if (Array.isArray(paragraph)) {
            textContent += extractText(paragraph);
          }
        }
      }
      // Fallback to title if no content extracted
      if (!textContent && content.title) {
        textContent = content.title;
      }
    } else {
      // Other message types - try to extract text
      textContent = content.text ?? "";
    }
  } catch {
    // Ignore parse errors
  }

  // Skip empty messages (but allow image-only messages)
  if (!textContent.trim() && imageKeys.length === 0 && !fileKey) return;

  const isGroup = message.chat_type === "group";
  const chatId = message.chat_id;
  const senderTarget = resolveSenderTarget(event);
  if (!senderTarget) {
    logVerbose(core, runtime, "unable to resolve sender id for feishu message");
    return;
  }
  const senderId = senderTarget.id;
  const senderName = sender.sender_type === "user" ? "User" : sender.sender_type;
  const messageId = message.message_id;
  const replyTarget: FeishuReplyTarget = isGroup
    ? { id: chatId, type: "chat_id" }
    : senderTarget;
  runtime.log?.(
    `[feishu] inbound message id=${messageId} chat=${message.chat_type} sender=${senderId}`,
  );

  // Check DM policy
  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configAllowFrom = account.config.allowFrom ?? [];
  const rawBody = textContent.trim();
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, config);
  const storeAllowFrom =
    !isGroup && (dmPolicy !== "open" || shouldComputeAuth)
      ? await core.channel.pairing.readAllowFromStore("feishu").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = isSenderAllowed(senderId, effectiveAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [{ configured: effectiveAllowFrom.length > 0, allowed: senderAllowedForCommands }],
      })
    : undefined;

  if (!isGroup) {
    if (dmPolicy === "disabled") {
      logVerbose(core, runtime, `Blocked feishu DM from ${senderId} (dmPolicy=disabled)`);
      return;
    }

    if (dmPolicy !== "open") {
      const allowed = senderAllowedForCommands;

      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "feishu",
            id: senderId,
            meta: { name: senderName ?? undefined },
          });

          if (created) {
            logVerbose(core, runtime, `feishu pairing request sender=${senderId}`);
            try {
              const pairingReply = core.channel.pairing.buildPairingReply({
                channel: "feishu",
                idLine: `Your Feishu user id: ${senderId}`,
                code,
              });
              await sendMessage(
                account.appId,
                account.appSecret,
                {
                  receive_id: senderId,
                  msg_type: "text",
                  content: JSON.stringify({ text: pairingReply }),
                },
                senderTarget.type,
              );
              statusSink?.({ lastOutboundAt: Date.now() });
            } catch (err) {
              logVerbose(
                core,
                runtime,
                `feishu pairing reply failed for ${senderId}: ${String(err)}`,
              );
            }
          }
        } else {
          logVerbose(
            core,
            runtime,
            `Blocked unauthorized feishu sender ${senderId} (dmPolicy=${dmPolicy})`,
          );
        }
        return;
      }
    }
  }

  // Check group policy
  if (isGroup) {
    const groupPolicy = account.config.groupPolicy ?? "allowlist";
    const groupAllowFrom = account.config.groupAllowFrom ?? [];
    const groupConfig = account.config.groups?.[chatId];

    if (groupPolicy === "allowlist") {
      const groupAllowed = groupAllowFrom.includes("*") || groupAllowFrom.includes(chatId);
      const groupEnabled = groupConfig?.enabled !== false;
      if (!groupAllowed && !groupEnabled) {
        logVerbose(core, runtime, `Blocked feishu group ${chatId} (not in allowlist)`);
        return;
      }
    }

    // Check if mention is required
    const requireMention = groupConfig?.requireMention !== false;
    if (requireMention) {
      const hasMention = isBotMentioned(event, botInfo);
      if (!hasMention) {
        logVerbose(core, runtime, `Ignored feishu group message (no mention)`);
        return;
      }
    }
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "feishu",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "dm",
      id: chatId,
    },
  });

  if (
    isGroup &&
    core.channel.commands.isControlCommandMessage(rawBody, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, runtime, `feishu: drop control command from unauthorized sender ${senderId}`);
    return;
  }

  const fromLabel = isGroup ? `group:${chatId}` : senderName || `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Feishu",
    from: fromLabel,
    timestamp: message.create_time ? parseInt(message.create_time, 10) : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  // Build media attachments if any
  const attachments: Array<{ type: string; key: string }> = [];
  for (const imgKey of imageKeys) {
    attachments.push({ type: "image", key: imgKey });
  }
  if (fileKey) {
    attachments.push({ type: "file", key: fileKey });
  }

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? `feishu:group:${chatId}` : `feishu:${senderId}`,
    To: `feishu:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName || undefined,
    SenderId: senderId,
    CommandAuthorized: commandAuthorized,
    Provider: "feishu",
    Surface: "feishu",
    MessageSid: messageId,
    OriginatingChannel: "feishu",
    OriginatingTo: `feishu:${chatId}`,
    // Include media attachments if any
    ...(attachments.length > 0 ? { Attachments: attachments } : {}),
    // Include image keys for downstream processing
    ...(imageKeys.length > 0 ? { ImageKeys: imageKeys } : {}),
    // Include file key for downstream processing
    ...(fileKey ? { FileKey: fileKey } : {}),
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: (ctxPayload.SessionKey as string) ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err: unknown) => {
      runtime.error?.(`feishu: failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "feishu",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload) => {
        await deliverFeishuReply({
          payload,
          account,
          receiveId: replyTarget.id,
          receiveIdType: replyTarget.type,
          senderId,
          replyToMessageId: messageId,
          runtime,
          core,
          config,
          statusSink,
          tableMode,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`[${account.accountId}] Feishu ${info.kind} reply failed: ${String(err)}`);
      },
    },
  });
}

async function deliverFeishuReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  account: ResolvedFeishuAccount;
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
  /** Sender's user ID for @mention in replies */
  senderId?: string;
  /** Original message ID to reply to (for quote/reference) */
  replyToMessageId?: string;
  runtime: FeishuRuntimeEnv;
  core: FeishuCoreRuntime;
  config: ClawdbotConfig;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  tableMode?: MarkdownTableMode;
}): Promise<void> {
  const { payload, account, receiveId, receiveIdType, senderId, replyToMessageId, runtime, core, config, statusSink } = params;
  const tableMode = params.tableMode ?? "code";
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  if (text) {
    const chunkMode = core.channel.text.resolveChunkMode(config, "feishu", account.accountId);
    const chunks = core.channel.text.chunkMarkdownTextWithMode(
      text,
      FEISHU_CARD_CONTENT_LIMIT,
      chunkMode,
    );
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        // Send as interactive card message with markdown support
        // Only @mention the sender in the first chunk to avoid spam
        const mentionUserId = i === 0 ? senderId : undefined;
        const content = buildMarkdownCard(chunk, mentionUserId);

        // Use replyMessage for the first chunk to show quote, sendMessage for subsequent chunks
        if (i === 0 && replyToMessageId) {
          // Reply to original message - this shows the quoted content in Feishu
          await replyMessage(
            account.appId,
            account.appSecret,
            replyToMessageId,
            {
              msg_type: "interactive",
              content,
            },
          );
        } else {
          // Send as new message for subsequent chunks
          await sendMessage(
            account.appId,
            account.appSecret,
            {
              receive_id: receiveId,
              msg_type: "interactive",
              content,
            },
            receiveIdType,
          );
        }
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        runtime.error?.(`[feishu] message send failed: ${String(err)}`);
      }
    }
  }
}

/**
 * Streaming delivery context for progressive message updates.
 */
type StreamingContext = {
  messageId: string | null;
  lastUpdateTime: number;
  accumulatedText: string;
  mentionUserId?: string;
  isFirstChunk: boolean;
};

/**
 * Deliver Feishu reply with streaming support.
 * Sends an initial message and progressively updates it with new content.
 */
async function deliverFeishuReplyStreaming(params: {
  account: ResolvedFeishuAccount;
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
  /** Sender's user ID for @mention in replies */
  senderId?: string;
  /** Original message ID to reply to (for quote/reference) */
  replyToMessageId?: string;
  runtime: FeishuRuntimeEnv;
  core: FeishuCoreRuntime;
  config: ClawdbotConfig;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  tableMode?: MarkdownTableMode;
  /** Stream iterator that yields text chunks */
  textStream: AsyncIterable<string>;
}): Promise<void> {
  const { account, receiveId, receiveIdType, senderId, replyToMessageId, runtime, core, config, statusSink, textStream } = params;
  const tableMode = params.tableMode ?? "code";

  const ctx: StreamingContext = {
    messageId: null,
    lastUpdateTime: 0,
    accumulatedText: "",
    mentionUserId: senderId,
    isFirstChunk: true,
  };

  try {
    for await (const chunk of textStream) {
      ctx.accumulatedText += chunk;

      const now = Date.now();
      const timeSinceLastUpdate = now - ctx.lastUpdateTime;

      // Rate limit updates to avoid API throttling
      if (timeSinceLastUpdate < STREAMING_UPDATE_INTERVAL_MS) {
        continue;
      }

      // Convert markdown tables for display
      const displayText = core.channel.text.convertMarkdownTables(ctx.accumulatedText, tableMode);

      try {
        if (ctx.isFirstChunk) {
          // Send initial message (with streaming indicator)
          const content = buildMarkdownCard(displayText, ctx.mentionUserId, true);

          if (replyToMessageId) {
            const response = await replyMessage(
              account.appId,
              account.appSecret,
              replyToMessageId,
              { msg_type: "interactive", content },
            );
            ctx.messageId = response.data?.message_id ?? null;
          } else {
            const response = await sendMessage(
              account.appId,
              account.appSecret,
              { receive_id: receiveId, msg_type: "interactive", content },
              receiveIdType,
            );
            ctx.messageId = response.data?.message_id ?? null;
          }

          ctx.isFirstChunk = false;
          ctx.lastUpdateTime = now;
          statusSink?.({ lastOutboundAt: now });
        } else if (ctx.messageId) {
          // Update existing message with new content (with streaming indicator)
          const content = buildMarkdownCard(displayText, ctx.mentionUserId, true);
          await updateMessageCard(account.appId, account.appSecret, ctx.messageId, content);
          ctx.lastUpdateTime = now;
          statusSink?.({ lastOutboundAt: now });
        }
      } catch (err) {
        // Log error but continue streaming
        runtime.error?.(`[feishu] streaming update failed: ${String(err)}`);
      }
    }

    // Final update: remove streaming indicator
    if (ctx.messageId && ctx.accumulatedText) {
      const finalText = core.channel.text.convertMarkdownTables(ctx.accumulatedText, tableMode);
      const content = buildMarkdownCard(finalText, ctx.mentionUserId, false);
      try {
        await updateMessageCard(account.appId, account.appSecret, ctx.messageId, content);
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        runtime.error?.(`[feishu] final streaming update failed: ${String(err)}`);
      }
    } else if (!ctx.messageId && ctx.accumulatedText) {
      // Never sent initial message, send final content now
      const finalText = core.channel.text.convertMarkdownTables(ctx.accumulatedText, tableMode);
      const content = buildMarkdownCard(finalText, ctx.mentionUserId, false);
      try {
        if (replyToMessageId) {
          await replyMessage(
            account.appId,
            account.appSecret,
            replyToMessageId,
            { msg_type: "interactive", content },
          );
        } else {
          await sendMessage(
            account.appId,
            account.appSecret,
            { receive_id: receiveId, msg_type: "interactive", content },
            receiveIdType,
          );
        }
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        runtime.error?.(`[feishu] final message send failed: ${String(err)}`);
      }
    }
  } catch (err) {
    runtime.error?.(`[feishu] streaming delivery failed: ${String(err)}`);
    throw err;
  }
}

/**
 * Start monitoring Feishu events using WebSocket long connection.
 */
export async function monitorFeishuProvider(
  options: FeishuMonitorOptions,
): Promise<FeishuMonitorResult> {
  const { account, config, runtime, abortSignal, statusSink, botInfo } = options;

  const core = getFeishuRuntime();
  const effectiveMediaMaxMb = account.config.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB;

  let stopped = false;
  let wsClient: Lark.WSClient | null = null;
  // Store bot info for mention detection (can be updated from probe)
  let currentBotInfo: FeishuBotInfo | undefined = botInfo;

  const stop = () => {
    stopped = true;
    if (wsClient) {
      wsClient = null;
    }
  };

  // Create WebSocket client for receiving events
  wsClient = new Lark.WSClient({
    appId: account.appId,
    appSecret: account.appSecret,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.warn,
  });

  // Create event dispatcher with message handler
  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      if (stopped) return;

      statusSink?.({ lastInboundAt: Date.now() });

      // Convert SDK event data to our internal type
      const event: FeishuMessageEvent = {
        sender: data.sender as FeishuMessageEvent["sender"],
        message: data.message as FeishuMessageEvent["message"],
      };

      try {
        await processMessageEvent(
          event,
          account,
          config,
          runtime,
          core,
          effectiveMediaMaxMb,
          statusSink,
          currentBotInfo,
        );
      } catch (err) {
        runtime.error?.(`[${account.accountId}] Feishu event handler failed: ${String(err)}`);
      }
    },
  });

  // Start WebSocket connection
  wsClient.start({
    eventDispatcher,
  });

  runtime.log?.(
    `[feishu] WebSocket connection started for account=${account.accountId}`,
  );

  abortSignal.addEventListener("abort", stop, { once: true });

  return { stop };
}
