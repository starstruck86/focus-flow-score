import { describe, it, expect } from "vitest";
import { scoreOutput, compareOutputs, type ScoringContext } from "../outputScorer";

describe("scoreJsonDepth — semantic section completeness", () => {
  const artifactCtx: ScoringContext = { shape: "structured_artifact" };

  /**
   * Regression: a 7-section structured artifact with nested arrays/objects
   * must score 5/5 structure and must NOT lose structure to markdown baseline.
   */
  it("7-section artifact with nesting scores structure 5/5", () => {
    const artifact = JSON.stringify({
      metrics: { current: "12%", target: "20%" },
      champion: "VP Sales",
      decision_criteria: ["Speed", "Integration", "Cost"],
      decision_process: { steps: ["Technical eval", "Business case", "Legal"], timeline: "Q3" },
      identified_pain: "Manual pipeline reviews costing 8 hrs/week",
      risks: [{ label: "Budget freeze", severity: "high" }, { label: "Competitor eval", severity: "medium" }],
      next_steps: ["Schedule exec sponsor meeting", "Deliver ROI model"],
    });

    const text = "```json\n" + artifact + "\n```";
    const score = scoreOutput(text, ["pipeline", "champion"], artifactCtx);
    expect(score.structure).toBe(5);
  });

  it("7-section artifact does not lose structure to markdown baseline", () => {
    const artifact = "```json\n" + JSON.stringify({
      strategic_why: "Consolidate tooling to reduce vendor sprawl",
      current_state: { pain: "3 disconnected systems", cost: "$240k/yr" },
      change_vectors: ["Platform consolidation", "API-first architecture"],
      risks: [{ label: "Integration timeline", mitigation: "Phased rollout" }],
      value_drivers: { make_money: "+15% rep productivity", save_money: "-$120k vendor cost" },
      required_capabilities: ["Single pane of glass", "Native CRM sync"],
      next_steps: ["Map current stack", "Build business case"],
    }) + "\n```";

    const markdown = `# MEDDICC Review\n\n## Metrics\n- Current: 12%\n- Target: 20%\n\n## Champion\nVP Sales\n\n## Decision Criteria\n- Speed\n- Integration\n- Cost\n\n## Decision Process\n1. Technical eval\n2. Business case\n3. Legal\n\n## Identified Pain\nManual pipeline reviews\n\n## Risks\n- Budget freeze\n- Competitor eval\n\n## Next Steps\n- Schedule meeting\n- Deliver ROI model`;

    const result = compareOutputs(artifact, markdown, ["pipeline", "champion"], artifactCtx);
    expect(result.dimension_winners.structure).not.toBe("baseline");
  });

  it("executive_brief shape with 7 keys scores 5/5 structure", () => {
    const brief = "```json\n" + JSON.stringify({
      executive_summary: "Platform consolidation opportunity",
      strategic_context: { market: "Competitive pressure increasing", timing: "Budget cycle Q4" },
      key_findings: ["3x cost of current stack", "Integration gaps"],
      recommendations: [{ action: "Consolidate", priority: "P0" }],
      financial_impact: { savings: "$400k", timeline: "18 months" },
      risk_assessment: "Medium — requires exec sponsorship",
      appendix: { sources: ["KI-42", "KI-88"] },
    }) + "\n```";

    const score = scoreOutput(brief, ["consolidation"], { shape: "executive_brief" });
    expect(score.structure).toBe(5);
  });

  it("shallow 3-key JSON scores lower than rich 7-key JSON", () => {
    const shallow = '```json\n{"a": "x", "b": "y", "c": "z"}\n```';
    const rich = "```json\n" + JSON.stringify({
      a: "x", b: { nested: true }, c: ["one", "two"],
      d: "y", e: "z", f: { deep: { level: 3 } }, g: "w",
    }) + "\n```";

    const shallowScore = scoreOutput(shallow, [], artifactCtx);
    const richScore = scoreOutput(rich, [], artifactCtx);
    expect(richScore.structure).toBeGreaterThan(shallowScore.structure);
  });
});

describe("Completeness scoring — structured artifact evaluation", () => {
  const mustHaveSections = ["metrics", "champion", "decision criteria", "decision process", "identified pain", "risks", "next steps"];
  const fullCtx: ScoringContext = { shape: "structured_artifact", mustHave: mustHaveSections };

  it("Test 1 — Incomplete artifact loses structure to complete artifact", () => {
    // Baseline missing 2 sections (champion, risks)
    const incomplete = "```json\n" + JSON.stringify({
      metrics: { current: "12%", target: "20%" },
      decision_criteria: ["Speed", "Integration", "Cost"],
      decision_process: { steps: ["Technical eval", "Business case"], timeline: "Q3" },
      identified_pain: "Manual pipeline reviews costing 8 hrs/week",
      next_steps: ["Schedule exec sponsor meeting", "Deliver ROI model"],
    }) + "\n```";

    // Strategy includes all 7 sections
    const complete = "```json\n" + JSON.stringify({
      metrics: { current: "12%", target: "20%" },
      champion: "VP Sales — strong internal advocate",
      decision_criteria: ["Speed", "Integration", "Cost"],
      decision_process: { steps: ["Technical eval", "Business case", "Legal"], timeline: "Q3" },
      identified_pain: "Manual pipeline reviews costing 8 hrs/week per rep",
      risks: [{ label: "Budget freeze", severity: "high" }, { label: "Competitor eval", severity: "medium" }],
      next_steps: ["Schedule exec sponsor meeting", "Deliver ROI model", "Map decision process"],
    }) + "\n```";

    const result = compareOutputs(complete, incomplete, ["pipeline", "champion"], fullCtx);
    expect(result.dimension_winners.structure).toBe("strategy");
  });

  it("Test 2 — Complete but shallow loses to complete + deep", () => {
    // Both have all sections, but shallow has minimal content
    const shallow = "```json\n" + JSON.stringify({
      metrics: "12%",
      champion: "VP Sales",
      decision_criteria: ["Speed"],
      decision_process: "Standard",
      identified_pain: "Manual reviews",
      risks: ["Budget"],
      next_steps: ["Meeting"],
    }) + "\n```";

    const deep = "```json\n" + JSON.stringify({
      metrics: { current: "12% win rate", target: "20%", gap_analysis: "8pt improvement needed" },
      champion: "VP Sales — has budget authority, personally impacted by pipeline visibility gaps",
      decision_criteria: ["Speed to value (<90 days)", "Native CRM integration", "Cost below $50k/yr"],
      decision_process: { steps: ["Technical eval", "Business case review", "Legal/procurement"], timeline: "Q3", blockers: ["CFO approval"] },
      identified_pain: "Manual pipeline reviews consuming 8 hrs/week per manager, leading to delayed forecasts",
      risks: [{ label: "Budget freeze in Q4", severity: "high", mitigation: "Accelerate timeline" }, { label: "Competitor eval", severity: "medium" }],
      next_steps: ["Schedule exec sponsor meeting by Friday", "Deliver ROI model with CFO metrics", "Map full decision process with champion"],
    }) + "\n```";

    const result = compareOutputs(deep, shallow, ["pipeline", "champion"], fullCtx);
    // Deep should win or tie on structure (depth component gives it the edge)
    expect(result.dimension_winners.structure).not.toBe("baseline");
  });

  it("Test 3 — MustHave enforcement caps structure when section missing", () => {
    // Remove "champion" from artifact
    const missingChampion = "```json\n" + JSON.stringify({
      metrics: { current: "12%", target: "20%" },
      decision_criteria: ["Speed", "Integration"],
      decision_process: { steps: ["Technical eval"], timeline: "Q3" },
      identified_pain: "Manual pipeline reviews",
      risks: [{ label: "Budget freeze", severity: "high" }],
      next_steps: ["Schedule meeting"],
    }) + "\n```";

    const score = scoreOutput(missingChampion, ["pipeline"], fullCtx);
    // Missing 1 section → completeness=4, cap applies → structure ≤ 4
    expect(score.structure).toBeLessThanOrEqual(4);
  });
});

describe("scoreStructureProse — constrained prose robustness", () => {
  const proseCtx: ScoringContext = { shape: "prose", forbid: ["headings", "bullets"] };

  it("Regression: 1 transition-word delta does NOT cause structure loss", () => {
    // Strategy: 2 transitions, strong business-flow signals
    const strategy = `Our current platform creates significant risk for the sales org. Today, reps spend 8 hours weekly on manual pipeline reviews because the existing tooling lacks native CRM integration. This leads to delayed forecasts and missed opportunities.

However, consolidating onto a single platform would reduce vendor cost by $120k annually while improving rep productivity by 15%. The goal is to move from fragmented tooling to a unified system that enables real-time pipeline visibility. This requires executive sponsorship and a phased rollout to mitigate adoption risk.`;

    // Baseline: 3 transitions (one more), but similar business content
    const baseline = `The current state of pipeline management is suboptimal. Today, reps are doing manual reviews. However, there is an opportunity to consolidate. Furthermore, this would save money. Additionally, it would improve productivity.

The question is whether leadership will sponsor the initiative. The outcome would be better forecasting accuracy.`;

    const result = compareOutputs(strategy, baseline, ["pipeline", "consolidation"], proseCtx);
    // Strategy must NOT lose structure despite having fewer transition words
    expect(result.dimension_winners.structure).not.toBe("baseline");
  });

  it("constrained prose with business-flow signals scores well without headings/bullets", () => {
    const prose = `The current state exposes the team to significant risk. Because reps lack real-time visibility, pipeline reviews cost 8 hours per week. This creates a gap between forecast accuracy and actual outcomes.

Moving from manual processes to an integrated platform requires investment but the result is measurable: 15% productivity uplift and $120k in annual savings. The opportunity is clear, and the question is whether we can secure executive sponsorship before Q4.`;

    const score = scoreOutput(prose, ["pipeline", "visibility"], proseCtx);
    expect(score.structure).toBeGreaterThanOrEqual(4);
  });
});
