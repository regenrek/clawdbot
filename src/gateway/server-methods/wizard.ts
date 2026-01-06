import { randomUUID } from "node:crypto";
import { defaultRuntime } from "../../runtime.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWizardCancelParams,
  validateWizardNextParams,
  validateWizardStartParams,
  validateWizardStatusParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const wizardHandlers: GatewayRequestHandlers = {
  "wizard.start": async ({ params, respond, context }) => {
    if (!validateWizardStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.start params: ${formatValidationErrors(validateWizardStartParams.errors)}`,
        ),
      );
      return;
    }
    const running = context.findRunningWizard();
    if (running) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "wizard already running"),
      );
      return;
    }
    const sessionId = randomUUID();
    const opts = {
      mode: params.mode as "local" | "remote" | undefined,
      workspace:
        typeof params.workspace === "string" ? params.workspace : undefined,
    };
    const engine = await context.wizardEngineFactory(opts, defaultRuntime);
    context.wizardSessions.set(sessionId, engine);
    const result = await engine.start();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, { sessionId, ...result }, undefined);
  },
  "wizard.next": async ({ params, respond, context }) => {
    if (!validateWizardNextParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.next params: ${formatValidationErrors(validateWizardNextParams.errors)}`,
        ),
      );
      return;
    }
    const sessionId = params.sessionId as string;
    const engine = context.wizardSessions.get(sessionId);
    if (!engine) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"),
      );
      return;
    }
    if (engine.getStatus() !== "running") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not running"),
      );
      return;
    }
    const answer = params.answer as
      | { stepId?: string; value?: unknown }
      | undefined;
    const nav = params.nav as "next" | "back" | "cancel" | undefined;
    const result = await engine.next({
      stepId: answer?.stepId,
      value: answer?.value,
      nav,
    });
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, result, undefined);
  },
  "wizard.cancel": ({ params, respond, context }) => {
    if (!validateWizardCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.cancel params: ${formatValidationErrors(validateWizardCancelParams.errors)}`,
        ),
      );
      return;
    }
    const sessionId = params.sessionId as string;
    const engine = context.wizardSessions.get(sessionId);
    if (!engine) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"),
      );
      return;
    }
    engine.cancel();
    const status = {
      status: engine.getStatus(),
      error: engine.getError(),
    };
    context.wizardSessions.delete(sessionId);
    respond(true, status, undefined);
  },
  "wizard.status": ({ params, respond, context }) => {
    if (!validateWizardStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.status params: ${formatValidationErrors(validateWizardStatusParams.errors)}`,
        ),
      );
      return;
    }
    const sessionId = params.sessionId as string;
    const engine = context.wizardSessions.get(sessionId);
    if (!engine) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"),
      );
      return;
    }
    const status = {
      status: engine.getStatus(),
      error: engine.getError(),
    };
    if (status.status !== "running") {
      context.wizardSessions.delete(sessionId);
    }
    respond(true, status, undefined);
  },
};
