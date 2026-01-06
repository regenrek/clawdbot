import { healthCommand } from "../../commands/health.js";
import { sleep } from "../../utils.js";
import type { WizardStepDefinition } from "../steps.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "health.run";

export function buildHealthSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "action",
    title: "Health check",
    message: "Running clawdbot health.",
    onAnswer: async (_value, _state, ctx) => {
      await sleep(1000);
      try {
        await healthCommand(
          { json: false, timeoutMs: 10_000 },
          ctx.context.runtime,
        );
      } catch (err) {
        ctx.context.runtime.error(`Health check failed: ${String(err)}`);
      }
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
