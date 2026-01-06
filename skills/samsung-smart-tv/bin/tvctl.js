#!/usr/bin/env node
import { Command } from 'commander';

import { getEffectiveConfig, summarizeConfig, updateConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { parseArg, redact } from '../src/utils.js';

import {
  discoverLocal,
  listKnownKeys,
  resolveLocalDevice,
  sendKey as localSendKey,
  sendKeys as localSendKeys,
  wake as localWake,
} from '../src/local.js';

import { SmartThingsClient, oauthLoginInteractive } from '../src/smartthings.js';
import {
  hybridKey,
  hybridKeys,
  listInputs,
  powerOff,
  powerOn,
  setInput,
  setMute,
  setVolume,
  volumeStep,
} from '../src/hybrid.js';

const log = createLogger();

const DEFAULT_SCOPE = 'r:devices:* x:devices:*';

function print(obj, asJson) {
  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(obj, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(obj);
  }
}

async function main() {
  const program = new Command();

  program
    .name('tvctl')
    .description('Samsung Smart TV control (local WebSocket + SmartThings). Designed for bot use.')
    .option('--json', 'output machine-readable JSON')
    .option('--config <path>', 'override config path (same as TVCTL_CONFIG)');

  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.config) process.env.TVCTL_CONFIG = opts.config;
  });

  program
    .command('doctor')
    .description('Verify configuration and show what tvctl will use.')
    .action(async () => {
      const { configPath, config } = await getEffectiveConfig();
      const summary = summarizeConfig(config);

      const out = {
        configPath,
        samsung: summary.samsung,
        smartthings: summary.smartthings,
        notes: [],
      };

      if (!summary.samsung.ip) out.notes.push('Local: set SAMSUNG_TV_IP (and optionally SAMSUNG_TV_MAC).');
      if (!summary.smartthings.deviceId) out.notes.push('SmartThings: set SMARTTHINGS_DEVICE_ID.');
      if (!summary.smartthings.mode) out.notes.push('SmartThings: set SMARTTHINGS_PAT (short-lived) or run OAuth login.');

      print(out, program.opts().json);
    });

  const local = program.command('local').description('Local LAN control (Samsung WebSocket remote).');

  local
    .command('discover')
    .description('Discover awake Samsung TVs on the LAN (best-effort).')
    .option('--timeout <ms>', 'discovery timeout in ms', '1500')
    .action(async (opts) => {
      const timeout = Number(opts.timeout);
      const devices = await discoverLocal(timeout);
      print(devices, program.opts().json);
    });

  local
    .command('resolve')
    .description('Resolve which TV would be targeted (uses config, last connected, or discovery).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      const device = await resolveLocalDevice(config);
      print(device, program.opts().json);
    });

  local
    .command('wake')
    .description('Send Wake-on-LAN magic packet (requires SAMSUNG_TV_MAC).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      await localWake(config);
      print({ ok: true }, program.opts().json);
    });

  local
    .command('key <key>')
    .description('Send a single remote key locally (KEY_HOME, KEY_VOLUP, etc).')
    .action(async (key) => {
      const { config } = await getEffectiveConfig();
      await localSendKey(config, key);
      print({ ok: true }, program.opts().json);
    });

  local
    .command('keys [keys...]')
    .description('Send multiple remote keys locally.')
    .action(async (keys) => {
      const { config } = await getEffectiveConfig();
      await localSendKeys(config, keys || []);
      print({ ok: true }, program.opts().json);
    });

  local
    .command('keys-list')
    .description('List all known key constants.')
    .action(async () => {
      const keys = listKnownKeys();
      print(keys, program.opts().json);
    });

  const st = program.command('st').description('SmartThings cloud control.');

  st
    .command('devices')
    .description('List SmartThings devices visible to the current token.')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      const client = new SmartThingsClient({ cfg: config });
      const devices = await client.listDevices();
      // Show small, useful fields.
      const slim = devices.map((d) => ({
        deviceId: d.deviceId,
        label: d.label,
        name: d.name,
        manufacturerName: d.manufacturerName,
        modelName: d.modelName,
      }));
      print(slim, program.opts().json);
    });

  st
    .command('status')
    .description('Get full status for configured SMARTTHINGS_DEVICE_ID.')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      if (!config.smartthings?.deviceId) throw new Error('Set SMARTTHINGS_DEVICE_ID first.');
      const client = new SmartThingsClient({ cfg: config });
      const status = await client.getDeviceStatus(config.smartthings.deviceId);
      print(status, program.opts().json);
    });

  st
    .command('describe')
    .description('Get device description for configured SMARTTHINGS_DEVICE_ID.')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      if (!config.smartthings?.deviceId) throw new Error('Set SMARTTHINGS_DEVICE_ID first.');
      const client = new SmartThingsClient({ cfg: config });
      const desc = await client.getDeviceDescription(config.smartthings.deviceId);
      print(desc, program.opts().json);
    });

  st
    .command('command')
    .description('Execute a generic SmartThings capability command.')
    .requiredOption('--capability <capability>', 'capability id, e.g. switch, audioVolume, mediaInputSource')
    .requiredOption('--command <command>', 'command name, e.g. on, setVolume, setInputSource')
    .option('--component <component>', 'component name (default: main)', 'main')
    .option('--arg <value...>', 'repeatable argument (JSON-parsed when possible)')
    .action(async (opts) => {
      const { config } = await getEffectiveConfig();
      if (!config.smartthings?.deviceId) throw new Error('Set SMARTTHINGS_DEVICE_ID first.');
      const client = new SmartThingsClient({ cfg: config });

      const args = (opts.arg || []).map(parseArg);

      const resp = await client.executeCommands(config.smartthings.deviceId, [
        { component: opts.component, capability: opts.capability, command: opts.command, arguments: args },
      ]);

      print(resp, program.opts().json);
    });

  const auth = st.command('auth').description('Authentication helpers (one-time setup).');

  auth
    .command('pat <token>')
    .description('Store a SmartThings PAT in the tvctl config file (not recommended; prefer env).')
    .option('--device-id <id>', 'also store SMARTTHINGS_DEVICE_ID')
    .action(async (token, opts) => {
      await updateConfig((cfg) => {
        cfg.smartthings = cfg.smartthings || {};
        cfg.smartthings.auth = cfg.smartthings.auth || {};
        cfg.smartthings.auth.mode = 'pat';
        cfg.smartthings.auth.pat = token;
        if (opts.deviceId) cfg.smartthings.deviceId = opts.deviceId;
      });
      print({ ok: true, stored: { pat: redact(token), deviceId: opts.deviceId || '' } }, program.opts().json);
    });

  auth
    .command('oauth')
    .description('Run SmartThings OAuth login and persist refresh token in tvctl config.')
    .requiredOption('--redirect-uri <uri>', 'redirect uri, e.g. http://127.0.0.1:8789/callback')
    .option('--scope <scope>', `OAuth scope (default: ${DEFAULT_SCOPE})`)
    .option('--open', 'attempt to open the authorization URL in your browser')
    .action(async (opts) => {
      const tokens = await oauthLoginInteractive({
        redirectUri: opts.redirectUri,
        scope: opts.scope,
        openBrowser: !!opts.open,
      });
      print({ ok: true, scope: tokens.scope, expires_in: tokens.expires_in }, program.opts().json);
    });

  // Hybrid top-level convenience commands

  program
    .command('on')
    .description('Power on (SmartThings preferred).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      await powerOn(config);
      print({ ok: true }, program.opts().json);
    });

  program
    .command('off')
    .description('Power off (SmartThings preferred).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      await powerOff(config);
      print({ ok: true }, program.opts().json);
    });

  const volume = program.command('volume').description('Volume control.');

  volume
    .command('set <value>')
    .description('Set volume (0-100). Requires SmartThings.')
    .action(async (value) => {
      const { config } = await getEffectiveConfig();
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('Volume must be 0-100.');
      await setVolume(config, v);
      print({ ok: true }, program.opts().json);
    });

  volume
    .command('up')
    .description('Volume up (SmartThings preferred, local fallback).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      await volumeStep(config, 'up');
      print({ ok: true }, program.opts().json);
    });

  volume
    .command('down')
    .description('Volume down (SmartThings preferred, local fallback).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      await volumeStep(config, 'down');
      print({ ok: true }, program.opts().json);
    });

  program
    .command('mute')
    .description('Mute (SmartThings preferred, local toggle fallback).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      await setMute(config, true);
      print({ ok: true }, program.opts().json);
    });

  program
    .command('unmute')
    .description('Unmute (requires SmartThings for deterministic behavior).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      await setMute(config, false);
      print({ ok: true }, program.opts().json);
    });

  const input = program.command('input').description('Input/source control (SmartThings).');

  input
    .command('list')
    .description('List supported inputs (from mediaInputSource.supportedInputSources).')
    .action(async () => {
      const { config } = await getEffectiveConfig();
      const inputs = await listInputs(config);
      print(inputs, program.opts().json);
    });

  input
    .command('set <input>')
    .description('Switch input (SmartThings mediaInputSource.setInputSource).')
    .action(async (inp) => {
      const { config } = await getEffectiveConfig();
      await setInput(config, inp);
      print({ ok: true }, program.opts().json);
    });

  program
    .command('key <key>')
    .description('Send a remote key (local preferred, SmartThings fallback).')
    .action(async (key) => {
      const { config } = await getEffectiveConfig();
      await hybridKey(config, key);
      print({ ok: true }, program.opts().json);
    });

  program
    .command('keys [keys...]')
    .description('Send multiple remote keys (local preferred).')
    .action(async (keys) => {
      const { config } = await getEffectiveConfig();
      await hybridKeys(config, keys || []);
      print({ ok: true }, program.opts().json);
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  const msg = err?.message || String(err);
  // eslint-disable-next-line no-console
  console.error(`[tvctl:error] ${msg}`);
  if (err?.payload) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(err.payload, null, 2));
  }
  process.exitCode = 1;
});
