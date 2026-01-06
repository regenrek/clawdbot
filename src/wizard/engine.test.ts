import { describe, expect, test } from "vitest";

import { WizardEngine } from "./engine.js";
import type { WizardFlow, WizardRuntime } from "./steps.js";
import { toStringValue } from "./values.js";

type SampleState = { name: string; age: number };

const runtime: WizardRuntime = {
  log: () => {},
  error: () => {},
};

describe("WizardEngine", () => {
  test("handles back and replays answers", async () => {
    const flow: WizardFlow<SampleState> = {
      startId: "name",
      steps: {
        name: {
          id: "name",
          type: "text",
          onAnswer: (value, state) => {
            state.name = toStringValue(value);
          },
          next: () => "age",
        },
        age: {
          id: "age",
          type: "text",
          onAnswer: (value, state) => {
            state.age = Number(value ?? 0);
          },
          next: () => null,
        },
      },
    };

    const engine = new WizardEngine({
      flow,
      initialState: { name: "", age: 0 },
      runtime,
      context: {},
    });

    let result = await engine.start();
    expect(result.step?.id).toBe("name");

    result = await engine.next({ stepId: "name", value: "Ada" });
    expect(result.step?.id).toBe("age");

    result = await engine.next({ nav: "back" });
    expect(result.step?.id).toBe("name");
    expect(result.step?.initialValue).toBe("Ada");
    expect(engine.getState().age).toBe(0);
  });

  test("returns validation errors without advancing", async () => {
    const flow: WizardFlow<{ email: string }> = {
      startId: "email",
      steps: {
        email: {
          id: "email",
          type: "text",
          validate: (value) =>
            toStringValue(value).includes("@") ? undefined : "invalid email",
          onAnswer: (value, state) => {
            state.email = toStringValue(value);
          },
          next: () => null,
        },
      },
    };

    const engine = new WizardEngine({
      flow,
      initialState: { email: "" },
      runtime,
      context: {},
    });

    let result = await engine.start();
    expect(result.step?.id).toBe("email");

    result = await engine.next({ stepId: "email", value: "nope" });
    expect(result.done).toBe(false);
    expect(result.error).toBe("invalid email");
    expect(result.step?.id).toBe("email");

    result = await engine.next({ stepId: "email", value: "hi@example.com" });
    expect(result.done).toBe(true);
  });

  test("cancel shows exit confirm and cancels on confirm", async () => {
    const flow: WizardFlow<{ ok: boolean }> = {
      startId: "start",
      steps: {
        start: {
          id: "start",
          type: "note",
          next: () => null,
        },
      },
    };

    const engine = new WizardEngine({
      flow,
      initialState: { ok: false },
      runtime,
      context: {},
    });

    const started = await engine.start();
    expect(started.step?.id).toBe("start");

    const exitPrompt = await engine.next({ nav: "cancel" });
    expect(exitPrompt.step?.id).toBe("__wizard_exit__");

    const cancelled = await engine.next({
      stepId: "__wizard_exit__",
      value: true,
    });
    expect(cancelled.done).toBe(true);
    expect(cancelled.status).toBe("cancelled");
  });
});
