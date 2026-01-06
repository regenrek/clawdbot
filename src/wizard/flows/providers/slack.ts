import type { WizardStepDefinition, WizardStepOption } from "../../steps.js";
import { toTrimmedString } from "../../values.js";
import type { WizardContext, WizardState } from "../types.js";

type StepMap = Record<string, WizardStepDefinition<WizardState, WizardContext>>;

function buildSlackManifest(botName: string) {
  const safeName = botName.trim() || "Clawdbot";
  const manifest = {
    display_information: {
      name: safeName,
      description: `${safeName} connector for Clawdbot`,
    },
    features: {
      bot_user: {
        display_name: safeName,
        always_online: false,
      },
      app_home: {
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      slash_commands: [
        {
          command: "/clawd",
          description: "Send a message to Clawdbot",
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          "chat:write",
          "channels:history",
          "channels:read",
          "groups:history",
          "im:history",
          "mpim:history",
          "users:read",
          "app_mentions:read",
          "reactions:read",
          "reactions:write",
          "pins:read",
          "pins:write",
          "emoji:read",
          "commands",
          "files:read",
          "files:write",
        ],
      },
    },
    settings: {
      socket_mode_enabled: true,
      event_subscriptions: {
        bot_events: [
          "app_mention",
          "message.channels",
          "message.groups",
          "message.im",
          "message.mpim",
          "reaction_added",
          "reaction_removed",
          "member_joined_channel",
          "member_left_channel",
          "channel_rename",
          "pin_added",
          "pin_removed",
        ],
      },
    },
  };
  return JSON.stringify(manifest, null, 2);
}

export function addSlackSteps(steps: StepMap, afterId: string) {
  steps["providers.slack.start"] = {
    id: "providers.slack.start",
    type: "text",
    message: "Slack bot display name (used for manifest)",
    initialValue: () => "Clawdbot",
    onAnswer: (value, state) => {
      state.providers.slackBotName = toTrimmedString(value) || "Clawdbot";
    },
    next: () => "providers.slack.help",
  };

  steps["providers.slack.help"] = {
    id: "providers.slack.help",
    type: "note",
    title: "Slack socket mode tokens",
    message: (state) => {
      const manifest = buildSlackManifest(
        state.providers.slackBotName ?? "Clawdbot",
      );
      return [
        "1) Slack API → Create App → From scratch",
        "2) Add Socket Mode + enable it to get the app-level token (xapp-...)",
        "3) OAuth & Permissions → install app to workspace (xoxb- bot token)",
        "4) Enable Event Subscriptions (socket) for message events",
        "5) App Home → enable the Messages tab for DMs",
        "Tip: set SLACK_BOT_TOKEN + SLACK_APP_TOKEN in your env.",
        "",
        "Manifest (JSON):",
        manifest,
      ].join("\n");
    },
    next: () => "providers.slack.mode",
  };

  steps["providers.slack.mode"] = {
    id: "providers.slack.mode",
    type: "select",
    message: "Slack auth",
    options: (state) => {
      const envBot = Boolean(process.env.SLACK_BOT_TOKEN?.trim());
      const envApp = Boolean(process.env.SLACK_APP_TOKEN?.trim());
      const env = envBot && envApp;
      const existing = Boolean(
        state.draftConfig.slack?.botToken && state.draftConfig.slack?.appToken,
      );
      const options: WizardStepOption[] = [];
      if (env) options.push({ value: "env", label: "Use env tokens" });
      if (existing) options.push({ value: "keep", label: "Keep existing" });
      options.push({ value: "enter", label: "Enter tokens" });
      return options;
    },
    onAnswer: (value, state) => {
      if (value === "env") {
        state.draftConfig = {
          ...state.draftConfig,
          slack: { ...state.draftConfig.slack, enabled: true },
        };
      }
    },
    next: (value) => (value === "enter" ? "providers.slack.tokens" : afterId),
  };

  steps["providers.slack.tokens"] = {
    id: "providers.slack.tokens",
    type: "text",
    message: "Enter Slack bot token (xoxb-...)",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const botToken = toTrimmedString(value);
      state.providers.slackBotToken = botToken;
    },
    next: () => "providers.slack.app",
  };

  steps["providers.slack.app"] = {
    id: "providers.slack.app",
    type: "text",
    message: "Enter Slack app token (xapp-...)",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const appToken = toTrimmedString(value);
      const botToken = state.providers.slackBotToken;
      if (botToken && appToken) {
        state.draftConfig = {
          ...state.draftConfig,
          slack: {
            ...state.draftConfig.slack,
            enabled: true,
            botToken,
            appToken,
          },
        };
      }
    },
    next: () => afterId,
  };
}
