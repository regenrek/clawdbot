import { createServer } from "node:http";
import crypto from "node:crypto";

import { buildMentionRegexes } from "../auto-reply/reply/mentions.js";
import { loadConfig } from "../config/config.js";
import { danger } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import { readJsonBody } from "../gateway/hooks.js";
import { handleRocketChatMessage } from "./inbound.js";
import { normalizeOutgoingPayload } from "./inbound-utils.js";

const DEFAULT_WEBHOOK_PATH = "/rocketchat/outgoing";
const DEFAULT_WEBHOOK_PORT = 8790;
const DEFAULT_WEBHOOK_HOST = "0.0.0.0";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
function timingSafeEqualStr(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function monitorRocketChatProvider(opts: {
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}) {
  const runtime: RuntimeEnv = opts.runtime ?? {
    log: console.log,
    error: console.error,
    exit: (code: number): never => {
      throw new Error(`exit ${code}`);
    },
  };
  const cfg = loadConfig();
  const rcCfg = cfg.rocketchat ?? {};
  const enabled = rcCfg.enabled !== false;
  if (!enabled) {
    runtime.log?.("rocketchat provider disabled (rocketchat.enabled=false)");
    return;
  }
  const token = rcCfg.webhook?.token?.trim();
  if (!token) {
    throw new Error("rocketchat.webhook.token is required for Rocket.Chat");
  }
  const host = rcCfg.webhook?.host?.trim() || DEFAULT_WEBHOOK_HOST;
  const port =
    typeof rcCfg.webhook?.port === "number" && rcCfg.webhook.port > 0
      ? rcCfg.webhook.port
      : DEFAULT_WEBHOOK_PORT;
  const rawPath = rcCfg.webhook?.path?.trim() || DEFAULT_WEBHOOK_PATH;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const maxBodyBytes =
    typeof rcCfg.webhook?.maxBodyBytes === "number" && rcCfg.webhook.maxBodyBytes > 0
      ? rcCfg.webhook.maxBodyBytes
      : DEFAULT_MAX_BODY_BYTES;

  const mentionRegexes = buildMentionRegexes(cfg);

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        res.writeHead(200);
        res.end("ok");
        return;
      }
      if (req.url !== path) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const body = await readJsonBody(req, maxBodyBytes);
      if (!body.ok) {
        res.writeHead(body.error === "payload too large" ? 413 : 400);
        res.end();
        return;
      }
      const normalized = normalizeOutgoingPayload(body.value);
      if (!normalized) {
        res.writeHead(400);
        res.end();
        return;
      }
      const headerAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
      const headerToken = headerAuth.toLowerCase().startsWith("bearer ")
        ? headerAuth.slice(7).trim()
        : "";
      const payloadToken = normalized.token ?? "";
      if (!timingSafeEqualStr(headerToken || payloadToken, token)) {
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

      void handleRocketChatMessage({
        cfg,
        runtime,
        payload: normalized,
        mentionRegexes,
      }).catch((err) => {
        runtime.error?.(danger(`rocketchat handler failed: ${String(err)}`));
      });
    } catch (err) {
      res.writeHead(500);
      res.end();
      runtime.error?.(danger(`rocketchat webhook error: ${String(err)}`));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  runtime.log?.(`rocketchat webhook listening on http://${host}:${port}${path}`);

  const shutdown = () => {
    server.close();
  };
  if (opts.abortSignal) {
    opts.abortSignal.addEventListener("abort", shutdown, { once: true });
  }
}
