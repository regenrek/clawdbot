import type { WizardStepDefinition, WizardStepOption } from "../../steps.js";
import { toTrimmedString } from "../../values.js";
import type { WizardContext, WizardState } from "../types.js";

type StepMap = Record<string, WizardStepDefinition<WizardState, WizardContext>>;

export function addTelegramSteps(steps: StepMap, afterId: string) {
  steps["providers.telegram.start"] = {
    id: "providers.telegram.start",
    type: "note",
    title: "Telegram bot token",
    message: (state) =>
      state.providers.status?.telegramConfigured
        ? "Telegram token already configured."
        : [
            "1) Open Telegram and chat with @BotFather",
            "2) Run /newbot (or /mybots)",
            "3) Copy the token (looks like 123456:ABC...)",
            "Tip: you can also set TELEGRAM_BOT_TOKEN in your env.",
          ].join("\n"),
    next: () => "providers.telegram.mode",
  };

  steps["providers.telegram.mode"] = {
    id: "providers.telegram.mode",
    type: "select",
    message: "Telegram auth",
    options: (state) => {
      const env = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
      const existing = Boolean(state.draftConfig.telegram?.botToken);
      const options: WizardStepOption[] = [];
      if (env) options.push({ value: "env", label: "Use env token" });
      if (existing) options.push({ value: "keep", label: "Keep existing" });
      options.push({ value: "enter", label: "Enter token" });
      return options;
    },
    onAnswer: (value, state) => {
      if (value === "env") {
        state.draftConfig = {
          ...state.draftConfig,
          telegram: { ...state.draftConfig.telegram, enabled: true },
        };
      }
    },
    next: (value) => (value === "enter" ? "providers.telegram.token" : afterId),
  };

  steps["providers.telegram.token"] = {
    id: "providers.telegram.token",
    type: "text",
    message: "Enter Telegram bot token",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const token = toTrimmedString(value);
      state.draftConfig = {
        ...state.draftConfig,
        telegram: {
          ...state.draftConfig.telegram,
          enabled: true,
          botToken: token,
        },
      };
    },
    next: () => afterId,
  };
}
