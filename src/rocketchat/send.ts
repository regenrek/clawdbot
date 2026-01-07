import {
  chunkMarkdownText,
  resolveTextChunkLimit,
} from "../auto-reply/chunk.js";
import { loadConfig } from "../config/config.js";
import type { ClawdbotConfig } from "../config/types.js";
import type { RetryConfig } from "../infra/retry.js";
import { formatErrorMessage } from "../infra/errors.js";
import { loadWebMedia } from "../web/media.js";
import {
  createRocketChatDm,
  fetchRocketChatRoomInfo,
  postRocketChatMessage,
  resolveRocketChatAuth,
  uploadRocketChatRoomMedia,
} from "./client.js";

export type RocketChatSendOpts = {
  baseUrl?: string;
  authToken?: string;
  userId?: string;
  mediaUrl?: string;
  threadId?: string;
  tshow?: boolean;
  retry?: RetryConfig;
  alias?: string;
  avatarUrl?: string;
  emoji?: string;
};

export type RocketChatSendResult = {
  messageId: string;
  roomId: string;
};

type RocketChatTarget =
  | { kind: "room"; roomId: string }
  | { kind: "channel"; channel: string };

function normalizeChannelName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#") || trimmed.startsWith("@")) return trimmed;
  return trimmed;
}

function parseRocketChatTarget(to: string): RocketChatTarget {
  const trimmed = to.trim();
  if (!trimmed) {
    throw new Error("Recipient is required for Rocket.Chat sends");
  }
  if (trimmed.startsWith("room:")) {
    return { kind: "room", roomId: trimmed.slice("room:".length) };
  }
  if (trimmed.startsWith("channel:")) {
    const name = trimmed.slice("channel:".length);
    return { kind: "channel", channel: `#${name.replace(/^#/, "")}` };
  }
  if (trimmed.startsWith("user:")) {
    const name = trimmed.slice("user:".length);
    return { kind: "channel", channel: `@${name.replace(/^@/, "")}` };
  }
  if (trimmed.startsWith("#") || trimmed.startsWith("@")) {
    return { kind: "channel", channel: normalizeChannelName(trimmed) };
  }
  return { kind: "room", roomId: trimmed };
}

function resolveMediaMaxBytes(cfg: ClawdbotConfig): number | undefined {
  const providerLimit = cfg.rocketchat?.mediaMaxMb;
  if (providerLimit) return providerLimit * 1024 * 1024;
  if (cfg.agent?.mediaMaxMb) return cfg.agent.mediaMaxMb * 1024 * 1024;
  return undefined;
}

async function resolveRoomIdForTarget(params: {
  cfg: ClawdbotConfig;
  target: RocketChatTarget;
}): Promise<string> {
  if (params.target.kind === "room") return params.target.roomId;
  const channel = params.target.channel;
  const auth = resolveRocketChatAuth({ cfg: params.cfg });
  if (channel.startsWith("@")) {
    const username = channel.slice(1);
    if (!username) {
      throw new Error("Rocket.Chat DM requires a username");
    }
    const dm = await createRocketChatDm(auth, { username });
    const roomId = dm.room?.rid;
    if (!roomId) {
      throw new Error("Rocket.Chat DM create did not return room id");
    }
    return roomId;
  }
  const roomName = channel.replace(/^#/, "");
  const info = await fetchRocketChatRoomInfo(auth, { roomName });
  const roomId = info.room?._id;
  if (!roomId) {
    throw new Error(`Rocket.Chat room not found for ${channel}`);
  }
  return roomId;
}

export async function sendMessageRocketChat(
  to: string,
  message: string,
  opts: RocketChatSendOpts = {},
): Promise<RocketChatSendResult> {
  const trimmedMessage = message?.trim() ?? "";
  if (!trimmedMessage && !opts.mediaUrl) {
    throw new Error("Rocket.Chat send requires text or media");
  }
  const cfg = loadConfig();
  const auth = resolveRocketChatAuth({
    cfg,
    baseUrl: opts.baseUrl,
    authToken: opts.authToken,
    userId: opts.userId,
  });
  const target = parseRocketChatTarget(to);
  const textLimit = resolveTextChunkLimit(cfg, "rocketchat");
  const chunks = chunkMarkdownText(trimmedMessage, textLimit);
  const alias = opts.alias ?? cfg.rocketchat?.alias;
  const avatar = opts.avatarUrl ?? cfg.rocketchat?.avatarUrl;
  const emoji = opts.emoji ?? cfg.rocketchat?.emoji;
  const retry = opts.retry ?? cfg.rocketchat?.retry;

  const sendText = async (text: string) => {
    const res = await postRocketChatMessage(auth, {
      roomId: target.kind === "room" ? target.roomId : undefined,
      channel: target.kind === "channel" ? target.channel : undefined,
      text,
      tmid: opts.threadId,
      tshow: opts.tshow,
      alias,
      avatar,
      emoji,
      retry,
    });
    const messageId = res.message?._id ?? "unknown";
    const roomId = res.message?.rid ?? (target.kind === "room" ? target.roomId : "unknown");
    return { messageId, roomId };
  };

  if (!opts.mediaUrl) {
    let last: RocketChatSendResult = { messageId: "unknown", roomId: "unknown" };
    for (const chunk of chunks.length ? chunks : [""]) {
      const clean = chunk.trim();
      if (!clean) continue;
      last = await sendText(clean);
    }
    return last;
  }

  const roomId = await resolveRoomIdForTarget({ cfg, target });
  const { buffer, contentType, fileName } = await loadWebMedia(
    opts.mediaUrl,
    resolveMediaMaxBytes(cfg),
  );
  const [firstChunk, ...rest] = chunks;
  const caption = firstChunk ?? "";
  const upload = await uploadRocketChatRoomMedia(auth, {
    roomId,
    file: buffer,
    fileName,
    contentType,
    caption,
  });
  let lastMessageId = upload.file?._id ?? "unknown";
  for (const chunk of rest) {
    const clean = chunk.trim();
    if (!clean) continue;
    const sent = await sendText(clean);
    lastMessageId = sent.messageId;
  }

  if (!lastMessageId) {
    throw new Error(`Rocket.Chat send failed: ${formatErrorMessage(upload)}`);
  }
  return { messageId: lastMessageId, roomId };
}
