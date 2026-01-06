import { detectBinary } from "../../commands/onboard-helpers.js";
import { discoverGatewayBeacons } from "../../infra/bonjour-discovery.js";
import type { WizardStepDefinition } from "../steps.js";
import { toTrimmedString } from "../values.js";
import { commitConfig } from "./apply.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "remote.detect";
const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

function pickHost(beacon: {
  tailnetDns?: string | null;
  lanHost?: string | null;
  host?: string | null;
}) {
  return beacon.tailnetDns || beacon.lanHost || beacon.host || undefined;
}

function buildLabel(beacon: {
  displayName?: string | null;
  instanceName?: string | null;
  tailnetDns?: string | null;
  lanHost?: string | null;
  host?: string | null;
  gatewayPort?: number | null;
  port?: number | null;
}) {
  const host = pickHost(beacon);
  const port = beacon.gatewayPort ?? beacon.port ?? 18789;
  const title = beacon.displayName ?? beacon.instanceName ?? "Gateway";
  const hint = host ? `${host}:${port}` : "host unknown";
  return `${title} (${hint})`;
}

export function buildRemoteSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "action",
    title: "Remote gateway",
    message: "Checking Bonjour discovery tools.",
    onAnswer: async (_value, state) => {
      const hasDns = await detectBinary("dns-sd");
      const hasAvahi = await detectBinary("avahi-browse");
      state.remote.hasBonjourTool = Boolean(hasDns || hasAvahi);
    },
    next: () => "remote.discover.offer",
  };

  steps["remote.discover.offer"] = {
    id: "remote.discover.offer",
    type: "confirm",
    message: "Discover gateway on LAN (Bonjour)?",
    initialValue: () => true,
    onAnswer: (value, state) => {
      state.remote.wantsDiscover = Boolean(value);
    },
    next: (_value, state) => {
      if (!state.remote.hasBonjourTool) return "remote.no-bonjour";
      return state.remote.wantsDiscover ? "remote.discover.run" : "remote.url";
    },
  };

  steps["remote.no-bonjour"] = {
    id: "remote.no-bonjour",
    type: "note",
    title: "Discovery",
    message:
      "Bonjour discovery requires dns-sd (macOS) or avahi-browse (Linux).",
    next: () => "remote.url",
  };

  steps["remote.discover.run"] = {
    id: "remote.discover.run",
    type: "action",
    title: "Discovery",
    message: "Searching for gateways…",
    onAnswer: async (_value, state) => {
      const beacons = await discoverGatewayBeacons({ timeoutMs: 2000 });
      state.remote.beacons = beacons;
    },
    next: (_value, state) =>
      state.remote.beacons && state.remote.beacons.length > 0
        ? "remote.discover.pick"
        : "remote.url",
  };

  steps["remote.discover.pick"] = {
    id: "remote.discover.pick",
    type: "select",
    message: "Select gateway",
    options: (state) => [
      ...(state.remote.beacons ?? []).map((beacon, index) => ({
        value: String(index),
        label: buildLabel(beacon),
      })),
      { value: "manual", label: "Enter URL manually" },
    ],
    onAnswer: (value, state) => {
      if (value === "manual") {
        state.remote.selectedBeaconIndex = undefined;
        return;
      }
      const idx = Number.parseInt(String(value), 10);
      state.remote.selectedBeaconIndex = Number.isFinite(idx) ? idx : undefined;
    },
    next: (_value, state) => {
      if (state.remote.selectedBeaconIndex == null) return "remote.url";
      return "remote.discover.method";
    },
  };

  steps["remote.discover.method"] = {
    id: "remote.discover.method",
    type: "select",
    message: "Connection method",
    options: (state) => {
      const beacon =
        state.remote.beacons?.[state.remote.selectedBeaconIndex ?? -1];
      const host = beacon ? pickHost(beacon) : undefined;
      const port = beacon?.gatewayPort ?? beacon?.port ?? 18789;
      return [
        {
          value: "direct",
          label: `Direct gateway WS (${host ?? "host"}:${port})`,
        },
        { value: "ssh", label: "SSH tunnel (loopback)" },
      ];
    },
    onAnswer: (value, state) => {
      const beacon =
        state.remote.beacons?.[state.remote.selectedBeaconIndex ?? -1];
      const host = beacon ? pickHost(beacon) : undefined;
      const port = beacon?.gatewayPort ?? beacon?.port ?? 18789;
      if (!host) return;
      if (value === "direct") {
        state.remote.suggestedUrl = `ws://${host}:${port}`;
        state.remote.sshHint = undefined;
      } else {
        state.remote.suggestedUrl = DEFAULT_GATEWAY_URL;
        state.remote.sshHint = `ssh -N -L 18789:127.0.0.1:18789 <user>@${host}${
          beacon?.sshPort ? ` -p ${beacon.sshPort}` : ""
        }`;
      }
    },
    next: (_value, state) =>
      state.remote.sshHint ? "remote.ssh.hint" : "remote.url",
  };

  steps["remote.ssh.hint"] = {
    id: "remote.ssh.hint",
    type: "note",
    title: "SSH tunnel",
    message: (state) =>
      state.remote.sshHint
        ? `Start a tunnel before using the CLI:\n${state.remote.sshHint}`
        : "",
    next: () => "remote.url",
  };

  steps["remote.url"] = {
    id: "remote.url",
    type: "text",
    message: "Gateway WebSocket URL",
    initialValue: (state) =>
      state.remote.suggestedUrl ??
      state.draftConfig.gateway?.remote?.url ??
      DEFAULT_GATEWAY_URL,
    validate: (value) => {
      const v = toTrimmedString(value);
      return v.startsWith("ws://") || v.startsWith("wss://")
        ? undefined
        : "URL must start with ws:// or wss://";
    },
    onAnswer: (value, state) => {
      const url = toTrimmedString(value) || DEFAULT_GATEWAY_URL;
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          mode: "remote",
          remote: {
            ...state.draftConfig.gateway?.remote,
            url,
          },
        },
      };
    },
    next: () => "remote.auth",
  };

  steps["remote.auth"] = {
    id: "remote.auth",
    type: "select",
    message: "Gateway auth",
    options: () => [
      { value: "token", label: "Token (recommended)" },
      { value: "off", label: "No auth" },
    ],
    onAnswer: (value, state) => {
      if (value === "off") {
        state.draftConfig = {
          ...state.draftConfig,
          gateway: {
            ...state.draftConfig.gateway,
            remote: {
              ...state.draftConfig.gateway?.remote,
              token: undefined,
            },
          },
        };
      }
    },
    next: (value) => (value === "token" ? "remote.token" : "remote.apply"),
  };

  steps["remote.token"] = {
    id: "remote.token",
    type: "text",
    message: "Gateway token",
    initialValue: (state) => state.draftConfig.gateway?.remote?.token ?? "",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const token = toTrimmedString(value);
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          remote: {
            ...state.draftConfig.gateway?.remote,
            token,
          },
        },
      };
    },
    next: () => "remote.apply",
  };

  steps["remote.apply"] = {
    id: "remote.apply",
    type: "action",
    title: "Apply remote config",
    message: "Save remote gateway configuration.",
    onAnswer: async (_value, state, ctx) => {
      await commitConfig(state, ctx, "remote");
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
