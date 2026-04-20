import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  assembleStrategyContext,
  auditResourceCitations,
  buildStrategyChatSystemPrompt,
  emptyWorkingThesisState,
  extractThesisPatchFromProse,
  loadWorkingThesisState,
  mergeWorkingThesisState,
  recordResourceUsage,
  renderWorkingThesisStateBlock,
  retrieveLibraryContext,
  retrieveResourceContext,
  saveWorkingThesisState,
  shouldUseStrategyCorePrompt,
  type ThesisStatePatch,
  validateWorkingThesisState,
  type WorkingThesisState,
} from "../_shared/strategy-core/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════
// LAYER 1 — DIRECT PROVIDER ADAPTERS
// No Lovable gateway — all providers called directly.
// ═══════════════════════════════════════════════════════════
type ProviderKey = "openai" | "anthropic" | "perplexity" | "lovable";

interface NormalizedResponse {
  text: string;
  structured?: any;
  citations?: string[];
  provider: ProviderKey;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  error?: { type: string; message: string; status?: number };
  rawStream?: Response;
}

interface AdapterRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
  toolChoice?: any;
  reasoning?: { effort: string };
  stream?: boolean;
}

// ── Header helpers (direct API keys) ──────────────────────
/**
 * Validate the OpenAI API key shape before we ever ship it to api.openai.com.
 * Catches the "secret got pasted as a URL" failure mode that previously caused
 * silent fallback to Gemini and produced wrong outputs (cold emails for
 * everything). Fail loud here so callers can surface a clear error instead of
 * generating off-spec content under a different model.
 */
function validateOpenAIKey(
  key: string | undefined,
): { ok: true; key: string } | { ok: false; reason: string } {
  if (!key) return { ok: false, reason: "OPENAI_API_KEY not configured" };
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, reason: "OPENAI_API_KEY is empty" };
  if (/^https?:\/\//i.test(trimmed)) {
    return { ok: false, reason: "OPENAI_API_KEY looks like a URL, not a key" };
  }
  if (trimmed.includes(" ") || trimmed.includes("\n")) {
    return { ok: false, reason: "OPENAI_API_KEY contains whitespace" };
  }
  if (!/^sk-/.test(trimmed)) {
    return { ok: false, reason: "OPENAI_API_KEY missing 'sk-' prefix" };
  }
  if (trimmed.length < 30) {
    return { ok: false, reason: "OPENAI_API_KEY too short" };
  }
  return { ok: true, key: trimmed };
}

function getOpenAIHeaders(): Record<string, string> {
  const v = validateOpenAIKey(Deno.env.get("OPENAI_API_KEY"));
  if (!v.ok) throw new Error(v.reason);
  return {
    Authorization: `Bearer ${v.key}`,
    "Content-Type": "application/json",
  };
}

function getAnthropicHeaders(): Record<string, string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

function getPerplexityHeaders(): Record<string, string> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) throw new Error("PERPLEXITY_API_KEY not configured");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// ── OpenAI Adapter (DIRECT — api.openai.com) ──────────────
async function openaiAdapter(
  req: AdapterRequest,
  signal: AbortSignal,
): Promise<NormalizedResponse> {
  const start = Date.now();
  // Strip "openai/" prefix for direct API calls
  const apiModel = req.model.startsWith("openai/")
    ? req.model.slice(7)
    : req.model;
  const body: any = {
    model: apiModel,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 4096,
  };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = req.toolChoice;
  }
  if (req.reasoning) body.reasoning = req.reasoning;
  if (req.stream) body.stream = true;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: getOpenAIHeaders(),
    signal,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    let message = `OpenAI direct error: ${resp.status}`;
    try {
      const parsed = JSON.parse(errText);
      if (
        typeof parsed?.error?.message === "string" &&
        parsed.error.message.trim()
      ) {
        message = parsed.error.message.trim();
      }
    } catch {
      if (errText.trim()) message = errText.trim().slice(0, 300);
    }
    console.error(
      `[openai-direct] error ${resp.status}: ${errText.slice(0, 200)}`,
    );
    return {
      text: "",
      provider: "openai",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: { type: `http_${resp.status}`, message, status: resp.status },
    };
  }

  if (req.stream) {
    return {
      text: "",
      provider: "openai",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      rawStream: resp,
    };
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  if (!choice) {
    console.error("[openai-direct] no choices in response");
    return {
      text: "",
      provider: "openai",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: {
        type: "empty_response",
        message: "OpenAI returned no choices",
        status: 502,
      },
    };
  }

  const toolCall = choice.message?.tool_calls?.[0];
  let structured: any = undefined;
  let text = choice.message?.content || "";

  if (toolCall?.function?.arguments) {
    try {
      structured = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      console.error(
        `[openai-direct] tool call JSON parse failed: ${String(parseErr)}`,
      );
      // If tools were requested but parse failed, treat as error to trigger fallback
      if (req.tools?.length) {
        return {
          text,
          provider: "openai",
          model: req.model,
          latencyMs: Date.now() - start,
          fallbackUsed: false,
          error: {
            type: "tool_parse_error",
            message: "Tool call returned invalid JSON",
            status: 502,
          },
        };
      }
    }
  } else if (req.tools?.length && req.toolChoice) {
    // Tools requested with forced choice but no tool_calls returned
    console.warn(
      "[openai-direct] tool_choice forced but no tool_calls in response — falling back to text",
    );
    if (!text) {
      return {
        text: "",
        provider: "openai",
        model: req.model,
        latencyMs: Date.now() - start,
        fallbackUsed: false,
        error: {
          type: "missing_tool_call",
          message: "No tool call returned despite tool_choice",
          status: 502,
        },
      };
    }
  }

  return {
    text,
    structured,
    provider: "openai",
    model: req.model,
    latencyMs: Date.now() - start,
    fallbackUsed: false,
  };
}

// ── Anthropic Adapter (DIRECT — api.anthropic.com) ────────
async function anthropicAdapter(
  req: AdapterRequest,
  signal: AbortSignal,
): Promise<NormalizedResponse> {
  const start = Date.now();

  let systemPrompt = "";
  const anthropicMessages: Array<{ role: string; content: string }> = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      systemPrompt += (systemPrompt ? "\n" : "") + m.content;
    } else {anthropicMessages.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      });}
  }

  // Anthropic requires at least one non-system message
  if (anthropicMessages.length === 0) {
    if (systemPrompt) {
      anthropicMessages.push({ role: "user", content: systemPrompt });
      systemPrompt = "";
    } else {
      return {
        text: "",
        provider: "anthropic",
        model: req.model,
        latencyMs: Date.now() - start,
        fallbackUsed: false,
        error: {
          type: "empty_messages",
          message: "No messages provided for Anthropic",
        },
      };
    }
  }

  const body: any = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    messages: anthropicMessages,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (req.temperature !== undefined) body.temperature = req.temperature;

  if (req.tools?.length) {
    body.tools = req.tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (req.toolChoice) {
      body.tool_choice = {
        type: "tool",
        name: req.toolChoice.function?.name || req.tools[0].function.name,
      };
    }
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: getAnthropicHeaders(),
    signal,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(
      `[anthropic-direct] error ${resp.status}: ${errText.slice(0, 200)}`,
    );
    return {
      text: "",
      provider: "anthropic",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: {
        type: `http_${resp.status}`,
        message: `Anthropic error: ${resp.status}`,
      },
    };
  }

  const data = await resp.json();
  let text = "";
  let structured: any = undefined;

  if (
    !data.content || !Array.isArray(data.content) || data.content.length === 0
  ) {
    console.error("[anthropic-direct] empty content array in response");
    return {
      text: "",
      provider: "anthropic",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: {
        type: "empty_response",
        message: "Anthropic returned empty content",
      },
    };
  }

  for (const block of data.content) {
    if (block.type === "text") text += block.text;
    if (block.type === "tool_use") structured = block.input;
  }

  // If tools were requested but no structured output, treat as error
  if (req.tools?.length && req.toolChoice && !structured && !text) {
    console.warn(
      "[anthropic-direct] tool_choice forced but no tool_use block returned",
    );
    return {
      text: "",
      provider: "anthropic",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: {
        type: "missing_tool_call",
        message: "No tool_use block in Anthropic response",
      },
    };
  }

  return {
    text,
    structured,
    provider: "anthropic",
    model: req.model,
    latencyMs: Date.now() - start,
    fallbackUsed: false,
  };
}

// ── Perplexity Adapter (DIRECT — api.perplexity.ai) ───────
async function perplexityAdapter(
  req: AdapterRequest,
  signal: AbortSignal,
): Promise<NormalizedResponse> {
  const start = Date.now();
  const body: any = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.3,
    max_tokens: req.maxTokens ?? 8192,
  };

  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: getPerplexityHeaders(),
    signal,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(
      `[perplexity-direct] error ${resp.status}: ${errText.slice(0, 200)}`,
    );
    return {
      text: "",
      provider: "perplexity",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: {
        type: `http_${resp.status}`,
        message: `Perplexity error: ${resp.status}`,
      },
    };
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  const citations = data.citations || [];

  return {
    text,
    citations,
    provider: "perplexity",
    model: req.model,
    latencyMs: Date.now() - start,
    fallbackUsed: false,
  };
}

// ── Lovable AI Gateway Adapter ────────────────────────────
async function lovableAdapter(
  req: AdapterRequest,
  signal: AbortSignal,
): Promise<NormalizedResponse> {
  const start = Date.now();
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    return {
      text: "",
      provider: "lovable",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: { type: "config", message: "LOVABLE_API_KEY not configured" },
    };
  }

  const body: any = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
  };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.tools?.length) {
    body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
  }
  if (req.reasoning) body.reasoning = req.reasoning;

  const resp = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(
      `[lovable-gateway] error ${resp.status}: ${errText.slice(0, 200)}`,
    );
    return {
      text: "",
      provider: "lovable",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: {
        type: `http_${resp.status}`,
        message: `Lovable gateway error: ${resp.status}`,
      },
    };
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  if (!choice) {
    return {
      text: "",
      provider: "lovable",
      model: req.model,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      error: {
        type: "empty_response",
        message: "Lovable gateway returned no choices",
      },
    };
  }

  let text = choice.message?.content || "";
  let structured: any = undefined;
  const toolCall = choice.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try {
      structured = JSON.parse(toolCall.function.arguments);
    } catch { /* ignore */ }
  }

  return {
    text,
    structured,
    provider: "lovable",
    model: req.model,
    latencyMs: Date.now() - start,
    fallbackUsed: false,
  };
}

type AdapterFn = (
  req: AdapterRequest,
  signal: AbortSignal,
) => Promise<NormalizedResponse>;

const ADAPTERS: Record<ProviderKey, AdapterFn> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  perplexity: perplexityAdapter,
  lovable: lovableAdapter,
};

// ═══════════════════════════════════════════════════════════
// PROVIDER HEALTH CHECK — logged on every cold start
// All providers use direct API keys. No Lovable gateway.
// ═══════════════════════════════════════════════════════════
const _openaiKeyCheck = validateOpenAIKey(Deno.env.get("OPENAI_API_KEY"));
const PROVIDER_HEALTH = {
  openaiDirect: _openaiKeyCheck.ok,
  openaiDirectReason: _openaiKeyCheck.ok ? "valid" : _openaiKeyCheck.reason,
  anthropicDirect: !!Deno.env.get("ANTHROPIC_API_KEY"),
  perplexityDirect: !!Deno.env.get("PERPLEXITY_API_KEY"),
  lovableGateway: !!Deno.env.get("LOVABLE_API_KEY"),
};
console.log(
  `[provider-health] OpenAI: ${
    PROVIDER_HEALTH.openaiDirect
      ? "ON"
      : `OFF (${PROVIDER_HEALTH.openaiDirectReason})`
  } | Anthropic: ${
    PROVIDER_HEALTH.anthropicDirect ? "ON" : "OFF"
  } | Perplexity: ${
    PROVIDER_HEALTH.perplexityDirect ? "ON" : "OFF"
  } | Lovable: ${PROVIDER_HEALTH.lovableGateway ? "ON" : "OFF"}`,
);

// ═══════════════════════════════════════════════════════════
// LAYER 2 — ROUTER
// ═══════════════════════════════════════════════════════════
type TaskType =
  | "chat_general"
  | "deep_research"
  | "email_evaluation"
  | "territory_tiering"
  | "account_plan"
  | "opportunity_strategy"
  | "brainstorm"
  | "rollup";

interface LLMRoute {
  primaryProvider: ProviderKey;
  model: string;
  fallbackProvider: ProviderKey;
  fallbackModel: string;
  temperature: number;
  maxTokens: number;
  useTools: boolean;
  reasoning?: { effort: string };
  _smokeTestForceFail?: boolean;
}

// PROVIDER POLICY:
// - OpenAI = default engine (chat, workflows, rollup) — fallback: Anthropic
// - Perplexity = external research ONLY — fallback: OpenAI
// - Anthropic = artifact engine ONLY (in strategy-transform-output, NOT here as primary)
const ROUTES: Record<TaskType, LLMRoute> = {
  chat_general: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-20250514",
    temperature: 0.7,
    maxTokens: 4096,
    useTools: false,
  },
  deep_research: {
    primaryProvider: "perplexity",
    model: "sonar-pro",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o",
    temperature: 0.3,
    maxTokens: 8192,
    useTools: false,
  },
  email_evaluation: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-20250514",
    temperature: 0.4,
    maxTokens: 4096,
    useTools: true,
  },
  territory_tiering: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-20250514",
    temperature: 0.2,
    maxTokens: 8192,
    useTools: true,
    reasoning: { effort: "medium" },
  },
  account_plan: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-20250514",
    temperature: 0.5,
    maxTokens: 8192,
    useTools: true,
  },
  opportunity_strategy: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-20250514",
    temperature: 0.5,
    maxTokens: 8192,
    useTools: true,
  },
  brainstorm: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-20250514",
    temperature: 0.9,
    maxTokens: 4096,
    useTools: true,
  },
  rollup: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-20250514",
    temperature: 0.3,
    maxTokens: 4096,
    useTools: true,
  },
};

function resolveLLMRoute(taskType: string): LLMRoute {
  const route = { ...(ROUTES[taskType as TaskType] || ROUTES.chat_general) };

  if (route.primaryProvider === "perplexity" && taskType !== "deep_research") {
    console.error(
      `[routing] GUARDRAIL: task=${taskType} tried to use Perplexity — forcing OpenAI direct`,
    );
    route.primaryProvider = "openai";
    route.model = "gpt-4o";
  }

  if (route.primaryProvider === "openai" && !PROVIDER_HEALTH.openaiDirect) {
    console.error(
      `[routing] OPENAI_API_KEY invalid/unavailable — cannot serve task=${taskType} on OpenAI direct`,
    );
  }
  if (
    route.primaryProvider === "perplexity" && !PROVIDER_HEALTH.perplexityDirect
  ) {
    console.warn(
      `[routing] PERPLEXITY_API_KEY missing — downgrading deep_research to OpenAI direct`,
    );
    route.primaryProvider = "openai";
    route.model = "gpt-4o";
  }

  return route;
}

// ═══════════════════════════════════════════════════════════
// LAYER 3 — CALL WITH FALLBACK
// ═══════════════════════════════════════════════════════════
async function callWithFallback(
  taskType: string,
  adapterReq: Omit<AdapterRequest, "model">,
  route: LLMRoute,
): Promise<NormalizedResponse> {
  // ── SMOKE TEST MODE: force primary failure for fallback testing ──
  const smokeTestForceFail = route._smokeTestForceFail === true;
  if (smokeTestForceFail) {
    console.log(
      `[routing] SMOKE_TEST_MODE: forcing primary failure for task=${taskType}`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    let result: NormalizedResponse | null = null;

    if (!smokeTestForceFail) {
      const primaryAdapter = ADAPTERS[route.primaryProvider];
      console.log(
        `[routing] task=${taskType} primary=${route.primaryProvider} model=${route.model}`,
      );
      result = await primaryAdapter(
        { ...adapterReq, model: route.model },
        controller.signal,
      );

      if (!result.error) {
        console.log(
          `[routing] task=${taskType} provider=${result.provider} model=${result.model} latency=${result.latencyMs}ms`,
        );
        return result;
      }
    } else {
      result = {
        text: "",
        provider: route.primaryProvider,
        model: route.model,
        latencyMs: 0,
        fallbackUsed: false,
        error: {
          type: "smoke_test_forced",
          message: "SMOKE_TEST_MODE: forced primary failure",
        },
      };
    }

    console.warn(
      `[routing] primary failed: ${result.error.message}. Trying fallback=${route.fallbackProvider} model=${route.fallbackModel}`,
    );
    clearTimeout(timeout);
    const fallbackController = new AbortController();
    const fallbackTimeout = setTimeout(() => fallbackController.abort(), 55000);

    try {
      const fallbackAdapter = ADAPTERS[route.fallbackProvider];
      const fallbackResult = await fallbackAdapter(
        { ...adapterReq, model: route.fallbackModel },
        fallbackController.signal,
      );
      fallbackResult.fallbackUsed = true;
      console.log(
        `[routing] fallback task=${taskType} provider=${fallbackResult.provider} model=${fallbackResult.model} latency=${fallbackResult.latencyMs}ms reason=${result.error.message}`,
      );
      return fallbackResult;
    } finally {
      clearTimeout(fallbackTimeout);
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.warn(
        `[routing] primary timed out for task=${taskType}. Trying fallback=${route.fallbackProvider}`,
      );
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(
        () => fallbackController.abort(),
        55000,
      );
      try {
        const fallbackAdapter = ADAPTERS[route.fallbackProvider];
        const fallbackResult = await fallbackAdapter(
          { ...adapterReq, model: route.fallbackModel },
          fallbackController.signal,
        );
        fallbackResult.fallbackUsed = true;
        console.log(
          `[routing] fallback-after-timeout task=${taskType} provider=${fallbackResult.provider} latency=${fallbackResult.latencyMs}ms`,
        );
        return fallbackResult;
      } catch (fe: any) {
        if (fe.name === "AbortError") {
          return {
            text: "",
            provider: route.fallbackProvider,
            model: route.fallbackModel,
            latencyMs: 55000,
            fallbackUsed: true,
            error: {
              type: "timeout",
              message: "Both primary and fallback timed out",
            },
          };
        }
        throw fe;
      } finally {
        clearTimeout(fallbackTimeout);
      }
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// Streaming call (OpenAI direct only).
//
// Phase 0 contract: chat MUST run on the intended model (OpenAI). Silent
// fallback to Gemini was producing wrong outputs (cold emails for everything)
// because the fallback model ignores the elite-operator prompt. We now fail
// loud — handleChat surfaces "Assistant temporarily unavailable" instead.
//
// Workflow tasks (structured tool-calling) keep their own fallback in
// callWithFallback because they need a working JSON path even if OpenAI
// degrades; that lives outside this function.
async function callStreaming(
  taskType: string,
  adapterReq: Omit<AdapterRequest, "model" | "stream">,
  route: LLMRoute,
): Promise<NormalizedResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  const routeName = "openai-direct";

  try {
    console.log(JSON.stringify({
      _type: "routing.stream.start",
      task: taskType,
      intended_provider: route.primaryProvider,
      intended_model: route.model,
      route: routeName,
    }));

    if (route.primaryProvider !== "openai") {
      const misconfig = {
        text: "",
        provider: route.primaryProvider,
        model: route.model,
        latencyMs: 0,
        fallbackUsed: false,
        error: {
          type: "misconfigured_route",
          message:
            `Chat route must use OpenAI direct, got ${route.primaryProvider}`,
          status: 500,
        },
      } satisfies NormalizedResponse;
      console.error(JSON.stringify({
        _type: "routing.stream.fail",
        task: taskType,
        actual_provider: misconfig.provider,
        actual_model: misconfig.model,
        route: routeName,
        fallback_used: false,
        status: 500,
        reason: misconfig.error?.message,
      }));
      return misconfig;
    }

    if (route._smokeTestForceFail) {
      const forced = {
        text: "",
        provider: "openai",
        model: route.model,
        latencyMs: 0,
        fallbackUsed: false,
        error: {
          type: "smoke_test_forced",
          message: "SMOKE_TEST_MODE: forced primary failure",
          status: 503,
        },
      } satisfies NormalizedResponse;
      console.error(JSON.stringify({
        _type: "routing.stream.fail",
        task: taskType,
        actual_provider: forced.provider,
        actual_model: forced.model,
        route: routeName,
        fallback_used: false,
        status: 503,
        reason: forced.error?.message,
      }));
      return forced;
    }

    const result = await openaiAdapter({
      ...adapterReq,
      model: route.model,
      stream: true,
    }, controller.signal);
    if (result.error) {
      console.error(JSON.stringify({
        _type: "routing.stream.fail",
        task: taskType,
        actual_provider: result.provider,
        actual_model: result.model,
        route: routeName,
        fallback_used: false,
        status: result.error.status ?? 502,
        reason: result.error.message,
      }));
      return result;
    }

    console.log(JSON.stringify({
      _type: "routing.stream.ok",
      task: taskType,
      actual_provider: result.provider,
      actual_model: result.model,
      route: routeName,
      fallback_used: false,
      status: 200,
    }));
    return result;
  } catch (e: any) {
    const isAbort = e?.name === "AbortError";
    const errorResult = {
      text: "",
      provider: "openai",
      model: route.model,
      latencyMs: isAbort ? 55000 : Date.now(),
      fallbackUsed: false,
      error: {
        type: isAbort ? "timeout" : "exception",
        message: isAbort ? "OpenAI stream timed out" : String(e?.message || e),
        status: isAbort ? 504 : 500,
      },
    } satisfies NormalizedResponse;
    console.error(JSON.stringify({
      _type: "routing.stream.fail",
      task: taskType,
      actual_provider: errorResult.provider,
      actual_model: errorResult.model,
      route: routeName,
      fallback_used: false,
      status: errorResult.error?.status,
      reason: errorResult.error?.message,
    }));
    return errorResult;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════
// WORKFLOW TOOL SCHEMAS
// ═══════════════════════════════════════════════════════════
const WORKFLOW_TOOLS: Record<string, any> = {
  deep_research: {
    type: "function",
    function: {
      name: "deep_research_result",
      description: "Return structured deep research findings.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          company_overview: { type: "string" },
          key_findings: { type: "array", items: { type: "string" } },
          strategic_implications: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          opportunities: { type: "array", items: { type: "string" } },
          recommended_actions: { type: "array", items: { type: "string" } },
          cited_sources: { type: "array", items: { type: "string" } },
        },
        required: [
          "summary",
          "company_overview",
          "key_findings",
          "strategic_implications",
          "risks",
          "opportunities",
          "recommended_actions",
          "cited_sources",
        ],
        additionalProperties: false,
      },
    },
  },
  email_evaluation: {
    type: "function",
    function: {
      name: "email_evaluation_result",
      description: "Return structured email evaluation.",
      parameters: {
        type: "object",
        properties: {
          overall_score: { type: "number" },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
          subject_line_feedback: { type: "string" },
          opening_feedback: { type: "string" },
          value_prop_feedback: { type: "string" },
          cta_feedback: { type: "string" },
          rewrite: { type: "string" },
        },
        required: [
          "overall_score",
          "strengths",
          "weaknesses",
          "subject_line_feedback",
          "opening_feedback",
          "value_prop_feedback",
          "cta_feedback",
          "rewrite",
        ],
        additionalProperties: false,
      },
    },
  },
  territory_tiering: {
    type: "function",
    function: {
      name: "territory_tiering_result",
      description: "Return structured territory tiering analysis.",
      parameters: {
        type: "object",
        properties: {
          methodology: { type: "string" },
          tiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                account_name: { type: "string" },
                tier: {
                  type: "string",
                  enum: ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
                },
                rationale: { type: "string" },
                next_action: { type: "string" },
              },
              required: ["account_name", "tier", "rationale", "next_action"],
              additionalProperties: false,
            },
          },
          summary: { type: "string" },
        },
        required: ["methodology", "tiers", "summary"],
        additionalProperties: false,
      },
    },
  },
  account_plan: {
    type: "function",
    function: {
      name: "account_plan_result",
      description: "Return structured account plan.",
      parameters: {
        type: "object",
        properties: {
          executive_summary: { type: "string" },
          account_overview: { type: "string" },
          stakeholder_map: { type: "array", items: { type: "string" } },
          strategic_objectives: { type: "array", items: { type: "string" } },
          action_plan: { type: "array", items: { type: "string" } },
          risk_factors: { type: "array", items: { type: "string" } },
          success_metrics: { type: "array", items: { type: "string" } },
        },
        required: [
          "executive_summary",
          "account_overview",
          "stakeholder_map",
          "strategic_objectives",
          "action_plan",
          "risk_factors",
          "success_metrics",
        ],
        additionalProperties: false,
      },
    },
  },
  opportunity_strategy: {
    type: "function",
    function: {
      name: "opportunity_strategy_result",
      description: "Return structured opportunity strategy.",
      parameters: {
        type: "object",
        properties: {
          deal_summary: { type: "string" },
          decision_process: { type: "string" },
          champion_status: { type: "string" },
          competition_analysis: { type: "string" },
          value_alignment: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          next_actions: { type: "array", items: { type: "string" } },
          close_plan: { type: "string" },
        },
        required: [
          "deal_summary",
          "decision_process",
          "champion_status",
          "competition_analysis",
          "value_alignment",
          "risks",
          "next_actions",
          "close_plan",
        ],
        additionalProperties: false,
      },
    },
  },
  brainstorm: {
    type: "function",
    function: {
      name: "brainstorm_result",
      description: "Return structured brainstorm output.",
      parameters: {
        type: "object",
        properties: {
          key_insights: { type: "array", items: { type: "string" } },
          bold_ideas: { type: "array", items: { type: "string" } },
          quick_wins: { type: "array", items: { type: "string" } },
          strategic_bets: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: [
          "key_insights",
          "bold_ideas",
          "quick_wins",
          "strategic_bets",
          "summary",
        ],
        additionalProperties: false,
      },
    },
  },
};

const ROLLUP_TOOL = {
  type: "function",
  function: {
    name: "generate_rollup",
    description: "Generate a structured thread rollup.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        key_facts: { type: "array", items: { type: "string" } },
        hypotheses: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        open_questions: { type: "array", items: { type: "string" } },
        next_steps: { type: "array", items: { type: "string" } },
        memory_suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              memory_type: {
                type: "string",
                enum: [
                  "fact",
                  "hypothesis",
                  "risk",
                  "priority",
                  "stakeholder_note",
                  "messaging_note",
                  "next_step",
                ],
              },
              content: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["memory_type", "content", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "summary",
        "key_facts",
        "hypotheses",
        "risks",
        "open_questions",
        "next_steps",
        "memory_suggestions",
      ],
      additionalProperties: false,
    },
  },
};

// ═══════════════════════════════════════════════════════════
// RETRIEVAL LAYER
// ═══════════════════════════════════════════════════════════
const MAX_CONTEXT_CHARS = 14000;
const CAPS = { memories: 15, uploads: 5, outputs: 5, messages: 15 };

interface ContextPack {
  account?: any;
  opportunity?: any;
  memories: any[];
  uploads: any[];
  outputs: any[];
  recentMessages: any[];
  sourceCount: number;
  retrievalMeta: {
    memoriesScored: number;
    uploadsIncluded: number;
    outputsIncluded: number;
    messagesIncluded: number;
    pinnedMemories: number;
    uploadNames: string[];
    outputTitles: string[];
    contextType: string;
    topSources: string[];
  };
}

async function buildContextPack(
  supabase: any,
  threadId: string,
  userId: string,
  userQuery?: string,
  workflowType?: string,
): Promise<ContextPack> {
  const pack: ContextPack = {
    memories: [],
    uploads: [],
    outputs: [],
    recentMessages: [],
    sourceCount: 0,
    retrievalMeta: {
      memoriesScored: 0,
      uploadsIncluded: 0,
      outputsIncluded: 0,
      messagesIncluded: 0,
      pinnedMemories: 0,
      uploadNames: [],
      outputTitles: [],
      contextType: "minimal",
      topSources: [],
    },
  };

  const { data: thread } = await supabase.from("strategy_threads")
    .select(
      "linked_account_id, linked_opportunity_id, linked_territory_id, title",
    )
    .eq("id", threadId).single();
  if (!thread) return pack;

  const rawQuery = `${userQuery || ""} ${thread.title || ""}`;
  const queryTerms = rawQuery.toLowerCase().split(/\s+/).filter((w: string) =>
    w.length > 3
  );
  const workflowBoostTerms: Record<string, string[]> = {
    deep_research: [
      "research",
      "competitor",
      "industry",
      "market",
      "technology",
      "stakeholder",
    ],
    account_plan: [
      "plan",
      "strategy",
      "objective",
      "stakeholder",
      "timeline",
      "metric",
    ],
    territory_tiering: [
      "tier",
      "priority",
      "segment",
      "icp",
      "revenue",
      "potential",
    ],
    email_evaluation: [
      "email",
      "message",
      "outreach",
      "subject",
      "tone",
      "cta",
    ],
    opportunity_strategy: [
      "deal",
      "champion",
      "decision",
      "close",
      "risk",
      "competitor",
    ],
    brainstorm: ["idea", "approach", "creative", "angle", "hypothesis"],
  };
  const boostTerms = workflowBoostTerms[workflowType || ""] || [];

  const promises: Promise<void>[] = [];

  if (thread.linked_account_id) {
    promises.push((async () => {
      const { data: acct } = await supabase.from("accounts")
        .select(
          "id, name, industry, tier, website, notes, outreach_status, tech_stack, tags",
        )
        .eq("id", thread.linked_account_id).single();
      pack.account = acct;
      const { data: mem } = await supabase.from("account_strategy_memory")
        .select(
          "id, memory_type, content, is_pinned, confidence, last_used_at, created_at",
        )
        .eq("account_id", thread.linked_account_id).eq("user_id", userId).eq(
          "is_irrelevant",
          false,
        )
        .order("created_at", { ascending: false }).limit(40);
      if (mem) {
        pack.memories.push(
          ...mem.map((m: any) => ({ ...m, source: "account" })),
        );
      }
    })());
  }

  if (thread.linked_opportunity_id) {
    promises.push((async () => {
      const { data: opp } = await supabase.from("opportunities")
        .select("id, name, stage, close_date, notes")
        .eq("id", thread.linked_opportunity_id).single();
      pack.opportunity = opp ? { ...opp, amount: null } : null;
      const { data: mem } = await supabase.from("opportunity_strategy_memory")
        .select(
          "id, memory_type, content, is_pinned, confidence, last_used_at, created_at",
        )
        .eq("opportunity_id", thread.linked_opportunity_id).eq(
          "user_id",
          userId,
        ).eq("is_irrelevant", false)
        .order("created_at", { ascending: false }).limit(40);
      if (mem) {
        pack.memories.push(
          ...mem.map((m: any) => ({ ...m, source: "opportunity" })),
        );
      }
    })());
  }

  if (thread.linked_territory_id) {
    promises.push((async () => {
      const { data: mem } = await supabase.from("territory_strategy_memory")
        .select(
          "id, memory_type, content, is_pinned, confidence, last_used_at, created_at",
        )
        .eq("territory_id", thread.linked_territory_id).eq("user_id", userId)
        .eq("is_irrelevant", false)
        .order("created_at", { ascending: false }).limit(40);
      if (mem) {
        pack.memories.push(
          ...mem.map((m: any) => ({ ...m, source: "territory" })),
        );
      }
    })());
  }

  promises.push((async () => {
    const { data: ups } = await supabase.from("strategy_uploaded_resources")
      .select("id, file_name, parsed_text, summary, file_type")
      .eq("thread_id", threadId).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(10);
    if (ups) pack.uploads = ups.filter((u: any) => u.parsed_text || u.summary);
  })());

  promises.push((async () => {
    const { data: outs } = await supabase.from("strategy_outputs")
      .select("id, output_type, title, rendered_text, is_pinned, created_at")
      .eq("thread_id", threadId).order("created_at", { ascending: false })
      .limit(8);
    if (outs) pack.outputs = outs;
  })());

  promises.push((async () => {
    const { data: msgs } = await supabase.from("strategy_messages")
      .select("id, role, content_json, message_type")
      .eq("thread_id", threadId).neq("message_type", "workflow_update")
      .order("created_at", { ascending: false }).limit(25);
    if (msgs) {
      pack.recentMessages = msgs.reverse().map((m: any) => ({
        id: m.id,
        role: m.role,
        text: (m.content_json?.text || "").slice(0, 600),
      }));
    }
  })());

  await Promise.all(promises);

  pack.memories = scoreAndRankMemories(pack.memories, queryTerms, boostTerms);
  pack.outputs = scoreAndRankOutputs(pack.outputs, queryTerms);
  pack.uploads = pack.uploads.slice(0, CAPS.uploads).map((u: any) => ({
    ...u,
    parsed_text: u.parsed_text ? u.parsed_text.slice(0, 2000) : null,
    summary: u.summary ? u.summary.slice(0, 500) : null,
  }));
  pack.recentMessages = pack.recentMessages.slice(-CAPS.messages);

  const pinnedCount = pack.memories.filter((m: any) => m.is_pinned).length;
  const memWeight = pack.memories.length * 2;
  const upWeight = pack.uploads.length * 3;
  const outWeight = pack.outputs.length * 2;
  const totalWeight = memWeight + upWeight + outWeight;
  let contextType = "minimal";
  if (totalWeight > 0) {
    if (memWeight > upWeight && memWeight > outWeight) {
      contextType = "memory-driven";
    } else if (upWeight > memWeight && upWeight > outWeight) {
      contextType = "upload-driven";
    } else contextType = "mixed";
  }

  const topSources: string[] = [];
  for (const m of pack.memories.slice(0, 2)) {
    topSources.push(`Memory: ${m.content.slice(0, 60)}`);
  }
  for (const u of pack.uploads.slice(0, 1)) {
    topSources.push(`Upload: ${u.file_name}`);
  }

  pack.retrievalMeta = {
    memoriesScored: pack.memories.length,
    uploadsIncluded: pack.uploads.length,
    outputsIncluded: pack.outputs.length,
    messagesIncluded: pack.recentMessages.length,
    pinnedMemories: pinnedCount,
    uploadNames: pack.uploads.map((u: any) => u.file_name).filter(Boolean),
    outputTitles: pack.outputs.map((o: any) => o.title).filter(Boolean).slice(
      0,
      5,
    ),
    contextType,
    topSources: topSources.slice(0, 3),
  };

  pack.sourceCount = (pack.account ? 1 : 0) + (pack.opportunity ? 1 : 0) +
    pack.memories.length + pack.uploads.length + pack.outputs.length;

  const memoryIds = pack.memories.map((m: any) => m.id);
  if (memoryIds.length > 0) {
    const now = new Date().toISOString();
    for (
      const [table, src] of [["account_strategy_memory", "account"], [
        "opportunity_strategy_memory",
        "opportunity",
      ], ["territory_strategy_memory", "territory"]] as const
    ) {
      const ids = pack.memories.filter((m: any) => m.source === src).map((
        m: any,
      ) => m.id);
      if (ids.length > 0) {
        await supabase.from(table).update({ last_used_at: now }).in("id", ids);
      }
    }
  }

  console.log(
    `[retrieval] sources=${pack.sourceCount} memories=${pack.memories.length}(${pinnedCount} pinned) uploads=${pack.uploads.length} outputs=${pack.outputs.length} contextType=${contextType}`,
  );
  return pack;
}

function scoreAndRankMemories(
  memories: any[],
  queryTerms: string[],
  boostTerms: string[],
): any[] {
  const seen = new Set<string>();
  const deduped = memories.filter((m) => {
    const norm = m.content.toLowerCase().trim().slice(0, 200);
    for (const s of seen) {
      if (s.includes(norm) || norm.includes(s)) return false;
    }
    seen.add(norm);
    return true;
  });

  return deduped.map((m) => {
    let score = 1;
    if (m.is_pinned) score += 5;
    if (m.confidence && m.confidence > 0.7) score += 2;
    else if (m.confidence && m.confidence > 0.5) score += 1;
    else if (m.confidence !== null && m.confidence < 0.3) score -= 1;
    if (m.last_used_at) {
      const usedAge = (Date.now() - new Date(m.last_used_at).getTime()) /
        86400000;
      if (usedAge < 3) score += 2;
      else if (usedAge < 7) score += 1;
    }
    const ageDays = (Date.now() - new Date(m.created_at).getTime()) / 86400000;
    if (ageDays < 1) score += 4;
    else if (ageDays < 3) score += 3;
    else if (ageDays < 7) score += 2;
    else if (ageDays < 30) score += 1;
    else if (!m.is_pinned) score -= 1;
    const content = m.content.toLowerCase();
    if (queryTerms.length > 0) {
      score += queryTerms.filter((t: string) => content.includes(t)).length * 2;
    }
    if (boostTerms.length > 0) {
      score += boostTerms.filter((t) => content.includes(t)).length * 1.5;
    }
    const highPriorityTypes = [
      "risk",
      "priority",
      "next_step",
      "stakeholder_note",
    ];
    if (highPriorityTypes.includes(m.memory_type)) score += 1;
    return { ...m, score };
  }).sort((a: any, b: any) => b.score - a.score).slice(0, CAPS.memories);
}

function scoreAndRankOutputs(outputs: any[], queryTerms: string[]): any[] {
  return outputs.map((o) => {
    let score = 1;
    if (o.is_pinned) score += 4;
    const age = Date.now() - new Date(o.created_at).getTime();
    if (age < 24 * 3600000) score += 3;
    else if (age < 7 * 86400000) score += 2;
    const text = `${o.title} ${o.rendered_text || ""}`.toLowerCase();
    if (queryTerms.length > 0) {
      score += queryTerms.filter((t: string) => text.includes(t)).length * 1.5;
    }
    return { ...o, score };
  }).sort((a: any, b: any) => b.score - a.score).slice(0, 5);
}

function packToPromptSection(pack: ContextPack): string {
  const sections: string[] = [];
  let charBudget = MAX_CONTEXT_CHARS;

  if (pack.account) {
    const tags = pack.account.tags?.length
      ? ` | Tags: ${pack.account.tags.join(", ")}`
      : "";
    const tech = pack.account.tech_stack?.length
      ? ` | Tech: ${pack.account.tech_stack.join(", ")}`
      : "";
    const s = `\n### Linked Account: ${pack.account.name}\nIndustry: ${
      pack.account.industry || "Unknown"
    } | Tier: ${pack.account.tier || "Unset"} | Status: ${
      pack.account.outreach_status || "None"
    }${tags}${tech}${
      pack.account.notes ? `\nNotes: ${pack.account.notes.slice(0, 400)}` : ""
    }`;
    sections.push(s);
    charBudget -= s.length;
  }
  if (pack.opportunity) {
    const s = `\n### Linked Opportunity: ${pack.opportunity.name}\nStage: ${
      pack.opportunity.stage || "Unknown"
    }${
      pack.opportunity.close_date
        ? ` | Close: ${pack.opportunity.close_date}`
        : ""
    }${
      pack.opportunity.notes
        ? `\nNotes: ${pack.opportunity.notes.slice(0, 400)}`
        : ""
    }`;
    sections.push(s);
    charBudget -= s.length;
  }
  if (pack.memories.length > 0) {
    let memSection = "\n### Strategic Memory:";
    for (const m of pack.memories) {
      const pin = m.is_pinned ? " 📌" : "";
      const conf = m.confidence ? ` (${Math.round(m.confidence * 100)}%)` : "";
      const line = `\n- [${m.memory_type}${pin}${conf}] ${
        m.content.slice(0, 250)
      }`;
      if (charBudget - line.length < 0) break;
      memSection += line;
      charBudget -= line.length;
    }
    sections.push(memSection);
  }
  if (pack.uploads.length > 0) {
    let upSection = "\n### Uploaded Resources:";
    for (const u of pack.uploads) {
      const text = u.summary || (u.parsed_text || "").slice(0, 800);
      const line = `\n- ${u.file_name}: ${text}`;
      if (charBudget - line.length < 0) break;
      upSection += line;
      charBudget -= line.length;
    }
    sections.push(upSection);
  }
  if (pack.outputs.length > 0) {
    let outSection = "\n### Prior Outputs:";
    for (const o of pack.outputs) {
      const text = (o.rendered_text || "").slice(0, 400);
      const pin = o.is_pinned ? " 📌" : "";
      const line = `\n- [${o.output_type}${pin}] ${o.title}: ${text}`;
      if (charBudget - line.length < 0) break;
      outSection += line;
      charBudget -= line.length;
    }
    sections.push(outSection);
  }
  return sections.join("\n");
}

// ── Rendered text from structured output ───────────────────
function renderStructuredOutput(workflowType: string, data: any): string {
  try {
    switch (workflowType) {
      case "deep_research":
        return `# Deep Research\n\n## Summary\n${
          data.summary || ""
        }\n\n## Company Overview\n${
          data.company_overview || ""
        }\n\n## Key Findings\n${
          (data.key_findings || []).map((f: string) => `- ${f}`).join("\n")
        }\n\n## Strategic Implications\n${
          (data.strategic_implications || []).map((s: string) => `- ${s}`).join(
            "\n",
          )
        }\n\n## Risks\n${
          (data.risks || []).map((r: string) => `- ${r}`).join("\n")
        }\n\n## Opportunities\n${
          (data.opportunities || []).map((o: string) => `- ${o}`).join("\n")
        }\n\n## Recommended Actions\n${
          (data.recommended_actions || []).map((a: string) => `- ${a}`).join(
            "\n",
          )
        }\n\n## Sources\n${
          (data.cited_sources || []).map((s: string) => `- ${s}`).join("\n")
        }`;
      case "email_evaluation":
        return `# Email Evaluation\n\n**Score: ${
          data.overall_score ?? "N/A"
        }/10**\n\n## Strengths\n${
          (data.strengths || []).map((s: string) => `- ${s}`).join("\n")
        }\n\n## Weaknesses\n${
          (data.weaknesses || []).map((w: string) => `- ${w}`).join("\n")
        }\n\n## Subject Line\n${
          data.subject_line_feedback || ""
        }\n\n## Opening\n${
          data.opening_feedback || ""
        }\n\n## Value Proposition\n${
          data.value_prop_feedback || ""
        }\n\n## CTA\n${data.cta_feedback || ""}\n\n## Suggested Rewrite\n${
          data.rewrite || ""
        }`;
      case "territory_tiering":
        return `# Territory Tiering\n\n## Methodology\n${
          data.methodology || ""
        }\n\n## Results\n${
          (data.tiers || []).map((t: any) =>
            `### ${t.account_name || "?"} — ${t.tier || "?"}\n${
              t.rationale || ""
            }\n**Next:** ${t.next_action || ""}`
          ).join("\n\n")
        }\n\n## Summary\n${data.summary || ""}`;
      case "account_plan":
        return `# Account Plan\n\n## Executive Summary\n${
          data.executive_summary || ""
        }\n\n## Overview\n${data.account_overview || ""}\n\n## Stakeholders\n${
          (data.stakeholder_map || []).map((s: string) => `- ${s}`).join("\n")
        }\n\n## Strategic Objectives\n${
          (data.strategic_objectives || []).map((o: string) => `- ${o}`).join(
            "\n",
          )
        }\n\n## Action Plan\n${
          (data.action_plan || []).map((a: string) => `- ${a}`).join("\n")
        }\n\n## Risk Factors\n${
          (data.risk_factors || []).map((r: string) => `- ${r}`).join("\n")
        }\n\n## Success Metrics\n${
          (data.success_metrics || []).map((m: string) => `- ${m}`).join("\n")
        }`;
      case "opportunity_strategy":
        return `# Opportunity Strategy\n\n## Deal Summary\n${
          data.deal_summary || ""
        }\n\n## Decision Process\n${
          data.decision_process || ""
        }\n\n## Champion Status\n${
          data.champion_status || ""
        }\n\n## Competition\n${
          data.competition_analysis || ""
        }\n\n## Value Alignment\n${data.value_alignment || ""}\n\n## Risks\n${
          (data.risks || []).map((r: string) => `- ${r}`).join("\n")
        }\n\n## Next Actions\n${
          (data.next_actions || []).map((a: string) => `- ${a}`).join("\n")
        }\n\n## Close Plan\n${data.close_plan || ""}`;
      case "brainstorm":
        return `# Brainstorm\n\n## Key Insights\n${
          (data.key_insights || []).map((i: string) => `- ${i}`).join("\n")
        }\n\n## Bold Ideas\n${
          (data.bold_ideas || []).map((i: string) => `- ${i}`).join("\n")
        }\n\n## Quick Wins\n${
          (data.quick_wins || []).map((w: string) => `- ${w}`).join("\n")
        }\n\n## Strategic Bets\n${
          (data.strategic_bets || []).map((b: string) => `- ${b}`).join("\n")
        }\n\n## Summary\n${data.summary || ""}`;
      default:
        return JSON.stringify(data, null, 2);
    }
  } catch {
    return JSON.stringify(data, null, 2);
  }
}

function workflowTypeToOutputType(wt: string): string {
  const map: Record<string, string> = {
    deep_research: "brief",
    account_plan: "account_plan",
    territory_tiering: "tiering_result",
    email_evaluation: "email",
    opportunity_strategy: "opportunity_plan",
    brainstorm: "memo",
  };
  return map[wt] || "memo";
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      userId = user?.id ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      action,
      threadId,
      content,
      workflowType,
      depth,
      force_primary_failure,
      pickedResourceIds,
    } = body;
    // Sidecar: explicit resource IDs the user picked from /library this turn.
    // Validated to a clean string[] before being passed downstream.
    const cleanPickedResourceIds: string[] = Array.isArray(pickedResourceIds)
      ? pickedResourceIds.filter((s: unknown) => typeof s === 'string' && /^[0-9a-f-]{16,}$/i.test(s))
      : [];

    // ── Debug: OpenAI key health check ──────────────────────
    // Phase 0 acceptance gate. Returns 200 only when the key is shaped
    // correctly AND a real round-trip to api.openai.com succeeds.
    if (action === "debug_openai_test") {
      const v = validateOpenAIKey(Deno.env.get("OPENAI_API_KEY"));
      if (!v.ok) {
        return new Response(
          JSON.stringify({ status: "fail", stage: "shape", reason: v.reason }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      try {
        const start = Date.now();
        const resp = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${v.key}` },
        });
        const latency = Date.now() - start;
        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          return new Response(
            JSON.stringify({
              status: "fail",
              stage: "auth",
              http: resp.status,
              reason: errText.slice(0, 200),
              latency_ms: latency,
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        await resp.body?.cancel();
        return new Response(
          JSON.stringify({
            status: "ok",
            latency_ms: latency,
            key_prefix: v.key.slice(0, 7) + "…",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      } catch (e: any) {
        return new Response(
          JSON.stringify({
            status: "fail",
            stage: "network",
            reason: String(e?.message || e),
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    if (action === "debug_chat_model_test") {
      const route = resolveLLMRoute("chat_general");
      const routeName = route.primaryProvider === "openai"
        ? "openai-direct"
        : `${route.primaryProvider}-direct`;
      const start = Date.now();
      const result = await (route.primaryProvider === "openai"
        ? openaiAdapter({
          model: route.model,
          messages: [
            { role: "system", content: "Reply with exactly: ok" },
            { role: "user", content: "ok" },
          ],
          temperature: 0,
          maxTokens: 16,
        }, new AbortController().signal)
        : ADAPTERS[route.primaryProvider]({
          model: route.model,
          messages: [
            { role: "system", content: "Reply with exactly: ok" },
            { role: "user", content: "ok" },
          ],
          temperature: 0,
          maxTokens: 16,
        }, new AbortController().signal));

      if (result.error) {
        return new Response(
          JSON.stringify({
            status: "fail",
            provider: result.provider,
            model: result.model,
            route: routeName,
            http: result.error.status ?? 502,
            latency_ms: Date.now() - start,
            reason: result.error.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          status: "ok",
          provider: result.provider,
          model: result.model,
          route: routeName,
          http: 200,
          latency_ms: Date.now() - start,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Smoke test mode: allow forced fallback only when SMOKE_TEST_MODE env is set
    const smokeTestMode = Deno.env.get("SMOKE_TEST_MODE") === "true";
    const forceFallback = smokeTestMode && force_primary_failure === true;

    if (!threadId) {
      return new Response(JSON.stringify({ error: "threadId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contextPack = await buildContextPack(
      supabase,
      threadId,
      userId,
      content,
      workflowType,
    );
    const contextSection = packToPromptSection(contextPack);

    if (action === "rollup") {
      return await handleRollup(supabase, threadId, userId, contextPack);
    }
    if (action === "workflow") {
      return await handleWorkflow(
        supabase,
        threadId,
        userId,
        workflowType,
        content,
        contextSection,
        contextPack,
        forceFallback,
      );
    }
    return await handleChat(
      supabase,
      threadId,
      userId,
      content,
      depth,
      contextSection,
      contextPack,
      forceFallback,
      cleanPickedResourceIds,
    );
  } catch (e) {
    console.error("strategy-chat error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

// ── Strategy Core chat prompt assembly ───────────────────
// Composes the same reasoning primitives Discovery Prep uses, but only
// when there's enough real context (account-linked or library hits) to
// justify the elite-strategist frame. Falls back to the original
// generic chat prompt for context-less chit-chat so we don't put on
// strategy theater for unrelated questions.
function deriveLibraryScopes(account: any, userContent: string): string[] {
  const scopes: string[] = [];
  if (account?.industry) scopes.push(String(account.industry));
  if (Array.isArray(account?.tags)) scopes.push(...account.tags.map(String));
  if (Array.isArray(account?.tech_stack)) {
    scopes.push(...account.tech_stack.map(String));
  }
  // Pull a few salient nouns out of the user's question — keeps retrieval
  // grounded in what the rep is actually asking, not just account meta.
  const words = (userContent || "")
    .split(/[^A-Za-z0-9-]+/)
    .filter((w) => w.length >= 4 && w.length <= 24);
  scopes.push(...words.slice(0, 8));
  // De-dup, drop empties.
  return Array.from(new Set(scopes.map((s) => s.trim()).filter(Boolean)));
}

// ── Intent classifier + Mode Lock ────────────────────────────────────
// Deterministic, lightweight, invisible. Inspects the user's last
// message and returns a HARD MODE LOCK block that gets prepended to
// the system prompt. The block tells the model exactly what asset
// type to produce and forbids the common drift patterns we've seen
// in production (e.g. answering "what template should I use?" with
// a follow-up email).
//
// We classify by intent verbs/nouns in the user's question, not by
// account context. Order matters — earliest match wins.
type ChatIntent =
  | "bootstrap" // vague ask + no account context — orient the user
  | "synthesis" // derive a framework/scoring/rubric FROM the user's library
  | "template"
  | "email"
  | "message" // SMS/LinkedIn/Slack/voicemail/script
  | "pitch" // exact wording for a moment
  | "next_steps"
  | "analysis"
  | "provenance"
  | "freeform";

interface IntentResult {
  intent: ChatIntent;
  /** Numeric constraint extracted from the ask (e.g. "3 sentence" → 3). */
  sentenceCap?: number;
  /** Free-text constraint phrase, e.g. "3 sentence", "two bullets". */
  rawConstraint?: string;
  /** Sub-flag: this is a business-case-style ask (CFO, ROI, business case). */
  isBusinessCase?: boolean;
  /** Sub-flag: this is a CFO/finance audience ask. */
  isCFO?: boolean;
}

function classifyChatIntent(
  userContent: string,
  ctx?: { hasAccountContext?: boolean },
): IntentResult {
  const text = (userContent || "").toLowerCase().trim();
  const hasAccountContext = ctx?.hasAccountContext === true;

  // 0. BOOTSTRAP — fires BEFORE all other intents.
  // Trigger: vague/orienting prompt AND no account context.
  // Goal: orient the user (capabilities + one guiding question), never refuse.
  // We deliberately keep this list tight — anything that mentions a real
  // task verb (write, draft, plan, analyze, send, build, etc.) skips bootstrap
  // and falls through to the normal classifier so we never hijack a real ask.
  if (!hasAccountContext) {
    const isEmptyOrTiny = !text || text.length < 4;
    const VAGUE_OPENERS_RE =
      /^(hi|hello|hey|yo|sup|hola|howdy|test|testing|ping|\?)[\s\.\?!]*$/;
    const HELP_RE =
      /^(help( me)?|what (can|do) you do|what is this|what('?s| is) this( for)?|what should i (use|do with) (this|you)( for)?|how (do|does) (this|it|you) work|how (can|do) i (use|start) (this|you)|where (do|should) i start|what now|what next|what should i ask|getting started|onboard(ing)?|who are you|what are you)[\s\.\?!]*$/;
    if (isEmptyOrTiny || VAGUE_OPENERS_RE.test(text) || HELP_RE.test(text)) {
      console.log(
        `[mode-lock] intent_forced_bootstrap text="${text.slice(0, 80)}"`,
      );
      return { intent: "bootstrap" };
    }
  }

  if (!text) return { intent: "freeform" };

  // Numeric constraint: "3 sentence", "two sentences", "5 bullets", etc.
  let sentenceCap: number | undefined;
  let rawConstraint: string | undefined;
  const numWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  };
  const sentMatch = text.match(
    /\b(\d+|one|two|three|four|five|six|seven)[-\s]+sentence/,
  );
  if (sentMatch) {
    const raw = sentMatch[1];
    sentenceCap = /^\d+$/.test(raw) ? parseInt(raw, 10) : numWords[raw];
    rawConstraint = sentMatch[0];
  }

  // Sub-flags: business case + CFO audience drive economic-pressure injection.
  const isBusinessCase =
    /\b(business\s*case|roi|payback|justification|cost\s+benefit|investment\s+case)\b/.test(text);
  const isCFO =
    /\b(cfo|chief\s+financial|finance\s+(team|leader|chief)|controller|treasur(er|y)|economic\s+buyer)\b/.test(text);


  // 1. Provenance — ALWAYS WINS. Outranks analysis even in account-linked
  // threads. Patterns: "where is this from", "where did it come from",
  // "where are you pulling this from", "where is this being pulled from",
  // "what source is this", "what is this based on", "how do you know this",
  // "why do you think/say", "source(s)?".
  const PROVENANCE_RE =
    /\b(where (is|are|did|does|do) (this|that|it|they|you)|where('?s| is) (this|that|it) (from|pulled|coming|based|sourced|getting)|where (is|are) (this|that|it|you|i) (being\s+)?(pulled|sourced|getting|coming|drawing|reading|reading from)|what('?s| is) (this|that|it) based on|what('?s| is) (the|your) (source|basis)|what (source|sources) (is|are) (this|that|it)|source(s)?\??$|how (do|did) you know (this|that)?|why (do|did) you (think|say|believe)|what(?:'?s| is) the (source|basis|reference)|pulled from)\b/;
  if (PROVENANCE_RE.test(text)) {
    console.log(
      `[mode-lock] intent_forced_provenance text="${text.slice(0, 80)}"`,
    );
    return { intent: "provenance" };
  }

  // 2. Template — "what template", "give me a template", "template for"
  if (
    /\btemplate(s)?\b/.test(text) &&
    /(what|which|give|need|use|share|send|build|create|recommend|suggest|good|best)/
      .test(text)
  ) {
    return { intent: "template", sentenceCap, rawConstraint, isBusinessCase, isCFO };
  }

  // 3. Email — explicit "email" or "write me an email"
  if (
    /\b(email|e-mail)\b/.test(text) &&
    /(write|draft|send|give|need|craft|compose|reply|respond)/.test(text)
  ) {
    return { intent: "email", sentenceCap, rawConstraint, isBusinessCase, isCFO };
  }

  // 4. Message / script / voicemail / DM / SMS / LinkedIn note
  if (
    /\b(voicemail|vm|script|sms|text|dm|message|linkedin (note|message|inmail)|slack)\b/
      .test(text) &&
    /(write|draft|send|give|need|craft|leave|record|reply)/.test(text)
  ) {
    return { intent: "message", sentenceCap, rawConstraint, isBusinessCase, isCFO };
  }

  // 5. Pitch / exact words to say
  if (
    /\b(pitch|say|tell|frame|position|open(er)?|talk track)\b/.test(text) &&
    /(how|what|words|exact|should i)/.test(text)
  ) {
    return { intent: "pitch", sentenceCap, rawConstraint, isBusinessCase, isCFO };
  }

  // 6. Next steps — "what should I do", "next step", "next move", "what now"
  if (
    /\b(next step(s)?|next move|what (should|do) i do|what now|where (do|should) i (go|take|move)|what('?s| is) my (move|play))\b/
      .test(text)
  ) {
    return { intent: "next_steps", isBusinessCase, isCFO };
  }

  // 7. Analysis / thesis / how should I think
  if (
    /\b(thesis|account thesis|leakage|economic consequence|deal review|analy(s|z)e|how (should|do) i think|read on|take on|view on|assess(ment)?|risk(s)? (here|on this))\b/
      .test(text)
  ) {
    return { intent: "analysis", isBusinessCase, isCFO };
  }

  return { intent: "freeform", sentenceCap, rawConstraint, isBusinessCase, isCFO };
}

function buildModeLockBlock(intent: IntentResult): string {
  const { intent: kind, sentenceCap, rawConstraint, isBusinessCase, isCFO } = intent;

  const constraintLine = sentenceCap
    ? `\n- HARD CONSTRAINT: Output EXACTLY ${sentenceCap} sentence${sentenceCap === 1 ? "" : "s"} (the user said "${rawConstraint}"). No more. No less. Count them before you finish.`
    : "";

  // Universal binding clause appended to every lock. Tells the model
  // unambiguously that drifting outside the mode is a wrong answer.
  const bindingClause =
    `\n- BINDING: If you produce ANY content outside this mode, your answer is incorrect. Server-side guards will TRUNCATE or REJECT it.`;

  // ── SUBSTANCE CONTRACT ──
  // Banned-phrase list applied to EVERY mode. These are the soft-AE
  // patterns we keep seeing: "I hope this finds you well", "just
  // checking in", "let me know if", etc. Top reps don't write this way.
  //
  // PLACEHOLDER POLICY:
  //   - template mode REQUIRES [BRACKETED] placeholders (it's a fill-in form).
  //   - every other mode FORBIDS placeholder cosplay. If a fact is missing,
  //     state what's missing in one short line and stop. Never fabricate
  //     specifics, never emit [BRACKETED_*], $[BRACKETED_*], [Client],
  //     [specific date], [Contact Name], etc.
  const isTemplateMode = kind === "template";
  const placeholderPolicy = isTemplateMode
    ? `\n- SPECIFICITY FLOOR: every concrete reference you have in context MUST appear. Where a fact is genuinely unknown, use [BRACKETED_PLACEHOLDER] — that is the contract for template mode.`
    : `\n- ZERO-PLACEHOLDER RULE (HARD): you are NOT in template mode. You are FORBIDDEN from emitting any placeholder token of any kind: no [BRACKETED_*], no $[BRACKETED_*], no %[BRACKETED_*], no [Client], no [Customer], no [Contact Name], no [specific date], no [date], no [name] except for a name that's actually in context. If you do not have a fact, do ONE of these: (a) use only the facts that ARE in the thread/account context, (b) say in ONE short line exactly what's missing (e.g. "I can make this CFO-ready once you give me the savings estimate and deadline."), or (c) write a directional sentence with no fake specifics (e.g. "If we delay this, we risk pushing the project into next quarter and missing the current implementation window."). Bracket-placeholder cosplay will be STRIPPED by the server-side guard and you will be marked incorrect.
- SUBSTANCE CONTRACT: NEVER use any of these phrases — "I hope this finds you well", "I hope this email finds you well", "I hope you're doing well", "I hope all is well", "just checking in", "circling back", "touching base", "reaching out to see", "let me know if", "let me know your thoughts", "I wanted to", "I just wanted to", "happy to chat", "happy to discuss", "would love to", "I'd love to", "I look forward to hearing", "thoughts?", "any thoughts", "feel free to", "at your earliest convenience", "as per", "kindly", "warm regards". They make you sound like a junior SDR.
- VERB FLOOR: lead sentences with strong, specific verbs. Replace "follow up on X" → "ask Y to confirm Z". Replace "check in on the deal" → "ask the named person for the decision/signature/intro you actually need".`;
  const substanceContract = isTemplateMode
    ? `\n- SUBSTANCE CONTRACT: NEVER use any of these phrases — "I hope this finds you well", "I hope this email finds you well", "I hope you're doing well", "I hope all is well", "just checking in", "circling back", "touching base", "reaching out to see", "let me know if", "let me know your thoughts", "I wanted to", "I just wanted to", "happy to chat", "happy to discuss", "would love to", "I'd love to", "I look forward to hearing", "thoughts?", "any thoughts", "feel free to", "at your earliest convenience", "as per", "kindly", "warm regards". They make you sound like a junior SDR.
- VERB FLOOR: lead sentences with strong, specific verbs.${placeholderPolicy}`
    : placeholderPolicy;

  // Economic pressure injection — fires for pitch + next_steps + analysis +
  // any business-case template + any CFO-audience ask.
  const economicPressureRequired = isBusinessCase || isCFO ||
    kind === "pitch" || kind === "analysis";
  const economicLayer = economicPressureRequired
    ? (isTemplateMode
      ? `\n- ECONOMIC PRESSURE LAYER (REQUIRED): Anchor the output in money + time. Include AT LEAST ONE concrete economic element: cost of inaction (\$/quarter or % loss), urgency trigger (compliance deadline, contract date, market window), tradeoff (what they give up by waiting). Where a number is unknown, use [BRACKETED_NUMBER] (template mode). No vague phrases like "significant savings" or "improved efficiency".`
      : `\n- ECONOMIC PRESSURE LAYER (REQUIRED): Anchor the output in money + time. If you have a real number/date in context, use it. If you don't, write a directional sentence WITHOUT placeholders (e.g. "Delaying this risks pushing implementation into next quarter and missing the current budget window") OR call out exactly what number/date you'd need from the rep in one short line. NEVER emit [BRACKETED_NUMBER], $[…], %[…] in this mode.`)
    : "";

  switch (kind) {
    case "bootstrap":
      return `═══ MODE LOCK: BOOTSTRAP (ORIENTATION) ═══
The user opened the assistant with no account context and a vague prompt. This is ORIENTATION, not execution. Help them understand what to do next in 6 lines or fewer.

═══ REQUIRED OUTPUT (EXACT SHAPE — NO DEVIATION) ═══
First line, verbatim:
Here's how I can help you move a deal forward:

Then exactly four short bullets, in this order, in plain English (you may lightly adapt the wording but keep the same four capabilities and same order):
- Pressure test a deal
- Write emails or talk tracks
- Build a business case
- Plan next steps

Then a blank line, then the closing line, verbatim:
Start here: What account or deal are you working on?

═══ HARD RULES ═══
- FORBIDDEN: refusing, asking for "a real specific…", saying "I need more info", saying "I don't have enough context", any defensive or rigid framing.
- FORBIDDEN: an email, a template, a thesis, a script, a numbered list of considerations, a "here's how I'd think about this" preface.
- FORBIDDEN: bracket placeholders of any kind ([Account], [Client], [name], etc.).
- FORBIDDEN: switching to analysis mode, template mode, or any other mode.
- FORBIDDEN: trailing upgrade lines like "Want me to…" — the closing question IS the call to action.
- TONE: confident, plainspoken, helpful. No SDR fluff. No "I'd love to". No "happy to".${bindingClause}`;

    case "template":
      return `═══ MODE LOCK: TEMPLATE ═══
The user asked for a TEMPLATE. You MUST return a structured, fill-in-the-blank template for the exact thing they named.
- FORBIDDEN: returning an email draft (no "Subject:", no "Hi [name]"), a follow-up note, a voicemail, a framework explanation, or any other asset type.
- FORBIDDEN: explaining what a template is, how to think about it, or why it matters.
- REQUIRED: First line names the template (e.g. "Use this Business Case template:"). Then the template itself with clear section headers and [BRACKETED] placeholders.
- One short upgrade line at the end is allowed (e.g. "Want me to fill this in for [account]?"). Nothing else.${
        isBusinessCase
          ? `\n- BUSINESS CASE REQUIRED SECTIONS: must include "CURRENT COST OF INACTION", "PROJECTED ROI / PAYBACK", "RISK OF DELAY", "DECISION DEADLINE". Use \$/% placeholders, not adjectives.`
          : ""
      }${economicLayer}${constraintLine}${substanceContract}${bindingClause}`;

    case "email":
      return `═══ MODE LOCK: EMAIL (BODY-ONLY) ═══
The user asked for an EMAIL. Return ONLY the email BODY in body-only format.
- REQUIRED FORMAT: First line is exactly "Send this:" on its own line. Then the email body sentences. Nothing else.
- FORBIDDEN: "Subject:" line. FORBIDDEN: greeting lines like "Hi [Name]," / "Hello," / "Hey,". FORBIDDEN: signoff lines like "Thanks,", "Best,", "Cheers,", "— [Name]".
- FORBIDDEN: a plan, bullets, numbered lists, multiple versions, a voicemail, a script, commentary, or pre-amble.
- FORBIDDEN: a "here's how I'd think about this" preface. FORBIDDEN: "Do this next:". FORBIDDEN: trailing "Want me to tailor this..." line.
- The body is the message itself — direct sentences a rep can paste into a thread mid-conversation. No envelope, no salutation, no sign-off.
- DIRECT-ASK RULE: the email MUST contain ONE clear ask anchored to a decision, date, or named artifact (e.g. "Are we aligned to move forward on the [pricing we discussed] by [date], or is there a blocker I should address?"). No vague "checking in" energy.
- Only add a Subject, greeting, or signoff if the user EXPLICITLY asks for one.${economicLayer}${constraintLine}${substanceContract}${bindingClause}`;

    case "message":
      return `═══ MODE LOCK: MESSAGE / SCRIPT ═══
The user asked for exact wording (voicemail, SMS, LinkedIn note, script, DM).
- FORBIDDEN: an email, a plan, a framework, multiple versions unless asked.
- REQUIRED: Start with "Say this:" or "Send this:" then the exact words. Nothing else except (optionally) one short upgrade line.${economicLayer}${constraintLine}${substanceContract}${bindingClause}`;

    case "pitch":
      return `═══ MODE LOCK: PITCH (exact words) ═══
The user asked how to PITCH or POSITION something. Give the exact words to say.
- FORBIDDEN: a plan, a framework, a methodology, a numbered list of considerations, "Subject:", "Hi [name]", a generic prospecting opener, "I wanted to share…".
- REQUIRED: Start with "Say this:" then the exact pitch (1–4 sentences). Nothing else. No upgrade line.${
        isCFO
          ? `\n- CFO AUDIENCE: lead with money. Frame on cost of inaction, payback period, or risk-adjusted return. Use real \$ figures or % deltas IF they exist in context. If they don't, write a directional sentence with NO bracket placeholders. No SDR-style "want to learn about your priorities" openings — CFOs hate it.`
          : ""
      }${economicLayer}${constraintLine}${substanceContract}${bindingClause}`;

    case "next_steps":
      return `═══ MODE LOCK: NEXT STEPS ═══
The user asked WHAT TO DO NEXT. Return numbered actions.
- FORBIDDEN: a cold email (no "Subject:", no "Hi"), a script, a pitch, a thesis, a framework, a "here's how to think about this" preface.
- REQUIRED: Start with "Do this next:" then a numbered list (3–6 items max). Each item is a concrete action with a strong verb first AND a real named target from context AND a concrete outcome. Use ONLY names/dates/numbers that actually appear in the thread/account context. If you don't have a name, write the role ("the economic buyer", "the CFO") — never "[name]" or "[Client]". No commentary between items. No trailing upgrade line.
- ECONOMIC ANCHOR: at least ONE step must reference money, decision deadline, or named risk (e.g. "Confirm the budget owner this week or this slips to next quarter").${economicLayer}${constraintLine}${substanceContract}${bindingClause}`;

    case "analysis":
      return `═══ MODE LOCK: STRATEGIC ANALYSIS (DECISION FORCE LAYER) ═══
The user explicitly asked for analysis / thesis / read on the deal. ANSWER WITH THE THESIS ITSELF — do NOT explain where it came from, do NOT describe methodology, do NOT frame how you'd think about it. The thesis IS the answer.

═══ DECISION FORCE LAYER (NON-NEGOTIABLE) ═══
You are not here to be right. You are here to be **usefully opinionated under incomplete information**. A wrong-but-falsifiable read that changes the rep's next move is INFINITELY more valuable than a smart-sounding hedge. Output must create TENSION + DIRECTION + TESTABILITY.

1. ONE DIRECTIONAL BET. Take exactly ONE stance. NEVER offer multiple possibilities, branching scenarios, "on the other hand", "alternatively", or "it could also be that". Pick the strongest read and commit.

2. THESIS MUST CREATE URGENCY. Don't describe — force a position the rep must act on now.
   Weak: "Assume Abrigo has centralized procurement."
   Strong: "Assume Abrigo has already inserted a procurement gate — this deal will stall unless that path is cleared this week."

3. EVERY LEAKAGE MUST THREATEN THE DEAL. Each bullet answers "why does this kill the deal?" Use the chain: mechanism → deal impact → outcome.
   Weak: "Procurement adds 2–4 weeks."
   Strong: "Procurement inserts a new approval cycle → pushes the deal past quarter-end → budget reallocates to other priorities."

4. ECONOMIC CONSEQUENCE MUST INCLUDE AT LEAST ONE OF: (a) timeline impact tied to a specific window (quarter-end, fiscal close, budget cycle), (b) budget loss / reallocation, (c) deal reset to stage 0, (d) competitive displacement / champion erosion. No abstract "delay" language.
   Weak: "This will delay the deal."
   Strong: "This will push the deal past Q4 close and risks losing the budget entirely to a competing initiative."

5. DISCOVERY QUESTION MUST FORCE TRUTH. The single question that PROVES or KILLS the thesis. It must (a) expose risk, (b) force a yes/no reality, (c) be uncomfortable for the buyer to dodge. Worded exactly as the rep would say it, in quotes, targeted at a named role.
   Weak: "Ask about procurement."
   Strong: "Ask the economic buyer: 'Has this deal already been approved through the new Abrigo procurement process, or will it require a fresh approval cycle?'"

6. BAN SAFE THINKING. Forbidden words/phrases (server will strip): "may", "might", "could", "potential(ly)", "possibly", "perhaps", "likely", "probably", "depends", "should explore", "understand", "learn more", "tends to", "often", "in general", "this suggests", "this indicates", "there is a risk", "there is a possibility", "this could lead to", "this may result in", "this might cause", "it remains to be seen", "one possibility is", "on the other hand", "alternatively", "it could also be", "another possibility", "risks <verbing>" (e.g. "risks losing the budget" — say "will lose the budget"), "at risk of", "risk of <verbing>".

7. ACTIVE VOICE — HARD OUTCOME VERBS ONLY. Every consequence sentence must use one of: "will cause", "will push", "will create", "will stall", "will reset", "will reallocate", "will lose", "will strand", "will erode", "will displace", "will block", "will kill", "will miss", "will derail", "will jeopardize". No "risks <ing>", no "could", no "may", no passive evasions.

8. NO VAGUE LEAKAGE. A leakage bullet is INVALID if it just names a category ("procurement risk", "stakeholder change", "budget concerns"). It MUST name (a) the SPECIFIC mechanism (who does what), (b) the SPECIFIC deal impact (what step/stage breaks), and (c) the SPECIFIC outcome (what the rep loses). If you can't name all three, drop the bullet.

- REQUIRED OUTPUT SHAPE (use these EXACT labels, each on its own line — DO NOT change the structure):
  Account thesis:
  [ONE sharp committed assertion that creates urgency — "Assume X — this deal will Y unless Z". Name the mechanism. No alternatives.]

  Value leakage:
  - [mechanism → deal impact → outcome — bullet 1]
  - [bullet 2]
  - [bullet 3 (optional, max 4)]

  Economic consequence:
  [one short paragraph in ACTIVE voice naming a specific timeline window (quarter, fiscal close, budget cycle) AND at least one of: budget loss, deal reset, competitive displacement. No "could", no "may", no "there is a risk".]

  Next best discovery action:
  [ONE uncomfortable yes/no question in quotes that PROVES or KILLS the thesis fastest, targeted at a named role]

- FORBIDDEN META/PROVENANCE LANGUAGE (server guard will STRIP): "this comes from", "this is based on", "based on the (available |provided |given )?context", "informed by", "derived from", "pulled from", "the thesis is based on", "this assessment uses", "this analysis draws on", "where this comes from", "according to (the|your) (thread|context|notes|account)", "given the limited context", "without more information", "to provide a more accurate", "here's how to think about", "the way to think about this is".
- FORBIDDEN: an email, a template, a script, a "here's how to think about it" essay, a recap of what data you do/don't have, hedges, passive evasions, multiple scenarios, branching options.
- IF DATA IS THIN: do NOT generalize, do NOT list possibilities. Make the SINGLE strongest reasonable inference, frame it as "Assume X — this deal will Y unless Z", and use the discovery question to confirm/kill it. NEVER substitute meta-commentary. NEVER emit bracket placeholders. NEVER hedge. NEVER branch.${economicLayer}${constraintLine}${substanceContract}${bindingClause}`;

    case "provenance":
      return `═══ MODE LOCK: PROVENANCE ═══
The user asked WHERE the information came from. Answer in plain English in 1–3 sentences MAX.
- REQUIRED: Name the source(s) directly — linked account, uploaded file, internal KI/Playbook by short id, prior thread message, or "operator pattern (no internal source)".
- FORBIDDEN: defensive language, methodology theater, robotic disclaimers, a new asset, restating the question, "Subject:", "Hi", any email structure, numbered lists, trailing upgrade line ("Want me to…").${constraintLine}${substanceContract}${bindingClause}`;

    case "freeform":
    default:
      return `═══ MODE LOCK: FREEFORM ═══
The user's intent isn't a clear asset request. Pick the SMALLEST useful output that answers the literal question.
- FORBIDDEN: defaulting to an email or a generic template just because that's easy.
- FORBIDDEN: a strategic-thesis essay unless they explicitly asked for analysis.
- REQUIRED: First line answers the question directly. If an asset is the right answer, give it. If a one-line answer is the right answer, give that and stop.${economicLayer}${constraintLine}${substanceContract}${bindingClause}`;
  }
}

// ── POST-GENERATION MODE-LOCK GUARD ────────────────────────
// Validates model output against the classified intent and either
// (a) hard-truncates the offending tail or (b) flags the response
// for a single strict regeneration. We DO NOT silently retry — the
// caller decides whether to regenerate.
interface GuardResult {
  text: string;
  modified: boolean;
  violations: string[];
  /** True when violation is severe enough that caller should regenerate once. */
  shouldRegenerate: boolean;
}

const TAIL_LINE_REGEX =
  /\n+\s*(?:want me to|let me know if|happy to|shall i|should i|would you like)[^\n]*\??\s*$/i;

function countSentences(text: string): number {
  // Strip trailing whitespace and split on sentence terminators followed
  // by space or end. Conservative — counts "?" and "!" as well as ".".
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!matches) return 1; // a single line without terminator
  return matches.length;
}

function enforceModeLock(
  rawText: string,
  intent: IntentResult,
): GuardResult {
  let text = rawText.trim();
  const violations: string[] = [];
  let modified = false;
  let shouldRegenerate = false;

  if (!text) {
    return { text, modified: false, violations: ["empty"], shouldRegenerate: true };
  }

  // ── Allowed-tail-line policy ──
  // Only template + email may keep a "Want me to tailor…" upgrade line.
  // For all other modes, strip it.
  const tailAllowed = intent.intent === "template" || intent.intent === "email";
  if (!tailAllowed && TAIL_LINE_REGEX.test(text)) {
    text = text.replace(TAIL_LINE_REGEX, "").trim();
    modified = true;
    violations.push("stripped_trailing_upgrade_line");
  }

  // ── ZERO-PLACEHOLDER GUARD (non-template modes) ──
  // Bracket-placeholder cosplay is fake precision. Outside template mode it
  // is FORBIDDEN. We aggressively strip / collapse / replace so the UI never
  // ships [BRACKETED_*], $[…], [Client], [Contact Name], [specific date], etc.
  if (intent.intent !== "template") {
    // Broad detector: any [...] block that looks like a fill-in placeholder.
    // Two complementary patterns:
    //   1) Anything wrapped in $[…] or %[…] or [...]% / [...]/year / etc — prefixed/suffixed sigils signal a quantitative slot.
    //   2) [...] whose interior contains placeholder-marker tokens: BRACKETED_,
    //      uppercase_with_underscores, "specific X", "Client", "Customer",
    //      "Contact Name", "Champion", "Buyer", "Account Name", "Date",
    //      "Deadline", "Number", "Amount", "Percentage", "Insert", "Fill",
    //      "TBD", "XXX", "Department", "Team", "Name", "Solution/Product",
    //      "Project/Initiative", "Product", standalone uppercase words like
    //      DATE / NUMBER / PERCENTAGE.
    const PLACEHOLDER_MARKERS = [
      /BRACKETED[_\s]/i,
      /^[A-Z][A-Z0-9_%]*$/, // ALLCAPS_TOKEN like COMPLIANCE_DATE, NUMBER, %_DELTA
      /\b(specific|insert|fill|placeholder|enter)\b/i,
      /\bClient(?:'s|\u2019s)?\b/i,
      /\bCustomer(?:'s|\u2019s)?\b/i,
      /\bContact\b/i,
      /\bChampion\b/i,
      /\bAccount\s+Name\b/i,
      /\bCompany\s+Name\b/i,
      /\bBuyer\b/i,
      /\bCFO\s+Name\b/i,
      /\b(date|deadline|number|amount|percentage|name|metric|constraint|issue|target)\b/i,
      /\b(Department|Team|Solution|Product|Project|Initiative)\b/i,
      /\bTBD\b|\bTBC\b|XXX/,
    ];
    const BRACKET_BLOCK_RE = /(?:\$|%)?\[([^\]\n]{1,80})\]\s*(?:%|\/(?:year|month|quarter|week|day|hour|qtr|yr|mo))?/g;
    let placeholderHits = 0;
    const cleanedText = text.replace(BRACKET_BLOCK_RE, (full, inner) => {
      const innerTrim = (inner || "").trim();
      // Skip obvious non-placeholder content (e.g. citation refs like [S1]).
      if (/^S\d+$/i.test(innerTrim)) return full;
      // Skip resource refs like RESOURCE[…] handled elsewhere.
      const isPlaceholder = PLACEHOLDER_MARKERS.some((re) => re.test(innerTrim));
      if (isPlaceholder) {
        placeholderHits += 1;
        return "";
      }
      return full;
    });
    if (placeholderHits > 0) {
      // Collapse leftover sigils, orphan punctuation, double spaces.
      const cleaned = cleanedText
        .replace(/\$\s*(?=[\/\.\,\;\)\s])/g, "")
        .replace(/%\s*(?=[\/\.\,\;\)\s])/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+([\.\,\;\:\!\?])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const usable = cleaned.length >= 30 && /[a-zA-Z]{12,}/.test(cleaned);
      if (usable) {
        text = cleaned;
        modified = true;
        violations.push("placeholder_blocked_non_template");
        console.log(
          `[mode-lock] placeholder_blocked_non_template intent=${intent.intent} stripped_count=${placeholderHits}`,
        );
      } else {
        const askMap: Record<string, string> = {
          email:
            "Send this:\nI need a real fact (decision date, budget, owner name) before I can write this email — what's the one specific you want me to anchor it on?",
          pitch:
            "Say this: I'd rather not pitch this without one real number — give me the savings figure or the decision deadline and I'll tighten this for the CFO.",
          next_steps:
            "Do this next:\n1. Tell me the named buyer, the decision date, and the dollar figure that matter on this deal so I can give you steps grounded in this account, not a generic checklist.",
          analysis:
            "I don't have enough account-specific data in this thread to write a real thesis without inventing numbers. Give me the ARR, the decision date, or the named economic buyer and I'll produce the leakage map and economic consequence with real anchors.",
          provenance:
            "I can't ground this in a specific source in the current thread. Treat this as operator reasoning, not a cited internal source.",
          message:
            "Say this: I need one real specific (name, date, or number) before I write the script — what should I anchor it on?",
          bootstrap:
            "Here's how I can help you move a deal forward:\n- Pressure test a deal\n- Write emails or talk tracks\n- Build a business case\n- Plan next steps\n\nStart here: What account or deal are you working on?",
          freeform:
            "I don't have a real specific to anchor this on. Give me the one fact that matters (name, number, or date) and I'll produce the output without placeholders.",
        };
        text = askMap[intent.intent] || askMap.freeform;
        modified = true;
        violations.push("placeholder_blocked_replaced_with_ask");
        console.log(
          `[mode-lock] placeholder_blocked_replaced_with_ask intent=${intent.intent} stripped_count=${placeholderHits}`,
        );
      }
    }
  }

  switch (intent.intent) {
    case "template": {
      // Must contain bracketed placeholders OR section headers.
      const hasPlaceholders = /\[[A-Z][A-Z _\/-]*\]/.test(text) ||
        /\[[a-z][a-z _\/-]*\]/i.test(text);
      const hasHeaders = /^[A-Z][A-Z0-9 \-_/]{3,}$/m.test(text) ||
        /^#{1,3}\s+\S/m.test(text);
      if (!hasPlaceholders && !hasHeaders) {
        violations.push("template_missing_structure");
        shouldRegenerate = true;
      }
      // Forbidden email fingerprints
      if (/^subject:/im.test(text) || /^hi\s+\[?[a-z]/im.test(text)) {
        violations.push("template_contains_email_fingerprint");
        shouldRegenerate = true;
      }
      break;
    }

    case "email": {
      // BODY-ONLY contract: "Send this:" sentinel + email body sentences only.
      // No Subject, no greeting, no signoff (unless user explicitly asked).
      const APO_E = "['\u2019]";

      // 1) Strip "Do this next:" appended block.
      if (/\bdo this next:/i.test(text)) {
        const idx = text.search(/\bdo this next:/i);
        if (idx > 60) {
          text = text.slice(0, idx).trim();
          modified = true;
          violations.push("truncated_appended_next_steps");
        } else {
          violations.push("email_contains_next_steps");
          shouldRegenerate = true;
        }
      }

      // 2) Strip trailing "Want me to ..." tail line (forbidden in body-only).
      const tailRe = new RegExp(
        `\\n+\\s*(want\\s+me\\s+to|let\\s+me\\s+know\\s+if|happy\\s+to\\s+(tailor|adjust|tweak))[^\\n]*$`,
        "i",
      );
      if (tailRe.test(text)) {
        text = text.replace(tailRe, "").trim();
        modified = true;
        violations.push("stripped_tail_line");
      }

      // 3) Detect whether user explicitly asked for subject/greeting/signoff.
      const userAskedFullEmail = /\b(subject\s*line|with\s+(a\s+)?subject|full\s+email|complete\s+email|with\s+greeting|with\s+sign[- ]?off)\b/i
        .test(intent.rawConstraint || "");

      // 4) Normalize sentinel: ensure exactly one "Send this:" prefix.
      let working = text.trim();
      // Drop any leading "Subject: ..." line(s) when not explicitly requested.
      if (!userAskedFullEmail) {
        // Remove a leading Subject: line (and its content up to the next newline).
        working = working.replace(/^\s*subject:[^\n]*\n+/i, "");
        // Remove a leading greeting line: "Hi X,", "Hello,", "Hey [Name],"
        working = working.replace(
          /^\s*(hi|hello|hey|dear)\b[^\n]{0,80}[,!]?\s*\n+/i,
          "",
        );
        // Remove a "Send this:" prefix temporarily so we can re-add cleanly.
        working = working.replace(/^\s*send this:\s*\n*/i, "").trim();
        // Strip trailing signoff block: a signoff word/phrase followed by optional name lines.
        const signoffRe = new RegExp(
          `\\n+\\s*(thanks|thank\\s+you|best(\\s+regards)?|regards|cheers|sincerely|talk\\s+soon|warmly|kind\\s+regards|all\\s+the\\s+best)\\b[^\\n]{0,40}[,.!]?(\\s*\\n[^\\n]{0,80}){0,2}\\s*$`,
          "i",
        );
        if (signoffRe.test(working)) {
          working = working.replace(signoffRe, "").trim();
          modified = true;
          violations.push("stripped_signoff");
        }
        // Strip trailing em-dash signature like "— Alex" or "-- Alex".
        working = working.replace(/\n+\s*[—–-]{1,2}\s*[^\n]{1,40}\s*$/i, "").trim();
      } else {
        working = working.replace(/^\s*send this:\s*\n*/i, "").trim();
      }

      // 5) Numbered list check on body.
      if (/^\s*\d+[.)]\s/m.test(working)) {
        violations.push("email_contains_numbered_list");
      }

      // 6) Sentence cap: count only the body, then truncate.
      if (intent.sentenceCap) {
        const count = countSentences(working);
        if (count > intent.sentenceCap) {
          const sentences = working.match(/[^.!?]+[.!?]+/g) || [working];
          working = sentences.slice(0, intent.sentenceCap).join(" ").trim();
          modified = true;
          violations.push(`truncated_to_${intent.sentenceCap}_sentences`);
        }
      }

      // 7) Re-assemble: always "Send this:\n<body>" in body-only mode.
      if (!userAskedFullEmail) {
        const reassembled = `Send this:\n${working}`;
        if (reassembled !== text) {
          modified = true;
          if (!violations.some((v) => v.startsWith("truncated_") || v.startsWith("stripped_"))) {
            violations.push("normalized_body_only_format");
          }
        }
        text = reassembled;
      } else {
        // User explicitly wanted subject/greeting/signoff — keep their format.
        text = working;
      }

      // Reference suppress to keep ts happy for unused regex helper.
      void APO_E;
      break;
    }

    case "next_steps": {
      // Physically strip appended email/template blocks BEFORE other checks.
      // Apostrophe class covers ASCII ' and curly ’.  Generic "Here's a/an/the X:"
      // colon-terminated lead-in is also stripped — in next_steps mode any such
      // intro to a second asset is by definition out of mode.
      const APO_NS = "['\u2019]";
      const cutReNS = new RegExp(
        `(^|\\n)\\s*(subject:|hi\\s+\\[?[a-z]|here${APO_NS}?s\\s+(?:a|an|the|some)\\s+\\w+[^\\n]{0,80}:\\s*$|here${APO_NS}?s\\s+(?:a|an|the|some)\\s+(?:template|email|outreach|follow[- ]?up|script|message))`,
        "im",
      );
      const mNS = text.match(cutReNS);
      if (mNS && mNS.index !== undefined && mNS.index > 40) {
        text = text.slice(0, mNS.index).trim();
        modified = true;
        violations.push("stripped_appended_email");
      } else if (/^subject:/im.test(text) || /^hi\s+\[?[a-z]/im.test(text)) {
        violations.push("next_steps_contains_email");
        shouldRegenerate = true;
      }
      // Must contain a numbered list
      if (!/^\s*\d+[.)]\s/m.test(text)) {
        violations.push("next_steps_missing_numbered_list");
      }
      break;
    }

    case "pitch": {
      const APO_P = "['\u2019]";
      const cutReP = new RegExp(
        `\\n\\s*(?:\\d+[.)]\\s|subject:|hi\\s+\\[?[a-z]|here${APO_P}?s\\s+(?:a|an|the|some)\\s+\\w+[^\\n]{0,80}:\\s*$|here${APO_P}?s\\s+(?:a|an|the|some)\\s+(?:template|email|outreach|follow[- ]?up|script|message))`,
        "i",
      );
      const mP = text.match(cutReP);
      if (mP && mP.index !== undefined && mP.index > 40) {
        text = text.slice(0, mP.index).trim();
        modified = true;
        violations.push("stripped_appended_asset");
      }
      // Must lead with "Say this:"
      if (!/^say this:/i.test(text)) {
        if (!/^\s*\d+[.)]\s/m.test(text) && !/^subject:/im.test(text)) {
          text = `Say this: ${text.replace(/^[\s\n]+/, "")}`;
          modified = true;
          violations.push("prepended_say_this");
        } else {
          violations.push("pitch_missing_say_this");
          shouldRegenerate = true;
        }
      }
      // No numbered lists remaining
      if (/^\s*\d+[.)]\s/m.test(text)) {
        violations.push("pitch_contains_list");
        shouldRegenerate = true;
      }
      break;
    }

    case "analysis": {
      // ── ANTI-META GUARD ──
      // Strip provenance/methodology phrases that flatten the thesis into a
      // recap of "where this comes from". The thesis IS the answer; meta
      // commentary about where the thesis came from is forbidden in analysis
      // mode (the user can ask a separate provenance question for that).
      const META_LINE_RES: Array<{ re: RegExp; tag: string }> = [
        { re: /^[^\n]*\bthis (analysis|thesis|assessment|read|take) (comes from|is based on|is informed by|is derived from|draws (on|from)|uses|is grounded in|reflects|is built on)\b[^\n]*\n?/gim, tag: "meta_thesis_basis" },
        { re: /^[^\n]*\b(based on|drawn from|derived from|informed by|pulled from|grounded in|sourced from) (the\s+)?(available|provided|given|limited|current|linked)?\s*(context|account context|thread|prior thread|notes|conversation|uploaded|account data|operator reasoning)\b[^\n]*\n?/gim, tag: "meta_basis_context" },
        { re: /^[^\n]*\bwhere (this|the thesis|the analysis) (comes from|is from|is pulled from)\b[^\n]*\n?/gim, tag: "meta_where_from" },
        { re: /^[^\n]*\b(here'?s how to think about|the way to think about this is|to think about this account)\b[^\n]*\n?/gim, tag: "meta_how_to_think" },
        { re: /^[^\n]*\b(without (more|additional) (information|context|data)|given (the )?limited (context|information|data)|to provide a more accurate)\b[^\n]*\n?/gim, tag: "meta_thin_data_disclaimer" },
        { re: /^[^\n]*\baccording to (the|your) (thread|context|notes|account|prior)\b[^\n]*\n?/gim, tag: "meta_according_to" },
      ];
      let metaHits = 0;
      for (const { re, tag } of META_LINE_RES) {
        const before = text;
        text = text.replace(re, "");
        if (text !== before) {
          metaHits += 1;
          violations.push(`stripped_${tag}`);
        }
      }
      if (metaHits > 0) {
        text = text.replace(/\n{3,}/g, "\n\n").trim();
        modified = true;
        console.log(
          `[mode-lock] analysis_meta_stripped count=${metaHits}`,
        );
      }

      // ── HEDGE / SOFT-LANGUAGE GUARD (ELITE OPERATOR STANDARD) ──
      // Rewrites timid hedge phrases into confident mechanism-driven language.
      // Only the clearest hedge patterns are rewritten so we don't change
      // the substance of a real claim.
      // Broad action-verb list — anything an operator would assert as a
      // mechanism. We force the active "will <verb>" form.
      const HARD_VERBS = "delay|slow|reduce|impact|affect|cause|create|introduce|insert|add|push|risk|require|trigger|force|extend|disrupt|shift|stall|reset|reallocate|kill|lose|strand|erode|displace|block|pause|freeze|deprioritize|drop|slip|miss|jeopardize|threaten|complicate|fragment|undermine|weaken|expose|break|derail";
      const HEDGE_REWRITES: Array<{ re: RegExp; to: string; tag: string }> = [
        { re: new RegExp(`\\bmay\\s+(?:potentially\\s+)?(${HARD_VERBS})\\b`, "gi"), to: "will $1", tag: "hedge_may_will" },
        { re: new RegExp(`\\bmight\\s+(?:potentially\\s+)?(${HARD_VERBS})\\b`, "gi"), to: "will $1", tag: "hedge_might_will" },
        { re: new RegExp(`\\bcould\\s+(?:potentially\\s+)?(${HARD_VERBS})\\b`, "gi"), to: "will $1", tag: "hedge_could_will" },
        // Bare-form fallback for "may/might/could" without a recognised verb —
        // strip the modal so the next verb reads as an assertion.
        { re: /\b(?:may|might|could)\s+(?=[a-z])/gi, to: "will ", tag: "hedge_modal_bare_to_will" },
        // "risks <verb>ing" → "will <verb>" (e.g. "risks losing" → "will lose",
        // "risks pushing" → "will push"). Keeps the verb root, drops the hedge.
        { re: /\brisks?\s+(losing|pushing|delaying|stalling|missing|slipping|breaking|resetting|fragmenting|eroding|exposing|killing|jeopardizing|displacing|deprioritizing|reallocating|extending|disrupting|complicating|undermining)\b/gi, to: (_m: string, v: string) => "will " + v.replace(/ing$/i, (m) => (m === "ing" ? "" : "")), tag: "hedge_risks_verb_ing" } as any,
        // "risk of <noun>ing" / "at risk of" → drop the framing
        { re: /\b(?:there\s+is\s+a\s+)?risk\s+of\s+/gi, to: "will cause ", tag: "hedge_risk_of" },
        { re: /\bat\s+risk\s+of\s+/gi, to: "will ", tag: "hedge_at_risk_of" },
        // Standalone "risks <noun-phrase>" at sentence-mid → "will lose <np>"
        // (we use "lose" as the safest active stand-in for nominal risks like
        // "risks the budget", "risks the renewal", "risks the quarter").
        { re: /\brisks\s+(the\s+(?:budget|renewal|quarter|deal|opportunity|account|champion|contract|window|cycle|close|forecast))\b/gi, to: "will lose $1", tag: "hedge_risks_noun" },
        { re: /\bpotentially\s+/gi, to: "", tag: "hedge_potentially" },
        { re: /\bpossibly\s+/gi, to: "", tag: "hedge_possibly" },
        { re: /\bperhaps\s+/gi, to: "", tag: "hedge_perhaps" },
        { re: /\bit'?s\s+possible\s+that\s+/gi, to: "", tag: "hedge_its_possible" },
        { re: /\bthere'?s\s+a\s+chance\s+(?:that\s+)?/gi, to: "", tag: "hedge_chance" },
        { re: /\bthis\s+suggests\s+that\s+/gi, to: "", tag: "hedge_suggests" },
        { re: /\bthis\s+indicates\s+that\s+/gi, to: "", tag: "hedge_indicates" },
        { re: /\bit'?s\s+worth\s+noting\s+that\s+/gi, to: "", tag: "hedge_worth_noting" },
        { re: /\bin\s+general,?\s+/gi, to: "", tag: "hedge_in_general" },
        { re: /\btends\s+to\s+/gi, to: "will ", tag: "hedge_tends_to" },
        // ── COMMITMENT LAYER: passive / evasive constructions → active ──
        { re: /\bthere\s+is\s+a\s+risk\s+(?:that\s+)?/gi, to: "", tag: "passive_there_is_risk" },
        { re: /\bthere\s+is\s+a\s+possibility\s+(?:that\s+)?/gi, to: "", tag: "passive_there_is_possibility" },
        { re: /\bthis\s+could\s+lead\s+to\s+/gi, to: "this will cause ", tag: "passive_could_lead_to" },
        { re: /\bthis\s+may\s+(?:potentially\s+)?result\s+in\s+/gi, to: "this will cause ", tag: "passive_may_result_in" },
        { re: /\bthis\s+could\s+result\s+in\s+/gi, to: "this will cause ", tag: "passive_could_result_in" },
        { re: /\bthis\s+might\s+cause\s+/gi, to: "this will cause ", tag: "passive_might_cause" },
        { re: /\bthis\s+could\s+create\s+/gi, to: "this will create ", tag: "passive_could_create" },
        { re: /\bit\s+remains\s+to\s+be\s+seen\s+(?:whether\s+|if\s+)?/gi, to: "", tag: "passive_remains_to_be_seen" },
        { re: /\bone\s+possibility\s+is\s+(?:that\s+)?/gi, to: "", tag: "passive_one_possibility" },
        // ── DECISION FORCE LAYER: ban safe-thinking + branching ──
        { re: /\bprobably\s+/gi, to: "", tag: "safe_probably" },
        { re: /\blikely\s+/gi, to: "", tag: "safe_likely" },
        { re: /\bit\s+depends\b\s*(?:on\s+)?/gi, to: "", tag: "safe_depends" },
        { re: /\b(?:you\s+)?should\s+explore\s+/gi, to: "confront ", tag: "safe_should_explore" },
        { re: /\b(?:to\s+)?(?:better\s+)?understand\s+(?:the|whether|if|how)\s+/gi, to: "confirm ", tag: "safe_understand" },
        { re: /\blearn\s+more\s+about\s+/gi, to: "confirm ", tag: "safe_learn_more" },
        { re: /\bon\s+the\s+other\s+hand,?\s+/gi, to: "", tag: "branch_other_hand" },
        { re: /\balternatively,?\s+/gi, to: "", tag: "branch_alternatively" },
        { re: /\bit\s+could\s+also\s+be\s+(?:that\s+)?/gi, to: "", tag: "branch_could_also_be" },
        { re: /\banother\s+possibility\s+is\s+(?:that\s+)?/gi, to: "", tag: "branch_another_possibility" },
      ];
      let hedgeHits = 0;
      for (const { re, to, tag } of HEDGE_REWRITES) {
        const before = text;
        text = text.replace(re, to);
        if (text !== before) {
          hedgeHits += 1;
          violations.push(`stripped_${tag}`);
        }
      }
      if (hedgeHits > 0) {
        text = text
          .replace(/[ \t]{2,}/g, " ")
          .replace(/(^|[\.\?!]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
        modified = true;
        console.log(`[mode-lock] analysis_hedges_rewritten count=${hedgeHits}`);
      }

      // Shape check: must have an Account thesis line. If not, flag for
      // regeneration unless the response is clearly an honest missing-fact
      // ask (already produced by the placeholder guard).
      const hasThesisLabel = /\baccount\s+thesis\s*:/i.test(text);
      const hasLeakageLabel = /\bvalue\s+leakage\s*:/i.test(text);
      const looksLikeAsk = /^I (don'?t|do not) have/i.test(text.trim());
      if (!hasThesisLabel && !looksLikeAsk) {
        violations.push("analysis_missing_thesis_label");
        shouldRegenerate = true;
      } else if (hasThesisLabel && !hasLeakageLabel && !looksLikeAsk) {
        violations.push("analysis_missing_leakage_label");
      }

      // ── DECISION FORCE: branching/multi-thesis detector ──
      // If the model still ships multiple competing scenarios after rewrites,
      // flag for one strict regeneration. We look for residual branching
      // markers OR multiple "Assume X / Or assume Y" patterns inside the
      // Account thesis section.
      const thesisBlock = text.match(/Account thesis:\s*([\s\S]*?)(?:\n\s*Value leakage:|$)/i)?.[1] ?? "";
      const branchMarkers = /\b(or\s+assume|or\s+alternatively|either\s+.{2,40}\s+or\s+|two\s+possibilities|several\s+scenarios|in\s+(?:the\s+)?other\s+case)\b/i;
      if (branchMarkers.test(thesisBlock)) {
        violations.push("analysis_branching_thesis");
        shouldRegenerate = true;
        console.log(`[mode-lock] analysis_branching_thesis detected`);
      }

      // with an honest missing-fact thesis instead of shipping a stub.
      if (text.length < 60) {
        text =
          "Account thesis:\nI don't have enough account-specific facts in this thread to write a real thesis without inventing numbers.\n\nValue leakage:\n- Unknown without the renewal value, named economic buyer, or current usage data.\n\nEconomic consequence:\nI can't size the downside cleanly without one of: ARR, decision date, or current spend. Give me one and I'll quantify it.\n\nNext best discovery action:\nTell me the named buyer and the renewal value (or current ARR) and I'll produce the real thesis.";
        modified = true;
        violations.push("analysis_replaced_with_honest_ask");
        console.log(`[mode-lock] analysis_replaced_with_honest_ask`);
      }
      break;
    }

    case "provenance": {
      // CRITICAL: physically strip any appended asset (email/template/script)
      // BEFORE sentence-cap counting. Provenance must answer the source
      // question only — no second asset, ever.
      // Apostrophe class covers ASCII ' and curly ’.  Generic
      // "Here's a/an/the X:" colon-terminated lead-in is stripped because in
      // provenance mode it always introduces a second asset.
      const APO_PR = "['\u2019]";
      const cutReProv = new RegExp(
        `(^|\\n)\\s*(here${APO_PR}?s\\s+(?:a|an|the|some)\\s+\\w+[^\\n]{0,80}:\\s*$|here${APO_PR}?s\\s+(?:a|an|the|some)\\s+(?:template|email|outreach|follow[- ]?up|script|message)|subject:|hi\\s+\\[?[a-z]|---\\s*$|\`\`\`)`,
        "im",
      );
      const mProv = text.match(cutReProv);
      if (mProv && mProv.index !== undefined && mProv.index > 20) {
        text = text.slice(0, mProv.index).trim();
        modified = true;
        violations.push("stripped_appended_asset");
      } else if (/^subject:/im.test(text) || /^hi\s+\[?[a-z]/im.test(text)) {
        violations.push("provenance_contains_email");
        shouldRegenerate = true;
      }
      const count = countSentences(text);
      if (count > 3) {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        text = sentences.slice(0, 3).join(" ").trim();
        modified = true;
        violations.push("truncated_to_3_sentences");
      }
      break;
    }
  }

  return { text, modified, violations, shouldRegenerate };
}

// ── SUBSTANCE ENFORCER ───────────────────────────────────────
// Runs AFTER mode-lock. Rewrites the response to remove fluff,
// generic phrases, weak verbs, and over-politeness. This is the
// "would a top 1% AE actually send this?" gate.
//
// Strategy: deterministic regex replacements + violation flags.
// We do NOT make a second LLM call — too slow and unreliable. We
// also do not rewrite verbs aggressively because that risks losing
// meaning. Instead we strip the worst offender phrases outright and
// flag the rest so the operator sees the substance score in logs.
interface SubstanceResult {
  text: string;
  modified: boolean;
  violations: string[];
}

// Banned filler/soft-AE phrases. Matched case-insensitively. These
// phrases are deleted (along with surrounding punctuation/spaces).
// Order matters: longer phrases first so they win over shorter ones.
const BANNED_PHRASES: Array<{ pattern: RegExp; tag: string }> = [
  // Opener fluff — also strip a trailing comma + space if present.
  { pattern: /\bI hope (this|the) (email|message|note) finds you well[,.]?\s*/gi, tag: "hope_finds_well" },
  { pattern: /\bI hope (this|that) finds you well[,.]?\s*/gi, tag: "hope_finds_well" },
  { pattern: /\bI hope you('re| are) (doing\s+)?well[,.]?\s*/gi, tag: "hope_doing_well" },
  { pattern: /\bI hope all is well[,.]?\s*/gi, tag: "hope_all_well" },
  { pattern: /\bHope you('re| are) (doing\s+)?well[,.]?\s*/gi, tag: "hope_doing_well" },
  { pattern: /\bHope (this|that) (email|message|note)? ?finds you well[,.]?\s*/gi, tag: "hope_finds_well" },
  // Filler intent verbs.
  { pattern: /\bI (just\s+)?wanted to (reach out|share|let you know|check in|see if|follow up|touch base|circle back)\b[^.!?\n]*[.!?]?/gi, tag: "wanted_to_filler" },
  { pattern: /\bI(?:'m| am) (just\s+)?(reaching out|writing|following up|checking in|circling back|touching base)\b[^.!?\n]*[.!?]?/gi, tag: "reaching_out_filler" },
  { pattern: /\bJust (checking in|circling back|touching base|following up|wanted to (check|ask|share))\b[^.!?\n]*[.!?]?/gi, tag: "just_checking_in" },
  // Closer fluff.
  { pattern: /\b(Please\s+)?(let me know (your thoughts|if (this|that|you|there)|what you think)|happy to (chat|discuss|jump on|hop on|connect|tailor|adjust)|would love to (hear|connect|chat|discuss)|I('?d| would) love to (hear|connect|chat|discuss)|I look forward to hearing (from you|back)|feel free to|at your earliest convenience|kindly\b|warm regards|warmest regards)\b[^.!?\n]*[.!?]?/gi, tag: "closer_fluff" },
  { pattern: /\b(Any\s+)?[Tt]houghts\?\s*$/gm, tag: "thoughts_q" },
];

// Weak-verb / vague-noun flags (no rewrite — we only flag because
// blind verb replacement breaks meaning). Logged to surface drift.
const WEAK_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\b(follow up|circle back|touch base|check in)\b/gi, tag: "weak_verb_followup" },
  { pattern: /\b(your\s+(needs|priorities|goals|challenges|pain points))\b/gi, tag: "vague_noun_needs" },
  { pattern: /\b(assess(ing)?|understand(ing)?|learn more about|explore)\s+(your|their|the)\s+(needs|requirements|situation|environment)\b/gi, tag: "vague_assess" },
  { pattern: /\b(significant\s+(savings|value|improvement|impact)|improved\s+efficiency|streamlin(e|ed|ing)\s+operations|drive\s+(value|outcomes|growth))\b/gi, tag: "vague_value_phrase" },
];

function enforceSubstance(
  rawText: string,
  intent: IntentResult,
): SubstanceResult {
  let text = rawText;
  const violations: string[] = [];
  let modified = false;

  if (!text || !text.trim()) {
    return { text, modified: false, violations: [] };
  }

  // 1) Strip every banned phrase. Track which tags fired.
  for (const { pattern, tag } of BANNED_PHRASES) {
    if (pattern.test(text)) {
      text = text.replace(pattern, "").replace(/  +/g, " ");
      // Fix doubled punctuation introduced by deletions: ".." → ".", " ," → ","
      text = text.replace(/\s+([,.!?])/g, "$1").replace(/([.!?]){2,}/g, "$1");
      modified = true;
      if (!violations.includes(`stripped_${tag}`)) violations.push(`stripped_${tag}`);
    }
  }

  // 2) Tighten dangling whitespace + leading newlines after strips.
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  // If we accidentally left a sentinel followed by blank lines, collapse.
  text = text.replace(/^(Send this:|Say this:|Do this next:|Use this[^\n]*template[^\n]*:)\s*\n\s*\n+/i, "$1\n");

  // 3) Flag weak/vague patterns (no rewrite, just logged).
  for (const { pattern, tag } of WEAK_PATTERNS) {
    if (pattern.test(text)) {
      if (!violations.includes(`flag_${tag}`)) violations.push(`flag_${tag}`);
    }
  }

  // 4) Economic-pressure check for modes that require it.
  const economicRequired =
    intent.intent === "pitch" ||
    intent.intent === "analysis" ||
    intent.isBusinessCase ||
    intent.isCFO ||
    (intent.intent === "next_steps");
  if (economicRequired) {
    const hasMoney = /(\$\s?\d|\d+\s?%|\bROI\b|\bpayback\b|\bcost of (inaction|delay|doing nothing)\b|\bquarter(ly)?\b|\bdeadline\b|\brisk of\b|\bbudget\b|\b(margin|retention|churn|velocity)\b)/i.test(text);
    if (!hasMoney) {
      violations.push("missing_economic_anchor");
    }
  }

  return { text, modified, violations };
}


function buildGenericChatSystemPrompt(
  depth: string,
  contextSection: string,
  modeLockBlock?: string,
): string {
  const lockPrefix = modeLockBlock ? `${modeLockBlock}\n\n` : "";
  return `${lockPrefix}You are a high-performance sales operator embedded in the rep's Strategy workspace. You produce work the rep can copy and use right now.

═══ ELITE OPERATOR CONTRACT ═══
Every response MUST follow this shape:
1. DIRECT ANSWER on the first line — give the thing they asked for, no setup.
2. USABLE OUTPUT — a template, script, message, rewrite, plan, or bullets. Copy/paste ready. Specific, never abstract.
3. OPTIONAL UPGRADE — end with a single line offering to tailor it (e.g. "Want me to tailor this for [account]?"). Skip when irrelevant.

═══ HARD RULES ═══
- The MODE LOCK above is binding. If your draft doesn't match the locked mode, rewrite it before sending.
- Never explain how you work, your reasoning process, or what you're about to do.
- Never introduce yourself or restate the question.
- Never ask for "more context" if you have account/thread context — use it silently.
- Never lead with frameworks, caveats, or "it depends".
- Never say: "I will…", "My response will…", "Here's how to think about…", "Based on the context provided…", "It depends…".
- Never write more than necessary before delivering value. First useful output within 1–2 sentences.
- When you use linked account/upload/memory context, weave the facts in directly. Do NOT announce the source.
- Never default to writing an email when the user asked for a template, plan, next steps, or analysis.

═══ STYLE ═══
- Talk like a senior operator: terse, specific, opinionated.
- Use the user's words and the account's real details.
- If they ask "what should I say" → give the exact words.
- If they ask "what should I do" → give numbered steps.
- If they ask for a template → give the template, no commentary.

Depth: ${depth || "Standard"}.${
    depth === "Fast"
      ? " Cut everything optional."
      : depth === "Deep"
      ? " You may add one short follow-up paragraph after the usable output if it materially helps."
      : ""
  }
${contextSection}`;
}

async function buildChatSystemPrompt(args: {
  supabase: any;
  userId: string;
  threadId: string;
  depth: string;
  contextSection: string;
  pack: ContextPack;
  userContent: string;
  /** Sidecar: resource IDs the user explicitly picked from /library this turn. */
  pickedResourceIds?: string[];
}): Promise<{
  prompt: string;
  workingThesis: WorkingThesisState | null;
  resourceHits: Array<{ id: string; title: string }>;
  intent: IntentResult;
  modeLockBlock: string;
}> {
  const {
    supabase,
    userId,
    threadId,
    depth,
    contextSection,
    pack,
    userContent,
    pickedResourceIds = [],
  } = args;
  const accountId: string | null = pack.account?.id ?? null;
  const opportunityId: string | null = pack.opportunity?.id ?? null;

  // Classify the user's intent up front so every prompt path receives
  // a binding MODE LOCK block. This is the single biggest lever against
  // the production drift pattern (e.g. asking for a template and getting
  // an email back).
  const intent = classifyChatIntent(userContent, {
    hasAccountContext: !!accountId || (!!contextSection && contextSection.length >= 200),
  });
  const modeLockBlock = buildModeLockBlock(intent);

  // No account, no thread context → don't force Strategy Core onto small talk.
  // EXCEPTION: when the user explicitly picked a library resource this turn
  // (sidecar pickedResourceIds), we MUST run the resource pipeline so the
  // assistant grounds in that resource — even on a freeform thread.
  if (!accountId && (!contextSection || contextSection.length < 200) && pickedResourceIds.length === 0) {
    return {
      prompt: buildGenericChatSystemPrompt(depth, contextSection, modeLockBlock),
      workingThesis: null,
      resourceHits: [],
      intent,
      modeLockBlock,
    };
  }

  // Pull the same context the prep doc gets, in parallel with library
  // retrieval AND the working thesis state for this account AND the
  // newly-added resource retrieval (exact / near-exact title + entity
  // links + category backstop).
  const scopes = deriveLibraryScopes(pack.account, userContent);
  const [assembled, library, workingThesis, resources] = await Promise.all([
    accountId
      ? assembleStrategyContext({ supabase, userId, accountId }).catch((e) => {
        console.warn(
          "[strategy-chat] assembleStrategyContext failed:",
          (e as Error).message,
        );
        return null;
      })
      : Promise.resolve(null),
    scopes.length
      ? retrieveLibraryContext(supabase, userId, {} as any, {
        scopes,
        maxKIs: 8,
        maxPlaybooks: 4,
      }).catch(
        (e) => {
          console.warn(
            "[strategy-chat] retrieveLibraryContext failed:",
            (e as Error).message,
          );
          return null;
        },
      )
      : Promise.resolve(null),
    accountId
      ? loadWorkingThesisState(supabase, { userId, accountId }).catch((e) => {
        console.warn(
          "[strategy-chat] loadWorkingThesisState failed:",
          (e as Error).message,
        );
        return null;
      })
      : Promise.resolve(null),
    retrieveResourceContext(supabase, userId, {
      userMessage: userContent,
      accountId,
      opportunityId,
      threadId,
      pickedResourceIds,
    }).catch((e) => {
      console.warn(
        "[strategy-chat] retrieveResourceContext failed:",
        (e as Error).message,
      );
      return null;
    }),
  ]);

  // Force Strategy Core whenever the user asked for a named resource —
  // even on otherwise-small contexts — so the admit-absence contract
  // is enforced instead of being lost to the generic prompt path.
  const useCore = shouldUseStrategyCorePrompt({
    hasAccount: !!accountId,
    libraryCounts: library?.counts,
    contextSectionLength: contextSection?.length ?? 0,
  }) || !!resources?.userAskedForResource || pickedResourceIds.length > 0;

  if (!useCore) {
    return {
      prompt: buildGenericChatSystemPrompt(depth, contextSection, modeLockBlock),
      workingThesis: null,
      resourceHits: [],
      intent,
      modeLockBlock,
    };
  }

  const workingThesisBlock = renderWorkingThesisStateBlock(workingThesis);

  // Behavior contract for the model: emit a fenced thesis_update JSON
  // block at the END of the answer when the thesis materially changed.
  // This is the seam between assistant prose and persisted state.
  const persistenceContract = `
=== THESIS STATE PERSISTENCE PROTOCOL ===
If, and ONLY if, this turn materially advances the working thesis (new evidence, killed hypothesis, refined leakage, resolved/added open question, or a new thesis), append a single fenced block at the very end of your message in this exact format:

\`\`\`thesis_update
{
  "current_thesis": "<only when the thesis itself changed>",
  "current_leakage": "<only when leakage was refined>",
  "confidence": "VALID|INFER|HYPO|UNKN",
  "thesis_change_reason": "<required when current_thesis changed: the seller statement / fact that drove the change>",
  "seller_confirmed": <true ONLY when this update is grounded in the seller's own words this turn, a transcript citation, or a retrieved KI/Playbook. false (or omit) when this is your own pattern-matching>,
  "revive_hypothesis_reason": "<required ONLY when current_thesis matches a previously killed hypothesis: the new evidence that revives it>",
  "kill_hypotheses": [{ "hypothesis": "<exact prior claim>", "killed_by": "<seller-provided fact>" }],
  "add_evidence": ["<short factual statement, prefer numeric specifics from the seller>"],
  "add_open_questions": ["<question>"],
  "resolve_open_questions": ["<question text that's now answered>"]
}
\`\`\`

TRUST RULES (enforced server-side — pretending will be downgraded):
- Set confidence="VALID" only when seller_confirmed=true OR you are adding new evidence the seller stated this turn.
- Any thesis or leakage with a number ($, %, "X points", "Nx") needs the supporting number in add_evidence and seller_confirmed=true to stay VALID. Otherwise it will be capped at INFER.
- A current_thesis matching a previously killed hypothesis will be DROPPED unless revive_hypothesis_reason + seller_confirmed are both present.
- Empty current_thesis cannot overwrite a non-empty prior thesis.

Omit any field that does not apply. If nothing changed materially, do NOT emit the block.
The block is for system memory — be terse and factual. Do not narrate it.`;

  const composedCorePrompt = buildStrategyChatSystemPrompt({
    depth,
    contextSection,
    accountContext: assembled?.contextBlock || "",
    libraryContext: library?.contextString || "",
    workingThesisBlock,
    resourceContextBlock: resources?.contextBlock || "",
  });

  // Prepend the MODE LOCK so it's the FIRST thing the model reads,
  // before Strategy Core identity / thinking order / output contract.
  // This binds asset-type selection regardless of how rich the rest of
  // the system prompt becomes.
  const prompt = `${modeLockBlock}\n\n${composedCorePrompt}\n\n${persistenceContract}`;

  const resourceHits = (resources?.hits || []).map((h) => ({
    id: h.id,
    title: h.title,
  }));
  return { prompt, workingThesis, resourceHits, intent, modeLockBlock };
}

// Extract a fenced ```thesis_update { ... }``` block emitted by the
// assistant. Returns the parsed patch + the cleaned visible text
// (with the block removed so the user never sees it).
function extractThesisUpdate(
  text: string,
): { patch: ThesisStatePatch | null; visible: string } {
  if (!text) return { patch: null, visible: text };
  const re = /```thesis_update\s*\n([\s\S]*?)\n```/i;
  const m = text.match(re);
  if (!m) return { patch: null, visible: text };
  const visible = (text.slice(0, m.index!) + text.slice(m.index! + m[0].length))
    .trim();
  try {
    const parsed = JSON.parse(m[1].trim());
    if (parsed && typeof parsed === "object") {
      return { patch: parsed as ThesisStatePatch, visible };
    }
  } catch (e) {
    console.warn("[thesis_update] failed to parse:", (e as Error).message);
  }
  return { patch: null, visible };
}

// ── Chat Handler (streaming via OpenAI direct) ────────────
async function handleChat(
  supabase: any,
  threadId: string,
  userId: string,
  content: string,
  depth: string,
  contextSection: string,
  pack: ContextPack,
  forceFallback?: boolean,
  pickedResourceIds: string[] = [],
) {
  await supabase.from("strategy_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "user",
    message_type: "chat",
    content_json: { text: content },
  });

  const route = resolveLLMRoute("chat_general");
  if (forceFallback) route._smokeTestForceFail = true;

  const {
    prompt: systemPrompt,
    workingThesis: priorThesis,
    resourceHits,
    intent,
  } = await buildChatSystemPrompt({
    supabase,
    userId,
    threadId,
    depth,
    contextSection,
    pack,
    userContent: content,
    pickedResourceIds,
  });
  const accountId: string | null = pack.account?.id ?? null;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...pack.recentMessages.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.text,
    })),
  ];

  const startTime = Date.now();
  const result = await callStreaming("chat_general", {
    messages,
    temperature: route.temperature,
    maxTokens: route.maxTokens,
  }, route);

  if (result.error) {
    return new Response(
      JSON.stringify({
        error: "Assistant temporarily unavailable",
        errorType: result.error.type,
        model: route.model,
        route: "openai-direct",
      }),
      {
        status: result.error.status ??
          (result.error.type === "timeout" ? 504 : 502),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (!result.rawStream) {
    // Non-streaming fallback
    const { patch, visible: rawVisible } = extractThesisUpdate(result.text || "");
    // Mode-lock guard FIRST — strip drift / forbidden tail / hard-truncate.
    const guarded = enforceModeLock(rawVisible, intent);
    if (guarded.modified || guarded.violations.length) {
      console.log(
        `[mode-lock] non-stream intent=${intent.intent} violations=${
          JSON.stringify(guarded.violations)
        } modified=${guarded.modified}`,
      );
    }
    // Substance enforcer SECOND — strip filler/banned phrases, flag weak verbs.
    const subst = enforceSubstance(guarded.text, intent);
    if (subst.modified || subst.violations.length) {
      console.log(
        `[substance] non-stream intent=${intent.intent} violations=${
          JSON.stringify(subst.violations)
        } modified=${subst.modified}`,
      );
    }
    const visible = subst.text;
    // Citation audit: catch any fabricated RESOURCE[…] references.
    // Closed-set mode is enabled when the user picked a resource via
    // /library — this prevents adjacent-variant hallucinations
    // (e.g. "Q3" when they picked "Q2").
    const audit = auditResourceCitations(visible, resourceHits, {
      closedSet: pickedResourceIds.length > 0,
    });
    if (audit.modified) {
      console.log(
        `[citation-audit] non-stream: ${audit.unverifiedCitations.length} unverified citation(s) flagged${pickedResourceIds.length > 0 ? " (closed-set)" : ""}`,
      );
    }
    const auditedVisible = audit.text;
    await supabase.from("strategy_messages").insert({
      thread_id: threadId,
      user_id: userId,
      role: "assistant",
      message_type: "chat",
      provider_used: result.provider,
      model_used: result.model,
      fallback_used: result.fallbackUsed,
      latency_ms: result.latencyMs,
      content_json: {
        text: auditedVisible,
        sources_used: pack.sourceCount,
        retrieval_meta: pack.retrievalMeta,
        model_used: result.model,
        provider_used: result.provider,
        fallback_used: result.fallbackUsed,
        citation_audit: audit.modified
          ? {
            modified: true,
            unverified: audit.unverifiedCitations,
            verified: audit.verifiedTitles,
          }
          : undefined,
      },
    });
    // Cross-thread resource memory: persist VERIFIED citations only.
    // This is the write side of strategy_thread_resources — what makes
    // "use the same resource we used last time on this account" work
    // on the next turn. Never write fabricated/UNVERIFIED titles.
    try {
      const verifiedNorm = new Set(
        audit.verifiedTitles.map((t) =>
          t.toLowerCase().replace(/\s+/g, " ").trim()
        ),
      );
      const verifiedIds = resourceHits
        .filter((h) =>
          verifiedNorm.has(h.title.toLowerCase().replace(/\s+/g, " ").trim())
        )
        .map((h) => h.id);
      if (verifiedIds.length > 0) {
        const { inserted } = await recordResourceUsage(supabase, {
          userId,
          threadId,
          resourceIds: verifiedIds,
          sourceType: "cited",
        });
        if (inserted > 0) {
          console.log(
            `[resource-usage] non-stream: persisted ${inserted} cited resource(s)`,
          );
        }
      }
    } catch (e) {
      console.warn(
        "[resource-usage] non-stream persist failed:",
        (e as Error).message,
      );
    }
    if (accountId) {
      // Primary path: fenced thesis_update block.
      // Fallback path: deterministic prose extraction (only when the
      // fenced block was missing or unparsable). Saving nothing is
      // better than saving weak state — extractor returns null on
      // ambiguous prose.
      let effectivePatch: ThesisStatePatch | null = patch;
      let patchSource: "fenced" | "fallback" = "fenced";
      if (!effectivePatch) {
        const inferred = extractThesisPatchFromProse(visible);
        if (inferred) {
          effectivePatch = inferred;
          patchSource = "fallback";
          console.log(
            "[thesis] fallback extractor inferred patch (non-stream)",
          );
        }
      }
      if (effectivePatch) {
        try {
          const base = priorThesis ??
            emptyWorkingThesisState(accountId, threadId);
          const { patch: safe, downgrades } = validateWorkingThesisState(base, {
            ...effectivePatch,
            thread_id: threadId,
          });
          if (downgrades.length) {
            console.log(
              `[thesis] validator downgrades (non-stream, ${patchSource}):`,
              downgrades,
            );
          }
          const next = mergeWorkingThesisState(base, safe);
          await saveWorkingThesisState(supabase, { userId, state: next });
        } catch (e) {
          console.warn(
            "[thesis] persist (non-stream) failed:",
            (e as Error).message,
          );
        }
      }
    }
    return new Response(
      JSON.stringify({
        text: auditedVisible,
        provider: result.provider,
        model: result.model,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Stream the response with read timeout protection.
  // IMPORTANT: We do NOT pass-through model chunks anymore. Mode-lock
  // enforcement requires us to see the full response before deciding
  // whether to truncate / strip drift. We buffer server-side, then
  // emit the GUARDED text as a single SSE event. This sacrifices
  // token-by-token streaming for behavioral correctness — explicitly
  // required by the mode-lock contract.
  const reader = result.rawStream.body!.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";
  let chunkCount = 0;
  let sseBuffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      const streamDeadline = Date.now() + 120000; // 2min max stream duration
      try {
        while (true) {
          if (Date.now() > streamDeadline) {
            console.warn(
              `[streaming] read deadline exceeded after ${chunkCount} chunks, closing`,
            );
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          chunkCount++;
          sseBuffer += decoder.decode(value, { stream: true });
          // Parse complete SSE lines into deltas. We do NOT enqueue
          // anything to the client during this loop.
          let nl: number;
          while ((nl = sseBuffer.indexOf("\n")) !== -1) {
            let line = sseBuffer.slice(0, nl);
            sseBuffer = sseBuffer.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) fullResponse += delta;
            } catch {
              // Re-buffer partial JSON for next chunk
              sseBuffer = line + "\n" + sseBuffer;
              break;
            }
          }
        }

        const latency = Date.now() - startTime;
        if (!fullResponse.trim()) {
          console.warn(
            `[streaming] empty response after ${chunkCount} chunks, ${latency}ms`,
          );
        }

        // Step 1: extract thesis update + visible body.
        const { patch, visible: rawVisible } = extractThesisUpdate(fullResponse);

        // Step 2: MODE-LOCK GUARD — strip forbidden tails, truncate
        // sentence-cap violations, prepend missing sentinels. This
        // happens BEFORE the user sees a single character.
        const guarded = enforceModeLock(rawVisible, intent);
        if (guarded.modified || guarded.violations.length) {
          console.log(
            `[mode-lock] stream intent=${intent.intent} violations=${
              JSON.stringify(guarded.violations)
            } modified=${guarded.modified}`,
          );
        }
        // Step 2b: SUBSTANCE ENFORCER — strip filler/banned phrases.
        const subst = enforceSubstance(guarded.text, intent);
        if (subst.modified || subst.violations.length) {
          console.log(
            `[substance] stream intent=${intent.intent} violations=${
              JSON.stringify(subst.violations)
            } modified=${subst.modified}`,
          );
        }
        const visible = subst.text;

        // Step 3: citation audit on the GUARDED text (so banner
        // attaches to the same body that's persisted). Closed-set
        // mode prevents adjacent-variant hallucinations when the
        // user picked a resource via /library.
        const audit = auditResourceCitations(visible, resourceHits, {
          closedSet: pickedResourceIds.length > 0,
        });
        if (audit.modified) {
          console.log(
            `[citation-audit] stream: ${audit.unverifiedCitations.length} unverified citation(s) flagged${pickedResourceIds.length > 0 ? " (closed-set)" : ""}`,
          );
        }
        const auditedVisible = audit.text;

        // Step 4: emit the entire guarded+audited text in ONE SSE
        // delta, then [DONE]. Client renders this atomically — no
        // first-token-drop risk.
        const sseChunk = `data: ${
          JSON.stringify({ choices: [{ delta: { content: auditedVisible } }] })
        }\n\ndata: [DONE]\n\n`;
        controller.enqueue(new TextEncoder().encode(sseChunk));
        controller.close();
        await supabase.from("strategy_messages").insert({
          thread_id: threadId,
          user_id: userId,
          role: "assistant",
          message_type: "chat",
          provider_used: result.provider,
          model_used: result.model,
          fallback_used: false,
          latency_ms: latency,
          content_json: {
            text: auditedVisible,
            sources_used: pack.sourceCount,
            retrieval_meta: pack.retrievalMeta,
            model_used: result.model,
            provider_used: result.provider,
            fallback_used: false,
            citation_audit: audit.modified
              ? {
                modified: true,
                unverified: audit.unverifiedCitations,
                verified: audit.verifiedTitles,
              }
              : undefined,
          },
        });
        await supabase.from("strategy_threads").update({
          updated_at: new Date().toISOString(),
        }).eq("id", threadId);

        // Cross-thread resource memory: persist VERIFIED citations only.
        try {
          const verifiedNorm = new Set(
            audit.verifiedTitles.map((t) =>
              t.toLowerCase().replace(/\s+/g, " ").trim()
            ),
          );
          const verifiedIds = resourceHits
            .filter((h) =>
              verifiedNorm.has(
                h.title.toLowerCase().replace(/\s+/g, " ").trim(),
              )
            )
            .map((h) => h.id);
          if (verifiedIds.length > 0) {
            const { inserted } = await recordResourceUsage(supabase, {
              userId,
              threadId,
              resourceIds: verifiedIds,
              sourceType: "cited",
            });
            if (inserted > 0) {
              console.log(
                `[resource-usage] stream: persisted ${inserted} cited resource(s)`,
              );
            }
          }
        } catch (e) {
          console.warn(
            "[resource-usage] stream persist failed:",
            (e as Error).message,
          );
        }

        // Persist working thesis state.
        // Primary path: fenced thesis_update block (preferred).
        // Fallback path: deterministic prose extraction when the model
        // forgot the fenced block. Validator still gates everything.
        if (accountId) {
          let effectivePatch: ThesisStatePatch | null = patch;
          let patchSource: "fenced" | "fallback" = "fenced";
          if (!effectivePatch) {
            const inferred = extractThesisPatchFromProse(visible);
            if (inferred) {
              effectivePatch = inferred;
              patchSource = "fallback";
              console.log(
                "[thesis] fallback extractor inferred patch (stream)",
              );
            }
          }
          if (effectivePatch) {
            try {
              const base = priorThesis ??
                emptyWorkingThesisState(accountId, threadId);
              const { patch: safe, downgrades } = validateWorkingThesisState(
                base,
                { ...effectivePatch, thread_id: threadId },
              );
              if (downgrades.length) {
                console.log(
                  `[thesis] validator downgrades (stream, ${patchSource}):`,
                  downgrades,
                );
              }
              const next = mergeWorkingThesisState(base, safe);
              await saveWorkingThesisState(supabase, { userId, state: next });
            } catch (e) {
              console.warn(
                "[thesis] persist (stream) failed:",
                (e as Error).message,
              );
            }
          }
        }

        const { count } = await supabase.from("strategy_messages")
          .select("id", { count: "exact", head: true }).eq(
            "thread_id",
            threadId,
          );
        if (count && count % 8 === 0) {
          console.log(`[auto-rollup] triggering at ${count} messages`);
          triggerRollupAsync(supabase, threadId, userId);
        }
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

// ── Workflow Handler ──────────────────────────────────────
async function handleWorkflow(
  supabase: any,
  threadId: string,
  userId: string,
  workflowType: string,
  content: string,
  contextSection: string,
  pack: ContextPack,
  forceFallback?: boolean,
) {
  const route = resolveLLMRoute(workflowType);
  if (forceFallback) route._smokeTestForceFail = true;
  const tool = WORKFLOW_TOOLS[workflowType];

  const { data: run, error: runErr } = await supabase.from(
    "strategy_workflow_runs",
  )
    .insert({
      user_id: userId,
      thread_id: threadId,
      workflow_type: workflowType,
      status: "running",
      input_json: { content, workflowType },
    })
    .select().single();
  if (runErr) throw runErr;

  await supabase.from("strategy_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "system",
    message_type: "workflow_update",
    content_json: {
      text: `Running ${workflowType.replace(/_/g, " ")}…`,
      workflowType,
      runId: run.id,
    },
  });

  const workflowPrompts: Record<string, string> = {
    deep_research:
      "Conduct deep research on the linked account or topic. Analyze business, industry trends, competitive landscape, technology stack, key stakeholders, and potential pain points. Use all available context including account memory and uploaded resources.",
    account_plan:
      "Create a comprehensive account plan including executive summary, stakeholder map, strategic objectives, action plan, risks, and success metrics.",
    territory_tiering:
      "Analyze and tier accounts in the territory by ICP fit, revenue potential, engagement level, competitive position, and timing signals.",
    email_evaluation:
      "Evaluate the provided email or messaging for subject line, opening, value prop, CTA strength, tone, and personalization. Provide scored assessment and rewrite.",
    opportunity_strategy:
      "Build an opportunity strategy covering deal summary, decision process, champion status, competition, value alignment, risks, next actions, and close plan.",
    brainstorm:
      "Facilitate a strategic brainstorm. Generate creative ideas, challenge assumptions, identify non-obvious angles.",
  };

  const systemPrompt =
    `You are a strategic sales advisor. Use the context below to produce a thorough, grounded analysis.
${contextSection}

${workflowPrompts[workflowType] || workflowPrompts.brainstorm}

You MUST call the provided tool function with your structured result.`;

  const userPrompt = content ||
    `Execute ${
      workflowType.replace(/_/g, " ")
    } workflow based on available context.`;

  const adapterReq: Omit<AdapterRequest, "model"> = {
    messages: [{ role: "system", content: systemPrompt }, {
      role: "user",
      content: userPrompt,
    }],
    temperature: route.temperature,
    maxTokens: route.maxTokens,
  };
  if (tool && route.primaryProvider !== "perplexity") {
    adapterReq.tools = [tool];
    adapterReq.toolChoice = {
      type: "function",
      function: { name: tool.function.name },
    };
  }
  if (route.reasoning) adapterReq.reasoning = route.reasoning;

  console.log(
    `[workflow] ${workflowType} provider=${route.primaryProvider} model=${route.model}`,
  );

  const result = await callWithFallback(workflowType, adapterReq, route);

  if (result.error) {
    await supabase.from("strategy_workflow_runs").update({
      status: "failed",
      error_json: { error: result.error.message },
    }).eq("id", run.id);
    const status = result.error.type === "timeout"
      ? 504
      : result.error.type.includes("429")
      ? 429
      : result.error.type.includes("402")
      ? 402
      : 500;
    return new Response(JSON.stringify({ error: result.error.message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let structuredData = result.structured;
  let renderedText = "";

  if (!structuredData && workflowType === "deep_research" && result.text) {
    structuredData = {
      summary: result.text.slice(0, 500),
      company_overview: "",
      key_findings: result.text.split("\n").filter((l: string) =>
        l.trim().startsWith("-") || l.trim().startsWith("•")
      ).map((l: string) => l.replace(/^[-•]\s*/, "").trim()).slice(0, 10),
      strategic_implications: [],
      risks: [],
      opportunities: [],
      recommended_actions: [],
      cited_sources: result.citations || [],
    };
  }

  if (structuredData) {
    renderedText = renderStructuredOutput(workflowType, structuredData);
  } else {
    renderedText = result.text || "No result generated.";
    structuredData = { text: renderedText };
  }

  await supabase.from("strategy_workflow_runs").update({
    status: "completed",
    result_json: structuredData,
  }).eq("id", run.id);

  let outputTitle = `${workflowType.replace(/_/g, " ")}`;
  if (pack.account) outputTitle = `${pack.account.name} — ${outputTitle}`;
  else if (pack.opportunity) {
    outputTitle = `${pack.opportunity.name} — ${outputTitle}`;
  }
  outputTitle += ` — ${new Date().toLocaleDateString()}`;

  const { data: output } = await supabase.from("strategy_outputs").insert({
    user_id: userId,
    thread_id: threadId,
    workflow_run_id: run.id,
    output_type: workflowTypeToOutputType(workflowType),
    title: outputTitle,
    content_json: structuredData,
    rendered_text: renderedText,
    linked_account_id: pack.account?.id || null,
    linked_opportunity_id: pack.opportunity?.id || null,
    provider_used: result.provider,
    model_used: result.model,
    fallback_used: result.fallbackUsed,
    latency_ms: result.latencyMs,
  }).select().single();

  const { data: resultMsg } = await supabase.from("strategy_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "assistant",
    message_type: "workflow_result",
    provider_used: result.provider,
    model_used: result.model,
    fallback_used: result.fallbackUsed,
    latency_ms: result.latencyMs,
    content_json: {
      text: renderedText,
      structured: structuredData,
      workflowType,
      runId: run.id,
      outputId: output?.id || null,
      sources_used: pack.sourceCount,
      retrieval_meta: pack.retrievalMeta,
      model_used: result.model,
      provider_used: result.provider,
      fallback_used: result.fallbackUsed,
      citations: result.citations,
    },
  }).select().single();

  await supabase.from("strategy_threads").update({
    updated_at: new Date().toISOString(),
    summary: (structuredData.summary || structuredData.executive_summary ||
      renderedText || "").slice(0, 200),
  }).eq("id", threadId);

  console.log(
    `[workflow] ${workflowType} completed. provider=${result.provider} model=${result.model} fallback=${result.fallbackUsed} latency=${result.latencyMs}ms output=${output?.id}`,
  );
  triggerRollupAsync(supabase, threadId, userId);

  return new Response(
    JSON.stringify({
      resultMessage: resultMsg,
      output,
      workflowRun: run,
      structured: structuredData,
      sourceCount: pack.sourceCount,
      retrievalMeta: pack.retrievalMeta,
      modelUsed: result.model,
      providerUsed: result.provider,
      fallbackUsed: result.fallbackUsed,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── Rollup Handler ────────────────────────────────────────
async function handleRollup(
  supabase: any,
  threadId: string,
  userId: string,
  pack?: ContextPack,
) {
  if (!pack) pack = await buildContextPack(supabase, threadId, userId);
  if (pack.recentMessages.length < 3) {
    return new Response(
      JSON.stringify({ rollup: null, reason: "Not enough messages" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const conversationText = pack.recentMessages.map((m) =>
    `${m.role}: ${m.text}`
  ).join("\n").slice(0, 8000);
  let memoryContext = "";
  if (pack.memories.length > 0) {
    memoryContext = "\n\nExisting memory (avoid duplicating):\n" +
      pack.memories.slice(0, 10).map((m) =>
        `- [${m.memory_type}] ${m.content.slice(0, 100)}`
      ).join("\n");
  }

  const route = resolveLLMRoute("rollup");
  const result = await callWithFallback("rollup", {
    messages: [
      {
        role: "system",
        content:
          `You are analyzing a strategy conversation thread. Summarize the key points, identify hypotheses, risks, open questions, and next steps. Also suggest memory entries that should be saved. Only suggest memories with confidence >= 0.6. Do NOT suggest memories that duplicate existing ones.${memoryContext}`,
      },
      { role: "user", content: conversationText },
    ],
    tools: [ROLLUP_TOOL],
    toolChoice: { type: "function", function: { name: "generate_rollup" } },
    temperature: 0.3,
  }, route);

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error.message }), {
      status: result.error.type === "timeout" ? 504 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let rollup = result.structured;
  if (rollup) {
    rollup.updated_at = new Date().toISOString();
    rollup.provider_used = result.provider;
    rollup.model_used = result.model;

    if (rollup.memory_suggestions) {
      const existingContents = new Set(
        pack.memories.map((m: any) => m.content.toLowerCase().trim()),
      );
      rollup.memory_suggestions = rollup.memory_suggestions
        .filter((s: any) => (s.confidence ?? 0) >= 0.6)
        .filter((s: any) => {
          const normalized = s.content.toLowerCase().trim();
          for (const existing of existingContents) {
            if (
              existing.includes(normalized) || normalized.includes(existing)
            ) return false;
          }
          return true;
        });
    }

    await supabase.from("strategy_threads").update({
      latest_rollup: rollup,
      updated_at: new Date().toISOString(),
    }).eq("id", threadId);
    await supabase.from("strategy_rollups").insert({
      object_type: "thread",
      object_id: threadId,
      rollup_type: "summary",
      content_json: rollup,
      generated_from_thread_ids: [threadId],
      user_id: userId,
    });
    console.log(
      `[rollup] saved. provider=${result.provider} suggestions=${
        rollup.memory_suggestions?.length || 0
      }`,
    );
  }

  return new Response(JSON.stringify({ rollup }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function triggerRollupAsync(supabase: any, threadId: string, userId: string) {
  handleRollup(supabase, threadId, userId).catch((e) =>
    console.error("[auto-rollup] failed:", e)
  );
}
