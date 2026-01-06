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

Then:

```bash
export SMARTTHINGS_CLIENT_ID='...'
export SMARTTHINGS_CLIENT_SECRET='...'

tvctl st auth oauth --redirect-uri http://127.0.0.1:8789/callback --open
```

Tokens are stored in your tvctl config file (see `tvctl doctor` for the path) and auto-refreshed.

Docker note: mount the tvctl config dir so refresh tokens persist (Linux default: `~/.config/tvctl`).

## Clawdbot integration

Copy this folder into one of:

- `~/.clawdbot/skills/samsung-smart-tv`
- `<workspace>/skills/samsung-smart-tv`

Then set env vars under `skills.entries` in `~/.clawdbot/clawdbot.json`.
