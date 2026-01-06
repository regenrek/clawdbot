import type { GatewayBrowserClient } from "../gateway";
import type {
  WizardNextResult,
  WizardStartResult,
  WizardStatusResult,
  WizardStep,
  WizardStepOption,
} from "../types";

export type WizardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  wizardSessionId: string | null;
  wizardStep: WizardStep | null;
  wizardStatus: string | null;
  wizardError: string | null;
  wizardStarting: boolean;
  wizardSubmitting: boolean;
  wizardCanGoBack: boolean;
  wizardTextValue: string;
  wizardConfirmValue: boolean;
  wizardSelectedIndex: number;
  wizardSelectedIndices: number[];
};

export async function startWizard(
  state: WizardState,
  opts?: { mode?: "local" | "remote"; workspace?: string },
) {
  if (!state.client || !state.connected || state.wizardStarting) return;
  state.wizardStarting = true;
  state.wizardError = null;
  try {
    const res = (await state.client.request("wizard.start", {
      mode: opts?.mode,
      workspace: opts?.workspace,
    })) as WizardStartResult;
    applyWizardStart(state, res);
  } catch (err) {
    state.wizardError = String(err);
  } finally {
    state.wizardStarting = false;
  }
}

export async function submitWizardStep(state: WizardState) {
  if (!state.client || !state.connected || state.wizardSubmitting) return;
  const step = state.wizardStep;
  if (!step || !state.wizardSessionId) return;
  const answer = buildWizardAnswer(step, state);
  state.wizardSubmitting = true;
  state.wizardError = null;
  try {
    const res = (await state.client.request("wizard.next", {
      sessionId: state.wizardSessionId,
      answer,
    })) as WizardNextResult;
    applyWizardNext(state, res);
  } catch (err) {
    state.wizardError = String(err);
  } finally {
    state.wizardSubmitting = false;
  }
}

export async function sendWizardNav(
  state: WizardState,
  nav: "back" | "cancel",
) {
  if (!state.client || !state.connected || state.wizardSubmitting) return;
  if (!state.wizardSessionId) return;
  state.wizardSubmitting = true;
  state.wizardError = null;
  try {
    const res = (await state.client.request("wizard.next", {
      sessionId: state.wizardSessionId,
      nav,
    })) as WizardNextResult;
    applyWizardNext(state, res);
  } catch (err) {
    state.wizardError = String(err);
  } finally {
    state.wizardSubmitting = false;
  }
}

export async function cancelWizard(state: WizardState) {
  if (!state.client || !state.connected || state.wizardSubmitting) return;
  if (!state.wizardSessionId) return;
  state.wizardSubmitting = true;
  state.wizardError = null;
  try {
    const res = (await state.client.request("wizard.cancel", {
      sessionId: state.wizardSessionId,
    })) as WizardStatusResult;
    state.wizardStatus = res.status ?? null;
    state.wizardError = res.error ?? null;
    resetWizardStep(state);
    state.wizardSessionId = null;
  } catch (err) {
    state.wizardError = String(err);
  } finally {
    state.wizardSubmitting = false;
  }
}

function applyWizardStart(state: WizardState, res: WizardStartResult) {
  state.wizardSessionId = res.sessionId ?? null;
  state.wizardStatus = res.status ?? (res.done ? "done" : "running");
  state.wizardError = res.error ?? null;
  state.wizardCanGoBack = res.canGoBack ?? false;
  applyWizardStep(state, res.step);
  if (res.done) {
    state.wizardSessionId = null;
    resetWizardStep(state);
  }
}

function applyWizardNext(state: WizardState, res: WizardNextResult) {
  state.wizardStatus = res.status ?? state.wizardStatus;
  state.wizardError = res.error ?? null;
  state.wizardCanGoBack = res.canGoBack ?? false;
  applyWizardStep(state, res.step);
  if (res.done) {
    state.wizardSessionId = null;
    resetWizardStep(state);
  }
  if (res.status === "done" || res.status === "cancelled" || res.status === "error") {
    state.wizardSessionId = null;
  }
}

function applyWizardStep(state: WizardState, step?: WizardStep) {
  state.wizardStep = step ?? null;
  if (!step) {
    resetWizardInputs(state);
    return;
  }
  if (step.type === "text") {
    state.wizardTextValue =
      step.initialValue !== undefined ? String(step.initialValue) : "";
  } else if (step.type === "confirm") {
    state.wizardConfirmValue = Boolean(step.initialValue);
  } else if (step.type === "select") {
    state.wizardSelectedIndex = selectIndexForValue(
      step.options ?? [],
      step.initialValue,
    );
  } else if (step.type === "multiselect") {
    state.wizardSelectedIndices = selectIndicesForValues(
      step.options ?? [],
      Array.isArray(step.initialValue) ? step.initialValue : [],
    );
  } else {
    resetWizardInputs(state);
  }
}

function buildWizardAnswer(step: WizardStep, state: WizardState) {
  const answer: { stepId: string; value?: unknown } = { stepId: step.id };
  switch (step.type) {
    case "text":
      answer.value = state.wizardTextValue;
      return answer;
    case "confirm":
      answer.value = state.wizardConfirmValue;
      return answer;
    case "select": {
      const option = (step.options ?? [])[state.wizardSelectedIndex];
      if (option) answer.value = option.value;
      return answer;
    }
    case "multiselect": {
      const options = step.options ?? [];
      const values = state.wizardSelectedIndices
        .map((index) => options[index])
        .filter(Boolean)
        .map((opt) => (opt as WizardStepOption).value);
      answer.value = values;
      return answer;
    }
    case "action":
      answer.value = true;
      return answer;
    case "note":
    case "progress":
    default:
      return answer;
  }
}

function resetWizardStep(state: WizardState) {
  state.wizardStep = null;
  state.wizardCanGoBack = false;
  resetWizardInputs(state);
}

function resetWizardInputs(state: WizardState) {
  state.wizardTextValue = "";
  state.wizardConfirmValue = false;
  state.wizardSelectedIndex = 0;
  state.wizardSelectedIndices = [];
}

function selectIndexForValue(
  options: WizardStepOption[],
  value: unknown,
): number {
  const index = options.findIndex((opt) => wizardValueEqual(opt.value, value));
  return index >= 0 ? index : 0;
}

function selectIndicesForValues(
  options: WizardStepOption[],
  values: unknown[],
): number[] {
  if (!values.length) return [];
  return options
    .map((opt, index) => (values.some((v) => wizardValueEqual(v, opt.value)) ? index : -1))
    .filter((index) => index >= 0);
}

function wizardValueEqual(a: unknown, b: unknown) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
