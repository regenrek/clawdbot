import type { WizardNavAction } from "./nav.js";
import { WizardCancelError } from "./nav.js";
import type {
  WizardFlow,
  WizardRuntime,
  WizardStep,
  WizardStepContext,
  WizardStepDefinition,
  WizardTransition,
} from "./steps.js";
import { resolveStepText } from "./steps.js";

export type WizardSessionStatus = "running" | "done" | "cancelled" | "error";

export type WizardEngineResult = {
  done: boolean;
  step?: WizardStep;
  status: WizardSessionStatus;
  error?: string;
  canGoBack?: boolean;
};

export type WizardEngineOptions<State, Ctx> = {
  flow: WizardFlow<State, Ctx>;
  initialState: State;
  runtime: WizardRuntime;
  context: Ctx;
  exitConfirm?: {
    id?: string;
    title?: string;
    message?: string;
  };
};

type StepSnapshot<State> = {
  stepId: string;
  dataBefore: State;
  answer?: unknown;
};

const DEFAULT_EXIT_STEP = "__wizard_exit__";

export class WizardEngine<State, Ctx = Record<string, never>> {
  private flow: WizardFlow<State, Ctx>;
  private runtime: WizardRuntime;
  private context: Ctx;
  private data: State;
  private answers = new Map<string, unknown>();
  private history: StepSnapshot<State>[] = [];
  private stack: string[] = [];
  private status: WizardSessionStatus = "running";
  private error: string | undefined;
  private exitStepId: string;
  private exitTitle: string;
  private exitMessage: string;
  private pendingExitReturn: string | null = null;

  constructor(options: WizardEngineOptions<State, Ctx>) {
    this.flow = options.flow;
    this.runtime = options.runtime;
    this.context = options.context;
    this.data = structuredClone(options.initialState);
    this.exitStepId = options.exitConfirm?.id ?? DEFAULT_EXIT_STEP;
    this.exitTitle = options.exitConfirm?.title ?? "Exit setup";
    this.exitMessage =
      options.exitConfirm?.message ??
      "Exit setup? Your in-progress changes will be lost.";
    if (this.flow.startId) {
      this.stack = [this.flow.startId];
    }
  }

  getStatus(): WizardSessionStatus {
    return this.status;
  }

  getError(): string | undefined {
    return this.error;
  }

  getState(): State {
    return this.data;
  }

  canGoBack(): boolean {
    if (this.status !== "running") return false;
    if (this.currentStepId() === this.exitStepId) return true;
    return this.stack.length > 1;
  }

  async start(): Promise<WizardEngineResult> {
    if (this.status !== "running") {
      return { done: true, status: this.status, error: this.error };
    }
    return this.renderCurrent();
  }

  async next(params?: {
    stepId?: string;
    value?: unknown;
    nav?: WizardNavAction;
  }): Promise<WizardEngineResult> {
    if (this.status !== "running") {
      return { done: true, status: this.status, error: this.error };
    }
    const nav = params?.nav ?? "next";
    if (nav === "back") {
      return this.goBack();
    }
    if (nav === "cancel") {
      return this.handleCancel();
    }

    const stepId = this.currentStepId();
    if (!stepId) {
      return { done: true, status: this.status, error: this.error };
    }
    if (params?.stepId && params.stepId !== stepId) {
      this.status = "error";
      this.error = "wizard: step mismatch";
      return { done: true, status: this.status, error: this.error };
    }

    if (stepId === this.exitStepId) {
      return this.handleExitAnswer(params?.value);
    }

    const step = this.requireStep(stepId);
    const value = params?.value;
    const validationError = step.validate?.(value, this.data);
    if (validationError) {
      return {
        done: false,
        status: "running",
        step: this.renderStep(step),
        error: validationError,
        canGoBack: this.canGoBack(),
      };
    }

    this.snapshotStep(stepId, value);
    try {
      if (step.onAnswer) {
        await step.onAnswer(value, this.data, this.stepContext());
      }
      const next = step.next?.(value, this.data, this.stepContext()) ?? null;
      return await this.transition(next);
    } catch (err) {
      if (err instanceof WizardCancelError) {
        this.status = "cancelled";
        this.error = err.message;
        return { done: true, status: this.status, error: this.error };
      }
      this.status = "error";
      this.error = String(err);
      return { done: true, status: this.status, error: this.error };
    }
  }

  cancel(): void {
    if (this.status !== "running") return;
    this.status = "cancelled";
    this.error = "cancelled";
    this.stack = [];
  }

  private currentStepId(): string | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1] ?? null;
  }

  private stepContext(): WizardStepContext<State, Ctx> {
    return {
      runtime: this.runtime,
      context: this.context,
      getState: () => this.data,
    };
  }

  private snapshotStep(stepId: string, value: unknown) {
    this.history = this.history.filter((entry) => entry.stepId !== stepId);
    this.history.push({
      stepId,
      dataBefore: structuredClone(this.data),
      answer: value,
    });
    this.answers.set(stepId, value);
  }

  private async transition(
    next: WizardTransition,
  ): Promise<WizardEngineResult> {
    if (next && typeof next === "object" && "nav" in next) {
      if (next.nav === "cancel") return this.handleCancel();
      if (next.nav === "back") return this.goBack();
      return this.renderCurrent();
    }
    if (!next) {
      this.status = "done";
      this.stack = [];
      return { done: true, status: this.status };
    }
    this.stack.push(next);
    return this.renderCurrent();
  }

  private async handleCancel(): Promise<WizardEngineResult> {
    const current = this.currentStepId();
    if (!current) {
      this.status = "cancelled";
      this.error = "cancelled";
      return { done: true, status: this.status, error: this.error };
    }
    if (current === this.exitStepId) {
      return this.handleExitAnswer(true);
    }
    this.pendingExitReturn = current;
    this.stack.push(this.exitStepId);
    return this.renderCurrent();
  }

  private async handleExitAnswer(value: unknown): Promise<WizardEngineResult> {
    const shouldExit = Boolean(value);
    const returnTo = this.pendingExitReturn;
    this.pendingExitReturn = null;
    this.stack.pop();
    if (shouldExit || !returnTo) {
      this.status = "cancelled";
      this.error = "cancelled";
      return { done: true, status: this.status, error: this.error };
    }
    return this.renderCurrent();
  }

  private goBack(): WizardEngineResult {
    if (this.stack.length <= 1) {
      return this.renderCurrent();
    }
    const removed = this.stack.pop();
    if (removed) {
      this.answers.delete(removed);
      this.history = this.history.filter((entry) => entry.stepId !== removed);
    }
    const previous = this.currentStepId();
    if (previous) {
      const snapshot = [...this.history]
        .reverse()
        .find((entry) => entry.stepId === previous);
      if (snapshot) {
        this.data = structuredClone(snapshot.dataBefore);
      }
    }
    return this.renderCurrent();
  }

  private renderCurrent(): WizardEngineResult {
    if (this.status !== "running") {
      return { done: true, status: this.status, error: this.error };
    }
    const stepId = this.currentStepId();
    if (!stepId) {
      this.status = "done";
      return { done: true, status: this.status };
    }
    if (stepId === this.exitStepId) {
      return {
        done: false,
        status: this.status,
        step: {
          id: this.exitStepId,
          type: "confirm",
          title: this.exitTitle,
          message: this.exitMessage,
          initialValue: false,
        },
        canGoBack: true,
      };
    }
    const step = this.requireStep(stepId);
    return {
      done: false,
      status: this.status,
      step: this.renderStep(step),
      canGoBack: this.canGoBack(),
    };
  }

  private renderStep(step: WizardStepDefinition<State, Ctx>): WizardStep {
    const initialValue = this.answers.has(step.id)
      ? this.answers.get(step.id)
      : undefined;
    const derivedInitial =
      initialValue === undefined ? step.initialValue?.(this.data) : undefined;
    const resolvedInitial = initialValue ?? derivedInitial;
    return {
      id: step.id,
      type: step.type,
      title: resolveStepText(step.title, this.data),
      message: resolveStepText(step.message, this.data),
      options:
        typeof step.options === "function"
          ? step.options(this.data)
          : step.options,
      initialValue: resolvedInitial,
      placeholder: resolveStepText(step.placeholder, this.data),
      sensitive: step.sensitive,
      executor: step.executor,
    };
  }

  private requireStep(stepId: string): WizardStepDefinition<State, Ctx> {
    const step = this.flow.steps[stepId];
    if (!step) {
      throw new Error(`wizard: missing step ${stepId}`);
    }
    return step;
  }
}
