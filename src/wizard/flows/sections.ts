import type { WizardSection, WizardState } from "./types.js";

export const SECTION_ORDER: WizardSection[] = [
  "workspace",
  "model",
  "gateway",
  "providers",
  "daemon",
  "skills",
  "health",
  "control-ui",
];

export function normalizeSectionSelection(
  selection: WizardSection[],
): WizardSection[] {
  return SECTION_ORDER.filter((section) => selection.includes(section));
}

export function nextSelectedSection(
  state: WizardState,
  entries: Record<WizardSection, string>,
  fallback: string,
): string {
  const index = state.sectionIndex ?? 0;
  const next = state.sections[index];
  if (!next) return fallback;
  state.sectionIndex = index + 1;
  return entries[next] ?? fallback;
}
