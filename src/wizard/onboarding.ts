import { printWizardHeader } from "../commands/onboard-helpers.js";
import type { OnboardOptions } from "../commands/onboard-types.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { createOnboardingEngine } from "./engine-factory.js";
import type { WizardPrompter } from "./prompts.js";
import { runWizardCli } from "./run-cli.js";

export async function runOnboardingWizard(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
  prompter: WizardPrompter,
) {
  printWizardHeader(runtime);
  await prompter.intro("Clawdbot onboarding");

  const engine = await createOnboardingEngine(opts, runtime);

  const result = await runWizardCli(engine, prompter);
  if (result.status === "cancelled") {
    await prompter.outro("Setup cancelled.");
    return;
  }
  if (result.status === "error") {
    await prompter.outro(result.error ?? "Wizard failed.");
    throw new Error(result.error ?? "wizard failed");
  }
  await prompter.outro("Onboarding complete.");
}
