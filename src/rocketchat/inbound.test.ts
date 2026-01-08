import { describe, expect, it } from "vitest";

import type { ClawdbotConfig } from "../config/types.js";
import { resolveRoomAllowed } from "./inbound-utils.js";

describe("rocketchat resolveRoomAllowed", () => {
  it("allows rooms by default when groupPolicy is open", () => {
    const cfg = { rocketchat: { groupPolicy: "open" } } as ClawdbotConfig;
    expect(
      resolveRoomAllowed({ cfg, roomId: "R1", roomName: "general" }),
    ).not.toBeNull();
  });

  it("blocks rooms explicitly disabled even when groupPolicy is open", () => {
    const cfg = {
      rocketchat: {
        groupPolicy: "open",
        rooms: { general: { allow: false } },
      },
    } as ClawdbotConfig;
    expect(
      resolveRoomAllowed({ cfg, roomId: "R1", roomName: "general" }),
    ).toBeNull();
  });

  it("blocks rooms when groupPolicy is allowlist and room is missing", () => {
    const cfg = {
      rocketchat: {
        groupPolicy: "allowlist",
        rooms: { ops: { allow: true } },
      },
    } as ClawdbotConfig;
    expect(
      resolveRoomAllowed({ cfg, roomId: "R2", roomName: "general" }),
    ).toBeNull();
  });

  it("allows rooms when groupPolicy is allowlist and room is configured", () => {
    const cfg = {
      rocketchat: {
        groupPolicy: "allowlist",
        rooms: { general: { allow: true } },
      },
    } as ClawdbotConfig;
    expect(
      resolveRoomAllowed({ cfg, roomId: "R3", roomName: "general" }),
    ).not.toBeNull();
  });

  it("honors wildcard room entry for allowlist policy", () => {
    const cfg = {
      rocketchat: {
        groupPolicy: "allowlist",
        rooms: { "*": { allow: true } },
      },
    } as ClawdbotConfig;
    expect(
      resolveRoomAllowed({ cfg, roomId: "R4", roomName: "random" }),
    ).not.toBeNull();
  });
});
