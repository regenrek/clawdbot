import {
  DEFAULT_WORKSPACE,
  handleReset,
  summarizeExistingConfig,
} from "../../commands/onboard-helpers.js";
import { resolveUserPath } from "../../utils.js";
import type { WizardStepDefinition } from "../steps.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "config.summary";

export function buildConfigSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "note",
    title: (state) =>
      state.snapshot.valid ? "Existing config detected" : "Invalid config",
    message: (state) => {
      const lines: string[] = [summarizeExistingConfig(state.baseConfig)];
      if (!state.snapshot.valid && state.snapshot.issues.length > 0) {
        lines.push(
          "",
          "Config issues:",
          ...state.snapshot.issues.map(
            (iss) => `- ${iss.path}: ${iss.message}`,
          ),
        );
      }
      return lines.join("\n");
    },
    next: (_value, state) => {
      if (state.command === "onboard") return "config.action";
      if (!state.snapshot.valid) return "config.invalid";
      return nextId;
    },
  };

  steps["config.invalid"] = {
    id: "config.invalid",
    type: "confirm",
    message: "Config invalid. Start fresh?",
    initialValue: () => true,
    onAnswer: (value, state) => {
      if (!value) return;
      state.baseConfig = {};
      state.draftConfig = {};
      state.workspaceDir = DEFAULT_WORKSPACE;
    },
    next: () => nextId,
  };

  steps["config.action"] = {
    id: "config.action",
    type: "select",
    message: "Config handling",
    options: () => [
      { value: "keep", label: "Use existing values" },
      { value: "modify", label: "Update values" },
      { value: "reset", label: "Reset" },
    ],
    onAnswer: (value, state) => {
      if (value === "keep" && !state.snapshot.valid) {
        state.baseConfig = {};
        state.draftConfig = {};
        state.workspaceDir = DEFAULT_WORKSPACE;
      }
    },
    next: (value) => (value === "reset" ? "config.reset.scope" : nextId),
  };

  steps["config.reset.scope"] = {
    id: "config.reset.scope",
    type: "select",
    message: "Reset scope",
    options: () => [
      { value: "config", label: "Config only" },
      { value: "config+creds+sessions", label: "Config + creds + sessions" },
      {
        value: "full",
        label: "Full reset (config + creds + sessions + workspace)",
      },
    ],
    onAnswer: (value, state) => {
      state.resetScope = value as "config" | "config+creds+sessions" | "full";
    },
    next: () => "config.reset.apply",
  };

  steps["config.reset.apply"] = {
    id: "config.reset.apply",
    type: "action",
    title: "Apply reset",
    message: "This will remove the selected data from disk.",
    onAnswer: async (_value, state, ctx) => {
      const scope = state.resetScope ?? "config";
      const workspaceDefault =
        state.baseConfig.agent?.workspace ?? DEFAULT_WORKSPACE;
      await handleReset(
        scope as "config" | "config+creds+sessions" | "full",
        resolveUserPath(workspaceDefault),
        ctx.context.runtime,
      );
      state.baseConfig = {};
      state.draftConfig = {};
      state.workspaceDir = DEFAULT_WORKSPACE;
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
