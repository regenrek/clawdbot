import type { WizardNavAction } from "./nav.js";

export type WizardStepType =
  | "note"
  | "select"
  | "text"
  | "confirm"
  | "multiselect"
  | "progress"
  | "action";

export type WizardStepOption<T = unknown> = {
  value: T;
  label: string;
  hint?: string;
};

export type WizardStep = {
  id: string;
  type: WizardStepType;
  title?: string;
  message?: string;
  options?: WizardStepOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: "gateway" | "client";
};

export type WizardTransition = string | null | { nav: WizardNavAction };

export type WizardStepDefinition<State, Ctx = WizardRuntime> = {
  id: string;
  type: WizardStepType;
  title?: string | ((state: State) => string | undefined);
  message?: string | ((state: State) => string | undefined);
  options?:
    | WizardStepOption[]
    | ((state: State) => WizardStepOption[] | undefined);
  initialValue?: (state: State) => unknown;
  placeholder?: string | ((state: State) => string | undefined);
  sensitive?: boolean;
  executor?: "gateway" | "client";
  validate?: (value: unknown, state: State) => string | undefined;
  onAnswer?: (
    value: unknown,
    state: State,
    ctx: WizardStepContext<State, Ctx>,
  ) => void | Promise<void>;
  next?: (
    value: unknown,
    state: State,
    ctx: WizardStepContext<State, Ctx>,
  ) => WizardTransition;
};

export type WizardFlow<State, Ctx = WizardRuntime> = {
  startId: string;
  steps: Record<string, WizardStepDefinition<State, Ctx>>;
};

export type WizardStepContext<State, Ctx = WizardRuntime> = {
  runtime: WizardRuntime;
  context: Ctx;
  getState: () => State;
};

export type WizardRuntime = {
  log: (message: string) => void;
  error: (message: string) => void;
};

export function resolveStepText<State>(
  value: string | ((state: State) => string | undefined) | undefined,
  state: State,
): string | undefined {
  if (typeof value === "function") return value(state);
  return value;
}
