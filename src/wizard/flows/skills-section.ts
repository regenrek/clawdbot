import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import {
  detectBinary,
  resolveNodeManagerOptions,
} from "../../commands/onboard-helpers.js";
import type { WizardStepDefinition, WizardStepOption } from "../steps.js";
import { toTrimmedString } from "../values.js";
import { commitConfig } from "./apply.js";
import type { WizardSectionSteps } from "./section.js";
import type { WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "skills.refresh";

function upsertSkillEntry(
  cfg: WizardState["draftConfig"],
  skillKey: string,
  patch: { apiKey?: string },
) {
  const entries = { ...cfg.skills?.entries };
  const existing = (entries[skillKey] as { apiKey?: string } | undefined) ?? {};
  entries[skillKey] = { ...existing, ...patch };
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      entries,
    },
  };
}

function nextEnvStep(state: WizardState): string {
  const next = state.skills.envQueue[state.skills.envIndex];
  if (!next) return "skills.apply";
  return "skills.env.ask";
}

export function buildSkillsSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "action",
    title: "Skills",
    message: "Scanning workspace skills.",
    onAnswer: async (_value, state) => {
      const report = buildWorkspaceSkillStatus(state.workspaceDir, {
        config: state.draftConfig,
      });
      state.skills.report = report;
      const envQueue = report.skills
        .filter(
          (
            skill,
          ): skill is (typeof report.skills)[number] & { primaryEnv: string } =>
            Boolean(skill.primaryEnv) && skill.missing.env.length > 0,
        )
        .map((skill) => ({
          name: skill.name,
          skillKey: skill.skillKey,
          env: skill.primaryEnv,
        }));
      state.skills.envQueue = envQueue;
      state.skills.envIndex = 0;
      const needsBrewPrompt =
        process.platform !== "win32" &&
        report.skills.some((skill) =>
          skill.install.some((option) => option.kind === "brew"),
        ) &&
        !(await detectBinary("brew"));
      state.skills.needsBrewPrompt = needsBrewPrompt;
    },
    next: () => "skills.status",
  };

  steps["skills.status"] = {
    id: "skills.status",
    type: "note",
    title: "Skills status",
    message: (state) => {
      const report = state.skills.report;
      if (!report) return "No skills found.";
      const eligible = report.skills.filter((s) => s.eligible).length;
      const missing = report.skills.filter(
        (s) => !s.eligible && !s.disabled && !s.blockedByAllowlist,
      ).length;
      const blocked = report.skills.filter((s) => s.blockedByAllowlist).length;
      return [
        `Eligible: ${eligible}`,
        `Missing requirements: ${missing}`,
        `Blocked by allowlist: ${blocked}`,
      ].join("\n");
    },
    next: () => "skills.confirm",
  };

  steps["skills.confirm"] = {
    id: "skills.confirm",
    type: "confirm",
    message: "Configure skills now? (recommended)",
    initialValue: () => true,
    next: (value, state) => {
      if (!value) return nextId;
      return state.skills.needsBrewPrompt
        ? "skills.brew.note"
        : "skills.nodeManager";
    },
  };

  steps["skills.brew.note"] = {
    id: "skills.brew.note",
    type: "note",
    title: "Homebrew recommended",
    message:
      "Many skill dependencies are shipped via Homebrew. Without brew, you'll need to build from source or download releases manually.",
    next: () => "skills.brew.confirm",
  };

  steps["skills.brew.confirm"] = {
    id: "skills.brew.confirm",
    type: "confirm",
    message: "Show Homebrew install command?",
    initialValue: () => true,
    next: (value) => (value ? "skills.brew.command" : "skills.nodeManager"),
  };

  steps["skills.brew.command"] = {
    id: "skills.brew.command",
    type: "note",
    title: "Homebrew install",
    message:
      'Run:\n/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    next: () => "skills.nodeManager",
  };

  steps["skills.nodeManager"] = {
    id: "skills.nodeManager",
    type: "select",
    message: "Preferred node manager for skill installs",
    options: () => resolveNodeManagerOptions(),
    onAnswer: (value, state) => {
      state.skills.nodeManager = value as "npm" | "pnpm" | "bun";
      state.draftConfig = {
        ...state.draftConfig,
        skills: {
          ...state.draftConfig.skills,
          install: {
            ...state.draftConfig.skills?.install,
            nodeManager: value as "npm" | "pnpm" | "bun",
          },
        },
      };
    },
    next: () => "skills.install.select",
  };

  steps["skills.install.select"] = {
    id: "skills.install.select",
    type: "multiselect",
    message: "Install missing skill dependencies",
    options: (state) => {
      const report = state.skills.report;
      if (!report) return [];
      const installable = report.skills.filter(
        (skill) => skill.install.length > 0 && skill.missing.bins.length > 0,
      );
      const options: WizardStepOption[] = [
        {
          value: "__skip__",
          label: "Skip for now",
          hint: "Continue without installing dependencies",
        },
      ];
      for (const skill of installable) {
        options.push({
          value: skill.name,
          label: `${skill.emoji ?? "🧩"} ${skill.name}`,
          hint: skill.description ?? skill.install[0]?.label ?? "install",
        });
      }
      return options;
    },
    onAnswer: (value, state) => {
      const selection = Array.isArray(value) ? (value as string[]) : [];
      state.skills.installSelection = selection.filter(
        (name) => name !== "__skip__",
      );
    },
    next: (_value, state) =>
      state.skills.installSelection.length > 0
        ? "skills.install.run"
        : nextEnvStep(state),
  };

  steps["skills.install.run"] = {
    id: "skills.install.run",
    type: "action",
    title: "Install skills",
    message: "Installing selected skill dependencies.",
    onAnswer: async (_value, state, ctx) => {
      const report = state.skills.report;
      if (!report) return;
      const installable = report.skills.filter(
        (skill) =>
          state.skills.installSelection.includes(skill.name) &&
          skill.install.length > 0 &&
          skill.missing.bins.length > 0,
      );
      for (const skill of installable) {
        const installId = skill.install[0]?.id;
        if (!installId) continue;
        const result = await installSkill({
          workspaceDir: state.workspaceDir,
          skillName: skill.name,
          installId,
          config: state.draftConfig,
        });
        if (!result.ok) {
          const code = result.code == null ? "" : ` (exit ${result.code})`;
          const detail = result.message?.trim();
          ctx.context.runtime.error(
            `Install failed: ${skill.name}${code}${detail ? ` — ${detail}` : ""}`,
          );
          if (result.stderr) ctx.context.runtime.error(result.stderr.trim());
          else if (result.stdout) ctx.context.runtime.log(result.stdout.trim());
        }
      }
    },
    next: (_value, state) => nextEnvStep(state),
  };

  steps["skills.env.ask"] = {
    id: "skills.env.ask",
    type: "confirm",
    message: (state) => {
      const entry = state.skills.envQueue[state.skills.envIndex];
      if (!entry) return "Set env var?";
      return `Set ${entry.env} for ${entry.name}?`;
    },
    initialValue: () => false,
    next: (value, state) => {
      if (value) return "skills.env.value";
      state.skills.envIndex += 1;
      return nextEnvStep(state);
    },
  };

  steps["skills.env.value"] = {
    id: "skills.env.value",
    type: "text",
    message: (state) => {
      const entry = state.skills.envQueue[state.skills.envIndex];
      return entry ? `Enter ${entry.env}` : "Enter value";
    },
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      const entry = state.skills.envQueue[state.skills.envIndex];
      if (!entry) return;
      const apiKey = toTrimmedString(value);
      state.draftConfig = upsertSkillEntry(state.draftConfig, entry.skillKey, {
        apiKey,
      });
      state.skills.envIndex += 1;
    },
    next: (_value, state) => nextEnvStep(state),
  };

  steps["skills.apply"] = {
    id: "skills.apply",
    type: "action",
    title: "Apply skills config",
    message: "Save skill configuration.",
    onAnswer: async (_value, state, ctx) => {
      await commitConfig(state, ctx, "local");
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
