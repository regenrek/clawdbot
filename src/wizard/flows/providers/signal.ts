import { installSignalCli } from "../../../commands/signal-install.js";
import type { WizardStepDefinition } from "../../steps.js";
import { toTrimmedString } from "../../values.js";
import type { WizardContext, WizardState } from "../types.js";

type StepMap = Record<string, WizardStepDefinition<WizardState, WizardContext>>;

export function addSignalSteps(
  steps: StepMap,
  afterId: string,
  opts: { allowSignalInstall: boolean },
) {
  steps["providers.signal.start"] = {
    id: "providers.signal.start",
    type: "confirm",
    message: (state) =>
      state.providers.signalCliDetected
        ? "signal-cli detected. Reinstall/update now?"
        : "signal-cli not found. Install now?",
    initialValue: (state) => !state.providers.signalCliDetected,
    next: (value) => {
      if (!opts.allowSignalInstall) return "providers.signal.account";
      return value ? "providers.signal.install" : "providers.signal.account";
    },
  };

  steps["providers.signal.install"] = {
    id: "providers.signal.install",
    type: "action",
    title: "signal-cli",
    message: "Installing signal-cli.",
    onAnswer: async (_value, state, ctx) => {
      const result = await installSignalCli(ctx.context.runtime);
      if (result.ok && result.cliPath) {
        state.providers.signalCliPath = result.cliPath;
        state.providers.signalCliDetected = true;
      } else if (!result.ok) {
        ctx.context.runtime.error(result.error ?? "signal-cli install failed");
      }
    },
    next: () => "providers.signal.account",
  };

  steps["providers.signal.account"] = {
    id: "providers.signal.account",
    type: "text",
    message: "Signal bot number (E.164)",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const account = toTrimmedString(value);
      if (!account) return;
      state.draftConfig = {
        ...state.draftConfig,
        signal: {
          ...state.draftConfig.signal,
          enabled: true,
          account,
          cliPath: state.providers.signalCliPath ?? "signal-cli",
        },
      };
    },
    next: () => "providers.signal.note",
  };

  steps["providers.signal.note"] = {
    id: "providers.signal.note",
    type: "note",
    title: "Signal next steps",
    message: [
      'Link device with: signal-cli link -n "Clawdbot"',
      "Scan QR in Signal → Linked Devices",
      "Then run: clawdbot gateway call providers.status --params '{\"probe\":true}'",
    ].join("\n"),
    next: () => afterId,
  };
}
