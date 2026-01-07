import { chunkText, resolveTextChunkLimit } from "../auto-reply/chunk.js";
import { loadConfig } from "../config/config.js";
import { bufferToBlobPart } from "../infra/blob.js";
import { formatErrorMessage } from "../infra/errors.js";
import { loadWebMedia } from "../web/media.js";

const ROCKETCHAT_TEXT_LIMIT = 4000;

type RocketChatRecipient =
  | {
      kind: "roomId";
      roomId: string;
    }
  | {
      kind: "channel";
      channel: string; // "#channel" | "@user"
    };

export type RocketChatSendOpts = {
  baseUrl?: string;
  authToken?: string;
  userId?: string;
  mediaUrl?: string;
  verbose?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

export type RocketChatSendResult = {
  messageId: string;
  roomId?: string;
};

function resolveBaseUrl(explicit?: string): string {
  const cfg = loadConfig();
  const base =
    explicit?.trim() ||
    cfg.rocketchat?.baseUrl?.trim() ||
    process.env.ROCKETCHAT_URL?.trim() ||
    process.env.ROCKETCHAT_BASE_URL?.trim() ||
    "";
  if (!base)
    throw new Error("Rocket.Chat baseUrl is required (ROCKETCHAT_URL)");
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(
      `Invalid Rocket.Chat baseUrl: ${JSON.stringify(base)}. Expected http(s) URL.`,
    );
  }
  return base.replace(/\/+$/, "");
}

function resolveAuthToken(explicit?: string): string {
  const cfg = loadConfig();
  const token =
    explicit?.trim() ||
    cfg.rocketchat?.authToken?.trim() ||
    process.env.ROCKETCHAT_AUTH_TOKEN?.trim() ||
    process.env.ROCKETCHAT_TOKEN?.trim() ||
    "";
  if (!token)
    throw new Error(
      "Rocket.Chat auth token is required (ROCKETCHAT_AUTH_TOKEN)",
    );
  return token;
}

function resolveUserId(explicit?: string): string {
  const cfg = loadConfig();
  const userId =
    explicit?.trim() ||
    cfg.rocketchat?.userId?.trim() ||
    process.env.ROCKETCHAT_USER_ID?.trim() ||
    "";
  if (!userId)
    throw new Error("Rocket.Chat user id is required (ROCKETCHAT_USER_ID)");
  return userId;
}

function parseRecipient(raw: string): RocketChatRecipient {
  let value = raw.trim();
  if (!value) throw new Error("Recipient is required for Rocket.Chat sends");
  const lower = value.toLowerCase();
  if (lower.startsWith("rocketchat:")) {
    value = value.slice("rocketchat:".length).trim();
  }

  const roomIdMatch =
    /^(?:rid|room|roomid):\s*([A-Za-z0-9]{6,})$/i.exec(value) ??
    /^(?:rid|room|roomid)\/\s*([A-Za-z0-9]{6,})$/i.exec(value);
  if (roomIdMatch?.[1]) return { kind: "roomId", roomId: roomIdMatch[1] };

  if (value.startsWith("#") || value.startsWith("@")) {
    return { kind: "channel", channel: value };
  }

  // Accept bare channel names for convenience; normalize to #channel.
  if (/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    return { kind: "channel", channel: `#${value}` };
  }

  // Common room ids look base58-ish; accept if it looks like one.
  if (/^[A-Za-z0-9]{10,}$/.test(value)) {
    return { kind: "roomId", roomId: value };
  }

  throw new Error(
    `Invalid Rocket.Chat recipient: ${JSON.stringify(raw)}. Use #channel, @user, or rid:<roomId>.`,
  );
}

async function rcFetch(
  url: string,
  init: RequestInit,
  opts: { fetchImpl: typeof fetch; timeoutMs: number; verbose?: boolean },
): Promise<Response> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    return await opts.fetchImpl(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    const msg = formatErrorMessage(err);
    if (opts.verbose) console.warn(`rocketchat fetch failed: ${url}: ${msg}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function rcJson<T>(
  url: string,
  init: RequestInit,
  opts: { fetchImpl: typeof fetch; timeoutMs: number; verbose?: boolean },
): Promise<T> {
  const res = await rcFetch(url, init, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text ? `${res.status}: ${text}` : `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function resolveRoomIdForMedia(params: {
  baseUrl: string;
  headers: Record<string, string>;
  recipient: RocketChatRecipient;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  verbose?: boolean;
}): Promise<string | undefined> {
  if (params.recipient.kind === "roomId") return params.recipient.roomId;
  const channel = params.recipient.channel.trim();
  if (!channel.startsWith("#")) return undefined;
  const roomName = channel.replace(/^#+/, "");
  if (!roomName) return undefined;
  const url = `${params.baseUrl}/api/v1/rooms.info?roomName=${encodeURIComponent(roomName)}`;
  const data = await rcJson<{ success?: boolean; room?: { _id?: string } }>(
    url,
    { method: "GET", headers: params.headers },
    {
      fetchImpl: params.fetchImpl,
      timeoutMs: params.timeoutMs,
      verbose: params.verbose,
    },
  );
  return typeof data.room?._id === "string" ? data.room._id : undefined;
}

export async function sendMessageRocketChat(
  to: string,
  message: string,
  opts: RocketChatSendOpts = {},
): Promise<RocketChatSendResult> {
  const baseUrl = resolveBaseUrl(opts.baseUrl);
  const authToken = resolveAuthToken(opts.authToken);
  const userId = resolveUserId(opts.userId);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const recipient = parseRecipient(to);

  const cfg = loadConfig();
  const textLimit = resolveTextChunkLimit(cfg, "rocketchat");
  const chunkLimit = Math.min(textLimit, ROCKETCHAT_TEXT_LIMIT);
  const chunks = chunkText(message?.trim() ?? "", chunkLimit);
  const mediaMaxBytes =
    typeof cfg.rocketchat?.mediaMaxMb === "number"
      ? cfg.rocketchat.mediaMaxMb * 1024 * 1024
      : undefined;

  const headers = {
    "X-Auth-Token": authToken,
    "X-User-Id": userId,
  };

  let lastMessageId = "";

  if (opts.mediaUrl?.trim()) {
    const rid = await resolveRoomIdForMedia({
      baseUrl,
      headers,
      recipient,
      fetchImpl,
      timeoutMs,
      verbose: opts.verbose,
    });
    if (!rid) {
      throw new Error(
        "Rocket.Chat media upload requires a room id. Provide recipient as rid:<roomId> (or a #channel that can be resolved via rooms.info).",
      );
    }

    const { buffer, contentType, fileName } = await loadWebMedia(
      opts.mediaUrl.trim(),
      opts.maxBytes ?? mediaMaxBytes,
    );
    const blob = new Blob([bufferToBlobPart(buffer)], {
      type: contentType ?? "application/octet-stream",
    });
    const form = new FormData();
    form.set("file", blob, fileName ?? "file");

    const [firstChunk, ...rest] = chunks;
    if (firstChunk?.trim()) form.set("msg", firstChunk.trim());

    const uploadUrl = `${baseUrl}/api/v1/rooms.media/${rid}`;
    const res = await rcFetch(
      uploadUrl,
      { method: "POST", headers, body: form },
      { fetchImpl, timeoutMs, verbose: opts.verbose },
    );
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(msg ? `${res.status}: ${msg}` : `HTTP ${res.status}`);
    }
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      message?: { _id?: string };
    } | null;
    lastMessageId = String(json?.message?._id ?? "unknown");

    // If the caption overflowed, send the remainder as follow-up messages.
    for (const chunk of rest) {
      const data = await rcJson<{
        success?: boolean;
        message?: { _id?: string };
      }>(
        `${baseUrl}/api/v1/chat.postMessage`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: rid, text: chunk }),
        },
        { fetchImpl, timeoutMs, verbose: opts.verbose },
      );
      lastMessageId = String(data?.message?._id ?? lastMessageId);
    }

    return { messageId: lastMessageId || "unknown", roomId: rid };
  }

  if (chunks.length === 0) {
    throw new Error("Rocket.Chat send requires text or media");
  }

  for (const chunk of chunks) {
    const payload: Record<string, unknown> =
      recipient.kind === "roomId"
        ? { roomId: recipient.roomId, text: chunk }
        : { channel: recipient.channel, text: chunk };
    const data = await rcJson<{
      success?: boolean;
      message?: { _id?: string };
    }>(
      `${baseUrl}/api/v1/chat.postMessage`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { fetchImpl, timeoutMs, verbose: opts.verbose },
    );
    lastMessageId = String(data?.message?._id ?? lastMessageId);
  }

  return {
    messageId: lastMessageId || "unknown",
    roomId: recipient.kind === "roomId" ? recipient.roomId : undefined,
  };
}
