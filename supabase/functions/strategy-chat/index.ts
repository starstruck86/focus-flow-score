import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════
// LAYER 1 — PROVIDER ADAPTERS
// ═══════════════════════════════════════════════════════════
type ProviderKey = "openai" | "anthropic" | "perplexity";

interface NormalizedResponse {
  text: string;
  structured?: any;
  citations?: string[];
  provider: ProviderKey;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  error?: { type: string; message: string };
  // For streaming — raw Response to pipe through
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

function getOpenAIHeaders(): Record<string, string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
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

// ── OpenAI Adapter (via Lovable AI Gateway) ────────────────
async function openaiAdapter(req: AdapterRequest, signal: AbortSignal): Promise<NormalizedResponse> {
  const start = Date.now();
  const body: any = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 4096,
  };
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.toolChoice; }
  if (req.reasoning) body.reasoning = req.reasoning;
  if (req.stream) body.stream = true;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST", headers: getOpenAIHeaders(), signal, body: JSON.stringify(body),
  });

  if (!resp.ok) {
    return { text: "", provider: "openai", model: req.model, latencyMs: Date.now() - start, fallbackUsed: false,
      error: { type: `http_${resp.status}`, message: `OpenAI gateway error: ${resp.status}` } };
  }

  if (req.stream) {
    return { text: "", provider: "openai", model: req.model, latencyMs: Date.now() - start, fallbackUsed: false, rawStream: resp };
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  let structured: any = undefined;
  let text = data.choices?.[0]?.message?.content || "";
  if (toolCall?.function?.arguments) {
    try { structured = JSON.parse(toolCall.function.arguments); } catch {}
  }

  return { text, structured, provider: "openai", model: req.model, latencyMs: Date.now() - start, fallbackUsed: false };
}

// ── Anthropic Adapter (Claude — direct API) ────────────────
async function anthropicAdapter(req: AdapterRequest, signal: AbortSignal): Promise<NormalizedResponse> {
  const start = Date.now();

  // Convert OpenAI-style messages to Anthropic format
  let systemPrompt = "";
  const anthropicMessages: Array<{ role: string; content: string }> = [];
  for (const m of req.messages) {
    if (m.role === "system") { systemPrompt += (systemPrompt ? "\n" : "") + m.content; }
    else { anthropicMessages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }); }
  }

  const body: any = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    messages: anthropicMessages,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (req.temperature !== undefined) body.temperature = req.temperature;

  // Convert OpenAI tools to Anthropic tool format
  if (req.tools?.length) {
    body.tools = req.tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (req.toolChoice) {
      body.tool_choice = { type: "tool", name: req.toolChoice.function?.name || req.tools[0].function.name };
    }
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: getAnthropicHeaders(), signal, body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[anthropic] error ${resp.status}: ${errText}`);
    return { text: "", provider: "anthropic", model: req.model, latencyMs: Date.now() - start, fallbackUsed: false,
      error: { type: `http_${resp.status}`, message: `Anthropic error: ${resp.status}` } };
  }

  const data = await resp.json();
  let text = "";
  let structured: any = undefined;

  for (const block of (data.content || [])) {
    if (block.type === "text") text += block.text;
    if (block.type === "tool_use") { structured = block.input; }
  }

  return { text, structured, provider: "anthropic", model: req.model, latencyMs: Date.now() - start, fallbackUsed: false };
}

// ── Perplexity Adapter ─────────────────────────────────────
async function perplexityAdapter(req: AdapterRequest, signal: AbortSignal): Promise<NormalizedResponse> {
  const start = Date.now();
  const body: any = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.3,
    max_tokens: req.maxTokens ?? 8192,
  };

  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST", headers: getPerplexityHeaders(), signal, body: JSON.stringify(body),
  });

  if (!resp.ok) {
    return { text: "", provider: "perplexity", model: req.model, latencyMs: Date.now() - start, fallbackUsed: false,
      error: { type: `http_${resp.status}`, message: `Perplexity error: ${resp.status}` } };
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  const citations = data.citations || [];

  return { text, citations, provider: "perplexity", model: req.model, latencyMs: Date.now() - start, fallbackUsed: false };
}

// Adapter dispatcher
type AdapterFn = (req: AdapterRequest, signal: AbortSignal) => Promise<NormalizedResponse>;

const ADAPTERS: Record<ProviderKey, AdapterFn> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  perplexity: perplexityAdapter,
};

// ═══════════════════════════════════════════════════════════
// LAYER 2 — ROUTER
// ═══════════════════════════════════════════════════════════
type TaskType = "chat_general" | "deep_research" | "email_evaluation" | "territory_tiering" | "account_plan" | "opportunity_strategy" | "brainstorm" | "rollup";

interface LLMRoute {
  primaryProvider: ProviderKey;
  model: string;
  fallbackProvider: ProviderKey;
  fallbackModel: string;
  temperature: number;
  maxTokens: number;
  useTools: boolean;
  reasoning?: { effort: string };
}

const ROUTES: Record<TaskType, LLMRoute> = {
  chat_general:         { primaryProvider: "openai", model: "openai/gpt-5-mini",            fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-4-20250514", temperature: 0.7, maxTokens: 4096, useTools: false },
  deep_research:        { primaryProvider: "perplexity", model: "sonar-pro",                 fallbackProvider: "openai",    fallbackModel: "openai/gpt-5-mini",       temperature: 0.3, maxTokens: 8192, useTools: false },
  email_evaluation:     { primaryProvider: "openai", model: "openai/gpt-5-mini",            fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-4-20250514", temperature: 0.4, maxTokens: 4096, useTools: true },
  territory_tiering:    { primaryProvider: "openai", model: "openai/gpt-5",                 fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-4-20250514", temperature: 0.2, maxTokens: 8192, useTools: true, reasoning: { effort: "medium" } },
  account_plan:         { primaryProvider: "openai", model: "openai/gpt-5-mini",            fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-4-20250514", temperature: 0.5, maxTokens: 8192, useTools: true },
  opportunity_strategy: { primaryProvider: "openai", model: "openai/gpt-5-mini",            fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-4-20250514", temperature: 0.5, maxTokens: 8192, useTools: true },
  brainstorm:           { primaryProvider: "openai", model: "openai/gpt-5-mini",            fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-4-20250514", temperature: 0.9, maxTokens: 4096, useTools: true },
  rollup:               { primaryProvider: "openai", model: "openai/gpt-5-mini",            fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-4-20250514", temperature: 0.3, maxTokens: 4096, useTools: true },
};

function resolveLLMRoute(taskType: string): LLMRoute {
  return ROUTES[taskType as TaskType] || ROUTES.chat_general;
}

// ═══════════════════════════════════════════════════════════
// LAYER 3 — CALL WITH FALLBACK
// ═══════════════════════════════════════════════════════════
async function callWithFallback(
  taskType: string,
  adapterReq: Omit<AdapterRequest, "model">,
  route: LLMRoute,
): Promise<NormalizedResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const primaryAdapter = ADAPTERS[route.primaryProvider];
    console.log(`[routing] task=${taskType} primary=${route.primaryProvider} model=${route.model}`);

    const result = await primaryAdapter({ ...adapterReq, model: route.model }, controller.signal);

    if (!result.error) {
      console.log(`[routing] task=${taskType} provider=${result.provider} model=${result.model} latency=${result.latencyMs}ms`);
      return result;
    }

    // Primary failed — try fallback
    console.warn(`[routing] primary failed: ${result.error.message}. Trying fallback=${route.fallbackProvider}`);
    clearTimeout(timeout);
    const fallbackController = new AbortController();
    const fallbackTimeout = setTimeout(() => fallbackController.abort(), 55000);

    try {
      const fallbackAdapter = ADAPTERS[route.fallbackProvider];
      const fallbackResult = await fallbackAdapter(
        { ...adapterReq, model: route.fallbackModel }, fallbackController.signal,
      );
      fallbackResult.fallbackUsed = true;
      console.log(`[routing] fallback task=${taskType} provider=${fallbackResult.provider} model=${fallbackResult.model} latency=${fallbackResult.latencyMs}ms reason=${result.error.message}`);
      return fallbackResult;
    } finally {
      clearTimeout(fallbackTimeout);
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      // Try fallback on timeout too
      console.warn(`[routing] primary timed out for task=${taskType}. Trying fallback=${route.fallbackProvider}`);
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 55000);
      try {
        const fallbackAdapter = ADAPTERS[route.fallbackProvider];
        const fallbackResult = await fallbackAdapter(
          { ...adapterReq, model: route.fallbackModel }, fallbackController.signal,
        );
        fallbackResult.fallbackUsed = true;
        console.log(`[routing] fallback-after-timeout task=${taskType} provider=${fallbackResult.provider} latency=${fallbackResult.latencyMs}ms`);
        return fallbackResult;
      } catch (fe: any) {
        if (fe.name === "AbortError") {
          return { text: "", provider: route.fallbackProvider, model: route.fallbackModel, latencyMs: 55000, fallbackUsed: true,
            error: { type: "timeout", message: "Both primary and fallback timed out" } };
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

// Streaming-specific call (no fallback on stream — too complex)
async function callStreaming(
  taskType: string,
  adapterReq: Omit<AdapterRequest, "model" | "stream">,
  route: LLMRoute,
): Promise<NormalizedResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    // Only OpenAI adapter supports streaming currently
    console.log(`[routing] stream task=${taskType} provider=${route.primaryProvider} model=${route.model}`);
    const result = await openaiAdapter({ ...adapterReq, model: route.model, stream: true }, controller.signal);
    if (result.error) {
      // Fallback to non-streaming
      console.warn(`[routing] stream failed, fallback non-stream: ${result.error.message}`);
      clearTimeout(timeout);
      const fbController = new AbortController();
      const fbTimeout = setTimeout(() => fbController.abort(), 55000);
      try {
        const fbResult = await openaiAdapter({ ...adapterReq, model: route.model }, fbController.signal);
        fbResult.fallbackUsed = true;
        return fbResult;
      } finally { clearTimeout(fbTimeout); }
    }
    return result;
  } catch (e: any) {
    if (e.name === "AbortError") {
      return { text: "", provider: "openai", model: route.model, latencyMs: 55000, fallbackUsed: false,
        error: { type: "timeout", message: "Request timed out — please try again" } };
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════
// WORKFLOW TOOL SCHEMAS (unchanged from before)
// ═══════════════════════════════════════════════════════════
const WORKFLOW_TOOLS: Record<string, any> = {
  deep_research: {
    type: "function", function: { name: "deep_research_result", description: "Return structured deep research findings.",
      parameters: { type: "object", properties: {
        summary: { type: "string" }, company_overview: { type: "string" },
        key_findings: { type: "array", items: { type: "string" } },
        strategic_implications: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        opportunities: { type: "array", items: { type: "string" } },
        recommended_actions: { type: "array", items: { type: "string" } },
        cited_sources: { type: "array", items: { type: "string" } },
      }, required: ["summary", "company_overview", "key_findings", "strategic_implications", "risks", "opportunities", "recommended_actions", "cited_sources"], additionalProperties: false } } },
  email_evaluation: {
    type: "function", function: { name: "email_evaluation_result", description: "Return structured email evaluation.",
      parameters: { type: "object", properties: {
        overall_score: { type: "number" }, strengths: { type: "array", items: { type: "string" } },
        weaknesses: { type: "array", items: { type: "string" } }, subject_line_feedback: { type: "string" },
        opening_feedback: { type: "string" }, value_prop_feedback: { type: "string" },
        cta_feedback: { type: "string" }, rewrite: { type: "string" },
      }, required: ["overall_score", "strengths", "weaknesses", "subject_line_feedback", "opening_feedback", "value_prop_feedback", "cta_feedback", "rewrite"], additionalProperties: false } } },
  territory_tiering: {
    type: "function", function: { name: "territory_tiering_result", description: "Return structured territory tiering analysis.",
      parameters: { type: "object", properties: {
        methodology: { type: "string" },
        tiers: { type: "array", items: { type: "object", properties: {
          account_name: { type: "string" }, tier: { type: "string", enum: ["Tier 1", "Tier 2", "Tier 3", "Tier 4"] },
          rationale: { type: "string" }, next_action: { type: "string" },
        }, required: ["account_name", "tier", "rationale", "next_action"], additionalProperties: false } },
        summary: { type: "string" },
      }, required: ["methodology", "tiers", "summary"], additionalProperties: false } } },
  account_plan: {
    type: "function", function: { name: "account_plan_result", description: "Return structured account plan.",
      parameters: { type: "object", properties: {
        executive_summary: { type: "string" }, account_overview: { type: "string" },
        stakeholder_map: { type: "array", items: { type: "string" } },
        strategic_objectives: { type: "array", items: { type: "string" } },
        action_plan: { type: "array", items: { type: "string" } },
        risk_factors: { type: "array", items: { type: "string" } },
        success_metrics: { type: "array", items: { type: "string" } },
      }, required: ["executive_summary", "account_overview", "stakeholder_map", "strategic_objectives", "action_plan", "risk_factors", "success_metrics"], additionalProperties: false } } },
  opportunity_strategy: {
    type: "function", function: { name: "opportunity_strategy_result", description: "Return structured opportunity strategy.",
      parameters: { type: "object", properties: {
        deal_summary: { type: "string" }, decision_process: { type: "string" },
        champion_status: { type: "string" }, competition_analysis: { type: "string" },
        value_alignment: { type: "string" }, risks: { type: "array", items: { type: "string" } },
        next_actions: { type: "array", items: { type: "string" } }, close_plan: { type: "string" },
      }, required: ["deal_summary", "decision_process", "champion_status", "competition_analysis", "value_alignment", "risks", "next_actions", "close_plan"], additionalProperties: false } } },
  brainstorm: {
    type: "function", function: { name: "brainstorm_result", description: "Return structured brainstorm output.",
      parameters: { type: "object", properties: {
        key_insights: { type: "array", items: { type: "string" } },
        bold_ideas: { type: "array", items: { type: "string" } },
        quick_wins: { type: "array", items: { type: "string" } },
        strategic_bets: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      }, required: ["key_insights", "bold_ideas", "quick_wins", "strategic_bets", "summary"], additionalProperties: false } } },
};

const ROLLUP_TOOL = {
  type: "function", function: { name: "generate_rollup", description: "Generate a structured thread rollup.",
    parameters: { type: "object", properties: {
      summary: { type: "string" }, key_facts: { type: "array", items: { type: "string" } },
      hypotheses: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      open_questions: { type: "array", items: { type: "string" } },
      next_steps: { type: "array", items: { type: "string" } },
      memory_suggestions: { type: "array", items: { type: "object", properties: {
        memory_type: { type: "string", enum: ["fact", "hypothesis", "risk", "priority", "stakeholder_note", "messaging_note", "next_step"] },
        content: { type: "string" }, confidence: { type: "number" },
      }, required: ["memory_type", "content", "confidence"], additionalProperties: false } },
    }, required: ["summary", "key_facts", "hypotheses", "risks", "open_questions", "next_steps", "memory_suggestions"], additionalProperties: false } },
};

// ═══════════════════════════════════════════════════════════
// RETRIEVAL LAYER (unchanged)
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
  supabase: any, threadId: string, userId: string, userQuery?: string, workflowType?: string,
): Promise<ContextPack> {
  const pack: ContextPack = {
    memories: [], uploads: [], outputs: [], recentMessages: [], sourceCount: 0,
    retrievalMeta: { memoriesScored: 0, uploadsIncluded: 0, outputsIncluded: 0, messagesIncluded: 0, pinnedMemories: 0, uploadNames: [], outputTitles: [], contextType: "minimal", topSources: [] },
  };

  const { data: thread } = await supabase.from("strategy_threads")
    .select("linked_account_id, linked_opportunity_id, linked_territory_id, title")
    .eq("id", threadId).single();
  if (!thread) return pack;

  const rawQuery = `${userQuery || ""} ${thread.title || ""}`;
  const queryTerms = rawQuery.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
  const workflowBoostTerms: Record<string, string[]> = {
    deep_research: ["research", "competitor", "industry", "market", "technology", "stakeholder"],
    account_plan: ["plan", "strategy", "objective", "stakeholder", "timeline", "metric"],
    territory_tiering: ["tier", "priority", "segment", "icp", "revenue", "potential"],
    email_evaluation: ["email", "message", "outreach", "subject", "tone", "cta"],
    opportunity_strategy: ["deal", "champion", "decision", "close", "risk", "competitor"],
    brainstorm: ["idea", "approach", "creative", "angle", "hypothesis"],
  };
  const boostTerms = workflowBoostTerms[workflowType || ""] || [];

  const promises: Promise<void>[] = [];

  if (thread.linked_account_id) {
    promises.push((async () => {
      const { data: acct } = await supabase.from("accounts")
        .select("id, name, industry, tier, website, notes, outreach_status, tech_stack, tags")
        .eq("id", thread.linked_account_id).single();
      pack.account = acct;
      const { data: mem } = await supabase.from("account_strategy_memory")
        .select("id, memory_type, content, is_pinned, confidence, last_used_at, created_at")
        .eq("account_id", thread.linked_account_id).eq("user_id", userId).eq("is_irrelevant", false)
        .order("created_at", { ascending: false }).limit(40);
      if (mem) pack.memories.push(...mem.map((m: any) => ({ ...m, source: "account" })));
    })());
  }

  if (thread.linked_opportunity_id) {
    promises.push((async () => {
      const { data: opp } = await supabase.from("opportunities")
        .select("id, name, stage, close_date, notes")
        .eq("id", thread.linked_opportunity_id).single();
      pack.opportunity = opp ? { ...opp, amount: null } : null;
      const { data: mem } = await supabase.from("opportunity_strategy_memory")
        .select("id, memory_type, content, is_pinned, confidence, last_used_at, created_at")
        .eq("opportunity_id", thread.linked_opportunity_id).eq("user_id", userId).eq("is_irrelevant", false)
        .order("created_at", { ascending: false }).limit(40);
      if (mem) pack.memories.push(...mem.map((m: any) => ({ ...m, source: "opportunity" })));
    })());
  }

  if (thread.linked_territory_id) {
    promises.push((async () => {
      const { data: mem } = await supabase.from("territory_strategy_memory")
        .select("id, memory_type, content, is_pinned, confidence, last_used_at, created_at")
        .eq("territory_id", thread.linked_territory_id).eq("user_id", userId).eq("is_irrelevant", false)
        .order("created_at", { ascending: false }).limit(40);
      if (mem) pack.memories.push(...mem.map((m: any) => ({ ...m, source: "territory" })));
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
      .eq("thread_id", threadId).order("created_at", { ascending: false }).limit(8);
    if (outs) pack.outputs = outs;
  })());

  promises.push((async () => {
    const { data: msgs } = await supabase.from("strategy_messages")
      .select("id, role, content_json, message_type")
      .eq("thread_id", threadId).neq("message_type", "workflow_update")
      .order("created_at", { ascending: false }).limit(25);
    if (msgs) {
      pack.recentMessages = msgs.reverse().map((m: any) => ({
        id: m.id, role: m.role, text: (m.content_json?.text || "").slice(0, 600),
      }));
    }
  })());

  await Promise.all(promises);

  pack.memories = scoreAndRankMemories(pack.memories, queryTerms, boostTerms);
  pack.outputs = scoreAndRankOutputs(pack.outputs, queryTerms);
  pack.uploads = pack.uploads.slice(0, CAPS.uploads).map((u: any) => ({
    ...u, parsed_text: u.parsed_text ? u.parsed_text.slice(0, 2000) : null,
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
    if (memWeight > upWeight && memWeight > outWeight) contextType = "memory-driven";
    else if (upWeight > memWeight && upWeight > outWeight) contextType = "upload-driven";
    else contextType = "mixed";
  }

  const topSources: string[] = [];
  for (const m of pack.memories.slice(0, 2)) topSources.push(`Memory: ${m.content.slice(0, 60)}`);
  for (const u of pack.uploads.slice(0, 1)) topSources.push(`Upload: ${u.file_name}`);

  pack.retrievalMeta = {
    memoriesScored: pack.memories.length, uploadsIncluded: pack.uploads.length,
    outputsIncluded: pack.outputs.length, messagesIncluded: pack.recentMessages.length,
    pinnedMemories: pinnedCount, uploadNames: pack.uploads.map((u: any) => u.file_name).filter(Boolean),
    outputTitles: pack.outputs.map((o: any) => o.title).filter(Boolean).slice(0, 5),
    contextType, topSources: topSources.slice(0, 3),
  };

  pack.sourceCount = (pack.account ? 1 : 0) + (pack.opportunity ? 1 : 0) + pack.memories.length + pack.uploads.length + pack.outputs.length;

  // Update last_used_at for retrieved memories
  const memoryIds = pack.memories.map((m: any) => m.id);
  if (memoryIds.length > 0) {
    const now = new Date().toISOString();
    for (const [table, src] of [["account_strategy_memory", "account"], ["opportunity_strategy_memory", "opportunity"], ["territory_strategy_memory", "territory"]] as const) {
      const ids = pack.memories.filter((m: any) => m.source === src).map((m: any) => m.id);
      if (ids.length > 0) await supabase.from(table).update({ last_used_at: now }).in("id", ids);
    }
  }

  console.log(`[retrieval] sources=${pack.sourceCount} memories=${pack.memories.length}(${pinnedCount} pinned) uploads=${pack.uploads.length} outputs=${pack.outputs.length} contextType=${contextType}`);
  return pack;
}

function scoreAndRankMemories(memories: any[], queryTerms: string[], boostTerms: string[]): any[] {
  const seen = new Set<string>();
  const deduped = memories.filter((m) => {
    const norm = m.content.toLowerCase().trim().slice(0, 200);
    for (const s of seen) { if (s.includes(norm) || norm.includes(s)) return false; }
    seen.add(norm); return true;
  });

  return deduped.map((m) => {
    let score = 1;
    if (m.is_pinned) score += 5;
    if (m.confidence && m.confidence > 0.7) score += 2;
    else if (m.confidence && m.confidence > 0.5) score += 1;
    else if (m.confidence !== null && m.confidence < 0.3) score -= 1;
    if (m.last_used_at) {
      const usedAge = (Date.now() - new Date(m.last_used_at).getTime()) / 86400000;
      if (usedAge < 3) score += 2; else if (usedAge < 7) score += 1;
    }
    const ageDays = (Date.now() - new Date(m.created_at).getTime()) / 86400000;
    if (ageDays < 1) score += 4; else if (ageDays < 3) score += 3; else if (ageDays < 7) score += 2; else if (ageDays < 30) score += 1; else if (!m.is_pinned) score -= 1;
    const content = m.content.toLowerCase();
    if (queryTerms.length > 0) score += queryTerms.filter((t: string) => content.includes(t)).length * 2;
    if (boostTerms.length > 0) score += boostTerms.filter(t => content.includes(t)).length * 1.5;
    const highPriorityTypes = ["risk", "priority", "next_step", "stakeholder_note"];
    if (highPriorityTypes.includes(m.memory_type)) score += 1;
    return { ...m, score };
  }).sort((a: any, b: any) => b.score - a.score).slice(0, CAPS.memories);
}

function scoreAndRankOutputs(outputs: any[], queryTerms: string[]): any[] {
  return outputs.map((o) => {
    let score = 1;
    if (o.is_pinned) score += 4;
    const age = Date.now() - new Date(o.created_at).getTime();
    if (age < 24 * 3600000) score += 3; else if (age < 7 * 86400000) score += 2;
    const text = `${o.title} ${o.rendered_text || ""}`.toLowerCase();
    if (queryTerms.length > 0) score += queryTerms.filter((t: string) => text.includes(t)).length * 1.5;
    return { ...o, score };
  }).sort((a: any, b: any) => b.score - a.score).slice(0, 5);
}

function packToPromptSection(pack: ContextPack): string {
  const sections: string[] = [];
  let charBudget = MAX_CONTEXT_CHARS;

  if (pack.account) {
    const tags = pack.account.tags?.length ? ` | Tags: ${pack.account.tags.join(", ")}` : "";
    const tech = pack.account.tech_stack?.length ? ` | Tech: ${pack.account.tech_stack.join(", ")}` : "";
    const s = `\n### Linked Account: ${pack.account.name}\nIndustry: ${pack.account.industry || "Unknown"} | Tier: ${pack.account.tier || "Unset"} | Status: ${pack.account.outreach_status || "None"}${tags}${tech}${pack.account.notes ? `\nNotes: ${pack.account.notes.slice(0, 400)}` : ""}`;
    sections.push(s); charBudget -= s.length;
  }
  if (pack.opportunity) {
    const s = `\n### Linked Opportunity: ${pack.opportunity.name}\nStage: ${pack.opportunity.stage || "Unknown"}${pack.opportunity.close_date ? ` | Close: ${pack.opportunity.close_date}` : ""}${pack.opportunity.notes ? `\nNotes: ${pack.opportunity.notes.slice(0, 400)}` : ""}`;
    sections.push(s); charBudget -= s.length;
  }
  if (pack.memories.length > 0) {
    let memSection = "\n### Strategic Memory:";
    for (const m of pack.memories) {
      const pin = m.is_pinned ? " 📌" : "";
      const conf = m.confidence ? ` (${Math.round(m.confidence * 100)}%)` : "";
      const line = `\n- [${m.memory_type}${pin}${conf}] ${m.content.slice(0, 250)}`;
      if (charBudget - line.length < 0) break;
      memSection += line; charBudget -= line.length;
    }
    sections.push(memSection);
  }
  if (pack.uploads.length > 0) {
    let upSection = "\n### Uploaded Resources:";
    for (const u of pack.uploads) {
      const text = u.summary || (u.parsed_text || "").slice(0, 800);
      const line = `\n- ${u.file_name}: ${text}`;
      if (charBudget - line.length < 0) break;
      upSection += line; charBudget -= line.length;
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
      outSection += line; charBudget -= line.length;
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
        return `# Deep Research\n\n## Summary\n${data.summary || ""}\n\n## Company Overview\n${data.company_overview || ""}\n\n## Key Findings\n${(data.key_findings || []).map((f: string) => `- ${f}`).join("\n")}\n\n## Strategic Implications\n${(data.strategic_implications || []).map((s: string) => `- ${s}`).join("\n")}\n\n## Risks\n${(data.risks || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Opportunities\n${(data.opportunities || []).map((o: string) => `- ${o}`).join("\n")}\n\n## Recommended Actions\n${(data.recommended_actions || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Sources\n${(data.cited_sources || []).map((s: string) => `- ${s}`).join("\n")}`;
      case "email_evaluation":
        return `# Email Evaluation\n\n**Score: ${data.overall_score ?? "N/A"}/10**\n\n## Strengths\n${(data.strengths || []).map((s: string) => `- ${s}`).join("\n")}\n\n## Weaknesses\n${(data.weaknesses || []).map((w: string) => `- ${w}`).join("\n")}\n\n## Subject Line\n${data.subject_line_feedback || ""}\n\n## Opening\n${data.opening_feedback || ""}\n\n## Value Proposition\n${data.value_prop_feedback || ""}\n\n## CTA\n${data.cta_feedback || ""}\n\n## Suggested Rewrite\n${data.rewrite || ""}`;
      case "territory_tiering":
        return `# Territory Tiering\n\n## Methodology\n${data.methodology || ""}\n\n## Results\n${(data.tiers || []).map((t: any) => `### ${t.account_name || "?"} — ${t.tier || "?"}\n${t.rationale || ""}\n**Next:** ${t.next_action || ""}`).join("\n\n")}\n\n## Summary\n${data.summary || ""}`;
      case "account_plan":
        return `# Account Plan\n\n## Executive Summary\n${data.executive_summary || ""}\n\n## Overview\n${data.account_overview || ""}\n\n## Stakeholders\n${(data.stakeholder_map || []).map((s: string) => `- ${s}`).join("\n")}\n\n## Strategic Objectives\n${(data.strategic_objectives || []).map((o: string) => `- ${o}`).join("\n")}\n\n## Action Plan\n${(data.action_plan || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Risk Factors\n${(data.risk_factors || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Success Metrics\n${(data.success_metrics || []).map((m: string) => `- ${m}`).join("\n")}`;
      case "opportunity_strategy":
        return `# Opportunity Strategy\n\n## Deal Summary\n${data.deal_summary || ""}\n\n## Decision Process\n${data.decision_process || ""}\n\n## Champion Status\n${data.champion_status || ""}\n\n## Competition\n${data.competition_analysis || ""}\n\n## Value Alignment\n${data.value_alignment || ""}\n\n## Risks\n${(data.risks || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Next Actions\n${(data.next_actions || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Close Plan\n${data.close_plan || ""}`;
      case "brainstorm":
        return `# Brainstorm\n\n## Key Insights\n${(data.key_insights || []).map((i: string) => `- ${i}`).join("\n")}\n\n## Bold Ideas\n${(data.bold_ideas || []).map((i: string) => `- ${i}`).join("\n")}\n\n## Quick Wins\n${(data.quick_wins || []).map((w: string) => `- ${w}`).join("\n")}\n\n## Strategic Bets\n${(data.strategic_bets || []).map((b: string) => `- ${b}`).join("\n")}\n\n## Summary\n${data.summary || ""}`;
      default: return JSON.stringify(data, null, 2);
    }
  } catch { return JSON.stringify(data, null, 2); }
}

function workflowTypeToOutputType(wt: string): string {
  const map: Record<string, string> = {
    deep_research: "brief", account_plan: "account_plan", territory_tiering: "tiering_result",
    email_evaluation: "email", opportunity_strategy: "opportunity_plan", brainstorm: "memo",
  };
  return map[wt] || "memo";
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = user?.id ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, threadId, content, workflowType, depth } = body;

    if (!threadId) {
      return new Response(JSON.stringify({ error: "threadId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contextPack = await buildContextPack(supabase, threadId, userId, content, workflowType);
    const contextSection = packToPromptSection(contextPack);

    if (action === "rollup") return await handleRollup(supabase, threadId, userId, contextPack);
    if (action === "workflow") return await handleWorkflow(supabase, threadId, userId, workflowType, content, contextSection, contextPack);
    return await handleChat(supabase, threadId, userId, content, depth, contextSection, contextPack);
  } catch (e) {
    console.error("strategy-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Chat Handler (streaming via OpenAI/Lovable gateway) ───
async function handleChat(
  supabase: any, threadId: string, userId: string,
  content: string, depth: string, contextSection: string, pack: ContextPack,
) {
  await supabase.from("strategy_messages").insert({
    thread_id: threadId, user_id: userId, role: "user",
    message_type: "chat", content_json: { text: content },
  });

  const route = resolveLLMRoute("chat_general");
  const systemPrompt = `You are a strategic sales advisor embedded in a Strategy workspace. You help with deep account research, email evaluation, opportunity strategy, territory planning, and brainstorming.

Be specific, actionable, and grounded. Reference concrete details from the context provided. When citing information from strategic memory or uploaded resources, note the source.

Depth mode: ${depth || "Standard"}. ${depth === "Deep" ? "Provide comprehensive, detailed analysis." : depth === "Fast" ? "Be concise and direct." : "Balance detail with clarity."}
${contextSection}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...pack.recentMessages.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.text,
    })),
  ];

  const startTime = Date.now();
  const result = await callStreaming("chat_general", {
    messages, temperature: route.temperature, maxTokens: route.maxTokens,
  }, route);

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error.message }), {
      status: result.error.type === "timeout" ? 504 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!result.rawStream) {
    // Non-streaming fallback — save and return
    await supabase.from("strategy_messages").insert({
      thread_id: threadId, user_id: userId, role: "assistant",
      message_type: "chat",
      provider_used: result.provider, model_used: result.model,
      fallback_used: result.fallbackUsed, latency_ms: result.latencyMs,
      content_json: {
        text: result.text, sources_used: pack.sourceCount,
        retrieval_meta: pack.retrievalMeta, model_used: result.model,
        provider_used: result.provider, fallback_used: result.fallbackUsed,
      },
    });
    return new Response(JSON.stringify({ text: result.text, provider: result.provider, model: result.model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Stream the response
  const reader = result.rawStream.body!.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          controller.enqueue(new TextEncoder().encode(chunk));
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) fullResponse += delta;
            } catch {}
          }
        }
        controller.close();

        const latency = Date.now() - startTime;
        await supabase.from("strategy_messages").insert({
          thread_id: threadId, user_id: userId, role: "assistant",
          message_type: "chat",
          provider_used: route.primaryProvider, model_used: route.model,
          fallback_used: false, latency_ms: latency,
          content_json: {
            text: fullResponse, sources_used: pack.sourceCount,
            retrieval_meta: pack.retrievalMeta, model_used: route.model,
            provider_used: route.primaryProvider, fallback_used: false,
          },
        });
        await supabase.from("strategy_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

        const { count } = await supabase.from("strategy_messages")
          .select("id", { count: "exact", head: true }).eq("thread_id", threadId);
        if (count && count % 8 === 0) {
          console.log(`[auto-rollup] triggering at ${count} messages`);
          triggerRollupAsync(supabase, threadId, userId);
        }
      } catch (e) { controller.error(e); }
    },
  });

  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

// ── Workflow Handler ──────────────────────────────────────
async function handleWorkflow(
  supabase: any, threadId: string, userId: string,
  workflowType: string, content: string, contextSection: string, pack: ContextPack,
) {
  const route = resolveLLMRoute(workflowType);
  const tool = WORKFLOW_TOOLS[workflowType];

  const { data: run, error: runErr } = await supabase.from("strategy_workflow_runs")
    .insert({ user_id: userId, thread_id: threadId, workflow_type: workflowType, status: "running", input_json: { content, workflowType } })
    .select().single();
  if (runErr) throw runErr;

  await supabase.from("strategy_messages").insert({
    thread_id: threadId, user_id: userId, role: "system", message_type: "workflow_update",
    content_json: { text: `Running ${workflowType.replace(/_/g, " ")}…`, workflowType, runId: run.id },
  });

  const workflowPrompts: Record<string, string> = {
    deep_research: "Conduct deep research on the linked account or topic. Analyze business, industry trends, competitive landscape, technology stack, key stakeholders, and potential pain points. Use all available context including account memory and uploaded resources.",
    account_plan: "Create a comprehensive account plan including executive summary, stakeholder map, strategic objectives, action plan, risks, and success metrics.",
    territory_tiering: "Analyze and tier accounts in the territory by ICP fit, revenue potential, engagement level, competitive position, and timing signals.",
    email_evaluation: "Evaluate the provided email or messaging for subject line, opening, value prop, CTA strength, tone, and personalization. Provide scored assessment and rewrite.",
    opportunity_strategy: "Build an opportunity strategy covering deal summary, decision process, champion status, competition, value alignment, risks, next actions, and close plan.",
    brainstorm: "Facilitate a strategic brainstorm. Generate creative ideas, challenge assumptions, identify non-obvious angles.",
  };

  const systemPrompt = `You are a strategic sales advisor. Use the context below to produce a thorough, grounded analysis.
${contextSection}

${workflowPrompts[workflowType] || workflowPrompts.brainstorm}

You MUST call the provided tool function with your structured result.`;

  const userPrompt = content || `Execute ${workflowType.replace(/_/g, " ")} workflow based on available context.`;

  const adapterReq: Omit<AdapterRequest, "model"> = {
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    temperature: route.temperature, maxTokens: route.maxTokens,
  };
  if (tool && route.primaryProvider !== "perplexity") {
    adapterReq.tools = [tool];
    adapterReq.toolChoice = { type: "function", function: { name: tool.function.name } };
  }
  if (route.reasoning) adapterReq.reasoning = route.reasoning;

  console.log(`[workflow] ${workflowType} provider=${route.primaryProvider} model=${route.model}`);

  const result = await callWithFallback(workflowType, adapterReq, route);

  if (result.error) {
    await supabase.from("strategy_workflow_runs").update({ status: "failed", error_json: { error: result.error.message } }).eq("id", run.id);
    const status = result.error.type === "timeout" ? 504 : result.error.type.includes("429") ? 429 : result.error.type.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: result.error.message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let structuredData = result.structured;
  let renderedText = "";

  // For Perplexity (deep_research), parse text into structured format
  if (!structuredData && workflowType === "deep_research" && result.text) {
    structuredData = {
      summary: result.text.slice(0, 500),
      company_overview: "",
      key_findings: result.text.split("\n").filter((l: string) => l.trim().startsWith("-") || l.trim().startsWith("•")).map((l: string) => l.replace(/^[-•]\s*/, "").trim()).slice(0, 10),
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

  await supabase.from("strategy_workflow_runs").update({ status: "completed", result_json: structuredData }).eq("id", run.id);

  let outputTitle = `${workflowType.replace(/_/g, " ")}`;
  if (pack.account) outputTitle = `${pack.account.name} — ${outputTitle}`;
  else if (pack.opportunity) outputTitle = `${pack.opportunity.name} — ${outputTitle}`;
  outputTitle += ` — ${new Date().toLocaleDateString()}`;

  const { data: output } = await supabase.from("strategy_outputs").insert({
    user_id: userId, thread_id: threadId, workflow_run_id: run.id,
    output_type: workflowTypeToOutputType(workflowType), title: outputTitle,
    content_json: structuredData, rendered_text: renderedText,
    linked_account_id: pack.account?.id || null, linked_opportunity_id: pack.opportunity?.id || null,
    provider_used: result.provider, model_used: result.model,
    fallback_used: result.fallbackUsed, latency_ms: result.latencyMs,
  }).select().single();

  const { data: resultMsg } = await supabase.from("strategy_messages").insert({
    thread_id: threadId, user_id: userId, role: "assistant", message_type: "workflow_result",
    provider_used: result.provider, model_used: result.model,
    fallback_used: result.fallbackUsed, latency_ms: result.latencyMs,
    content_json: {
      text: renderedText, structured: structuredData, workflowType, runId: run.id,
      outputId: output?.id || null, sources_used: pack.sourceCount,
      retrieval_meta: pack.retrievalMeta, model_used: result.model,
      provider_used: result.provider, fallback_used: result.fallbackUsed,
      citations: result.citations,
    },
  }).select().single();

  await supabase.from("strategy_threads").update({
    updated_at: new Date().toISOString(),
    summary: (structuredData.summary || structuredData.executive_summary || renderedText || "").slice(0, 200),
  }).eq("id", threadId);

  console.log(`[workflow] ${workflowType} completed. provider=${result.provider} model=${result.model} fallback=${result.fallbackUsed} latency=${result.latencyMs}ms output=${output?.id}`);
  triggerRollupAsync(supabase, threadId, userId);

  return new Response(JSON.stringify({
    resultMessage: resultMsg, output, workflowRun: run, structured: structuredData,
    sourceCount: pack.sourceCount, retrievalMeta: pack.retrievalMeta,
    modelUsed: result.model, providerUsed: result.provider, fallbackUsed: result.fallbackUsed,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── Rollup Handler ────────────────────────────────────────
async function handleRollup(supabase: any, threadId: string, userId: string, pack?: ContextPack) {
  if (!pack) pack = await buildContextPack(supabase, threadId, userId);
  if (pack.recentMessages.length < 3) {
    return new Response(JSON.stringify({ rollup: null, reason: "Not enough messages" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const conversationText = pack.recentMessages.map((m) => `${m.role}: ${m.text}`).join("\n").slice(0, 8000);
  let memoryContext = "";
  if (pack.memories.length > 0) {
    memoryContext = "\n\nExisting memory (avoid duplicating):\n" + pack.memories.slice(0, 10).map(m => `- [${m.memory_type}] ${m.content.slice(0, 100)}`).join("\n");
  }

  const route = resolveLLMRoute("rollup");
  const result = await callWithFallback("rollup", {
    messages: [
      { role: "system", content: `You are analyzing a strategy conversation thread. Summarize the key points, identify hypotheses, risks, open questions, and next steps. Also suggest memory entries that should be saved. Only suggest memories with confidence >= 0.6. Do NOT suggest memories that duplicate existing ones.${memoryContext}` },
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
      const existingContents = new Set(pack.memories.map((m: any) => m.content.toLowerCase().trim()));
      rollup.memory_suggestions = rollup.memory_suggestions
        .filter((s: any) => (s.confidence ?? 0) >= 0.6)
        .filter((s: any) => {
          const normalized = s.content.toLowerCase().trim();
          for (const existing of existingContents) {
            if (existing.includes(normalized) || normalized.includes(existing)) return false;
          }
          return true;
        });
    }

    await supabase.from("strategy_threads").update({ latest_rollup: rollup, updated_at: new Date().toISOString() }).eq("id", threadId);
    await supabase.from("strategy_rollups").insert({
      object_type: "thread", object_id: threadId, rollup_type: "summary",
      content_json: rollup, generated_from_thread_ids: [threadId], user_id: userId,
    });
    console.log(`[rollup] saved. provider=${result.provider} suggestions=${rollup.memory_suggestions?.length || 0}`);
  }

  return new Response(JSON.stringify({ rollup }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function triggerRollupAsync(supabase: any, threadId: string, userId: string) {
  handleRollup(supabase, threadId, userId).catch((e) => console.error("[auto-rollup] failed:", e));
}

function handleAIError(status: number) {
  if (status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted. Add funds in Settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ error: `AI gateway error: ${status}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
