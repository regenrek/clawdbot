import {
  DEFAULT_WORKSPACE,
  ensureWorkspaceAndSessions,
} from "../../commands/onboard-helpers.js";
import { resolveUserPath } from "../../utils.js";
import type { WizardStepDefinition } from "../steps.js";
import { toTrimmedString } from "../values.js";
import { commitConfig } from "./apply.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "workspace.path";

export function buildWorkspaceSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "text",
    message: "Workspace directory",
    initialValue: (state) => state.workspaceDir || DEFAULT_WORKSPACE,
    onAnswer: (value, state) => {
      const dir = resolveUserPath(toTrimmedString(value) || DEFAULT_WORKSPACE);
      state.workspaceDir = dir;
      state.draftConfig = {
        ...state.draftConfig,
        agent: {
          ...state.draftConfig.agent,
          workspace: dir,
        },
      };
    },
    next: () => "workspace.apply",
  };

  steps["workspace.apply"] = {
    id: "workspace.apply",
    type: "action",
    title: "Apply workspace",
    message: "Create workspace folders and save configuration.",
    onAnswer: async (_value, state, ctx) => {
      await ensureWorkspaceAndSessions(state.workspaceDir, ctx.context.runtime);
      await commitConfig(state, ctx, "local");
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
