import type { OAuthCredentials, OAuthProvider } from "@mariozechner/pi-ai";
import { loginAnthropic, loginOpenAICodex } from "@mariozechner/pi-ai";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
} from "../../agents/auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import {
  getCustomProviderApiKey,
  resolveEnvApiKey,
} from "../../agents/model-auth.js";
import { loadModelCatalog } from "../../agents/model-catalog.js";
import { resolveConfiguredModelRef } from "../../agents/model-selection.js";
import {
  exchangeAntigravityOAuth,
  isRemoteEnvironment,
  startAntigravityOAuthSession,
} from "../../commands/antigravity-oauth.js";
import {
  applyAuthProfileConfig,
  applyMinimaxConfig,
  setAnthropicApiKey,
  writeOAuthCredentials,
} from "../../commands/onboard-auth.js";
import { openUrl } from "../../commands/onboard-helpers.js";
import { applyOpenAICodexModelDefault } from "../../commands/openai-codex-model-default.js";
import type { WizardStepDefinition } from "../steps.js";
import { toTrimmedString } from "../values.js";
import { commitConfig } from "./apply.js";
import type { WizardSectionSteps } from "./section.js";
import type { PendingOAuth, WizardContext, WizardState } from "./types.js";

const ENTRY_ID = "auth.choice";

function nextAfterAuth(state: WizardState): string {
  return state.command === "onboard" ? "auth.model.check" : "auth.model.prompt";
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function startOAuthFlow(
  provider: "anthropic" | "openai-codex",
  state: WizardState,
  ctx: WizardContext,
): Promise<void> {
  const deferred = createDeferred<string>();
  const pending: PendingOAuth = {
    provider,
    resolver: deferred.resolve,
    promise: undefined as Promise<OAuthCredentials | null> | undefined,
  };

  if (provider === "anthropic") {
    pending.promise = loginAnthropic(
      async (url) => {
        pending.url = url;
        state.auth.oauth = {
          provider: "anthropic",
          url,
          prompt: "Paste authorization code (code#state)",
        };
        await openUrl(url);
        ctx.runtime.log(`Open: ${url}`);
      },
      async () => deferred.promise,
    );
  } else {
    const remote = isRemoteEnvironment();
    pending.promise = loginOpenAICodex({
      onAuth: async ({ url }) => {
        pending.url = url;
        state.auth.oauth = {
          provider: "openai-codex",
          url,
          prompt: remote
            ? "Paste the redirect URL (or authorization code)"
            : "Paste authorization code (code#state)",
        };
        if (remote) {
          ctx.runtime.log(`Open this URL in your LOCAL browser:\n${url}`);
        } else {
          await openUrl(url);
          ctx.runtime.log(`Open: ${url}`);
        }
      },
      onPrompt: async (prompt) => {
        state.auth.oauth = {
          ...state.auth.oauth,
          provider: "openai-codex",
          prompt: prompt.message,
        };
        return deferred.promise;
      },
      onProgress: (msg) => ctx.runtime.log(msg),
    });
  }

  ctx.oauth.pending = pending;
}

async function finishOAuthFlow(
  state: WizardState,
  ctx: WizardContext,
  code: string,
) {
  const pending = ctx.oauth.pending;
  if (!pending?.promise || !pending.resolver) {
    state.auth.oauth = {
      ...state.auth.oauth,
      error: "OAuth flow not started",
    };
    return;
  }
  pending.resolver(code);
  try {
    const creds = await pending.promise;
    state.auth.oauth = {
      ...state.auth.oauth,
      credentials: creds ?? null,
    };
    if (!creds) return;

    const provider =
      pending.provider === "anthropic" ? "anthropic" : "openai-codex";
    state.draftConfig = applyAuthProfileConfig(state.draftConfig, {
      profileId: `${provider}:default`,
      provider,
      mode: "oauth",
    });
    if (provider === "openai-codex") {
      const { next, changed } = applyOpenAICodexModelDefault(state.draftConfig);
      state.draftConfig = next;
      state.auth.setOpenAiModelDefault = changed;
    }
  } catch (err) {
    state.auth.oauth = {
      ...state.auth.oauth,
      error: String(err),
    };
  } finally {
    ctx.oauth.pending = undefined;
  }
}

async function computeModelWarnings(state: WizardState) {
  const ref = resolveConfiguredModelRef({
    cfg: state.draftConfig,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const warnings: string[] = [];
  const catalog = await loadModelCatalog({
    config: state.draftConfig,
    useCache: false,
  });
  if (catalog.length > 0) {
    const known = catalog.some(
      (entry) => entry.provider === ref.provider && entry.id === ref.model,
    );
    if (!known) {
      warnings.push(
        `Model not found: ${ref.provider}/${ref.model}. Update agent.model or run /models list.`,
      );
    }
  }

  const store = ensureAuthProfileStore();
  const hasProfile = listProfilesForProvider(store, ref.provider).length > 0;
  const envKey = resolveEnvApiKey(ref.provider);
  const customKey = getCustomProviderApiKey(state.draftConfig, ref.provider);
  if (!hasProfile && !envKey && !customKey) {
    warnings.push(
      `No auth configured for provider "${ref.provider}". The agent may fail until credentials are added.`,
    );
  }

  if (ref.provider === "openai") {
    const hasCodex = listProfilesForProvider(store, "openai-codex").length > 0;
    if (hasCodex) {
      warnings.push(
        "Detected OpenAI Codex OAuth. Consider setting agent.model to openai-codex/gpt-5.2.",
      );
    }
  }

  state.auth.warnings = warnings;
}

export function buildAuthSection(
  nextId: string,
): WizardSectionSteps<WizardState, WizardContext> {
  const steps: Record<
    string,
    WizardStepDefinition<WizardState, WizardContext>
  > = {};

  steps[ENTRY_ID] = {
    id: ENTRY_ID,
    type: "select",
    message: "Model/auth choice",
    options: () => [
      { value: "oauth", label: "Anthropic OAuth (Claude Pro/Max)" },
      { value: "openai-codex", label: "OpenAI Codex (ChatGPT OAuth)" },
      {
        value: "antigravity",
        label: "Google Antigravity (Claude Opus 4.5, Gemini 3, etc.)",
      },
      { value: "apiKey", label: "Anthropic API key" },
      { value: "minimax", label: "Minimax M2.1 (LM Studio)" },
      { value: "skip", label: "Skip for now" },
    ],
    onAnswer: (value, state) => {
      state.auth.choice = value as WizardState["auth"]["choice"];
      state.auth.oauth = undefined;
      state.auth.apiKey = undefined;
    },
    next: (value, state) => {
      switch (value) {
        case "oauth":
          return "auth.anthropic.start";
        case "openai-codex":
          return "auth.openai.start";
        case "antigravity":
          return "auth.antigravity.start";
        case "apiKey":
          return "auth.apiKey";
        case "minimax":
          return "auth.minimax";
        default:
          return nextAfterAuth(state);
      }
    },
  };

  steps["auth.anthropic.start"] = {
    id: "auth.anthropic.start",
    type: "action",
    title: "Anthropic OAuth",
    message:
      "Browser will open. Paste the code shown after login (code#state).",
    onAnswer: async (_value, state, ctx) => {
      await startOAuthFlow("anthropic", state, ctx.context);
    },
    next: () => "auth.oauth.code",
  };

  steps["auth.openai.start"] = {
    id: "auth.openai.start",
    type: "action",
    title: "OpenAI Codex OAuth",
    message: () =>
      isRemoteEnvironment()
        ? "Remote environment detected. A URL will be shown to open in your local browser."
        : "Browser will open for OpenAI authentication.",
    onAnswer: async (_value, state, ctx) => {
      await startOAuthFlow("openai-codex", state, ctx.context);
    },
    next: () => "auth.oauth.code",
  };

  steps["auth.oauth.code"] = {
    id: "auth.oauth.code",
    type: "text",
    message: (state) =>
      state.auth.oauth?.prompt ?? "Paste authorization code (code#state)",
    placeholder: (state) => state.auth.oauth?.url,
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      state.auth.oauth = {
        ...state.auth.oauth,
        prompt: state.auth.oauth?.prompt,
        url: state.auth.oauth?.url,
        error: undefined,
        credentials: null,
        code: toTrimmedString(value),
      };
    },
    next: () => "auth.oauth.finish",
  };

  steps["auth.oauth.finish"] = {
    id: "auth.oauth.finish",
    type: "action",
    title: "Apply OAuth",
    message: "Exchanging code for credentials.",
    onAnswer: async (_value, state, ctx) => {
      const code = state.auth.oauth?.code;
      if (!code) {
        state.auth.oauth = {
          ...state.auth.oauth,
          error: "Missing authorization code",
        };
        return;
      }
      await finishOAuthFlow(state, ctx.context, code);
    },
    next: () => "auth.oauth.result",
  };

  steps["auth.oauth.result"] = {
    id: "auth.oauth.result",
    type: "note",
    title: "OAuth result",
    message: (state) => {
      const err = state.auth.oauth?.error;
      if (err) return `OAuth failed: ${err}`;
      return state.auth.oauth?.credentials
        ? "OAuth complete."
        : "OAuth skipped.";
    },
    next: (_value, state) => nextAfterAuth(state),
  };

  steps["auth.antigravity.start"] = {
    id: "auth.antigravity.start",
    type: "action",
    title: "Google Antigravity OAuth",
    message: "Browser will open. Paste the redirect URL after sign-in.",
    onAnswer: async (_value, state, ctx) => {
      const session = startAntigravityOAuthSession();
      ctx.context.oauth.antigravity = {
        url: session.url,
        verifier: session.verifier,
      };
      state.auth.oauth = {
        provider: "google-antigravity",
        url: session.url,
        prompt: "Paste the redirect URL (or code)",
      };
      await openUrl(session.url);
      ctx.context.runtime.log(`Open: ${session.url}`);
    },
    next: () => "auth.antigravity.code",
  };

  steps["auth.antigravity.code"] = {
    id: "auth.antigravity.code",
    type: "text",
    message: "Paste the redirect URL (or authorization code)",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    onAnswer: (value, state) => {
      state.auth.oauth = {
        ...state.auth.oauth,
        code: toTrimmedString(value),
      };
    },
    next: () => "auth.antigravity.finish",
  };

  steps["auth.antigravity.finish"] = {
    id: "auth.antigravity.finish",
    type: "action",
    title: "Apply Antigravity OAuth",
    message: "Exchanging code for credentials.",
    onAnswer: async (_value, state, ctx) => {
      const code = state.auth.oauth?.code ?? "";
      const pending = ctx.context.oauth.antigravity;
      if (!pending?.verifier) {
        state.auth.oauth = {
          ...state.auth.oauth,
          error: "OAuth session missing",
        };
        return;
      }
      try {
        const creds = await exchangeAntigravityOAuth(code, pending.verifier);
        state.auth.oauth = {
          ...state.auth.oauth,
          credentials: creds,
        };
        state.draftConfig = applyAuthProfileConfig(state.draftConfig, {
          profileId: `google-antigravity:${creds.email ?? "default"}`,
          provider: "google-antigravity",
          mode: "oauth",
          email: creds.email,
        });
        state.draftConfig = {
          ...state.draftConfig,
          agent: {
            ...state.draftConfig.agent,
            model: {
              primary: "google-antigravity/claude-opus-4-5-thinking",
            },
            models: {
              ...state.draftConfig.agent?.models,
              "google-antigravity/claude-opus-4-5-thinking":
                state.draftConfig.agent?.models?.[
                  "google-antigravity/claude-opus-4-5-thinking"
                ] ?? {},
            },
          },
        };
      } catch (err) {
        state.auth.oauth = {
          ...state.auth.oauth,
          error: String(err),
        };
      }
    },
    next: () => "auth.antigravity.result",
  };

  steps["auth.antigravity.result"] = {
    id: "auth.antigravity.result",
    type: "note",
    title: "Antigravity OAuth",
    message: (state) => {
      const err = state.auth.oauth?.error;
      if (err) return `OAuth failed: ${err}`;
      return state.auth.oauth?.credentials
        ? "Antigravity OAuth complete."
        : "Antigravity OAuth skipped.";
    },
    next: (_value, state) => nextAfterAuth(state),
  };

  steps["auth.apiKey"] = {
    id: "auth.apiKey",
    type: "text",
    message: "Anthropic API key",
    validate: (value) => (toTrimmedString(value) ? undefined : "Required"),
    sensitive: true,
    onAnswer: (value, state) => {
      state.auth.apiKey = toTrimmedString(value);
      state.draftConfig = applyAuthProfileConfig(state.draftConfig, {
        profileId: "anthropic:default",
        provider: "anthropic",
        mode: "api_key",
      });
    },
    next: (_value, state) => nextAfterAuth(state),
  };

  steps["auth.minimax"] = {
    id: "auth.minimax",
    type: "action",
    title: "Minimax M2.1",
    message: "Configure LM Studio (Minimax M2.1).",
    onAnswer: (_value, state) => {
      state.draftConfig = applyMinimaxConfig(state.draftConfig);
    },
    next: (_value, state) => nextAfterAuth(state),
  };

  steps["auth.model.prompt"] = {
    id: "auth.model.prompt",
    type: "text",
    message: "Default model (blank to keep)",
    initialValue: (state) => {
      if (state.command === "onboard") return "";
      return typeof state.draftConfig.agent?.model === "string"
        ? state.draftConfig.agent?.model
        : (state.draftConfig.agent?.model?.primary ?? "");
    },
    onAnswer: (value, state) => {
      if (state.command === "onboard") return;
      const model = toTrimmedString(value);
      if (!model) return;
      state.draftConfig = {
        ...state.draftConfig,
        agent: {
          ...state.draftConfig.agent,
          model: {
            primary: model,
          },
          models: {
            ...state.draftConfig.agent?.models,
            [model]: state.draftConfig.agent?.models?.[model] ?? {},
          },
        },
      };
    },
    next: () => "auth.model.check",
  };

  steps["auth.model.check"] = {
    id: "auth.model.check",
    type: "action",
    title: "Model check",
    message: "Checking model configuration.",
    onAnswer: async (_value, state) => {
      await computeModelWarnings(state);
    },
    next: (_value, state) =>
      state.auth.warnings.length > 0 ? "auth.model.warn" : "auth.apply",
  };

  steps["auth.model.warn"] = {
    id: "auth.model.warn",
    type: "note",
    title: "Model check",
    message: (state) => state.auth.warnings.join("\n"),
    next: () => "auth.apply",
  };

  steps["auth.apply"] = {
    id: "auth.apply",
    type: "action",
    title: "Apply auth config",
    message: "Save auth configuration.",
    onAnswer: async (_value, state, ctx) => {
      if (state.auth.oauth?.credentials) {
        await writeOAuthCredentials(
          (state.auth.oauth.provider ?? "anthropic") as OAuthProvider,
          state.auth.oauth.credentials,
        );
      }
      if (state.auth.apiKey) {
        await setAnthropicApiKey(state.auth.apiKey);
      }
      await commitConfig(state, ctx, "local");
    },
    next: () => nextId,
  };

  return { entryId: ENTRY_ID, exitId: nextId, steps };
}
