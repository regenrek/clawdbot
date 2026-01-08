import crypto from "node:crypto";

import {
  chunkMarkdownText,
  resolveTextChunkLimit,
} from "../auto-reply/chunk.js";
import { hasControlCommand } from "../auto-reply/command-detection.js";
import { shouldHandleTextCommands } from "../auto-reply/commands-registry.js";
import { formatAgentEnvelope } from "../auto-reply/envelope.js";
import { dispatchReplyFromConfig } from "../auto-reply/reply/dispatch-from-config.js";
import { createReplyDispatcherWithTyping } from "../auto-reply/reply/reply-dispatcher.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { ClawdbotConfig } from "../config/config.js";
import { resolveStorePath, updateLastRoute } from "../config/sessions.js";
import { danger, logVerbose, shouldLogVerbose } from "../globals.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import {
  readProviderAllowFromStore,
  upsertProviderPairingRequest,
} from "../pairing/pairing-store.js";
import { resolveAgentRoute } from "../routing/resolve-route.js";
import { resolveThreadSessionKeys } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { fetchRocketChatRoomInfo, resolveRocketChatAuth } from "./client.js";
import {
  normalizeOutgoingPayload,
  normalizeRoomType,
  resolveRoomAllowed,
  resolveRoomConfig,
  resolveShouldRequireMention,
  resolveUserAllowed,
  resolveWasMentioned,
  stripTriggerWord,
  type NormalizedPayload,
  type RoomType,
} from "./inbound-utils.js";
import { sendMessageRocketChat } from "./send.js";

const DEDUP_TTL_MS = 10 * 60 * 1000;
const ROOM_INFO_TTL_MS = 5 * 60 * 1000;

class Deduper {
  ttlMs: number;
  map: Map<string, number>;
  timer: ReturnType<typeof setInterval>;
  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(ttlMs, 60_000));
    this.timer.unref?.();
  }
  seen(key: string): boolean {
    const ts = this.map.get(key);
    if (!ts) return false;
    return Date.now() - ts < this.ttlMs;
  }
  mark(key: string) {
    this.map.set(key, Date.now());
  }
  sweep() {
    const now = Date.now();
    for (const [key, ts] of this.map.entries()) {
      if (now - ts >= this.ttlMs) this.map.delete(key);
    }
  }
}

const deduper = new Deduper(DEDUP_TTL_MS);

type RoomInfoCacheEntry = {
  type?: RoomType;
  name?: string;
  updatedAt: number;
};

const roomInfoCache = new Map<string, RoomInfoCacheEntry>();

async function resolveRoomInfo(
  cfg: ClawdbotConfig,
  roomId?: string,
): Promise<RoomInfoCacheEntry | null> {
  if (!roomId) return null;
  const cached = roomInfoCache.get(roomId);
  if (cached && Date.now() - cached.updatedAt < ROOM_INFO_TTL_MS) return cached;
  try {
    const auth = resolveRocketChatAuth({ cfg });
    const info = await fetchRocketChatRoomInfo(auth, { roomId });
    const type = normalizeRoomType(info.room?.t);
    const entry: RoomInfoCacheEntry = {
      type,
      name: info.room?.name,
      updatedAt: Date.now(),
    };
    roomInfoCache.set(roomId, entry);
    return entry;
  } catch {
    return cached ?? null;
  }
}

async function deliverReply(params: {
  payload: ReplyPayload;
  target: string;
  threadId?: string;
  cfg: ClawdbotConfig;
}): Promise<void> {
  const text = params.payload.text ?? "";
  const mediaList =
    params.payload.mediaUrls ??
    (params.payload.mediaUrl ? [params.payload.mediaUrl] : []);
  if (!text.trim() && mediaList.length === 0) return;
  if (mediaList.length === 0) {
    const limit = resolveTextChunkLimit(params.cfg, "rocketchat");
    for (const chunk of chunkMarkdownText(text, limit)) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      await sendMessageRocketChat(params.target, trimmed, {
        threadId: params.threadId,
      });
    }
    return;
  }
  let first = true;
  for (const mediaUrl of mediaList) {
    const caption = first ? text : "";
    first = false;
    await sendMessageRocketChat(params.target, caption, {
      threadId: params.threadId,
      mediaUrl,
    });
  }
}

export async function handleRocketChatMessage(params: {
  cfg: ClawdbotConfig;
  runtime: RuntimeEnv;
  payload: NormalizedPayload;
  mentionRegexes: RegExp[];
}) {
  const { cfg, runtime, payload } = params;
  const userId = payload.userId ?? "";
  const userName = payload.userName ?? "";
  const roomId = payload.roomId ?? "";
  const botUsername = cfg.rocketchat?.botUsername?.trim();
  if (cfg.rocketchat?.userId && payload.userId === cfg.rocketchat.userId) {
    return;
  }
  if (botUsername && userName && userName === botUsername) {
    return;
  }

  const rawText = payload.text ?? "";
  if (!rawText.trim()) return;

  const dedupKey = payload.messageId
    ? `mid:${payload.messageId}`
    : crypto
        .createHash("sha256")
        .update(`${userId}|${payload.timestamp ?? ""}|${rawText}`)
        .digest("hex");
  if (deduper.seen(dedupKey)) return;
  deduper.mark(dedupKey);

  const roomInfo = await resolveRoomInfo(cfg, roomId);
  const roomName = payload.roomName ?? roomInfo?.name;
  const roomType =
    normalizeRoomType(payload.roomType) ??
    (roomName?.startsWith("@") ? "direct" : undefined) ??
    roomInfo?.type ??
    "unknown";
  const isDirectMessage = roomType === "direct";
  const isRoom = !isDirectMessage;

  const allowedRoomConfig = isRoom
    ? resolveRoomAllowed({ cfg, roomId, roomName })
    : null;
  if (isRoom && !allowedRoomConfig) {
    logVerbose("rocketchat: drop message (room not allowed)");
    return;
  }

  const roomConfig = resolveRoomConfig({
    rooms: cfg.rocketchat?.rooms ?? {},
    roomId,
    roomName,
  });

  if (isDirectMessage) {
    const dmPolicy = cfg.rocketchat?.dmPolicy ?? "pairing";
    const allowFromConfig = cfg.rocketchat?.allowFrom ?? [];
    const storeAllowFrom = await readProviderAllowFromStore("rocketchat").catch(
      () => [],
    );
    const allowFrom = [...allowFromConfig, ...storeAllowFrom];
    if (dmPolicy === "disabled") return;
    if (dmPolicy !== "open") {
      const allowed = resolveUserAllowed({
        allowList: allowFrom,
        userId,
        userName,
      });
      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await upsertProviderPairingRequest({
            provider: "rocketchat",
            id: userId || userName || "unknown",
            meta: {
              username: userName,
            },
          });
          if (created) {
            try {
              await sendMessageRocketChat(`room:${roomId}`, [
                "Clawdbot: access not configured.",
                "",
                `Pairing code: ${code}`,
                "",
                "Ask the bot owner to approve with:",
                "clawdbot pairing approve --provider rocketchat <code>",
              ].join("\n"));
            } catch (err) {
              logVerbose(
                `rocketchat pairing reply failed for ${userId}: ${String(err)}`,
              );
            }
          }
        } else {
          logVerbose(
            `Blocked unauthorized rocketchat sender ${userId} (dmPolicy=${dmPolicy})`,
          );
        }
        return;
      }
    }
  }

  const roomUserAllowed = resolveUserAllowed({
    allowList: roomConfig?.users,
    userId,
    userName,
  });
  if (isRoom && !roomUserAllowed) {
    logVerbose(
      `rocketchat: drop room message (user not allowed) user=${userId || userName || "unknown"}`,
    );
    return;
  }

  const wasMentioned = isDirectMessage
    ? true
    : resolveWasMentioned({
        text: rawText,
        triggerWord: payload.triggerWord,
        botUsername,
        mentionRegexes: params.mentionRegexes,
      });
  if (isRoom) {
    const requireMention = resolveShouldRequireMention({
      cfg,
      roomConfig,
    });
    if (requireMention && !wasMentioned) {
      logVerbose("rocketchat: drop room message (no mention)");
      return;
    }
  }

  const text = stripTriggerWord(rawText, payload.triggerWord);
  if (!text.trim()) return;

  const roomLabel = roomName
    ? roomName.startsWith("#") || roomName.startsWith("@")
      ? roomName
      : `#${roomName}`
    : roomId
      ? `room:${roomId}`
      : "room:unknown";
  const senderName = userName || userId || "unknown";
  const inboundLabel = isDirectMessage
    ? `Rocket.Chat DM from ${senderName}`
    : `Rocket.Chat message in ${roomLabel} from ${senderName}`;
  const preview = text.replace(/\s+/g, " ").slice(0, 160);

  const route = resolveAgentRoute({
    cfg,
    provider: "rocketchat",
    peer: {
      kind: isDirectMessage ? "dm" : "channel",
      id: isDirectMessage
        ? userId || userName || "unknown"
        : roomId || roomName || "unknown",
    },
  });
  const baseSessionKey = route.sessionKey;
  const threadId = payload.threadId;
  const threadKeys = resolveThreadSessionKeys({
    baseSessionKey,
    threadId: threadId ? threadId : undefined,
    parentSessionKey: threadId ? baseSessionKey : undefined,
  });
  const sessionKey = threadKeys.sessionKey;

  enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
    sessionKey,
    contextKey: `rocketchat:message:${roomId || "unknown"}:${payload.messageId ?? "unknown"}`,
  });

  const body = formatAgentEnvelope({
    provider: "Rocket.Chat",
    from: senderName,
    timestamp: payload.timestamp ? Date.parse(payload.timestamp) : undefined,
    body: text,
  });

  const replyTarget = roomId
    ? `room:${roomId}`
    : roomName
      ? roomName.startsWith("@") || roomName.startsWith("#")
        ? roomName
        : `#${roomName}`
      : undefined;
  if (!replyTarget) {
    runtime.error?.(danger("rocketchat: missing reply target"));
    return;
  }

  const ctxPayload = {
    Body: body,
    From: isDirectMessage
      ? `rocketchat:${userId || userName || "unknown"}`
      : `rocketchat:room:${roomId || roomName || "unknown"}`,
    To: replyTarget,
    SessionKey: sessionKey,
    ParentSessionKey: threadKeys.parentSessionKey,
    ChatType: isDirectMessage ? "direct" : "room",
    GroupSubject: isRoom ? roomLabel : undefined,
    GroupRoom: roomName ?? undefined,
    GroupSystemPrompt: roomConfig?.systemPrompt?.trim() || undefined,
    SenderName: senderName,
    SenderId: userId || undefined,
    SenderUsername: userName || undefined,
    Provider: "rocketchat" as const,
    Surface: "rocketchat" as const,
    MessageSid: payload.messageId,
    ReplyToId: threadId ?? undefined,
    Timestamp: payload.timestamp ? Date.parse(payload.timestamp) : undefined,
    WasMentioned: isRoom ? wasMentioned : undefined,
    CommandSource: "text" as const,
    CommandAuthorized: isDirectMessage || roomUserAllowed,
    OriginatingChannel: "rocketchat" as const,
    OriginatingTo: replyTarget,
    MessageThreadId: threadId,
    AccountId: route.accountId,
  };

  if (isDirectMessage) {
    const storePath = resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    await updateLastRoute({
      storePath,
      sessionKey: route.mainSessionKey,
      provider: "rocketchat",
      to: replyTarget,
      accountId: route.accountId,
    });
  }

  if (shouldLogVerbose()) {
    logVerbose(
      `rocketchat inbound: room=${roomId} from=${ctxPayload.From} preview="${preview}"`,
    );
  }

  const { dispatcher, replyOptions, markDispatchIdle } =
    createReplyDispatcherWithTyping({
      responsePrefix: cfg.messages?.responsePrefix,
      deliver: async (payload) => {
        await deliverReply({
          payload,
          target: replyTarget,
          threadId,
          cfg,
        });
      },
      onError: (err, info) => {
        runtime.error?.(
          danger(`rocketchat ${info.kind} reply failed: ${String(err)}`),
        );
      },
    });

  const commandEnabled = shouldHandleTextCommands({
    cfg,
    surface: "rocketchat",
    commandSource: "text",
  });
  const normalizedText = text.trim();
  if (!commandEnabled && hasControlCommand(normalizedText)) {
    return;
  }
  await dispatchReplyFromConfig({
    ctx: ctxPayload,
    cfg,
    dispatcher,
    replyOptions: { ...replyOptions, skillFilter: roomConfig?.skills },
  });
  markDispatchIdle();
}
