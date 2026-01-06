import { healthCommand } from "../../commands/health.js";
import { resolveGatewayService } from "../../daemon/service.js";
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

  const summarizeError = (error?: string) => {
    if (!error) return "";
    const firstLine = error.split("\n")[0]?.trim();
    return firstLine ? `Error: ${firstLine}` : "";
  };

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "action",
    title: "Health check",
    message: "Running clawdbot health.",
    onAnswer: async (_value, state, ctx) => {
      await sleep(1000);
      try {
        await healthCommand(
          { json: false, timeoutMs: 10_000 },
          ctx.context.runtime,
        );
        state.health = { ok: true };
      } catch (err) {
        const error = String(err);
        const service = resolveGatewayService();
        let canRestart = false;
        try {
          canRestart = await service.isLoaded({ env: process.env });
        } catch {
          canRestart = false;
        }
        state.health = { ok: false, error, canRestart };
        ctx.context.runtime.error(`Health check failed: ${error}`);
      }
    },
    next: (_value, state) => (state.health?.ok ? nextId : "health.failed"),
  };

  steps["health.failed"] = {
    id: "health.failed",
    type: "select",
    message: (state) => {
      const summary = summarizeError(state.health?.error);
      return [
        "Health check failed.",
        summary ? summary : "Gateway not reachable.",
        "Choose an action.",
      ]
        .filter(Boolean)
        .join("\n");
    },
    options: (state) => {
      const options = [];
      if (state.health?.canRestart) {
        options.push({ value: "restart", label: "Restart gateway service" });
      }
      options.push({ value: "retry", label: "Retry health check" });
      options.push({ value: "skip", label: "Skip" });
      return options;
    },
    next: (value) => {
      if (value === "restart") return "health.restart";
      if (value === "retry") return ENTRY_ID;
      return nextId;
    },
  };

  steps["health.restart"] = {
    id: "health.restart",
    type: "action",
    title: "Restart gateway",
    message: "Restarting gateway service.",
    onAnswer: async (_value, _state, ctx) => {
      const service = resolveGatewayService();
      try {
        await service.restart({ stdout: process.stdout });
      } catch (err) {
        ctx.context.runtime.error(`Restart failed: ${String(err)}`);
      }
    },
    next: () => ENTRY_ID,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
