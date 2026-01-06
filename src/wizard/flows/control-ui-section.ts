import {
  detectBrowserOpenSupport,
  formatControlUiSshHint,
  openUrl,
  resolveControlUiLinks,
} from "../../commands/onboard-helpers.js";
import { ensureControlUiAssetsBuilt } from "../../infra/control-ui-assets.js";
import type { WizardStepDefinition } from "../steps.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "controlui.assets";

export function buildControlUiSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};
  const resolveTokenParam = (state: WizardState): string => {
    const authMode = state.draftConfig.gateway?.auth?.mode ?? "off";
    if (authMode !== "token") return "";
    return state.gatewayToken ? `?token=${encodeURIComponent(state.gatewayToken)}` : "";
  };
  const resolveTokenValue = (state: WizardState): string | undefined => {
    const authMode = state.draftConfig.gateway?.auth?.mode ?? "off";
    return authMode === "token" ? state.gatewayToken : undefined;
  };

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "action",
    title: "Control UI",
    message: "Preparing Control UI assets.",
    onAnswer: async (_value, state, ctx) => {
      const result = await ensureControlUiAssetsBuilt(ctx.context.runtime);
      state.controlUi.assetsOk = result.ok;
      state.controlUi.assetsMessage = result.message;
      if (!result.ok && result.message) {
        ctx.context.runtime.error(result.message);
      }
    },
    next: () => "controlui.links",
  };

  steps["controlui.links"] = {
    id: "controlui.links",
    type: "note",
    title: "Control UI",
    message: (state) => {
      const bind = state.draftConfig.gateway?.bind ?? "loopback";
      const links = resolveControlUiLinks({
        bind,
        port: state.gatewayPort,
        basePath: state.draftConfig.gateway?.controlUi?.basePath,
      });
      const tokenParam = resolveTokenParam(state);
      const authedUrl = tokenParam ? `${links.httpUrl}${tokenParam}` : undefined;
      return [
        `Web UI: ${links.httpUrl}`,
        authedUrl ? `Web UI (with token): ${authedUrl}` : undefined,
        `Gateway WS: ${links.wsUrl}`,
      ]
        .filter(Boolean)
        .join("\n");
    },
    next: () => "controlui.browser.check",
  };

  steps["controlui.browser.check"] = {
    id: "controlui.browser.check",
    type: "action",
    title: "Control UI",
    message: "Checking browser support.",
    onAnswer: async (_value, state) => {
      const support = await detectBrowserOpenSupport();
      state.controlUi.browserSupported = support.ok;
    },
    next: (_value, state) =>
      state.controlUi.browserSupported
        ? "controlui.open.confirm"
        : "controlui.ssh.note",
  };

  steps["controlui.open.confirm"] = {
    id: "controlui.open.confirm",
    type: "confirm",
    message: "Open Control UI now?",
    initialValue: () => false,
    next: (value) => (value ? "controlui.open.run" : nextId),
  };

  steps["controlui.open.run"] = {
    id: "controlui.open.run",
    type: "action",
    title: "Open Control UI",
    message: "Opening Control UI.",
    onAnswer: async (_value, state, ctx) => {
      const bind = state.draftConfig.gateway?.bind ?? "loopback";
      const links = resolveControlUiLinks({
        bind,
        port: state.gatewayPort,
        basePath: state.draftConfig.gateway?.controlUi?.basePath,
      });
      const tokenParam = resolveTokenParam(state);
      const opened = await openUrl(`${links.httpUrl}${tokenParam}`);
      if (!opened) {
        state.controlUi.browserSupported = false;
        ctx.context.runtime.error("Unable to open browser.");
      }
    },
    next: (_value, state) =>
      state.controlUi.browserSupported ? nextId : "controlui.ssh.note",
  };

  steps["controlui.ssh.note"] = {
    id: "controlui.ssh.note",
    type: "note",
    title: "Open Control UI",
    message: (state) =>
      formatControlUiSshHint({
        port: state.gatewayPort,
        basePath: state.draftConfig.gateway?.controlUi?.basePath,
        token: resolveTokenValue(state),
      }),
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
