/**
 * Phase 3A validation runner — pure frontend.
 *
 * Calls the existing `strategy-chat` edge function via supabase.functions.invoke,
 * adding `x-skill-debug: 1` only on cases that opt in.
 *
 * No edge changes. No new endpoints. No persistence.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ValidationCase, CaseExpectation } from "./cases";

const STRATEGY_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-chat`;

export type CaseStatus = "pass" | "fail" | "expected_refusal" | "coverage_gap";

export interface CaseSignals {
  source_mode: string | null;
  confidence: string | null;
  gate_decision: string | null;
  influence: string | null;       // "primary" | "supporting" | "weak" | null
  generic_output_risk: string | null;
  refusal_code: string | null;
  refusal_reason: string | null;
  dropped_client_keys: ReadonlyArray<string>;
  overrides_clamped: ReadonlyArray<string>;
  schema: string | null;          // "skill_envelope.v1" or null
  early_return: boolean;
  // Phase 3B retrieval-expansion telemetry
  term_seeds: ReadonlyArray<string>;
  expanded_seeds: ReadonlyArray<string>;
  expansion_trace: ReadonlyArray<{
    expansion: string;
    source: string;
    rule: string;
    fromInput?: string;
  }>;
  expansion_enabled: boolean;
  lexicon_version: string | null;
}

export interface CaseResult {
  case: ValidationCase;
  status: CaseStatus;
  reason: string;
  latencyMs: number;
  httpStatus: number | null;
  signals: CaseSignals;
  /** Full raw response body for forensic inspection. */
  raw: unknown;
  /** Network-level error message, if any. */
  error: string | null;
}

const EMPTY_SIGNALS: CaseSignals = {
  source_mode: null,
  confidence: null,
  gate_decision: null,
  influence: null,
  generic_output_risk: null,
  refusal_code: null,
  refusal_reason: null,
  dropped_client_keys: [],
  overrides_clamped: [],
  schema: null,
  early_return: false,
  term_seeds: [],
  expanded_seeds: [],
  expansion_trace: [],
  expansion_enabled: false,
  lexicon_version: null,
};

type InvokeErrorWithContext = {
  message?: string;
  context?: Response | { body?: unknown; status?: number } | unknown;
};

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isResponseLike(value: unknown): value is Response {
  return !!(
    value &&
    typeof value === "object" &&
    "clone" in value &&
    typeof (value as { clone?: unknown }).clone === "function" &&
    "json" in value &&
    typeof (value as { json?: unknown }).json === "function"
  );
}

async function readInvokeBody(
  data: unknown,
  error: InvokeErrorWithContext | null,
  label: string,
): Promise<{ body: unknown; httpStatus: number | null }> {
  let body: unknown = tryParseJson(data);
  let parsedBody: unknown = body;
  let httpStatus: number | null = null;
  const ctx = error?.context;

  if (error && !isSkillBranchBody(body)) {
    if (isResponseLike(ctx)) {
      httpStatus = typeof ctx.status === "number" ? ctx.status : null;
      try {
        parsedBody = tryParseJson(await ctx.clone().json());
        body = parsedBody;
      } catch {
        try {
          parsedBody = tryParseJson(await ctx.clone().text());
          body = parsedBody;
        } catch {
          parsedBody = body;
        }
      }
    } else if (ctx && typeof ctx === "object") {
      const ctxRecord = ctx as { body?: unknown; status?: unknown };
      if (typeof ctxRecord.status === "number") httpStatus = ctxRecord.status;
      if ("body" in ctxRecord) {
        parsedBody = tryParseJson(ctxRecord.body);
        body = parsedBody;
      }
    }
  }

  if (!body && error?.message) body = { error: error.message };

  const signals = extractSignals(body);
  console.debug(`[StrategyControl] ${label}`, {
    data,
    error,
    errorContext: ctx,
    parsedBody: body,
    extractedSignals: signals,
  });

  return { body, httpStatus };
}

async function directStrategyChatFetch(
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ body: unknown; httpStatus: number }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const response = await fetch(STRATEGY_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { body: tryParseJson(text), httpStatus: response.status };
}

function isSkillBranchBody(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const body = raw as Record<string, unknown>;
  const envelope = body.envelope as Record<string, unknown> | undefined;
  return (
    body.early_return === true ||
    body.source === "strategy-skills/passthrough" ||
    envelope?.schema === "skill_envelope.v1"
  );
}

function pickInfluenceTier(influence: unknown): string | null {
  if (!influence || typeof influence !== "object") return null;
  const inf = influence as Record<string, unknown>;
  // hardening.computeLibraryInfluence emits something like { tier: "primary" | ... }
  if (typeof inf.tier === "string") return inf.tier;
  // Fallbacks for alternate shapes
  if (typeof inf.label === "string") return inf.label;
  return null;
}

function extractSignals(raw: unknown): CaseSignals {
  if (!raw || typeof raw !== "object") return EMPTY_SIGNALS;
  const body = raw as Record<string, unknown>;
  const earlyReturn = body.early_return === true;
  const envelope = body.envelope as Record<string, unknown> | undefined;
  if (!envelope || typeof envelope !== "object") {
    return { ...EMPTY_SIGNALS, early_return: earlyReturn };
  }
  const schema = typeof envelope.schema === "string" ? envelope.schema : null;
  const refusal = envelope.refusal as Record<string, unknown> | undefined;
  const trace = envelope.trace as Record<string, unknown> | undefined;
  if (!trace) {
    return {
      ...EMPTY_SIGNALS,
      schema,
      early_return: earlyReturn,
      refusal_code: refusal && typeof refusal.code === "string" ? refusal.code : null,
      refusal_reason: refusal && typeof refusal.reason === "string" ? refusal.reason : null,
    };
  }
  const retrieval = trace.retrieval as Record<string, unknown> | undefined;
  const gate = trace.gate as Record<string, unknown> | undefined;
  const planNode = trace.plan as Record<string, unknown> | undefined;
  const generic = trace.generic_output_risk as unknown;
  const dropped = Array.isArray(trace.dropped_client_keys)
    ? (trace.dropped_client_keys as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  const clamped = Array.isArray(trace.overrides_clamped)
    ? (trace.overrides_clamped as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  const termSeeds = planNode && Array.isArray(planNode.term_seeds)
    ? (planNode.term_seeds as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  const expandedSeeds = planNode && Array.isArray(planNode.expanded_seeds)
    ? (planNode.expanded_seeds as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  const rawExpansionTrace = planNode && Array.isArray(planNode.expansion_trace)
    ? (planNode.expansion_trace as unknown[])
    : [];
  const expansionTrace = rawExpansionTrace
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      // server emits `term` (Phase 3B); accept legacy `expansion` too.
      expansion: typeof e.term === "string"
        ? e.term
        : typeof e.expansion === "string" ? e.expansion : "",
      source: typeof e.source === "string" ? e.source : "",
      rule: typeof e.rule === "string" ? e.rule : "",
      fromInput: typeof e.fromInput === "string" ? e.fromInput : undefined,
    }))
    .filter((e) => e.expansion.length > 0);
  const expansionEnabled = !!(planNode && planNode.expansion_enabled === true);
  const lexiconVersion = planNode && typeof planNode.lexicon_version === "string"
    ? (planNode.lexicon_version as string)
    : null;
  return {
    source_mode: typeof trace.source_mode === "string" ? trace.source_mode : null,
    confidence: retrieval && typeof retrieval.confidence === "string"
      ? (retrieval.confidence as string)
      : null,
    gate_decision: gate && typeof gate.decision === "string"
      ? (gate.decision as string)
      : null,
    influence: retrieval ? pickInfluenceTier(retrieval.influence) : null,
    generic_output_risk: typeof generic === "string"
      ? generic
      : (generic && typeof generic === "object" && typeof (generic as Record<string, unknown>).level === "string"
        ? (generic as Record<string, string>).level
        : null),
    refusal_code: refusal && typeof refusal.code === "string" ? refusal.code : null,
    refusal_reason: refusal && typeof refusal.reason === "string" ? refusal.reason : null,
    dropped_client_keys: dropped,
    overrides_clamped: clamped,
    schema,
    early_return: earlyReturn,
    term_seeds: termSeeds,
    expanded_seeds: expandedSeeds,
    expansion_trace: expansionTrace,
    expansion_enabled: expansionEnabled,
    lexicon_version: lexiconVersion,
  };
}

function checkExpansionEvidence(
  c: ValidationCase,
  signals: CaseSignals,
): { ok: true } | { ok: false; reason: string } {
  const req = c.requireExpansionEvidence;
  if (!req) return { ok: true };
  if (!signals.expansion_enabled) {
    return {
      ok: false,
      reason:
        "expansion evidence missing: expansion_enabled=false (set STRATEGY_EXPANSION_ENABLED=true on the edge function)",
    };
  }
  const want = req.anyOf.map((t) => t.toLowerCase());
  const have = signals.expanded_seeds.map((t) => t.toLowerCase());
  const matched = want.filter((w) => have.some((h) => h.includes(w)));
  if (matched.length === 0) {
    return {
      ok: false,
      reason: `expansion fired but did not include any of [${req.anyOf.join(", ")}]; expanded_seeds=[${signals.expanded_seeds.join(", ") || "—"}]`,
    };
  }
  return { ok: true };
}

function evaluate(
  c: ValidationCase,
  signals: CaseSignals,
  raw: unknown,
): { status: CaseStatus; reason: string } {
  const expectation = c.expectation;
  const isSkillEnvelope = signals.schema === "skill_envelope.v1";
  const ok = !!(raw && typeof raw === "object" && (raw as Record<string, unknown>).envelope);
  const refused = !!signals.refusal_code;

  switch (expectation) {
    case "success": {
      if (!isSkillEnvelope) {
        return { status: "fail", reason: "no skill envelope returned" };
      }
      if (refused) {
        return { status: "fail", reason: `refused: ${signals.refusal_code}` };
      }
      const ev = checkExpansionEvidence(c, signals);
      if (!ev.ok) return { status: "fail", reason: ev.reason };
      const evNote = c.requireExpansionEvidence
        ? ` (expansion ✓ via [${signals.expanded_seeds.slice(0, 4).join(", ")}${signals.expanded_seeds.length > 4 ? "…" : ""}])`
        : "";
      return { status: "pass", reason: `ok envelope${evNote}` };
    }
    case "expected_refusal": {
      if (!isSkillEnvelope) {
        return { status: "fail", reason: "no skill envelope returned" };
      }
      if (!refused) {
        return { status: "fail", reason: "passed when honest refusal was expected" };
      }
      return { status: "expected_refusal", reason: `honest refusal: ${signals.refusal_code}` };
    }
    case "pass_attempt": {
      if (!isSkillEnvelope) {
        return { status: "fail", reason: "no skill envelope returned" };
      }
      if (refused) {
        return {
          status: "coverage_gap",
          reason: `refused: ${signals.refusal_code} — library coverage insufficient`,
        };
      }
      return { status: "pass", reason: "honest pass" };
    }
    case "unknown_skill": {
      if (!refused || signals.refusal_code !== "unknown_skill") {
        return {
          status: "fail",
          reason: `expected unknown_skill refusal, got ${signals.refusal_code ?? "none"}`,
        };
      }
      return { status: "pass", reason: "refused with unknown_skill" };
    }
    case "override_dropped": {
      if (!isSkillEnvelope) {
        return { status: "fail", reason: "no skill envelope returned" };
      }
      const droppedKeys = signals.dropped_client_keys.join(",").toLowerCase();
      const droppedSourceMode = droppedKeys.includes("sourcemode");
      const droppedBehavior = droppedKeys.includes("behaviorintent");
      const droppedWorkspace = droppedKeys.includes("workspace");
      // sourceMode is the critical one we must prove dropped.
      if (!droppedSourceMode) {
        return {
          status: "fail",
          reason: `sourceMode override NOT dropped (dropped=${signals.dropped_client_keys.join(", ") || "none"})`,
        };
      }
      const flags = [
        droppedSourceMode ? "sourceMode✓" : "sourceMode✗",
        droppedBehavior ? "behaviorIntent✓" : "behaviorIntent~",
        droppedWorkspace ? "workspace✓" : "workspace~",
      ].join(" ");
      return { status: "pass", reason: `overrides dropped: ${flags}` };
    }
    case "default_path": {
      // Default path must NOT return our skill_envelope.v1 schema.
      if (isSkillEnvelope || signals.early_return) {
        return {
          status: "fail",
          reason: "skill branch fired when default path was required",
        };
      }
      return { status: "pass", reason: "default path intact (no skill envelope)" };
    }
    default:
      return { status: "fail", reason: "unknown expectation" };
  }
}

export async function runCase(c: ValidationCase): Promise<CaseResult> {
  const started = performance.now();
  const headers: Record<string, string> = {};
  if (c.withSkillDebugHeader) headers["x-skill-debug"] = "1";

  try {
    const { data, error } = await supabase.functions.invoke("strategy-chat", {
      body: c.body,
      headers,
    });
    const latencyMs = Math.round(performance.now() - started);
    if (error) {
      let { body: raw, httpStatus } = await readInvokeBody(data, error, `case:${c.id}`);
      if (c.withSkillDebugHeader && !isSkillBranchBody(raw)) {
        const direct = await directStrategyChatFetch(c.body, headers);
        raw = direct.body;
        httpStatus = direct.httpStatus;
        console.debug(`[StrategyControl] case:${c.id}:direct-fetch`, direct);
      }
      const signals = extractSignals(raw);
      const verdict = evaluate(c.expectation, signals, raw);
      return {
        case: c,
        status: verdict.status,
        reason: verdict.reason || error.message,
        latencyMs,
        httpStatus,
        signals,
        raw,
        error: error.message,
      };
    }
    const signals = extractSignals(data);
    const verdict = evaluate(c.expectation, signals, data);
    return {
      case: c,
      status: verdict.status,
      reason: verdict.reason,
      latencyMs,
      httpStatus: 200,
      signals,
      raw: data,
      error: null,
    };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    const message = e instanceof Error ? e.message : String(e);
    return {
      case: c,
      status: "fail",
      reason: `network error: ${message}`,
      latencyMs,
      httpStatus: null,
      signals: EMPTY_SIGNALS,
      raw: null,
      error: message,
    };
  }
}

export async function runAllCases(
  cases: ReadonlyArray<ValidationCase>,
  onProgress?: (result: CaseResult, index: number) => void,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  // Sequential to avoid hammering the function and to preserve clean traces.
  for (let i = 0; i < cases.length; i++) {
    const res = await runCase(cases[i]);
    results.push(res);
    onProgress?.(res, i);
  }
  return results;
}

/** Pre-flight: detect whether STRATEGY_SKILLS_ENABLED is on. */
export interface PreflightResult {
  flagOn: boolean;
  reason: string;
  raw: unknown;
}

export async function preflight(): Promise<PreflightResult> {
  const preflightBody = {
    threadId: "preflight",
    skill: { id: "unknown-skill-test", version: "1", inputs: {} },
  };
  const preflightHeaders = { "x-skill-debug": "1" };

  try {
    const { data, error } = await supabase.functions.invoke("strategy-chat", {
      body: preflightBody,
      headers: preflightHeaders,
    });
    let { body } = await readInvokeBody(data, error, "preflight");
    if (!isSkillBranchBody(body)) {
      const direct = await directStrategyChatFetch(preflightBody, preflightHeaders);
      body = direct.body;
      console.debug("[StrategyControl] preflight:direct-fetch", direct);
    }
    const signals = extractSignals(body);
    if (isSkillBranchBody(body)) {
      return { flagOn: true, reason: "skill envelope returned", raw: body };
    }
    return {
      flagOn: false,
      reason: `no skill envelope returned (schema=${signals.schema ?? "none"}, early_return=${String(signals.early_return)})`,
      raw: body ?? data,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { flagOn: false, reason: `preflight error: ${message}`, raw: null };
  }
}
