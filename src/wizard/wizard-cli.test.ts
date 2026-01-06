import { describe, expect, test, vi } from "vitest";

import type { RuntimeEnv } from "../runtime.js";
import {
  createConfigureEngine,
  createOnboardingEngine,
} from "./engine-factory.js";
import type { WizardPrompter } from "./prompts.js";
import { runWizardCli } from "./run-cli.js";

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>(
    "../config/config.js",
  );
  return {
    ...actual,
    readConfigFileSnapshot: vi.fn(async () => ({
      exists: false,
      valid: true,
      config: {},
      issues: [],
    })),
    resolveGatewayPort: vi.fn(() => 18789),
  };
});

vi.mock("../commands/onboard-helpers.js", async () => {
  const actual = await vi.importActual<
    typeof import("../commands/onboard-helpers.js")
  >("../commands/onboard-helpers.js");
  return {
    ...actual,
    probeGatewayReachable: vi.fn(async () => ({ ok: true })),
  };
});

const runtime: RuntimeEnv = {
  log: () => {},
  error: () => {},
  exit: () => {
    throw new Error("exit");
  },
};

function createFakePrompter() {
  const state = { backUsed: false, cancelUsed: false };
  const maybeNav = (canGoBack?: boolean) => {
    if (canGoBack && !state.backUsed) {
      state.backUsed = true;
      return { nav: "back" as const };
    }
    if (state.backUsed && !state.cancelUsed) {
      state.cancelUsed = true;
      return { nav: "cancel" as const };
    }
    return null;
  };

  const prompter: WizardPrompter & { backUsed: boolean; cancelUsed: boolean } =
    {
      intro: async () => {},
      outro: async () => {},
      note: async () => {},
      progress: () => ({
        update: () => {},
        stop: () => {},
      }),
      select: async (params) => {
        const nav = maybeNav(params.nav?.canGoBack);
        if (nav) return nav;
        return { value: params.options[0]?.value };
      },
      multiselect: async (params) => {
        const nav = maybeNav(params.nav?.canGoBack);
        if (nav) return nav;
        return { value: params.options[0] ? [params.options[0].value] : [] };
      },
      text: async (params) => {
        return { value: params.initialValue ?? "value" };
      },
      confirm: async () => {
        return { value: true };
      },
      backUsed: state.backUsed,
      cancelUsed: state.cancelUsed,
    };

  Object.defineProperty(prompter, "backUsed", {
    get: () => state.backUsed,
  });
  Object.defineProperty(prompter, "cancelUsed", {
    get: () => state.cancelUsed,
  });

  return prompter;
}

describe("wizard CLI flows", () => {
  test("onboarding flow supports back + cancel", async () => {
    const engine = await createOnboardingEngine({}, runtime);
    const prompter = createFakePrompter();
    const result = await runWizardCli(engine, prompter);
    expect(result.status).toBe("cancelled");
    expect(prompter.backUsed).toBe(true);
    expect(prompter.cancelUsed).toBe(true);
  });

  test("configure flow supports back + cancel", async () => {
    const engine = await createConfigureEngine(
      {
        command: "configure",
        allowDisable: false,
        allowSignalInstall: true,
      },
      runtime,
    );
    const prompter = createFakePrompter();
    const result = await runWizardCli(engine, prompter);
    expect(result.status).toBe("cancelled");
    expect(prompter.backUsed).toBe(true);
    expect(prompter.cancelUsed).toBe(true);
  });
});
