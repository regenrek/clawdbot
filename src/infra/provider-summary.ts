import chalk from "chalk";
import { type ClawdbotConfig, loadConfig } from "../config/config.js";
import { resolveTelegramToken } from "../telegram/token.js";
import { normalizeE164 } from "../utils.js";
import {
  getWebAuthAgeMs,
  readWebSelfId,
  webAuthExists,
} from "../web/session.js";

export type ProviderSummaryOptions = {
  colorize?: boolean;
  includeAllowFrom?: boolean;
};

const DEFAULT_OPTIONS: Required<ProviderSummaryOptions> = {
  colorize: false,
  includeAllowFrom: false,
};

export async function buildProviderSummary(
  cfg?: ClawdbotConfig,
  options?: ProviderSummaryOptions,
): Promise<string[]> {
  const effective = cfg ?? loadConfig();
  const lines: string[] = [];
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const tint = (value: string, color?: (input: string) => string) =>
    resolved.colorize && color ? color(value) : value;

  const webEnabled = effective.web?.enabled !== false;
  if (!webEnabled) {
    lines.push(tint("WhatsApp: disabled", chalk.cyan));
  } else {
    const webLinked = await webAuthExists();
    const authAgeMs = getWebAuthAgeMs();
    const authAge = authAgeMs === null ? "" : ` auth ${formatAge(authAgeMs)}`;
    const { e164 } = readWebSelfId();
    lines.push(
      webLinked
        ? tint(
            `WhatsApp: linked${e164 ? ` ${e164}` : ""}${authAge}`,
            chalk.green,
          )
        : tint("WhatsApp: not linked", chalk.red),
    );
  }

  const telegramEnabled = effective.telegram?.enabled !== false;
  if (!telegramEnabled) {
    lines.push(tint("Telegram: disabled", chalk.cyan));
  } else {
    const { token: telegramToken } = resolveTelegramToken(effective);
    const telegramConfigured = Boolean(telegramToken?.trim());
    lines.push(
      telegramConfigured
        ? tint("Telegram: configured", chalk.green)
        : tint("Telegram: not configured", chalk.cyan),
    );
  }

  const discordEnabled = effective.discord?.enabled !== false;
  if (!discordEnabled) {
    lines.push(tint("Discord: disabled", chalk.cyan));
  } else {
    const discordToken =
      process.env.DISCORD_BOT_TOKEN?.trim() || effective.discord?.token?.trim();
    const discordConfigured = Boolean(discordToken);
    lines.push(
      discordConfigured
        ? tint("Discord: configured", chalk.green)
        : tint("Discord: not configured", chalk.cyan),
    );
  }

  const slackEnabled = effective.slack?.enabled !== false;
  if (!slackEnabled) {
    lines.push(tint("Slack: disabled", chalk.cyan));
  } else {
    const botToken =
      process.env.SLACK_BOT_TOKEN?.trim() || effective.slack?.botToken?.trim();
    const appToken =
      process.env.SLACK_APP_TOKEN?.trim() || effective.slack?.appToken?.trim();
    const slackConfigured = Boolean(botToken && appToken);
    lines.push(
      slackConfigured
        ? tint("Slack: configured", chalk.green)
        : tint("Slack: not configured", chalk.cyan),
    );
  }

  const rocketchatEnabled = effective.rocketchat?.enabled !== false;
  if (!rocketchatEnabled) {
    lines.push(tint("Rocket.Chat: disabled", chalk.cyan));
  } else {
    const baseUrl =
      process.env.ROCKETCHAT_BASE_URL?.trim() ||
      effective.rocketchat?.baseUrl?.trim();
    const authToken =
      process.env.ROCKETCHAT_AUTH_TOKEN?.trim() ||
      effective.rocketchat?.authToken?.trim();
    const userId =
      process.env.ROCKETCHAT_USER_ID?.trim() ||
      effective.rocketchat?.userId?.trim();
    const webhookToken = effective.rocketchat?.webhook?.token?.trim();
    const rocketchatConfigured = Boolean(
      baseUrl && authToken && userId && webhookToken,
    );
    lines.push(
      rocketchatConfigured
        ? tint("Rocket.Chat: configured", chalk.green)
        : tint("Rocket.Chat: not configured", chalk.cyan),
    );
  }

  const signalEnabled = effective.signal?.enabled !== false;
  if (!signalEnabled) {
    lines.push(tint("Signal: disabled", chalk.cyan));
  } else {
    const signalConfigured =
      Boolean(effective.signal) &&
      Boolean(
        effective.signal?.account?.trim() ||
          effective.signal?.httpUrl?.trim() ||
          effective.signal?.cliPath?.trim() ||
          effective.signal?.httpHost?.trim() ||
          typeof effective.signal?.httpPort === "number" ||
          typeof effective.signal?.autoStart === "boolean",
      );
    lines.push(
      signalConfigured
        ? tint("Signal: configured", chalk.green)
        : tint("Signal: not configured", chalk.cyan),
    );
  }

  const imessageEnabled = effective.imessage?.enabled !== false;
  if (!imessageEnabled) {
    lines.push(tint("iMessage: disabled", chalk.cyan));
  } else {
    const imessageConfigured = Boolean(effective.imessage);
    lines.push(
      imessageConfigured
        ? tint("iMessage: configured", chalk.green)
        : tint("iMessage: not configured", chalk.cyan),
    );
  }

  if (resolved.includeAllowFrom) {
    const allowFrom = effective.whatsapp?.allowFrom?.length
      ? effective.whatsapp.allowFrom.map(normalizeE164).filter(Boolean)
      : [];
    if (allowFrom.length) {
      lines.push(tint(`AllowFrom: ${allowFrom.join(", ")}`, chalk.cyan));
    }
  }

  return lines;
}

export function formatAge(ms: number): string {
  if (ms < 0) return "unknown";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
