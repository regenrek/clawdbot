import { randomToken } from "../../commands/onboard-helpers.js";
import { resolveGatewayPort } from "../../config/config.js";
import type { WizardStepDefinition } from "../steps.js";
import { toTrimmedString } from "../values.js";
import { commitConfig } from "./apply.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "gateway.port";

export function buildGatewaySection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "text",
    message: "Gateway port",
    initialValue: (state) =>
      String(state.gatewayPort || resolveGatewayPort(state.draftConfig)),
    validate: (value) =>
      Number.isFinite(Number(value)) ? undefined : "Invalid port",
    onAnswer: (value, state) => {
      const port = Number.parseInt(String(value), 10);
      state.gatewayPort = port;
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          mode: "local",
          port,
        },
      };
    },
    next: () => "gateway.bind",
  };

  steps["gateway.bind"] = {
    id: "gateway.bind",
    type: "select",
    message: "Gateway bind",
    options: () => [
      {
        value: "loopback",
        label: "Loopback - (127.0.0.1). No remote access. Only this machine.",
      },
      {
        value: "tailnet",
        label: "Tailnet - Remote access. Requires auth.",
      },
      {
        value: "lan",
        label: "LAN - Reachable by anyone on your home Network.",
      },
      { value: "auto", label: "Auto" },
    ],
    onAnswer: (value, state) => {
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          bind: value as "loopback" | "lan" | "tailnet" | "auto",
        },
      };
    },
    next: () => "gateway.auth",
  };

  steps["gateway.auth"] = {
    id: "gateway.auth",
    type: "select",
    message: "Gateway auth",
    options: () => [
      { value: "off", label: "Off: no login. Safe only with loopback." },
      { value: "token", label: "Token: Best for tailnet/remote." },
      {
        value: "password",
        label: "Password: Public funnel; less secure than token.",
      },
    ],
    onAnswer: (value, state) => {
      const mode =
        value === "off" ? undefined : (value as "token" | "password");
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          auth: {
            ...state.draftConfig.gateway?.auth,
            mode,
            ...(mode ? {} : { token: undefined, password: undefined }),
          },
        },
      };
    },
    next: () => "gateway.tailscale",
  };

  steps["gateway.tailscale"] = {
    id: "gateway.tailscale",
    type: "select",
    message: "Tailscale exposure",
    options: () => [
      { value: "off", label: "Off: no Tailscale HTTP exposure." },
      {
        value: "serve",
        label: "Serve: tailnet-only HTTPS to Control UI (safe).",
      },
      {
        value: "funnel",
        label: "Funnel: public HTTPS on the internet (needs password, riskier).",
      },
    ],
    onAnswer: (value, state) => {
      const mode = value as "off" | "serve" | "funnel";
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          tailscale: {
            ...state.draftConfig.gateway?.tailscale,
            mode,
          },
        },
      };

      const warnings: string[] = [];
      const bind = state.draftConfig.gateway?.bind ?? "loopback";
      let authMode: "off" | "token" | "password" =
        state.draftConfig.gateway?.auth?.mode ?? "off";

      if (mode !== "off" && bind !== "loopback") {
        warnings.push(
          "Tailscale requires bind=loopback. Adjusting bind to loopback.",
        );
        state.draftConfig = {
          ...state.draftConfig,
          gateway: {
            ...state.draftConfig.gateway,
            bind: "loopback",
          },
        };
      }

      if (authMode === "off" && bind !== "loopback") {
        warnings.push(
          "Non-loopback bind requires auth. Switching to token auth.",
        );
        authMode = "token";
      }

      if (mode === "funnel" && authMode !== "password") {
        warnings.push("Tailscale funnel requires password auth.");
        authMode = "password";
      }

      const resolvedAuthMode = authMode === "off" ? undefined : authMode;
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          auth: {
            ...state.draftConfig.gateway?.auth,
            mode: resolvedAuthMode,
            ...(resolvedAuthMode
              ? {}
              : { token: undefined, password: undefined }),
          },
        },
      };

      state.gatewayWarnings = warnings;
    },
    next: (_value, state) => {
      const warnings = state.gatewayWarnings ?? [];
      if ((state.draftConfig.gateway?.tailscale?.mode ?? "off") !== "off") {
        return "gateway.tailscale.reset";
      }
      if (warnings.length > 0) return "gateway.auth.details";
      const authMode = state.draftConfig.gateway?.auth?.mode ?? "off";
      if (authMode === "token") return "gateway.auth.token";
      if (authMode === "password") return "gateway.auth.password";
      return "gateway.apply";
    },
  };

  steps["gateway.tailscale.reset"] = {
    id: "gateway.tailscale.reset",
    type: "confirm",
    message:
      "Turn off Tailscale Serve/Funnel when the gateway stops?\nYes: turns off Tailscale Serve/Funnel when gateway stops.\nNo: leaves it configured so it stays reachable after restarts.",
    initialValue: () => false,
    onAnswer: (value, state) => {
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          tailscale: {
            ...state.draftConfig.gateway?.tailscale,
            resetOnExit: Boolean(value),
          },
        },
      };
    },
    next: (_value, state) => {
      const warnings = state.gatewayWarnings ?? [];
      if (warnings.length > 0) return "gateway.auth.details";
      const authMode = state.draftConfig.gateway?.auth?.mode ?? "off";
      if (authMode === "token") return "gateway.auth.token";
      if (authMode === "password") return "gateway.auth.password";
      return "gateway.apply";
    },
  };

  steps["gateway.auth.details"] = {
    id: "gateway.auth.details",
    type: "note",
    message: (state) => {
      const warnings = state.gatewayWarnings ?? [];
      return warnings.length > 0 ? warnings.join("\n") : "";
    },
    next: (_value, state) => {
      const authMode = state.draftConfig.gateway?.auth?.mode ?? "off";
      if (authMode === "token") return "gateway.auth.token";
      if (authMode === "password") return "gateway.auth.password";
      return "gateway.apply";
    },
  };

  steps["gateway.auth.token"] = {
    id: "gateway.auth.token",
    type: "text",
    message: "Gateway token (blank to generate)",
    initialValue: () => randomToken(),
    onAnswer: (value, state) => {
      const token = toTrimmedString(value) || randomToken();
      state.gatewayToken = token;
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          auth: {
            ...state.draftConfig.gateway?.auth,
            mode: "token",
            token,
          },
        },
      };
    },
    next: () => "gateway.apply",
  };

  steps["gateway.auth.password"] = {
    id: "gateway.auth.password",
    type: "text",
    message: "Gateway password",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    sensitive: true,
    onAnswer: (value, state) => {
      const password = toTrimmedString(value);
      state.draftConfig = {
        ...state.draftConfig,
        gateway: {
          ...state.draftConfig.gateway,
          auth: {
            ...state.draftConfig.gateway?.auth,
            mode: "password",
            password,
          },
        },
      };
    },
    next: () => "gateway.apply",
  };

  steps["gateway.apply"] = {
    id: "gateway.apply",
    type: "action",
    title: "Apply gateway config",
    message: "Save gateway settings to config.",
    onAnswer: async (_value, state, ctx) => {
      await commitConfig(state, ctx, "local");
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
