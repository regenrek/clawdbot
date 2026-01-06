import type { WizardFlow, WizardStepDefinition } from "../steps.js";
import { buildAuthSection } from "./auth-section.js";
import { buildConfigSection } from "./config-section.js";
import { buildControlUiSection } from "./control-ui-section.js";
import { buildDaemonSection } from "./daemon-section.js";
import { buildGatewaySection } from "./gateway-section.js";
import { buildHealthSection } from "./health-section.js";
import { buildModeSection } from "./mode-section.js";
import { buildProvidersSection } from "./providers-section.js";
import { buildRemoteSection } from "./remote-section.js";
import { nextSelectedSection, normalizeSectionSelection } from "./sections.js";
import { buildSkillsSection } from "./skills-section.js";
import type { WizardContext, WizardSection, WizardState } from "./types.js";
import { buildWorkspaceSection } from "./workspace-section.js";

function mergeSteps(
  ...sections: Array<
    Record<string, WizardStepDefinition<WizardState, WizardContext>>
  >
): Record<string, WizardStepDefinition<WizardState, WizardContext>> {
  return Object.assign({}, ...sections) as Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  >;
}

function finishStep(
  message: string,
): Record<string, WizardStepDefinition<WizardState, WizardContext>> {
  return {
    "wizard.finish": {
      id: "wizard.finish",
      type: "note",
      title: "Done",
      message,
      next: () => null,
    },
  };
}

export function createOnboardingFlow(
  state: WizardState,
): WizardFlow<WizardState, WizardContext> {
  const finish = finishStep("Onboarding complete.");
  const controlUi = buildControlUiSection("wizard.finish");
  const skills = buildSkillsSection(controlUi.entryId);
  const health = buildHealthSection(skills.entryId);
  const daemon = buildDaemonSection(health.entryId);
  const providers = buildProvidersSection(daemon.entryId, {
    allowDisable: false,
    allowSignalInstall: true,
  });
  const gateway = buildGatewaySection(providers.entryId);
  const auth = buildAuthSection(gateway.entryId);
  const workspace = buildWorkspaceSection(auth.entryId);
  const remote = buildRemoteSection("wizard.finish");
  const mode = buildModeSection("mode.route");
  const config = buildConfigSection(mode.entryId);

  const routeStep: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {
    "mode.route": {
      id: "mode.route",
      type: "action",
      message: "",
      next: (_value, state) =>
        state.mode === "remote" ? remote.entryId : workspace.entryId,
    },
  };

  const steps = mergeSteps(
    config.steps,
    mode.steps,
    routeStep,
    remote.steps,
    workspace.steps,
    auth.steps,
    gateway.steps,
    providers.steps,
    daemon.steps,
    health.steps,
    skills.steps,
    controlUi.steps,
    finish,
  );

  let startId = mode.entryId;
  if (state.snapshot.exists) startId = config.entryId;
  if (state.mode === "remote" && !state.snapshot.exists)
    startId = remote.entryId;
  if (state.mode === "local" && !state.snapshot.exists)
    startId = workspace.entryId;

  return { startId, steps };
}

export function createConfigureFlow(
  state: WizardState,
  opts: { allowDisable: boolean; allowSignalInstall: boolean },
): WizardFlow<WizardState, WizardContext> {
  const finish = finishStep("Configure complete.");
  const controlUi = buildControlUiSection("wizard.finish");
  const skills = buildSkillsSection(controlUi.entryId);
  const health = buildHealthSection(controlUi.entryId);
  const daemon = buildDaemonSection(controlUi.entryId);
  const providers = buildProvidersSection(controlUi.entryId, {
    allowDisable: opts.allowDisable,
    allowSignalInstall: opts.allowSignalInstall,
  });
  const gateway = buildGatewaySection(controlUi.entryId);
  const auth = buildAuthSection(controlUi.entryId);
  const workspace = buildWorkspaceSection(controlUi.entryId);
  const remote = buildRemoteSection("wizard.finish");
  const mode = buildModeSection("mode.route");
  const config = buildConfigSection(mode.entryId);

  const sectionEntries: Record<WizardSection, string> = {
    workspace: workspace.entryId,
    model: auth.entryId,
    gateway: gateway.entryId,
    providers: providers.entryId,
    daemon: daemon.entryId,
    skills: skills.entryId,
    health: health.entryId,
    "control-ui": controlUi.entryId,
  };

  if (state.sections.length > 0) {
    state.sections = normalizeSectionSelection(state.sections);
    state.sectionIndex = 0;
  }

  const selectSections: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {
    "sections.select": {
      id: "sections.select",
      type: "multiselect",
      message: "Select sections to configure",
      options: () => [
        { value: "workspace", label: "Workspace" },
        { value: "model", label: "Model/auth" },
        { value: "gateway", label: "Gateway config" },
        { value: "daemon", label: "Gateway daemon" },
        { value: "providers", label: "Providers" },
        { value: "skills", label: "Skills" },
        { value: "health", label: "Health check" },
      ],
      onAnswer: (value, state) => {
        const selection = Array.isArray(value)
          ? (value as WizardSection[])
          : [];
        state.sections = normalizeSectionSelection(selection);
        state.sectionIndex = 0;
      },
      next: (_value, state) =>
        state.sections.length > 0
          ? nextSelectedSection(state, sectionEntries, controlUi.entryId)
          : "wizard.finish",
    },
  };

  const routeStep: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {
    "mode.route": {
      id: "mode.route",
      type: "action",
      message: "",
      next: (_value, state) => {
        if (state.mode === "remote") return remote.entryId;
        if (state.sections.length > 0) {
          return nextSelectedSection(state, sectionEntries, controlUi.entryId);
        }
        return "sections.select";
      },
    },
  };

  const steps = mergeSteps(
    config.steps,
    mode.steps,
    routeStep,
    remote.steps,
    selectSections,
    workspace.steps,
    auth.steps,
    gateway.steps,
    providers.steps,
    daemon.steps,
    skills.steps,
    health.steps,
    controlUi.steps,
    finish,
  );

  const replaceExit = (stepId: string) => {
    const step = steps[stepId];
    if (!step?.next) return;
    const original = step.next;
    step.next = (value, state, ctx) => {
      const next = original(value, state, ctx);
      if (next === controlUi.entryId) {
        return nextSelectedSection(state, sectionEntries, controlUi.entryId);
      }
      return next;
    };
  };

  replaceExit("workspace.apply");
  replaceExit("auth.apply");
  replaceExit("gateway.apply");
  replaceExit("providers.apply");
  replaceExit("daemon.action");
  replaceExit("daemon.linger.check");
  replaceExit("daemon.linger.confirm");
  replaceExit("daemon.linger.enable");
  replaceExit("skills.apply");
  replaceExit("health.run");

  let startId = mode.entryId;
  if (state.snapshot.exists) startId = config.entryId;
  if (state.mode === "remote" && !state.snapshot.exists)
    startId = remote.entryId;

  return { startId, steps };
}
