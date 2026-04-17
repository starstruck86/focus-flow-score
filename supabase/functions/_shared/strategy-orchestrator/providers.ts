// ════════════════════════════════════════════════════════════════
// Multi-LLM provider adapters (Perplexity, OpenAI, Claude, Lovable AI)
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
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model || "gpt-4o",
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens || 8192,
    }),
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
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
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
    model: opts.model || "claude-sonnet-4-20250514",
    max_tokens: opts.maxTokens || 12000,
    messages: anthropicMessages,
    temperature: opts.temperature ?? 0.3,
  };
  if (systemPrompt) body.system = systemPrompt;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[claude] error ${resp.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Claude error: ${resp.status}`);
  }
  const data = await resp.json();
  let text = "";
  for (const block of (data.content || [])) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

export async function callLovableAI(
  messages: { role: string; content: string }[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const model = opts.model || "google/gemini-2.5-flash";
  // GPT-5 family rejects custom temperature and uses max_completion_tokens.
  const isGpt5 = model.startsWith("openai/gpt-5");
  const body: Record<string, unknown> = { model, messages };
  if (isGpt5) {
    if (opts.maxTokens) body.max_completion_tokens = opts.maxTokens;
  } else {
    body.temperature = opts.temperature ?? 0.4;
    body.max_tokens = opts.maxTokens || 4000;
  }

  // Retry transient 5xx errors with exponential backoff (gateway hiccups, especially on gpt-5).
  // 4 attempts: 0s, 2s, 6s, 14s (cumulative ~22s before final failure).
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
      // Retry on transient 5xx; fail immediately on other 4xx.
      const isTransient = status >= 500 && status < 600;
      if (!isTransient || attempt === maxAttempts) {
        throw new Error(`Lovable AI error: ${status}${isTransient ? " (after retries)" : ""}`);
      }
      lastErr = new Error(`Lovable AI ${status}`);
    } catch (e: any) {
      // Re-throw non-retryable errors immediately.
      if (e?.status === 429 || e?.status === 402) throw e;
      if (attempt === maxAttempts) throw (lastErr ?? e);
      lastErr = e;
    }
    // Exponential backoff: 2s, 6s, 14s
    const delayMs = 2000 * (Math.pow(2, attempt) - 1);
    console.log(`[lovable-ai] retrying in ${delayMs}ms…`);
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
