import type { OnboardOptions } from "../commands/onboard-types.js";
import type { RuntimeEnv } from "../runtime.js";
import { WizardEngine } from "./engine.js";
import { createConfigureFlow, createOnboardingFlow } from "./flows/index.js";
import { createWizardState } from "./flows/state.js";
import type {
  WizardContext,
  WizardSection,
  WizardState,
} from "./flows/types.js";
import type { WizardRuntime } from "./steps.js";

export function createWizardRuntime(runtime: RuntimeEnv): WizardRuntime {
  return {
    log: runtime.log.bind(runtime),
    error: runtime.error.bind(runtime),
  };
}

export function createWizardContext(runtime: RuntimeEnv): WizardContext {
  return { runtime, oauth: {} };
}

export async function createOnboardingEngine(
  opts: OnboardOptions,
  runtime: RuntimeEnv,
): Promise<WizardEngine<WizardState, WizardContext>> {
  const state = await createWizardState({
    command: "onboard",
    runtime,
    mode: opts.mode,
    workspace: opts.workspace,
  });
  const flow = createOnboardingFlow(state);
  return new WizardEngine({
    flow,
    initialState: state,
    runtime: createWizardRuntime(runtime),
    context: createWizardContext(runtime),
  });
}

export async function createConfigureEngine(
  opts: {
    command: "configure" | "update";
    sections?: WizardSection[];
    allowDisable: boolean;
    allowSignalInstall: boolean;
  },
  runtime: RuntimeEnv,
): Promise<WizardEngine<WizardState, WizardContext>> {
  const state = await createWizardState({
    command: opts.command,
    runtime,
    sections: opts.sections,
  });
  const flow = createConfigureFlow(state, {
    allowDisable: opts.allowDisable,
    allowSignalInstall: opts.allowSignalInstall,
  });
  return new WizardEngine({
    flow,
    initialState: state,
    runtime: createWizardRuntime(runtime),
    context: createWizardContext(runtime),
  });
}
