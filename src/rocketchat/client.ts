import { loadConfig } from "../config/config.js";
import type { ClawdbotConfig } from "../config/types.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { RetryConfig } from "../infra/retry.js";
import { resolveRetryConfig, retryAsync } from "../infra/retry.js";

export type RocketChatAuth = {
  baseUrl: string;
  authToken: string;
  userId: string;
};

export type RocketChatRequestOptions = {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
  retry?: RetryConfig;
  signal?: AbortSignal;
};

export type RocketChatApiError = {
  success?: boolean;
  error?: string;
  errorType?: string;
};

export type RocketChatRoomInfo = {
  _id?: string;
  name?: string;
  t?: string;
};

export type RocketChatMe = {
  _id?: string;
  username?: string;
  name?: string;
};

export type RocketChatDmCreateResult = {
  room?: {
    t?: string;
    rid?: string;
    usernames?: string[];
  };
};

export type RocketChatRoomInfoResult = {
  room?: RocketChatRoomInfo;
};

export type RocketChatPostMessageResult = {
  message?: {
    _id?: string;
    rid?: string;
    msg?: string;
    ts?: string;
  };
};

export type RocketChatUploadResult = {
  file?: {
    _id?: string;
    url?: string;
  };
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY = {
  attempts: 3,
  minDelayMs: 400,
  maxDelayMs: 30_000,
  jitter: 0.1,
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

class RocketChatHttpError extends Error {
  status: number;
  statusText?: string;
  retryAfterMs?: number;
  responseText?: string;
  constructor(params: {
    message: string;
    status: number;
    statusText?: string;
    retryAfterMs?: number;
    responseText?: string;
  }) {
    super(params.message);
    this.name = "RocketChatHttpError";
    this.status = params.status;
    this.statusText = params.statusText;
    this.retryAfterMs = params.retryAfterMs;
    this.responseText = params.responseText;
  }
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (trimmed.endsWith("/api/v1")) {
    return trimmed.replace(/\/api\/v1$/, "");
  }
  return trimmed;
}

export function resolveRocketChatAuth(params?: {
  cfg?: ClawdbotConfig;
  baseUrl?: string;
  authToken?: string;
  userId?: string;
  env?: NodeJS.ProcessEnv;
}): RocketChatAuth {
  const cfg = params?.cfg ?? loadConfig();
  const env = params?.env ?? process.env;
  const baseUrl =
    params?.baseUrl?.trim() ||
    env.ROCKETCHAT_BASE_URL?.trim() ||
    cfg.rocketchat?.baseUrl?.trim() ||
    "";
  const authToken =
    params?.authToken?.trim() ||
    env.ROCKETCHAT_AUTH_TOKEN?.trim() ||
    cfg.rocketchat?.authToken?.trim() ||
    "";
  const userId =
    params?.userId?.trim() ||
    env.ROCKETCHAT_USER_ID?.trim() ||
    cfg.rocketchat?.userId?.trim() ||
    "";
  if (!baseUrl) {
    throw new Error("Rocket.Chat baseUrl is required (rocketchat.baseUrl)");
  }
  if (!authToken) {
    throw new Error(
      "Rocket.Chat authToken is required (rocketchat.authToken or ROCKETCHAT_AUTH_TOKEN)",
    );
  }
  if (!userId) {
    throw new Error(
      "Rocket.Chat userId is required (rocketchat.userId or ROCKETCHAT_USER_ID)",
    );
  }
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    authToken,
    userId,
  };
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: RocketChatRequestOptions["query"],
): URL {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const parsedDate = Date.parse(value);
  if (!Number.isFinite(parsedDate)) return undefined;
  return Math.max(0, parsedDate - Date.now());
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof RocketChatHttpError) {
    return RETRYABLE_STATUS.has(err.status);
  }
  const message = formatErrorMessage(err);
  return /timeout|timed out|connect|reset|closed|unavailable|network/i.test(
    message,
  );
}

async function requestRocketChatJson<T>(
  auth: RocketChatAuth,
  opts: RocketChatRequestOptions,
): Promise<T> {
  const url = buildUrl(auth.baseUrl, opts.path, opts.query);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (timeout.unref) timeout.unref();

  const headers: Record<string, string> = {
    "X-Auth-Token": auth.authToken,
    "X-User-Id": auth.userId,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: opts.signal ?? controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new RocketChatHttpError({
        message: `Rocket.Chat HTTP ${res.status}`,
        status: res.status,
        statusText: res.statusText,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
        responseText: text,
      });
    }
    if (!text) return {} as T;
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Rocket.Chat invalid JSON response: ${formatErrorMessage(err)}`,
      );
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "success" in parsed &&
      (parsed as RocketChatApiError).success === false
    ) {
      const msg =
        (parsed as RocketChatApiError).error ||
        "Rocket.Chat API request failed";
      throw new Error(msg);
    }
    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestRocketChatJsonWithRetry<T>(
  auth: RocketChatAuth,
  opts: RocketChatRequestOptions,
): Promise<T> {
  const retry = resolveRetryConfig(DEFAULT_RETRY, opts.retry);
  return retryAsync(
    () => requestRocketChatJson<T>(auth, opts),
    {
      ...retry,
      label: opts.path,
      shouldRetry: (err) => isRetryableError(err),
      retryAfterMs: (err) =>
        err instanceof RocketChatHttpError ? err.retryAfterMs : undefined,
    },
  );
}

export async function fetchRocketChatMe(
  auth: RocketChatAuth,
  opts?: { timeoutMs?: number; retry?: RetryConfig },
): Promise<RocketChatMe> {
  return requestRocketChatJsonWithRetry<RocketChatMe & RocketChatApiError>(
    auth,
    {
      method: "GET",
      path: "/api/v1/me",
      timeoutMs: opts?.timeoutMs,
      retry: opts?.retry,
    },
  );
}

export async function fetchRocketChatRoomInfo(
  auth: RocketChatAuth,
  params: { roomId?: string; roomName?: string; timeoutMs?: number },
): Promise<RocketChatRoomInfoResult> {
  return requestRocketChatJsonWithRetry<RocketChatRoomInfoResult>(
    auth,
    {
      method: "GET",
      path: "/api/v1/rooms.info",
      query: {
        roomId: params.roomId,
        roomName: params.roomName,
      },
      timeoutMs: params.timeoutMs,
    },
  );
}

export async function createRocketChatDm(
  auth: RocketChatAuth,
  params: { username: string; timeoutMs?: number },
): Promise<RocketChatDmCreateResult> {
  return requestRocketChatJsonWithRetry<RocketChatDmCreateResult>(
    auth,
    {
      method: "POST",
      path: "/api/v1/dm.create",
      body: { username: params.username },
      timeoutMs: params.timeoutMs,
    },
  );
}

export async function postRocketChatMessage(
  auth: RocketChatAuth,
  params: {
    roomId?: string;
    channel?: string;
    text?: string;
    tmid?: string;
    tshow?: boolean;
    alias?: string;
    avatar?: string;
    emoji?: string;
    timeoutMs?: number;
    retry?: RetryConfig;
  },
): Promise<RocketChatPostMessageResult> {
  const body: Record<string, unknown> = {};
  if (params.roomId) body.roomId = params.roomId;
  if (params.channel) body.channel = params.channel;
  if (params.text !== undefined) body.text = params.text;
  if (params.tmid) body.tmid = params.tmid;
  if (typeof params.tshow === "boolean") body.tshow = params.tshow;
  if (params.alias) body.alias = params.alias;
  if (params.avatar) body.avatar = params.avatar;
  if (params.emoji) body.emoji = params.emoji;
  return requestRocketChatJsonWithRetry<RocketChatPostMessageResult>(
    auth,
    {
      method: "POST",
      path: "/api/v1/chat.postMessage",
      body,
      timeoutMs: params.timeoutMs,
      retry: params.retry,
    },
  );
}

export async function uploadRocketChatRoomMedia(
  auth: RocketChatAuth,
  params: {
    roomId: string;
    file: Buffer;
    fileName: string;
    contentType?: string;
    caption?: string;
    timeoutMs?: number;
  },
): Promise<RocketChatUploadResult> {
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (timeout.unref) timeout.unref();

  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.file)], {
    type: params.contentType ?? "application/octet-stream",
  });
  form.append("file", blob, params.fileName);
  form.append("msg", params.caption ?? "");

  try {
    const url = buildUrl(
      auth.baseUrl,
      `/api/v1/rooms.media/${params.roomId}`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Auth-Token": auth.authToken,
        "X-User-Id": auth.userId,
      },
      body: form,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new RocketChatHttpError({
        message: `Rocket.Chat upload failed (${res.status})`,
        status: res.status,
        statusText: res.statusText,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
        responseText: text,
      });
    }
    if (!text) return {};
    return JSON.parse(text) as RocketChatUploadResult;
  } finally {
    clearTimeout(timeout);
  }
}
