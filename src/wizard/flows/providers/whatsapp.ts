import { loginWeb } from "../../../provider-web.js";
import { normalizeE164 } from "../../../utils.js";
import type { WizardStepDefinition } from "../../steps.js";
import { toTrimmedString } from "../../values.js";
import type { WizardContext, WizardState } from "../types.js";
import { computeProviderStatus } from "./helpers.js";

type StepMap = Record<string, WizardStepDefinition<WizardState, WizardContext>>;

function setWhatsAppAllowFrom(
  cfg: WizardState["draftConfig"],
  allowFrom?: string[],
) {
  return {
    ...cfg,
    whatsapp: {
      ...cfg.whatsapp,
      allowFrom,
    },
  };
}

export function addWhatsAppSteps(steps: StepMap, afterId: string) {
  steps["providers.whatsapp.start"] = {
    id: "providers.whatsapp.start",
    type: "note",
    title: "WhatsApp linking",
    message: (state) =>
      state.providers.status?.whatsappLinked
        ? "WhatsApp already linked."
        : "Scan the QR with WhatsApp on your phone. Credentials are stored for future runs.",
    next: () => "providers.whatsapp.link.confirm",
  };

  steps["providers.whatsapp.link.confirm"] = {
    id: "providers.whatsapp.link.confirm",
    type: "confirm",
    message: (state) =>
      state.providers.status?.whatsappLinked
        ? "WhatsApp already linked. Re-link now?"
        : "Link WhatsApp now (QR)?",
    initialValue: (state) => !state.providers.status?.whatsappLinked,
    next: (value) =>
      value ? "providers.whatsapp.link.run" : "providers.whatsapp.allow.note",
  };

  steps["providers.whatsapp.link.run"] = {
    id: "providers.whatsapp.link.run",
    type: "action",
    title: "WhatsApp QR",
    message: "Waiting for QR scan.",
    onAnswer: async (_value, state, ctx) => {
      try {
        await loginWeb(false, "web");
        state.providers.status = await computeProviderStatus(state);
      } catch (err) {
        ctx.context.runtime.error(`WhatsApp login failed: ${String(err)}`);
      }
    },
    next: () => "providers.whatsapp.allow.note",
  };

  steps["providers.whatsapp.allow.note"] = {
    id: "providers.whatsapp.allow.note",
    type: "note",
    title: "WhatsApp allowlist",
    message: (state) => {
      const existing = state.draftConfig.whatsapp?.allowFrom ?? [];
      const label = existing.length > 0 ? existing.join(", ") : "unset";
      return [
        "WhatsApp direct chats are gated by whatsapp.allowFrom.",
        'Default (unset) = self-chat only; use "*" to allow anyone.',
        `Current: ${label}`,
      ].join("\n");
    },
    next: () => "providers.whatsapp.allow.mode",
  };

  steps["providers.whatsapp.allow.mode"] = {
    id: "providers.whatsapp.allow.mode",
    type: "select",
    message: "Who can trigger the bot via WhatsApp?",
    options: (state) => {
      const existing = state.draftConfig.whatsapp?.allowFrom ?? [];
      if (existing.length > 0) {
        return [
          { value: "keep", label: "Keep current" },
          { value: "self", label: "Self-chat only (unset)" },
          { value: "list", label: "Specific numbers (recommended)" },
          { value: "any", label: "Anyone (*)" },
        ];
      }
      return [
        { value: "self", label: "Self-chat only (default)" },
        { value: "list", label: "Specific numbers (recommended)" },
        { value: "any", label: "Anyone (*)" },
      ];
    },
    onAnswer: (value, state) => {
      if (value === "self") {
        state.draftConfig = setWhatsAppAllowFrom(state.draftConfig, undefined);
      }
      if (value === "any") {
        state.draftConfig = setWhatsAppAllowFrom(state.draftConfig, ["*"]);
      }
    },
    next: (value) =>
      value === "list" ? "providers.whatsapp.allow.list" : afterId,
  };

  steps["providers.whatsapp.allow.list"] = {
    id: "providers.whatsapp.allow.list",
    type: "text",
    message: "Allowed sender numbers (comma-separated, E.164)",
    placeholder: "+15555550123, +447700900123",
    validate: (value) => {
      const raw = toTrimmedString(value);
      if (!raw) return "Required";
      const parts = raw
        .split(/[\n,;]+/g)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) return "Required";
      for (const part of parts) {
        if (part === "*") continue;
        const normalized = normalizeE164(part);
        if (!normalized) return `Invalid number: ${part}`;
      }
      return undefined;
    },
    onAnswer: (value, state) => {
      const parts = toTrimmedString(value)
        .split(/[\n,;]+/g)
        .map((p) => p.trim())
        .filter(Boolean);
      const normalized = parts.map((part) =>
        part === "*" ? "*" : normalizeE164(part),
      );
      const unique = [...new Set(normalized.filter(Boolean))];
      state.draftConfig = setWhatsAppAllowFrom(state.draftConfig, unique);
    },
    next: () => afterId,
  };
}
