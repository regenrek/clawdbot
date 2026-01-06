import { describe, expect, test } from "vitest";
import type { HealthSummary } from "../commands/health.js";
import { WizardEngine } from "../wizard/engine.js";
import type { WizardContext, WizardState } from "../wizard/flows/types.js";
import type { WizardFlow, WizardRuntime } from "../wizard/steps.js";
import type { RequestFrame } from "./protocol/index.js";
import type { GatewayRequestContext } from "./server-methods/types.js";
import { wizardHandlers } from "./server-methods/wizard.js";

type HandlerResult = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

const runtime: WizardRuntime = {
  log: () => {},
  error: () => {},
};

function makeEngine(): WizardEngine<WizardState, WizardContext> {
  const flow: WizardFlow<WizardState, WizardContext> = {
    startId: "step.one",
    steps: {
      "step.one": {
        id: "step.one",
        type: "note",
        next: () => "step.two",
      },
      "step.two": {
        id: "step.two",
        type: "note",
        next: () => null,
      },
    },
  };
  const initialState = {
    command: "onboard",
    mode: "local",
    sections: [],
    baseConfig: {},
    draftConfig: {},
    workspaceDir: "",
    gatewayPort: 0,
    snapshot: { exists: false, valid: true, issues: [] },
    probes: {},
    auth: { warnings: [] },
    remote: {},
    providers: { queue: [], index: 0 },
    skills: { installSelection: [], envQueue: [], envIndex: 0 },
    controlUi: {},
  } as WizardState;
  return new WizardEngine({
    flow,
    initialState,
    runtime,
    context: { runtime: {} as WizardContext["runtime"], oauth: {} },
  });
}

function makeContext() {
  const wizardSessions = new Map<
    string,
    WizardEngine<WizardState, WizardContext>
  >();
  const health = {} as HealthSummary;
  const ctx: GatewayRequestContext = {
    deps: {} as GatewayRequestContext["deps"],
    cron: {} as GatewayRequestContext["cron"],
    cronStorePath: "",
    loadGatewayModelCatalog: async () => [],
    getHealthCache: () => null,
    refreshHealthSnapshot: async () => health,
    logHealth: { error: () => {} },
    incrementPresenceVersion: () => 1,
    getHealthVersion: () => 1,
    broadcast: () => {},
    bridge: null,
    bridgeSendToSession: () => {},
    hasConnectedMobileNode: () => false,
    agentRunSeq: new Map(),
    chatAbortControllers: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    addChatRun: () => {},
    removeChatRun: () => undefined,
    dedupe: new Map(),
    wizardSessions,
    findRunningWizard: () => {
      for (const [id, session] of wizardSessions) {
        if (session.getStatus() === "running") return id;
      }
      return null;
    },
    purgeWizardSession: (id: string) => {
      const session = wizardSessions.get(id);
      if (!session) return;
      if (session.getStatus() === "running") return;
      wizardSessions.delete(id);
    },
    getRuntimeSnapshot: () =>
      ({}) as GatewayRequestContext["getRuntimeSnapshot"],
    startWhatsAppProvider: async () => {},
    stopWhatsAppProvider: async () => {},
    stopTelegramProvider: async () => {},
    markWhatsAppLoggedOut: () => {},
    wizardEngineFactory: async () => makeEngine(),
    broadcastVoiceWakeChanged: () => {},
  };
  return ctx;
}

async function callHandler(
  method: keyof typeof wizardHandlers,
  params: Record<string, unknown>,
  context: GatewayRequestContext,
) {
  let result: HandlerResult | null = null;
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    result = { ok, payload, error };
  };
  const req: RequestFrame = { type: "req", id: "1", method, params };
  await wizardHandlers[method]({
    req,
    params,
    respond,
    context,
    client: null,
    isWebchatConnect: () => false,
  });
  if (!result) throw new Error("no response");
  return result;
}

describe("wizard server handlers", () => {
  test("start + next + back", async () => {
    const context = makeContext();
    const start = await callHandler("wizard.start", {}, context);
    expect(start.ok).toBe(true);
    const sessionId = (start.payload as { sessionId: string }).sessionId;
    expect(sessionId).toBeTruthy();

    const next = await callHandler(
      "wizard.next",
      { sessionId, answer: { stepId: "step.one" } },
      context,
    );
    expect(next.ok).toBe(true);
    const nextStep = (next.payload as { step?: { id?: string } }).step?.id;
    expect(nextStep).toBe("step.two");

    const back = await callHandler(
      "wizard.next",
      { sessionId, nav: "back" },
      context,
    );
    expect(back.ok).toBe(true);
    const backStep = (back.payload as { step?: { id?: string } }).step?.id;
    expect(backStep).toBe("step.one");
  });

  test("cancel ends session", async () => {
    const context = makeContext();
    const start = await callHandler("wizard.start", {}, context);
    const sessionId = (start.payload as { sessionId: string }).sessionId;
    const cancel = await callHandler("wizard.cancel", { sessionId }, context);
    expect(cancel.ok).toBe(true);
    expect(context.wizardSessions.size).toBe(0);
  });
});
