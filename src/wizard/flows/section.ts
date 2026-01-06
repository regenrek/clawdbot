import type { WizardStepDefinition } from "../steps.js";

export type WizardSectionSteps<State, Ctx> = {
  entryId: string;
  exitId: string;
  steps: Record<string, WizardStepDefinition<State, Ctx>>;
};
