import fs from "node:fs/promises";
import path from "node:path";
import { detectBinary } from "../../../commands/onboard-helpers.js";
import type { ProviderChoice } from "../../../commands/onboard-types.js";
import { resolveWebAuthDir } from "../../../web/session.js";
import type { WizardStepOption } from "../../steps.js";
import type { ProviderStatus, WizardState } from "../types.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectWhatsAppLinked(): Promise<boolean> {
  const credsPath = path.join(resolveWebAuthDir(), "creds.json");
  return await pathExists(credsPath);
}

export async function computeProviderStatus(
  state: WizardState,
): Promise<ProviderStatus> {
  const whatsappLinked = await detectWhatsAppLinked();
  const telegramEnv = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const discordEnv = Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
  const slackBotEnv = Boolean(process.env.SLACK_BOT_TOKEN?.trim());
  const slackAppEnv = Boolean(process.env.SLACK_APP_TOKEN?.trim());
  const telegramConfigured = Boolean(
    telegramEnv ||
      state.draftConfig.telegram?.botToken ||
      state.draftConfig.telegram?.tokenFile,
  );
  const discordConfigured = Boolean(
    discordEnv || state.draftConfig.discord?.token,
  );
  const slackConfigured = Boolean(
    (slackBotEnv && slackAppEnv) ||
      (state.draftConfig.slack?.botToken && state.draftConfig.slack?.appToken),
  );
  const signalConfigured = Boolean(
    state.draftConfig.signal?.account ||
      state.draftConfig.signal?.httpUrl ||
      state.draftConfig.signal?.httpPort,
  );
  const signalCliPath = state.draftConfig.signal?.cliPath ?? "signal-cli";
  const signalCliDetected = await detectBinary(signalCliPath);
  const imessageConfigured = Boolean(
    state.draftConfig.imessage?.cliPath ||
      state.draftConfig.imessage?.dbPath ||
      state.draftConfig.imessage?.allowFrom,
  );
  const imessageCliPath = state.draftConfig.imessage?.cliPath ?? "imsg";
  const imessageCliDetected = await detectBinary(imessageCliPath);

  state.providers.signalCliPath = signalCliPath;
  state.providers.signalCliDetected = signalCliDetected;
  state.providers.imessageCliPath = imessageCliPath;
  state.providers.imessageCliDetected = imessageCliDetected;

  return {
    whatsappLinked,
    telegramConfigured,
    discordConfigured,
    slackConfigured,
    signalConfigured,
    signalCliDetected,
    imessageConfigured,
    imessageCliDetected,
  };
}

export function statusSummary(
  state: WizardState,
  status: ProviderStatus,
): string {
  return [
    `WhatsApp: ${status.whatsappLinked ? "linked" : "not linked"}`,
    `Telegram: ${status.telegramConfigured ? "configured" : "needs token"}`,
    `Discord: ${status.discordConfigured ? "configured" : "needs token"}`,
    `Slack: ${status.slackConfigured ? "configured" : "needs tokens"}`,
    `Signal: ${status.signalConfigured ? "configured" : "needs setup"}`,
    `iMessage: ${status.imessageConfigured ? "configured" : "needs setup"}`,
    `signal-cli: ${status.signalCliDetected ? "found" : "missing"} (${state.providers.signalCliPath ?? "signal-cli"})`,
    `imsg: ${status.imessageCliDetected ? "found" : "missing"} (${state.providers.imessageCliPath ?? "imsg"})`,
  ].join("\n");
}

export function providerOptions(
  state: WizardState,
): WizardStepOption<ProviderChoice>[] {
  const status = state.providers.status;
  return [
    {
      value: "whatsapp",
      label: "WhatsApp (QR link)",
      hint: status?.whatsappLinked ? "linked" : "not linked",
    },
    {
      value: "telegram",
      label: "Telegram (Bot API)",
      hint: status?.telegramConfigured ? "configured" : "needs token",
    },
    {
      value: "discord",
      label: "Discord (Bot API)",
      hint: status?.discordConfigured ? "configured" : "needs token",
    },
    {
      value: "slack",
      label: "Slack (Socket Mode)",
      hint: status?.slackConfigured ? "configured" : "needs tokens",
    },
    {
      value: "signal",
      label: "Signal (signal-cli)",
      hint: status?.signalCliDetected
        ? "signal-cli found"
        : "signal-cli missing",
    },
    {
      value: "imessage",
      label: "iMessage (imsg)",
      hint: status?.imessageCliDetected ? "imsg found" : "imsg missing",
    },
  ];
}

export function disableOptions(
  state: WizardState,
): WizardStepOption<ProviderChoice>[] {
  const status = state.providers.status;
  const options: WizardStepOption<ProviderChoice>[] = [];
  if (status?.telegramConfigured)
    options.push({ value: "telegram", label: "Telegram" });
  if (status?.discordConfigured)
    options.push({ value: "discord", label: "Discord" });
  if (status?.slackConfigured) options.push({ value: "slack", label: "Slack" });
  if (status?.signalConfigured)
    options.push({ value: "signal", label: "Signal" });
  if (status?.imessageConfigured)
    options.push({ value: "imessage", label: "iMessage" });
  return options;
}
