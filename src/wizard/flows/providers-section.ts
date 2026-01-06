import type { ProviderChoice } from "../../commands/onboard-types.js";
import type { WizardStepDefinition } from "../steps.js";
import { commitConfig } from "./apply.js";
import { addDiscordSteps } from "./providers/discord.js";
import {
  computeProviderStatus,
  disableOptions,
  providerOptions,
  statusSummary,
} from "./providers/helpers.js";
import { addIMessageSteps } from "./providers/imessage.js";
import { addSignalSteps } from "./providers/signal.js";
import { addSlackSteps } from "./providers/slack.js";
import { addTelegramSteps } from "./providers/telegram.js";
import { addWhatsAppSteps } from "./providers/whatsapp.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "providers.refresh";
const PROVIDER_ORDER: ProviderChoice[] = [
  "whatsapp",
  "telegram",
  "discord",
  "slack",
  "signal",
  "imessage",
];

type StepMap = Record<string, WizardStepDefinition<WizardState, WizardContext>>;

function nextProviderStep(state: WizardState): string {
  const current = state.providers.queue[state.providers.index];
  if (!current) return ENTRY_ID;
  return `providers.${current}.start`;
}

export function buildProvidersSection(
  nextId: string,
  opts: { allowDisable: boolean; allowSignalInstall: boolean },
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: StepMap = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "action",
    title: "Providers",
    message: "Checking provider status.",
    onAnswer: async (_value, state) => {
      state.providers.status = await computeProviderStatus(state);
    },
    next: () => "providers.status",
  };

  steps["providers.status"] = {
    id: "providers.status",
    type: "note",
    title: "Provider status",
    message: (state) =>
      state.providers.status
        ? statusSummary(state, state.providers.status)
        : "Provider status unavailable.",
    next: () => "providers.hub",
  };

  steps["providers.hub"] = {
    id: "providers.hub",
    type: "select",
    message: "Provider actions",
    options: () => {
      const options = [
        { value: "configure", label: "Configure providers" },
        ...(opts.allowDisable
          ? [{ value: "disable", label: "Disable providers" }]
          : []),
        { value: "continue", label: "Continue" },
      ];
      return options;
    },
    next: (value) => {
      if (value === "configure") return "providers.select";
      if (value === "disable") return "providers.disable.select";
      return "providers.apply";
    },
  };

  steps["providers.select"] = {
    id: "providers.select",
    type: "multiselect",
    message: "Select providers",
    options: (state) => providerOptions(state),
    onAnswer: (value, state) => {
      const selection = Array.isArray(value) ? (value as ProviderChoice[]) : [];
      state.providers.queue = PROVIDER_ORDER.filter((p) =>
        selection.includes(p),
      );
      state.providers.index = 0;
    },
    next: (_value, state) =>
      state.providers.queue.length > 0 ? nextProviderStep(state) : ENTRY_ID,
  };

  steps["providers.after"] = {
    id: "providers.after",
    type: "select",
    message: "Provider complete",
    options: () => [
      { value: "next", label: "Next provider" },
      { value: "hub", label: "Return to hub" },
      { value: "back", label: "Back" },
    ],
    onAnswer: (value, state) => {
      if (value === "next") state.providers.index += 1;
    },
    next: (value, state) => {
      if (value === "back") return { nav: "back" };
      if (value === "hub") return ENTRY_ID;
      const next = state.providers.queue[state.providers.index];
      if (!next) return ENTRY_ID;
      return nextProviderStep(state);
    },
  };

  steps["providers.disable.select"] = {
    id: "providers.disable.select",
    type: "multiselect",
    message: "Disable providers",
    options: (state) => disableOptions(state),
    onAnswer: (value, state) => {
      const selection = Array.isArray(value) ? (value as ProviderChoice[]) : [];
      if (selection.includes("telegram")) {
        state.draftConfig = {
          ...state.draftConfig,
          telegram: { ...state.draftConfig.telegram, enabled: false },
        };
      }
      if (selection.includes("discord")) {
        state.draftConfig = {
          ...state.draftConfig,
          discord: { ...state.draftConfig.discord, enabled: false },
        };
      }
      if (selection.includes("slack")) {
        state.draftConfig = {
          ...state.draftConfig,
          slack: { ...state.draftConfig.slack, enabled: false },
        };
      }
      if (selection.includes("signal")) {
        state.draftConfig = {
          ...state.draftConfig,
          signal: { ...state.draftConfig.signal, enabled: false },
        };
      }
      if (selection.includes("imessage")) {
        state.draftConfig = {
          ...state.draftConfig,
          imessage: { ...state.draftConfig.imessage, enabled: false },
        };
      }
    },
    next: () => ENTRY_ID,
  };

  steps["providers.apply"] = {
    id: "providers.apply",
    type: "action",
    title: "Apply providers",
    message: "Save provider configuration.",
    onAnswer: async (_value, state, ctx) => {
      await commitConfig(state, ctx, "local");
    },
    next: () => nextId,
  };

  addWhatsAppSteps(steps, "providers.after");
  addTelegramSteps(steps, "providers.after");
  addDiscordSteps(steps, "providers.after");
  addSlackSteps(steps, "providers.after");
  addSignalSteps(steps, "providers.after", {
    allowSignalInstall: opts.allowSignalInstall,
  });
  addIMessageSteps(steps, "providers.after");

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
