/**
 * Unit tests for Output Evaluation layer logic.
 * Covers contamination detection, aggregate counting, and export shape.
 *
 * Does NOT touch Strategy runtime, Discovery Prep, tasks, artifacts, or synthesis.
 */
import { describe, it, expect } from "vitest";
import {
  isBaselineContaminated,
  buildExportCase,
  computeAggregates,
} from "../outputEvaluationLogic";
import { BASELINE_PROMPT_VERSION } from "@/lib/strategy-control/baselineGenerator";
import type { EvaluationResult } from "@/lib/strategy-control/evaluationRunner";
import type { BaselineTrace } from "@/lib/strategy-control/baselineGenerator";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeTrace(overrides: Partial<BaselineTrace> = {}): BaselineTrace {
  return {
    baseline_mode: "clean_baseline",
    baseline_context_used: false,
    baseline_library_used: false,
    baseline_memory_used: false,
    model: "google/gemini-2.5-flash",
    ...overrides,
  } as BaselineTrace;
}

const dummyScore = { specificity: 3, actionability: 3, structure: 3, evidence: 3, relevance: 3, total: 15, normalized: 3 };

function makeResult(
  traceOverrides: Partial<BaselineTrace> = {},
  winner: "strategy" | "baseline" | "tie" = "strategy",
): EvaluationResult {
  return {
    evalCase: {
      case: { id: "test_case", label: "Test Case", body: { skill: { inputs: {} } } } as any,
      tier: "strong",
    },
    strategy: {
      caseResult: { latencyMs: 100, signals: { influence: "", expanded_seeds: [], confidence: "" } } as any,
      text: "strategy output",
      score: dummyScore,
    },
    baseline: {
      result: {
        text: "baseline output",
        latencyMs: 80,
        error: null,
        trace: makeTrace(traceOverrides),
        systemPrompt: "You are a helpful sales strategy assistant.",
        userPrompt: "Give me a POV.",
      },
      text: "baseline output",
      score: dummyScore,
      trace: makeTrace(traceOverrides),
    },
    comparison: {
      winner,
      reasoning: "test",
      strategy_score: dummyScore,
      baseline_score: dummyScore,
      dimension_winners: { specificity: "tie", actionability: "tie", structure: "tie", evidence: "tie", relevance: "tie" },
    },
    inputTerms: ["term1"],
    timestamp: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  1. isBaselineContaminated                                          */
/* ------------------------------------------------------------------ */

describe("isBaselineContaminated", () => {
  it("returns false for a clean trace", () => {
    expect(isBaselineContaminated(makeResult())).toBe(false);
  });

  it("returns true when mode != clean_baseline", () => {
    expect(isBaselineContaminated(makeResult({ baseline_mode: "default_strategy_path" as any }))).toBe(true);
  });

  it("returns true when context_used is true", () => {
    expect(isBaselineContaminated(makeResult({ baseline_context_used: true } as any))).toBe(true);
  });

  it("returns true when library_used is true", () => {
    expect(isBaselineContaminated(makeResult({ baseline_library_used: true } as any))).toBe(true);
  });

  it("returns true when memory_used is true", () => {
    expect(isBaselineContaminated(makeResult({ baseline_memory_used: true } as any))).toBe(true);
  });

  it("returns true when trace is missing", () => {
    const r = makeResult();
    (r.baseline as any).trace = null;
    expect(isBaselineContaminated(r)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  2 & 3. Aggregate counts                                            */
/* ------------------------------------------------------------------ */

describe("computeAggregates", () => {
  it("includes clean cases in counts", () => {
    const results = [makeResult({}, "strategy"), makeResult({}, "baseline"), makeResult({}, "tie")];
    const agg = computeAggregates(results);
    expect(agg.valid).toBe(3);
    expect(agg.contaminated).toBe(0);
    expect(agg.strategy_wins).toBe(1);
    expect(agg.baseline_wins).toBe(1);
    expect(agg.ties).toBe(1);
  });

  it("excludes contaminated cases from win/loss/tie counts", () => {
    const results = [
      makeResult({}, "strategy"),
      makeResult({ baseline_context_used: true } as any, "strategy"),
      makeResult({ baseline_mode: "bad" as any }, "baseline"),
    ];
    const agg = computeAggregates(results);
    expect(agg.total).toBe(3);
    expect(agg.valid).toBe(1);
    expect(agg.contaminated).toBe(2);
    expect(agg.strategy_wins).toBe(1);
    expect(agg.baseline_wins).toBe(0);
    expect(agg.ties).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  3 & 4. Export payload shape                                        */
/* ------------------------------------------------------------------ */

describe("buildExportCase", () => {
  it("marks contaminated case as EVALUATION_INVALID and omits scores", () => {
    const exported = buildExportCase(makeResult({ baseline_library_used: true } as any));
    expect(exported.status).toBe("EVALUATION_INVALID");
    expect(exported).not.toHaveProperty("strategy_score");
    expect(exported).not.toHaveProperty("baseline_score");
    expect(exported).not.toHaveProperty("comparison");
  });

  it("marks clean case as VALID and includes scores", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.status).toBe("VALID");
    expect(exported).toHaveProperty("strategy_score");
    expect(exported).toHaveProperty("baseline_score");
    expect(exported).toHaveProperty("comparison");
  });

  it("includes prompt_version", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.prompt_version).toBe(BASELINE_PROMPT_VERSION);
  });

  it("includes baseline_integrity fields", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.baseline_integrity).toEqual({
      mode: "clean_baseline",
      model: "google/gemini-2.5-flash",
      context_used: false,
      library_used: false,
      memory_used: false,
    });
  });

  it("includes system_prompt and user_prompt", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.baseline_prompts.system_prompt).toContain("sales strategy");
    expect(exported.baseline_prompts.user_prompt).toBe("Give me a POV.");
  });
});
