import { html, nothing } from "lit";

import type { WizardStep, WizardStepOption } from "../types";

export type WizardViewProps = {
  connected: boolean;
  wizardSessionId: string | null;
  wizardStatus: string | null;
  wizardError: string | null;
  wizardStep: WizardStep | null;
  wizardStarting: boolean;
  wizardSubmitting: boolean;
  wizardCanGoBack: boolean;
  wizardTextValue: string;
  wizardConfirmValue: boolean;
  wizardSelectedIndex: number;
  wizardSelectedIndices: number[];
  onStart: () => void;
  onSubmit: () => void;
  onBack: () => void;
  onExit: () => void;
  onCancel: () => void;
  onTextChange: (value: string) => void;
  onConfirmChange: (value: boolean) => void;
  onSelectIndex: (index: number) => void;
  onToggleIndex: (index: number, checked: boolean) => void;
};

export function renderWizard(props: WizardViewProps) {
  const isRunning = Boolean(props.wizardSessionId);
  const isBusy = props.wizardStarting || props.wizardSubmitting;
  const step = props.wizardStep;
  const statusLine = props.wizardStatus
    ? `Status: ${props.wizardStatus}`
    : "Status: idle";

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Setup Wizard</div>
        <div class="card-sub">Guided onboarding from the gateway wizard engine.</div>

        <div class="stack" style="margin-top: 14px;">
          <div class="pill">${statusLine}</div>
          ${props.wizardError
            ? html`<div class="callout danger">${props.wizardError}</div>`
            : nothing}
          ${!props.connected
            ? html`<div class="callout">
                Connect to the gateway before starting the wizard.
              </div>`
            : nothing}

          ${!isRunning && !props.wizardStarting
            ? html`
                <div class="row">
                  <button
                    class="btn primary"
                    ?disabled=${!props.connected || isBusy}
                    @click=${props.onStart}
                  >
                    Start wizard
                  </button>
                  ${props.wizardStatus === "cancelled" || props.wizardStatus === "error"
                    ? html`<span class="muted">Last run: ${props.wizardStatus}</span>`
                    : nothing}
                </div>
              `
            : nothing}

          ${props.wizardStarting
            ? html`<div class="row">
                <div class="spinner"></div>
                <span class="muted">Starting wizard…</span>
              </div>`
            : nothing}

          ${step ? renderWizardStep(step, props) : nothing}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Navigation</div>
        <div class="card-sub">Back and Exit are always explicit in the UI.</div>
        <div class="stack" style="margin-top: 12px;">
          <div>
            <div class="note-title">Back</div>
            <div class="muted">Returns to the previous prompt step only.</div>
          </div>
          <div>
            <div class="note-title">Exit setup</div>
            <div class="muted">Shows a confirmation step before cancelling.</div>
          </div>
          ${isRunning
            ? html`<div class="row">
                <button class="btn danger" ?disabled=${isBusy} @click=${props.onCancel}>
                  Cancel session
                </button>
                <span class="muted">Immediate cancel (no confirmation).</span>
              </div>`
            : nothing}
        </div>
      </div>
    </section>
  `;
}

function renderWizardStep(step: WizardStep, props: WizardViewProps) {
  return html`
    <div class="wizard-step">
      ${step.title ? html`<div class="wizard-step-title">${step.title}</div>` : nothing}
      ${step.message
        ? html`<div class="wizard-step-message">${step.message}</div>`
        : nothing}
      ${renderWizardInput(step, props)}
      <div class="wizard-actions">
        ${props.wizardCanGoBack
          ? html`<button class="btn" ?disabled=${props.wizardSubmitting} @click=${props.onBack}>
              Back
            </button>`
          : nothing}
        <button
          class="btn danger"
          ?disabled=${props.wizardSubmitting}
          @click=${props.onExit}
        >
          Exit setup
        </button>
        <button
          class="btn primary"
          ?disabled=${props.wizardSubmitting || isSubmitBlocked(step, props)}
          @click=${props.onSubmit}
        >
          ${step.type === "action" ? "Run" : "Continue"}
        </button>
      </div>
    </div>
  `;
}

function renderWizardInput(step: WizardStep, props: WizardViewProps) {
  switch (step.type) {
    case "text": {
      const type = step.sensitive ? "password" : "text";
      return html`
        <label class="field">
          <span>${step.placeholder ?? "Value"}</span>
          <input
            type=${type}
            .value=${props.wizardTextValue}
            @input=${(e: Event) => {
              props.onTextChange((e.target as HTMLInputElement).value);
            }}
          />
        </label>
      `;
    }
    case "confirm":
      return html`
        <label class="field checkbox">
          <input
            type="checkbox"
            .checked=${props.wizardConfirmValue}
            @change=${(e: Event) => {
              props.onConfirmChange((e.target as HTMLInputElement).checked);
            }}
          />
          <span>Confirm</span>
        </label>
      `;
    case "select":
      return renderWizardOptions(step.options ?? [], props.wizardSelectedIndex, (index) =>
        props.onSelectIndex(index),
      );
    case "multiselect":
      return renderWizardMultiOptions(
        step.options ?? [],
        props.wizardSelectedIndices,
        props.onToggleIndex,
      );
    case "progress":
      return html`<div class="row"><div class="spinner"></div><span class="muted">Working…</span></div>`;
    case "note":
    case "action":
    default:
      return nothing;
  }
}

function renderWizardOptions(
  options: WizardStepOption[],
  selectedIndex: number,
  onSelect: (index: number) => void,
) {
  if (options.length === 0) return nothing;
  return html`
    <div class="wizard-options">
      ${options.map(
        (opt, index) => html`
          <label class="wizard-option">
            <input
              type="radio"
              name="wizard-select"
              .checked=${index === selectedIndex}
              @change=${() => onSelect(index)}
            />
            <div>
              <div>${opt.label}</div>
              ${opt.hint ? html`<div class="wizard-option-hint">${opt.hint}</div>` : nothing}
            </div>
          </label>
        `,
      )}
    </div>
  `;
}

function renderWizardMultiOptions(
  options: WizardStepOption[],
  selectedIndices: number[],
  onToggle: (index: number, checked: boolean) => void,
) {
  if (options.length === 0) return nothing;
  return html`
    <div class="wizard-options">
      ${options.map(
        (opt, index) => html`
          <label class="wizard-option">
            <input
              type="checkbox"
              .checked=${selectedIndices.includes(index)}
              @change=${(e: Event) =>
                onToggle(index, (e.target as HTMLInputElement).checked)}
            />
            <div>
              <div>${opt.label}</div>
              ${opt.hint ? html`<div class="wizard-option-hint">${opt.hint}</div>` : nothing}
            </div>
          </label>
        `,
      )}
    </div>
  `;
}

function isSubmitBlocked(step: WizardStep, props: WizardViewProps) {
  if (step.type === "select") {
    return (step.options ?? []).length === 0;
  }
  if (step.type === "multiselect") {
    return (step.options ?? []).length === 0;
  }
  if (step.type === "text") {
    return false;
  }
  return false;
}
