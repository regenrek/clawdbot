# Samsung Smart TV hybrid control skill (Clawdbot)

This folder is a self-contained Clawdbot Skill + a Node.js CLI (`tvctl`) that can control a Samsung Smart TV via:

- SmartThings cloud API
- Samsung local WebSocket remote protocol (LAN)

## Install

```bash
cd samsung-smart-tv
npm install
npm run lint
```

## SmartThings OAuth setup (long-term)

You need `SMARTTHINGS_CLIENT_ID` + `SMARTTHINGS_CLIENT_SECRET` from an OAuth-In app created via SmartThings CLI.
Docs: https://developer.smartthings.com/

Step 1: Install SmartThings CLI
```bash
npm i -g @smartthings/cli
```

Step 2: Create the OAuth app
```bash
smartthings apps:create
```

Step 3: Answer the prompts
- What kind of app? → `OAuth-In App`
- App Name: `Nepp TV Control`
- Display Name: `Nepp`
- Description: `TV control bot`
- Redirect URI: `http://127.0.0.1:8789/callback`
- Scopes:
  - `r:devices:*`
  - `x:devices:*`

Step 4: Save the credentials
- Client ID: `...`
- Client Secret: `...`

Step 5: Run OAuth login
```bash
export SMARTTHINGS_CLIENT_ID='...'
export SMARTTHINGS_CLIENT_SECRET='...'

tvctl st auth oauth --redirect-uri http://127.0.0.1:8789/callback --open
```

Step 6: Pick device id
```bash
tvctl st devices
```
Copy `deviceId` into `SMARTTHINGS_DEVICE_ID`.

Tokens are stored in your tvctl config file (see `tvctl doctor` for the path) and auto-refreshed.

Docker note: run the OAuth browser flow on the host, then mount the tvctl config dir into the container so refresh tokens persist (Linux default: `~/.config/tvctl` → `/root/.config/tvctl`).

## Clawdbot integration

Copy this folder into one of:

- `~/.clawdbot/skills/samsung-smart-tv`
- `<workspace>/skills/samsung-smart-tv`

Then set env vars under `skills.entries` in `~/.clawdbot/clawdbot.json`.
