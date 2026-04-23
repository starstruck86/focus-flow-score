// ════════════════════════════════════════════════════════════════
// Multi-LLM provider adapters (Perplexity, OpenAI, Claude).
//
// MODEL POLICY: Gemini / Lovable AI Gateway are explicitly NOT part
// of the Strategy execution path. The previously-exported
// `callLovableAI` adapter has been removed to prevent any code in
// this workflow from accidentally routing through Gemini.
// Same adapter pattern shared across all Strategy tasks.
// ════════════════════════════════════════════════════════════════

export async function callPerplexity(
  messages: { role: string; content: string }[],
  opts: { model?: string; maxTokens?: number } = {},
): Promise<{ text: string; citations: string[] }> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) throw new Error("PERPLEXITY_API_KEY not configured");

  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model || "sonar-pro",
      messages,
      temperature: 0.3,
      max_tokens: opts.maxTokens || 8192,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[perplexity] error ${resp.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Perplexity error: ${resp.status}`);
  }
  const data = await resp.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    citations: data.citations || [],
  };
}

export async function callOpenAI(
  messages: { role: string; content: string }[],
  opts: { model?: string; temperature?: number; maxTokens?: number; reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "none" } = {},
): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const model = opts.model || "gpt-4o";
  // gpt-5 family (and newer reasoning models) reject `max_tokens` and
  // custom `temperature`. They require `max_completion_tokens` and use
  // a fixed default temperature. Switch the body shape per model.
  const isNewSchema = /^(gpt-5|o\d)/i.test(model);
  const body: Record<string, unknown> = { model, messages };
  if (isNewSchema) {
    body.max_completion_tokens = opts.maxTokens || 8192;
    if (opts.reasoningEffort) {
      body.reasoning = { effort: opts.reasoningEffort };
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
    console.error(`[openai] error ${resp.status}: ${errText.slice(0, 200)}`);
    throw new Error(`OpenAI error: ${resp.status}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

export async function callClaude(
  messages: { role: string; content: string }[],
  opts: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** Per-attempt wall-clock cap. Default 75s — must stay below the
     *  caller's outer stage budget (e.g. AUTHORING_TIMEOUT_MS=100s). */
    timeoutMs?: number;
    /** Max attempts including the first. Default 3. Authoring callers
     *  pass 1 because the outer stage has its own race that would fire
     *  before retries can complete. */
    maxAttempts?: number;
  } = {},
): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

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
    model: opts.model || "claude-sonnet-4-5-20250929",
    max_tokens: opts.maxTokens || 12000,
    messages: anthropicMessages,
    temperature: opts.temperature ?? 0.3,
  };
  if (systemPrompt) body.system = systemPrompt;

  // Fix 2 — bounded inner timeout. Defaults stay safe for non-authoring
  // callers; authoring passes timeoutMs=75_000, maxAttempts=1 so the inner
  // call cannot outlive the outer 100s race in runTask.ts.
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
        return text;
      }

      const status = resp.status;
      const errText = await resp.text().catch(() => "");
      console.error(`[claude] error ${status} attempt=${attempt}/${MAX_ATTEMPTS}: ${errText.slice(0, 300)}`);

      // 4xx (other than 429) — fail immediately, no retry.
      const isTransient = status === 429 || (status >= 500 && status < 600);
      if (!isTransient || attempt === MAX_ATTEMPTS) {
        throw new Error(`Claude error: ${status}${isTransient ? " (after retries)" : ""}`);
      }
      lastErr = new Error(`Claude ${status}`);
    } catch (e: any) {
      clearTimeout(timer);
      const isAbort = e?.name === "AbortError";
      console.error(`[claude] ${isAbort ? "timeout" : "fetch error"} attempt=${attempt}/${MAX_ATTEMPTS}: ${e?.message || e}`);
      if (attempt === MAX_ATTEMPTS) throw isAbort ? new Error(`Claude timeout after ${TIMEOUT_MS}ms (3 attempts)`) : e;
      lastErr = e;
    }
    // Backoff: 3s, 9s
    const delayMs = 3000 * Math.pow(3, attempt - 1);
    console.log(`[claude] retrying in ${delayMs}ms…`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr ?? new Error("Claude: exhausted retries");
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
