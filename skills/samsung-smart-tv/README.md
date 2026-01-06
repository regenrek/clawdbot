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

## Quick setup (SmartThings PAT, fastest)

1. Generate a SmartThings Personal Access Token (PAT) on the SmartThings tokens page.
2. Export env vars (or inject via Clawdbot config):

```bash
export SMARTTHINGS_PAT='...'
export SMARTTHINGS_DEVICE_ID='...'
export SAMSUNG_TV_IP='192.168.1.50'
export SAMSUNG_TV_MAC='aa:bb:cc:dd:ee:ff' # optional unless you need Wake-on-LAN
```

3. Test:

```bash
tvctl doctor
tvctl st status
tvctl key KEY_HOME
tvctl volume up
```

## Recommended setup (SmartThings OAuth, long-term)

You need `SMARTTHINGS_CLIENT_ID` + `SMARTTHINGS_CLIENT_SECRET` from an OAuth-In app created via SmartThings CLI.

Then:

```bash
export SMARTTHINGS_CLIENT_ID='...'
export SMARTTHINGS_CLIENT_SECRET='...'

tvctl st auth oauth --redirect-uri http://127.0.0.1:8789/callback --open
```

Tokens will be stored in your tvctl config file (see `tvctl doctor` for the path) and auto-refreshed.

## Clawdbot integration

Copy this folder into one of:

- `~/.clawdbot/skills/samsung-smart-tv`
- `<workspace>/skills/samsung-smart-tv`

Then set env vars under `skills.entries` in `~/.clawdbot/clawdbot.json`.
