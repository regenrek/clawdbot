import http from 'node:http';
import { URL, URLSearchParams } from 'node:url';

import { createLogger } from './logger.js';
import { updateConfig } from './config.js';
import { newState, openUrlInBrowser, redact } from './utils.js';

const log = createLogger();

const API_BASE = 'https://api.smartthings.com/v1';
const OAUTH_AUTHORIZE = 'https://api.smartthings.com/oauth/authorize';
const OAUTH_TOKEN = 'https://api.smartthings.com/oauth/token';

const DEFAULT_SCOPE = 'r:devices:* x:devices:*';

/**
 * @typedef {{
 *   mode: 'oauth',
 *   accessToken: () => Promise<string>,
 *   describe: () => string,
 * }} AuthProvider
 */

/**
 * @param {string} s
 * @returns {string}
 */
function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

/**
 * @param {string} url
 * @param {{method?: string, headers?: Record<string,string>, body?: any, timeoutMs?: number}} opts
 */
async function fetchJson(url, opts = {}) {
  const method = opts.method ?? 'GET';
  const headers = { ...(opts.headers ?? {}) };
  const timeoutMs = opts.timeoutMs ?? 15000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof URLSearchParams) && !(body instanceof ArrayBuffer)) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg = typeof data === 'object' && data && 'message' in data ? data.message : res.statusText;
      const err = new Error(`SmartThings API error ${res.status}: ${msg}`);
      // @ts-ignore
      err.status = res.status;
      // @ts-ignore
      err.payload = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Get client credentials for SmartThings OAuth.
 * @returns {{clientId?: string, clientSecret?: string}}
 */
export function getOAuthClientCreds() {
  const clientId = process.env.SMARTTHINGS_CLIENT_ID || process.env.ST_CLIENT_ID;
  const clientSecret = process.env.SMARTTHINGS_CLIENT_SECRET || process.env.ST_CLIENT_SECRET;
  return { clientId, clientSecret };
}

/**
 * @param {import('./config.js').TvctlConfig} cfg
 * @returns {AuthProvider}
 */
export function getAuthProvider(cfg) {
 const st = cfg.smartthings || {};
 const auth = st.auth || {};

  // OAuth mode needs client creds in env and refresh token in config.
  const { clientId, clientSecret } = getOAuthClientCreds();
  const oauth = auth.oauth || {};
  if (!oauth.refreshToken) {
    throw new Error(
      'SmartThings OAuth not configured. Run: tvctl st auth oauth (and set SMARTTHINGS_DEVICE_ID).'
    );
  }
  if (!clientId || !clientSecret) {
    throw new Error('SMARTTHINGS_CLIENT_ID and SMARTTHINGS_CLIENT_SECRET are required for OAuth refresh.');
  }

  /** @type {{accessToken?: string, refreshToken: string, expiresAt?: number, scope?: string}} */
  const state = {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    scope: oauth.scope,
  };

  async function refresh() {
    log.info('Refreshing SmartThings OAuth token...');
    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', state.refreshToken);
    params.set('client_id', clientId);

    const data = await fetchJson(OAUTH_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${b64(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
      timeoutMs: 20000,
    });

    state.accessToken = data.access_token;
    // SmartThings may rotate refresh tokens.
    if (data.refresh_token) state.refreshToken = data.refresh_token;
    if (typeof data.expires_in === 'number') {
      state.expiresAt = Date.now() + data.expires_in * 1000;
    } else {
      // Fallback: 24h
      state.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    }
    state.scope = data.scope || state.scope;

    // Persist refreshed tokens (best effort).
    await updateConfig((cfg2) => {
      cfg2.smartthings = cfg2.smartthings || {};
      cfg2.smartthings.auth = cfg2.smartthings.auth || {};
      cfg2.smartthings.auth.mode = 'oauth';
      cfg2.smartthings.auth.oauth = cfg2.smartthings.auth.oauth || {};
      cfg2.smartthings.auth.oauth.accessToken = state.accessToken;
      cfg2.smartthings.auth.oauth.refreshToken = state.refreshToken;
      cfg2.smartthings.auth.oauth.expiresAt = state.expiresAt;
      cfg2.smartthings.auth.oauth.scope = state.scope;
    });
  }

  async function accessToken() {
    const now = Date.now();
    const exp = state.expiresAt ?? 0;
    // Refresh if expires within 90 seconds, or missing access token.
    if (!state.accessToken || (exp && now >= exp - 90_000)) {
      await refresh();
    }
    return state.accessToken;
  }

  return {
    mode: 'oauth',
    accessToken,
    describe: () => `OAuth(refresh=${redact(state.refreshToken)})`,
  };
}

/**
 * @typedef {{
 *   deviceId: string,
 *   component?: string,
 *   capability: string,
 *   command: string,
 *   arguments?: any[],
 * }} DeviceCommand
 */

export class SmartThingsClient {
  /**
   * @param {{cfg: import('./config.js').TvctlConfig}}
   */
  constructor({ cfg }) {
    this.cfg = cfg;
    this.auth = getAuthProvider(cfg);
  }

  /** @type {import('./config.js').TvctlConfig} */
  cfg;
  /** @type {AuthProvider} */
  auth;

  /**
   * @param {string} path
   * @param {{method?: string, body?: any}} opts
   */
  async api(path, opts = {}) {
    const token = await this.auth.accessToken();
    return fetchJson(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: opts.body,
    });
  }

  async listDevices() {
    const data = await this.api('/devices');
    // Typical response: { items: [...] }
    return data.items || data;
  }

  /**
   * @param {string} deviceId
   */
  async getDeviceStatus(deviceId) {
    return this.api(`/devices/${deviceId}/status`);
  }

  /**
   * @param {string} deviceId
   */
  async getDeviceDescription(deviceId) {
    return this.api(`/devices/${deviceId}`);
  }

  /**
   * @param {string} deviceId
   * @param {Array<{component?: string, capability: string, command: string, arguments?: any[]}>} commands
   */
  async executeCommands(deviceId, commands) {
    const payload = {
      commands: commands.map((c) => ({
        component: c.component ?? 'main',
        capability: c.capability,
        command: c.command,
        arguments: c.arguments ?? [],
      })),
    };
    return this.api(`/devices/${deviceId}/commands`, { method: 'POST', body: payload });
  }
}

/**
 * One-time OAuth setup:
 * - starts a loopback HTTP listener for redirect_uri
 * - exchanges code for tokens
 * - stores refresh/access tokens in tvctl config
 *
 * @param {{redirectUri: string, scope?: string, openBrowser?: boolean}} opts
 */
export async function oauthLoginInteractive(opts) {
  const { clientId, clientSecret } = getOAuthClientCreds();
  if (!clientId || !clientSecret) {
    throw new Error('Set SMARTTHINGS_CLIENT_ID and SMARTTHINGS_CLIENT_SECRET first (created via SmartThings CLI).');
  }

  const redirectUri = opts.redirectUri;
  const scope = opts.scope || process.env.SMARTTHINGS_SCOPES || DEFAULT_SCOPE;
  const state = newState();

  const authUrl = new URL(OAUTH_AUTHORIZE);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  log.info('Open this URL to authorize SmartThings:');
  // eslint-disable-next-line no-console
  console.log(authUrl.toString());

  if (opts.openBrowser) {
    try {
      openUrlInBrowser(authUrl.toString());
    } catch (e) {
      log.warn('Could not auto-open browser:', e?.message || e);
    }
  }

  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' && redirect.protocol !== 'https:') {
    throw new Error('redirect_uri must be http(s). For local flow, use http://127.0.0.1:PORT/callback');
  }

  /** @type {{code?: string, state?: string}} */
  const result = await waitForOAuthRedirect({
    host: redirect.hostname,
    port: Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80)),
    path: redirect.pathname,
    expectedState: state,
  });

  if (!result.code) throw new Error('OAuth redirect received without ?code=');

  const tokens = await exchangeCodeForToken({
    clientId,
    clientSecret,
    redirectUri,
    code: result.code,
  });

  await updateConfig((cfg) => {
    cfg.smartthings = cfg.smartthings || {};
    cfg.smartthings.auth = cfg.smartthings.auth || {};
    cfg.smartthings.auth.mode = 'oauth';
    cfg.smartthings.auth.oauth = cfg.smartthings.auth.oauth || {};
    cfg.smartthings.auth.oauth.accessToken = tokens.access_token;
    cfg.smartthings.auth.oauth.refreshToken = tokens.refresh_token;
    cfg.smartthings.auth.oauth.scope = tokens.scope;
    cfg.smartthings.auth.oauth.expiresAt = Date.now() + (tokens.expires_in ?? 24 * 60 * 60) * 1000;
  });

  return tokens;
}

/**
 * @param {{host: string, port: number, path: string, expectedState: string}} opts
 * @returns {Promise<{code?: string, state?: string}>}
 */
function waitForOAuthRedirect(opts) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://${opts.host}:${opts.port}`);
        if (url.pathname !== opts.path) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const code = url.searchParams.get('code') || undefined;
        const state = url.searchParams.get('state') || undefined;

        if (!state || state !== opts.expectedState) {
          res.statusCode = 400;
          res.end('Invalid state. You can close this window.');
          server.close();
          reject(new Error('OAuth state mismatch.'));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('SmartThings linked. You can close this window and return to the terminal.');
        server.close();
        resolve({ code, state });
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.on('error', (e) => reject(e));
    server.listen(opts.port, opts.host, () => {
      log.info(`Listening for OAuth redirect on http://${opts.host}:${opts.port}${opts.path}`);
    });
  });
}

/**
 * @param {{clientId: string, clientSecret: string, redirectUri: string, code: string}} opts
 */
async function exchangeCodeForToken(opts) {
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', opts.code);
  params.set('redirect_uri', opts.redirectUri);
  params.set('client_id', opts.clientId);

  return fetchJson(OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${b64(`${opts.clientId}:${opts.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    timeoutMs: 20000,
  });
}
