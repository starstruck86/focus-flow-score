// @vitest-environment node
/**
 * Phase 3.5B — Unit tests for Output Evaluation layer logic.
 * Covers contamination detection, Strategy output validation,
 * business impact scoring, aggregate counting, and export shape.
 *
 * Does NOT touch Strategy runtime, Discovery Prep, tasks, artifacts, or synthesis.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

import {
  isBaselineContaminated,
  isStrategyOutputInvalid,
  buildExportCase,
  computeAggregates,
} from "../outputEvaluationLogic";
import { BASELINE_PROMPT_VERSION } from "@/lib/strategy-control/baselineGenerator";
import { scoreOutput, compareOutputs, type ScoringContext } from "@/lib/strategy-control/outputScorer";
import type { EvaluationResult, StrategyEvalTrace } from "@/lib/strategy-control/evaluationRunner";
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

function makeStrategyTrace(overrides: Partial<StrategyEvalTrace> = {}): StrategyEvalTrace {
  return {
    source: "strategy-eval-synthesis",
    prompt_version: "1.0.0",
    model: "google/gemini-2.5-flash",
    synthesis_latency_ms: 1200,
    library_hits: [{ id: "abc12345", title: "Test KI", kind: "knowledge_item" }],
    expansion_trace: [],
    gate_decision: "pass",
    output_valid: true,
    ...overrides,
  };
}

const dummyScore = {
  specificity: 3, actionability: 3, structure: 3, evidence: 3,
  relevance: 3, business_impact: 3, total: 18, normalized: 3,
};

function makeResult(
  traceOverrides: Partial<BaselineTrace> = {},
  winner: "strategy" | "baseline" | "tie" = "strategy",
  strategyTraceOverrides: Partial<StrategyEvalTrace> = {},
): EvaluationResult {
  return {
    evalCase: {
      case: { id: "test_case", label: "Test Case", body: { skill: { inputs: {} } } } as any,
      tier: "strong",
    },
    strategy: {
      text: "Strategy output with real generated text about business impact and metrics.",
      score: dummyScore,
      trace: makeStrategyTrace(strategyTraceOverrides),
      systemPrompt: "You are a Strategy synthesis engine...",
      userPrompt: "Generate a Conversation POV...",
      envelope: { schema: "skill_envelope.v1", ok: true },
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
      dimension_winners: {
        specificity: "tie", actionability: "tie", structure: "tie",
        evidence: "tie", relevance: "tie", business_impact: "tie",
      },
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
/*  2. isStrategyOutputInvalid                                         */
/* ------------------------------------------------------------------ */

describe("isStrategyOutputInvalid", () => {
  it("returns false when output_valid is true", () => {
    expect(isStrategyOutputInvalid(makeResult())).toBe(false);
  });

  it("returns true when output_valid is false", () => {
    expect(isStrategyOutputInvalid(makeResult({}, "strategy", { output_valid: false }))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Business Impact scoring                                         */
/* ------------------------------------------------------------------ */

describe("scoreOutput — business_impact dimension", () => {
  it("scores 1 for empty text", () => {
    const score = scoreOutput("", []);
    expect(score.business_impact).toBe(1);
  });

  it("scores 1 for generic text with no business signals", () => {
    const score = scoreOutput("This is a general paragraph about nothing specific or measurable.", []);
    expect(score.business_impact).toBe(1);
  });

  it("scores >= 3 for text with before/after + metrics", () => {
    const text = `
      Current state: the company currently loses 15% of revenue to churn.
      Negative consequence: without intervention, attrition will cost $2M annually.
      After state: reducing churn by 5% would increase retention revenue by $500K.
      Required capabilities: need a CDP and lifecycle automation platform.
      Metrics: target 85% retention rate, 20% improvement in LTV, 10% increase in NRR.
    `;
    const score = scoreOutput(text, []);
    expect(score.business_impact).toBeGreaterThanOrEqual(3);
  });

  it("scores >= 4 for text with MEDDPICC + value framework signals", () => {
    const text = `
      Champion: VP of Marketing is the internal champion driving this initiative.
      Economic buyer: CFO controls the budget with decision criteria focused on ROI.
      Current state: today they use a fragmented stack causing 30% churn.
      Pain: identified pain around customer retention and revenue leakage.
      After state: the ideal state includes 95% retention with $3M in savings.
      Make money: this solution helps them increase revenue by 25%.
      Value driver: consolidation reduces cost by $1.2M while improving conversion by 15%.
      Hypothesis: the problem is driven by technology gap and competitive pressure.
      Decision process: requires board approval with paper process taking 6 weeks.
    `;
    const score = scoreOutput(text, []);
    expect(score.business_impact).toBeGreaterThanOrEqual(4);
  });

  it("includes business_impact in total (out of 30)", () => {
    const score = scoreOutput("Some text with current state and risk of churn", []);
    expect(score.total).toBe(
      score.specificity + score.actionability + score.structure +
      score.evidence + score.relevance + score.business_impact,
    );
  });

  it("normalizes to /6 average", () => {
    const score = scoreOutput("test text", []);
    expect(score.normalized).toBe(Math.round((score.total / 6) * 10) / 10);
  });
});

/* ------------------------------------------------------------------ */
/*  4. Aggregate counts                                                */
/* ------------------------------------------------------------------ */

describe("computeAggregates", () => {
  it("includes clean cases with valid output in counts", () => {
    const results = [makeResult({}, "strategy"), makeResult({}, "baseline"), makeResult({}, "tie")];
    const agg = computeAggregates(results);
    expect(agg.valid).toBe(3);
    expect(agg.contaminated).toBe(0);
    expect(agg.strategy_invalid).toBe(0);
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
  });

  it("excludes strategy-invalid cases from win/loss/tie counts", () => {
    const results = [
      makeResult({}, "strategy"),
      makeResult({}, "strategy", { output_valid: false }),
    ];
    const agg = computeAggregates(results);
    expect(agg.valid).toBe(1);
    expect(agg.strategy_invalid).toBe(1);
    expect(agg.strategy_wins).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  5. Export payload shape                                            */
/* ------------------------------------------------------------------ */

describe("buildExportCase", () => {
  it("marks contaminated case as EVALUATION_INVALID and omits scores", () => {
    const exported = buildExportCase(makeResult({ baseline_library_used: true } as any));
    expect(exported.status).toBe("EVALUATION_INVALID");
    expect(exported).not.toHaveProperty("strategy_score");
    expect(exported).not.toHaveProperty("baseline_score");
    expect(exported).not.toHaveProperty("comparison");
  });

  it("marks strategy-invalid case as STRATEGY_OUTPUT_INVALID and omits scores", () => {
    const exported = buildExportCase(makeResult({}, "strategy", { output_valid: false }));
    expect(exported.status).toBe("STRATEGY_OUTPUT_INVALID");
    expect(exported).not.toHaveProperty("strategy_score");
  });

  it("marks clean case as VALID and includes scores", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.status).toBe("VALID");
    expect(exported).toHaveProperty("strategy_score");
    expect(exported).toHaveProperty("baseline_score");
    expect(exported).toHaveProperty("comparison");
  });

  it("includes prompt_version and strategy_prompt_version", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.prompt_version).toBe(BASELINE_PROMPT_VERSION);
    expect(exported.strategy_prompt_version).toBe("1.0.0");
  });

  it("includes strategy_source and strategy_model", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.strategy_source).toBe("strategy-eval-synthesis");
    expect(exported.strategy_model).toBe("google/gemini-2.5-flash");
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

  it("includes baseline system_prompt and user_prompt", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.baseline_prompts.system_prompt).toContain("sales strategy");
    expect(exported.baseline_prompts.user_prompt).toBe("Give me a POV.");
  });

  it("includes strategy_trace with library_hits and gate", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.strategy_trace.library_hits).toHaveLength(1);
    expect(exported.strategy_trace.library_hits[0].title).toBe("Test KI");
    expect(exported.strategy_trace.gate_decision).toBe("pass");
    expect(exported.strategy_trace.output_valid).toBe(true);
  });

  it("includes business_impact in strategy_score for valid cases", () => {
    const exported = buildExportCase(makeResult());
    expect(exported.strategy_score).toHaveProperty("business_impact");
    expect((exported.strategy_score as any).business_impact).toBe(3);
  });
});
