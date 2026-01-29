import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { feishuDock, feishuPlugin } from "./src/channel.js";
import { setFeishuRuntime } from "./src/runtime.js";

const plugin = {
  id: "feishu",
  name: "Feishu",
  description: "Feishu (Lark) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setFeishuRuntime(api.runtime);
    api.registerChannel({ plugin: feishuPlugin, dock: feishuDock });
    // WebSocket mode - no HTTP handler needed
  },
};

export default plugin;

// Re-export API functions for external use
export {
  // Core messaging
  sendMessageFeishu,
  sendImageFeishu,
  sendFileFeishu,
  // Image upload/download
  uploadImageFeishu,
  downloadImageFeishu,
  uploadAndSendImageFeishu,
  // File upload/download
  uploadFileFeishu,
  downloadFileFeishu,
  uploadAndSendFileFeishu,
  // Types
  type FeishuSendOptions,
  type FeishuSendResult,
  type FeishuUploadResult,
  type FeishuDownloadResult,
} from "./src/send.js";

// Re-export low-level API functions
export {
  getTenantAccessToken,
  callFeishuApi,
  getBotInfo,
  sendMessage,
  replyMessage,
  updateMessageCard,
  uploadImage,
  downloadImage,
  uploadFile,
  downloadFile,
  getMessage,
  FeishuApiError,
} from "./src/api.js";

// Re-export types
export type {
  FeishuAccountConfig,
  FeishuConfig,
  FeishuCredentialSource,
  ResolvedFeishuAccount,
  FeishuApiResponse,
  FeishuTokenResponse,
  FeishuBotInfo,
  FeishuSender,
  FeishuMessageContent,
  FeishuMention,
  FeishuMessageEvent,
  FeishuMessageType,
  FeishuSendMessageParams,
  FeishuSendMessageResponse,
  FeishuReceiveIdType,
  FeishuImageType,
  FeishuFileType,
  FeishuUploadImageResponse,
  FeishuUploadFileResponse,
  FeishuUpdateMessageResponse,
  FeishuExtendedBotInfo,
} from "./src/types.js";
