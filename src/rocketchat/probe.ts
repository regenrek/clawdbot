import { formatErrorMessage } from "../infra/errors.js";
import type { RetryConfig } from "../infra/retry.js";
import { fetchRocketChatMe, resolveRocketChatAuth } from "./client.js";

export type RocketChatProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  user?: { id?: string | null; username?: string | null; name?: string | null };
};

export async function probeRocketChat(
  baseUrl: string,
  authToken: string,
  userId: string,
  timeoutMs: number,
  retry?: RetryConfig,
): Promise<RocketChatProbe> {
  const started = Date.now();
  try {
    const auth = resolveRocketChatAuth({
      baseUrl,
      authToken,
      userId,
    });
    const me = await fetchRocketChatMe(auth, { timeoutMs, retry });
    const elapsedMs = Date.now() - started;
    return {
      ok: true,
      status: 200,
      elapsedMs,
      user: {
        id: me._id ?? null,
        username: me.username ?? null,
        name: me.name ?? null,
      },
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    return {
      ok: false,
      status: null,
      error: formatErrorMessage(err),
      elapsedMs,
    };
  }
}
