import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

/**
 * @param {string} s
 */
export function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Redact secrets in logs.
 * @param {string|undefined|null} value
 */
export function redact(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * @param {string} url
 */
export function openUrlInBrowser(url) {
  const u = new URL(url);
  const platform = process.platform;

  /** @type {{cmd: string, args: string[]}} */
  let launch;
  if (platform === 'darwin') {
    launch = { cmd: 'open', args: [u.toString()] };
  } else if (platform === 'win32') {
    // "start" is a cmd.exe builtin.
    launch = { cmd: 'cmd', args: ['/c', 'start', '', u.toString()] };
  } else {
    launch = { cmd: 'xdg-open', args: [u.toString()] };
  }

  const child = spawn(launch.cmd, launch.args, { stdio: 'ignore', detached: true });
  child.unref();
}

/**
 * @param {string} s
 */
export function isProbablyIp(s) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

/**
 * @param {string} s
 */
export function isProbablyMac(s) {
  return /^[0-9a-fA-F]{2}([:\-])[0-9a-fA-F]{2}(\1[0-9a-fA-F]{2}){4}$/.test(s);
}

/**
 * RFC 7636 style state value for OAuth flow.
 */
export function newState() {
  return randomBytes(16).toString('hex');
}

/**
 * @param {unknown} v
 * @returns {string}
 */
export function asString(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

/**
 * @param {unknown} v
 * @returns {number|undefined}
 */
export function asNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Parse a CLI --arg value:
 * - If it's valid JSON (object/array/number/bool/null/string), use parsed value
 * - Else use raw string
 * @param {string} raw
 * @returns {any}
 */
export function parseArg(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}
