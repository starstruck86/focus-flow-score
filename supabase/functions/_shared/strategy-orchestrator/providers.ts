// ════════════════════════════════════════════════════════════════
// Multi-LLM provider adapters (Perplexity, OpenAI, Claude).
//
// MODEL POLICY: Gemini / Lovable AI Gateway are explicitly NOT part
// of the Strategy execution path. The previously-exported
// `callLovableAI` adapter has been removed to prevent any code in
// this workflow from accidentally routing through Gemini.
// Same adapter pattern shared across all Strategy tasks.
//
// Phase 4A: All provider calls now return a ProviderCallResult with
// token usage metadata. Original string-return signatures preserved
// via the existing exports; instrumented versions available via
// *WithUsage variants.
//
// Phase 4G-1: All error paths now capture structured failure metadata
// via providerFailureClassifier. Failures are classified, logged with
// full payload metadata, and wrapped in ProviderError for upstream
// telemetry persistence.
// ════════════════════════════════════════════════════════════════

import type { ProviderUsage } from "./telemetryWriter.ts";
import {
  buildCallMetadata,
  buildFailureRecord,
  logProviderFailure,
  ProviderError,
} from "./providerFailureClassifier.ts";

/** Thread-local context for failure attribution. Set by sectionAuthor
 *  before each batch call so provider errors carry stage/batch/run. */
export const _providerCallContext: {
  stage: string;
  batchIndex: number | null;
  taskType: string;
  runId: string;
} = { stage: "unknown", batchIndex: null, taskType: "unknown", runId: "unknown" };

export function setProviderCallContext(ctx: {
  stage?: string;
  batchIndex?: number | null;
  taskType?: string;
  runId?: string;
}): void {
  if (ctx.stage !== undefined) _providerCallContext.stage = ctx.stage;
  if (ctx.batchIndex !== undefined) _providerCallContext.batchIndex = ctx.batchIndex;
  if (ctx.taskType !== undefined) _providerCallContext.taskType = ctx.taskType;
  if (ctx.runId !== undefined) _providerCallContext.runId = ctx.runId;
}

/** Enriched provider call result with usage metadata. */
export interface ProviderCallResult {
  text: string;
  citations?: string[];
  usage: ProviderUsage;
  provider: "perplexity" | "openai" | "anthropic" | "lovable-ai";
  model: string;
  duration_ms: number;
}

export async function callPerplexityWithUsage(
  messages: { role: string; content: string }[],
  opts: { model?: string; maxTokens?: number } = {},
): Promise<ProviderCallResult> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) throw new Error("PERPLEXITY_API_KEY not configured");
  const model = opts.model || "sonar-pro";
  const startMs = Date.now();

  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: opts.maxTokens || 8192,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const callMeta = buildCallMetadata({
      provider: "perplexity", model, messages,
      maxTokens: opts.maxTokens, stage: _providerCallContext.stage,
      batchIndex: _providerCallContext.batchIndex, taskType: _providerCallContext.taskType,
      runId: _providerCallContext.runId,
    });
    const failure = buildFailureRecord({ httpStatus: resp.status, errorBody: errText, errorMessage: `Perplexity error: ${resp.status}`, callMetadata: callMeta });
    logProviderFailure(failure);
    throw new ProviderError(`Perplexity error: ${resp.status}`, failure);
  }
  const data = await resp.json();
  const usage = data.usage ?? {};
  return {
    text: data.choices?.[0]?.message?.content || "",
    citations: data.citations || [],
    usage: {
      input_tokens: usage.prompt_tokens ?? undefined,
      output_tokens: usage.completion_tokens ?? undefined,
      total_tokens: usage.total_tokens ?? undefined,
    },
    provider: "perplexity",
    model,
    duration_ms: Date.now() - startMs,
  };
}

export async function callPerplexity(
  messages: { role: string; content: string }[],
  opts: { model?: string; maxTokens?: number } = {},
): Promise<{ text: string; citations: string[] }> {
  const result = await callPerplexityWithUsage(messages, opts);
  return { text: result.text, citations: result.citations || [] };
}

export async function callOpenAIWithUsage(
  messages: { role: string; content: string }[],
  opts: { model?: string; temperature?: number; maxTokens?: number; reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "none" } = {},
): Promise<ProviderCallResult> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const model = opts.model || "gpt-4o";
  const startMs = Date.now();
  const isNewSchema = /^(gpt-5|o\d)/i.test(model);
  const body: Record<string, unknown> = { model, messages };
  if (isNewSchema) {
    body.max_completion_tokens = opts.maxTokens || 8192;
    if (opts.reasoningEffort && opts.reasoningEffort !== "none") {
      body.reasoning_effort = opts.reasoningEffort;
    }
  } else {
    body.max_tokens = opts.maxTokens || 8192;
    body.temperature = opts.temperature ?? 0.4;
  }
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const callMeta = buildCallMetadata({
      provider: "openai", model, messages,
      maxTokens: opts.maxTokens, reasoningEffort: opts.reasoningEffort,
      stage: _providerCallContext.stage, batchIndex: _providerCallContext.batchIndex,
      taskType: _providerCallContext.taskType, runId: _providerCallContext.runId,
    });
    const failure = buildFailureRecord({ httpStatus: resp.status, errorBody: errText, errorMessage: `OpenAI error: ${resp.status}`, callMetadata: callMeta });
    logProviderFailure(failure);
    throw new ProviderError(`OpenAI error: ${resp.status}`, failure);
  }
  const data = await resp.json();
  const usage = data.usage ?? {};
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      input_tokens: usage.prompt_tokens ?? undefined,
      output_tokens: usage.completion_tokens ?? undefined,
      total_tokens: usage.total_tokens ?? undefined,
    },
    provider: "openai",
    model,
    duration_ms: Date.now() - startMs,
  };
}

export async function callOpenAI(
  messages: { role: string; content: string }[],
  opts: { model?: string; temperature?: number; maxTokens?: number; reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "none" } = {},
): Promise<string> {
  const result = await callOpenAIWithUsage(messages, opts);
  return result.text;
}

export async function callClaudeWithUsage(
  messages: { role: string; content: string }[],
  opts: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    maxAttempts?: number;
  } = {},
): Promise<ProviderCallResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const model = opts.model || "claude-sonnet-4-5-20250929";
  const startMs = Date.now();

  let systemPrompt = "";
  const anthropicMessages: { role: string; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + m.content;
    } else {
      anthropicMessages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }
  }
  if (anthropicMessages.length === 0 && systemPrompt) {
    anthropicMessages.push({ role: "user", content: systemPrompt });
    systemPrompt = "";
  }

  const body: any = {
    model,
    max_tokens: opts.maxTokens || 12000,
    messages: anthropicMessages,
    temperature: opts.temperature ?? 0.3,
  };
  if (systemPrompt) body.system = systemPrompt;

  const TIMEOUT_MS = opts.timeoutMs ?? 75_000;
  const MAX_ATTEMPTS = Math.max(1, opts.maxAttempts ?? 3);
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        const data = await resp.json();
        let text = "";
        for (const block of (data.content || [])) {
          if (block.type === "text") text += block.text;
        }
        const usage = data.usage ?? {};
        return {
          text,
          usage: {
            input_tokens: usage.input_tokens ?? undefined,
            output_tokens: usage.output_tokens ?? undefined,
            total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) || undefined,
          },
          provider: "anthropic",
          model,
          duration_ms: Date.now() - startMs,
        };
      }

      const status = resp.status;
      const errText = await resp.text().catch(() => "");
      const callMeta = buildCallMetadata({
        provider: "anthropic", model, messages,
        maxTokens: opts.maxTokens, stage: _providerCallContext.stage,
        batchIndex: _providerCallContext.batchIndex, taskType: _providerCallContext.taskType,
        runId: _providerCallContext.runId,
      });
      const failure = buildFailureRecord({ httpStatus: status, errorBody: errText, errorMessage: `Claude error: ${status}`, callMetadata: callMeta });
      logProviderFailure(failure);

      const isTransient = status === 429 || (status >= 500 && status < 600);
      if (!isTransient || attempt === MAX_ATTEMPTS) {
        throw new ProviderError(`Claude error: ${status}${isTransient ? " (after retries)" : ""}`, failure);
      }
      lastErr = new ProviderError(`Claude ${status}`, failure);
    } catch (e: any) {
      clearTimeout(timer);
      // Don't re-wrap ProviderErrors from the HTTP error path above
      if (e instanceof ProviderError) {
        if (attempt === MAX_ATTEMPTS) throw e;
        lastErr = e;
      } else {
        const isAbort = e?.name === "AbortError";
        const callMeta = buildCallMetadata({
          provider: "anthropic", model, messages,
          maxTokens: opts.maxTokens, stage: _providerCallContext.stage,
          batchIndex: _providerCallContext.batchIndex, taskType: _providerCallContext.taskType,
          runId: _providerCallContext.runId,
        });
        const errMsg = isAbort ? `Claude timeout after ${TIMEOUT_MS}ms` : (e?.message || String(e));
        const failure = buildFailureRecord({ httpStatus: null, errorBody: "", errorMessage: errMsg, callMetadata: callMeta });
        logProviderFailure(failure);
        if (attempt === MAX_ATTEMPTS) throw new ProviderError(errMsg, failure);
        lastErr = new ProviderError(errMsg, failure);
      }
    }
    const delayMs = 3000 * Math.pow(3, attempt - 1);
    console.log(`[claude] retrying in ${delayMs}ms…`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr ?? new Error("Claude: exhausted retries");
}

export async function callClaude(
  messages: { role: string; content: string }[],
  opts: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    maxAttempts?: number;
  } = {},
): Promise<string> {
  const result = await callClaudeWithUsage(messages, opts);
  return result.text;
}

// ⚠️  MODEL POLICY: callLovableAI must NOT be imported anywhere in the
// Strategy execution path (runTask, sectionAuthor, run-validation-canary,
// run-strategy-task). It is retained only for non-Strategy utilities
// (e.g. derive-library-cards) that predate the policy. New Strategy
// code must use callClaude (authoring) or callOpenAI (reasoning) only.
export async function callLovableAI(
  messages: { role: string; content: string }[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const model = opts.model || "google/gemini-2.5-flash";
  const isGpt5 = model.startsWith("openai/gpt-5");
  const body: Record<string, unknown> = { model, messages };
  if (isGpt5) {
    if (opts.maxTokens) body.max_completion_tokens = opts.maxTokens;
  } else {
    body.temperature = opts.temperature ?? 0.4;
    body.max_tokens = opts.maxTokens || 4000;
  }

  const maxAttempts = 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || "";
        return content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      }
      const status = resp.status;
      const errText = await resp.text().catch(() => "");
      console.error(`[lovable-ai] error ${status} model=${model} attempt=${attempt}/${maxAttempts}: ${errText.slice(0, 400)}`);
      if (status === 429) throw { status: 429, message: "Rate limited" };
      if (status === 402) throw { status: 402, message: "AI credits exhausted" };
      const isTransient = status >= 500 && status < 600;
      if (!isTransient || attempt === maxAttempts) {
        throw new Error(`Lovable AI error: ${status}${isTransient ? " (after retries)" : ""}`);
      }
      lastErr = new Error(`Lovable AI ${status}`);
    } catch (e: any) {
      if (e?.status === 429 || e?.status === 402) throw e;
      if (attempt === maxAttempts) throw (lastErr ?? e);
      lastErr = e;
    }
    const delayMs = 2000 * (Math.pow(2, attempt) - 1);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr ?? new Error("Lovable AI: exhausted retries");
}

/** Robust JSON extraction from model output (handles fences, prose preamble). */
export function safeParseJSON<T = any>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}
