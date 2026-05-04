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

/* ------------------------------------------------------------------ */
/*  6. Format-Aware Scoring Calibration (Phase 3.5B-Fix)               */
/* ------------------------------------------------------------------ */

describe("Format-Aware Scoring — Structure", () => {
  const proseCtx: ScoringContext = { shape: "prose", forbid: ["headings", "bullets"], skillId: "conversation-pov" };
  const artifactCtx: ScoringContext = { shape: "structured_artifact", forbid: [], skillId: "discovery-prep" };

  it("prose with forbid headings/bullets should NOT lose structure to markdown baseline", () => {
    const strategyProse = `Beechwood's consolidation initiative exposes a critical dependency on legacy guest systems. Specifically, their current architecture fragments guest data across three platforms, creating a 23% data reconciliation overhead. However, the real risk is competitive: Marriott and Hilton have already unified their stacks, meaning Beechwood's delay increases switching cost exposure quarterly.

Therefore, the conversation should anchor on quantified fragmentation cost. Because their VP of Operations has signaled frustration with manual reconciliation, this creates a natural entry point. Notably, the consolidation timeline aligns with their Q3 budget cycle, creating urgency that should be leveraged.

Given that their current vendor contract expires in 8 months, the strategic window is narrow. The hypothesis: Beechwood will lose 15% of their loyalty program efficiency every quarter they delay, making inaction the most expensive option.`;

    const baselineMarkdown = `## Conversation POV

### Key Points
- Beechwood is consolidating guest platforms
- They need better data management
- Competition is advancing

### Recommendations
- Ask about their timeline
- Understand their needs
- Build rapport with stakeholders

### Next Steps
- Schedule a follow-up meeting
- Send proposal document`;

    const strategyScore = scoreOutput(strategyProse, ["Beechwood", "guest", "consolidation"], proseCtx);
    const baselineScore = scoreOutput(baselineMarkdown, ["Beechwood", "guest", "consolidation"]);

    // Strategy prose should NOT lose structure just because baseline has markdown headings/bullets
    expect(strategyScore.structure).toBeGreaterThanOrEqual(baselineScore.structure);
  });

  it("structured JSON artifact with nested sections should score high on structure", () => {
    const jsonArtifact = `\`\`\`json
{
  "situation": {
    "current_state": "Beechwood operates fragmented guest data across 3 systems",
    "pain_points": ["23% reconciliation overhead", "competitive gap vs Marriott"],
    "timeline": "Q3 budget cycle, 8-month vendor contract window"
  },
  "commercial_insight": "Consolidation delay costs 15% loyalty efficiency per quarter",
  "strategic_why": "VP Operations frustrated with manual reconciliation — natural entry",
  "risks": [
    {"risk": "Competitive displacement", "impact": "High", "timeline": "Quarterly"},
    {"risk": "Vendor lock-in", "impact": "Medium", "timeline": "8 months"}
  ],
  "specific_asks": ["Quantify fragmentation cost", "Map decision process", "Identify champion"],
  "next_steps": ["Discovery call with VP Ops", "ROI model draft", "Competitive analysis"]
}
\`\`\``;

    const score = scoreOutput(jsonArtifact, ["Beechwood"], artifactCtx);
    expect(score.structure).toBeGreaterThanOrEqual(4);
  });
});

describe("Format-Aware Scoring — Actionability", () => {
  it("JSON arrays of discovery_questions/next_steps should score actionability", () => {
    const jsonOutput = `\`\`\`json
{
  "discovery_questions": [
    "What is the annual cost of maintaining three separate guest data systems?",
    "How does the current fragmentation impact your loyalty program retention rates?",
    "Who owns the consolidation decision — is this IT-led or Operations-led?",
    "What would a unified guest view enable that you cannot do today?"
  ],
  "next_steps": [
    "Schedule discovery call with VP Operations",
    "Prepare ROI model comparing current vs consolidated state",
    "Map decision criteria and approval process"
  ],
  "recommendations": [
    "Lead with quantified fragmentation cost to create urgency",
    "Position against Marriott/Hilton unified stacks as competitive risk"
  ]
}
\`\`\``;

    const ctx: ScoringContext = { shape: "list", forbid: [], skillId: "discovery-questions" };
    const score = scoreOutput(jsonOutput, ["Beechwood", "guest"], ctx);
    expect(score.actionability).toBeGreaterThanOrEqual(3);
  });
});

describe("Format-Aware Scoring — Relevance", () => {
  it("generic baseline repeating input terms without action/evidence should get penalized", () => {
    const genericBaseline = `Beechwood guest experience platform consolidation is important. The Beechwood guest experience platform consolidation project requires attention. When thinking about Beechwood guest experience platform consolidation, we should consider best practices. The Beechwood guest experience platform consolidation will be beneficial. Overall, the Beechwood guest experience platform consolidation looks promising and the team should continue with the Beechwood guest experience platform consolidation effort.`;

    const score = scoreOutput(genericBaseline, ["Beechwood", "guest", "experience", "platform", "consolidation"]);
    // Should not get max relevance for pure repetition without substance
    expect(score.relevance).toBeLessThanOrEqual(4);
  });
});

describe("Format-Aware Scoring — Business Impact in JSON", () => {
  it("detects strategic_why, commercial_insight, risks, change_vectors, metrics in JSON fields", () => {
    const jsonArtifact = `\`\`\`json
{
  "strategic_why": "VP Operations frustration with manual reconciliation creates natural entry point",
  "commercial_insight": "Consolidation delay costs 15% loyalty efficiency per quarter of inaction",
  "change_vectors": ["Digital transformation mandate", "Competitive pressure from Marriott"],
  "risks": [
    {"name": "Competitive displacement", "consequence": "Market share erosion", "timeline": "Q3"}
  ],
  "metrics": {"current_churn": "23%", "target_retention": "85%", "roi_estimate": "$2.1M"},
  "current_state_reasoning": "Fragmented stack creates 23% overhead and blocks loyalty innovation",
  "quantified_pain": "$1.2M annual reconciliation cost plus $800K opportunity cost"
}
\`\`\``;

    const ctx: ScoringContext = { shape: "structured_artifact", forbid: [], skillId: "executive-brief" };
    const score = scoreOutput(jsonArtifact, ["Beechwood"], ctx);
    expect(score.business_impact).toBeGreaterThanOrEqual(4);
  });
});

describe("Format-Aware compareOutputs", () => {
  it("normalizes comparison so baseline does not win structure from forbidden formatting", () => {
    const strategyProse = `The consolidation initiative requires immediate attention because fragmentation costs are compounding quarterly. Specifically, three separate guest data systems create a 23% reconciliation overhead that directly impacts loyalty program efficiency. However, the competitive dimension is equally urgent — Marriott completed their unified stack 18 months ago.

Therefore, the conversation must anchor on quantified business impact rather than technical features. Because the VP of Operations has expressed frustration with manual data reconciliation, this creates a natural champion pathway. The strategic window narrows as their vendor contract expires in 8 months.`;

    const baselineMd = `## POV for Beechwood

### Background
- Beechwood is consolidating systems
- They need to improve guest experience

### Approach
- Understand their needs
- Build rapport
- Present our solution

### Next Steps
- Follow up next week`;

    const ctx: ScoringContext = { shape: "prose", forbid: ["headings", "bullets"], skillId: "conversation-pov" };
    const result = compareOutputs(strategyProse, baselineMd, ["Beechwood", "consolidation"], ctx);

    // Strategy should not lose structure when it correctly avoids forbidden formatting
    expect(result.dimension_winners.structure).not.toBe("baseline");
  });
});
