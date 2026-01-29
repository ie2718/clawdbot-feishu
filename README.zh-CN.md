# @ie2718/clawdbot-feishu

[English](README.md) | [简体中文](README.zh-CN.md)

[Clawdbot](https://github.com/clawdbot/clawdbot) 的飞书频道插件。

## 演示

![演示对话](resource/images/demo-chat.png)

## 功能特性

- **WebSocket 长连接**：无需公网 IP 或 Webhook 配置
- **Markdown 支持**：通过交互式卡片消息实现富文本格式
- **多账号**：支持多个飞书机器人账号
- **访问控制**：基于配对码的私聊访问控制和群组白名单

## 安装

```bash
# 通过 Clawdbot CLI
clawdbot plugins install @ie2718-moltbot/feishu

# 或通过 npm
npm install @ie2718-moltbot/feishu
```

## 快速开始

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app) 并登录
2. 点击 **创建应用** > **企业自建应用**
3. 填写基本信息（名称、描述、图标）
4. 在「添加应用能力」中添加 **机器人** 能力
5. 在「凭证与基础信息」中获取 **App ID** 和 **App Secret**

### 2. 配置权限

在应用的「权限管理」中添加以下权限：

| 权限 | 说明 |
|------|------|
| `im:message` | 发送消息 |
| `im:chat` | 获取群组信息 |
| `im:message:send_as_bot` | 以应用的身份发消息
| `contact:user.id:readonly` | 读取用户信息（可选） |

直接批量导入
```json
{
  "scopes": {
    "tenant": [
      "contact:user.id:readonly",
      "im:chat",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": []
  }
}
```


### 3. 安装插件并配置凭证

```bash
clawdbot plugins install @ie2718-moltbot/feishu
```

交互式配置向导会提示你输入：
- **App ID**：你的飞书 App ID（如 `cli_xxxxxxxxxx`）
- **App Secret**：你的飞书 App Secret

如果之前已配置过凭证，向导会询问是否保留现有配置。

**其他配置方式**

如果你偏好手动配置：

**方式 A：Clawdbot 配置命令**

```bash
clawdbot config set channels.feishu.enabled true
clawdbot config set channels.feishu.appId "cli_xxxxxxxxxx"
clawdbot config set channels.feishu.appSecret "xxxxxxxxxxxxxxxxxxxxxxxx"
```


**方式 B：配置文件**
~/.clawdbot/clawdbot.json
```json5
{
  channels: {
    feishu: {
      enabled: true,
      appId: "cli_xxxxxxxxxx",
      appSecret: "xxxxxxxxxxxxxxxxxxxxxxxx"
    }
  }
}
```
**方式 C：交互式引导配置**

```bash
clawdbot onboard
```

引导向导会引导你完成配置：

![引导配置](resource/images/onboard-prompt.png)

### 4. 启用 WebSocket 事件订阅

1. 进入 **事件与回调** 页面
2. 将订阅方式设置为 **长连接**（WebSocket）
3. 添加事件：`im.message.receive_v1`（接收消息）
4. 开通 **接收群聊中@机器人消息事件**、**读取用户发给机器人的单聊消息**、**获取群组中所有消息（敏感权限）** （如果需要群聊）
5. 点击保存

### 5. 发布机器人
1. 创建版本并发布，在飞书客户端会收到小助手审核通过消息，打开应用即可对话
2. 如果需要群聊，按以下步骤操作
  - 打开目标群聊窗口。
  - 点击右上角的 “...”（设置/群设置）。
  - 找到 “群机器人” 选项（通常在群公告下方）。
  - 点击 “添加机器人”。
  - 在搜索框中输入你的机器人名称。
  - 点击机器人名称后的 “添加” 按钮即可。
  - @ 机器人即可对话

### 5. 启动网关

```bash
clawdbot gateway run
```

## 配置参考

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | true | 启用/禁用频道 |
| `appId` | string | - | 飞书控制台的 App ID |
| `appSecret` | string | - | 飞书控制台的 App Secret |
| `appSecretFile` | string | - | 包含 App Secret 的文件路径 |
| `dmPolicy` | string | "pairing" | 私聊访问策略 |
| `allowFrom` | string[] | [] | 私聊白名单（用户 ID） |
| `groupPolicy` | string | "allowlist" | 群组访问策略 |
| `groupAllowFrom` | string[] | [] | 群组白名单（群组 ID） |
| `mediaMaxMb` | number | 20 | 最大媒体文件大小（MB） |

## 多账号配置

```json5
{
  channels: {
    feishu: {
      defaultAccount: "main",
      accounts: {
        main: {
          name: "主机器人",
          appId: "cli_xxx",
          appSecret: "xxx"
        },
        support: {
          name: "客服机器人",
          appId: "cli_yyy",
          appSecret: "yyy"
        }
      }
    }
  }
}
```

## CLI 使用

```bash
# 发送消息给用户（open_id）
clawdbot message send --channel feishu --target ou_xxx --message "你好！"

# 发送消息到群组（chat_id）
clawdbot message send --channel feishu --target oc_xxx --message "大家好！"

# 检查状态
clawdbot channels status --probe
```

## 版本更新

删除clawdbot的.clawdbot/extensions/feishu，然后clawdbot onboard
- 选择Download from npm方式安装
- 或者通过clawdbot plugins install 方式安装，然后选择Use local plugin path

## 访问控制

### 私聊策略选项

| 策略 | 行为 |
|------|------|
| `pairing`（默认） | 未知发送者会收到配对码；通过 CLI 审批 |
| `allowlist` | 仅 `allowFrom` 中的用户可以发消息 |
| `open` | 任何人都可以发消息（需设置 `allowFrom: ["*"]`） |
| `disabled` | 禁止私聊 |

### 配对流程

当新用户在 `dmPolicy: "pairing"`（默认）模式下向机器人发送消息时，会收到一个配对码：

![配对码](resource/images/pairing-code.png)

机器人管理员可以通过 CLI 批准访问：

```bash
# 列出待处理的配对请求
clawdbot pairing list feishu

# 批准配对请求
clawdbot pairing approve feishu <CODE>
```

## Troubleshooting

- **Duplicate plugin id warning**: If you see `duplicate plugin id detected`, you have multiple Feishu plugin entries loaded (for example, both a local plugin path and a downloaded extension in `~/.clawdbot/extensions/feishu`). Keep only one installation and restart `clawdbot`.

## 文档

完整文档：https://resource.clawd.bot

## 许可证

MIT
