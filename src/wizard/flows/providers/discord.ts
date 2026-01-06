import type { WizardStepDefinition, WizardStepOption } from "../../steps.js";
import { toTrimmedString } from "../../values.js";
import type { WizardContext, WizardState } from "../types.js";

type StepMap = Record<string, WizardStepDefinition<WizardState, WizardContext>>;

export function addDiscordSteps(steps: StepMap, afterId: string) {
  steps["providers.discord.start"] = {
    id: "providers.discord.start",
    type: "note",
    title: "Discord bot token",
    message: (state) =>
      state.providers.status?.discordConfigured
        ? "Discord token already configured."
        : [
            "1) Discord Developer Portal → Applications → New Application",
            "2) Bot → Add Bot → Reset Token → copy token",
            "3) OAuth2 → URL Generator → scope 'bot' → invite to your server",
            "Tip: enable Message Content Intent if you need message text.",
          ].join("\n"),
    next: () => "providers.discord.mode",
  };

  steps["providers.discord.mode"] = {
    id: "providers.discord.mode",
    type: "select",
    message: "Discord auth",
    options: (state) => {
      const env = Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
      const existing = Boolean(state.draftConfig.discord?.token);
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
          discord: { ...state.draftConfig.discord, enabled: true },
        };
      }
    },
    next: (value) => (value === "enter" ? "providers.discord.token" : afterId),
  };

  steps["providers.discord.token"] = {
    id: "providers.discord.token",
    type: "text",
    message: "Enter Discord bot token",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const token = toTrimmedString(value);
      state.draftConfig = {
        ...state.draftConfig,
        discord: { ...state.draftConfig.discord, enabled: true, token },
      };
    },
    next: () => afterId,
  };
}
