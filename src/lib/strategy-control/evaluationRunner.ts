/**
 * Phase 3.5A — Output Evaluation Runner.
 *
 * For a given case:
 *   1. Runs Strategy output (via existing skill pipeline)
 *   2. Runs Baseline output (clean-baseline endpoint, ZERO Strategy context)
 *   3. Scores both deterministically
 *   4. Returns comparison
 */
import type { ValidationCase } from "./cases";
import type { BaselineTrace } from "./baselineGenerator";
import { runCase, type CaseResult } from "./runner";
import { generateBaseline, type BaselineResult } from "./baselineGenerator";
import { compareOutputs, type ComparisonResult, type OutputScore } from "./outputScorer";

export interface EvaluationCase {
  /** The validation case definition */
  case: ValidationCase;
  /** Readable label for the evaluation tier */
  tier: "strong" | "partial" | "weak";
}

export interface EvaluationResult {
  evalCase: EvaluationCase;
  strategy: {
    caseResult: CaseResult;
    text: string;
    score: OutputScore;
  };
  baseline: {
    result: BaselineResult;
    text: string;
    score: OutputScore;
  };
  comparison: ComparisonResult;
  inputTerms: string[];
  timestamp: string;
}

function extractStrategyText(result: CaseResult): string {
  const raw = result.raw as Record<string, unknown> | null;
  if (!raw) return "";

  // Skill envelope shape
  const envelope = raw.envelope as Record<string, unknown> | undefined;
  if (envelope) {
    if (typeof envelope.content === "string") return envelope.content;
    if (typeof envelope.text === "string") return envelope.text;
    // May be in output
    const output = envelope.output as Record<string, unknown> | undefined;
    if (output && typeof output.content === "string") return output.content;
    if (output && typeof output.text === "string") return output.text;
  }

  // Top-level
  if (typeof raw.content === "string") return raw.content;
  if (typeof raw.text === "string") return raw.text;

  return JSON.stringify(raw).slice(0, 2000);
}

function extractInputTerms(c: ValidationCase): string[] {
  const skill = c.body.skill as { inputs?: Record<string, unknown> } | undefined;
  if (!skill?.inputs) return [];
  const inputs = skill.inputs;
  const terms: string[] = [];
  for (const [, v] of Object.entries(inputs)) {
    if (typeof v === "string" && v.trim().length > 0) {
      // Split multi-word values into individual terms
      v.split(/\s+/).forEach(w => {
        if (w.length > 2) terms.push(w);
      });
    }
  }
  return terms;
}

export async function runEvaluation(
  evalCase: EvaluationCase,
  onProgress?: (phase: "strategy" | "baseline" | "scoring") => void,
): Promise<EvaluationResult> {
  const inputTerms = extractInputTerms(evalCase.case);

  // 1. Run Strategy output
  onProgress?.("strategy");
  const strategyResult = await runCase(evalCase.case);
  const strategyText = extractStrategyText(strategyResult);

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
  const comparison = compareOutputs(strategyText, baselineResult.text, inputTerms);

  return {
    evalCase,
    strategy: {
      caseResult: strategyResult,
      text: strategyText,
      score: comparison.strategy_score,
    },
    baseline: {
      result: baselineResult,
      text: baselineResult.text,
      score: comparison.baseline_score,
    },
    comparison,
    inputTerms,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build default evaluation cases from the existing validation cases.
 * Picks conversation-pov cases at different signal strengths.
 */
export function buildDefaultEvalCases(
  cases: ReadonlyArray<ValidationCase>,
): EvaluationCase[] {
  const evalCases: EvaluationCase[] = [];

  // Strong: Case 1 (conversation-pov with real account)
  const c1 = cases.find(c => c.id === "1_conversation_pov");
  if (c1) evalCases.push({ case: c1, tier: "strong" });

  // Partial: Case 3b (discovery-prep with real account — may have coverage gap)
  const c3b = cases.find(c => c.id === "3b_discovery_prep_real");
  if (c3b) evalCases.push({ case: c3b, tier: "partial" });

  // Weak: Case 3a (sparse / fake inputs)
  const c3a = cases.find(c => c.id === "3a_discovery_prep_sparse");
  if (c3a) evalCases.push({ case: c3a, tier: "weak" });

  return evalCases;
}
