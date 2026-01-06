import { applyWizardMetadata } from "../../commands/onboard-helpers.js";
import { CONFIG_PATH_CLAWDBOT, writeConfigFile } from "../../config/config.js";
import type { WizardStepContext } from "../steps.js";
import type { WizardContext, WizardState } from "./types.js";

export async function commitConfig(
  state: WizardState,
  ctx: WizardStepContext<WizardState, WizardContext>,
  mode: "local" | "remote",
) {
  const next = applyWizardMetadata(state.draftConfig, {
    command: state.command,
    mode,
  });
  await writeConfigFile(next);
  state.draftConfig = next;
  state.baseConfig = next;
  state.gatewayToken = next.gateway?.auth?.token ?? state.gatewayToken;
  ctx.runtime.log(`Updated ${CONFIG_PATH_CLAWDBOT}`);
}
