import { describe, expect, it, vi } from "vitest";

import { sendMessageRocketChat } from "./send.js";

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({
    rocketchat: {
      baseUrl: "https://chat.example.com",
      userId: "u1",
      authToken: "t1",
    },
  }),
}));

vi.mock("../web/media.js", () => ({
  loadWebMedia: vi.fn().mockResolvedValue({
    buffer: Buffer.from("img"),
    fileName: "photo.jpg",
    contentType: "image/jpeg",
    kind: "image",
  }),
}));

describe("sendMessageRocketChat", () => {
  it("posts a basic message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: { _id: "m1" } }),
      text: async () => "",
      headers: new Map(),
    });

    const res = await sendMessageRocketChat("#general", "hello", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.messageId).toBe("m1");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://chat.example.com/api/v1/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Auth-Token": "t1",
          "X-User-Id": "u1",
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});
