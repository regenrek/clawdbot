import path from "node:path";
import { GATEWAY_LAUNCH_AGENT_LABEL } from "../../daemon/constants.js";
import { resolveGatewayProgramArguments } from "../../daemon/program-args.js";
import { resolveGatewayService } from "../../daemon/service.js";
import {
  enableSystemdUserLinger,
  readSystemdUserLingerStatus,
} from "../../daemon/systemd.js";
import type { WizardStepDefinition } from "../steps.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "daemon.check";

export function buildDaemonSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "action",
    title: "Gateway daemon",
    message: "Checking gateway service status.",
    onAnswer: async (_value, state) => {
      const service = resolveGatewayService();
      const loaded = await service.isLoaded({ env: process.env });
      state.daemon = { ...state.daemon, loaded };
    },
    next: (_value, state) =>
      state.daemon?.loaded ? "daemon.action" : "daemon.install",
  };

  steps["daemon.action"] = {
    id: "daemon.action",
    type: "select",
    message: "Gateway service already installed",
    options: () => [
      { value: "restart", label: "Restart" },
      { value: "reinstall", label: "Reinstall" },
      { value: "skip", label: "Skip" },
    ],
    onAnswer: (value, state) => {
      state.daemon = {
        ...state.daemon,
        action: value as "restart" | "reinstall" | "skip",
      };
    },
    next: (value) => {
      if (value === "restart") return "daemon.restart";
      if (value === "reinstall") return "daemon.uninstall";
      return nextId;
    },
  };

  steps["daemon.restart"] = {
    id: "daemon.restart",
    type: "action",
    title: "Restart daemon",
    message: "Restarting gateway service.",
    onAnswer: async (_value, state) => {
      const service = resolveGatewayService();
      await service.restart({ stdout: process.stdout });
      state.daemon = { ...state.daemon, needsLinger: true };
    },
    next: () => "daemon.linger.check",
  };

  steps["daemon.uninstall"] = {
    id: "daemon.uninstall",
    type: "action",
    title: "Uninstall daemon",
    message: "Removing existing gateway service.",
    onAnswer: async () => {
      const service = resolveGatewayService();
      await service.uninstall({ env: process.env, stdout: process.stdout });
    },
    next: () => "daemon.install",
  };

  steps["daemon.install"] = {
    id: "daemon.install",
    type: "action",
    title: "Install daemon",
    message: "Installing gateway service.",
    onAnswer: async (_value, state) => {
      const service = resolveGatewayService();
      const devMode =
        process.argv[1]?.includes(`${path.sep}src${path.sep}`) &&
        process.argv[1]?.endsWith(".ts");
      const { programArguments, workingDirectory } =
        await resolveGatewayProgramArguments({
          port: state.gatewayPort,
          dev: devMode,
        });
      const environment: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        CLAWDBOT_GATEWAY_TOKEN: state.gatewayToken,
        CLAWDBOT_LAUNCHD_LABEL:
          process.platform === "darwin"
            ? GATEWAY_LAUNCH_AGENT_LABEL
            : undefined,
      };
      await service.install({
        env: process.env,
        stdout: process.stdout,
        programArguments,
        workingDirectory,
        environment,
      });
      state.daemon = { ...state.daemon, needsLinger: true };
    },
    next: () => "daemon.linger.check",
  };

  steps["daemon.linger.check"] = {
    id: "daemon.linger.check",
    type: "action",
    title: "Systemd",
    message: "Checking systemd lingering.",
    onAnswer: async (_value, state) => {
      if (process.platform !== "linux") return;
      const status = await readSystemdUserLingerStatus(process.env);
      if (!status || status.linger === "yes") {
        state.daemon = { ...state.daemon, needsLinger: false };
        return;
      }
      state.daemon = {
        ...state.daemon,
        needsLinger: true,
        lingerUser: status.user,
      };
    },
    next: (_value, state) =>
      state.daemon?.needsLinger ? "daemon.linger.note" : nextId,
  };

  steps["daemon.linger.note"] = {
    id: "daemon.linger.note",
    type: "note",
    title: "Systemd",
    message:
      "Linux installs use a systemd user service. Without lingering, systemd stops the user session on logout/idle and kills the Gateway.",
    next: () => "daemon.linger.confirm",
  };

  steps["daemon.linger.confirm"] = {
    id: "daemon.linger.confirm",
    type: "confirm",
    message: (state) =>
      `Enable systemd lingering for ${state.daemon?.lingerUser ?? "user"}?`,
    initialValue: () => true,
    next: (value) => (value ? "daemon.linger.enable" : nextId),
  };

  steps["daemon.linger.enable"] = {
    id: "daemon.linger.enable",
    type: "action",
    title: "Enable lingering",
    message: "Enabling systemd lingering.",
    onAnswer: async (_value, state, ctx) => {
      const user = state.daemon?.lingerUser;
      if (!user) return;
      const resultNoSudo = await enableSystemdUserLinger({
        env: process.env,
        user,
      });
      if (resultNoSudo.ok) return;
      const result = await enableSystemdUserLinger({
        env: process.env,
        user,
        sudoMode: "prompt",
      });
      if (!result.ok) {
        ctx.context.runtime.error(
          `Failed to enable lingering: ${result.stderr || result.stdout || "unknown error"}`,
        );
        ctx.context.runtime.log(
          `Run manually: sudo loginctl enable-linger ${user}`,
        );
      }
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
