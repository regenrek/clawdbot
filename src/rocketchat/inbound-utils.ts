import type { ClawdbotConfig } from "../config/config.js";
import { matchesMentionPatterns } from "../auto-reply/reply/mentions.js";

export type RoomType = "direct" | "room" | "unknown";

export type RocketChatOutgoingPayload = {
  token?: string;
  channel_id?: string;
  channel_name?: string;
  room_id?: string;
  room_name?: string;
  room_type?: string;
  channel_type?: string;
  user_id?: string;
  user_name?: string;
  text?: string;
  trigger_word?: string;
  message_id?: string;
  timestamp?: string;
  thread_id?: string;
  tmid?: string;
  message?: {
    _id?: string;
    rid?: string;
    msg?: string;
    t?: string;
    tmid?: string;
    ts?: string;
    u?: { _id?: string; username?: string };
  };
};

export type NormalizedPayload = {
  token?: string;
  roomId?: string;
  roomName?: string;
  roomType?: string;
  userId?: string;
  userName?: string;
  text?: string;
  triggerWord?: string;
  messageId?: string;
  timestamp?: string;
  threadId?: string;
};

export type RocketChatRoomConfigResolved = {
  enabled?: boolean;
  allow?: boolean;
  requireMention?: boolean;
  users?: Array<string | number>;
  skills?: string[];
  systemPrompt?: string;
};

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function normalizeRoomSlug(raw?: string): string {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (!trimmed) return "";
  const dashed = trimmed.replace(/\s+/g, "-");
  return dashed.replace(/[^a-z0-9#@._+-]+/g, "-").replace(/-{2,}/g, "-");
}

export function normalizeOutgoingPayload(
  rawBody: unknown,
): NormalizedPayload | null {
  if (!rawBody || typeof rawBody !== "object") return null;
  const source = (rawBody as { data?: unknown }).data ?? rawBody;
  if (!source || typeof source !== "object") return null;
  const payload = source as RocketChatOutgoingPayload;
  const message = payload.message;
  return {
    token: firstString(payload.token),
    roomId: firstString(payload.channel_id, payload.room_id, message?.rid),
    roomName: firstString(payload.channel_name, payload.room_name),
    roomType: firstString(payload.channel_type, payload.room_type, message?.t),
    userId: firstString(payload.user_id, message?.u?._id),
    userName: firstString(payload.user_name, message?.u?.username),
    text: firstString(payload.text, message?.msg),
    triggerWord: firstString(payload.trigger_word),
    messageId: firstString(payload.message_id, message?._id),
    timestamp: firstString(payload.timestamp, message?.ts),
    threadId: firstString(payload.thread_id, payload.tmid, message?.tmid),
  };
}

export function normalizeRoomType(raw?: string): RoomType | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "d" || value === "direct" || value === "dm") return "direct";
  if (
    value === "c" ||
    value === "p" ||
    value === "l" ||
    value === "room" ||
    value === "channel" ||
    value === "private"
  ) {
    return "room";
  }
  return undefined;
}

export function stripTriggerWord(text: string, trigger?: string): string {
  const raw = text ?? "";
  const trimmed = raw.trim();
  const triggerWord = trigger?.trim();
  if (!triggerWord) return trimmed;
  const escaped = triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`^\\s*${escaped}[\\s,:;.!?()-]*`, "i");
  if (startRe.test(trimmed)) return trimmed.replace(startRe, "").trim();
  const anywhereRe = new RegExp(`${escaped}[\\s,:;.!?()-]*`, "i");
  return trimmed.replace(anywhereRe, "").trim();
}

export function resolveRoomConfig(params: {
  rooms?: Record<string, RocketChatRoomConfigResolved | undefined>;
  roomId?: string;
  roomName?: string;
}): RocketChatRoomConfigResolved | undefined {
  const rooms = params.rooms ?? {};
  const roomId = params.roomId?.trim();
  const roomName = params.roomName?.trim();
  const normalizedName = normalizeRoomSlug(roomName);
  const candidates = [
    roomId,
    roomName,
    roomName ? `#${roomName.replace(/^#/, "")}` : undefined,
    normalizedName,
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (rooms[candidate]) return rooms[candidate];
  }
  return rooms["*"];
}

export function resolveRoomAllowed(params: {
  cfg: ClawdbotConfig;
  roomId?: string;
  roomName?: string;
}): RocketChatRoomConfigResolved | null {
  const groupPolicy = params.cfg.rocketchat?.groupPolicy ?? "open";
  const rooms = params.cfg.rocketchat?.rooms ?? {};
  const resolved = resolveRoomConfig({
    rooms,
    roomId: params.roomId,
    roomName: params.roomName,
  });
  const allowConfig =
    resolved?.enabled === false || resolved?.allow === false ? false : true;
  if (groupPolicy === "disabled") return null;
  if (!allowConfig) return null;
  if (groupPolicy === "allowlist" && !resolved) return null;
  return resolved ?? { allow: true, requireMention: true };
}

export function resolveUserAllowed(params: {
  allowList?: Array<string | number>;
  userId?: string;
  userName?: string;
}): boolean {
  const allowList =
    params.allowList?.map((entry) => String(entry).trim().toLowerCase()) ?? [];
  if (allowList.length === 0) return true;
  if (allowList.includes("*")) return true;
  const candidates = [
    params.userId?.toLowerCase(),
    params.userName?.toLowerCase(),
    params.userName ? `@${params.userName.toLowerCase()}` : undefined,
  ].filter(Boolean) as string[];
  return candidates.some((value) => allowList.includes(value));
}

export function resolveShouldRequireMention(params: {
  cfg: ClawdbotConfig;
  roomConfig?: RocketChatRoomConfigResolved;
}): boolean {
  const explicitRoom = params.roomConfig;
  if (typeof explicitRoom?.requireMention === "boolean") {
    return explicitRoom.requireMention;
  }
  if (typeof params.cfg.rocketchat?.requireMention === "boolean") {
    return params.cfg.rocketchat.requireMention;
  }
  return true;
}

export function resolveWasMentioned(params: {
  text: string;
  triggerWord?: string;
  botUsername?: string;
  mentionRegexes: RegExp[];
}): boolean {
  if (params.triggerWord?.trim()) return true;
  const cleaned = params.text ?? "";
  const botUsername = params.botUsername?.trim();
  if (botUsername && cleaned.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
    return true;
  }
  return matchesMentionPatterns(cleaned, params.mentionRegexes);
}
