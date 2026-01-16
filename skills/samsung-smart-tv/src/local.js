import {
  getAwakeSamsungDevices,
  getLastConnectedDevice,
  Keys,
  SamsungTvRemote,
} from 'samsung-tv-remote';
import { createLogger } from './logger.js';
import { asNumber, asString } from './utils.js';

const log = createLogger();

const DEFAULT_PORT = 8002;

/**
 * @typedef {{
 *   ip: string,
 *   mac?: string,
 *   port: number,
 *   name: string,
 *   timeoutMs: number,
 *   keyDelayMs: number,
 * }} LocalSettings
 */

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @returns {LocalSettings}
 */
export function getLocalSettings(cfg) {
  const samsung = cfg.samsung || {};
  const ip = asString(samsung.ip);
  const mac = asString(samsung.mac) || undefined;

  return {
    ip,
    mac,
    port: asNumber(samsung.port) ?? DEFAULT_PORT,
    name: samsung.name ?? 'TVCTL',
    timeoutMs: asNumber(samsung.timeoutMs) ?? 5000,
    keyDelayMs: asNumber(samsung.keyDelayMs) ?? 200,
  };
}

/**
 * @param {LocalSettings} s
 */
function createRemote(s) {
  // samsung-tv-remote stores pairing tokens on the host OS keyed by `name`,
  // so using a stable name matters.
  return new SamsungTvRemote({
    ip: s.ip,
    mac: s.mac,
    name: s.name,
    port: s.port,
    timeout: s.timeoutMs,
    wsConnectionTimeout: s.timeoutMs,
    keyDelay: s.keyDelayMs,
  });
}

/**
 * @param {number} timeoutMs
 */
export async function discoverLocal(timeoutMs = 1500) {
  return getAwakeSamsungDevices(timeoutMs);
}

/**
 * Best-effort find a target device to control.
 * This is primarily for a one-time setup flow; bot runs should set SAMSUNG_TV_IP explicitly.
 *
 * @param {import('./config.js').TvctlConfig} cfg
 * @returns {Promise<{ip: string, mac?: string}>}
 */
export async function resolveLocalDevice(cfg) {
  const s = getLocalSettings(cfg);
  if (s.ip) return { ip: s.ip, mac: s.mac };

  const last = await getLastConnectedDevice();
  if (last?.ip) {
    log.info('Using last connected TV from local store:', last.ip);
    return { ip: last.ip, mac: last.mac };
  }

  const devices = await discoverLocal(2000);
  if (devices.length === 1) return { ip: devices[0].ip, mac: devices[0].mac };

  if (devices.length === 0) {
    throw new Error('No awake Samsung TVs found on LAN. Set SAMSUNG_TV_IP (and optionally SAMSUNG_TV_MAC).');
  }

  const list = devices.map((d) => `${d.ip}${d.mac ? ` (${d.mac})` : ''}`).join(', ');
  throw new Error(`Multiple Samsung TVs found on LAN: ${list}. Set SAMSUNG_TV_IP to choose one.`);
}

const KEY_ALIASES = new Map([
  ['HOME', 'KEY_HOME'],
  ['BACK', 'KEY_RETURN'],
  ['RETURN', 'KEY_RETURN'],
  ['UP', 'KEY_UP'],
  ['DOWN', 'KEY_DOWN'],
  ['LEFT', 'KEY_LEFT'],
  ['RIGHT', 'KEY_RIGHT'],
  ['OK', 'KEY_ENTER'],
  ['ENTER', 'KEY_ENTER'],
  ['VOLUP', 'KEY_VOLUP'],
  ['VOLDOWN', 'KEY_VOLDOWN'],
  ['MUTE', 'KEY_MUTE'],
  ['PLAY', 'KEY_PLAY'],
  ['PAUSE', 'KEY_PAUSE'],
  ['STOP', 'KEY_STOP'],
  ['POWER', 'KEY_POWER'],
]);

/**
 * @param {string} raw
 */
export function normalizeKeyName(raw) {
  const up = raw.trim().toUpperCase();
  if (!up) throw new Error('Empty key');
  const canonical = KEY_ALIASES.get(up) || up;
  if (canonical.startsWith('KEY_')) return canonical;
  return `KEY_${canonical}`;
}

/**
 * @param {string} name
 */
export function resolveKey(name) {
  const k = normalizeKeyName(name);
  // Keys is an enum-like object.
  if (k in Keys) return Keys[k];
  // Some versions may accept raw key strings.
  return k;
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {string} keyName
 */
export async function sendKey(cfg, keyName) {
  const s = getLocalSettings(cfg);
  if (!s.ip) throw new Error('Missing SAMSUNG_TV_IP (or config.samsung.ip).');

  const remote = createRemote(s);
  const key = resolveKey(keyName);

  try {
    await remote.sendKey(key);
  } finally {
    try {
      await remote.disconnect();
    } catch {
      // ignore
    }
  }
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {string[]} keyNames
 */
export async function sendKeys(cfg, keyNames) {
  const s = getLocalSettings(cfg);
  if (!s.ip) throw new Error('Missing SAMSUNG_TV_IP (or config.samsung.ip).');

  const remote = createRemote(s);
  const keys = keyNames.map(resolveKey);

  try {
    await remote.sendKeys(keys);
  } finally {
    try {
      await remote.disconnect();
    } catch {
      // ignore
    }
  }
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 */
export async function wake(cfg) {
  const s = getLocalSettings(cfg);
  if (!s.ip) throw new Error('Missing SAMSUNG_TV_IP (or config.samsung.ip).');
  if (!s.mac) throw new Error('Missing SAMSUNG_TV_MAC (required for Wake-on-LAN).');

  const remote = createRemote(s);
  try {
    await remote.wakeTV();
  } finally {
    try {
      await remote.disconnect();
    } catch {
      // ignore
    }
  }
}

/**
 * @returns {string[]}
 */
export function listKnownKeys() {
  return Object.keys(Keys).filter((k) => k.startsWith('KEY_')).sort();
}
