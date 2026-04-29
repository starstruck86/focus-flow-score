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
};

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
  const generic = trace.generic_output_risk as unknown;
  const dropped = Array.isArray(trace.dropped_client_keys)
    ? (trace.dropped_client_keys as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  const clamped = Array.isArray(trace.overrides_clamped)
    ? (trace.overrides_clamped as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
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
  };
}

function evaluate(
  expectation: CaseExpectation,
  signals: CaseSignals,
  raw: unknown,
): { status: CaseStatus; reason: string } {
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
      return { status: "pass", reason: "ok envelope" };
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
      // supabase-js surfaces non-2xx as `error` but `data` may still hold the body.
      const raw = data ?? { error: error.message };
      const signals = extractSignals(raw);
      const verdict = evaluate(c.expectation, signals, raw);
      return {
        case: c,
        status: verdict.status,
        reason: verdict.reason || error.message,
        latencyMs,
        httpStatus: (error as { context?: { status?: number } })?.context?.status ?? null,
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
  try {
    const { data } = await supabase.functions.invoke("strategy-chat", {
      body: {
        threadId: "preflight",
        skill: { id: "unknown-skill-test", version: "1", inputs: {} },
      },
      headers: { "x-skill-debug": "1" },
    });
    const signals = extractSignals(data);
    if (signals.schema === "skill_envelope.v1") {
      return { flagOn: true, reason: "skill envelope returned", raw: data };
    }
    return {
      flagOn: false,
      reason: "no skill envelope — flag likely OFF",
      raw: data,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { flagOn: false, reason: `preflight error: ${message}`, raw: null };
  }
}
