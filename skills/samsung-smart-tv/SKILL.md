---
name: samsung-smart-tv
description: Control a Samsung Smart TV (Neo QLED, Tizen) via SmartThings API plus local WebSocket remote (hybrid, bot-friendly CLI).
metadata: {"clawdbot":{"emoji":"📺","requires":{"bins":["node"]},"homepage":"https://developer.smartthings.com/docs/getting-started/quickstart"}}
---

## What this skill does

This skill gives the agent a **deterministic CLI surface** for controlling a Samsung Smart TV:

- **Local LAN control (fast):** send remote keys via Samsung's WebSocket remote protocol (2016+ TVs).
- **SmartThings cloud control (reliable power/state):** query status and send capability commands.

All actions are executed via the `tvctl` CLI located in this skill folder.

## Safety and reliability rules

1. Prefer **SmartThings** for power state changes (`on`, `off`) and for reading state.
2. Prefer **local** for navigation keys (HOME/BACK/UP/DOWN/etc) because it's low latency.
3. Before issuing non-trivial commands, run `tvctl doctor` once to verify configuration.
4. When you need a supported input name, always read it from status first:
   - `tvctl st status` and look for `supportedInputSources` under `mediaInputSource`.

## Where the CLI lives

- `{baseDir}/bin/tvctl.js` (binary name: `tvctl`)
- Run it with either:
  - `tvctl ...` (if installed via `npm i` in this folder)
  - or `node {baseDir}/bin/tvctl.js ...` (always works)

## Most common commands

### Power
- `tvctl on`
- `tvctl off`

### Volume and mute
- `tvctl volume set 15`
- `tvctl volume up`
- `tvctl volume down`
- `tvctl mute`
- `tvctl unmute`

### Inputs
- `tvctl input list`
- `tvctl input set HDMI1`

### Remote keys (local)
- `tvctl key KEY_HOME`
- `tvctl keys KEY_HOME KEY_DOWN KEY_ENTER`

### SmartThings generic command (escape hatch)
Use this when a device exposes a custom capability (Samsung TVs often do):

- `tvctl st command --capability samsungvd.remoteControl --command send --arg HOME`
- `tvctl st command --capability custom.launchapp --command launchApp --arg 3201907018807`

## Troubleshooting workflow

1. `tvctl doctor`
2. If local control fails:
   - `tvctl local discover`
   - verify `SAMSUNG_TV_IP`, `SAMSUNG_TV_PORT` (8002 is common), and accept the pairing prompt on the TV.
3. If SmartThings fails:
   - `tvctl st devices`
   - `tvctl st status`
   - If using a PAT and it expired, re-auth (PATs are short-lived).
   - For long-term use, set up OAuth and run `tvctl st auth oauth`.
