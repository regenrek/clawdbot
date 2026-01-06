import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asNumber, asString, isProbablyIp, isProbablyMac } from './utils.js';

/**
 * @typedef {{
 *   samsung?: {
 *     ip?: string,
 *     mac?: string,
 *     port?: number,
 *     name?: string,
 *     timeoutMs?: number,
 *     keyDelayMs?: number,
 *   },
 *   smartthings?: {
 *     deviceId?: string,
 *     auth?: {
 *       mode?: 'pat'|'oauth',
 *       pat?: string,
 *       oauth?: {
 *         accessToken?: string,
 *         refreshToken?: string,
 *         expiresAt?: number,
 *         scope?: string,
 *       }
 *     }
 *   }
 * }} TvctlConfig
 */

const DEFAULT_APP_DIR = 'tvctl';

/**
 * @returns {string}
 */
export function defaultConfigDir() {
  const home = os.homedir();
  const platform = process.platform;

  // Allow explicit override.
  if (process.env.TVCTL_CONFIG_DIR) return process.env.TVCTL_CONFIG_DIR;

  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), DEFAULT_APP_DIR);
  }

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', DEFAULT_APP_DIR);
  }

  // Linux and others: XDG.
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, DEFAULT_APP_DIR);
}

/**
 * @returns {string}
 */
export function defaultConfigPath() {
  if (process.env.TVCTL_CONFIG) return process.env.TVCTL_CONFIG;
  return path.join(defaultConfigDir(), 'config.json');
}

/**
 * @param {string} p
 */
async function ensureDirForFile(p) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * @returns {Promise<TvctlConfig>}
 */
export async function loadConfig() {
  const p = defaultConfigPath();
  try {
    const raw = await fs.readFile(p, 'utf-8');
    /** @type {TvctlConfig} */
    const cfg = JSON.parse(raw);
    return cfg || {};
  } catch {
    return {};
  }
}

/**
 * @param {TvctlConfig} cfg
 */
export async function saveConfig(cfg) {
  const p = defaultConfigPath();
  await ensureDirForFile(p);

  const tmp = `${p}.tmp`;
  const data = JSON.stringify(cfg, null, 2);

  // Write temp then rename (best effort atomic).
  await fs.writeFile(tmp, data, { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmp, p);

  // Ensure strict perms on unix.
  try {
    if (process.platform !== 'win32') {
      await fs.chmod(p, 0o600);
    }
  } catch {
    // ignore
  }
}

/**
 * Merge env vars on top of config file.
 * Env wins. Keeps config deterministic for bot runs.
 *
 * @param {TvctlConfig} cfg
 * @returns {TvctlConfig}
 */
export function applyEnvOverrides(cfg) {
  const next = structuredClone(cfg || {});

  next.samsung = next.samsung || {};
  next.smartthings = next.smartthings || {};
  next.smartthings.auth = next.smartthings.auth || {};

  // Samsung local
  const ip = process.env.SAMSUNG_TV_IP || process.env.SAMSUNG_IP;
  const mac = process.env.SAMSUNG_TV_MAC || process.env.SAMSUNG_MAC;
  const port = process.env.SAMSUNG_TV_PORT || process.env.SAMSUNG_PORT;
  const name = process.env.SAMSUNG_TV_NAME;
  const timeoutMs = process.env.SAMSUNG_TV_TIMEOUT_MS;
  const keyDelayMs = process.env.SAMSUNG_TV_KEY_DELAY_MS;

  if (ip && isProbablyIp(ip)) next.samsung.ip = ip;
  if (mac && isProbablyMac(mac)) next.samsung.mac = mac;
  const portN = asNumber(port);
  if (portN) next.samsung.port = portN;
  if (name) next.samsung.name = name;
  const tmoN = asNumber(timeoutMs);
  if (tmoN) next.samsung.timeoutMs = tmoN;
  const kdN = asNumber(keyDelayMs);
  if (kdN != null) next.samsung.keyDelayMs = kdN;

  // SmartThings basics
  const devId = process.env.SMARTTHINGS_DEVICE_ID || process.env.ST_DEVICE_ID;
  if (devId) next.smartthings.deviceId = devId;

  // Auth: PAT (easy but short-lived)
  const pat = process.env.SMARTTHINGS_PAT || process.env.SMARTTHINGS_TOKEN || process.env.ST_PAT;
  if (pat) {
    next.smartthings.auth.mode = 'pat';
    // Do NOT store PAT by default (env-only). But keep it in-memory for this run.
    next.smartthings.auth.pat = pat;
  }

  // Auth: OAuth (recommended for long-term)
  const accessToken = process.env.SMARTTHINGS_ACCESS_TOKEN;
  const refreshToken = process.env.SMARTTHINGS_REFRESH_TOKEN;
  const expiresAt = process.env.SMARTTHINGS_EXPIRES_AT;

  if (accessToken || refreshToken || expiresAt) {
    next.smartthings.auth.mode = 'oauth';
    next.smartthings.auth.oauth = next.smartthings.auth.oauth || {};
    if (accessToken) next.smartthings.auth.oauth.accessToken = accessToken;
    if (refreshToken) next.smartthings.auth.oauth.refreshToken = refreshToken;
    const expN = asNumber(expiresAt);
    if (expN) next.smartthings.auth.oauth.expiresAt = expN;
  }

  return next;
}

/**
 * Get an effective config object (file + env overrides).
 * @returns {Promise<{configPath: string, config: TvctlConfig}>}
 */
export async function getEffectiveConfig() {
  const cfg = await loadConfig();
  const effective = applyEnvOverrides(cfg);
  return { configPath: defaultConfigPath(), config: effective };
}

/**
 * Update config with a mutation function and persist.
 * Env overrides are NOT written.
 *
 * @param {(cfg: TvctlConfig) => void} mutate
 */
export async function updateConfig(mutate) {
  const cfg = await loadConfig();
  mutate(cfg);
  await saveConfig(cfg);
}

/**
 * Basic validation helpers (soft).
 * @param {TvctlConfig} cfg
 */
export function summarizeConfig(cfg) {
  const samsung = cfg.samsung || {};
  const st = cfg.smartthings || {};
  const auth = st.auth || {};

  return {
    samsung: {
      ip: asString(samsung.ip),
      mac: asString(samsung.mac),
      port: samsung.port ?? 8002,
      name: samsung.name ?? 'TVCTL',
    },
    smartthings: {
      deviceId: asString(st.deviceId),
      mode: auth.mode || (auth.pat ? 'pat' : auth.oauth?.refreshToken ? 'oauth' : ''),
    },
  };
}
