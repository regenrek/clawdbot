export type WizardNavAction = "next" | "back" | "cancel";

export class WizardBackError extends Error {
  constructor(message = "wizard back") {
    super(message);
    this.name = "WizardBackError";
  }
}

export class WizardCancelError extends Error {
  constructor(message = "wizard cancelled") {
    super(message);
    this.name = "WizardCancelError";
  }
}
