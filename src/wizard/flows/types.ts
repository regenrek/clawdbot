import type { OAuthCredentials } from "@mariozechner/pi-ai";
import type { SkillStatusReport } from "../../agents/skills-status.js";
import type {
  AuthChoice,
  OnboardMode,
  ProviderChoice,
} from "../../commands/onboard-types.js";
import type { ClawdbotConfig } from "../../config/config.js";
import type { GatewayBonjourBeacon } from "../../infra/bonjour-discovery.js";
import type { RuntimeEnv } from "../../runtime.js";

export type WizardCommand = "onboard" | "configure" | "update";

export type WizardSection =
  | "workspace"
  | "model"
  | "gateway"
  | "daemon"
  | "providers"
  | "skills"
  | "health"
  | "control-ui";

export type WizardState = {
  command: WizardCommand;
  mode: OnboardMode | null;
  sections: WizardSection[];
  sectionIndex?: number;
  baseConfig: ClawdbotConfig;
  draftConfig: ClawdbotConfig;
  workspaceDir: string;
  gatewayPort: number;
  gatewayToken?: string;
  gatewayWarnings?: string[];
  snapshot: {
    exists: boolean;
    valid: boolean;
    issues: Array<{ path: string; message: string }>;
  };
  resetScope?: "config" | "config+creds+sessions" | "full";
  probes: {
    local?: { ok: boolean; reason?: string };
    remote?: { ok: boolean; reason?: string } | null;
  };
  auth: {
    choice?: AuthChoice;
    warnings: string[];
    oauth?: {
      provider?: "anthropic" | "openai-codex" | "google-antigravity";
      url?: string;
      prompt?: string;
      code?: string;
      credentials?: OAuthCredentials | null;
      error?: string;
    };
    apiKey?: string;
    setOpenAiModelDefault?: boolean;
  };
  remote: {
    hasBonjourTool?: boolean;
    wantsDiscover?: boolean;
    beacons?: GatewayBonjourBeacon[];
    selectedBeaconIndex?: number;
    suggestedUrl?: string;
    sshHint?: string;
  };
  providers: {
    status?: ProviderStatus;
    queue: ProviderChoice[];
    index: number;
    slackBotName?: string;
    slackBotToken?: string;
    signalCliPath?: string;
    signalCliDetected?: boolean;
    imessageCliPath?: string;
    imessageCliDetected?: boolean;
  };
  skills: {
    report?: SkillStatusReport;
    nodeManager?: "npm" | "pnpm" | "bun";
    installSelection: string[];
    needsBrewPrompt?: boolean;
    envQueue: Array<{
      name: string;
      skillKey: string;
      env: string;
    }>;
    envIndex: number;
  };
  health?: {
    ok: boolean;
    error?: string;
    canRestart?: boolean;
  };
  controlUi: {
    browserSupported?: boolean;
    assetsOk?: boolean;
    assetsMessage?: string;
  };
  daemon?: {
    loaded?: boolean;
    action?: "restart" | "reinstall" | "skip" | "install";
    needsLinger?: boolean;
    lingerUser?: string;
  };
};

export type ProviderStatus = {
  whatsappLinked: boolean;
  telegramConfigured: boolean;
  discordConfigured: boolean;
  slackConfigured: boolean;
  signalConfigured: boolean;
  signalCliDetected: boolean;
  imessageConfigured: boolean;
  imessageCliDetected: boolean;
};

export type WizardContext = {
  runtime: RuntimeEnv;
  oauth: {
    pending?: PendingOAuth;
    antigravity?: PendingAntigravity;
  };
};

export type PendingOAuth = {
  provider: "anthropic" | "openai-codex";
  url?: string;
  prompt?: string;
  resolver?: (value: string) => void;
  promise?: Promise<OAuthCredentials | null>;
};

export type PendingAntigravity = {
  url?: string;
  verifier?: string;
};
