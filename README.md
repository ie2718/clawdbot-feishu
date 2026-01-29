# @ie2718/clawdbot-feishu

[English](README.md) | [简体中文](README.zh-CN.md)

Feishu channel plugin for [Clawdbot](https://github.com/clawdbot/clawdbot).

## Demo

![Demo Chat](resource/images/demo-chat.png)

## Features

- **WebSocket Long Connection**: No public IP or Webhook configuration required
- **Markdown Support**: Rich text formatting via interactive card messages
- **Multi-account**: Supports multiple Feishu bot accounts
- **Access Control**: Pairing-code-based private chat access control and group allowlists

## Installation

```bash
# Via Clawdbot CLI
clawdbot plugins install @ie2718-moltbot/feishu

# Or via npm
npm install @ie2718-moltbot/feishu
```

## Quick Start

### 1. Create Feishu App

1. Visit [Feishu Open Platform](https://open.feishu.cn/app) and log in
2. Click **Create App** > **Enterprise Self-built App**
3. Fill in basic information (name, description, icon)
4. Add **Bot** capability in "Add Application Capabilities"
5. Get your **App ID** and **App Secret** from "Credentials and Basic Info"

### 2. Configure Permissions

In your app's "Permission Management", add these permissions:

| Permission | Description |
|------------|-------------|
| `im:message` | Send messages |
| `im:chat` | Access group information |
| `im:message:send_as_bot` | Send messages as the app |
| `contact:user.id:readonly` | Read user info (optional) |

Bulk Import:
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

### 3. Install Plugin and Configure Credentials

```bash
clawdbot plugins install @ie2718-moltbot/feishu
```

The interactive setup wizard will prompt you to enter:
- **App ID**: Your Feishu App ID (e.g., `cli_xxxxxxxxxx`)
- **App Secret**: Your Feishu App Secret

If you've already configured credentials, the wizard will ask if you want to keep them.

**Alternative Configuration Methods**

If you prefer manual configuration:

**Option A: Clawdbot config command**

```bash
clawdbot config set channels.feishu.enabled true
clawdbot config set channels.feishu.appId "cli_xxxxxxxxxx"
clawdbot config set channels.feishu.appSecret "xxxxxxxxxxxxxxxxxxxxxxxx"
```

**Option B: Configuration file**
`~/.clawdbot/clawdbot.json`
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

**Option C: Interactive onboarding**

```bash
clawdbot onboard
```

The onboarding wizard will guide you through the configuration:

![Onboard Prompt](resource/images/onboard-prompt.png)

### 4. Enable WebSocket Event Subscription

1. Go to **Events and Callbacks** page
2. Set subscription method to **Long Connection** (WebSocket)
3. Add event: `im.message.receive_v1` (Receive messages)
4. Enable **Receive @Bot messages in group chat**, **Read direct messages sent to bot**, **Access all group messages (sensitive permission)** (if group chat is needed)
5. Click Save

### 5. Publish the Bot

1. Create a version and publish. You will receive an approval message in the Feishu client. Open the app to start chatting.
2. If you need group chat, follow these steps:
  - Open the target group chat window.
  - Click the "..." (Settings/Group Settings) in the top right corner.
  - Find the "Group Bot" option (usually below the group announcement).
  - Click "Add Bot".
  - Search for your bot name in the search box.
  - Click the "Add" button next to the bot's name.
  - @ the bot to start chatting.

### 6. Start Gateway

```bash
clawdbot gateway run
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable channel |
| `appId` | string | - | App ID from Feishu console |
| `appSecret` | string | - | App Secret from Feishu console |
| `appSecretFile` | string | - | Path to file containing App Secret |
| `dmPolicy` | string | "pairing" | DM access policy |
| `allowFrom` | string[] | [] | DM allowlist (user IDs) |
| `groupPolicy` | string | "allowlist" | Group access policy |
| `groupAllowFrom` | string[] | [] | Group allowlist (group IDs) |
| `mediaMaxMb` | number | 20 | Max media file size (MB) |

## Multi-account Configuration

```json5
{
  channels: {
    feishu: {
      defaultAccount: "main",
      accounts: {
        main: {
          name: "Main Bot",
          appId: "cli_xxx",
          appSecret: "xxx"
        },
        support: {
          name: "Support Bot",
          appId: "cli_yyy",
          appSecret: "yyy"
        }
      }
    }
  }
}
```

## CLI Usage

```bash
# Send message to user (open_id)
clawdbot message send --channel feishu --target ou_xxx --message "Hello!"

# Send message to group (chat_id)
clawdbot message send --channel feishu --target oc_xxx --message "Hello everyone!"

# Check status
clawdbot channels status --probe
```

## Version Updates

Delete `.clawdbot/extensions/feishu` in the clawdbot directory, then run `clawdbot onboard`.
- Choose Download from npm installation method.
- Or install via `clawdbot plugins install` and Use local plugin path.

## Access Control

### DM Policy Options

| Policy | Behavior |
|--------|----------|
| `pairing` (default) | Unknown senders receive pairing code; approve via CLI |
| `allowlist` | Only users in `allowFrom` can send messages |
| `open` | Anyone can send messages (requires `allowFrom: ["*"]`) |
| `disabled` | DMs blocked |

### Pairing Workflow

When a new user sends a message to your bot with `dmPolicy: "pairing"` (default), they will receive a pairing code:

![Pairing Code](resource/images/pairing-code.png)

The bot administrator can approve access via the CLI:

```bash
# List pending pairing requests
clawdbot pairing list feishu

# Approve a pairing request
clawdbot pairing approve feishu <CODE>
```

## Troubleshooting

- **Duplicate plugin id warning**: If you see `duplicate plugin id detected`, you have multiple Feishu plugin entries loaded (for example, both a local plugin path and a downloaded extension in `~/.clawdbot/extensions/feishu`). Keep only one installation and restart `clawdbot`.

## Documentation

Full documentation: https://resource.clawd.bot

## License

MIT
