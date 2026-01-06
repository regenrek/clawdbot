import type { WizardNavAction } from "./nav.js";

export type WizardSelectOption<T = string> = {
  value: T;
  label: string;
  hint?: string;
};

export type WizardPromptNav = {
  canGoBack?: boolean;
};

export type WizardSelectParams<T = string> = {
  message: string;
  options: Array<WizardSelectOption<T>>;
  initialValue?: T;
  nav?: WizardPromptNav;
};

export type WizardMultiSelectParams<T = string> = {
  message: string;
  options: Array<WizardSelectOption<T>>;
  initialValues?: T[];
  nav?: WizardPromptNav;
};

export type WizardTextParams = {
  message: string;
  initialValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined;
  nav?: WizardPromptNav;
};

export type WizardConfirmParams = {
  message: string;
  initialValue?: boolean;
  nav?: WizardPromptNav;
};

export type WizardProgress = {
  update: (message: string) => void;
  stop: (message?: string) => void;
};

export type WizardPrompter = {
  intro: (title: string) => Promise<void>;
  outro: (message: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  select: <T>(params: WizardSelectParams<T>) => Promise<WizardPromptResult<T>>;
  multiselect: <T>(
    params: WizardMultiSelectParams<T>,
  ) => Promise<WizardPromptResult<T[]>>;
  text: (params: WizardTextParams) => Promise<WizardPromptResult<string>>;
  confirm: (
    params: WizardConfirmParams,
  ) => Promise<WizardPromptResult<boolean>>;
  progress: (label: string) => WizardProgress;
};

export type WizardPromptResult<T> = {
  value?: T;
  nav?: WizardNavAction;
};

export class WizardCancelledError extends Error {
  constructor(message = "wizard cancelled") {
    super(message);
    this.name = "WizardCancelledError";
  }
}
