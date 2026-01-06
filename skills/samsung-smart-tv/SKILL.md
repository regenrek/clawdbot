---
name: samsung-smart-tv
description: Control a Samsung Smart TV (Neo QLED, Tizen) via SmartThings API plus local WebSocket remote (hybrid, bot-friendly CLI).
metadata: {"clawdbot":{"emoji":"📺","requires":{"bins":["node"]},"homepage":"https://developer.smartthings.com/"}}
---

# Samsung Smart TV

Hybrid control via SmartThings (power/state) + local WebSocket remote (keys).

## Setup (SmartThings OAuth only)

1. Create OAuth app:
   - `npx -y @smartthings/cli apps:create`
2. Prompts:
   - App type: `OAuth-In App`
   - Redirect URI: `http://127.0.0.1:8789/callback`
   - Scopes: `r:devices:*`, `x:devices:*`
3. Save Client ID + Client Secret.
4. Run OAuth login:
   - `SMARTTHINGS_CLIENT_ID=... SMARTTHINGS_CLIENT_SECRET=... tvctl st auth oauth --redirect-uri http://127.0.0.1:8789/callback --open`
5. Set device id:
   - `tvctl st devices` → set `SMARTTHINGS_DEVICE_ID`.

## Local LAN (optional)

- `SAMSUNG_TV_IP` required.
- `SAMSUNG_TV_PORT` optional (default 8002).
- `SAMSUNG_TV_MAC` required for Wake-on-LAN.

## Docker

Run OAuth on host (needs browser), then mount tvctl config into container (Linux default `~/.config/tvctl` → `/root/.config/tvctl`).

## Common commands

- `tvctl doctor`
- `tvctl on` / `tvctl off`
- `tvctl volume set 15` / `tvctl volume up`
- `tvctl input list` / `tvctl input set HDMI1`
- `tvctl key KEY_HOME` / `tvctl keys KEY_HOME KEY_DOWN KEY_ENTER`
- `tvctl st status`
- `tvctl st command --capability mediaInputSource --command setInputSource --arg HDMI1`
