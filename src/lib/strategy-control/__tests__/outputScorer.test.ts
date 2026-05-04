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
