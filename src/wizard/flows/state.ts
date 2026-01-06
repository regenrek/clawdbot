import {
  DEFAULT_WORKSPACE,
  probeGatewayReachable,
} from "../../commands/onboard-helpers.js";
import type { OnboardMode } from "../../commands/onboard-types.js";
import {
  readConfigFileSnapshot,
  resolveGatewayPort,
} from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import { resolveUserPath } from "../../utils.js";
import type { WizardCommand, WizardSection, WizardState } from "./types.js";

export async function createWizardState(params: {
  command: WizardCommand;
  runtime: RuntimeEnv;
  mode?: OnboardMode;
  workspace?: string;
  sections?: WizardSection[];
}): Promise<WizardState> {
  const snapshot = await readConfigFileSnapshot();
  const baseConfig = snapshot.valid ? snapshot.config : {};
  const workspaceDir = resolveUserPath(
    (
      params.workspace ??
      baseConfig.agent?.workspace ??
      DEFAULT_WORKSPACE
    ).trim(),
  );
  const gatewayPort = resolveGatewayPort(baseConfig);
  const localUrl = `ws://127.0.0.1:${gatewayPort}`;
  const localProbe = await probeGatewayReachable({
    url: localUrl,
    token: process.env.CLAWDBOT_GATEWAY_TOKEN,
    password:
      baseConfig.gateway?.auth?.password ??
      process.env.CLAWDBOT_GATEWAY_PASSWORD,
  });
  const remoteUrl = baseConfig.gateway?.remote?.url?.trim() ?? "";
  const remoteProbe = remoteUrl
    ? await probeGatewayReachable({
        url: remoteUrl,
        token: baseConfig.gateway?.remote?.token,
      })
    : null;

  return {
    command: params.command,
    mode: params.mode ?? null,
    sections: params.sections ?? [],
    sectionIndex: 0,
    baseConfig,
    draftConfig: { ...baseConfig },
    workspaceDir,
    gatewayPort,
    gatewayToken: baseConfig.gateway?.auth?.token,
    gatewayWarnings: [],
    snapshot: {
      exists: snapshot.exists,
      valid: snapshot.valid,
      issues: snapshot.issues ?? [],
    },
    probes: {
      local: localProbe.ok ? { ok: true } : { ok: false, reason: localUrl },
      remote: remoteProbe
        ? remoteProbe.ok
          ? { ok: true }
          : { ok: false, reason: remoteUrl }
        : null,
    },
    auth: {
      warnings: [],
    },
    remote: {},
    providers: {
      queue: [],
      index: 0,
    },
    skills: {
      installSelection: [],
      envQueue: [],
      envIndex: 0,
    },
    controlUi: {},
  };
}
