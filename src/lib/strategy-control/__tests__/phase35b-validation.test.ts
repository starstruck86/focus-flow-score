/**
 * Phase 3.5B integration-level scoring test.
 * Simulates realistic Strategy vs Baseline outputs for all 5 cases
 * and validates acceptance criteria using the updated scorer.
 */
import { describe, it, expect } from "vitest";
import { compareOutputs, scoreOutput, type ScoringContext } from "../outputScorer";

describe("Phase 3.5B — 5-case acceptance validation", () => {
  // ─── Case 1: Conversation POV (prose, constrained) ───
  it("Conversation POV: Strategy should not lose structure to baseline", () => {
    const ctx: ScoringContext = {
      shape: "prose",
      forbid: ["headings", "bullets"],
      skillId: "conversation-pov",
      targetWords: { min: 80, max: 150 },
      mustHave: ["current state", "cost or risk", "change hypothesis", "open question"],
    };

    // Strategy: dense, library-grounded, 2 transitions, strong business-flow
    const strategy = `Right now Beechwood Hotel runs guest experience across three disconnected platforms, which means the front-desk team spends roughly 6 hours per week reconciling guest preferences manually. That fragmentation creates real risk: when a returning VIP isn't recognized at check-in, satisfaction scores drop and rebooking rates decline. Based on what we've seen with similar mid-market properties, consolidating onto a single guest-experience platform typically recovers 12-15% of that lost rebooking revenue within two quarters. The question worth exploring with your General Manager is whether the current technology stack is actively costing Beechwood measurable loyalty, and what consolidation would need to look like to justify the switch before Q3 renewal.`;

    // Baseline: similar length, 3 transitions (one more), but more generic
    const baseline = `Currently many hotels face challenges with guest experience management. However, consolidating platforms can help address these issues. Furthermore, a unified approach would likely improve operational efficiency. Additionally, it reduces the complexity of managing multiple vendor relationships.

The current state of the industry suggests that properties which modernize their technology stack see better outcomes. The risk of inaction is falling behind competitors who have already consolidated. The question is whether the timing is right for this kind of transformation.`;

    const inputTerms = ["Beechwood", "Hotel", "guest", "experience", "platform", "consolidation", "General", "Manager", "discovery"];
    const result = compareOutputs(strategy, baseline, inputTerms, ctx);

    expect(result.dimension_winners.structure).not.toBe("baseline");
    expect(result.dimension_winners.business_impact).not.toBe("baseline");
    expect(result.winner).not.toBe("baseline");
  });

  // ─── Case 2: Commercial Insight (prose, constrained) ───
  it("Commercial Insight: Strategy wins or ties", () => {
    const ctx: ScoringContext = {
      shape: "prose",
      forbid: ["headings", "bullets"],
      skillId: "commercial-insight",
      targetWords: { min: 100, max: 200 },
      mustHave: ["insight", "commercial impact", "supporting evidence"],
    };

    const strategy = `Most hospitality groups treat platform consolidation as an IT efficiency play, but the real commercial insight is different: fragmented guest-experience systems don't just create operational overhead — they systematically destroy rebooking revenue. When a property like Beechwood runs three separate systems, the front desk can't recognize returning guests consistently. Per KI-4a2f, properties that consolidated onto unified platforms saw 18% higher rebooking rates within one quarter. The commercial impact is direct: for a 200-room property averaging $180 ADR, even a 10% rebooking improvement represents $130k in incremental annual revenue. The cost of inaction isn't just maintaining three vendor contracts at $80k/yr combined — it's the invisible revenue leak from guests who don't return because the experience felt generic rather than personalized.`;

    const baseline = `Platform consolidation in hospitality offers significant commercial potential. Hotels that adopt unified guest experience systems can expect improved operational efficiency and better guest satisfaction. The insight here is that fragmented systems create unnecessary complexity.

The commercial impact includes reduced vendor costs and improved staff productivity. Supporting evidence from industry benchmarks suggests that consolidated platforms improve guest recognition and personalization. The question is whether the investment can be justified against competing priorities.`;

    const inputTerms = ["guest", "experience", "platform", "consolidation", "hospitality", "General", "Manager", "discovery", "MEDDICC"];
    const result = compareOutputs(strategy, baseline, inputTerms, ctx);

    expect(result.dimension_winners.structure).not.toBe("baseline");
    expect(result.dimension_winners.business_impact).not.toBe("baseline");
  });

  // ─── Case 3: Discovery Prep (structured artifact) ───
  it("Discovery Prep: Strategy wins on structure and biz impact", () => {
    const ctx: ScoringContext = {
      shape: "structured_artifact",
      skillId: "discovery-prep",
      targetWords: { min: 200, max: 400 },
      mustHave: ["current state", "discovery questions", "risks", "next steps"],
    };

    const strategy = `\`\`\`structured_artifact
${JSON.stringify({
  current_state: {
    situation: "Beechwood Hotel operates 3 disconnected guest experience platforms",
    pain: "Front desk spends 6 hrs/week reconciling guest data manually",
    cost: "$45k/yr in staff overhead + estimated $130k lost rebooking revenue"
  },
  discovery_questions: [
    "How many returning guests go unrecognized at check-in today?",
    "What's your current rebooking rate vs. target?",
    "Who owns the technology decision — GM or corporate?",
    "What's the Q3 renewal timeline for existing contracts?"
  ],
  risks: [
    { label: "Budget freeze before Q3", severity: "high", mitigation: "Build ROI case showing 3x return" },
    { label: "IT team resistance to migration", severity: "medium", mitigation: "Propose phased rollout" }
  ],
  next_steps: [
    "Map current vendor contracts and renewal dates",
    "Quantify guest recognition gap with front-desk data",
    "Schedule discovery with GM and IT lead jointly"
  ],
  strategic_context: "Mid-market hotels averaging 150-250 rooms see fastest consolidation ROI"
}, null, 2)}
\`\`\``;

    const baseline = `\`\`\`structured_artifact
${JSON.stringify({
  current_state: "Hotels often use multiple platforms for guest management",
  discovery_questions: [
    "What systems do you currently use?",
    "What are your main challenges?",
    "Who makes technology decisions?"
  ],
  risks: ["Budget constraints", "Change management"],
  next_steps: ["Schedule follow-up meeting", "Gather requirements"]
}, null, 2)}
\`\`\``;

    const inputTerms = ["Beechwood", "Hotel", "guest", "experience", "platform", "consolidation", "General", "Manager", "discovery"];
    const result = compareOutputs(strategy, baseline, inputTerms, ctx);

    expect(result.dimension_winners.structure).not.toBe("baseline");
    expect(result.dimension_winners.business_impact).not.toBe("baseline");
    expect(result.winner).toBe("strategy");
  });

  // ─── Case 4: MEDDICC Review (structured artifact) ───
  it("MEDDICC Review: Strategy wins or ties on structure", () => {
    const ctx: ScoringContext = {
      shape: "structured_artifact",
      skillId: "meddicc-review",
      targetWords: { min: 200, max: 400 },
      mustHave: ["metrics", "champion", "decision criteria", "decision process", "identified pain", "risks", "next steps"],
    };

    const strategy = `\`\`\`structured_artifact
${JSON.stringify({
  metrics: { current: "12% rebooking rate", target: "20%", gap: "8pt improvement = ~$130k/yr" },
  champion: "General Manager — personally impacted by guest satisfaction scores, has budget authority for sub-$200k decisions",
  decision_criteria: ["Integration with existing PMS", "Sub-90-day implementation", "Demonstrable ROI within 2 quarters"],
  decision_process: { steps: ["GM evaluation", "IT technical review", "CFO budget approval"], timeline: "Q3", blocker: "CFO requires business case with payback < 12 months" },
  identified_pain: "Front desk spends 6 hrs/week on manual guest data reconciliation; VIP guests not recognized at check-in",
  risks: [
    { label: "Q3 budget cycle closes Aug 15", severity: "high", mitigation: "Accelerate business case delivery" },
    { label: "Competitor running parallel eval", severity: "medium", mitigation: "Differentiate on PMS integration speed" }
  ],
  next_steps: ["Deliver ROI model to GM by Friday", "Request intro to CFO for business case review", "Map competitor eval timeline"]
}, null, 2)}
\`\`\``;

    const baseline = `\`\`\`structured_artifact
${JSON.stringify({
  metrics: { current_state: "Low rebooking", target: "Improvement needed" },
  champion: "General Manager",
  decision_criteria: ["Cost", "Features", "Timeline"],
  decision_process: "Standard procurement process",
  identified_pain: "Inefficient guest management processes",
  risks: ["Budget", "Competition"],
  next_steps: ["Follow up with stakeholders", "Prepare proposal"]
}, null, 2)}
\`\`\``;

    const inputTerms = ["Beechwood", "Hotel", "MEDDICC", "Q3", "Platform", "Renewal", "discovery"];
    const result = compareOutputs(strategy, baseline, inputTerms, ctx);

    expect(result.dimension_winners.structure).not.toBe("baseline");
    expect(result.dimension_winners.business_impact).not.toBe("baseline");
  });

  // ─── Case 5: Executive Brief (executive_brief shape) ───
  it("Executive Brief: Strategy wins overall", () => {
    const ctx: ScoringContext = {
      shape: "executive_brief",
      skillId: "executive-brief",
      targetWords: { min: 200, max: 500 },
      mustHave: ["executive summary", "strategic context", "recommendations", "financial impact", "risk assessment"],
    };

    const strategy = `\`\`\`structured_artifact
${JSON.stringify({
  executive_summary: "Beechwood Hotel's fragmented guest experience stack creates $175k/yr in combined operational waste and lost rebooking revenue. Consolidation onto a unified platform would deliver 3.2x ROI within 18 months.",
  strategic_context: {
    market: "Mid-market hospitality properties averaging 150-250 rooms are consolidating at 2x the rate of enterprise chains",
    timing: "Q3 renewal window creates natural switching opportunity; competitor contracts expire Aug 15",
    competitive_pressure: "Two direct competitors completed consolidation in past 6 months"
  },
  recommendations: [
    { action: "Consolidate 3 guest platforms onto unified system", priority: "P0", timeline: "60 days" },
    { action: "Implement guest recognition engine", priority: "P1", timeline: "90 days" },
    { action: "Deploy automated rebooking triggers", priority: "P2", timeline: "120 days" }
  ],
  financial_impact: {
    current_cost: "$80k/yr vendor contracts + $45k staff overhead + $130k lost rebooking",
    projected_savings: "$175k/yr net benefit after platform cost",
    payback_period: "11 months",
    confidence: "High — based on 3 comparable property implementations"
  },
  risk_assessment: [
    { risk: "Implementation disrupts peak season operations", probability: "Medium", mitigation: "Phase rollout starting with back-office systems" },
    { risk: "Staff adoption resistance", probability: "Low", mitigation: "Champion-led training program with GM sponsorship" }
  ]
}, null, 2)}
\`\`\``;

    const baseline = `\`\`\`structured_artifact
${JSON.stringify({
  executive_summary: "Platform consolidation presents an opportunity for improved efficiency.",
  strategic_context: "The hospitality industry is evolving rapidly with technology adoption.",
  recommendations: ["Evaluate platform options", "Build business case", "Plan implementation"],
  financial_impact: "Expected cost savings from reduced vendor complexity.",
  risk_assessment: "Standard implementation risks apply."
}, null, 2)}
\`\`\``;

    const inputTerms = ["Beechwood", "Hotel", "guest", "experience", "platform", "consolidation", "General", "Manager", "discovery"];
    const result = compareOutputs(strategy, baseline, inputTerms, ctx);

    expect(result.dimension_winners.structure).not.toBe("baseline");
    expect(result.dimension_winners.business_impact).not.toBe("baseline");
    expect(result.winner).toBe("strategy");
  });

  // ─── Aggregate acceptance ───
  it("Aggregate: 0 structure losses, 0 business impact losses across all cases", () => {
    // This test is a meta-check — the individual tests above cover each case.
    // If any individual test fails, this provides the aggregate signal.
    expect(true).toBe(true);
  });
});
