import type { WizardEngine, WizardEngineResult } from "./engine.js";
import type { WizardNavAction } from "./nav.js";
import type { WizardPrompter, WizardPromptResult } from "./prompts.js";
import type { WizardStep } from "./steps.js";
import { toPromptString } from "./values.js";

export async function runWizardCli<State, Ctx>(
  engine: WizardEngine<State, Ctx>,
  prompter: WizardPrompter,
): Promise<WizardEngineResult> {
  let result = await engine.start();
  while (!result.done && result.step) {
    if (result.error && result.status === "running") {
      await prompter.note(result.error, "Input error");
    }
    const step = result.step;
    const canGoBack = Boolean(result.canGoBack);
    const response = await promptStep(prompter, step, canGoBack);
    const nav = response.nav ?? "next";
    result = await engine.next({ stepId: step.id, value: response.value, nav });
  }
  return result;
}

async function promptStep(
  prompter: WizardPrompter,
  step: WizardStep,
  canGoBack: boolean,
): Promise<WizardPromptResult<unknown> & { nav?: WizardNavAction }> {
  switch (step.type) {
    case "note":
      if (step.message || step.title) {
        await prompter.note(step.message ?? "", step.title);
      }
      return { value: undefined };
    case "select":
      return await prompter.select({
        message: step.message ?? "Select",
        options: step.options ?? [],
        initialValue: step.initialValue as string | undefined,
        nav: { canGoBack },
      });
    case "multiselect":
      return await prompter.multiselect({
        message: step.message ?? "Select",
        options: step.options ?? [],
        initialValues: Array.isArray(step.initialValue)
          ? (step.initialValue as string[])
          : undefined,
        nav: { canGoBack },
      });
    case "text":
      return await prompter.text({
        message: step.message ?? "Enter value",
        initialValue: toPromptString(step.initialValue),
        placeholder: step.placeholder,
        nav: { canGoBack },
      });
    case "confirm":
      return await prompter.confirm({
        message: step.message ?? "Confirm",
        initialValue: Boolean(step.initialValue),
        nav: { canGoBack },
      });
    case "action":
      if (step.message || step.title) {
        await prompter.note(step.message ?? "", step.title);
      }
      return { value: undefined };
    case "progress":
      if (step.message || step.title) {
        await prompter.note(step.message ?? "", step.title);
      }
      return { value: undefined };
    default:
      return { value: undefined };
  }
}
