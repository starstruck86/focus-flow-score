/**
 * Phase 3.5B — Output Evaluation Runner.
 *
 * For a given case:
 *   1. Runs Strategy eval synthesis (real LLM-generated Strategy answer)
 *   2. Runs Baseline output (clean-baseline endpoint, ZERO Strategy context)
 *   3. Scores both deterministically
 *   4. Returns comparison
 *
 * Strategy side now calls run-strategy-eval-synthesis which produces
 * REAL generated text via skill runtime + LLM synthesis.
 * No longer compares raw envelope JSON against baseline prose.
 */
import type { ValidationCase } from "./cases";
import type { BaselineTrace } from "./baselineGenerator";
import { generateBaseline, type BaselineResult } from "./baselineGenerator";
import { compareOutputs, type ComparisonResult, type OutputScore, type ScoringContext } from "./outputScorer";
import { conversationPovManifest } from "@/lib/strategy-skills/manifests/conversationPov";
import { commercialInsightManifest } from "@/lib/strategy-skills/manifests/commercialInsight";
import { discoveryPrepManifest } from "@/lib/strategy-skills/manifests/discoveryPrep";
import { discoveryQuestionsManifest } from "@/lib/strategy-skills/manifests/discoveryQuestions";
import { executiveBriefManifest } from "@/lib/strategy-skills/manifests/executiveBrief";
import { meddiccReviewManifest } from "@/lib/strategy-skills/manifests/meddiccReview";
import type { SkillManifest } from "@/lib/strategy-skills/types";
import { supabase } from "@/integrations/supabase/client";

export interface EvaluationCase {
  /** The validation case definition */
  case: ValidationCase;
  /** Readable label for the evaluation tier */
  tier: "strong" | "partial" | "weak";
}

export interface StrategyEvalTrace {
  source: "strategy-eval-synthesis";
  prompt_version: string;
  model: string;
  synthesis_latency_ms: number;
  library_hits: Array<{ id: string; title: string; kind: string }>;
  expansion_trace: Array<{ term: string; source: string; rule: string }>;
  gate_decision: string;
  /** Whether the Strategy text was actually synthesized vs raw envelope JSON */
  output_valid: boolean;
}

export interface EvaluationResult {
  evalCase: EvaluationCase;
  strategy: {
    text: string;
    score: OutputScore;
    trace: StrategyEvalTrace;
    /** The system prompt used for synthesis */
    systemPrompt: string;
    /** The user prompt used for synthesis */
    userPrompt: string;
    /** Full envelope for forensic inspection */
    envelope: unknown;
  };
  baseline: {
    result: BaselineResult;
    text: string;
    score: OutputScore;
    trace: BaselineTrace;
  };
  comparison: ComparisonResult;
  inputTerms: string[];
  timestamp: string;
}

function extractInputTerms(c: ValidationCase): string[] {
  const skill = c.body.skill as { inputs?: Record<string, unknown> } | undefined;
  if (!skill?.inputs) return [];
  const inputs = skill.inputs;
  const terms: string[] = [];
  for (const [, v] of Object.entries(inputs)) {
    if (typeof v === "string" && v.trim().length > 0) {
      v.split(/\s+/).forEach(w => {
        if (w.length > 2) terms.push(w);
      });
    }
  }
  return terms;
}

/**
 * Detect whether text is raw JSON/envelope rather than real prose.
 * Returns true if the text looks like generated Strategy output.
 */
function isValidStrategyOutput(text: string): boolean {
  if (!text || text.trim().length < 20) return false;
  const trimmed = text.trim();
  // Reject raw JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  // Reject if it looks like stringified envelope
  if (trimmed.includes('"skill_envelope.v1"') || trimmed.includes('"skill_trace.v1"')) return false;
  if (trimmed.includes('"schema":"skill_')) return false;
  return true;
}

interface EvalSynthesisResponse {
  ok: boolean;
  source: string;
  prompt_version: string;
  generated_text?: string;
  synthesis_latency_ms?: number;
  model?: string;
  envelope?: unknown;
  synthesis_addendum?: string;
  library_hits?: Array<{ id: string; title: string; kind: string }>;
  expansion_trace?: Array<{ term: string; source: string; rule: string }>;
  system_prompt?: string;
  user_prompt?: string;
  refusal?: { reason: string; code: string };
  reason?: string;
  code?: string;
  error?: string;
}

async function runStrategyEvalSynthesis(
  evalCase: EvaluationCase,
): Promise<{
  text: string;
  trace: StrategyEvalTrace;
  systemPrompt: string;
  userPrompt: string;
  envelope: unknown;
  refusal: { reason: string; code: string } | null;
}> {
  const { data, error } = await supabase.functions.invoke("run-strategy-eval-synthesis", {
    body: {
      skill: evalCase.case.body.skill,
      threadId: (evalCase.case.body as Record<string, unknown>).threadId,
    },
  });

  const d = (data ?? {}) as EvalSynthesisResponse;

  if (error || !d.ok) {
    const refusal = d.refusal ?? (d.reason ? { reason: d.reason, code: d.code ?? "unknown" } : null);
    return {
      text: "",
      trace: {
        source: "strategy-eval-synthesis",
        prompt_version: d.prompt_version ?? "unknown",
        model: d.model ?? "unknown",
        synthesis_latency_ms: d.synthesis_latency_ms ?? 0,
        library_hits: d.library_hits ?? [],
        expansion_trace: d.expansion_trace ?? [],
        gate_decision: refusal ? "refuse" : "unknown",
        output_valid: false,
      },
      systemPrompt: d.system_prompt ?? "",
      userPrompt: d.user_prompt ?? "",
      envelope: d.envelope ?? null,
      refusal,
    };
  }

  const text = d.generated_text ?? "";
  const envelope = d.envelope as Record<string, unknown> | undefined;
  const gateDecision = envelope?.trace
    ? ((envelope.trace as Record<string, unknown>).gate as Record<string, unknown>)?.decision as string ?? "pass"
    : "pass";

  return {
    text,
    trace: {
      source: "strategy-eval-synthesis",
      prompt_version: d.prompt_version ?? "unknown",
      model: d.model ?? "unknown",
      synthesis_latency_ms: d.synthesis_latency_ms ?? 0,
      library_hits: d.library_hits ?? [],
      expansion_trace: d.expansion_trace ?? [],
      gate_decision: gateDecision,
      output_valid: isValidStrategyOutput(text),
    },
    systemPrompt: d.system_prompt ?? "",
    userPrompt: d.user_prompt ?? "",
    envelope: d.envelope ?? null,
    refusal: null,
  };
}

export async function runEvaluation(
  evalCase: EvaluationCase,
  onProgress?: (phase: "strategy" | "baseline" | "scoring") => void,
): Promise<EvaluationResult> {
  const inputTerms = extractInputTerms(evalCase.case);

  // 1. Run Strategy eval synthesis (real generated text)
  onProgress?.("strategy");
  const strategyResult = await runStrategyEvalSynthesis(evalCase);

  // 2. Run Baseline output (same inputs, no library)
  onProgress?.("baseline");
  const skill = evalCase.case.body.skill as { inputs?: Record<string, string> } | undefined;
  const baselineResult = await generateBaseline({
    account: skill?.inputs?.account ?? "",
    persona: skill?.inputs?.persona ?? "",
    stage: skill?.inputs?.stage ?? "",
    topic: skill?.inputs?.topic ?? "",
  });

  // 3. Score both
  onProgress?.("scoring");
  const comparison = compareOutputs(strategyResult.text, baselineResult.text, inputTerms);

  return {
    evalCase,
    strategy: {
      text: strategyResult.text,
      score: comparison.strategy_score,
      trace: strategyResult.trace,
      systemPrompt: strategyResult.systemPrompt,
      userPrompt: strategyResult.userPrompt,
      envelope: strategyResult.envelope,
    },
    baseline: {
      result: baselineResult,
      text: baselineResult.text,
      score: comparison.baseline_score,
      trace: baselineResult.trace,
    },
    comparison,
    inputTerms,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if Strategy output is valid (not raw JSON/envelope).
 * Exported for use in contamination checks.
 */
export { isValidStrategyOutput };

/**
 * Build default evaluation cases from the existing validation cases.
 */
export function buildDefaultEvalCases(
  cases: ReadonlyArray<ValidationCase>,
): EvaluationCase[] {
  const evalCases: EvaluationCase[] = [];

  const c1 = cases.find(c => c.id === "1_conversation_pov");
  if (c1) evalCases.push({ case: c1, tier: "strong" });

  const c3b = cases.find(c => c.id === "3b_discovery_prep_real");
  if (c3b) evalCases.push({ case: c3b, tier: "partial" });

  const c3a = cases.find(c => c.id === "3a_discovery_prep_sparse");
  if (c3a) evalCases.push({ case: c3a, tier: "weak" });

  return evalCases;
}
