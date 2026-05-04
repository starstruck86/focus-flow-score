/**
 * Extracted pure logic from OutputEvaluationTab for testability.
 * No UI, no React — just functions.
 */
import type { EvaluationResult } from "@/lib/strategy-control/evaluationRunner";
import { BASELINE_PROMPT_VERSION } from "@/lib/strategy-control/baselineGenerator";

export function isBaselineContaminated(result: EvaluationResult): boolean {
  const t = result.baseline.trace;
  if (!t) return true;
  if (t.baseline_mode !== "clean_baseline") return true;
  if (t.baseline_context_used) return true;
  if (t.baseline_library_used) return true;
  if (t.baseline_memory_used) return true;
  return false;
}

export function computeAggregates(results: EvaluationResult[]) {
  const clean = results.filter(r => !isBaselineContaminated(r));
  return {
    total: results.length,
    valid: clean.length,
    contaminated: results.length - clean.length,
    strategy_wins: clean.filter(r => r.comparison.winner === "strategy").length,
    baseline_wins: clean.filter(r => r.comparison.winner === "baseline").length,
    ties: clean.filter(r => r.comparison.winner === "tie").length,
  };
}

export function buildExportCase(r: EvaluationResult) {
  const contaminated = isBaselineContaminated(r);
  return {
    case_id: r.evalCase.case.id,
    label: r.evalCase.case.label,
    tier: r.evalCase.tier,
    status: contaminated ? "EVALUATION_INVALID" : "VALID",
    timestamp: r.timestamp,
    prompt_version: BASELINE_PROMPT_VERSION,
    input_terms: r.inputTerms,
    baseline_integrity: {
      mode: r.baseline.trace.baseline_mode,
      model: r.baseline.trace.model,
      context_used: r.baseline.trace.baseline_context_used,
      library_used: r.baseline.trace.baseline_library_used,
      memory_used: r.baseline.trace.baseline_memory_used,
    },
    baseline_prompts: {
      system_prompt: r.baseline.result.systemPrompt,
      user_prompt: r.baseline.result.userPrompt,
    },
    ...(contaminated
      ? {}
      : {
          strategy_score: r.strategy.score,
          baseline_score: r.baseline.score,
          comparison: r.comparison,
        }),
  };
}
