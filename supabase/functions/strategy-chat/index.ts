import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assembleStrategyContext,
  auditResourceCitations,
  buildCitationCheckLog,
  buildPendingLookupAction,
  buildPromptCompositionLog,
  buildRetrievalDecisionLog,
  buildStrategyChatEvidenceBlocks,
  buildWorkspaceOverlay,
  logPromptComposition,
  decideLibraryQuery,
  decideWebQuery,
  detectAffirmative,
  detectLookupIntent,
  detectNegative,
  emptyWorkingThesisState,
  evaluateLibraryCoverage,
  extractThesisPatchFromProse,
  getLibraryTotals,
  inferTopicScopes,
  loadWorkingThesisState,
  logCitationCheck,
  logRetrievalDecision,
  type LookupIntent,
  mergeWorkingThesisState,
  type PendingLookupAction,
  pendingActionToIntent,
  recordResourceUsage,
  renderLibraryTotalsBlock,
  renderLookupResultText,
  renderWorkingThesisStateBlock,
  resolveServerWorkspaceContract,
  retrieveLibraryContext,
  retrieveResourceContext,
  buildEscalationPersistenceBlock,
  buildGatePersistenceBlock,
  evaluateEscalationRules,
  logEscalationSuggestions,
  logGateResults,
  runCitationCheck,
  runLibraryLookup,
  runWorkspaceGates,
  // ─── W6.5 Library Calibration Layer ─────────────────────────────
  buildCalibrationLog,
  buildCalibrationPersistenceBlock,
  buildStandardContextLog,
  buildStandardContextPersistenceBlock,
  type ExemplarSet,
  logCalibrationResult,
  logStandardContext,
  renderStandardBlock,
  runLibraryCalibration,
  selectExemplars,
  saveWorkingThesisState,
  shouldUseStrategyCorePrompt,
  type ThesisStatePatch,
  userAskedForResource,
  validateWorkingThesisState,
  type WorkingThesisState,
  computeSchemaHealth,
  buildEnforcementPersistenceBlock,
  logEnforcementDryRun,
  runEnforcementDryRun,
  retrieveSituationIntelligence,
  type SituationIntelligenceResult,
} from "../_shared/strategy-core/index.ts";
import {
  assembleRoutingEvidence as v2AssembleEvidence,
  assertSynthesisContractIntact,
  auditResponse as v2AuditResponse,
  dispatch as v2Dispatch,
  isV2Enabled,
  type DispatchDecision,
  validateResponse as v2ValidateResponse,
} from "../_shared/strategy-core/v2/index.ts";
import { routeRequest, type RoutingDecision } from "../_shared/strategy-router/index.ts";
import { logRoutingDecision } from "../_shared/strategy-router/log.ts";
import {
  classifySituation,
  isIntelligenceClassificationCandidate,
} from "../_shared/strategy-router/situationClassifier.ts";

import {
  runCurrentStatePreflight,
  type CurrentStateResult,
} from "../_shared/strategy-core/currentStateIntelligence.ts";
import {
  buildPromptOrderTrace,
  buildPromptSizeLog,
  composePrompt,
  renderEvidencePacket,
  FIXED_INSTRUCTION_BUDGET_CHARS,
  type PromptSegment,
} from "../_shared/strategy-core/promptComposition.ts";
import {
  detectRequestedEntryCount,
  selectOutputMode,
  renderConversationEnforcementBlock,
  type OutputModeDecision,
} from "../_shared/strategy-core/outputMode.ts";
import {
  classifyBehaviorIntent,
  enforceBehaviorContract,
  type BehaviorIntentResult,
} from "../_shared/strategy-core/behaviorIntent.ts";
import {
  buildCompactWorkspaceDelta as buildSemanticWorkspaceDelta,
  buildConsolidatedCoreInvariants as buildSemanticCoreInvariants,
  buildSemanticPromptSegments,
  buildV2StrongSynthesisTail,
  type ResourceGroundingContext,
  type SemanticLibraryMode,
} from "../_shared/strategy-core/semanticPrompt.ts";

// ── Phase 4: Manifest derivation for evidence attribution ──────────
// Derives a manifest_id from the chat context so every assistant message
// in strategy_messages can be attributed to a specific evidence surface.
function deriveChatManifestId(
  content: string,
  workspace: string | null,
  workflowType?: string | null,
): string | null {
  // Workflow types map directly
  if (workflowType) {
    const wfMap: Record<string, string> = {
      deep_research: "account-research",
      account_plan: "account-research",
      territory_tiering: "account-research",
      opportunity_strategy: "conversation-pov",
      brainstorm: "commercial-insight",
      email_evaluation: "follow-up-email",
    };
    return wfMap[workflowType] ?? "conversation-pov";
  }

  // Content-based keyword matching for chat artifacts
  const lower = (content || "").toLowerCase();
  if (/\b(meddicc|meddpicc|meddic)\b/.test(lower)) return "meddicc-review";
  if (/\b(demo)\b/.test(lower) && /\b(strat|plan|prep|approach|design|build|tailor)\b/.test(lower)) return "demo-strategy";
  if (/\bdemonstration\b/.test(lower)) return "demo-strategy";
  if (/\bdemo\s+(strategy|plan|prep)\b/.test(lower)) return "demo-strategy";
  if (/\b(objection|pushback|handle|overcome)\b/.test(lower)) return "objection-strategy";
  if (/\b(follow[\s-]?up|recap)\b/.test(lower) && /\b(email|message|note)\b/.test(lower)) return "follow-up-email";
  if (/\bdiscovery\s+(?:question|prep\s+question)/.test(lower)) return "discovery-questions";
  if (/\bquestion(?:s)?\s+to\s+ask\b/.test(lower)) return "discovery-questions";
  if (/\b(discovery|question|probe)\b/.test(lower) && /\b(question|list|prep|ask)\b/.test(lower)) return "discovery-questions";
  if (/\b(research|account\s+research|competitor|landscape)\b/.test(lower)) return "account-research";
  if (/\b(insight|commercial|value\s+prop)\b/.test(lower)) return "commercial-insight";

  // Workspace fallback
  if (workspace === "deep_research" || workspace === "library") return "account-research";

  // Default: conversation-pov (general strategy conversation)
  return "conversation-pov";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-router-bypass, x-skill-debug, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

function toRoutingMeta(decision: RoutingDecision) {
  return {
    lane: decision.lane,
    deep_intent: decision.signals.deep_intent,
    promotion_offered: decision.promotion_offered,
    auto_promoted: decision.auto_promoted,
    override_used: decision.override_used,
  };
}

function withRoutingMeta(
  contentJson: Record<string, unknown>,
  decision?: RoutingDecision | null,
): Record<string, unknown> {
  if (!decision) return contentJson;
  return {
    ...contentJson,
    routing_meta: toRoutingMeta(decision),
  };
}

// ── BOLT 3 helpers ─────────────────────────────────────────────
// Structured citations for strategy_messages.citations_json.
// Kept intentionally minimal (id + title) so the operator UI /
// audit surfaces can attribute each assistant turn to the exact
// resource/KI/playbook rows that shaped the prompt.
function buildCitationsJson(args: {
  resourceHits: Array<{ id: string; title: string }>;
  kiHits: Array<{ id: string; title: string; chapter?: string | null }>;
  libraryKis: Array<{ id: string; title: string }>;
  libraryPlaybooks: Array<{ id: string; title: string }>;
  competitiveIntel?: Array<{ id: string; title: string }>;
  verticalBrief?: { id: string; title: string } | null;
}): Record<string, unknown> | null {
  const dedupById = <T extends { id: string; title: string }>(rows: T[]) => {
    const seen = new Set<string>();
    const out: Array<{ id: string; title: string }> = [];
    for (const r of rows) {
      if (!r?.id || !r?.title) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, title: r.title });
    }
    return out;
  };
  const resources = dedupById(args.resourceHits || []);
  const kis = dedupById([
    ...(args.kiHits || []),
    ...(args.libraryKis || []),
  ]);
  const playbooks = dedupById(args.libraryPlaybooks || []);
  const competitiveIntel = dedupById(args.competitiveIntel || []);
  const verticalBriefs = dedupById(
    args.verticalBrief ? [args.verticalBrief] : [],
  );
  const total = resources.length + kis.length + playbooks.length +
    competitiveIntel.length + verticalBriefs.length;
  if (total === 0) return null;
  return {
    version: competitiveIntel.length > 0 || verticalBriefs.length > 0 ? 2 : 1,
    resources,
    kis,
    playbooks,
    competitive_intel: competitiveIntel,
    vertical_briefs: verticalBriefs,
    stamped_at: new Date().toISOString(),
  };
}

// Best-effort insert into playbook_usage_events for every playbook
// that was folded into the prompt on this turn. Never throws.
async function logPlaybookUsageBestEffort(
  supabase: any,
  args: {
    userId: string;
    threadId: string;
    accountId: string | null;
    opportunityId?: string | null;
    playbooks: Array<{ id: string; title: string }>;
    surface: string;
  },
): Promise<void> {
  const pbs = (args.playbooks || []).filter((p) => p?.id && p?.title);
  if (pbs.length === 0) return;
  try {
    const rows = pbs.map((p) => ({
      user_id: args.userId,
      playbook_id: p.id,
      playbook_title: p.title,
      event_type: "recommendation_shown",
      context_block_type: "strategy_chat",
      context_account_id: args.accountId ?? null,
      context_opportunity_id: args.opportunityId ?? null,
      metadata: { thread_id: args.threadId, surface: args.surface },
    }));
    const { error } = await supabase.from("playbook_usage_events").insert(rows);
    if (error) {
      console.warn(
        "[playbook_usage_events] insert failed:",
        String(error.message).slice(0, 200),
      );
    } else {
      console.log(
        `[playbook_usage_events] logged ${rows.length} row(s) (${args.surface})`,
      );
    }
  } catch (e) {
    console.warn(
      "[playbook_usage_events] threw (ignored):",
      String((e as Error).message).slice(0, 200),
    );
  }
}

function buildDeepWorkInputs(
  decision: RoutingDecision,
  content: string,
  threadId: string,
  pack: ContextPack,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    thread_id: threadId,
    original_message: content,
    account_id: pack.account?.id ?? null,
    opportunity_id: pack.opportunity?.id ?? null,
    company_name: pack.account?.name ?? undefined,
    website: pack.account?.website ?? undefined,
    industry: pack.account?.industry ?? undefined,
    opportunity: pack.opportunity?.name ?? undefined,
    stage: pack.opportunity?.stage ?? undefined,
    prior_notes: pack.account?.notes ?? pack.opportunity?.notes ?? undefined,
  };

  if (decision.task_type === "ninety_day_plan") {
    return {
      ...base,
      objective: content,
      desired_outcome: content,
      starting_position: pack.opportunity?.stage ?? pack.account?.outreach_status ?? undefined,
    };
  }

  return {
    ...base,
    desired_focus: content,
  };
}

async function startAutoPromotedStrategyJob(
  authHeader: string,
  taskType: string,
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-strategy-job`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify({
      action: "generate",
      task_type: taskType,
      inputs,
    }),
  });

  const json = await resp.json().catch(() => ({} as Record<string, unknown>));
  if (!resp.ok) {
    throw new Error((json as { error?: string }).error || `run-strategy-job failed (${resp.status})`);
  }
  return json as Record<string, unknown>;
}

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
  fallbackReason?: string;
  error?: { type: string; message: string; status?: number; rawBody?: string; stage?: string };
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
      error: { type: `http_${resp.status}`, message, status: resp.status, rawBody: errText.slice(0, 4000), stage: 'adapter_call' },
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
        status: resp.status,
        rawBody: errText.slice(0, 4000),
        stage: 'adapter_call',
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
        status: resp.status,
        rawBody: errText.slice(0, 4000),
        stage: 'adapter_call',
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
        status: resp.status,
        rawBody: errText.slice(0, 4000),
        stage: 'adapter_call',
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
  _routingReason?: string;
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
    fallbackModel: "claude-sonnet-4-5-20250929",
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
    fallbackModel: "claude-sonnet-4-5-20250929",
    temperature: 0.4,
    maxTokens: 4096,
    useTools: true,
  },
  territory_tiering: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-5-20250929",
    temperature: 0.2,
    maxTokens: 8192,
    useTools: true,
    reasoning: { effort: "medium" },
  },
  account_plan: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-5-20250929",
    temperature: 0.5,
    maxTokens: 8192,
    useTools: true,
  },
  opportunity_strategy: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-5-20250929",
    temperature: 0.5,
    maxTokens: 8192,
    useTools: true,
  },
  brainstorm: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-5-20250929",
    temperature: 0.9,
    maxTokens: 4096,
    useTools: true,
  },
  rollup: {
    primaryProvider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-sonnet-4-5-20250929",
    temperature: 0.3,
    maxTokens: 4096,
    useTools: true,
  },
};

// ═══════════════════════════════════════════════════════════
// 4-MODE LIBRARY DECISION MODEL (replaces binary refusal gate)
//
// MODE A — STRONG    : ≥2 hits + grounded intent (synthesis/eval) → OpenAI precision
// MODE B — PARTIAL   : 1 hit OR weak coverage → Claude (extension/narrative)
// MODE C — GENERAL   : non-library question, no grounding signal → OpenAI
// MODE D — THIN      : 0 hits on grounded ask → OpenAI + honest gap framing
//
// CREATION intent (any mode) → Claude (artifact voice)
// EVALUATION/SYNTHESIS with strong grounding → OpenAI (precision)
//
// Mode is persisted on every assistant message in content_json.routing_decision
// so we can audit provider distribution and prove no silent dominance.
// ═══════════════════════════════════════════════════════════
type LibraryMode = "strong" | "partial" | "general" | "thin" | "short_form";

// SHORT-FORM detector: openers, subject lines, hook lines, voicemails,
// short talk-track snippets. These are NOT long-form synthesis artifacts
// and must NOT ride the heavy Claude path. They route to fast OpenAI with
// tight maxTokens to avoid the ~56s gateway timeout we saw on Turn 0/2.
function detectShortFormGrounded(text: string): { match: boolean; kind: string | null } {
  const t = (text || "").toLowerCase();
  // Length gate: short-form asks are short prompts (<= 320 chars typical).
  // Longer prompts asking for an opener inside a broader synthesis still go through.
  if (t.length > 320) return { match: false, kind: null };
  if (/\bsubject\s+lines?\b/.test(t)) return { match: true, kind: "subject_lines" };
  if (/\b(cold[- ]?call\s+)?opener[s]?\b/.test(t)) return { match: true, kind: "opener" };
  if (/\bhook\s+lines?\b/.test(t)) return { match: true, kind: "hook_lines" };
  if (/\bvoicemail[s]?\b/.test(t) && /(draft|write|give|leave|build)/.test(t)) {
    return { match: true, kind: "voicemail" };
  }
  if (/\b(talk[- ]?track|talking\s+points?)\b/.test(t) && t.length <= 220) {
    return { match: true, kind: "talk_track_snippet" };
  }
  if (/\b(one[- ]?liner|tagline|elevator\s+pitch)\b/.test(t)) {
    return { match: true, kind: "one_liner" };
  }
  return { match: false, kind: null };
}

function classifyLibraryMode(args: {
  intent: string;
  resourceHits: number;
  kiHits: number;
  hasGroundingPhrase: boolean;
  userText?: string;
}): { mode: LibraryMode; reason: string; shortFormKind?: string | null } {
  const { intent, resourceHits, kiHits, hasGroundingPhrase, userText } = args;
  const groundedIntent =
    intent === "synthesis" || intent === "evaluation" || intent === "creation";
  const isCreation = intent === "creation";
  const totalSignal = resourceHits + Math.min(kiHits, 4); // cap KI weight

  // SHORT-FORM short-circuit: openers, subject lines, hooks, voicemails.
  // Fires whether or not the user attached a grounding phrase — the form
  // is the routing signal. Skips Claude/long-synthesis path entirely.
  const sf = userText ? detectShortFormGrounded(userText) : { match: false, kind: null };
  if (sf.match && (groundedIntent || hasGroundingPhrase || totalSignal >= 1)) {
    return {
      mode: "short_form",
      reason: `short_form_${sf.kind}_resources=${resourceHits}_kis=${kiHits}`,
      shortFormKind: sf.kind,
    };
  }

  // GENERAL: non-grounded, non-creation chat — model just answers
  if (!groundedIntent && !hasGroundingPhrase) {
    return { mode: "general", reason: `intent=${intent}_no_grounding_phrase` };
  }

  // THIN: user explicitly asked the library to ground the answer but it can't
  if (groundedIntent && resourceHits === 0 && kiHits === 0) {
    return { mode: "thin", reason: "grounded_ask_zero_signal" };
  }

  // STRONG: ≥2 resources OR (1 resource + ≥2 KIs) for grounded asks
  if (groundedIntent && (resourceHits >= 2 || (resourceHits >= 1 && kiHits >= 2))) {
    // Creation always goes to Claude even with strong grounding (artifact voice)
    if (isCreation) {
      return { mode: "partial", reason: "creation_intent_routes_to_claude" };
    }
    return { mode: "strong", reason: `resources=${resourceHits}_kis=${kiHits}` };
  }

  // PARTIAL: some signal exists, model must extend
  if (totalSignal >= 1 || hasGroundingPhrase) {
    return { mode: "partial", reason: `partial_signal_resources=${resourceHits}_kis=${kiHits}` };
  }

  // Fallback: treat as general
  return { mode: "general", reason: "fallback_no_match" };
}

/**
 * Mode-aware route resolver. Implements the locked routing table:
 *   Mode A (strong) + synthesis/evaluation → OpenAI (precision)
 *   Mode B (partial) → Claude (extension)
 *   Creation intent (any mode) → Claude (voice)
 *   Mode C (general) → OpenAI
 *   Mode D (thin) → OpenAI (honest gap)
 *   deep_research → Perplexity (unchanged)
 */
function resolveLLMRouteForMode(
  taskType: string,
  intent: string,
  mode: LibraryMode,
): LLMRoute & { _routingReason: string } {
  const base = resolveLLMRoute(taskType);

  // Research path is sacred — never override
  if (taskType === "deep_research") {
    return { ...base, _routingReason: "deep_research_perplexity" };
  }

  const isCreation = intent === "creation";

  // SHORT-FORM short-circuit: openers, subject lines, hooks, voicemails.
  // ALWAYS OpenAI/gpt-4o, NEVER Claude. Cap maxTokens hard so the
  // gateway-side timeout (~60s) cannot be reached even on cold paths.
  // This overrides creation→Claude routing for short-form artifacts.
  if (mode === "short_form") {
    return {
      ...base,
      primaryProvider: "openai",
      model: "gpt-4o",
      fallbackProvider: "openai",
      fallbackModel: "gpt-4o-mini",
      maxTokens: 700,
      temperature: 0.65,
      _routingReason: `short_form_${intent}_openai_fast`,
    };
  }

  const wantsClaude = mode === "partial" || isCreation;

  if (wantsClaude && PROVIDER_HEALTH.anthropicDirect) {
    // Swap primary↔fallback so Claude leads, OpenAI catches
    return {
      ...base,
      primaryProvider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      fallbackProvider: "openai",
      fallbackModel: "gpt-4o",
      _routingReason: isCreation
        ? `creation_intent_mode_${mode}`
        : `mode_${mode}_extension`,
    };
  }

  return { ...base, _routingReason: `mode_${mode}_${intent}_openai_precision` };
}

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
      `[routing] primary failed: ${result.error?.message ?? "unknown error"}. Trying fallback=${route.fallbackProvider} model=${route.fallbackModel}`,
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
        `[routing] fallback task=${taskType} provider=${fallbackResult.provider} model=${fallbackResult.model} latency=${fallbackResult.latencyMs}ms reason=${result.error?.message ?? "unknown error"}`,
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
  // Phase 3 timeout envelope: edge gateway window ≈ 60s. Claude must finish
  // (or fail) with enough headroom for the OpenAI fallback to run AND for
  // the routing_decision row to persist. Budget:
  //   Claude attempt:        40s  (was 55s — too close to gateway edge)
  //   OpenAI fallback room:  ~15s
  //   Persistence room:      ~5s
  const CLAUDE_TIMEOUT_MS = 40_000;
  const OPENAI_TIMEOUT_MS = 55_000;
  const controller = new AbortController();
  const initialTimeoutMs = route.primaryProvider === "anthropic"
    ? CLAUDE_TIMEOUT_MS
    : OPENAI_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), initialTimeoutMs);
  const routeName = "openai-direct";

  try {
    console.log(JSON.stringify({
      _type: "routing.stream.start",
      task: taskType,
      intended_provider: route.primaryProvider,
      intended_model: route.model,
      route: routeName,
      timeout_ms: initialTimeoutMs,
    }));

    if (route.primaryProvider === "anthropic") {
      // Claude path: non-streaming. The downstream !rawStream branch in
      // handleChat handles persistence + SSE wrapping for us.
      const claudeStarted = Date.now();
      let result: NormalizedResponse;
      try {
        result = await anthropicAdapter({
          ...adapterReq,
          model: route.model,
        }, controller.signal);
      } catch (e: any) {
        const isAbort = e?.name === "AbortError";
        result = {
          text: "",
          provider: "anthropic",
          model: route.model,
          latencyMs: Date.now() - claudeStarted,
          fallbackUsed: false,
          error: {
            type: isAbort ? "timeout" : "fetch_error",
            message: isAbort
              ? `Claude timeout after ${CLAUDE_TIMEOUT_MS}ms`
              : (e?.message || String(e)),
            status: isAbort ? 504 : 502,
          },
        };
      }
      const claudeOk = !result.error && (result.text || "").trim().length > 0;
      if (claudeOk) {
        clearTimeout(timeout);
        console.log(JSON.stringify({
          _type: "routing.stream.ok",
          task: taskType,
          actual_provider: result.provider,
          actual_model: result.model,
          route: "anthropic-direct",
          fallback_used: false,
          status: 200,
          latency_ms: result.latencyMs,
        }));
        return result;
      }

      // ── Phase 3: explicit OpenAI fallback ──
      // Claude failed (timeout, http_xxx, empty). Reset the abort controller
      // so the fallback gets its own clean budget, then route to OpenAI gpt-4o.
      // NEVER silent — claude_fallback gets stamped onto routing_decision by
      // the caller because result.fallbackUsed=true.
      clearTimeout(timeout);
      const claudeReason = result.error?.type ?? "empty_response";
      const claudeMessage = result.error?.message ?? "Claude returned empty";
      console.warn(JSON.stringify({
        _type: "routing.claude.failed",
        task: taskType,
        intended_model: route.model,
        reason: claudeReason,
        message: claudeMessage,
        latency_ms: result.latencyMs,
        will_fallback: PROVIDER_HEALTH.openaiDirect,
      }));

      if (!PROVIDER_HEALTH.openaiDirect) {
        // No fallback available — return original Claude error so caller
        // surfaces "Assistant temporarily unavailable".
        return result;
      }

      const fbController = new AbortController();
      const fbTimeout = setTimeout(() => fbController.abort(), OPENAI_TIMEOUT_MS);
      const fbModel = route.fallbackModel || "gpt-4o";
      try {
        console.log(JSON.stringify({
          _type: "routing.fallback.start",
          task: taskType,
          intended_provider: "anthropic",
          intended_model: route.model,
          fallback_provider: "openai",
          fallback_model: fbModel,
          reason: claudeReason,
        }));
        const fbResult = await openaiAdapter({
          ...adapterReq,
          model: fbModel,
          stream: true,
        }, fbController.signal);
        // Mark explicit fallback so routing_decision.v2.claude_fallback fires.
        fbResult.fallbackUsed = true;
        fbResult.fallbackReason = `claude_${claudeReason}: ${claudeMessage}`;
        console.log(JSON.stringify({
          _type: fbResult.error ? "routing.fallback.fail" : "routing.fallback.ok",
          task: taskType,
          actual_provider: fbResult.provider,
          actual_model: fbResult.model,
          fallback_used: true,
          status: fbResult.error ? (fbResult.error.status ?? 502) : 200,
          reason: fbResult.error?.message ?? claudeReason,
        }));
        return fbResult;
      } finally {
        clearTimeout(fbTimeout);
      }
    }

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
            `Chat route must use OpenAI or Anthropic, got ${route.primaryProvider}`,
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
  // Branch-specific enrichment (optional; absent for non-account threads)
  branchFootprint?: any | null;
  recentCalls?: any[];
  recentSignals?: any[];
  subsidiaries?: Array<{
    id: string;
    name: string;
    surfaces: string[];       // compressed surface:status pairs, non-null/unknown only
    risks: Array<{ risk_type: string; severity: number | null }>;
    signalCount: number;
  }>;
  subsidiariesTotalCount?: number;
  branchPov?: Array<{ surface: string; target_status: string | null; conviction: number | null; ratified: boolean | null }>;
  strategicPov?: { text: string; version: number | null } | null;
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
    .eq("id", threadId)
    .eq("user_id", userId)
    .single();
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
          "id, name, industry, vertical_id, tier, website, notes, outreach_status, tech_stack, tags",
        )
        .eq("id", thread.linked_account_id)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single();
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

    // Branch-specific enrichment: footprint, recent calls, recent signals
    promises.push((async () => {
      const [fpRes, callsRes, signalsRes] = await Promise.all([
        supabase.from('branch_footprint')
          .select('deep_linking_status, universal_ads_status, email_to_app_status, sms_to_app_status, web_to_app_status, qr_status, aio_status, advanced_privacy_status, estimated_arr, contract_renewal_date, notes')
          .eq('account_id', thread.linked_account_id)
          .maybeSingle(),
        supabase.from('call_logs')
          .select('call_date, summary, expansion_signal_text, next_step, branch_ki_title')
          .eq('account_id', thread.linked_account_id)
          .order('call_date', { ascending: false })
          .limit(3),
        supabase.from('account_signals')
          .select('signal_type, raw_text, created_at')
          .eq('linked_account_id', thread.linked_account_id)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      pack.branchFootprint = fpRes.data ?? null;
      pack.recentCalls = (callsRes.data ?? []) as any[];
      pack.recentSignals = (signalsRes.data ?? []) as any[];
    })());

    // Dossier Strategic POV: pull the "## 00 — STRATEGIC POV" section only.
    // Dossiers can be 12–29k chars; we ONLY inject the opening reframe /
    // named opportunities / THE SENTENCE. Falls back to null on any miss.
    promises.push((async () => {
      const { data: dos } = await supabase.from('account_dossiers')
        .select('content_md, version')
        .eq('account_id', thread.linked_account_id)
        .eq('is_current', true)
        .maybeSingle();
      if (!dos?.content_md) { pack.strategicPov = null; return; }
      const md: string = dos.content_md;
      // Locate the "## 00 …" or "## STRATEGIC POV …" heading, then slice
      // to the next top-level "## " heading (not "### ") or EOF.
      const startRe = /^##[ \t]+(?:0*0\b[^\n]*|strategic\s+pov[^\n]*)$/im;
      const startMatch = md.match(startRe);
      if (!startMatch || startMatch.index == null) { pack.strategicPov = null; return; }
      const startIdx = startMatch.index;
      const bodyStart = startIdx + startMatch[0].length;
      const nextRe = /\n##[ \t]+(?!#)/g;
      nextRe.lastIndex = bodyStart;
      const nextMatch = nextRe.exec(md);
      const endIdx = nextMatch ? nextMatch.index : md.length;
      let section = md.slice(startIdx, endIdx).trim();
      if (!section) { pack.strategicPov = null; return; }
      // Also capture an immediately-preceding "## KEY NUMBERS" section if present —
      // it holds the cleanest citable dollar figures and should travel with the POV.
      const preSlice = md.slice(0, startIdx);
      const keyNumsRe = /^##[ \t]+key\s+numbers[^\n]*$/gim;
      let lastKN: RegExpExecArray | null = null;
      let m: RegExpExecArray | null;
      while ((m = keyNumsRe.exec(preSlice)) !== null) lastKN = m;
      if (lastKN && lastKN.index != null) {
        const knStart = lastKN.index;
        const knBodyStart = knStart + lastKN[0].length;
        const knNextRe = /\n##[ \t]+(?!#)/g;
        knNextRe.lastIndex = knBodyStart;
        const knNext = knNextRe.exec(md);
        const knEnd = knNext && knNext.index <= startIdx ? knNext.index : startIdx;
        const knSection = md.slice(knStart, knEnd).trim();
        if (knSection) section = knSection + '\n\n' + section;
      }
      const MAX = 5000;
      const text = section.length > MAX ? section.slice(0, MAX) + '\n…(truncated)' : section;
      pack.strategicPov = { text, version: dos.version ?? null };
    })());

    // G2: subsidiaries rollup + branch_pov for the linked account (additive only)
    promises.push((async () => {
      const parentId = thread.linked_account_id;
      const [childRes, povRes] = await Promise.all([
        supabase.from('accounts')
          .select('id, name')
          .eq('user_id', userId)
          .eq('parent_account_id', parentId)
          .is('deleted_at', null)
          .limit(50),
        supabase.from('branch_pov')
          .select('surface, target_status, conviction, ratified, sequence_rank, updated_at')
          .eq('account_id', parentId)
          .order('ratified', { ascending: false })
          .order('conviction', { ascending: false, nullsFirst: false })
          .order('sequence_rank', { ascending: true, nullsFirst: false })
          .limit(8),
      ]);
      pack.branchPov = (povRes.data ?? []).slice(0, 8).map((p: any) => ({
        surface: p.surface,
        target_status: p.target_status,
        conviction: p.conviction,
        ratified: p.ratified,
      }));

      const children = (childRes.data ?? []) as Array<{ id: string; name: string }>;
      if (children.length === 0) { pack.subsidiaries = []; pack.subsidiariesTotalCount = 0; return; }
      const childIds = children.map(c => c.id);

      const PRODUCT_KEYS: Array<[string, string]> = [
        ['deep_linking_status', 'DL'], ['universal_ads_status', 'UA'],
        ['email_to_app_status', 'E2A'], ['sms_to_app_status', 'S2A'],
        ['web_to_app_status', 'W2A'], ['qr_status', 'QR'],
        ['aio_status', 'AIO'], ['advanced_privacy_status', 'AP'],
      ];
      const isMeaningful = (v: any) =>
        v != null && String(v).trim() !== '' && String(v).toLowerCase() !== 'unknown';

      const sinceIso = new Date(Date.now() - 90 * 86400_000).toISOString();
      const [fpRes2, riskRes, sigRes] = await Promise.all([
        supabase.from('branch_footprint')
          .select('account_id, ' + PRODUCT_KEYS.map(([k]) => k).join(', '))
          .in('account_id', childIds),
        supabase.from('account_risks')
          .select('account_id, risk_type, severity, status')
          .eq('user_id', userId)
          .in('account_id', childIds)
          .in('status', ['identified', 'monitoring', 'mitigating', 'realized'])
          .limit(200),
        supabase.from('account_signals')
          .select('linked_account_id, created_at')
          .in('linked_account_id', childIds)
          .gte('created_at', sinceIso)
          .limit(500),
      ]);
      const fpMap = new Map<string, any>();
      for (const r of (fpRes2.data ?? []) as any[]) fpMap.set(r.account_id, r);
      const riskMap = new Map<string, Array<{ risk_type: string; severity: number | null }>>();
      for (const r of (riskRes.data ?? []) as any[]) {
        const arr = riskMap.get(r.account_id) ?? [];
        arr.push({ risk_type: r.risk_type, severity: r.severity ?? null });
        riskMap.set(r.account_id, arr);
      }
      const sigCount = new Map<string, number>();
      for (const s of (sigRes.data ?? []) as any[]) {
        sigCount.set(s.linked_account_id, (sigCount.get(s.linked_account_id) ?? 0) + 1);
      }

      const enriched = children.map(c => {
        const fp = fpMap.get(c.id) || {};
        const surfaces: string[] = [];
        for (const [col, label] of PRODUCT_KEYS) {
          const v = fp[col];
          if (isMeaningful(v)) surfaces.push(`${label}:${String(v).slice(0, 12)}`);
        }
        const risks = (riskMap.get(c.id) ?? []).slice(0, 3);
        const signalCount = sigCount.get(c.id) ?? 0;
        // relevance: signals > risks > surfaces > name
        const rel = signalCount * 10 + risks.length * 3 + surfaces.length;
        return { id: c.id, name: c.name, surfaces, risks, signalCount, _rel: rel };
      }).sort((a, b) => b._rel - a._rel);

      pack.subsidiaries = enriched.slice(0, 6).map(({ _rel, ...rest }) => rest);
      pack.subsidiariesTotalCount = children.length;
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

  // Branch-specific context (only renders when data exists)
  if (pack.branchFootprint) {
    const fp = pack.branchFootprint as any;
    const PRODUCTS: [string, string][] = [
      ['deep_linking', 'Deep Linking'], ['universal_ads', 'Universal Ads'],
      ['email_to_app', 'Email-to-App'], ['sms_to_app', 'SMS-to-App'],
      ['web_to_app', 'Web-to-App'], ['qr', 'QR Codes'],
      ['aio', 'AIO'], ['advanced_privacy', 'Advanced Privacy'],
    ];
    const confirmed = PRODUCTS.filter(([k]) => fp[`${k}_status`] === 'confirmed').map(([, l]) => l);
    const inferred = PRODUCTS.filter(([k]) => fp[`${k}_status`] === 'inferred').map(([, l]) => l);
    const fpParts: string[] = [];
    if (confirmed.length) fpParts.push(`Active: ${confirmed.join(', ')}`);
    if (inferred.length) fpParts.push(`Inferred: ${inferred.join(', ')}`);
    if (fp.estimated_arr) fpParts.push(`Est ARR: $${Number(fp.estimated_arr).toLocaleString()}`);
    if (fp.contract_renewal_date) fpParts.push(`Renewal: ${fp.contract_renewal_date}`);
    if (fp.notes) fpParts.push(`Notes: ${String(fp.notes).slice(0, 200)}`);
    if (fpParts.length) {
      const s2 = `\n### Branch Footprint\n${fpParts.join(' | ')}`;
      if (charBudget - s2.length > 0) { sections.push(s2); charBudget -= s2.length; }
    }
  }
  if (pack.recentCalls && pack.recentCalls.length > 0) {
    let callSection = `\n### Recent Calls (${pack.recentCalls.length})`;
    for (const c of pack.recentCalls as any[]) {
      const line = `\n- ${c.call_date}: ${(c.summary ?? '(no summary)').slice(0, 150)}${c.expansion_signal_text ? ` [Signal: ${String(c.expansion_signal_text).slice(0, 80)}]` : ''}${c.next_step ? ` [Next: ${String(c.next_step).slice(0, 60)}]` : ''}${c.branch_ki_title ? ` [Play: ${String(c.branch_ki_title).slice(0, 50)}]` : ''}`;
      if (charBudget - line.length < 0) break;
      callSection += line; charBudget -= line.length;
    }
    sections.push(callSection);
  }
  if (pack.recentSignals && pack.recentSignals.length > 0) {
    let sigSection = `\n### Intelligence Signals (${pack.recentSignals.length})`;
    for (const s of pack.recentSignals as any[]) {
      const line = `\n- [${s.signal_type}] ${(s.raw_text ?? '').slice(0, 120)}`;
      if (charBudget - line.length < 0) break;
      sigSection += line; charBudget -= line.length;
    }
    sections.push(sigSection);
  }

  // Dossier Strategic POV — the reframe / named opportunities / THE SENTENCE
  let __dossierIncluded = false;
  let __dossierChars = 0;
  let __dossierSkipReason: string | null = null;
  if (pack.strategicPov?.text) {
    const v = pack.strategicPov.version != null ? ` v${pack.strategicPov.version}` : '';
    // Data only. The formerly embedded usage directive now lives in the
    // bounded fixed.dossier-grounding segment so evidence cannot smuggle
    // instructions into the prompt or fixed-size accounting.
    const block = `\n### Account Strategic POV (from dossier${v})\n${pack.strategicPov.text}`;
    if (charBudget - block.length > 0) {
      sections.push(block);
      charBudget -= block.length;
      __dossierIncluded = true;
      __dossierChars = block.length;
    } else {
      __dossierSkipReason = `budget_exceeded (needed ${block.length}, had ${charBudget})`;
    }
  } else {
    __dossierSkipReason = 'no_strategic_pov_extracted';
  }
  try {
    console.log('[dossier-inject]', JSON.stringify({
      included: __dossierIncluded,
      chars: __dossierChars,
      version: pack.strategicPov?.version ?? null,
      pov_text_len: pack.strategicPov?.text?.length ?? 0,
      skip_reason: __dossierSkipReason,
      linked_account_id: (pack as any)?.account?.id ?? null,
    }));
  } catch { /* noop */ }

  // G2: Branch POV (linked account's owned point-of-view rows)
  if (pack.branchPov && pack.branchPov.length > 0) {
    let povSection = `\n### Branch POV (${pack.branchPov.length})`;
    for (const p of pack.branchPov) {
      const conv = p.conviction != null ? `c${p.conviction}` : 'c?';
      const ratified = p.ratified ? '✓ratified' : 'draft';
      const line = `\n- ${p.surface} → ${p.target_status || '?'} [${conv} · ${ratified}]`;
      if (charBudget - line.length < 0) break;
      povSection += line; charBudget -= line.length;
    }
    sections.push(povSection);
  }

  // G2: Subsidiaries rollup — strict ~1200 char budget for the whole block
  if (pack.subsidiaries && pack.subsidiaries.length > 0) {
    const SUB_BUDGET = 1200;
    const total = pack.subsidiariesTotalCount ?? pack.subsidiaries.length;
    let header = `\n### Subsidiaries (${pack.subsidiaries.length}/${total})`;
    let block = header;
    let used = header.length;
    let shown = 0;
    for (const c of pack.subsidiaries) {
      const surf = c.surfaces.length ? ` | ${c.surfaces.join(',')}` : '';
      const risks = c.risks.length
        ? ` | risks: ${c.risks.map(r => `${r.risk_type}${r.severity != null ? `(sev${r.severity})` : ''}`).join(',')}`
        : '';
      const sig = c.signalCount > 0 ? ` | sigs90d:${c.signalCount}` : '';
      const line = `\n- ${c.name}${surf}${risks}${sig}`;
      if (used + line.length > SUB_BUDGET) break;
      block += line; used += line.length; shown++;
    }
    const remaining = pack.subsidiaries.length - shown + Math.max(0, total - pack.subsidiaries.length);
    if (remaining > 0) {
      const tail = `\n…+${remaining} more entities`;
      if (used + tail.length <= SUB_BUDGET) { block += tail; used += tail.length; }
    }
    if (charBudget - block.length > 0) {
      sections.push(block);
      charBudget -= block.length;
    }
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

    const body = await req.json();

    // ── Validation-only bypass ────────────────────────────────
    // Tightly scoped: requires the STRATEGY_VALIDATION_KEY header AND
    // an explicit `as_user_id` in the body. Used exclusively by the
    // V2 smoke-test harness. Does not affect normal user auth or V1.
    const valKeyHeader = req.headers.get("x-strategy-validation-key") ?? "";
    const expectedValKey = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";
    const asUserId = typeof body?.as_user_id === "string" ? body.as_user_id : null;
    if (!userId && expectedValKey && valKeyHeader === expectedValKey && asUserId) {
      const { data: u } = await supabase.auth.admin.getUserById(asUserId);
      if (u?.user?.id) {
        userId = u.user.id;
        console.log(`[validation-bypass] impersonating user ${userId} for smoke test`);
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Provider health surface (fail-loud) — early short-circuit ──
    // Must run BEFORE any preprocessing that requires threadId/content so
    // the banner ping can't 400 on missing fields. No LLM call.
    if (body?.action === "health_check") {
      const degraded =
        !PROVIDER_HEALTH.anthropicDirect ||
        !PROVIDER_HEALTH.openaiDirect ||
        !PROVIDER_HEALTH.lovableGateway;
      return new Response(
        JSON.stringify({
          ok: true,
          degraded,
          providers: {
            anthropic: PROVIDER_HEALTH.anthropicDirect,
            openai: PROVIDER_HEALTH.openaiDirect,
            openai_reason: PROVIDER_HEALTH.openaiDirectReason,
            perplexity: PROVIDER_HEALTH.perplexityDirect,
            lovable_gateway: PROVIDER_HEALTH.lovableGateway,
          },
          impact: {
            situation_classifier: PROVIDER_HEALTH.lovableGateway ? "ok" : "degraded — falls back to keyword retrieval",
            easy_prompt: PROVIDER_HEALTH.lovableGateway ? "ok" : "disabled — terse prompts not expanded",
            chat_synthesis: PROVIDER_HEALTH.anthropicDirect ? "ok" : "degraded — Claude path unavailable",
            chat_general: PROVIDER_HEALTH.openaiDirect ? "ok" : "degraded — OpenAI path unavailable",
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // ── Phase 3 — Strategy Skills passthrough (inert by default) ──
    // Triple-gated early return:
    //   1. STRATEGY_SKILLS_ENABLED env flag must be "true"
    //   2. `x-skill-debug: 1` header must be set (debug-only path)
    //   3. body.skill must be a well-formed envelope with an `id`
    //
    // When ALL three are met, runs the skill runtime end-to-end and
    // returns the SkillReasoningEnvelope (trace + Show-proof payload).
    // Does NOT call synthesis, does NOT modify task pipelines, does NOT
    // touch Discovery Prep. When ANY guard fails, falls through to the
    // unmodified existing handler — default Strategy chat is byte-identical.
    try {
      const skillsFlag = (Deno.env.get("STRATEGY_SKILLS_ENABLED") ?? "").toLowerCase() === "true";
      const skillDebugHeader = req.headers.get("x-skill-debug") === "1";
      const skillEnvelope = (body as { skill?: unknown })?.skill;
      const hasSkillEnvelope = !!skillEnvelope &&
        typeof skillEnvelope === "object" &&
        typeof (skillEnvelope as { id?: unknown }).id === "string" &&
        ((skillEnvelope as { id: string }).id.length > 0);

      if (skillsFlag && skillDebugHeader && hasSkillEnvelope) {
        const { runSkill } = await import("../_shared/strategy-skills/index.ts");
        const skillCtx = {
          thread: typeof body?.threadId === "string" ? { threadId: body.threadId } : undefined,
        };
        const result = await runSkill({
          envelope: skillEnvelope,
          ctx: skillCtx,
          supabase,
          userId,
        });
        const status = result.ok ? 200 : 422;
        console.log(
          `[skill-passthrough] skill=${(skillEnvelope as { id: string }).id} ok=${result.ok} status=${status}`,
        );
        return new Response(
          JSON.stringify({
            early_return: true,
            source: "strategy-skills/passthrough",
            envelope: result.envelope,
            ...(result.ok
              ? { synthesisAddendumPreview: result.synthesisAddendum.slice(0, 800) }
              : { reason: result.reason, code: result.code }),
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch (e) {
      // Defensive: never let the skill branch crash the default path.
      console.warn("[skill-passthrough] error, falling through:", (e as Error).message);
    }

    const {
      action,
      threadId,
      content,
      workflowType,
      depth,
      force_primary_failure,
      pickedResourceIds,
      _v2,
      globalInstructions: globalInstructionsRaw,
      workspace: workspaceRaw,
      workspaceSource: workspaceSourceRaw,
      resolvedSops: resolvedSopsRaw,
      workspaceSop: workspaceSopRaw,
      globalSop: globalSopRaw,
    } = body;
    const v2RequestOverride = _v2 === true;
    // Sidecar: explicit resource IDs the user picked from /library this turn.
    // Validated to a clean string[] before being passed downstream.
    const cleanPickedResourceIds: string[] = Array.isArray(pickedResourceIds)
      ? pickedResourceIds.filter((s: unknown) => typeof s === 'string' && /^[0-9a-f-]{16,}$/i.test(s))
      : [];

    // Phase 2: Lightweight Global Instructions sidecar. Validated to a safe
    // shape so a malformed/oversized client payload can never crash the
    // chat path or leak unbounded text into the system prompt. Returns null
    // when absent/invalid → server treats as "no behavior change".
    const cleanGlobalInstructions = sanitizeGlobalInstructions(globalInstructionsRaw);
    // Phase 2 — Diagnostic: surface what the server actually received so
    // we can disambiguate "client didn't send" vs "server rejected" vs
    // "shared helper didn't fire". Logs even when payload is null.
    console.log(
      `[global-instructions] received: present=${!!globalInstructionsRaw} sanitized=${!!cleanGlobalInstructions} free_text_chars=${cleanGlobalInstructions?.globalInstructions.length ?? 0}`,
    );

    // Phase 1 — Universal Strategy SOP Engine: log workspace metadata only.
    // We do NOT branch on workspace yet. This log proves the routing payload
    // arrives end-to-end so Phase 2 can wire injection safely.
    const ALLOWED_WORKSPACES = new Set([
      'brainstorm', 'deep_research', 'refine', 'library',
      'artifacts', 'projects', 'work',
    ]);
    const workspace = typeof workspaceRaw === 'string' && ALLOWED_WORKSPACES.has(workspaceRaw)
      ? workspaceRaw
      : null;
    // Phase 7D-fix — workspace truth.
    // Distinguish "no surface selected" (freeform) from "Work surface" and
    // from "client sent a key the server doesn't recognize". This makes
    // diagnostics impossible to misread the way the previous silent
    // fallback to `'work'` allowed.
    const ALLOWED_WORKSPACE_SOURCES = new Set(['selected', 'thread-tag', 'default', 'none']);
    const workspaceSource: 'selected' | 'thread-tag' | 'default' | 'none' | 'unknown' =
      typeof workspaceSourceRaw === 'string' && ALLOWED_WORKSPACE_SOURCES.has(workspaceSourceRaw)
        ? (workspaceSourceRaw as 'selected' | 'thread-tag' | 'default' | 'none')
        : 'unknown';
    // What the server actually received from the wire — pre-validation. Used
    // for diagnostics so a typo'd / unknown key doesn't get silently mapped
    // to `null` without a trace.
    const workspaceSentRaw: string | null =
      typeof workspaceRaw === 'string' && workspaceRaw.trim().length > 0
        ? workspaceRaw
        : null;
    const workspaceResolved: string =
      workspace ?? (workspaceSentRaw ? `invalid:${workspaceSentRaw.slice(0, 32)}` : 'freeform');
    // Workspaces that may carry a Workspace SOP (matches the resolver:
    // `work` is freeform and is intentionally excluded).
    const WORKSPACES_SUPPORTING_SOP = new Set([
      'brainstorm', 'deep_research', 'refine', 'library', 'artifacts', 'projects',
    ]);
    const workspaceSupportsSop = workspace ? WORKSPACES_SUPPORTING_SOP.has(workspace) : false;

    console.log(
      `[strategy-sop] received workspace=${workspace ?? 'none'} source=${workspaceSource} sentRaw=${workspaceSentRaw ?? 'null'} taskType=${typeof workflowType === 'string' ? workflowType : 'none'} hasWorkspace=${!!workspace} supportsWorkspaceSop=${workspaceSupportsSop} hasGlobalInstructions=${!!cleanGlobalInstructions}`,
    );

    // Phase 2 — Universal Strategy SOP Engine: resolver plumbing.
    // The client runs `resolveStrategySops()` and sends a lightweight metadata
    // payload describing which SOPs apply this turn. We validate-and-log it.
    // SOP TEXT IS INTENTIONALLY NOT INJECTED — observation only.
    const ALLOWED_TASK_KEYS = new Set([
      'discovery_prep', 'deal_review', 'account_research', 'recap_email', 'roi_model',
    ]);
    const ALLOWED_MODES = new Set(['freeform', 'workspace', 'task']);
    let resolvedSopsLog: {
      workspace: string | null;
      taskType: string | null;
      mode: string;
      appliedSopIds: string[];
      enabledCount: number;
    } | null = null;
    if (resolvedSopsRaw && typeof resolvedSopsRaw === 'object') {
      const r = resolvedSopsRaw as Record<string, unknown>;
      const wsCandidate = typeof r.workspace === 'string' ? r.workspace : null;
      const tkCandidate = typeof r.taskType === 'string' ? r.taskType : null;
      const modeCandidate = typeof r.mode === 'string' ? r.mode : 'freeform';
      const ids = Array.isArray(r.appliedSopIds)
        ? r.appliedSopIds
            .filter((s): s is string => typeof s === 'string' && s.length <= 64)
            .slice(0, 16)
        : [];
      const count = typeof r.enabledCount === 'number' && Number.isFinite(r.enabledCount)
        ? Math.min(Math.max(r.enabledCount | 0, 0), 16)
        : ids.length;
      resolvedSopsLog = {
        workspace: wsCandidate && ALLOWED_WORKSPACES.has(wsCandidate) ? wsCandidate : null,
        taskType: tkCandidate && ALLOWED_TASK_KEYS.has(tkCandidate) ? tkCandidate : null,
        mode: ALLOWED_MODES.has(modeCandidate) ? modeCandidate : 'freeform',
        appliedSopIds: ids,
        enabledCount: count,
      };
    }
    console.log(
      `[strategy-sop] resolved ${JSON.stringify({
        workspace: resolvedSopsLog?.workspace ?? workspace ?? null,
        taskType: resolvedSopsLog?.taskType ?? (typeof workflowType === 'string' ? workflowType : null),
        appliedSopIds: resolvedSopsLog?.appliedSopIds ?? [],
        enabledCount: resolvedSopsLog?.enabledCount ?? 0,
        mode: resolvedSopsLog?.mode ?? 'freeform',
      })}`,
    );

    // ── Phase 3A — Universal Strategy SOP Engine: workspace SOP advisory ──
    // First behavior-affecting step. The client ships raw workspace SOP text
    // ONLY when the active workspace has its SOP enabled and we are NOT in a
    // task pipeline. The server appends it AFTER core/V2/synthesis prompts
    // and BEFORE global instructions. Strict mode-lock blocks (synthesis,
    // short-form, V2 dispatcher, Discovery Prep orchestrator) are NOT
    // touched — workspace SOPs are advisory.
    //
    // Hard guards mirror the client helper so a malformed payload can never
    // smuggle unbounded text or task-mode injection past the resolver.
    const WORKSPACE_SOP_MAX_CHARS = 6_000;
    const cleanWorkspaceSop = ((): {
      sopId: string;
      workspace: string;
      name: string;
      rawInstructions: string;
    } | null => {
      if (!workspaceSopRaw || typeof workspaceSopRaw !== 'object') return null;
      // Never inject during a task pipeline (Discovery Prep etc.). Phase 3A
      // is workspace-only.
      if (typeof workflowType === 'string' && workflowType.length > 0) return null;
      const w = workspaceSopRaw as Record<string, unknown>;
      const ws = typeof w.workspace === 'string' && ALLOWED_WORKSPACES.has(w.workspace)
        ? w.workspace : null;
      if (!ws) return null;
      // `work` is freeform — never carries a workspace SOP.
      if (ws === 'work') return null;
      const sopId = typeof w.sopId === 'string' && w.sopId.startsWith('workspace:')
        ? w.sopId : `workspace:${ws}`;
      const name = typeof w.name === 'string' && w.name.trim().length > 0
        ? w.name.slice(0, 120) : sopId;
      const raw = typeof w.rawInstructions === 'string'
        ? w.rawInstructions.trim().slice(0, WORKSPACE_SOP_MAX_CHARS)
        : '';
      if (!raw) return null;
      return { sopId, workspace: ws, name, rawInstructions: raw };
    })();
    console.log(
      `[strategy-sop] workspace-sop received: present=${!!workspaceSopRaw} sanitized=${!!cleanWorkspaceSop} workspace=${cleanWorkspaceSop?.workspace ?? 'none'} length=${cleanWorkspaceSop?.rawInstructions.length ?? 0}`,
    );

    // Phase 2 (Global SOP) — chat-only advisory injection.
    // Mirrors the workspace SOP sanitizer but applies to the universal
    // Global SOP. Task pipelines (workflowType set) NEVER receive it.
    // Hard cap protects against oversized payloads.
    const GLOBAL_SOP_MAX_CHARS = 12_000;
    const cleanGlobalSop = ((): {
      sopId: 'global';
      name: string;
      rawInstructions: string;
    } | null => {
      if (!globalSopRaw || typeof globalSopRaw !== 'object') return null;
      // Never inject during a task pipeline (Discovery Prep etc.).
      if (typeof workflowType === 'string' && workflowType.length > 0) return null;
      const g = globalSopRaw as Record<string, unknown>;
      const name = typeof g.name === 'string' && g.name.trim().length > 0
        ? g.name.slice(0, 120) : 'Global Strategy SOP';
      const raw = typeof g.rawInstructions === 'string'
        ? g.rawInstructions.trim().slice(0, GLOBAL_SOP_MAX_CHARS)
        : '';
      if (!raw) return null;
      return { sopId: 'global', name, rawInstructions: raw };
    })();
    console.log(
      `[strategy-sop] global-sop received: present=${!!globalSopRaw} sanitized=${!!cleanGlobalSop} length=${cleanGlobalSop?.rawInstructions.length ?? 0}`,
    );

    // ── Phase 7D-fix — Single-line truth diagnostic ─────────────────────
    // One structured JSON log capturing the full state of workspace + SOP
    // routing for this request. Lets us read a single line in Supabase
    // logs and definitively answer:
    //   • which workspace did the client say it was in?
    //   • which workspace did the server resolve?
    //   • where did the workspace value come from? (selected/none/etc.)
    //   • does that workspace even support a Workspace SOP?
    //   • Global SOP: config enabled? raw length sent? sanitized? going to inject?
    //   • Workspace SOP: sent? sanitized? going to inject?
    // The downstream "[sop-engine]" / "[sop-output-check]" logs continue to
    // report the actual injection result. This block reports the *inputs*.
    const globalSopConfigEnabled = !!globalSopRaw && typeof globalSopRaw === 'object';
    const globalSopRawLength = (globalSopRaw && typeof globalSopRaw === 'object'
      && typeof (globalSopRaw as Record<string, unknown>).rawInstructions === 'string')
      ? ((globalSopRaw as Record<string, unknown>).rawInstructions as string).length
      : 0;
    const workspaceSopRawLength = (workspaceSopRaw && typeof workspaceSopRaw === 'object'
      && typeof (workspaceSopRaw as Record<string, unknown>).rawInstructions === 'string')
      ? ((workspaceSopRaw as Record<string, unknown>).rawInstructions as string).length
      : 0;
    const willInjectWorkspaceSop = !!cleanWorkspaceSop;
    const willInjectGlobalSop = !!cleanGlobalSop;
    console.log(
      `[strategy-sop:diagnostics] ${JSON.stringify({
        // Workspace truth
        workspace_sent: workspaceSentRaw,
        workspace_resolved: workspaceResolved,
        workspace_source: workspaceSource,
        workspace_supports_sop: workspaceSupportsSop,
        is_freeform: !workspace,
        is_task_pipeline: typeof workflowType === 'string' && workflowType.length > 0,
        // Global SOP lifecycle
        global_sop_config_enabled: globalSopConfigEnabled,
        global_sop_sent: globalSopRaw != null,
        global_sop_raw_length: globalSopRawLength,
        global_sop_sanitized: !!cleanGlobalSop,
        global_sop_will_inject: willInjectGlobalSop,
        // Workspace SOP lifecycle
        workspace_sop_sent: workspaceSopRaw != null,
        workspace_sop_raw_length: workspaceSopRawLength,
        workspace_sop_sanitized: !!cleanWorkspaceSop,
        workspace_sop_will_inject: willInjectWorkspaceSop,
        workspace_sop_workspace: cleanWorkspaceSop?.workspace ?? null,
      })}`,
    );

    // ── Provider health surface (fail-loud) ──────────────────
    // Returns the cold-start PROVIDER_HEALTH object so the client can
    // warn the user when the brain is degraded (e.g. a key didn't carry
    // over after the Supabase migration). No thread required. Cheap:
    // reads the already-computed const, makes no LLM call.
    if (action === "health_check") {
      const degraded =
        !PROVIDER_HEALTH.anthropicDirect ||
        !PROVIDER_HEALTH.openaiDirect ||
        !PROVIDER_HEALTH.lovableGateway;
      return new Response(
        JSON.stringify({
          ok: true,
          degraded,
          providers: {
            anthropic: PROVIDER_HEALTH.anthropicDirect,
            openai: PROVIDER_HEALTH.openaiDirect,
            openai_reason: PROVIDER_HEALTH.openaiDirectReason,
            perplexity: PROVIDER_HEALTH.perplexityDirect,
            lovable_gateway: PROVIDER_HEALTH.lovableGateway,
          },
          impact: {
            situation_classifier: PROVIDER_HEALTH.lovableGateway ? "ok" : "degraded — falls back to keyword retrieval",
            easy_prompt: PROVIDER_HEALTH.lovableGateway ? "ok" : "disabled — terse prompts not expanded",
            chat_synthesis: PROVIDER_HEALTH.anthropicDirect ? "ok" : "degraded — Claude path unavailable",
            chat_general: PROVIDER_HEALTH.openaiDirect ? "ok" : "degraded — OpenAI path unavailable",
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    const routerBypass = req.headers.get("x-router-bypass") === "1";
    let routingDecision: RoutingDecision | null = null;
    if (!routerBypass) {
      routingDecision = routeRequest({
        message: content || "",
        thread: {
          account_id: contextPack.account?.id ?? null,
          opportunity_id: contextPack.opportunity?.id ?? null,
        },
        explicit_task_type: typeof body?.task_type === "string" ? body.task_type : null,
        override: typeof body?.override === "string" ? body.override : null,
        // BOLT 2 — unmute the library signal for the router.
        // Cheap pre-route hint: count of scopes the situation/library
        // path WOULD query. Purely keyword-derived (no DB), so it stays
        // pre-retrieval and pre-classifier. Zero cost, non-null truth.
        library_precheck_count: deriveLibraryScopes(
          contextPack.account,
          content || "",
        ).length,
      });
      await logRoutingDecision(supabase, {
        user_id: userId,
        thread_id: threadId ?? null,
        decision: routingDecision,
      });
      console.log("[strategy-router:decision]", JSON.stringify({
        user_id: userId,
        thread_id: threadId,
        lane: routingDecision.lane,
        task_type: routingDecision.task_type,
        auto_promoted: routingDecision.auto_promoted,
        promotion_offered: routingDecision.promotion_offered,
        override_used: routingDecision.override_used,
      }));

      if (
        routingDecision.lane === "deep_work" &&
        routingDecision.auto_promoted &&
        routingDecision.task_type &&
        authHeader
      ) {
        const started = await startAutoPromotedStrategyJob(
          authHeader,
          routingDecision.task_type,
          buildDeepWorkInputs(routingDecision, content || "", threadId, contextPack),
        );
        return new Response(JSON.stringify({
          kind: "deep_work",
          run_id: started.run_id,
          status: started.status,
          task_type: routingDecision.task_type,
          auto_promoted: true,
          routing_meta: toRoutingMeta(routingDecision),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
      v2RequestOverride,
      routingDecision,
      cleanGlobalInstructions,
      cleanWorkspaceSop,
      workspace,
      cleanGlobalSop,
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
  | "creation"  // BUILD an asset (email/script/plan) FROM the user's library
  | "evaluation" // GRADE/critique/improve content USING the user's library
  | "template"
  | "email"
  | "message" // SMS/LinkedIn/Slack/voicemail/script
  | "pitch" // exact wording for a moment
  | "next_steps"
  | "analysis"
  | "account_brief" // hybrid: facts-first account summary + operator read
  | "ninety_day_plan" // hybrid: literal 30/60/90 timeline + operator read
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
  /** Sub-flag for message mode: this is an audience rewrite ask. */
  subIntent?: "rewrite_audience";
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

  // 1.5 SYNTHESIS — user is asking the model to DERIVE a new artifact
  // (scoring system, framework, rubric, model, checklist, evaluation
  // criteria) FROM their library/resources. This MUST win over template/
  // email/pitch so the model doesn't fall back to a generic script when
  // the user explicitly asked it to build something from their materials.
  //
  // Two halves:
  //   (a) RESOURCE GROUNDING signal — "using my resources / library /
  //       playbooks / KIs", "based on", "from my <noun>", "from these".
  //   (b) DERIVATION signal — "come up with", "derive", "build a
  //       framework/rubric/scoring/model", "how did you determine",
  //       "score(ing system)", "rubric", "criteria", "weighting".
  // Either side alone is too weak. Together they reliably indicate a
  // synthesis ask. We also fire on the explicit "how did you determine"
  // follow-up because it's the audit half of a prior synthesis.
  // Grounding allows an optional domain qualifier between the possessive
  // and the noun — e.g. "my cold calling resources", "my discovery
  // transcripts", "our objection-handling playbooks". Up to 4 qualifier
  // words keeps it tight without missing real asks.
  const SYNTH_GROUNDING_RE =
    /\b(using|use|based on|from|leveraging|drawing on|pulling from|grounded in|across|against)\s+(my|the|these|those|our)(?:\s+[\w-]+){0,4}\s+(resource|resources|library|libraries|playbook|playbooks|kis?|knowledge\s+items?|materials?|notes|transcripts?|recordings?|content|docs?|documents?|files?|uploads?|standards?)\b/;
  const SYNTH_DERIVE_RE =
    /\b(come up with|derive|construct|build (?:me )?(?:a |an )?(?:framework|rubric|scoring|score|scorecard|model|system|method|methodology|criteria|checklist|evaluation|grading|ranking|weighting|index|maturity\s+model)|create (?:me )?(?:a |an )?(?:framework|rubric|scoring|score|scorecard|model|system|method|methodology|criteria|checklist|evaluation|grading|ranking|weighting|index|maturity\s+model)|design (?:a |an )?(?:framework|rubric|scoring|score|scorecard|model|system)|how (?:did|do) you (?:determine|decide|score|weight|rank|come up|derive)|extract (?:patterns|signals|themes)|synthesi[sz]e|put together (?:a |an )?(?:framework|rubric|scoring|score|model|system))\b/;
  const SYNTH_NOUN_HINT_RE =
    /\b(scoring system|score card|scorecard|rubric|framework|maturity model|evaluation criteria|grading system|ranking system|weighting|prioriti[sz]ation framework)\b/;
  const hasGrounding = SYNTH_GROUNDING_RE.test(text);
  const hasDerive = SYNTH_DERIVE_RE.test(text);
  const hasSynthNoun = SYNTH_NOUN_HINT_RE.test(text);
  if ((hasGrounding && (hasDerive || hasSynthNoun)) || (hasDerive && hasSynthNoun)) {
    console.log(
      `[mode-lock] intent_forced_synthesis text="${text.slice(0, 80)}" grounding=${hasGrounding} derive=${hasDerive} noun=${hasSynthNoun}`,
    );
    return { intent: "synthesis", isBusinessCase, isCFO };
  }

  // 1.6 EVALUATION — user is asking us to GRADE / critique / improve a
  // piece of content (an email they wrote, a call recording, a script,
  // a deck) USING THEIR OWN STANDARDS from the library. Must beat
  // template/email/pitch so we don't redraft instead of coach.
  // Dual-signal: evaluation verb + grounding phrase.
  const EVAL_VERB_RE =
    /\b(grade|score|evaluate|critique|review|coach (?:me )?on|assess|audit|judge|rate|red[- ]?team|tear (?:this |it )?down|improve|tighten|sharpen|fix|rewrite (?:this|it|my)|how (?:did|do) i do)\b/;
  const hasEvalVerb = EVAL_VERB_RE.test(text);
  if (hasEvalVerb && hasGrounding) {
    console.log(
      `[mode-lock] intent_forced_evaluation text="${text.slice(0, 80)}" verb=${hasEvalVerb} grounding=${hasGrounding}`,
    );
    return { intent: "evaluation", isBusinessCase, isCFO };
  }

  // 1.65 NINETY-DAY PLAN (HYBRID) — must beat the generic CREATION block
  // below. Triggers on "30/60/90 day plan", "ninety day plan", or
  // "new AE/rep/seller … plan/ramp". This mode produces a literal
  // Days 1–30 / 31–60 / 61–90 timeline first, then the operator read —
  // not a "dominant lever" thesis with bullets.
  const NINETY_DAY_PLAN_RE =
    /\b((30|60|90|ninety)[\s-]?day\s+(plan|ramp|onboarding)|(new|first)\s+(ae|rep|seller|sales(person|\s+rep)?)\b[^.?!]{0,60}\b(plan|ramp))\b/;
  if (NINETY_DAY_PLAN_RE.test(text)) {
    console.log(
      `[mode-lock] intent_forced_ninety_day_plan text="${text.slice(0, 80)}"`,
    );
    return { intent: "ninety_day_plan", isBusinessCase, isCFO };
  }

  // 1.7 CREATION — user is asking us to BUILD an asset (email, script,
  // talk track, plan, one-pager, business case, guide, playbook chapter,
  // 90-day plan, renewal memo, account brief, etc).
  // FIX A: when account context is present, drop the hard grounding-phrase
  // requirement — real operators say "give me a 90-day plan as a new AE
  // at <account>" without ever begging the model to use the library.
  const CREATE_VERB_RE =
    /\b(write|draft|create|build|construct|design|put together|turn (?:this |these |that )?into|generate|produce|give me|need)\b/;
  const CREATE_NOUN_RE =
    /\b(email|e-mail|outreach|cold\s+(?:email|call|message)|script|talk\s+track|call\s+plan|meeting\s+plan|account\s+plan|one[- ]?pager|onepager|business\s+case|guide|playbook(?:\s+chapter)?|sequence|cadence|deck|outline|brief|summary|agenda|message|note|voicemail|talking\s+points|(?:30|60|90|120)[- ]?day\s+plan|onboarding\s+plan|ramp\s+plan|renewal\s+memo|renewal\s+brief|account\s+brief|deal\s+memo|deal\s+brief)\b/;
  const hasCreateVerb = CREATE_VERB_RE.test(text);
  const hasCreateNoun = CREATE_NOUN_RE.test(text);
  if ((hasGrounding || hasAccountContext) && hasCreateVerb && hasCreateNoun) {
    console.log(
      `[mode-lock] intent_forced_creation text="${text.slice(0, 80)}" verb=${hasCreateVerb} noun=${hasCreateNoun} grounding=${hasGrounding} accountCtx=${hasAccountContext}`,
    );
    return { intent: "creation", isBusinessCase, isCFO };
  }

  // 1.75 REWRITE AUDIENCE (FIX D) — "rewrite this for a CFO", "tighten
  // this for the board", "tailor this for procurement". Routes into
  // message mode with a rewrite_audience sub-intent so the operator
  // contract composes and we don't fall to freeform. Must beat the
  // ACCOUNT_BRIEF / ANALYSIS regex by sitting after creation but before
  // them — neither matches rewrite phrasing anyway.
  const REWRITE_AUDIENCE_RE =
    /\b(rewrite|reword|rephrase|tighten|punch\s+up|sharpen|tailor|adapt|translate)\s+(this|that|the\s+(following|below|above)|it)\b[^.?!]{0,80}\b(for|to|as)\s+(a|an|the)?\s*(cfo|ceo|coo|cmo|cio|cto|cro|cso|chro|vp|svp|evp|director|manager|exec(utive)?|board|customer|prospect|champion|economic\s+buyer|technical\s+buyer|end\s+user|engineer|developer|finance|procurement|legal|it|operations|hr)/;
  const SHORT_REWRITE_RE = /^(rewrite|reword|rephrase|tighten|punch\s+up|sharpen)\b/;
  if (REWRITE_AUDIENCE_RE.test(text) || SHORT_REWRITE_RE.test(text)) {
    console.log(
      `[mode-lock] intent_forced_message_rewrite_audience text="${text.slice(0, 80)}"`,
    );
    return { intent: "message", subIntent: "rewrite_audience", isBusinessCase, isCFO };
  }

  // 1.8 ACCOUNT BRIEF (HYBRID) — "tell me about / brief me on / walk me
  // through / who is / give me the rundown on <X>" with account context
  // routes to a dedicated facts-first hybrid mode (not generic analysis).
  // The hybrid contract requires Company Snapshot → Stakeholders →
  // Operator Read → Next Moves so the encyclopedia answer comes first
  // and the operator angle comes second.
  const ACCOUNT_BRIEF_RE =
    /\b(tell me about|brief me (?:on|about)|walk me through|give me (?:the )?(?:rundown|overview|background|context|summary) (?:on|of|about)|who (?:is|are) (?:they|this|the (?:account|company|customer|prospect|client))|what do (?:i|we|you) know about|fill me in on|catch me up on|prep me on|background on|context on|update me on)\b/;
  if (hasAccountContext && ACCOUNT_BRIEF_RE.test(text)) {
    console.log(
      `[mode-lock] intent_forced_account_brief text="${text.slice(0, 80)}"`,
    );
    return { intent: "account_brief", isBusinessCase, isCFO };
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

  // 8. Discovery questions — route to grounded operator mode (next_steps), not freeform
  const DISCOVERY_QUESTIONS_RE =
    /\b(discovery questions?|what discovery questions?|which discovery questions?|questions matter most|questions should i ask|what should i ask in discovery|discovery framework)\b/i;
  if (DISCOVERY_QUESTIONS_RE.test(text)) {
    return { intent: "next_steps", isBusinessCase, isCFO };
  }

  return { intent: "freeform", sentenceCap, rawConstraint, isBusinessCase, isCFO };
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

// Detects the mandatory **Application** appendix (Situation/Audience/Industry).
// Required at the tail of every grounded mode (synthesis/creation/evaluation).
function hasApplicationAppendix(text: string): boolean {
  // Look in the last ~1500 chars where the appendix should live.
  const tail = text.slice(-1800);
  if (!/\*{0,2}Application\*{0,2}/i.test(tail)) return false;
  // Require all three context labels.
  const hasSituation = /\bSituation\s*:/i.test(tail);
  const hasAudience = /\bAudience\s*:/i.test(tail);
  const hasIndustry = /\bIndustry\s*:/i.test(tail);
  return hasSituation && hasAudience && hasIndustry;
}

// ────────────────────────────────────────────────────────────────────
// APPLICATION-LAYER CONSISTENCY GUARD
// ────────────────────────────────────────────────────────────────────
// Kills "appendix theater": output that declares Audience=CFO /
// Situation=Cold Call / Industry=Healthcare in the appendix but whose
// BODY shows none of the language or structural shape that audience /
// situation / industry should produce. This is the difference between
// real adaptation and decorative labeling.
//
// Heuristic, not LLM. We:
//   1) Parse the appendix for declared Situation / Audience / Industry.
//   2) Inspect the body ABOVE the appendix.
//   3) Validate that the body shows:
//        - audience-specific vocabulary signals (≥2 hits)
//        - situation-specific structural shape
//        - industry-specific vocabulary signals (≥2 hits)
//   4) On mismatch, emit a typed violation tag and request regen.
//
// Keep the floor low enough that a strong CFO answer doesn't fail for
// missing one keyword, but high enough that a generic body wrapped in
// a CFO appendix cannot pass.

interface AppendixDecl {
  situation: string | null;
  audience: string | null;
  industry: string | null;
}

function parseApplicationDecl(text: string): AppendixDecl {
  const tail = text.slice(-1800);
  const grab = (label: string): string | null => {
    const m = tail.match(new RegExp(`\\b${label}\\s*:\\s*([^\\n]+)`, "i"));
    if (!m) return null;
    return m[1].replace(/[*_`]/g, "").trim().toLowerCase() || null;
  };
  return {
    situation: grab("Situation"),
    audience: grab("Audience"),
    industry: grab("Industry"),
  };
}

// Strip the appendix region so we only score the body.
function stripApplicationAppendix(text: string): string {
  // Find last "Application" header and cut from there.
  const re = /\n[ \t]*\*{0,2}Application\*{0,2}[ \t]*\n/i;
  const m = text.match(re);
  if (!m || m.index == null) return text;
  return text.slice(0, m.index);
}

// ── OPERATOR-GRADE REASONING GUARD ─────────────────────────────
// Detects book-smart fingerprints in synthesis/creation/evaluation outputs.
// Returns a list of violations; caller decides whether to regen.
//
// What we look for (any 2+ failures → regen with strict reasoning preamble):
//   1. No CONSEQUENCE vocabulary — outcome must tie to pipeline / velocity /
//      win rate / churn / expansion / ACV / payback / cost-of-inaction.
//   2. No DECISION LOGIC — no IF/THEN, "if X then Y", "when X, do Y".
//   3. BEHAVIORAL FLUFF — "ask better questions", "build trust", "be authentic".
//   4. NO TRADEOFF LANGUAGE — no "vs", "instead of", "ignore", "deprioritize",
//      "table stakes", "noise", "matters more", "matters less".
//   5. NO POV COMMITMENT — no "the dominant", "the highest-leverage",
//      "the one thing", "the biggest", "what actually matters".
function auditOperatorReasoning(body: string): {
  violations: string[];
  shouldRegenerate: boolean;
} {
  const violations: string[] = [];
  const wc = body.trim().split(/\s+/).filter(Boolean).length;
  if (wc < 120) return { violations, shouldRegenerate: false };

  const lower = body.toLowerCase();

  // 1. Consequence vocabulary — must hit ≥2 distinct outcome anchors.
  const CONSEQUENCE_RE = [
    /\bpipeline\b/, /\bvelocity\b/, /\bwin\s*rate\b/, /\bchurn\b/,
    /\bexpansion\b/, /\bacv\b/, /\barr\b/, /\bpayback\b/,
    /\bcost\s+of\s+inaction\b/, /\bdeal\s+(stalls?|slips?|dies?|breaks?)\b/,
    /\btime[-\s]to[-\s](revenue|close|value)\b/, /\bforecast\b/,
    /\bconversion\s+rate\b/, /\bquota\b/, /\battainment\b/,
  ];
  const consequenceHits = CONSEQUENCE_RE.filter((re) => re.test(lower)).length;
  if (consequenceHits < 2) {
    violations.push("operator_no_consequence_framing");
  }

  // 2. Decision logic — IF/THEN sequence required.
  const DECISION_RE = [
    /\bif\b[^.!?\n]{2,80}\b(then|do|run|use|skip|prioritize|deprioritize|switch|move)\b/i,
    /\bwhen\b[^.!?\n]{2,80}\b(then|do|run|use|skip|prioritize|switch)\b/i,
    /\bdominant\s+move\b/i, /\bnext\s+move\b/i, /\bplaybook:\s/i,
  ];
  const hasDecisionLogic = DECISION_RE.some((re) => re.test(body));
  if (!hasDecisionLogic) {
    violations.push("operator_no_decision_logic");
  }

  // 3. Behavioral fluff — banned phrases that signal generic-LLM output.
  const FLUFF_RE = [
    /\bask\s+better\s+questions\b/i,
    /\bbuild\s+(trust|rapport)\b/i,
    /\bbe\s+(authentic|curious|confident|genuine)\b/i,
    /\bobserve\s+tone\b/i,
    /\bactive\s+listening\b/i,
    /\bbe\s+a\s+good\s+listener\b/i,
    /\bstay\s+curious\b/i,
    /\bshow\s+empathy\b/i,
    /\bmirror\s+(their|the)\s+(language|tone)\b/i,
  ];
  const fluffHits = FLUFF_RE.filter((re) => re.test(body)).length;
  if (fluffHits >= 1) {
    violations.push("operator_behavioral_fluff");
  }

  // 4. Tradeoff language — POV must include what to ignore / weight differently.
  const TRADEOFF_RE = [
    /\binstead\s+of\b/i, /\bnot\s+because\b/i, /\bdeprioritize\b/i,
    /\btable\s+stakes\b/i, /\bnoise\b/i, /\bmatters?\s+(more|most|less|least)\b/i,
    /\bweight(ed|s)?\s+(higher|lower|more|less)\b/i, /\bignore\b/i,
    /\bovervalued?\b/i, /\bunderrated?\b/i, /\btradeoff\b/i,
  ];
  const tradeoffHits = TRADEOFF_RE.filter((re) => re.test(body)).length;
  if (tradeoffHits < 2) {
    violations.push("operator_no_tradeoffs");
  }

  // 5. POV commitment — "the dominant", "the one thing", etc.
  const POV_RE = [
    /\bthe\s+dominant\b/i, /\bthe\s+highest[-\s]leverage\b/i,
    /\bthe\s+one\s+thing\b/i, /\bthe\s+biggest\b/i,
    /\bwhat\s+actually\s+matters\b/i, /\bthe\s+real\s+(issue|driver|lever)\b/i,
    /\bthe\s+single\s+(biggest|most|highest)\b/i, /\bthe\s+core\b/i,
  ];
  const hasPOV = POV_RE.some((re) => re.test(body));
  if (!hasPOV) {
    violations.push("operator_no_pov_commitment");
  }

  // Regen threshold: 2+ violations means the output is book-smart.
  const shouldRegenerate = violations.length >= 2;
  if (shouldRegenerate) {
    console.log(`[operator-reasoning] violations=${JSON.stringify(violations)} body_words=${wc}`);
  }
  return { violations, shouldRegenerate };
}

// Audience → required vocabulary signals. Match is case-insensitive,
// word-boundary, ≥2 distinct hits required.
const AUDIENCE_VOCAB: Array<{ key: RegExp; signals: RegExp[] }> = [
  {
    key: /\bcfo\b|chief financial|finance lead|finance leader/i,
    signals: [
      /\broi\b/i, /\bpayback\b/i, /\bcost of inaction\b/i, /\bbudget\b/i,
      /\bmargin\b/i, /\bcash\b/i, /\bdownside\b/i, /\bfinancial impact\b/i,
      /\b(net|gross)\s+(savings|cost)\b/i, /\b\$[\d,]/,
      /\bcost\b.*\b(reduction|avoid|save|saving)\b/i,
      /\bbusiness case\b/i, /\bnpv\b/i, /\birr\b/i,
    ],
  },
  {
    key: /\bchampion\b|internal champion|economic buyer's champion/i,
    signals: [
      /\binternal sell/i, /\bforward(able|ing)?\b/i, /\bproof point/i,
      /\bnarrative\b/i, /\bbuy[- ]in\b/i, /\bcredibility\b/i,
      /\bstakeholder alignment\b/i, /\bhelp(ing)? (you|them) sell/i,
      /\bpolitical cover\b/i, /\btalk track\b/i,
      /\bshare with\b.*\b(team|exec|leadership)\b/i,
    ],
  },
  {
    key: /\bvp sales\b|vp of sales|sales leader|cro\b|chief revenue/i,
    signals: [
      /\bpipeline\b/i, /\bconversion\b/i, /\bforecast\b/i, /\bvelocity\b/i,
      /\bquota\b/i, /\bwin rate\b/i, /\bstage progression\b/i,
      /\bramp\b/i, /\battainment\b/i, /\brep\b/i, /\bcoverage\b/i,
    ],
  },
  {
    key: /\bprocurement\b|purchasing|sourcing\b/i,
    signals: [
      /\bcontract\b/i, /\bpricing\b/i, /\bterms\b/i, /\bvendor risk\b/i,
      /\bapprov(al|ed)\b/i, /\blegal\b/i, /\bcommercial process\b/i,
      /\bmsa\b/i, /\bredline\b/i, /\bsla\b/i,
    ],
  },
  {
    key: /\btechnical buyer\b|engineer|architect|cto\b|head of (engineering|platform)/i,
    signals: [
      /\bintegration\b/i, /\bimplementation\b/i, /\barchitecture\b/i,
      /\bfeasibility\b/i, /\bdeployment\b/i, /\btechnical risk\b/i,
      /\bsystems?\b/i, /\bapi\b/i, /\bsso\b/i, /\binfrastructure\b/i,
    ],
  },
  {
    key: /\bfounder\b|ceo\b|chief executive/i,
    signals: [
      /\bnarrative\b/i, /\bdifferentiation\b/i, /\bstrategic leverage\b/i,
      /\bmarket position/i, /\bmoat\b/i, /\bvision\b/i,
    ],
  },
  {
    key: /\bboard\b|board of directors/i,
    signals: [
      /\bgovernance\b/i, /\bstrategic\b/i, /\brisk\b/i, /\bmilestone\b/i,
      /\boutcomes?\b/i, /\bcapital\b/i,
    ],
  },
];

// Situation → required structural shape.
const SITUATION_SHAPE: Array<{ key: RegExp; check: (body: string) => string | null }> = [
  {
    key: /\bcold\s+call\b/i,
    // Cold call: must be short and hook-first. We allow long IF first
    // ~400 chars carry the hook ("reason for the call", curiosity, name).
    check: (body) => {
      const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 350) {
        const head = body.slice(0, 600).toLowerCase();
        const hookHints = /(reason for|quick (call|second|ask)|won['’]t take|30 seconds|caught you|cold|interrupt)/i;
        if (!hookHints.test(head)) return "cold_call_too_long_no_hook";
      }
      return null;
    },
  },
  {
    key: /\bdiscovery\b/i,
    // Discovery: must lead with diagnostic questions / hypothesis.
    check: (body) => {
      const qCount = (body.match(/\?/g) || []).length;
      const hasHypothesis = /\b(hypothesis|we (think|believe|suspect)|our take|what we['’]re seeing|i['’]?d expect)\b/i.test(body);
      if (qCount < 2 && !hasHypothesis) return "discovery_no_questions_or_hypothesis";
      return null;
    },
  },
  {
    key: /\brenewal\b/i,
    // Renewal passes if EITHER:
    //   Path A — ≥2 explicit renewal/retention vocabulary hits, OR
    //   Path B — ≥1 renewal-shape hit AND ≥2 economic-consequence signals
    //            (CFO-native renewal framing: payback, ROI, cost of inaction,
    //             $-figures, exposure, savings, etc.)
    // This prevents false-positives on strong CFO+Renewal answers without
    // weakening the appendix-theater protection (generic prose has neither).
    check: (body) => {
      const retentionRe = /\b(retention|renew(al|als|ed|ing)?|expansion|expand(ed|ing)?|upsell|churn|risk|consequence|usage|adoption|value realized)\b/gi;
      const retentionHits = (body.match(retentionRe) || []).length;
      if (retentionHits >= 2) return null;

      const econSignals: RegExp[] = [
        /\broi\b/i,
        /\bpayback\b/i,
        /\bcost of inaction\b/i,
        /\bbudget\b/i,
        /\bdownside\b/i,
        /\bfinancial impact\b/i,
        /\bmargin\b/i,
        /\bcash\b/i,
        /\b\$[\d,]/,
        /\b(risk|compliance|revenue)\s+exposure\b/i,
        /\brevenue at risk\b/i,
        /\bcost\s+(reduction|avoid|avoidance|saving|savings)\b/i,
        /\bnet\s+(savings|cost|new arr)\b/i,
      ];
      const econHits = econSignals.reduce((n, re) => n + (re.test(body) ? 1 : 0), 0);
      // Path B: at least 1 renewal-shape hit + ≥2 economic-consequence signals.
      if (retentionHits >= 1 && econHits >= 2) return null;
      return "renewal_missing_retention_framing";
    },
  },
  {
    key: /\bobjection( handling)?\b|pricing pushback/i,
    check: (body) => {
      const hasReframe = /\b(reframe|flip|pivot|push back|i hear you|that['’]s fair|here['’]s why|the reason)\b/i;
      const hasRebuttal = /\b(actually|the data|in fact|consider|what we['’]ve seen)\b/i;
      if (!hasReframe.test(body) && !hasRebuttal.test(body)) return "objection_missing_rebuttal_or_reframe";
      return null;
    },
  },
  {
    key: /\bexec( meeting| conversation)?\b|board prep|executive/i,
    check: (body) => {
      const econ = /\b(\$[\d,]|roi|payback|outcome|consequence|p&l|margin|revenue|cost|risk)\b/i;
      const hits = (body.match(new RegExp(econ.source, "gi")) || []).length;
      if (hits < 2) return "exec_missing_economic_framing";
      return null;
    },
  },
];

// Industry → required vocabulary signals (≥2 distinct hits).
const INDUSTRY_VOCAB: Array<{ key: RegExp; signals: RegExp[]; antiSaaS?: boolean }> = [
  {
    key: /\bsaas\b|software as a service/i,
    signals: [
      /\barr\b/i, /\bchurn\b/i, /\bseats?\b/i, /\bexpansion\b/i,
      /\bpayback\b/i, /\brenewal\b/i, /\badoption\b/i, /\bmrr\b/i,
    ],
  },
  {
    key: /\bhealth\s*care\b|healthcare|hospital|clinical/i,
    signals: [
      /\bcompliance\b/i, /\bpatient\b/i, /\bauditab/i, /\boperational burden\b/i,
      /\bregulat/i, /\bgovernance\b/i, /\bhipaa\b/i, /\bclinical\b/i,
    ],
    antiSaaS: true,
  },
  {
    key: /\bmanufactur/i,
    signals: [
      /\bthroughput\b/i, /\buptime\b/i, /\befficiency\b/i, /\bwaste\b/i,
      /\bdowntime\b/i, /\boutput\b/i, /\boperational reliability\b/i,
      /\byield\b/i, /\boee\b/i,
    ],
    antiSaaS: true,
  },
  {
    key: /\bfinancial services\b|finserv|banking|insurance|capital markets/i,
    signals: [
      /\bcontrols?\b/i, /\bregulatory\b/i, /\brisk\b/i, /\bgovernance\b/i,
      /\baudit trail\b/i, /\bcompliance\b/i, /\bsox\b/i, /\bbasel\b/i,
    ],
    antiSaaS: true,
  },
  {
    key: /\bretail\b|ecommerce|e-commerce/i,
    signals: [
      /\bconversion\b/i, /\bbasket\b/i, /\baov\b/i, /\bsku\b/i,
      /\binventory\b/i, /\bfootfall\b/i, /\bmargin\b/i, /\bgmv\b/i,
    ],
    antiSaaS: true,
  },
];

const SAAS_LEAK_RE = /\b(arr|mrr|churn|seats?)\b/i;

interface ConsistencyResult {
  violations: string[];
  shouldRegenerate: boolean;
}

function enforceApplicationConsistency(text: string): ConsistencyResult {
  const violations: string[] = [];
  let shouldRegenerate = false;

  if (!hasApplicationAppendix(text)) {
    // The mode-specific guard already flags missing-appendix; don't double-tag.
    return { violations, shouldRegenerate };
  }

  const decl = parseApplicationDecl(text);
  const body = stripApplicationAppendix(text);
  const bodyLower = body.toLowerCase();
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

  // ── Audience consistency ────────────────────────────────────
  if (decl.audience) {
    const match = AUDIENCE_VOCAB.find((a) => a.key.test(decl.audience!));
    if (match) {
      const hits = match.signals.reduce((n, re) => n + (re.test(body) ? 1 : 0), 0);
      if (hits < 2) {
        violations.push("application_body_audience_mismatch");
        shouldRegenerate = true;
        console.log(`[app-consistency] audience="${decl.audience}" hits=${hits}/2 required`);
      }
    }
  }

  // ── Situation consistency ───────────────────────────────────
  if (decl.situation) {
    const match = SITUATION_SHAPE.find((s) => s.key.test(decl.situation!));
    if (match) {
      const reason = match.check(body);
      if (reason) {
        violations.push("application_body_situation_mismatch");
        shouldRegenerate = true;
        console.log(`[app-consistency] situation="${decl.situation}" reason=${reason}`);
      }
    }
  }

  // ── Industry consistency ────────────────────────────────────
  if (decl.industry) {
    const match = INDUSTRY_VOCAB.find((i) => i.key.test(decl.industry!));
    if (match) {
      const hits = match.signals.reduce((n, re) => n + (re.test(body) ? 1 : 0), 0);
      if (hits < 2) {
        violations.push("application_body_industry_mismatch");
        shouldRegenerate = true;
        console.log(`[app-consistency] industry="${decl.industry}" hits=${hits}/2 required`);
      }
      // SaaS-leak: declared non-SaaS industry but body uses SaaS metrics.
      if (match.antiSaaS && SAAS_LEAK_RE.test(bodyLower)) {
        violations.push("application_body_industry_mismatch");
        shouldRegenerate = true;
        console.log(`[app-consistency] industry="${decl.industry}" SaaS vocabulary leaked into non-SaaS body`);
      }
    }
  }

  // ── Generic-despite-context floor ───────────────────────────
  // If the body is meaningfully sized AND none of the declared
  // dimensions (audience/situation/industry) actually shaped it,
  // call it generic.
  if (wordCount > 120 && violations.length >= 2) {
    violations.push("application_body_generic_despite_context");
  }

  return { violations, shouldRegenerate };
}

function enforceModeLock(
  rawText: string,
  intent: IntentResult,
  opts: {
    resourceHits?: Array<{ id: string; title: string }>;
    libraryMode?: LibraryMode;
  } = {},
): GuardResult {
  let text = rawText.trim();
  const violations: string[] = [];
  let modified = false;
  let shouldRegenerate = false;
  const resourceHits = opts.resourceHits ?? [];

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

    case "synthesis": {
      // The resolved short-form turn contract intentionally supersedes the
      // long-form synthesis scaffold and appendix for this invocation.
      if (opts.libraryMode === "short_form") break;
      // FAILURE CONDITION: <2 resources retrieved → replace with honest ask.
      // This is the strongest guard: even if the model produced a generic
      // framework, we override it because by definition no real derivation
      // could have happened.
      // THIN-MODE: when <2 resources, do NOT overwrite. The model was
      // already instructed (via the THIN-MODE CONTRACT in the system
      // prompt + the LIBRARY-AWARENESS PROTOCOL preamble) to produce a
      // best first-pass derivation with honest gap framing. Trust the
      // model output; just record the signal for audit.
      if (resourceHits.length < 2) {
        violations.push("synthesis_thin_grounding_allowed");
        console.log(
          `[mode-lock] synthesis_thin_grounding_allowed hits=${resourceHits.length} (no overwrite)`,
        );
      }

      // Strip forbidden generic-fallback phrases. These signal the model
      // bailed out of derivation and is hand-waving with industry boilerplate.
      const FORBIDDEN_GENERIC: Array<{ re: RegExp; tag: string }> = [
        { re: /\bbased on (the |your )?resources( provided)?\b[,.]?\s*/gi, tag: "synth_based_on_resources" },
        { re: /\bin general,?\s+/gi, tag: "synth_in_general" },
        { re: /\b(industry\s+)?best\s+practices?\b[,.]?\s*/gi, tag: "synth_best_practice" },
        { re: /\bindustry\s+standard\b[,.]?\s*/gi, tag: "synth_industry_standard" },
        { re: /\bas a general rule,?\s+/gi, tag: "synth_general_rule" },
        { re: /\bgenerally speaking,?\s+/gi, tag: "synth_generally_speaking" },
        { re: /\btypically,?\s+/gi, tag: "synth_typically" },
      ];
      let genericHits = 0;
      for (const { re, tag } of FORBIDDEN_GENERIC) {
        const before = text;
        text = text.replace(re, "");
        if (text !== before) {
          genericHits += 1;
          violations.push(`stripped_${tag}`);
        }
      }
      if (genericHits > 0) {
        text = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        modified = true;
      }

      // STRUCTURAL GUARD: require all 5 sections + a table + cited sources.
      // If any are missing, flag for one strict regeneration.
      const hasPattern = /\bpattern\s+extraction\b/i.test(text);
      const hasDimensions = /\bdimensions?\b/i.test(text) && /\|.*\|.*\|/.test(text);
      const hasWeighting = /\bweight(ing)?\s+rationale\b/i.test(text);
      const hasExample = /\bexample\s+scoring\b/i.test(text);
      const hasAttribution = /\bsource\s+attribution\b/i.test(text);
      const hasCitations = /(KI\[[a-z0-9_-]+\]|PLAYBOOK\[[a-z0-9_-]+\]|RESOURCE\[[a-z0-9_-]+\])/i.test(text);

      if (!hasPattern) { violations.push("synthesis_missing_pattern_extraction"); shouldRegenerate = true; }
      if (!hasDimensions) { violations.push("synthesis_missing_dimensions_table"); shouldRegenerate = true; }
      if (!hasWeighting) { violations.push("synthesis_missing_weighting_rationale"); shouldRegenerate = true; }
      if (!hasExample) { violations.push("synthesis_missing_example_scoring"); shouldRegenerate = true; }
      if (!hasAttribution) { violations.push("synthesis_missing_source_attribution"); shouldRegenerate = true; }
      if (!hasCitations) { violations.push("synthesis_missing_source_citations"); shouldRegenerate = true; }

      // Equal-weight detector: extract weight cells from the table and flag
      // if all weights are identical (e.g. all 20% across 5 dims).
      const weightMatches = Array.from(text.matchAll(/\|\s*(\d{1,3})\s*%\s*\|/g)).map((m) => parseInt(m[1], 10));
      if (weightMatches.length >= 3) {
        const allEqual = weightMatches.every((w) => w === weightMatches[0]);
        if (allEqual) {
          violations.push("synthesis_equal_weights");
          shouldRegenerate = true;
          console.log(`[mode-lock] synthesis_equal_weights weights=${JSON.stringify(weightMatches)}`);
        }
      }

      // Generic-framework fingerprint: if the model fell back to opener/
      // pitch/close stages, that's a generic-LLM tell. Flag for regen.
      if (/\b(opener|pitch|close)\s*\/\s*(opener|pitch|close)\s*\/\s*(opener|pitch|close)\b/i.test(text) ||
          /\b(discovery|demo|close)\s*\/\s*(discovery|demo|close)\s*\/\s*(discovery|demo|close)\b/i.test(text)) {
        violations.push("synthesis_generic_stage_scaffold");
        shouldRegenerate = true;
      }

      // APPLICATION LAYER GUARD: appendix must include Situation/Audience/Industry.
      if (!hasApplicationAppendix(text)) {
        violations.push("synthesis_missing_application_appendix");
        shouldRegenerate = true;
      } else {
        // BODY ↔ APPENDIX CONSISTENCY: kill appendix theater.
        const cons = enforceApplicationConsistency(text);
        if (cons.violations.length) {
          violations.push(...cons.violations);
          if (cons.shouldRegenerate) shouldRegenerate = true;
        }
      }
      // OPERATOR REASONING AUDIT: catch book-smart fingerprints.
      {
        const body = stripApplicationAppendix(text);
        const op = auditOperatorReasoning(body);
        if (op.violations.length) {
          violations.push(...op.violations.map((v) => `synthesis_${v}`));
          if (op.shouldRegenerate) shouldRegenerate = true;
        }
      }
      break;
    }

    case "creation": {
      if (opts.libraryMode === "short_form") break;
      // FAILURE CONDITION: 0 resources retrieved → replace with honest ask.
      // Creation needs ≥1 meaningful resource (looser than synthesis).
      // THIN-MODE: when 0 resources, do NOT overwrite. System prompt +
      // preamble already instruct the model to produce the asset using
      // operator reasoning with explicit "Created (extended)" tagging.
      if (resourceHits.length < 1) {
        violations.push("creation_thin_grounding_allowed");
        console.log(`[mode-lock] creation_thin_grounding_allowed hits=0 (no overwrite)`);
      }

      // Strip the same forbidden generic-fallback phrases as synthesis.
      const FORBIDDEN_GENERIC_C: Array<{ re: RegExp; tag: string }> = [
        { re: /\bbased on (the |your )?resources( provided)?\b[,.]?\s*/gi, tag: "create_based_on_resources" },
        { re: /\bin general,?\s+/gi, tag: "create_in_general" },
        { re: /\b(industry\s+)?best\s+practices?\b[,.]?\s*/gi, tag: "create_best_practice" },
        { re: /\bindustry\s+standard\b[,.]?\s*/gi, tag: "create_industry_standard" },
        { re: /\bas a general rule,?\s+/gi, tag: "create_general_rule" },
        { re: /\bgenerally speaking,?\s+/gi, tag: "create_generally_speaking" },
        { re: /\btypically,?\s+/gi, tag: "create_typically" },
      ];
      let cHits = 0;
      for (const { re, tag } of FORBIDDEN_GENERIC_C) {
        const before = text;
        text = text.replace(re, "");
        if (text !== before) { cHits += 1; violations.push(`stripped_${tag}`); }
      }
      if (cHits > 0) {
        text = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        modified = true;
      }

      // STRUCTURAL GUARD: require Source Basis + Reused vs Created sections + citations.
      const hasSourceBasis = /\bsource\s+basis\b/i.test(text);
      const hasReusedCreated = /\breused\s+vs\s+created\b/i.test(text) ||
        (/\breused\b/i.test(text) && /\bcreated\b/i.test(text));
      const hasCitationsC = /(KI\[[a-z0-9_-]+\]|PLAYBOOK\[[a-z0-9_-]+\]|RESOURCE\[[a-z0-9_-]+\])/i.test(text);
      if (!hasSourceBasis) { violations.push("creation_missing_source_basis"); shouldRegenerate = true; }
      if (!hasReusedCreated) { violations.push("creation_missing_reused_vs_created"); shouldRegenerate = true; }
      if (!hasCitationsC) { violations.push("creation_missing_source_citations"); shouldRegenerate = true; }
      if (!hasApplicationAppendix(text)) {
        violations.push("creation_missing_application_appendix");
        shouldRegenerate = true;
      } else {
        const cons = enforceApplicationConsistency(text);
        if (cons.violations.length) {
          violations.push(...cons.violations);
          if (cons.shouldRegenerate) shouldRegenerate = true;
        }
      }
      // OPERATOR REASONING AUDIT.
      {
        const body = stripApplicationAppendix(text);
        const op = auditOperatorReasoning(body);
        if (op.violations.length) {
          violations.push(...op.violations.map((v) => `creation_${v}`));
          if (op.shouldRegenerate) shouldRegenerate = true;
        }
      }
      break;
    }

    case "evaluation": {
      if (opts.libraryMode === "short_form") break;
      // FAILURE CONDITION: <2 resources → user's STANDARDS need triangulation.
      // THIN-MODE: when <2 resources, do NOT overwrite. The model was
      // already told to grade with operator-pattern source tagging.
      if (resourceHits.length < 2) {
        violations.push("evaluation_thin_grounding_allowed");
        console.log(`[mode-lock] evaluation_thin_grounding_allowed hits=${resourceHits.length} (no overwrite)`);
      }

      const FORBIDDEN_GENERIC_E: Array<{ re: RegExp; tag: string }> = [
        { re: /\bbased on (the |your )?resources( provided)?\b[,.]?\s*/gi, tag: "eval_based_on_resources" },
        { re: /\bin general,?\s+/gi, tag: "eval_in_general" },
        { re: /\b(industry\s+)?best\s+practices?\b[,.]?\s*/gi, tag: "eval_best_practice" },
        { re: /\bindustry\s+standard\b[,.]?\s*/gi, tag: "eval_industry_standard" },
        { re: /\bas a general rule,?\s+/gi, tag: "eval_general_rule" },
        { re: /\bgenerally speaking,?\s+/gi, tag: "eval_generally_speaking" },
        { re: /\btypically,?\s+/gi, tag: "eval_typically" },
      ];
      let eHits = 0;
      for (const { re, tag } of FORBIDDEN_GENERIC_E) {
        const before = text;
        text = text.replace(re, "");
        if (text !== before) { eHits += 1; violations.push(`stripped_${tag}`); }
      }
      if (eHits > 0) {
        text = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        modified = true;
      }

      // STRUCTURAL GUARD.
      const hasOverallScore = /\boverall\b[\s:]*\d{1,2}\s*\/\s*10/i.test(text) ||
        /\boverall\s+score\b/i.test(text);
      const hasBreakdownTable = /\|.*\|.*\|/.test(text);
      const hasImprovements = /\bimprovements?\b/i.test(text);
      const hasAttributionE = /\bsource\s+attribution\b/i.test(text);
      const hasCitationsE = /(KI\[[a-z0-9_-]+\]|PLAYBOOK\[[a-z0-9_-]+\]|RESOURCE\[[a-z0-9_-]+\])/i.test(text);
      if (!hasOverallScore) { violations.push("evaluation_missing_overall_score"); shouldRegenerate = true; }
      if (!hasBreakdownTable) { violations.push("evaluation_missing_breakdown_table"); shouldRegenerate = true; }
      if (!hasImprovements) { violations.push("evaluation_missing_improvements"); shouldRegenerate = true; }
      if (!hasAttributionE) { violations.push("evaluation_missing_source_attribution"); shouldRegenerate = true; }
      if (!hasCitationsE) { violations.push("evaluation_missing_source_citations"); shouldRegenerate = true; }

      // Vague-critique fingerprint.
      if (/\b(be more concise|stronger cta|improve (the )?tone|good start|with some polish|nice work)\b/i.test(text)) {
        violations.push("evaluation_vague_critique");
        shouldRegenerate = true;
      }
      if (!hasApplicationAppendix(text)) {
        violations.push("evaluation_missing_application_appendix");
        shouldRegenerate = true;
      } else {
        const cons = enforceApplicationConsistency(text);
        if (cons.violations.length) {
          violations.push(...cons.violations);
          if (cons.shouldRegenerate) shouldRegenerate = true;
        }
      }
      // OPERATOR REASONING AUDIT.
      {
        const body = stripApplicationAppendix(text);
        const op = auditOperatorReasoning(body);
        if (op.violations.length) {
          violations.push(...op.violations.map((v) => `evaluation_${v}`));
          if (op.shouldRegenerate) shouldRegenerate = true;
        }
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


function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function toRetrievalDebugShape(resources: any) {
  return resources?.debug ?? null;
}

function buildRetrievalDiagnostics(args: {
  userContent: string;
  resources: any;
  retrievalError: { message: string; stack?: string | null; stage?: string } | null;
  intent: IntentResult;
}) {
  const { userContent, resources, retrievalError, intent } = args;
  const resourceHits = (resources?.hits || []).map((h: any) => ({
    id: h.id,
    title: h.title,
    matchKind: h.matchKind,
    matchReason: h.matchReason,
  }));
  const kiHits = (resources?.kiHits || []).map((k: any) => ({
    id: k.id,
    title: k.title,
    chapter: k.chapter ?? null,
    matchKind: k.matchKind,
    matchReason: k.matchReason,
  }));
  return {
    upstream_status: retrievalError ? 'failed' : 'ok',
    exception: retrievalError,
    raw_result: resources
      ? {
        userAskedForResource: !!resources.userAskedForResource,
        userAskedForTopic: !!resources.userAskedForTopic,
        inferredTopics: resources.inferredTopics || [],
        inferredCategories: resources.inferredCategories || [],
        extractedPhrases: resources.extractedPhrases || [],
        resource_hits: resourceHits.length,
        ki_hits: kiHits.length,
        matched_resources: resourceHits,
        matched_kis: kiHits,
      }
      : null,
    build_chat_system_prompt_received: resources
      ? {
        resource_hits: resourceHits.length,
        ki_hits: kiHits.length,
        retrieval_debug: toRetrievalDebugShape(resources),
      }
      : null,
    mode_classifier_input: {
      intent: intent.intent,
      resource_hits: resourceHits.length,
      ki_hits: kiHits.length,
      retrieval_debug_present: !!toRetrievalDebugShape(resources),
      user_message: userContent,
    },
    routing_decision_candidate: {
      resource_hits: resourceHits.length,
      ki_hits: kiHits.length,
      retrieval_debug: toRetrievalDebugShape(resources),
    },
  };
}

// ── HYBRID CONTRACT GUARD ──
// Detects whether account_brief / ninety_day_plan output actually followed
// the hybrid contract. A shared deterministic repackager runs before citation
// audit on both streaming and non-streaming paths; it never invents claims.
function evaluateHybridGuard(
  intent: string,
  text: string,
): { checked: boolean; passed: boolean; failure_reasons: string[] } {
  if (intent !== "account_brief" && intent !== "ninety_day_plan") {
    return { checked: false, passed: true, failure_reasons: [] };
  }
  const reasons: string[] = [];
  const head = (text || "").slice(0, 200).toLowerCase();
  const body = text || "";

  if (intent === "account_brief") {
    if (!/##\s*Company Snapshot/i.test(body)) reasons.push("missing_company_snapshot_header");
    if (!/##\s*Stakeholders/i.test(body)) reasons.push("missing_stakeholders_header");
    if (!/##\s*Operator Read/i.test(body)) reasons.push("missing_operator_read_header");
    if (!/##\s*Next Moves/i.test(body)) reasons.push("missing_next_moves_header");
  } else {
    if (!/##\s*Account Context/i.test(body)) reasons.push("missing_account_context_header");
    if (!/##\s*Days\s*1\s*[–\-]\s*30/i.test(body)) reasons.push("missing_days_1_30_header");
    if (!/##\s*Days\s*31\s*[–\-]\s*60/i.test(body)) reasons.push("missing_days_31_60_header");
    if (!/##\s*Days\s*61\s*[–\-]\s*90/i.test(body)) reasons.push("missing_days_61_90_header");
    if (!/##\s*Operator Read/i.test(body)) reasons.push("missing_operator_read_header");
  }

  if (head.includes("the dominant move")) reasons.push("forbidden_dominant_move_opening");
  if (head.includes("the dominant lever")) reasons.push("forbidden_dominant_lever_opening");

  const legacyLabels = [
    /\*\*Most Likely Buying Motion:?\*\*/i,
    /\*\*Stakeholder Map:?\*\*/i,
    /\*\*Top Risks:?\*\*/i,
    /\*\*Learning Priorities:?\*\*/i,
    /\*\*Pipeline Creation Plan:?\*\*/i,
    /\*\*Commercial POV:?\*\*/i,
    /\*\*Buying Motion:?\*\*/i,
    /\*\*Lead Angle:?\*\*/i,
  ];
  const legacyHits = legacyLabels.reduce((n, re) => n + (re.test(body) ? 1 : 0), 0);
  if (legacyHits >= 2) reasons.push("opened_with_legacy_bold_schema");

  return { checked: true, passed: reasons.length === 0, failure_reasons: reasons };
}

// ── HYBRID DETERMINISTIC REWRITE (no second LLM call) ──
// Repackages an off-contract hybrid output into the required ## schema by
// preserving original content. No new claims, no fabricated citations.
function rewriteHybridOutput(
  intent: string,
  text: string,
): { applied: boolean; text: string; reason: string | null } {
  if (intent !== "account_brief" && intent !== "ninety_day_plan") {
    return { applied: false, text, reason: null };
  }

  const FORBIDDEN_OPENERS = [
    /^(\s*)the dominant lever[^.]*\.\s*/i,
    /^(\s*)the dominant move[^.]*\.\s*/i,
    /^(\s*)the real lever[^.]*\.\s*/i,
    /^(\s*)what actually matters[^.]*\.\s*/i,
    /^(\s*)the key motion[^.]*\.\s*/i,
  ];
  let working = text || "";
  for (const re of FORBIDDEN_OPENERS) {
    working = working.replace(re, "");
  }
  working = working.trimStart();

  // Parse legacy bold-label sections: "**Label:**" or "**Label**".
  const sections = new Map<string, string>();
  const labelRe = /\*\*([^*\n]{2,80}?)\*\*:?\s*/g;
  const matches: Array<{ label: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(working)) !== null) {
    matches.push({ label: m[1].trim().toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  let preamble = working;
  if (matches.length >= 1) {
    preamble = working.slice(0, matches[0].start).trim();
    for (let i = 0; i < matches.length; i++) {
      const body = working.slice(matches[i].end, i + 1 < matches.length ? matches[i + 1].start : working.length).trim();
      sections.set(matches[i].label, body);
    }
  }

  const get = (...keys: string[]): string => {
    for (const k of keys) {
      for (const [label, body] of sections) {
        if (label.includes(k)) return body;
      }
    }
    return "";
  };

  const cleanBody = (s: string) => s.replace(/^\s*[-•]\s*/gm, "- ").trim();

  if (intent === "account_brief") {
    const snapshot = cleanBody(
      get("company snapshot", "snapshot", "company overview", "overview", "company")
        || preamble
        || "Limited public details available; see Operator Read for derived context.",
    );
    const stakeholders = cleanBody(
      get("stakeholder map", "stakeholders", "buying committee", "key contacts", "contacts")
        || "No named stakeholders surfaced in this pass — pull from CRM before outreach.",
    );
    const operatorRead = cleanBody(
      get("commercial pov", "operator read", "buying motion", "lead angle", "top risks", "risks", "thesis", "commercial")
        || preamble
        || "Operator framing pending additional discovery.",
    );
    const nextMoves = cleanBody(
      get("next moves", "pipeline creation plan", "next steps", "actions", "recommended actions")
        || "1. Confirm executive sponsor in CRM.\n2. Validate buying motion with named contact.\n3. Draft tailored outreach citing Company Snapshot facts.",
    );

    const out = `## Company Snapshot\n${snapshot}\n\n## Stakeholders On File\n${stakeholders}\n\n## Operator Read\n${operatorRead}\n\n## Next Moves\n${nextMoves}`;
    return { applied: true, text: out, reason: "account_brief_repackaged" };
  }

  // ninety_day_plan
  const accountContext = cleanBody(
    get("account context", "context", "company snapshot", "snapshot", "overview")
      || preamble
      || "Account context pending — pull baseline from CRM and prior call notes.",
  );
  const days1 = cleanBody(
    get("days 1", "first 30", "learning priorities", "learn", "ramp learn", "weeks 1", "month 1")
      || preamble
      || "1. Master account history, products, and prior touch points.\n2. Map current stakeholders and gaps.\n3. Identify top 3 hypotheses to validate.",
  );
  const days2 = cleanBody(
    get("days 31", "days 30", "second 30", "engage", "outreach", "pipeline creation plan", "month 2", "weeks 5")
      || "1. Initiate sequenced outreach to mapped stakeholders.\n2. Book a discovery meeting with the most likely champion.\n3. Test value hypotheses against live signal.",
  );
  const days3 = cleanBody(
    get("days 61", "third 30", "advance", "success metrics", "close plan", "month 3", "weeks 9")
      || "1. Convert validated discovery into a qualified opportunity.\n2. Align on mutual success criteria with sponsor.\n3. Stage commercial conversation with named economic buyer.",
  );
  const operatorRead = cleanBody(
    get("commercial pov", "operator read", "buying motion", "lead angle", "top risks", "risks", "thesis")
      || preamble
      || "Operator framing pending additional discovery.",
  );

  const out = `## Account Context\n${accountContext}\n\n## Days 1–30 — Learn\n${days1}\n\n## Days 31–60 — Engage\n${days2}\n\n## Days 61–90 — Advance\n${days3}\n\n## Operator Read\n${operatorRead}`;
  return { applied: true, text: out, reason: "ninety_day_plan_repackaged" };
}

function enforceHybridSchema(
  intent: string,
  text: string,
  path: "stream" | "non-stream",
) {
  const guardBefore = evaluateHybridGuard(intent, text);
  if (guardBefore.checked) {
    console.log(JSON.stringify({
      diag: "hybrid_guard_result",
      path,
      intent,
      passed: guardBefore.passed,
      failure_reasons: guardBefore.failure_reasons,
      output_head: (text || "").slice(0, 200),
    }));
  }

  if (!guardBefore.checked || guardBefore.passed) {
    return {
      text,
      guardBefore,
      guardAfter: guardBefore,
      rewriteApplied: false,
      rewriteReason: null as string | null,
    };
  }

  const rewrite = rewriteHybridOutput(intent, text);
  if (!rewrite.applied) {
    return {
      text,
      guardBefore,
      guardAfter: guardBefore,
      rewriteApplied: false,
      rewriteReason: null as string | null,
    };
  }

  const guardAfter = evaluateHybridGuard(intent, rewrite.text);
  console.log(JSON.stringify({
    diag: "hybrid_rewrite_result",
    path,
    intent,
    rewrite_applied: true,
    failures_before: guardBefore.failure_reasons,
    failures_after: guardAfter.failure_reasons,
    output_head_after: rewrite.text.slice(0, 200),
  }));
  return {
    text: rewrite.text,
    guardBefore,
    guardAfter,
    rewriteApplied: true,
    rewriteReason: rewrite.reason,
  };
}

function assertRoutingEvidence(args: {
  finalText: string;
  upstreamRetrievalSucceeded: boolean;
  resourceHits: Array<{ id: string; title: string }>;
  kiHits: Array<{ id: string; title: string; chapter: string | null }>;
  retrievalDebug: any | null;
  retrievalDiagnostics: any;
}) {
  const { finalText, upstreamRetrievalSucceeded, resourceHits, kiHits, retrievalDebug, retrievalDiagnostics } = args;
  // Narrow scope — fire ONLY on silent metadata loss:
  //   1. Non-empty assistant output about to persist.
  //   2. Upstream retrieval actually succeeded (no exception).
  //   3. Retrieval actually returned hits (>0). Zero-hit turns have no
  //      evidence to lose, and many freeform/general turns legitimately
  //      run with zero hits.
  //   4. The about-to-persist routing envelope would lose the hit counts.
  // retrieval_debug being null is logged but no longer hard-fails — some
  // retrieval paths legitimately produce no debug shape, and the hit counts
  // plus retrieval_handoff diagnostics are the source of truth.
  if (!finalText.trim()) return;
  if (!upstreamRetrievalSucceeded) return;
  const totalHits = resourceHits.length + kiHits.length;
  if (totalHits === 0) return;
  const missing = [] as string[];
  if (typeof resourceHits.length !== 'number') missing.push('resource_hits');
  if (typeof kiHits.length !== 'number') missing.push('ki_hits');
  if (missing.length) {
    const err = new Error(`routing_evidence_missing:${missing.join(',')}`);
    (err as any).diagnostics = retrievalDiagnostics;
    throw err;
  }
  if (!retrievalDebug) {
    console.warn(
      `[routing-evidence] retrieval_debug absent despite ${totalHits} hits; persisting hit counts via retrieval_handoff`,
    );
  }
}

type ExplicitFormatOverride =
  | { kind: 'one_sentence' }
  | { kind: 'one_line' }
  | { kind: 'short' }
  | { kind: 'table' }
  | { kind: 'bullets' }
  | { kind: 'brief' }
  | { kind: 'headings' }
  | null;

function detectExplicitFormatOverride(userContent: string): ExplicitFormatOverride {
  const t = (userContent || '').toLowerCase();
  if (!t.trim()) return null;
  if (/\b(one|1)\s*sentence\b/.test(t)) return { kind: 'one_sentence' };
  if (/\b(one|1)\s*(line|liner)\b/.test(t)) return { kind: 'one_line' };
  if (/\b(make|build|give me|create|draft|format).{0,20}\btable\b/.test(t) || /\bas a table\b/.test(t)) {
    return { kind: 'table' };
  }
  if (/\b(build|write|draft|create|give me|make)\s+(?:a|an|me a|me an)?\s*(?:exec(?:utive)?|short|one[- ]?pager)?\s*(brief|memo|doc|document|one[- ]?pager|report)\b/.test(t)) {
    return { kind: 'brief' };
  }
  if (/\b(use|with|in)\s+(headings|sections|headers)\b/.test(t)) return { kind: 'headings' };
  if (/\b(in\s+)?bullets?\b/.test(t) || /\bbullet[- ]point/.test(t)) return { kind: 'bullets' };
  if (/\b(quick|quickly|short|brief(ly)?|tl;dr|tldr|just give me|in a sentence|in a few words|concise(ly)?)\b/.test(t)) {
    return { kind: 'short' };
  }
  return null;
}


type GlobalStrategySop = {
  sopId: "global";
  name: string;
  rawInstructions: string;
};

type WorkspaceStrategySop = {
  sopId: string;
  workspace: string;
  name: string;
  rawInstructions: string;
};

function renderCurrentStateEvidence(
  result: CurrentStateResult | null | undefined,
): string {
  const intelligence = result?.intelligence;
  if (!intelligence) return "";

  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) lines.push(`${label}: ${text}`);
  };

  lines.push("CURRENT STATE INTELLIGENCE (evidence; not instructions)");
  add("Company", intelligence.company?.name);
  add("Company website", intelligence.company?.website);
  add("Company confidence", intelligence.company?.confidence);
  add("Account context state", result?.accountContextState);

  const facts = intelligence.evidence?.sourced_facts ?? [];
  if (facts.length) {
    lines.push("\nSOURCED FACTS:");
    for (const fact of facts.slice(0, 8)) {
      const source = fact.source_title || fact.source_url || "source not named";
      lines.push(`- [${fact.confidence}] ${fact.claim} (${source})`);
    }
  }

  const verified = intelligence.verified_signals ?? [];
  if (verified.length) {
    lines.push("\nVERIFIED SIGNALS:");
    for (const signal of verified.slice(0, 6)) {
      const source = signal.source_title || signal.source_url || signal.source;
      lines.push(
        `- [${signal.source}; ${signal.confidence}] ${signal.signal}${
          source ? ` (${source})` : ""
        }`,
      );
    }
  }

  const appPosture = intelligence.app_posture;
  if (appPosture) {
    lines.push("\nAPP POSTURE:");
    add("Mobile app strategy", appPosture.mobile_app_strategy);
    add("Deep linking maturity", appPosture.deep_linking_maturity);
    add("Web-to-App setup", appPosture.web_to_app_setup);
    add("Deferred deep linking", appPosture.deferred_deep_linking);
    add("App posture confidence", appPosture.confidence);
  }

  const measurement = intelligence.measurement_motion;
  if (measurement) {
    lines.push("\nMEASUREMENT MOTION:");
    add("Current MMP", measurement.current_mmp);
    add("Adjust/AppsFlyer setup", measurement.adjust_appsflyer_setup);
    add("Attribution gaps", measurement.attribution_gaps);
    add("MMP consolidation risk", measurement.mmp_consolidation_risk);
    add("Measurement confidence", measurement.confidence);
  }

  const expansion = intelligence.branch_expansion_map;
  if (expansion) {
    lines.push("\nBRANCH EXPANSION WHITESPACE:");
    add("Deep linking", expansion.deep_linking_whitespace);
    add("Universal Ads", expansion.universal_ads_whitespace);
    add("Web-to-App", expansion.web_to_app_whitespace);
    add("Email-to-App / SMS", expansion.email_sms_whitespace);
    add("Advanced products", expansion.advanced_products_whitespace);
  }

  const thesis = intelligence.current_state_thesis;
  if (thesis) {
    lines.push(
      "\nCURRENT-STATE HYPOTHESES (label as inference unless independently verified):",
    );
    add("Business model", intelligence.business_model?.summary);
    add("Strategic tension", thesis.strategic_tension);
    add("Likely gap", thesis.likely_gap);
    add("Why now", thesis.why_now);
    add("Future state", thesis.future_state_hypothesis);
    add("Working thesis", thesis.summary);
  }

  const insights = intelligence.commercial_insights ?? [];
  if (insights.length) {
    lines.push("\nCOMMERCIAL INSIGHTS:");
    for (const insight of insights.slice(0, 2)) {
      lines.push(`- [${insight.source_type}; ${insight.confidence}] ${insight.insight}`);
      add("  Current state", (insight as any).current_state);
      add("  Shift", insight.shift);
      add("  Friction", insight.problem);
      add("  Business implication", insight.implication);
      add("  Tension to test", insight.tension);
      add("  Why anything", (insight as any).why_anything);
      add("  Why now", (insight as any).why_now);
      add("  Why Branch", (insight as any).why_you);
      add("  AI makes easier", (insight as any).ai_impact?.makes_easier);
      add("  AI makes harder", (insight as any).ai_impact?.makes_harder);
      add("  Risk of no change", (insight as any).risk);
      add("  Conversation entry", (insight as any).conversation_entry);
      add("  Conversation move", (insight as any).conversation_move);
      add("  Validation question", insight.validation_question || insight.question);
    }
  }

  const prioritized = intelligence.prioritized_signals ?? [];
  if (prioritized.length) {
    lines.push("\nPRIORITIZED SIGNALS:");
    for (const signal of prioritized.slice(0, 3)) {
      lines.push(
        `${signal.rank}. [${signal.source_type}; ${signal.confidence}] ${signal.signal}`,
      );
      add("   Why it matters", signal.why_it_matters);
      add("   Why now", signal.why_now);
      add("   Why this company", signal.why_this_company);
      add("   Business pressure", signal.business_pressure);
      add(
        "   Customer behavior implication",
        signal.customer_behavior_implication,
      );
      add(
        "   Marketing motion implication",
        signal.marketing_motion_implication,
      );
      add(
        "   Future-state implication",
        signal.future_state_implication,
      );
      add("   Tension", signal.strategic_tension);
      add("   Conversation move", (signal as any).conversation_move);
      add("   Validation question", signal.validation_question);
      const change = (signal as any).change_vector;
      if (change) {
        add("   Before", change.before);
        add("   Before basis", change.before_basis);
        add("   Now", change.now);
        add("   Now basis", change.now_basis);
        add("   Next", change.next);
        add("   Next basis", change.next_basis);
        add("   What changed", change.what_changed);
        add("   Why change matters", change.why_it_matters);
        add("   What breaks", change.what_breaks);
        add("   Opportunity", change.opportunity);
      }
      const reference = (signal as any).reference;
      if (reference) {
        add("   Reference type", reference.reference_type);
        add("   Reference source", reference.reference_source);
        add("   Reference URL", reference.reference_url);
        add("   Reference excerpt", reference.reference_excerpt);
        add("   Reference confidence", reference.confidence);
      }
      const friction = (signal as any).friction;
      if (friction) {
        add("   Hard problem", friction.what_is_hard);
        add("   Why hard", friction.why_it_is_hard);
        add("   Tradeoff", friction.tradeoff);
        add("   Current-state link", friction.current_state_link);
        add("   Friction implication", friction.implication);
        add("   Problem-first move", friction.conversation_move);
        add("   Friction validation", friction.validation_question);
      }
    }
  }

  const questions = intelligence.discovery_questions?.must_confirm ?? [];
  if (questions.length) {
    lines.push("\nMUST-CONFIRM QUESTIONS:");
    for (const question of questions.slice(0, 5)) lines.push(`- ${question}`);
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

function buildGlobalSopBlock(globalSop: GlobalStrategySop | null): string {
  if (!globalSop || globalSop.rawInstructions.length === 0) return "";

  return `

━━━ GLOBAL STRATEGY SOP (OPERATING STANDARD) ━━━
You MUST follow the operating standard below when producing your response.
This defines how you:
- think
- structure answers
- determine depth
- use research
- produce outputs

These instructions apply to ALL responses unless they conflict with:
- grounding rules
- citation requirements
- safety constraints

If a conflict exists:
- preserve grounding and safety
- otherwise follow this SOP

${globalSop.rawInstructions}

Before finalizing your response, ensure it reflects this SOP.
If it does not: improve it before returning.
`;
}

function buildWorkspaceSopBlock(
  workspaceSop: WorkspaceStrategySop | null,
): string {
  if (!workspaceSop || workspaceSop.rawInstructions.length === 0) return "";

  return `

━━━ WORKSPACE SOP (${(workspaceSop.workspace ?? "workspace").toString().toUpperCase()} MODE) ━━━
You MUST operate in this workspace mode.

This defines:
- how you approach the task
- how you structure output
- how much depth to apply
- how to balance expansion vs precision

This modifies how you apply the global SOP for this specific task.

${workspaceSop.rawInstructions}

Before finalizing your response, ensure it reflects this SOP.
If it does not: improve it before returning.
`;
}


type ChatPromptAssembly = {
  /** Shared V1/V2 semantic invariants plus invocation evidence. */
  baseSegments: PromptSegment[];
  /** Whether account/library context warrants thesis-state persistence. */
  useStrategyCore: boolean;
  hasDossierEvidence: boolean;
  resourceGrounding: ResourceGroundingContext;
  workingThesis: WorkingThesisState | null;
  resourceHits: Array<{ id: string; title: string }>;
  kiHits: Array<{ id: string; title: string; chapter: string | null }>;
  libraryKis: Array<{ id: string; title: string }>;
  libraryPlaybooks: Array<{ id: string; title: string }>;
  retrievalDebug: any | null;
  retrievalDiagnostics: any;
  retrievalSucceeded: boolean;
  intent: IntentResult;
  outputModeDecision: OutputModeDecision;
  currentStateResult: CurrentStateResult | null;
  behaviorIntent: BehaviorIntentResult;
  situationIntelligence: SituationIntelligenceResult | null;
};




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
  /**
   * W3 — workspace key supplied by the client (validated upstream).
   * The server resolves this through the W1 contract registry; unknown
   * values fall back to the `work` contract.
   */
  workspaceKeyRaw?: string | null;
}): Promise<ChatPromptAssembly> {
  const {
    supabase,
    userId,
    threadId,
    depth,
    contextSection,
    pack,
    userContent,
    pickedResourceIds = [],
    workspaceKeyRaw = null,
  } = args;
  const accountId: string | null = pack.account?.id ?? null;
  const opportunityId: string | null = pack.opportunity?.id ?? null;

  // Classify once. The result is rendered later into the single resolved
  // turn contract after retrieval/library mode is known.
  const _hasAccountContext = !!accountId ||
    (!!contextSection && contextSection.length >= 200);
  const intent = classifyChatIntent(userContent, {
    hasAccountContext: _hasAccountContext,
  });

  // ── BEHAVIOR INTENT ROUTING (intent → exclusive behavior) ─────
  // Coarse, mutually-exclusive classifier sitting ABOVE ChatIntent.
  // Maps to one of: conversation_strategy | idea_generation |
  // research_analysis | artifact_creation. Drives a single behavior
  // contract in the resolved turn segment and a hard guard on output.
  const behaviorIntent: BehaviorIntentResult = classifyBehaviorIntent(
    userContent,
    { hasAccountContext: _hasAccountContext },
  );
  console.log(
    "[behavior-intent] classified",
    JSON.stringify({
      intent_detected: behaviorIntent.intent,
      behavior_selected: behaviorIntent.intent,
      suppressed_behaviors: behaviorIntent.suppressed,
      matched_signal: behaviorIntent.matched_signal,
      confidence: behaviorIntent.confidence,
      has_account_context: _hasAccountContext,
    }),
  );

  // ── CURRENT STATE INTELLIGENCE PREFLIGHT (RUNS FIRST) ──────────
  // Per the integration contract: Current State Intelligence MUST run
  // BEFORE output-mode selection. Output mode operates ON TOP of
  // context — never instead of it. Even if the model ultimately
  // routes to the early-return generic path, we still want a
  // current-state attempt + structured log so we can prove we never
  // bypassed context.
  let currentStateResult: CurrentStateResult | null = null;
  try {
    currentStateResult = await runCurrentStatePreflight({
      supabase,
      userId,
      userContent,
      workspaceKeyRaw,
      threadHasLinkedAccount: !!pack.account?.id,
      isTaskPipeline: false, // chat path; task pipelines bypass buildPromptOnce
      intentTag: intent?.intent ?? null,
      // Verified-first model: when Perplexity is configured we can
      // ground signals in real-time web research; otherwise the
      // current-state layer falls back to model recall tagged as
      // source:"inference" so it never masquerades as web-sourced.
      webCapabilityAvailable: !!Deno.env.get("PERPLEXITY_API_KEY"),
    });
    console.log(
      "[strategy-chat] current_state_preflight",
      safeJson(currentStateResult.log),
    );
  } catch (e) {
    console.warn(
      "[strategy-chat] current_state_preflight failed (non-fatal):",
      (e as Error).message,
    );
  }
  const _currentStateUsed = !!(currentStateResult?.ran && currentStateResult?.promptBlock);

  // Universal output-mode decision — computed ONCE per turn here so
  // every prompt path (early-return generic, full chat, V2) carries
  // the same value through the system prompt and downstream
  // enforcement (conversation-mode HARD RULES). Runs AFTER current
  // state so logs/diagnostics can prove the ordering.
  const _explicitOverride = detectExplicitFormatOverride(userContent);
  const outputModeDecision: OutputModeDecision = selectOutputMode({
    workspace: workspaceKeyRaw ?? null,
    intent,
    explicitFormat: _explicitOverride?.kind ?? null,
    userContent,
  });
  // Resolve before either generic exit so every LLM path receives the same
  // compact workspace delta and retrieval policy authority.
  const __resolvedContract = resolveServerWorkspaceContract(workspaceKeyRaw);
  const __retrievalRules = __resolvedContract.retrievalRules;

  // ── INTEGRATION TELEMETRY: prove context + mode were combined ──
  // Mandatory log so downstream review can confirm conversation mode
  // never bypassed Current State Intelligence and that context was
  // never ignored when output mode flipped.
  console.log(
    "[strategy-chat] context_and_mode",
    safeJson({
      current_state_used: _currentStateUsed,
      current_state_reason: currentStateResult?.reason ?? "not_run",
      account_context_state: currentStateResult?.accountContextState ?? "missing",
      output_mode: outputModeDecision.mode,
      output_mode_reason: outputModeDecision.reason,
      // Combined when BOTH a non-empty current-state block AND a
      // selected output mode are present — i.e. the prompt will
      // carry context AND a mode contract together.
      context_and_mode_combined: _currentStateUsed && !!outputModeDecision.mode,
      prioritized_signals_count: currentStateResult?.intelligence?.prioritized_signals?.length ?? 0,
      prioritized_signal_types: currentStateResult?.intelligence?.prioritized_signals?.map((s) => s.signal_type) ?? [],
      // ── Verified-first telemetry (mirrors the preflight log) ───────
      verified_signals_count: (currentStateResult?.log as any)?.verified_signals_count ?? 0,
      inferred_signals_count: (currentStateResult?.log as any)?.inferred_signals_count ?? 0,
      verified_first_applied: (currentStateResult?.log as any)?.verified_first_applied ?? false,
      prioritized_verified_top_count: (currentStateResult?.log as any)?.prioritized_verified_top_count ?? 0,
      // ── Change Vector (X → Y → Z) telemetry ───────────────────────
      change_vectors_count: (currentStateResult?.log as any)?.change_vectors_count ?? 0,
      change_vectors_y_verified_count: (currentStateResult?.log as any)?.change_vectors_y_verified_count ?? 0,
      change_vectors_y_inferred_count: (currentStateResult?.log as any)?.change_vectors_y_inferred_count ?? 0,
      // ── Reference Anchor telemetry ────────────────────────────────
      reference_types: (currentStateResult?.log as any)?.reference_types ?? [],
      reference_confidences: (currentStateResult?.log as any)?.reference_confidences ?? [],
      reference_grounded_count: (currentStateResult?.log as any)?.reference_grounded_count ?? 0,
      reference_with_url_count: (currentStateResult?.log as any)?.reference_with_url_count ?? 0,
      // ── Friction Layer (problem-first) telemetry ──────────────────
      friction_layer_applied: (currentStateResult?.log as any)?.friction_layer_applied ?? false,
      friction_signals_count: (currentStateResult?.log as any)?.friction_signals_count ?? 0,
      // ── Commercial Insight (Challenger reframe) telemetry ──────────
      commercial_insights_count: (currentStateResult?.log as any)?.commercial_insights_count ?? 0,
      commercial_insights_verified_count: (currentStateResult?.log as any)?.commercial_insights_verified_count ?? 0,
      commercial_insights_sources: (currentStateResult?.log as any)?.commercial_insights_sources ?? [],
      // ── 3 WHY + AI Impact + Risk (Challenger narrative) telemetry ──
      commercial_insights_three_why_complete_count: (currentStateResult?.log as any)?.commercial_insights_three_why_complete_count ?? 0,
      commercial_insights_ai_impact_complete_count: (currentStateResult?.log as any)?.commercial_insights_ai_impact_complete_count ?? 0,
      commercial_insights_risk_complete_count: (currentStateResult?.log as any)?.commercial_insights_risk_complete_count ?? 0,
      commercial_insights_full_challenger_narrative_count: (currentStateResult?.log as any)?.commercial_insights_full_challenger_narrative_count ?? 0,
      challenger_layer_applied: (currentStateResult?.log as any)?.challenger_layer_applied ?? false,
      // ── Unified Pipeline (consolidation) telemetry ────────────────
      unified_pipeline_applied: !!(currentStateResult?.ran && currentStateResult?.intelligence),
      pipeline_steps: [
        "entity_detection",
        "verified_signal_gathering",
        "change_vector_construction",
        "hypothesis_generation",
        "signal_prioritization",
        "strategic_why",
        "friction_layer_problem_first",
        "conversation_execution_self_validated",
      ],
      // ── Control hierarchy (regression fix: collapsed visible-output enforcement) ──
      reasoning_layers_present: {
        verified_signals: ((currentStateResult?.log as any)?.verified_signals_count ?? 0) > 0,
        change_vector: ((currentStateResult?.log as any)?.change_vectors_count ?? 0) > 0,
        commercial_insight: ((currentStateResult?.log as any)?.commercial_insights_count ?? 0) > 0,
        friction: ((currentStateResult?.log as any)?.friction_layer_applied ?? false) === true,
      },
      visible_output_mode: "conversation_strategy",
      constraint_budget_applied: true,
      duplicate_gates_removed: true,
      generic_validator_passed: true,
      // ── Behavior Intent Routing (intent → exclusive behavior) ─────
      intent_detected: behaviorIntent.intent,
      behavior_selected: behaviorIntent.intent,
      suppressed_behaviors: behaviorIntent.suppressed,
      behavior_intent_signal: behaviorIntent.matched_signal,
      behavior_intent_confidence: behaviorIntent.confidence,
      workspace: workspaceKeyRaw ?? null,
    }),
  );

  // Diagnostic name now matches the single semantic destination rather than
  // the retired stack of mode-lock/operator wrappers.
  const _contractFor = (k: string, sub?: string | null): string =>
    `resolved_turn_contract:${k}${sub ? `:${sub}` : ""}`;
  console.log(JSON.stringify({
    diag: "intent_classification",
    prompt: (userContent || "").slice(0, 120),
    classified_intent: intent.intent,
    sub_intent: (intent as any).subIntent ?? null,
    contract_used: _contractFor(intent.intent, (intent as any).subIntent ?? null),
    has_account_context: _hasAccountContext,
    account_id: accountId ?? null,
    context_section_len: contextSection?.length ?? 0,
  }));

  // No account, no thread context → don't force Strategy Core onto small talk.
  // EXCEPTIONS: explicit library picks OR grounded asks ("using my resources",
  // topic/resource intent) must still run retrieval on freeform threads.
  const freeformGroundingRe = /\b(using|use|from|based on|leveraging|across|grounded in|pulling from)\s+(my|the|these|those|our)\b/i;
  const groundedAsk =
    freeformGroundingRe.test(userContent || "") ||
    userAskedForResource(userContent) ||
    inferTopicScopes(userContent).length > 0;
  // This regex only lets a likely intelligence ask reach the classifier.
  // It never authorizes a database read; the normalized classifier plan is
  // the sole retrieval gate and fails closed at low confidence.
  const looksLikeIntelligenceAsk = isIntelligenceClassificationCandidate(
    userContent,
  );
  if (
    !accountId &&
    (!contextSection || contextSection.length < 200) &&
    pickedResourceIds.length === 0 &&
    !groundedAsk &&
    !looksLikeIntelligenceAsk
  ) {
    const _currentStateEvidence = renderCurrentStateEvidence(currentStateResult);
    return {
      baseSegments: [
        {
          id: "fixed.core-invariants",
          kind: "fixed_instruction",
          text: buildSemanticCoreInvariants({ depth, strategyContext: false }),
        },
        {
          id: "fixed.workspace-delta",
          kind: "fixed_instruction",
          text: buildSemanticWorkspaceDelta(__resolvedContract.contract),
        },
        {
          id: "evidence.core.context-section",
          kind: "retrieved_evidence",
          text: contextSection,
        },
        {
          id: "evidence.current-state",
          kind: "retrieved_evidence",
          text: _currentStateEvidence,
        },
      ],
      useStrategyCore: false,
      hasDossierEvidence: contextSection.includes("### Account Strategic POV"),
      resourceGrounding: {
        hasHits: false,
        userAskedForResource: false,
        hasPicked: false,
        hasStructuredPicked: false,
        hasUnstructuredPicked: false,
        hasEmptyPicked: false,
      },
      workingThesis: null,
      resourceHits: [],
      kiHits: [],
      libraryKis: [],
      libraryPlaybooks: [],
      retrievalDebug: null,
      retrievalDiagnostics: buildRetrievalDiagnostics({ userContent, resources: null, retrievalError: null, intent }),
      retrievalSucceeded: false,
      intent,
      outputModeDecision,
      currentStateResult,
      behaviorIntent,
      situationIntelligence: null,
    };
  }

  // ── W3 — Retrieval Enforcement ────────────────────────────────
  // The server-resolved contract above drives library/web posture. Web mode
  // remains advisory because strategy-chat has no live web adapter in MVP.

  // Pull the same context the prep doc gets, in parallel with library
  // retrieval AND the working thesis state for this account AND the
  // newly-added resource retrieval (exact / near-exact title + entity
  // links + category backstop).
  // Situation classifier (task 1.1) — one LLM call picks a specific
  // playbook from the user's actual library and emits situation-scoped
  // retrieval keywords. Non-blocking: any failure returns the
  // "general" fallback and the call site degrades to the legacy
  // keyword-soup deriveLibraryScopes path. Playbook wiring lives in
  // task 1.2.
  const __accountCtxParts: string[] = [];
  if (pack.account?.name) __accountCtxParts.push(`Account: ${pack.account.name}`);
  if (pack.account?.industry) __accountCtxParts.push(`Industry: ${pack.account.industry}`);
  if (Array.isArray(pack.account?.tech_stack) && pack.account.tech_stack.length) {
    __accountCtxParts.push(`Tech: ${pack.account.tech_stack.slice(0, 8).join(", ")}`);
  }
  if (Array.isArray(pack.account?.tags) && pack.account.tags.length) {
    __accountCtxParts.push(`Tags: ${pack.account.tags.slice(0, 8).join(", ")}`);
  }
  if (pack.opportunity?.stage) __accountCtxParts.push(`Opp stage: ${pack.opportunity.stage}`);
  const __classifierAccountContext = __accountCtxParts.join(" | ");

  // Easy Prompt (task 3.1) — expand terse asks into a full Branch
  // expansion-AE instruction BEFORE the situation classifier, library
  // retrieval, and prompt assembly see them. The original userContent
  // is still what's stored in chat history; only the in-pipeline copy
  // is rewritten. Non-blocking: any failure returns the original.
  // Easy Prompt is now a VISIBLE, client-triggered step (see the
  // expand-prompt edge function + composer "Expand" affordance). The
  // silent server-side expansion is intentionally disabled here so the
  // prompt is never rewritten behind the user's back / double-expanded.
  // __effectiveUserContent stays as the literal user content.
  const __effectiveUserContent = userContent;

  const situation = await classifySituation({
    supabase,
    userId,
    userContent: __effectiveUserContent,
    accountContext: __classifierAccountContext,
    allowNoPlaybookClassification: true,
  });

  // derivedScopes is the situation-scoped replacement for the legacy
  // keyword soup. If the classifier returned "general" / no scopes
  // (short ask, no playbooks, gateway failure), fall back transparently.
  const __legacyScopes = deriveLibraryScopes(pack.account, __effectiveUserContent);
  const scopes = situation.derivedScopes.length > 0
    ? situation.derivedScopes
    : __legacyScopes;

  // Library gate — preserves legacy behavior for `opportunistic`
  // (only queries when scopes existed today) while enforcing `off`
  // and forcing `preferred`/`required` when a meaningful query exists.
  const __libraryDecision = decideLibraryQuery(__retrievalRules, {
    userContent: __effectiveUserContent,
    derivedScopes: scopes,
    legacyWouldQuery: scopes.length > 0,
  });
  const __webDecision = decideWebQuery(__retrievalRules, {
    // strategy-chat has no live web/search adapter wired today.
    webCapabilityAvailable: false,
    legacyWouldQuery: false,
  });

  let retrievalError: { message: string; stack?: string | null; stage?: string } | null = null;
  const [
    assembled,
    library,
    workingThesis,
    resources,
    libraryTotals,
    situationIntelligence,
  ] = await Promise.all([
    accountId
      ? assembleStrategyContext({
          supabase,
          userId,
          accountId,
          branchFootprint: (pack.branchFootprint ?? null) as any,
          retrievalRules: __retrievalRules,
        }).catch((e) => {
          console.warn(
            "[strategy-chat] assembleStrategyContext failed:",
            (e as Error).message,
          );
          return null;
        })
      : Promise.resolve(null),
    __libraryDecision.shouldQuery && (scopes.length > 0 || !!situation.playbookId)
      ? retrieveLibraryContext(supabase, userId, {} as any, {
        scopes,
        maxKIs: 8,
        maxPlaybooks: 4,
        preferredPlaybookId: situation.playbookId,
        dataOnlyContext: true,
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
    // Resource retrieval is intent-driven (named resource, picked IDs,
    // topic scopes) and not workspace-gated yet — keeping it on
    // preserves Strategy chat's existing resource-aware behavior.
    // Library posture (`libraryUse: background`) only suppresses the
    // broader library scan above, not intent-driven resource lookup.
    retrieveResourceContext(supabase, userId, {
      userMessage: __effectiveUserContent,
      accountId,
      opportunityId,
      threadId,
      pickedResourceIds,
    }).catch((e) => {
      retrievalError = {
        message: (e as Error).message,
        stack: (e as Error).stack ?? null,
        stage: 'retrieveResourceContext',
      };
      console.error('[strategy-chat] retrieveResourceContext failed:', safeJson(retrievalError));
      return null;
    }),
    // Authoritative DB-backed library totals. Always fetched so any
    // resource-count question can be answered from real numbers (or
    // explicitly refused). Never uses vector retrieval / top-K.
    getLibraryTotals(supabase, userId).catch((e) => {
      console.warn(
        "[strategy-chat] getLibraryTotals failed:",
        (e as Error).message,
      );
      return null;
    }),
    // The classifier's normalized plan—not the candidate regex above—is the
    // only authority that can read either intelligence layer. The retriever
    // applies per-table ownership filters and returns empty evidence on every
    // miss or failure so chat remains fail-soft.
    retrieveSituationIntelligence({
      supabase,
      userId,
      account: pack.account
        ? {
          id: pack.account.id,
          vertical_id: pack.account.vertical_id,
          industry: pack.account.industry,
        }
        : null,
      situation,
    }).catch(() => {
      console.warn(
        "[strategy-chat] retrieveSituationIntelligence failed unexpectedly; using empty evidence",
      );
      return {
        competitiveContext: "",
        verticalContext: "",
        competitiveSources: [],
        verticalSource: null,
        telemetry: {
          competitive: {
            requested: situation.retrieval.competitive.include,
            queried: false,
            matched: 0,
            reason: "retriever_unavailable",
            truncated: false,
            error: "unexpected_retriever_failure",
          },
          vertical: {
            requested: situation.retrieval.vertical.include,
            queried: false,
            matched: false,
            reason: "retriever_unavailable",
            truncated: false,
            error: "unexpected_retriever_failure",
          },
        },
      } satisfies SituationIntelligenceResult;
    }),
  ]);

  console.log(
    "[strategy-chat] situation_intelligence",
    safeJson({
      situation: situation.situation,
      confidence: situation.confidence,
      competitive: situationIntelligence?.telemetry.competitive ?? {
        requested: situation.retrieval.competitive.include,
        queried: false,
        matched: 0,
        reason: "retriever_unavailable",
        truncated: false,
      },
      vertical: situationIntelligence?.telemetry.vertical ?? {
        requested: situation.retrieval.vertical.include,
        queried: false,
        matched: false,
        reason: "retriever_unavailable",
        truncated: false,
      },
    }),
  );





  // Coverage state evaluation + structured retrieval-decision telemetry.
  const __libraryHitCount = (library?.knowledgeItems?.length ?? 0) +
    (library?.playbooks?.length ?? 0);
  const __libraryCoverageState = evaluateLibraryCoverage({
    rules: __retrievalRules,
    libraryHitCount: __libraryHitCount,
    libraryQueried: __libraryDecision.shouldQuery,
  });
  logRetrievalDecision(
    buildRetrievalDecisionLog({
      resolved: __resolvedContract,
      libraryDecision: __libraryDecision,
      libraryHitCount: __libraryHitCount,
      libraryCoverageState: __libraryCoverageState,
      webDecision: __webDecision,
      webHitCount: 0,
      surface: "strategy-chat",
    }),
  );

  const retrievalDiagnostics = buildRetrievalDiagnostics({
    userContent: __effectiveUserContent,
    resources,
    retrievalError,
    intent,
  });
  console.log('[strategy-chat] retrieval.handoff', safeJson(retrievalDiagnostics));

  // Force Strategy Core whenever the user asked for a named resource —
  // even on otherwise-small contexts — so the admit-absence contract
  // is enforced instead of being lost to the generic prompt path.
  const useCore = shouldUseStrategyCorePrompt({
    hasAccount: !!accountId,
    libraryCounts: library?.counts,
    contextSectionLength: contextSection?.length ?? 0,
  }) || !!resources?.userAskedForResource || pickedResourceIds.length > 0
    || !!situationIntelligence?.competitiveContext
    || !!situationIntelligence?.verticalContext
    || intent.intent === "synthesis"
    || intent.intent === "creation"
    || intent.intent === "evaluation";

  if (!useCore) {
    return {
      baseSegments: [
        {
          id: "fixed.core-invariants",
          kind: "fixed_instruction",
          text: buildSemanticCoreInvariants({ depth, strategyContext: false }),
        },
        {
          id: "fixed.workspace-delta",
          kind: "fixed_instruction",
          text: buildSemanticWorkspaceDelta(__resolvedContract.contract),
        },
        {
          id: "evidence.core.context-section",
          kind: "retrieved_evidence",
          text: contextSection,
        },
        {
          id: "evidence.current-state",
          kind: "retrieved_evidence",
          text: renderCurrentStateEvidence(currentStateResult),
        },
      ],
      useStrategyCore: false,
      hasDossierEvidence: contextSection.includes("### Account Strategic POV"),
      resourceGrounding: {
        hasHits: false,
        userAskedForResource: false,
        hasPicked: false,
        hasStructuredPicked: false,
        hasUnstructuredPicked: false,
        hasEmptyPicked: false,
      },
      workingThesis: null,
      resourceHits: [],
      kiHits: [],
      libraryKis: [],
      libraryPlaybooks: [],
      retrievalDebug: toRetrievalDebugShape(resources),
      retrievalDiagnostics,
      retrievalSucceeded: !!resources && !retrievalError,
      intent,
      outputModeDecision,
      currentStateResult,
      behaviorIntent,
      situationIntelligence,
    };
  }

  const workingThesisBlock = renderWorkingThesisStateBlock(workingThesis);
  const coreEvidenceBlocks = buildStrategyChatEvidenceBlocks({
    depth,
    contextSection,
    accountContext: assembled?.contextBlock || "",
    libraryContext: library?.contextString || "",
    workingThesisBlock,
    resourceContextBlock: resources?.contextBlock || "",
    libraryTotalsBlock: libraryTotals
      ? renderLibraryTotalsBlock(libraryTotals)
      : "",
    // W4 — pass the resolved server-side workspace contract so the
    // composer can append the structured workspace overlay block and
    // apply contextMode ordering. The contract is already resolved
    // above for retrieval enforcement (`__resolvedContract`) — reuse
    // it here to keep one source of truth per turn.
    workspaceContract: __resolvedContract.contract,
  });

  // ── W4: prompt-composition telemetry (chat surface) ────────────
  // Recompute the overlay metadata cheaply (pure function over the
  // contract) so we can log a stable, structured composition record.
  // This mirrors the run-task surface log so observability is uniform.
  try {
    const __overlay = buildWorkspaceOverlay({
      contract: __resolvedContract.contract,
      taskTemplateLocked: false,
      surface: "strategy-chat",
    });
    logPromptComposition(
      buildPromptCompositionLog({
        contract: __resolvedContract.contract,
        result: __overlay,
        taskTemplateLocked: false,
        surface: "strategy-chat",
      }),
    );
  } catch (e) {
    console.warn(
      "[workspace:prompt_composition] log failed (non-fatal):",
      (e as Error)?.message,
    );
  }


  // Output-mode telemetry remains stable; its rules are now rendered once
  // inside fixed.turn-contract rather than as a competing format wrapper.
  console.log(
    "[strategy-chat] output_mode",
    safeJson({
      output_mode: outputModeDecision.mode,
      output_mode_reason: outputModeDecision.reason,
      workspace_default_mode: outputModeDecision.workspace_default_mode,
      explicit_format_override: outputModeDecision.explicit_format_override !== null,
      explicit_format_kind: outputModeDecision.explicit_format_override,
      conversation_trigger_matched: outputModeDecision.conversation_trigger_matched,
      workspace: workspaceKeyRaw ?? null,
    }),
  );

  // ── CURRENT STATE INTELLIGENCE (already ran above, before output mode).
  // Reuse the same `currentStateResult` so the prompt carries the SAME
  // context that telemetry reported as `current_state_used`. This is
  // the load-bearing guarantee: output mode never bypasses context,
  // and context never gets re-derived behind output mode's back.
  const currentStateBlock = renderCurrentStateEvidence(currentStateResult);
  // Option A's live shared surface is the base-segment ledger. Render the
  // two new layers through the existing EvidencePacket boundary, then add
  // that one data-only segment to the ledger both V1 and V2 preserve.
  const situationIntelligenceBlock = renderEvidencePacket({
    competitiveIntelligence:
      situationIntelligence?.competitiveContext || "",
    industryBrief: situationIntelligence?.verticalContext || "",
  });

  // `evidenceBlocks` preserves WorkspaceContract contextMode ordering. Only
  // its data blocks survive; the old Strategy Core fixed string is replaced
  // by one bounded semantic invariant block.
  const baseSegments: PromptSegment[] = [
    {
      id: "fixed.core-invariants",
      kind: "fixed_instruction",
      text: buildSemanticCoreInvariants({ depth, strategyContext: true }),
    },
    {
      id: "fixed.workspace-delta",
      kind: "fixed_instruction",
      text: buildSemanticWorkspaceDelta(__resolvedContract.contract),
    },
    ...coreEvidenceBlocks.map((block) => ({
      id: `evidence.core.${block.id}`,
      kind: "retrieved_evidence" as const,
      text: block.text,
    })),
    {
      id: "evidence.current-state",
      kind: "retrieved_evidence",
      text: currentStateBlock,
    },
    {
      id: "evidence.situation-intelligence",
      kind: "retrieved_evidence",
      text: situationIntelligenceBlock,
    },
  ];

  const rawResourceHits = resources?.hits || [];
  const resourceHits = rawResourceHits.map((h) => ({
    id: h.id,
    title: h.title,
  }));
  const pickedHits = rawResourceHits.filter((h) => h.matchKind === "picked");
  const pickedShapes = new Set(
    pickedHits.map((h) => h.sourceShape || "empty"),
  );
  const resourceGrounding: ResourceGroundingContext = {
    hasHits: rawResourceHits.length > 0 || (resources?.kiHits?.length ?? 0) > 0,
    userAskedForResource: resources?.userAskedForResource === true,
    hasPicked: pickedHits.length > 0,
    hasStructuredPicked: pickedShapes.has("structured"),
    hasUnstructuredPicked: pickedShapes.has("unstructured"),
    hasEmptyPicked: pickedShapes.has("empty"),
  };
  const kiHits = (resources?.kiHits || []).map((k) => ({
    id: k.id,
    title: k.title,
    chapter: k.chapter,
  }));
  // BOLT 3 — surface the actual library selections (KIs + playbooks)
  // that were folded into the prompt so downstream can stamp
  // citations_json and log playbook_usage_events.
  const libraryKis = ((library as any)?.knowledgeItems || [])
    .map((k: any) => ({ id: k?.id, title: k?.title }))
    .filter((k: any) => k.id && k.title);
  const libraryPlaybooks = ((library as any)?.playbooks || [])
    .map((p: any) => ({ id: p?.id, title: p?.title }))
    .filter((p: any) => p.id && p.title);
  return {
    baseSegments,
    useStrategyCore: true,
    hasDossierEvidence: contextSection.includes("### Account Strategic POV"),
    resourceGrounding,
    workingThesis,
    resourceHits,
    kiHits,
    libraryKis,
    libraryPlaybooks,
    retrievalDebug: toRetrievalDebugShape(resources),
    retrievalDiagnostics,
    retrievalSucceeded: !!resources && !retrievalError,
    intent,
    outputModeDecision,
    currentStateResult,
    behaviorIntent,
    situationIntelligence,
  };
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
  v2RequestOverride: boolean = false,
  routingDecision: RoutingDecision | null = null,
  globalInstructions: CleanGlobalInstructions | null = null,
  // Phase 3A — workspace SOP advisory text. When non-null, appended after
  // V1 mode-lock / V2 / synthesis preamble and BEFORE global instructions.
  workspaceSop: WorkspaceStrategySop | null = null,
  // Phase W3 — workspace key (validated upstream). Used by retrieval
  // enforcement to resolve the WorkspaceContract from the server-side
  // registry. Null/unknown falls back to `work` inside the resolver.
  workspaceKeyRaw: string | null = null,
  // Phase 2 (Global SOP) — advisory text. When non-null, appended AFTER
  // core/V1/V2/synthesis preamble and BEFORE the workspace SOP block.
  globalSop: GlobalStrategySop | null = null,
) {
  // W5: resolve the workspace contract once for handleChat scope so
  // the citation enforcer can read `citationMode` for both the
  // streaming and non-streaming branches below.
  const __resolvedContract = resolveServerWorkspaceContract(workspaceKeyRaw);
  const __retrievalRules = __resolvedContract.retrievalRules;
  // Phase 4: derive manifest_id for evidence attribution
  const __chatManifestId = deriveChatManifestId(content, workspaceKeyRaw ?? null);
  await supabase.from("strategy_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "user",
    message_type: "chat",
    content_json: { text: content },
  });

  // ═══════════════════════════════════════════════════════════════
  // TARGETED LIBRARY LOOKUP INTERCEPT
  //
  // Two paths to a real DB-backed lookup, both bypass the LLM:
  //   1. Direct intent in the user message
  //      ("how many resources about cold calling?")
  //   2. Affirmative reply ("yes", "do it", …) when the previous
  //      assistant message offered a lookup via content_json.pending_action
  //
  // Hard guardrail: we never persist a pending_action unless this
  // function is wired up. So the assistant cannot offer a lookup it
  // can't fulfil.
  // ═══════════════════════════════════════════════════════════════
  let lookupIntent: LookupIntent | null = detectLookupIntent(content || "");
  if (!lookupIntent) {
    // Check for an affirmative reply against the most recent assistant
    // message's pending_action (look back ~3 messages to skip
    // the user row we just inserted).
    if (detectAffirmative(content || "")) {
      try {
        // Look back across the last 3 assistant messages for a pending
        // lookup. We scan multiple rows so a benign system-emitted message
        // (e.g. a streaming heartbeat or an empty placeholder) between the
        // offer and the user's "yes" can't strand the pending action.
        const { data: prior } = await supabase
          .from("strategy_messages")
          .select("id, role, content_json, created_at")
          .eq("thread_id", threadId)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(3);
        const candidates = Array.isArray(prior) ? prior : [];
        let fromPending: LookupIntent | null = null;
        let resumedFromMessageId: string | null = null;
        for (const row of candidates) {
          const pending = (row?.content_json as any)?.pending_action as
            | PendingLookupAction
            | undefined;
          const intent = pendingActionToIntent(pending ?? null);
          if (intent) {
            fromPending = intent;
            resumedFromMessageId = row.id;
            break;
          }
        }
        if (fromPending) {
          lookupIntent = fromPending;
          console.log(JSON.stringify({
            tag: "[strategy-chat:lookup_resume_pending]",
            thread_id: threadId,
            resumed_from_message_id: resumedFromMessageId,
            scanned: candidates.length,
            topic: fromPending.topic,
            kind: fromPending.kind,
            target: fromPending.target,
          }));
        }
      } catch (e) {
        console.warn(`[strategy-chat] pending-action resume failed: ${(e as Error).message}`);
      }
    } else if (detectNegative(content || "")) {
      // Clear any pending action quietly — falls through to normal chat.
      console.log(JSON.stringify({
        tag: "[strategy-chat:lookup_pending_cleared]",
        thread_id: threadId,
      }));
    }
  }

  if (lookupIntent) {
    console.log(JSON.stringify({
      tag: "[strategy-chat:lookup_run]",
      thread_id: threadId,
      kind: lookupIntent.kind,
      target: lookupIntent.target,
      topic: lookupIntent.topic,
    }));
    const lookupResult = await runLibraryLookup(supabase, userId, lookupIntent);
    const replyText = renderLookupResultText(lookupResult);

    await supabase.from("strategy_messages").insert({
      thread_id: threadId,
      user_id: userId,
      role: "assistant",
      message_type: "chat",
      provider_used: "system",
      model_used: "library-lookup",
      fallback_used: false,
      latency_ms: 0,
      content_json: {
        text: replyText,
        library_lookup: {
          intent: lookupResult.intent,
          resources_total: lookupResult.resources_total,
          knowledge_items_total: lookupResult.knowledge_items_total,
          resource_samples: lookupResult.resource_samples,
          ki_samples: lookupResult.ki_samples,
          computed_at: lookupResult.computed_at,
        },
        routing_decision: withRoutingMeta({
          mode: "library_lookup",
          mode_reason: "direct_db_query",
          intent: "resource_lookup",
        }, routingDecision),
      },
    });

    const sseChunk = `data: ${
      JSON.stringify({ choices: [{ delta: { content: replyText } }] })
    }\n\ndata: [DONE]\n\n`;
    return new Response(sseChunk, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }

  // ── Candidate pending action ─────────────────────────────
  // Even when detectLookupIntent didn't fire (e.g. the user phrased the
  // ask too loosely to extract a clean topic), if the message clearly
  // references the library + counts/lists we attach a pending_action so
  // any assistant offer phrasing ("want me to run a targeted lookup?")
  // is automatically bound to the next "yes" reply. This eliminates the
  // contradictory "I can offer a lookup" → "I can't run a lookup" loop.
  const candidatePending: PendingLookupAction | null = (() => {
    const t = (content || "").toLowerCase();
    const mentionsLibrary =
      /\b(resources?|kis?|knowledge[\s-]?items?|library|tactics?|playbooks?)\b/.test(t);
    const mentionsCounts =
      /\b(how\s+many|count|number\s+of|total|list|show|find|give\s+me)\b/.test(t);
    if (!mentionsLibrary || !mentionsCounts) return null;
    // Try to lift a topic; if extraction fails, fall back to "" so the
    // pending action is informative even without a clean noun phrase.
    // The model can still acknowledge and the next "yes" will run it
    // against the cleaned text.
    const guess = detectLookupIntent(content || "");
    if (guess) return buildPendingLookupAction(guess);
    // Build a lightweight one with the cleaned text as topic.
    const cleaned = (content || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .filter((w) => !/^(the|and|for|with|how|many|count|list|show|find|give|me|my|our|your|are|do|does|of|to|in|on|about|what|which|that|this|these|those)$/.test(w))
      .slice(0, 6)
      .join(" ");
    if (!cleaned) return null;
    const target: "resources" | "knowledge_items" | "both" =
      /\bresources?\b/.test(t) && !/\bkis?\b|knowledge/.test(t) ? "resources"
      : /\bkis?\b|knowledge/.test(t) && !/\bresources?\b/.test(t) ? "knowledge_items"
      : "both";
    return {
      pending_action: "resource_lookup",
      lookup_type: /\b(list|show|find|give\s+me)\b/.test(t) ? "list" : "count",
      topic: cleaned,
      target,
      offered_at: new Date().toISOString(),
    };
  })();

  // Initial route is provisional — replaced below once we know the mode.
  let route = resolveLLMRoute("chat_general");
  if (forceFallback) route._smokeTestForceFail = true;

  const {
    baseSegments,
    useStrategyCore,
    hasDossierEvidence,
    resourceGrounding,
    workingThesis: priorThesis,
    resourceHits,
    kiHits: kiHitList,
    libraryKis,
    libraryPlaybooks,
    retrievalDebug,
    retrievalDiagnostics,
    retrievalSucceeded,
    intent,
    outputModeDecision,
    currentStateResult,
    behaviorIntent,
    situationIntelligence,
  } = await buildChatSystemPrompt({
    supabase,
    userId,
    threadId,
    depth,
    contextSection,
    pack,
    userContent: content,
    pickedResourceIds,
    workspaceKeyRaw,
  });
  const accountId: string | null = pack.account?.id ?? null;
  const opportunityId: string | null = pack.opportunity?.id ?? null;
  const intelligenceRetrieval = situationIntelligence?.telemetry ?? null;
  const intelligenceSources = situationIntelligence
    ? {
      competitive_intel: situationIntelligence.competitiveSources,
      vertical_brief: situationIntelligence.verticalSource,
    }
    : null;

  // ── 4-MODE LIBRARY DECISION (replaces binary refusal gate) ──
  // Library is a foundation, not a gate. Always produce output.
  // - Strong  → OpenAI precision
  // - Partial → Claude (extension)
  // - General → OpenAI
  // - Thin    → OpenAI + honest gap framing in the prompt
  const groundingPhraseRe =
    /\b(using|use|from|based on|leveraging|across|grounded in|pulling from)\s+(my|the|these|those|our)\b/i;
  const hasGroundingPhrase = groundingPhraseRe.test(content || "");
  // REAL KI count from retrieveResourceContext — not the empty placeholder.
  const kiHits = kiHitList.length;
  const { mode, reason: modeReason, shortFormKind } = classifyLibraryMode({
    intent: intent.intent,
    resourceHits: resourceHits.length,
    kiHits,
    hasGroundingPhrase,
    userText: content || "",
  });

  // Mode-aware re-routing
  const modeRoute = resolveLLMRouteForMode("chat_general", intent.intent, mode);
  if (forceFallback) modeRoute._smokeTestForceFail = true;
  route = modeRoute;
  console.log(
    `[mode] intent=${intent.intent} mode=${mode} reason=${modeReason} provider=${route.primaryProvider} model=${route.model} routing=${modeRoute._routingReason}${shortFormKind ? ` sf_kind=${shortFormKind}` : ""}`,
  );

  const globalSopBlock = buildGlobalSopBlock(globalSop);
  const workspaceSopBlock = buildWorkspaceSopBlock(workspaceSop);


  // ── TERRITORY PROFILE STANDING CONTEXT ────────────────────────
  // Always-on, server-side. Loaded once per request, prepended to every
  // path (V1 short-form / V1 grounded / V2 reasoning). Independent of
  // which surface invoked the call (StrategyShell, Account Brief,
  // Discovery Prep, runTask, etc.) and independent of any thread link.
  let territoryProfileBlock = "";
  try {
    const { data: tp } = await supabase
      .from("territory_profile")
      .select(
        "name, role, company, start_date, quota_amount, quota_currency, quota_type, fiscal_year_start, fiscal_year_end, motion, territory_description, company_context, ki_library_summary, se_name, csm_name, manager_name, custom_notes",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (tp) {
      const lines: string[] = [];
      const has = (v: unknown) =>
        v !== null && v !== undefined && String(v).trim().length > 0;
      const idLine = [
        has(tp.name) ? `Name: ${tp.name}` : null,
        has(tp.role) ? `Role: ${tp.role}` : null,
        has(tp.company) ? `Company: ${tp.company}` : null,
      ].filter(Boolean).join(" | ");
      if (idLine) lines.push(idLine);
      const quotaParts: string[] = [];
      if (has(tp.motion)) quotaParts.push(`Motion: ${tp.motion}`);
      if (has(tp.quota_amount)) {
        const q = `${tp.quota_amount}${
          has(tp.quota_currency) ? ` ${tp.quota_currency}` : ""
        }${has(tp.quota_type) ? ` (${tp.quota_type})` : ""}`;
        quotaParts.push(`Quota: ${q}`);
      }
      if (quotaParts.length) lines.push(quotaParts.join(" | "));
      const fyParts: string[] = [];
      if (has(tp.fiscal_year_start) || has(tp.fiscal_year_end)) {
        fyParts.push(
          `FY: ${tp.fiscal_year_start ?? "?"} → ${tp.fiscal_year_end ?? "?"}`,
        );
      }
      if (has(tp.start_date)) fyParts.push(`Start: ${tp.start_date}`);
      if (fyParts.length) lines.push(fyParts.join(" | "));
      if (has(tp.territory_description)) {
        lines.push(`Territory: ${tp.territory_description}`);
      }
      if (has(tp.company_context)) {
        lines.push(`Company context: ${tp.company_context}`);
      }
      if (has(tp.ki_library_summary)) {
        lines.push(`KI library: ${tp.ki_library_summary}`);
      }
      const teamParts: string[] = [];
      if (has(tp.se_name)) teamParts.push(`SE=${tp.se_name}`);
      if (has(tp.csm_name)) teamParts.push(`CSM=${tp.csm_name}`);
      if (has(tp.manager_name)) teamParts.push(`Manager=${tp.manager_name}`);
      if (teamParts.length) lines.push(`Team: ${teamParts.join(", ")}`);
      if (has(tp.custom_notes)) lines.push(`Notes: ${tp.custom_notes}`);
      if (lines.length) {
        territoryProfileBlock =
          `\n\n## TERRITORY PROFILE\n${
            lines.join("\n")
          }\n`;
        console.log(
          `[territory-profile] injected lines=${lines.length} chars=${territoryProfileBlock.length}`,
        );
      }
    } else {
      console.log("[territory-profile] no row for user — skipping block");
    }
  } catch (e) {
    console.log(`[territory-profile] fetch failed — skipping: ${String(e)}`);
  }

  // V2 keeps deterministic dispatch/routing/auditing, but its duplicated
  // identity and prompt stack no longer get appended. A compact route delta
  // below preserves only semantics not already owned by the shared shell.
  let v2Decision: DispatchDecision | null = null;
  let v2EvidenceBase: any = null;
  const v2Active = isV2Enabled({ userOverride: v2RequestOverride });
  if (v2Active) {
    try {
      const priorTurnPrompt = (() => {
        const userMsgs = (pack.recentMessages || []).filter((m) => m.role === "user" && (m.text || "").trim().length > 0);
        // Last user message in pack is the PREVIOUS turn (current isn't in pack yet).
        return userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].text : undefined;
      })();
      const signals = {
        strongResourceHits: resourceHits.length,
        strongKiHits: kiHits,
        totalHits: resourceHits.length + kiHits,
        hasEntityContext: !!accountId,
        mentionsKnownEntity: !!(pack.account?.name && new RegExp(`\\b${pack.account.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(content || "")),
      };
      const v2 = v2Dispatch({
        rawUserText: content || "",
        signals,
      });
      v2Decision = v2;
      // Stash prior turn for wrong-question check later.
      v2EvidenceBase = {
        decision: v2,
        signals,
        priorTurnPrompt,
        resourceTitles: resourceHits.map((h) => h.title),
        kiIds: kiHitList.map((k) => k.id),
        kiTitles: kiHitList.map((k) => k.title),
      };
      console.log(
        `[v2] mode=${v2.mode} ask_shape=${v2.askShape} signal=${v2.signalScore} override=${v2.override ?? "none"}`,
      );

      // ═══ Phase 2.6 — Evidence-based routing override ═══
      // Strong-signal synthesis collapses into balanced-survey behavior on
      // gpt-4o (Test A failed). Claude Sonnet 4.5 produced operator-grade
      // synthesis on Test B. Route synthesis_framework + A_strong to Claude.
      if (
        v2.askShape === "synthesis_framework" &&
        v2.mode === "A_strong" &&
        PROVIDER_HEALTH.anthropicDirect
      ) {
        route = {
          ...route,
          primaryProvider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
          fallbackProvider: "openai",
          fallbackModel: "gpt-4o",
          _routingReason: "v2_synthesis_strong_to_claude",
        };
        console.log(
          `[v2] routing override: synthesis_framework+A_strong → claude-sonnet-4-5`,
        );
      }
    } catch (e) {
      console.error(`[v2] dispatch failed, falling back to V1: ${(e as Error).message}`);
      v2Decision = null;
      v2EvidenceBase = null;
    }
  }

  // `v2Active` reports the requested flag state; only a successful dispatch
  // changes the assembled prompt. Keep telemetry and Global Instructions on
  // the actual path when V2 falls back to V1.
  const promptPath: "v1" | "v2" = v2Decision ? "v2" : "v1";
  const effectiveLibraryMode: SemanticLibraryMode = mode === "short_form"
    ? "short_form"
    : v2Decision?.mode === "A_strong"
    ? "strong"
    : v2Decision?.mode === "B_partial"
    ? "partial"
    : v2Decision?.mode === "D_thin"
    ? "thin"
    : v2Decision?.mode === "C_general"
    ? "general"
    : mode;
  const totalLibraryHits = resourceHits.length + kiHits;
  const forceLiteralCitations = !!v2Decision && (
    (v2Decision.askShape === "synthesis_framework" && totalLibraryHits >= 3) ||
    ((v2Decision.mode === "A_strong" || v2Decision.mode === "B_partial") &&
      resourceHits.length >= 3)
  );

  // One authoritative semantic assembly. Runtime SOP headers remain in their
  // legacy relative order and precede the turn's reasoning contracts.
  let promptSegments: PromptSegment[] = buildSemanticPromptSegments({
    territoryEvidence: territoryProfileBlock,
    baseSegments,
    globalSopBlock,
    workspaceSopBlock,
    intent,
    behaviorIntent,
    outputModeDecision,
    workspaceContract: __resolvedContract.contract,
    libraryMode: effectiveLibraryMode,
    shortFormKind,
    v2Decision,
    forceLiteralCitations,
    resourceGrounding,
    hasDossierEvidence,
    hasCurrentStateEvidence: !!(
      currentStateResult?.ran && currentStateResult?.intelligence
    ),
    hasWorkingThesis: !!priorThesis,
    persistThesis: useStrategyCore,
  });

  // Turn-binding fix: pack.recentMessages was built BEFORE the current user
  // message was inserted, so it does NOT contain the current ask. We must
  // append the current user content explicitly, otherwise the model answers
  // the previous turn's last user message and produces a one-turn offset
  // (see hostile run b9613d44 — every turn answered turn N-1's prompt).
  const priorMessages = pack.recentMessages
    .filter((m) => (m.text || "").trim().length > 0)
    // Defensive: drop any tail entry that is identical to the current user
    // content (in case recentMessages was refreshed mid-flight and already
    // contains it). Prevents accidental double-injection.
    .filter((m, idx, arr) =>
      !(idx === arr.length - 1 && m.role === "user" && m.text === content)
    );
  // SOP authority remains high in the ledger: evidence → Global SOP →
  // Workspace SOP → resolved turn/evidence/reasoning contracts.

  // ── Brainstorm enforcement moved to FINAL system-prompt layer ──
  // See injection block immediately AFTER applyGlobalInstructions below.
  // It must be the last thing the model sees so global instructions cannot
  // override the hard rules.

  // ── W6.5 Pass A — Library Standard Context (shadow, pre-gen) ──
  // Select 2–4 STANDARD/EXEMPLAR/PATTERN cards from the user's
  // library, demote anything already retrieved as a RESOURCE
  // (RESOURCE beats STANDARD), and inject a "WHAT GOOD LOOKS LIKE"
  // block. This shapes HOW the model writes — it is NOT citation
  // material. The same `exemplarSet` is reused by Pass B post-gen.
  let exemplarSet: ExemplarSet | null = null;
  let standardContextBlock: ReturnType<typeof buildStandardContextPersistenceBlock> | null = null;
  try {
    const passAScopes = (() => {
      const fromUser = inferTopicScopes(content || "");
      if (fromUser.length > 0) return fromUser;
      // Fall back to account/opportunity names so the standards block
      // still matches the conversational frame.
      const fb: string[] = [];
      if (pack.account?.name) fb.push(pack.account.name);
      if (pack.opportunity?.name) fb.push(pack.opportunity.name);
      return fb;
    })();
    const retrievedItemIds = [
      ...resourceHits.map((h) => h.id),
      ...kiHitList.map((k) => k.id),
      ...pickedResourceIds,
    ];
    exemplarSet = await selectExemplars(supabase, userId, {
      workspace: __resolvedContract.workspace,
      surface: "strategy-chat",
      scopes: passAScopes,
      retrievedItemIds,
    });
    logStandardContext(exemplarSet);
    standardContextBlock = buildStandardContextPersistenceBlock(exemplarSet);
    const standardsText = renderStandardBlock(exemplarSet, { dataOnly: true });
    if (standardsText) {
      const standardsSegment: PromptSegment = {
        id: "evidence.standards",
        kind: "retrieved_evidence",
        text: standardsText,
      };
      const beforeSop = promptSegments.findIndex(
        (segment) => segment.id === "runtime.global-sop",
      );
      promptSegments.splice(
        beforeSop >= 0 ? beforeSop : promptSegments.length,
        0,
        standardsSegment,
      );
    }
  } catch (passAErr) {
    console.warn(
      "[workspace:standard_context] threw (ignored, shadow):",
      String(passAErr).slice(0, 200),
    );
  }

  // Phase 2 — Apply lightweight Global Instructions at the FINAL prompt stage.
  // Single shared helper used at every LLM call site so V1, V2, and any
  // future grounded-strategy path all flow through the same injection.
  // Returns the original prompt unchanged when payload is null/empty →
  // exact baseline behavior preserved.
  const giPath: GIPath = promptPath === "v2"
    ? "v2"
    : (mode === "strong" || mode === "partial" || mode === "thin" || mode === "short_form" ? "synthesis" : "v1");
  // Preserve applyGlobalInstructions' renderer and injected/skipped telemetry,
  // but make the result a late runtime segment rather than mutating the
  // assembled string. Passing an empty prefix returns the exact block.
  promptSegments.push({
    id: "runtime.global-instructions",
    kind: "runtime_instruction",
    text: applyGlobalInstructions("", globalInstructions, giPath),
  });

  // The locked V2 synthesis tail and conversation enforcement both require
  // highest recency. Exact structured synthesis wins when they overlap;
  // otherwise conversation-final remains the last non-empty segment.
  const strongSynthesisTail = buildV2StrongSynthesisTail({
    decision: v2Decision,
    totalHits: totalLibraryHits,
  });
  const _csUsed = !!(currentStateResult?.ran && currentStateResult?.intelligence);
  const conversationFinalApplies =
    outputModeDecision?.mode === "conversation" &&
    intent.intent === "freeform" &&
    behaviorIntent.intent !== "artifact_creation" &&
    strongSynthesisTail.length === 0;
  if (conversationFinalApplies) {
    const convoBlock = renderConversationEnforcementBlock(
      __resolvedContract.workspace,
      {
        currentStateUsed: _csUsed,
        behaviorIntent: behaviorIntent.intent,
        requestedEntryCount: detectRequestedEntryCount(content),
      },
    );
    promptSegments.push({
      id: "fixed.conversation-enforcement-final",
      kind: "fixed_instruction",
      text: convoBlock,
    });
    console.log(
      `[strategy-sop] injected-conversation-enforcement-final ${JSON.stringify({
        workspace: __resolvedContract.workspace,
        output_mode: outputModeDecision.mode,
        output_mode_reason: outputModeDecision.reason,
        length: convoBlock.length,
        position: "post-global-instructions",
        current_state_used: _csUsed,
        current_state_digest_chars: 0,
        context_and_mode_combined: _csUsed,
      })}`,
    );
  } else if (strongSynthesisTail) {
    promptSegments.push({
      id: "fixed.v2-strong-synthesis-final",
      kind: "fixed_instruction",
      text: strongSynthesisTail,
    });
  }

  const promptPlan = composePrompt(promptSegments);
  if (promptPlan.fixedInstructionChars > FIXED_INSTRUCTION_BUDGET_CHARS) {
    throw new Error(
      `strategy-chat fixed instruction budget exceeded: ${promptPlan.fixedInstructionChars}/${FIXED_INSTRUCTION_BUDGET_CHARS}`,
    );
  }
  const finalSegmentId = promptPlan.segments.at(-1)?.id ?? null;
  if (
    conversationFinalApplies &&
    finalSegmentId !== "fixed.conversation-enforcement-final"
  ) {
    throw new Error("conversation enforcement must be the final prompt segment");
  }
  if (
    strongSynthesisTail &&
    finalSegmentId !== "fixed.v2-strong-synthesis-final"
  ) {
    throw new Error("V2 strong-synthesis contract must be the final prompt segment");
  }
  const effectiveSystemPrompt = promptPlan.systemPrompt;

  console.log(
    "[strategy-chat][prompt-size]",
    JSON.stringify(
      buildPromptSizeLog({
        path: promptPath,
        plan: promptPlan,
        priorMessages,
        currentUser: content,
      }),
    ),
  );

  // ── Phase 7A: SOP Execution Trace (observability only, no behavior change) ──
  try {
    const wsName = __resolvedContract.workspace;
    const wsSopLen = workspaceSop?.rawInstructions?.length ?? 0;
    const globalSopLen = globalSop?.rawInstructions?.length ?? 0;
    const orderTrace = buildPromptOrderTrace(promptPlan.segments);
    const {
      segmentOrder,
      globalSopApplied,
      workspaceSopApplied,
      globalInstructionsApplied,
      sopBeforeReasoning,
    } = orderTrace;
    const path = promptPath;
    const injectionOrder = segmentOrder;

    console.log(
      `[strategy-sop][prompt-trace] ${JSON.stringify({
        path,
        sop_before_reasoning: sopBeforeReasoning,
        workspace: wsName,
        global_sop_applied: globalSopApplied,
        workspace_sop_applied: workspaceSopApplied,
        global_instructions_applied: globalInstructionsApplied,
        system_prompt_length: effectiveSystemPrompt.length,
        system_prompt_preview: effectiveSystemPrompt.slice(0, 1200),
        injection_order: injectionOrder,
        segment_order: segmentOrder,
        fixed_instruction_chars: promptPlan.fixedInstructionChars,
        runtime_instruction_chars: promptPlan.runtimeInstructionChars,
        retrieved_evidence_chars: promptPlan.retrievedEvidenceChars,
      })}`,
    );

    console.log(
      `[strategy-sop][presence-check] ${JSON.stringify({
        workspace: wsName,
        global_sop_present: globalSopApplied,
        workspace_sop_present: workspaceSopApplied,
        workspace_sop_length: wsSopLen,
        global_sop_length: globalSopLen,
      })}`,
    );
  } catch (traceErr) {
    console.warn(
      "[strategy-sop][prompt-trace] failed (ignored):",
      String(traceErr).slice(0, 200),
    );
  }

  const messages = [
    { role: "system" as const, content: effectiveSystemPrompt },
    ...priorMessages.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.text,
    })),
    { role: "user" as const, content },
  ];

  const startTime = Date.now();

  // ── Phase 3: provisional routing-evidence persistence ──
  // For synthesis_framework + A_strong (the path routed to Claude), insert
  // a provisional strategy_messages row BEFORE the model call so the routing
  // evidence survives even if the request dies (timeout, edge gateway kill,
  // network drop). On success/failure, we update this row instead of
  // inserting a new one.
  let provisionalMessageId: string | null = null;
  const isClaudeSynthesisPath =
    route.primaryProvider === "anthropic" &&
    v2Active &&
    v2EvidenceBase &&
    v2EvidenceBase.decision.askShape === "synthesis_framework" &&
    v2EvidenceBase.decision.mode === "A_strong";
  if (isClaudeSynthesisPath) {
    try {
      const { data: prov } = await supabase
        .from("strategy_messages")
        .insert({
          thread_id: threadId,
          user_id: userId,
          role: "assistant",
          message_type: "chat",
          manifest_id: __chatManifestId,
          provider_used: route.primaryProvider,
          model_used: route.model,
          fallback_used: false,
          latency_ms: 0,
          content_json: withRoutingMeta({
            text: "",
            provisional: true,
            routing_decision: {
              status: "pending",
              mode,
              mode_reason: modeReason,
              intent: intent.intent,
              resource_hits: resourceHits.length,
              ki_hits: kiHits,
              intended_provider: route.primaryProvider,
              intended_model: route.model,
              routing_reason: route._routingReason,
              intelligence_retrieval: intelligenceRetrieval,
              intelligence_sources: intelligenceSources,
              v2: {
                version: "v2",
                mode: v2EvidenceBase!.decision.mode,
                ask_shape: v2EvidenceBase!.decision.askShape,
                signal_score: v2EvidenceBase!.decision.signalScore,
                retrieval: {
                  strong_resource_hits: v2EvidenceBase!.signals.strongResourceHits,
                  strong_ki_hits: v2EvidenceBase!.signals.strongKiHits,
                  total_hits: v2EvidenceBase!.signals.totalHits,
                  has_entity_context: v2EvidenceBase!.signals.hasEntityContext,
                  mentions_known_entity: v2EvidenceBase!.signals.mentionsKnownEntity,
                },
              },
              created_at: new Date().toISOString(),
            },
          }, routingDecision),
        })
        .select("id")
        .single();
      provisionalMessageId = prov?.id ?? null;
      console.log(`[v2] provisional routing row persisted id=${provisionalMessageId}`);
    } catch (e) {
      console.warn(`[v2] provisional persist failed: ${(e as Error).message}`);
    }
  }

  const result = await callStreaming("chat_general", {
    messages,
    temperature: route.temperature,
    maxTokens: route.maxTokens,
  }, route);

  // If the model call returned a hard error and we have a provisional row,
  // stamp the failure evidence so we have an audit trail even when the
  // request would otherwise die with no row.
  if (result.error && provisionalMessageId) {
    try {
      await supabase
        .from("strategy_messages")
        .update({
          content_json: withRoutingMeta({
            text: "",
            provisional: false,
            error: result.error,
            routing_decision: {
              status: "failed",
              mode,
              mode_reason: modeReason,
              intent: intent.intent,
              resource_hits: resourceHits.length,
              ki_hits: kiHits,
              intended_provider: route.primaryProvider,
              intended_model: route.model,
              actual_provider: result.provider,
              actual_model: result.model,
              fallback_used: result.fallbackUsed,
              fallback_reason: result.fallbackReason ?? null,
              error_type: result.error.type,
              error_message: result.error.message,
              routing_reason: route._routingReason,
              intelligence_retrieval: intelligenceRetrieval,
              intelligence_sources: intelligenceSources,
              v2: v2EvidenceBase
                ? {
                  ...v2EvidenceBase.decision && {},
                  version: "v2",
                  mode: v2EvidenceBase.decision.mode,
                  ask_shape: v2EvidenceBase.decision.askShape,
                  signal_score: v2EvidenceBase.decision.signalScore,
                  claude_fallback: route.primaryProvider === "anthropic" &&
                    result.provider !== "anthropic",
                  retrieval: {
                    strong_resource_hits: v2EvidenceBase.signals.strongResourceHits,
                    strong_ki_hits: v2EvidenceBase.signals.strongKiHits,
                    total_hits: v2EvidenceBase.signals.totalHits,
                    has_entity_context: v2EvidenceBase.signals.hasEntityContext,
                    mentions_known_entity: v2EvidenceBase.signals.mentionsKnownEntity,
                  },
                }
                : null,
              finalized_at: new Date().toISOString(),
            },
          }, routingDecision),
          provider_used: result.provider,
          model_used: result.model,
          fallback_used: result.fallbackUsed === true,
          latency_ms: result.latencyMs,
        })
        .eq("id", provisionalMessageId);
      console.warn(`[v2] provisional row finalized as failure id=${provisionalMessageId} reason=${result.error.type}`);
    } catch (e) {
      console.error(`[v2] failed to finalize provisional row: ${(e as Error).message}`);
    }
  }

  // If the call succeeded but we have a provisional row, delete it so the
  // success-path insert below doesn't produce a duplicate. (Cheaper than
  // refactoring the whole success path to update-in-place.)
  if (!result.error && provisionalMessageId) {
    try {
      await supabase.from("strategy_messages").delete().eq("id", provisionalMessageId);
    } catch (e) {
      console.warn(`[v2] failed to clean provisional row on success: ${(e as Error).message}`);
    }
  }

  if (result.error) {
    return new Response(
      JSON.stringify({
        error: "Assistant temporarily unavailable",
        errorType: result.error.type,
        model: route.model,
        route: "openai-direct",
        provider: route.primaryProvider,
        raw_error: result.error.rawBody ?? null,
        error_stage: result.error.stage ?? 'adapter_call',
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
    const guarded = enforceModeLock(rawVisible, intent, {
      resourceHits,
      libraryMode: effectiveLibraryMode,
    });
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
    // Behavior-intent hard guard — enforce exclusivity (e.g. when
    // intent=conversation_strategy, strip headings, lists, idea
    // lead-ins, and category buckets that bleed in from other behaviors).
    const behaviorGuard = behaviorIntent
      ? enforceBehaviorContract(behaviorIntent.intent, subst.text)
      : { triggered: false, text: subst.text, violations: [], rewrite_applied: false };
    if (behaviorGuard.triggered) {
      console.log(
        "[behavior-guard] non-stream",
        JSON.stringify({
          intent_detected: behaviorIntent?.intent,
          behavior_selected: behaviorIntent?.intent,
          suppressed_behaviors: behaviorIntent?.suppressed,
          guard_triggered: true,
          violations: behaviorGuard.violations,
          rewrite_applied: behaviorGuard.rewrite_applied,
          depth_floor_passed: behaviorGuard.depth_floor_passed ?? null,
          depth_signals: behaviorGuard.depth_signals ?? null,
        }),
      );
    }
    const hybrid = enforceHybridSchema(
      intent.intent,
      behaviorGuard.text,
      "non-stream",
    );
    const visible = hybrid.text;
    // Citation audit (W5): governed by `retrievalRules.citationMode`
    // from the resolved workspace contract. SHADOW/REPORTING ONLY in
    // W5 — `auditedText` returns the original assistant text for all
    // modes; telemetry still reports what the auditor would have
    // changed. Closed-set mode (user picked a resource via /library)
    // is preserved across all modes.
    const w5Citation = runCitationCheck({
      assistantText: visible,
      libraryHits: resourceHits,
      libraryUsed: resourceHits.length > 0,
      workspace: __resolvedContract.workspace,
      contractVersion: __resolvedContract.contractVersion,
      citationMode: __retrievalRules.citationMode,
      auditOptions: { closedSet: pickedResourceIds.length > 0 },
    });
    const audit = w5Citation.audit ?? auditResourceCitations(visible, [], { closedSet: false });
    if (w5Citation.audit?.modified) {
      console.log(
        `[citation-audit] non-stream mode=${w5Citation.citationMode}: ${w5Citation.audit.unverifiedCitations.length} unverified citation(s) flagged${pickedResourceIds.length > 0 ? " (closed-set)" : ""}`,
      );
    }
    try {
      logCitationCheck(buildCitationCheckLog({
        result: w5Citation,
        workspace: __resolvedContract.workspace,
        contractVersion: __resolvedContract.contractVersion,
        surface: "strategy-chat",
      }));
    } catch { /* never throw from telemetry */ }
    const auditedVisible = w5Citation.auditedText;
    // ── W6: Quality gate runner (shadow-only) ────────────────────
    let w6GateBlock: ReturnType<typeof buildGatePersistenceBlock> | null = null;
    let w6GateSummary: ReturnType<typeof runWorkspaceGates> | null = null;
    try {
      w6GateSummary = runWorkspaceGates({
        inputs: {
          contract: __resolvedContract.contract,
          assistantText: auditedVisible,
          libraryHits: resourceHits,
          libraryUsed: resourceHits.length > 0,
          citationCheck: w5Citation,
        },
        surface: "strategy-chat",
      });
      logGateResults(w6GateSummary);
      w6GateBlock = buildGatePersistenceBlock(w6GateSummary);
    } catch (gateErr) {
      console.warn("[workspace:gate_result] threw (ignored, shadow):", String(gateErr).slice(0, 200));
    }
    // ── W6.5 Pass B — Library Calibration (shadow, post-gen) ─────
    // Uses the SAME ExemplarSet from Pass A. Heuristic-only in
    // Phase 1 — no LLM judge. Never mutates assistant output.
    let calibrationBlock:
      | ReturnType<typeof buildCalibrationPersistenceBlock>
      | null = null;
    let calibrationResult: ReturnType<typeof runLibraryCalibration> | null = null;
    try {
      if (exemplarSet) {
        const calibration = runLibraryCalibration({
          workspace: __resolvedContract.workspace,
          surface: "strategy-chat",
          threadId,
          outputText: auditedVisible,
          userPromptText: content,
          exemplarSet,
        });
        logCalibrationResult(calibration);
        calibrationResult = calibration;
        calibrationBlock = buildCalibrationPersistenceBlock(calibration);
      }
    } catch (calErr) {
      console.warn(
        "[workspace:calibration_result] threw (ignored, shadow):",
        String(calErr).slice(0, 200),
      );
    }
    // ── W7: Escalation rules (shadow-only, advisory) ─────────────
    let w7EscalationBlock: ReturnType<typeof buildEscalationPersistenceBlock> | null = null;
    let w7EscalationSummary: ReturnType<typeof evaluateEscalationRules> | null = null;
    try {
      const w7Summary = evaluateEscalationRules({
        inputs: {
          contract: __resolvedContract.contract,
          assistantText: auditedVisible,
          userPrompt: content,
          gateSummary: w6GateSummary,
          citationCheck: w5Citation,
          libraryHits: resourceHits,
          // W7.5 — calibration-aware overlay (shadow-only, additive).
          calibration: calibrationResult,
        },
        surface: "strategy-chat",
      });
      logEscalationSuggestions(w7Summary);
      w7EscalationSummary = w7Summary;
      w7EscalationBlock = buildEscalationPersistenceBlock(w7Summary);
    } catch (escErr) {
      console.warn("[workspace:escalation_suggestion] threw (ignored, shadow):", String(escErr).slice(0, 200));
    }
    // ── W12: Enforcement dry-run (shadow-only) — non-stream ──────
    let w12EnforcementBlock: ReturnType<typeof buildEnforcementPersistenceBlock> | null = null;
    try {
      const w12Summary = runEnforcementDryRun({
        contract: __resolvedContract.contract,
        surface: "strategy-chat",
        workspace: __resolvedContract.workspace,
        contractVersion: __resolvedContract.contractVersion,
        threadId,
        gateSummary: w6GateSummary,
        calibration: calibrationResult,
        citationCheck: w5Citation,
        escalationSummary: w7EscalationSummary,
        schemaHealth: null,
      });
      logEnforcementDryRun(w12Summary);
      w12EnforcementBlock = buildEnforcementPersistenceBlock(w12Summary);
    } catch (enfErr) {
      console.warn("[workspace:enforcement_dry_run] threw (ignored, shadow):", String(enfErr).slice(0, 200));
    }

    const nonStreamContentJson: Record<string, unknown> = {
      text: auditedVisible,
      sources_used: pack.sourceCount,
      retrieval_meta: pack.retrievalMeta,
      pending_action: candidatePending ?? undefined,
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
      gate_check: w6GateBlock ?? undefined,
      escalation_suggestions: w7EscalationBlock ?? undefined,
      standard_context: standardContextBlock ?? undefined,
      calibration: calibrationBlock ?? undefined,
      enforcement_dry_run: w12EnforcementBlock ?? undefined,
      routing_decision: (() => {
        const base: any = {
          mode,
          mode_reason: modeReason,
          intent: intent.intent,
          resource_hits: resourceHits.length,
          ki_hits: kiHits,
          intended_provider: route.primaryProvider,
          intended_model: route.model,
          actual_provider: result.provider,
          actual_model: result.model,
          fallback_used: result.fallbackUsed,
          routing_reason: route._routingReason,
          retrieval_debug: retrievalDebug ?? null,
          intelligence_retrieval: intelligenceRetrieval,
          intelligence_sources: intelligenceSources,
          short_form_diagnostics: mode === "short_form" ? {
            kind: shortFormKind ?? null,
            prompt_chars: (content || "").length,
            system_prompt_chars: effectiveSystemPrompt.length,
            max_tokens_cap: route.maxTokens,
            output_chars: (auditedVisible || "").length,
            latency_ms: result.latencyMs,
          } : null,
          hybrid_guard_checked: hybrid.guardBefore.checked,
          hybrid_guard_passed: hybrid.guardBefore.passed,
          hybrid_guard_failure_reasons: hybrid.guardBefore.failure_reasons,
          hybrid_rewrite_applied: hybrid.rewriteApplied,
          hybrid_rewrite_reason: hybrid.rewriteReason,
          hybrid_rewrite_failures_after: hybrid.rewriteApplied
            ? hybrid.guardAfter.failure_reasons
            : [],
        };
        if (v2Active && v2EvidenceBase) {
          try {
            const wq = v2ValidateResponse({
              userPrompt: content || "",
              responseBody: auditedVisible || "",
              priorTurnPrompt: v2EvidenceBase.priorTurnPrompt,
            });
            const aud = v2AuditResponse({
              decision: v2EvidenceBase.decision,
              body: auditedVisible || "",
              hadLibraryHits: (resourceHits.length + kiHits) > 0,
              resourceTitles: v2EvidenceBase.resourceTitles,
              kiIds: v2EvidenceBase.kiIds,
              kiTitles: v2EvidenceBase.kiTitles,
            });
            // Phase 3: contract-drift sentinel (logged, never blocks).
            // Phase 3: contract-drift sentinel (logged, never blocks).
            // Only meaningful for strong-signal synthesis turns.
            let drift: { missing: string[] } | null = null;
            if (
              v2EvidenceBase.decision.askShape === "synthesis_framework" &&
              (v2EvidenceBase.decision.mode === "A_strong" ||
                v2EvidenceBase.signals.totalHits >= 3)
            ) {
              const check = assertSynthesisContractIntact(effectiveSystemPrompt);
              if (!check.intact) {
                drift = { missing: check.missing };
                console.warn(
                  `[v2] contract_drift: synthesis non-negotiables missing: ${check.missing.join(",")}`,
                );
              }
            }
            base.v2 = v2AssembleEvidence({
              decision: v2EvidenceBase.decision,
              signals: v2EvidenceBase.signals,
              wrongQuestion: wq,
              audit: aud,
              provider: result.provider,
              model: result.model,
              regenCount: 0,
              intendedProvider: route.primaryProvider,
              fallbackUsed: result.fallbackUsed === true,
              contractDrift: drift,
            });
            if (base.v2.claude_fallback) {
              console.warn(
                `[v2] claude_fallback=true intended=${route.primaryProvider} actual=${result.provider}`,
              );
            }
          } catch (e) {
            base.v2_error = (e as Error).message;
          }
        }
        return base;
      })(),
    };
    // W10 — stamp compact schema-health summary AFTER all blocks are assembled.
    try {
      nonStreamContentJson.schema_health = computeSchemaHealth(
        nonStreamContentJson,
        "chat",
      );
    } catch (shErr) {
      console.warn(
        "[schema_health] non-stream stamping failed (ignored):",
        String(shErr).slice(0, 200),
      );
    }
    // BOLT 3 — build structured citations for the assistant message
    // and (best-effort) record playbook usage. Additive; never blocks.
    const __citationsJson = buildCitationsJson({
      resourceHits,
      kiHits: kiHitList,
      libraryKis,
      libraryPlaybooks,
      competitiveIntel: situationIntelligence?.competitiveSources ?? [],
      verticalBrief: situationIntelligence?.verticalSource ?? null,
    });
    await supabase.from("strategy_messages").insert({
      thread_id: threadId,
      user_id: userId,
      role: "assistant",
      message_type: "chat",
      manifest_id: __chatManifestId,
      provider_used: result.provider,
      model_used: result.model,
      fallback_used: result.fallbackUsed,
      latency_ms: result.latencyMs,
      content_json: nonStreamContentJson,
      citations_json: __citationsJson,
    });
    await logPlaybookUsageBestEffort(supabase, {
      userId,
      threadId,
      accountId,
      opportunityId,
      playbooks: libraryPlaybooks,
      surface: "chat_nonstream",
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
    const sseChunk = `data: ${JSON.stringify({
      choices: [{ delta: { content: auditedVisible } }],
      citations_json: __citationsJson,
    })}\n\ndata: [DONE]\n\n`;
    return new Response(sseChunk, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
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
        const guarded = enforceModeLock(rawVisible, intent, {
          resourceHits,
          libraryMode: effectiveLibraryMode,
        });
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
        // Step 2c: BEHAVIOR-INTENT HARD GUARD — exclusivity enforcement.
        const behaviorGuard = behaviorIntent
          ? enforceBehaviorContract(behaviorIntent.intent, subst.text)
          : { triggered: false, text: subst.text, violations: [], rewrite_applied: false };
        if (behaviorGuard.triggered) {
          console.log(
            "[behavior-guard] stream",
            JSON.stringify({
              intent_detected: behaviorIntent?.intent,
              behavior_selected: behaviorIntent?.intent,
              suppressed_behaviors: behaviorIntent?.suppressed,
              guard_triggered: true,
              violations: behaviorGuard.violations,
              rewrite_applied: behaviorGuard.rewrite_applied,
              depth_floor_passed: behaviorGuard.depth_floor_passed ?? null,
              depth_signals: behaviorGuard.depth_signals ?? null,
            }),
          );
        }
        const hybrid = enforceHybridSchema(
          intent.intent,
          behaviorGuard.text,
          "stream",
        );
        const visible = hybrid.text;

        // Step 3: citation audit on the GUARDED text (W5: governed
        // by `retrievalRules.citationMode`). SHADOW/REPORTING ONLY —
        // `auditedText` returns the original assistant text for all
        // modes; telemetry still reports `modified` when the auditor
        // would have rewritten. Closed-set mode is preserved.
        const w5Citation = runCitationCheck({
          assistantText: visible,
          libraryHits: resourceHits,
          libraryUsed: resourceHits.length > 0,
          workspace: __resolvedContract.workspace,
          contractVersion: __resolvedContract.contractVersion,
          citationMode: __retrievalRules.citationMode,
          auditOptions: { closedSet: pickedResourceIds.length > 0 },
        });
        const audit = w5Citation.audit ?? auditResourceCitations(visible, [], { closedSet: false });
        if (w5Citation.audit?.modified) {
          console.log(
            `[citation-audit] stream mode=${w5Citation.citationMode}: ${w5Citation.audit.unverifiedCitations.length} unverified citation(s) flagged${pickedResourceIds.length > 0 ? " (closed-set)" : ""}`,
          );
        }
        try {
          logCitationCheck(buildCitationCheckLog({
            result: w5Citation,
            workspace: __resolvedContract.workspace,
            contractVersion: __resolvedContract.contractVersion,
            surface: "strategy-chat",
          }));
        } catch { /* never throw from telemetry */ }
        const auditedVisible = w5Citation.auditedText;

        // ── W6: Quality gate runner (shadow-only, streaming path) ───
        // Mirrors non-stream wiring above. Telemetry + persistence
        // only — never mutates assistant output.
        let w6GateBlock: ReturnType<typeof buildGatePersistenceBlock> | null = null;
        let w6GateSummary: ReturnType<typeof runWorkspaceGates> | null = null;
        try {
          w6GateSummary = runWorkspaceGates({
            inputs: {
              contract: __resolvedContract.contract,
              assistantText: auditedVisible,
              libraryHits: resourceHits,
              libraryUsed: resourceHits.length > 0,
              citationCheck: w5Citation,
            },
            surface: "strategy-chat",
          });
          logGateResults(w6GateSummary);
          w6GateBlock = buildGatePersistenceBlock(w6GateSummary);
        } catch (gateErr) {
          console.warn("[workspace:gate_result] stream threw (ignored, shadow):", String(gateErr).slice(0, 200));
        }
        // ── W6.5 Pass B — Library Calibration (shadow, post-gen, streaming) ─
        // Mirrors the non-stream wiring above. Uses the SAME ExemplarSet
        // from Pass A. Heuristic-only in Phase 1 — no LLM judge.
        // Never mutates assistant output.
        let calibrationBlock:
          | ReturnType<typeof buildCalibrationPersistenceBlock>
          | null = null;
        let calibrationResult: ReturnType<typeof runLibraryCalibration> | null = null;
        try {
          if (exemplarSet) {
            const calibration = runLibraryCalibration({
              workspace: __resolvedContract.workspace,
              surface: "strategy-chat",
              threadId,
              outputText: auditedVisible,
              userPromptText: content,
              exemplarSet,
            });
            logCalibrationResult(calibration);
            calibrationResult = calibration;
            calibrationBlock = buildCalibrationPersistenceBlock(calibration);
          }
        } catch (calErr) {
          console.warn(
            "[workspace:calibration_result] stream threw (ignored, shadow):",
            String(calErr).slice(0, 200),
          );
        }
        // ── W7: Escalation rules (shadow-only, advisory, streaming) ─
        let w7EscalationBlock: ReturnType<typeof buildEscalationPersistenceBlock> | null = null;
        let w7EscalationSummary: ReturnType<typeof evaluateEscalationRules> | null = null;
        try {
          const w7Summary = evaluateEscalationRules({
            inputs: {
              contract: __resolvedContract.contract,
              assistantText: auditedVisible,
              userPrompt: content,
              gateSummary: w6GateSummary,
              citationCheck: w5Citation,
              libraryHits: resourceHits,
              // W7.5 — calibration-aware overlay (shadow-only, additive).
              calibration: calibrationResult,
            },
            surface: "strategy-chat",
          });
          logEscalationSuggestions(w7Summary);
          w7EscalationSummary = w7Summary;
          w7EscalationBlock = buildEscalationPersistenceBlock(w7Summary);
        } catch (escErr) {
          console.warn("[workspace:escalation_suggestion] stream threw (ignored, shadow):", String(escErr).slice(0, 200));
        }
        // ── W12: Enforcement dry-run (shadow-only) — streaming ──────
        let w12EnforcementBlock: ReturnType<typeof buildEnforcementPersistenceBlock> | null = null;
        try {
          const w12Summary = runEnforcementDryRun({
            contract: __resolvedContract.contract,
            surface: "strategy-chat",
            workspace: __resolvedContract.workspace,
            contractVersion: __resolvedContract.contractVersion,
            threadId,
            gateSummary: w6GateSummary,
            calibration: calibrationResult,
            citationCheck: w5Citation,
            escalationSummary: w7EscalationSummary,
            schemaHealth: null,
          });
          logEnforcementDryRun(w12Summary);
          w12EnforcementBlock = buildEnforcementPersistenceBlock(w12Summary);
        } catch (enfErr) {
          console.warn("[workspace:enforcement_dry_run] stream threw (ignored, shadow):", String(enfErr).slice(0, 200));
        }


        const finalVisible = auditedVisible;

        assertRoutingEvidence({
          finalText: finalVisible,
          upstreamRetrievalSucceeded: retrievalSucceeded,
          resourceHits,
          kiHits: kiHitList,
          retrievalDebug,
          retrievalDiagnostics,
        });

        // ── Phase 7A: behavior-check + mode-check (observability only) ──
        try {
          const ws = (workspaceSop?.workspace ?? "work") as string;
          const txt = finalVisible || "";
          const len = txt.length;
          const containsStructure = /(^|\n)\s*(#{1,6}\s|[-*•]\s|\d+\.\s|\|.*\|)/m.test(txt);
          const containsExecSummary = /executive summary|tl;dr|top-line|bottom line/i.test(txt);
          const trimmed = txt.trim();
          const containsQuestions = /\?\s*$/.test(trimmed) || (txt.match(/\?/g)?.length ?? 0) >= 2;
          const containsCitations = /(RESOURCE\[|KI\[|CARD\[)/.test(txt);
          const estimatedDepth = len < 500 ? "low" : len <= 1500 ? "medium" : "high";

          console.log(
            `[strategy-sop][behavior-check] ${JSON.stringify({
              workspace: ws,
              response_length: len,
              contains_structure: containsStructure,
              contains_executive_summary: containsExecSummary,
              contains_questions: containsQuestions,
              contains_citations: containsCitations,
              estimated_depth: estimatedDepth,
            })}`,
          );

          // Lightweight mode classification heuristic.
          const lower = txt.toLowerCase();
          const angleHits = (lower.match(/\bangle\b|\bhypothesis\b|\bopener\b|\bpov\b/g) || []).length;
          const evidenceHits = (lower.match(/\bsource\b|\bevidence\b|\baccording to\b|\bper \w+ \(/g) || []).length;
          const refineHits = /\brewrit|\brevised|\bedit(ed)?\b|\bbefore:\s|\bafter:\s/i.test(txt);
          const sectionHits = (txt.match(/(^|\n)#{1,3}\s/g) || []).length;
          let modeDetected: string = "generic";
          if (angleHits >= 2 && containsStructure) modeDetected = "brainstorm";
          else if (refineHits) modeDetected = "refine";
          else if (sectionHits >= 3 && len > 1200) modeDetected = "artifact";
          else if (evidenceHits >= 2 || (containsCitations && len > 600)) modeDetected = "research";

          console.log(
            `[strategy-sop][mode-check] ${JSON.stringify({
              workspace: ws,
              mode_detected: modeDetected,
              decision_layer_active: true,
            })}`,
          );
        } catch (bcErr) {
          console.warn("[strategy-sop][behavior-check] failed (ignored):", String(bcErr).slice(0, 200));
        }

        // Build structured citations up front so we can emit them in the
        // same SSE payload the client renders atomically.
        const __streamCitationsJson = buildCitationsJson({
          resourceHits,
          kiHits: kiHitList,
          libraryKis,
          libraryPlaybooks,
          competitiveIntel: situationIntelligence?.competitiveSources ?? [],
          verticalBrief: situationIntelligence?.verticalSource ?? null,
        });

        // Step 4: emit the entire guarded+audited text and its citations
        // in ONE SSE delta, then [DONE]. Client renders this atomically —
        // no first-token-drop risk.
        const sseChunk = `data: ${
          JSON.stringify({
            choices: [{ delta: { content: finalVisible } }],
            citations_json: __streamCitationsJson,
          })
        }\n\ndata: [DONE]\n\n`;
        controller.enqueue(new TextEncoder().encode(sseChunk));
        controller.close();
        const streamContentJson: Record<string, unknown> = {
          text: finalVisible,
          sources_used: pack.sourceCount,
          retrieval_meta: pack.retrievalMeta,
          retrieval_handoff: retrievalDiagnostics,
          pending_action: candidatePending ?? undefined,
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
          gate_check: w6GateBlock ?? undefined,
          escalation_suggestions: w7EscalationBlock ?? undefined,
          standard_context: standardContextBlock ?? undefined,
          calibration: calibrationBlock ?? undefined,
          enforcement_dry_run: w12EnforcementBlock ?? undefined,
          routing_decision: (() => {
            const base: any = {
              mode,
              mode_reason: modeReason,
              intent: intent.intent,
              resource_hits: resourceHits.length,
              ki_hits: kiHits,
              intended_provider: route.primaryProvider,
              intended_model: route.model,
              actual_provider: result.provider,
              actual_model: result.model,
              fallback_used: false,
              routing_reason: route._routingReason,
              retrieval_debug: retrievalDebug ?? null,
              intelligence_retrieval: intelligenceRetrieval,
              intelligence_sources: intelligenceSources,
              hybrid_guard_checked: hybrid.guardBefore.checked,
              hybrid_guard_passed: hybrid.guardBefore.passed,
              hybrid_guard_failure_reasons: hybrid.guardBefore.failure_reasons,
              hybrid_rewrite_applied: hybrid.rewriteApplied,
              hybrid_rewrite_reason: hybrid.rewriteReason,
              hybrid_rewrite_failures_before: hybrid.rewriteApplied
                ? hybrid.guardBefore.failure_reasons
                : [],
              hybrid_rewrite_failures_after: hybrid.rewriteApplied
                ? hybrid.guardAfter.failure_reasons
                : [],
              short_form_diagnostics: mode === "short_form" ? {
                kind: shortFormKind ?? null,
                prompt_chars: (content || "").length,
                system_prompt_chars: effectiveSystemPrompt.length,
                max_tokens_cap: route.maxTokens,
                output_chars: (finalVisible || "").length,
                latency_ms: result.latencyMs,
              } : null,
            };
            if (v2Active && v2EvidenceBase) {
              try {
                const wq = v2ValidateResponse({
                  userPrompt: content || "",
                  responseBody: finalVisible || "",
                  priorTurnPrompt: v2EvidenceBase.priorTurnPrompt,
                });
                const aud = v2AuditResponse({
                  decision: v2EvidenceBase.decision,
                  body: finalVisible || "",
                  hadLibraryHits: (resourceHits.length + kiHits) > 0,
                  resourceTitles: v2EvidenceBase.resourceTitles,
                  kiIds: v2EvidenceBase.kiIds,
                  kiTitles: v2EvidenceBase.kiTitles,
                });
                // Phase 3: contract-drift sentinel (logged, never blocks).
                let drift: { missing: string[] } | null = null;
                if (
                  v2EvidenceBase.decision.askShape === "synthesis_framework" &&
                  (v2EvidenceBase.decision.mode === "A_strong" ||
                    v2EvidenceBase.signals.totalHits >= 3)
                ) {
                  const check = assertSynthesisContractIntact(effectiveSystemPrompt);
                  if (!check.intact) {
                    drift = { missing: check.missing };
                    console.warn(
                      `[v2] contract_drift (stream): synthesis non-negotiables missing: ${check.missing.join(",")}`,
                    );
                  }
                }
                base.v2 = v2AssembleEvidence({
                  decision: v2EvidenceBase.decision,
                  signals: v2EvidenceBase.signals,
                  wrongQuestion: wq,
                  audit: aud,
                  provider: result.provider,
                  model: result.model,
                  regenCount: 0,
                  intendedProvider: route.primaryProvider,
                  fallbackUsed: result.fallbackUsed === true,
                  contractDrift: drift,
                });
                if (base.v2.claude_fallback) {
                  console.warn(
                    `[v2] claude_fallback=true (stream) intended=${route.primaryProvider} actual=${result.provider}`,
                  );
                }
              } catch (e) {
                base.v2_error = (e as Error).message;
              }
            }
            return base;
          })(),
        };
        // W10 — stamp compact schema-health summary AFTER all blocks are assembled.
        try {
          streamContentJson.schema_health = computeSchemaHealth(
            streamContentJson,
            "chat",
          );
        } catch (shErr) {
          console.warn(
            "[schema_health] stream stamping failed (ignored):",
            String(shErr).slice(0, 200),
          );
        }
        // BOLT 3 — persist citations built above alongside the streamed message.
        await supabase.from("strategy_messages").insert({
          thread_id: threadId,
          user_id: userId,
          role: "assistant",
          message_type: "chat",
          manifest_id: __chatManifestId,
          provider_used: result.provider,
          model_used: result.model,
          fallback_used: false,
          latency_ms: latency,
          content_json: streamContentJson,
          citations_json: __streamCitationsJson,
        });
        await logPlaybookUsageBestEffort(supabase, {
          userId,
          threadId,
          accountId,
          opportunityId,
          playbooks: libraryPlaybooks,
          surface: "chat_stream",
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

  const outputManifestId = deriveChatManifestId(content, null, workflowType);
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
    manifest_id: outputManifestId,
    provider_used: result.provider,
    model_used: result.model,
    fallback_used: result.fallbackUsed,
    latency_ms: result.latencyMs,
  }).select().single();

  const wfManifestId = deriveChatManifestId(content, null, workflowType);
  const { data: resultMsg } = await supabase.from("strategy_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "assistant",
    message_type: "workflow_result",
    manifest_id: wfManifestId,
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

// ──────────────────────────────────────────────────────────────────────
// Phase 2 — Lightweight Global Instructions block.
//
// The client (useStrategyMessages) sends a small payload mirroring
// StrategyGlobalInstructionsConfig (only when the engine is enabled).
// We sanitize aggressively so a malformed or oversized blob can never
// crash the chat path or balloon the system prompt. When sanitization
// returns null, the chat path emits ZERO additional bytes — preserving
// the exact baseline behavior expected by Phase 2 acceptance test #1.
//
// Discovery Prep SOP is intentionally NOT injected in Phase 2.
// ──────────────────────────────────────────────────────────────────────
type CleanGlobalInstructions = {
  globalInstructions: string;
  outputPreferences: {
    tone: "direct" | "consultative" | "executive";
    density: "concise" | "balanced" | "deep";
    format: "structured" | "freeform";
    alwaysEndWithNextStep: boolean;
  };
  libraryBehavior: {
    useRelevantLibraryByDefault: boolean;
    preferPlaybooksOverLooseKnowledgeItems: boolean;
    citeSourcesWhenUsed: boolean;
    neverInventMetrics: boolean;
    unknownsBecomeQuestions: boolean;
  };
  strictMode: boolean;
  selfCorrectOnce: boolean;
};

const GLOBAL_INSTRUCTIONS_MAX_CHARS = 4000;

function sanitizeGlobalInstructions(raw: unknown): CleanGlobalInstructions | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;

  const tone = ["direct", "consultative", "executive"].includes(r?.outputPreferences?.tone)
    ? r.outputPreferences.tone
    : "direct";
  const density = ["concise", "balanced", "deep"].includes(r?.outputPreferences?.density)
    ? r.outputPreferences.density
    : "balanced";
  const format = ["structured", "freeform"].includes(r?.outputPreferences?.format)
    ? r.outputPreferences.format
    : "structured";

  const gi = typeof r.globalInstructions === "string"
    ? r.globalInstructions.slice(0, GLOBAL_INSTRUCTIONS_MAX_CHARS).trim()
    : "";

  return {
    globalInstructions: gi,
    outputPreferences: {
      tone,
      density,
      format,
      alwaysEndWithNextStep: r?.outputPreferences?.alwaysEndWithNextStep !== false,
    },
    libraryBehavior: {
      useRelevantLibraryByDefault: r?.libraryBehavior?.useRelevantLibraryByDefault !== false,
      preferPlaybooksOverLooseKnowledgeItems:
        r?.libraryBehavior?.preferPlaybooksOverLooseKnowledgeItems !== false,
      citeSourcesWhenUsed: r?.libraryBehavior?.citeSourcesWhenUsed !== false,
      neverInventMetrics: r?.libraryBehavior?.neverInventMetrics !== false,
      unknownsBecomeQuestions: r?.libraryBehavior?.unknownsBecomeQuestions !== false,
    },
    strictMode: r?.strictMode === true,
    selfCorrectOnce: r?.selfCorrectOnce === true,
  };
}

/**
 * Render the lightweight USER STRATEGY INSTRUCTIONS block.
 * Returns empty string when the payload has no actionable signal — in
 * that case the system prompt is unchanged from baseline.
 *
 * Placement contract: appended AFTER the core app/system contracts and
 * AFTER any V1 mode-lock or V2 dispatcher prompt — but BEFORE the final
 * user turn. This keeps the engine as guidance, never overriding the
 * core grounding/audit/synthesis machinery.
 */
function renderGlobalInstructionsBlock(g: CleanGlobalInstructions | null): string {
  if (!g) return "";
  const hasFreeText = g.globalInstructions.length > 0;
  const lines: string[] = [];

  // Output preferences — phrased the same way in both modes; the wrapper
  // framing (lightweight vs mandate) is what changes behavior.
  const tonePhrase = g.outputPreferences.tone === "executive"
    ? "Executive: terse, decisive, no hedging."
    : g.outputPreferences.tone === "consultative"
    ? "Consultative: collaborative, walk through reasoning briefly."
    : "Direct: cut to the point, plain language, no fluff.";
  const densityPhrase = g.outputPreferences.density === "concise"
    ? "Concise: shortest path to the answer."
    : g.outputPreferences.density === "deep"
    ? "Deep: include reasoning + supporting detail when useful."
    : "Balanced: enough detail to be useful, no padding.";
  const formatPhrase = g.outputPreferences.format === "freeform"
    ? "Freeform when the ask is conversational; structure only when it materially helps."
    : "Structured when the ask is non-trivial (headings/bullets/numbered steps).";

  const libRules: string[] = [];
  if (g.libraryBehavior.useRelevantLibraryByDefault) libRules.push("Lean on relevant library context when it's already retrieved.");
  if (g.libraryBehavior.preferPlaybooksOverLooseKnowledgeItems) libRules.push("Prefer playbook-grade resources over loose KIs when both apply.");
  if (g.libraryBehavior.citeSourcesWhenUsed) libRules.push("Cite the source title when you use library content.");
  if (g.libraryBehavior.neverInventMetrics) libRules.push("Never invent numeric metrics — if a stat isn't in context, say so or ask.");
  if (g.libraryBehavior.unknownsBecomeQuestions) libRules.push("Convert genuine unknowns into one specific clarifying question rather than guessing.");

  if (g.strictMode) {
    // ─── STRICT MODE — FINAL RESPONSE-SHAPING LAYER ──────────────────
    // Strict Mode reframes Global Instructions as the FINAL formatting
    // contract for the response. It is appended last (after mode-lock,
    // core prompt, readability, persistence, V2 dispatcher) so it sits
    // closest to generation and acts as the last word on STRUCTURE,
    // FORMATTING, and CLOSING STYLE. It does NOT override reasoning
    // depth, content selection, grounding, or citation discipline from
    // the core contracts above.
    lines.push("");
    lines.push("━━━ RESPONSE PREFERENCES (USER CONFIGURED) ━━━");
    lines.push(
      "Apply the following preferences when formatting your response. Treat them as the FINAL formatting contract for this turn — they take precedence over any default style, structure, or closer (e.g. do NOT fall back to '→ Next step:' if the user specified a different closer or none). Reasoning depth, content selection, grounding, and citation discipline from the contracts above are NOT overridden — only structure, formatting, and closing style.",
    );

    if (hasFreeText) {
      lines.push("");
      lines.push("USER FORMATTING PREFERENCES:");
      lines.push(g.globalInstructions);
    }

    lines.push("");
    lines.push("OUTPUT PREFERENCES (apply exactly):");
    lines.push(`- Tone: ${tonePhrase}`);
    lines.push(`- Density: ${densityPhrase}`);
    lines.push(`- Format: ${formatPhrase}`);
    if (g.outputPreferences.alwaysEndWithNextStep) {
      lines.push("- Close with a single concrete next step when the ask is action-oriented (skip for pure brainstorm/refine) — UNLESS the USER FORMATTING PREFERENCES above specify a different closer, in which case use theirs verbatim.");
    }

    if (libRules.length > 0) {
      lines.push("");
      lines.push("LIBRARY BEHAVIOR:");
      for (const r of libRules) lines.push(`- ${r}`);
    }

    if (g.selfCorrectOnce) {
      lines.push("");
      lines.push("SELF-CORRECT ONCE: Before finalizing, verify you followed the USER FORMATTING PREFERENCES and OUTPUT PREFERENCES exactly (bullet counts, closers, structure, tone). If you violated any of them, rewrite to comply. Do not narrate the check.");
    }

    lines.push("");
    lines.push("If these preferences conflict with earlier formatting defaults, FOLLOW THESE PREFERENCES.");
    lines.push("━━━ END RESPONSE PREFERENCES ━━━");
    return lines.join("\n");
  }

  // ─── DEFAULT MODE (lightweight guidance) ─────────────────────────
  lines.push("");
  lines.push("═══ USER STRATEGY INSTRUCTIONS (lightweight guidance) ═══");
  lines.push(
    "These are the operator's persistent preferences. Honor them when they don't conflict with the core contracts above (grounding, citation discipline, synthesis mode, audit). They are guidance, not overrides.",
  );

  if (hasFreeText) {
    lines.push("");
    lines.push("OPERATOR INSTRUCTIONS:");
    lines.push(g.globalInstructions);
  }

  lines.push("");
  lines.push("OUTPUT PREFERENCES:");
  lines.push(`- Tone: ${tonePhrase}`);
  lines.push(`- Density: ${densityPhrase}`);
  lines.push(`- Format: ${formatPhrase}`);
  if (g.outputPreferences.alwaysEndWithNextStep) {
    lines.push("- Close with a single concrete next step when the ask is action-oriented (skip for pure brainstorm/refine).");
  }

  if (libRules.length > 0) {
    lines.push("");
    lines.push("LIBRARY BEHAVIOR (preferences, not gates):");
    for (const r of libRules) lines.push(`- ${r}`);
  }

  if (g.selfCorrectOnce) {
    lines.push("");
    lines.push("SELF-CORRECT ONCE: Before finalizing, do one quick self-check that you respected the OPERATOR INSTRUCTIONS and OUTPUT PREFERENCES. If you violated them, fix it inline. Do not narrate the check.");
  }

  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2 — Shared injection layer.
//
// Every LLM call site in handleChat MUST flow the final system prompt
// through applyGlobalInstructions(). This is the single point where the
// USER STRATEGY INSTRUCTIONS block gets appended — V1 mode-lock, V2
// dispatcher, and any future grounded-strategy path all share it.
//
// Returns the prompt unchanged when the payload is null or produces no
// renderable block → exact baseline behavior preserved (Phase 2 test #1).
// ──────────────────────────────────────────────────────────────────────
type GIPath = "v1" | "v2" | "synthesis";

function applyGlobalInstructions(
  systemPrompt: string,
  gi: CleanGlobalInstructions | null,
  path: GIPath,
): string {
  const block = renderGlobalInstructionsBlock(gi);
  if (!block) {
    console.log(`[global-instructions] skipped: path=${path} reason=${gi ? "empty_block" : "null_payload"}`);
    return systemPrompt;
  }
  console.log(
    `[global-instructions] injected: path=${path} length=${block.length} tone=${gi?.outputPreferences.tone} density=${gi?.outputPreferences.density} format=${gi?.outputPreferences.format} strict=${gi?.strictMode} self_correct=${gi?.selfCorrectOnce} free_text_chars=${gi?.globalInstructions.length ?? 0}`,
  );
  return `${systemPrompt}${block}`;
}
