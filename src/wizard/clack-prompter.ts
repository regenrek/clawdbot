import {
  intro,
  isCancel,
  multiselect,
  note,
  type Option,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";

import type {
  WizardConfirmParams,
  WizardMultiSelectParams,
  WizardProgress,
  WizardPrompter,
  WizardPromptResult,
  WizardSelectParams,
} from "./prompts.js";

const EXIT_VALUE = "__wizard_exit__";
type ExitValue = typeof EXIT_VALUE;

function isExitValue<T>(value: T | ExitValue): value is ExitValue {
  return value === EXIT_VALUE;
}

async function guardCancel<T>(
  value: T | symbol,
  canGoBack = false,
): Promise<WizardPromptResult<T>> {
  if (isCancel(value)) {
    if (canGoBack) {
      return { nav: "back" };
    }
    return { nav: "cancel" };
  }
  return { value: value as T };
}

export function createClackPrompter(): WizardPrompter {
  return {
    intro: async (title) => {
      intro(title);
    },
    outro: async (message) => {
      outro(message);
    },
    note: async (message, title) => {
      note(message, title);
    },
    select: async <T>(
      params: WizardSelectParams<T>,
    ): Promise<WizardPromptResult<T>> => {
      type SelectValue = T | ExitValue;
      const result = await guardCancel<SelectValue>(
        await select<SelectValue>({
          message: params.message,
          options: [
            ...params.options.map((opt) => {
              const base = { value: opt.value, label: opt.label };
              return opt.hint === undefined
                ? base
                : { ...base, hint: opt.hint };
            }),
            { value: EXIT_VALUE, label: "Exit setup" },
          ] as Option<SelectValue>[],
          initialValue: params.initialValue,
        }),
        params.nav?.canGoBack ?? false,
      );
      if (result.nav) return { nav: result.nav };
      if (isExitValue(result.value as SelectValue)) return { nav: "cancel" };
      return { value: result.value as T };
    },
    multiselect: async <T>(
      params: WizardMultiSelectParams<T>,
    ): Promise<WizardPromptResult<T[]>> => {
      type SelectValue = T | ExitValue;
      const result = await guardCancel<SelectValue[]>(
        await multiselect<SelectValue>({
          message: params.message,
          options: [
            ...params.options.map((opt) => {
              const base = { value: opt.value, label: opt.label };
              return opt.hint === undefined
                ? base
                : { ...base, hint: opt.hint };
            }),
            { value: EXIT_VALUE, label: "Exit setup" },
          ] as Option<SelectValue>[],
          initialValues: params.initialValues as SelectValue[] | undefined,
        }),
        params.nav?.canGoBack ?? false,
      );
      if (result.nav) return { nav: result.nav };
      const values = Array.isArray(result.value) ? result.value : [];
      if (values.some((value) => isExitValue(value))) return { nav: "cancel" };
      return {
        value: values.filter((value): value is T => !isExitValue(value)),
      };
    },
    text: async (params) =>
      guardCancel(
        await text({
          message: `${params.message}\n(Type :exit to leave setup)`,
          initialValue: params.initialValue,
          placeholder: params.placeholder,
          validate: params.validate,
        }),
        params.nav?.canGoBack ?? false,
      ).then((result) => {
        if (result.nav) return result;
        if (typeof result.value === "string") {
          const trimmed = result.value.trim().toLowerCase();
          if (
            trimmed === ":exit" ||
            trimmed === "exit" ||
            trimmed === ":quit"
          ) {
            return { nav: "cancel" };
          }
        }
        return result;
      }),
    confirm: async (
      params: WizardConfirmParams,
    ): Promise<WizardPromptResult<boolean>> => {
      type ConfirmValue = boolean | ExitValue;
      const result = await guardCancel<ConfirmValue>(
        await select<ConfirmValue>({
          message: params.message,
          options: [
            { value: true, label: "Yes" },
            { value: false, label: "No" },
            { value: EXIT_VALUE, label: "Exit setup" },
          ] as Option<ConfirmValue>[],
          initialValue:
            typeof params.initialValue === "boolean"
              ? params.initialValue
              : true,
        }),
        params.nav?.canGoBack ?? false,
      );
      if (result.nav) return { nav: result.nav };
      if (isExitValue(result.value as ConfirmValue)) return { nav: "cancel" };
      return { value: Boolean(result.value) };
    },
    progress: (label: string): WizardProgress => {
      const spin = spinner();
      spin.start(label);
      return {
        update: (message) => spin.message(message),
        stop: (message) => spin.stop(message),
      };
    },
  };
}
