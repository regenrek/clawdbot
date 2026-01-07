---
summary: "Rocket.Chat provider setup (outgoing webhook + REST bot user)"
read_when:
  - Setting up Rocket.Chat provider
---
# Rocket.Chat

Updated: 2026-01-07

Status: ready for single-workspace Rocket.Chat via outgoing webhook + REST API.

## Goals
- Receive mentions and DMs from Rocket.Chat.
- Reply via the official REST API (`chat.postMessage`).
- Keep routing deterministic: replies go back to the same room/thread.

## How it works
1. Rocket.Chat Outgoing Webhook posts message payloads to the Gateway.
2. The Gateway calls Rocket.Chat REST with a bot user token to reply.

## Setup (Rocket.Chat)
1. Create a bot user (or dedicated service user).
2. **Admin → Users → (bot) → Personal Access Tokens**.
   - Create a token and copy **Auth Token** + **User ID**.
3. **Admin → Integrations → New → Outgoing Webhook**:
   - Event: **Message Sent**
   - Trigger words: `@clawdbot` (or your bot username)
   - URL: `https://<gateway-host>:<port><path>`
   - Token: choose a strong token (must match `rocketchat.webhook.token`)
4. Add the bot user to the rooms where it should reply.

## Clawdbot config

```json5
{
  rocketchat: {
    enabled: true,
    baseUrl: "https://chat.example.com",
    authToken: "rc-auth-token",
    userId: "rc-user-id",
    botUsername: "clawdbot",
    dmPolicy: "pairing", // pairing | allowlist | open | disabled
    allowFrom: ["@alice", "user:123", "*"], // optional; "open" requires ["*"]
    groupPolicy: "open", // open | allowlist | disabled
    requireMention: true,
    rooms: {
      general: { allow: true },
      "#ops": { allow: true, requireMention: true },
      "*": { requireMention: true }
    },
    webhook: {
      token: "outgoing-token",
      host: "0.0.0.0",
      port: 8790,
      path: "/rocketchat/outgoing"
    }
  }
}
```

Notes:
- You can also set env vars `ROCKETCHAT_BASE_URL`, `ROCKETCHAT_AUTH_TOKEN`, `ROCKETCHAT_USER_ID`. If you do, keep `rocketchat: { enabled: true, webhook: { token: ... } }` in config so the webhook listener starts.
- `alias`, `avatarUrl`, and `emoji` require the Rocket.Chat `message-impersonate` permission for the bot user.
- `rocketchat.rooms` keys can be room ids, names, or `#channel` names. Use `*` for defaults.

## Threads + files
- Thread replies use `tmid` from the outgoing webhook payload.
- File uploads use `rooms.media` and honor `rocketchat.mediaMaxMb` (fallback: `agent.mediaMaxMb`).

## Troubleshooting
- Ensure the outgoing webhook token matches `rocketchat.webhook.token`.
- Verify the webhook URL is reachable from Rocket.Chat.
- Use `clawdbot status --deep` or `providers.status` to probe credentials.
