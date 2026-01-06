import type { WizardStepDefinition } from "../../steps.js";
import { toTrimmedString } from "../../values.js";
import type { WizardContext, WizardState } from "../types.js";

type StepMap = Record<string, WizardStepDefinition<WizardState, WizardContext>>;

export function addIMessageSteps(steps: StepMap, afterId: string) {
  steps["providers.imessage.start"] = {
    id: "providers.imessage.start",
    type: "text",
    message: "imsg CLI path",
    initialValue: (state) => state.providers.imessageCliPath ?? "imsg",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const pathValue = toTrimmedString(value);
      state.providers.imessageCliPath = pathValue;
      state.draftConfig = {
        ...state.draftConfig,
        imessage: {
          ...state.draftConfig.imessage,
          enabled: true,
          cliPath: pathValue,
        },
      };
    },
    next: () => "providers.imessage.note",
  };

  steps["providers.imessage.note"] = {
    id: "providers.imessage.note",
    type: "note",
    title: "iMessage next steps",
    message: [
      "Ensure Clawdbot has Full Disk Access to Messages DB.",
      "Grant Automation permission for Messages when prompted.",
      "List chats with: imsg chats --limit 20",
    ].join("\n"),
    next: () => afterId,
  };
}
