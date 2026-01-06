import type { WizardStepDefinition } from "../steps.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "mode.select";

export function buildModeSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};
  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "select",
    message: "Where will the Gateway run?",
    options: (state) => [
      {
        value: "local",
        label: "Local (this machine)",
        hint: state.probes.local?.ok
          ? "Gateway reachable"
          : state.probes.local?.reason
            ? `No gateway detected (${state.probes.local.reason})`
            : "No gateway detected",
      },
      {
        value: "remote",
        label: "Remote (info-only)",
        hint: state.probes.remote
          ? state.probes.remote.ok
            ? "Gateway reachable"
            : state.probes.remote.reason
              ? `Configured but unreachable (${state.probes.remote.reason})`
              : "Configured but unreachable"
          : "No remote URL configured yet",
      },
    ],
    onAnswer: (value, state) => {
      state.mode = value as "local" | "remote";
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
