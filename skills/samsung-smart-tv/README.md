# Samsung Smart TV (Clawdbot skill)

Hybrid control: SmartThings cloud + local LAN WebSocket remote.

## Install

```bash
cd samsung-smart-tv
npm install
npm run lint
```

## SmartThings OAuth setup (required for cloud control)

1) Create OAuth app
```bash
npx -y @smartthings/cli apps:create
```

2) Prompts
- App type: `OAuth-In App`
- Redirect URI: `http://127.0.0.1:8789/callback`
- Scopes: `r:devices:*`, `x:devices:*`

3) Save Client ID + Client Secret

4) Run OAuth login
```bash
export SMARTTHINGS_CLIENT_ID='...'
export SMARTTHINGS_CLIENT_SECRET='...'

tvctl st auth oauth --redirect-uri http://127.0.0.1:8789/callback --open
```

5) Set device id
```bash
tvctl st devices
```
Copy `deviceId` into `SMARTTHINGS_DEVICE_ID`.

Tokens are stored in tvctl config (see `tvctl doctor`).

Docker: run OAuth on host, then mount tvctl config into container (`~/.config/tvctl` → `/root/.config/tvctl`).

## Local LAN (optional)

- `SAMSUNG_TV_IP` required.
- `SAMSUNG_TV_PORT` optional (default 8002).
- `SAMSUNG_TV_MAC` required for Wake-on-LAN.

## Clawdbot integration

Copy this folder into:
- `~/.clawdbot/skills/samsung-smart-tv`
- or `<workspace>/skills/samsung-smart-tv`

Then set env vars under `skills.entries` in `~/.clawdbot/clawdbot.json`.
