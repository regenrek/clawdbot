import { SmartThingsClient } from './smartthings.js';
import { sendKey, sendKeys } from './local.js';
import { createLogger } from './logger.js';

const log = createLogger();

/**
 * @param {import('./config.js').TvctlConfig} cfg
 */
function getSmartThingsClientIfConfigured(cfg) {
  const st = cfg.smartthings || {};
  if (!st.deviceId) return null;

  try {
    return new SmartThingsClient({ cfg });
  } catch (e) {
    // Auth not configured.
    return null;
  }
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @returns {Promise<void>}
 */
export async function powerOn(cfg) {
  const st = getSmartThingsClientIfConfigured(cfg);
  if (st) {
    await st.executeCommands(cfg.smartthings.deviceId, [
      { capability: 'switch', command: 'on' },
    ]);
    return;
  }

  // Fallback: toggle power locally (not perfectly deterministic).
  log.warn('SmartThings not configured. Falling back to local KEY_POWER toggle.');
  await sendKey(cfg, 'KEY_POWER');
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @returns {Promise<void>}
 */
export async function powerOff(cfg) {
  const st = getSmartThingsClientIfConfigured(cfg);
  if (st) {
    await st.executeCommands(cfg.smartthings.deviceId, [
      { capability: 'switch', command: 'off' },
    ]);
    return;
  }

  log.warn('SmartThings not configured. Falling back to local KEY_POWEROFF/KEY_POWER.');
  try {
    await sendKey(cfg, 'KEY_POWEROFF');
  } catch {
    await sendKey(cfg, 'KEY_POWER');
  }
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {'up'|'down'} dir
 */
export async function volumeStep(cfg, dir) {
  const st = getSmartThingsClientIfConfigured(cfg);
  if (st) {
    const cmd = dir === 'up' ? 'volumeUp' : 'volumeDown';
    await st.executeCommands(cfg.smartthings.deviceId, [
      { capability: 'audioVolume', command: cmd },
    ]);
    return;
  }

  const key = dir === 'up' ? 'KEY_VOLUP' : 'KEY_VOLDOWN';
  await sendKey(cfg, key);
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {number} value
 */
export async function setVolume(cfg, value) {
  const st = getSmartThingsClientIfConfigured(cfg);
  if (st) {
    await st.executeCommands(cfg.smartthings.deviceId, [
      { capability: 'audioVolume', command: 'setVolume', arguments: [value] },
    ]);
    return;
  }

  throw new Error('Set volume requires SmartThings (audioVolume.setVolume). Configure SMARTTHINGS_DEVICE_ID + auth.');
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {boolean} mute
 */
export async function setMute(cfg, mute) {
  const st = getSmartThingsClientIfConfigured(cfg);
  if (st) {
    await st.executeCommands(cfg.smartthings.deviceId, [
      { capability: 'audioMute', command: mute ? 'mute' : 'unmute' },
    ]);
    return;
  }

  // Local fallback for mute only.
  if (mute) {
    await sendKey(cfg, 'KEY_MUTE');
    return;
  }
  throw new Error('Unmute without SmartThings is ambiguous. Configure SmartThings or use KEY_MUTE to toggle.');
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @returns {Promise<string[]>}
 */
export async function listInputs(cfg) {
  const st = getSmartThingsClientIfConfigured(cfg);
  if (!st) throw new Error('Input listing requires SmartThings.');

  const status = await st.getDeviceStatus(cfg.smartthings.deviceId);
  const supported =
    status?.components?.main?.mediaInputSource?.supportedInputSources?.value;

  if (Array.isArray(supported)) return supported;

  // Some devices return JSON-stringified arrays or other shapes.
  if (typeof supported === 'string') {
    try {
      const parsed = JSON.parse(supported);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }

  return [];
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {string} input
 */
export async function setInput(cfg, input) {
  const st = getSmartThingsClientIfConfigured(cfg);
  if (!st) throw new Error('Input switching requires SmartThings.');

  await st.executeCommands(cfg.smartthings.deviceId, [
    { capability: 'mediaInputSource', command: 'setInputSource', arguments: [input] },
  ]);
}

/**
 * Hybrid key: prefer local keys, but if local isn't configured, attempt SmartThings remoteControl.
 *
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {string} key
 */
export async function hybridKey(cfg, key) {
  try {
    await sendKey(cfg, key);
    return;
  } catch (e) {
    // local failed, try SmartThings
  }

  const st = getSmartThingsClientIfConfigured(cfg);
  if (!st) throw new Error('Neither local nor SmartThings control is configured.');

  // SmartThings Samsung remoteControl generally uses tokens like HOME/UP/DOWN/LEFT/RIGHT/OK/BACK
  const map = {
    KEY_HOME: 'HOME',
    KEY_UP: 'UP',
    KEY_DOWN: 'DOWN',
    KEY_LEFT: 'LEFT',
    KEY_RIGHT: 'RIGHT',
    KEY_ENTER: 'OK',
    KEY_RETURN: 'BACK',
    KEY_BACK: 'BACK',
  };
  const normalized = key.trim().toUpperCase();
  const stKey = map[normalized] || map[`KEY_${normalized}`] || normalized.replace(/^KEY_/, '');

  await st.executeCommands(cfg.smartthings.deviceId, [
    { capability: 'samsungvd.remoteControl', command: 'send', arguments: [stKey] },
  ]);
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @param {string[]} keys
 */
export async function hybridKeys(cfg, keys) {
  // Try local first for speed.
  try {
    await sendKeys(cfg, keys);
    return;
  } catch {
    // fall back to sequential remoteControl sends
  }

  for (const k of keys) {
    await hybridKey(cfg, k);
  }
}
