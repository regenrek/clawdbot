import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import { createConfigureEngine } from "../wizard/engine-factory.js";
import { runWizardCli } from "../wizard/run-cli.js";
import { printWizardHeader } from "./onboard-helpers.js";

export type WizardSection =
  | "model"
  | "providers"
  | "gateway"
  | "daemon"
  | "workspace"
  | "skills"
  | "health";

type ConfigureWizardParams = {
  command: "configure" | "update";
  sections?: WizardSection[];
};

export async function runConfigureWizard(
  opts: ConfigureWizardParams,
  runtime: RuntimeEnv = defaultRuntime,
  prompter = createClackPrompter(),
) {
  printWizardHeader(runtime);
  await prompter.intro(
    opts.command === "update" ? "Clawdbot update wizard" : "Clawdbot configure",
  );

  const engine = await createConfigureEngine(
    {
      command: opts.command,
      sections: opts.sections,
      allowDisable: true,
      allowSignalInstall: true,
    },
    runtime,
  );

  const result = await runWizardCli(engine, prompter);
  if (result.status === "cancelled") {
    await prompter.outro("Setup cancelled.");
    return;
  }
  if (result.status === "error") {
    await prompter.outro(result.error ?? "Wizard failed.");
    throw new Error(result.error ?? "wizard failed");
  }
  await prompter.outro("Configure complete.");
}

export async function configureCommand(runtime: RuntimeEnv = defaultRuntime) {
  await runConfigureWizard({ command: "configure" }, runtime);
}
