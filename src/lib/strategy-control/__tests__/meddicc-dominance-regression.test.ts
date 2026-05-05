/**
 * Regression test: MEDDICC Review cannot lose to baseline when Strategy has library context.
 *
 * Failure conditions:
 *   - Any MEDDICC required section missing from Strategy output
 *   - gaps_named missing or implied only
 *   - KIs referenced but not converted into actionable deal judgment
 *   - Baseline total score exceeds Strategy total score
 */
import { describe, it, expect } from "vitest";
import { scoreOutput, compareOutputs, type ScoringContext } from "../outputScorer";

const MEDDICC_CTX: ScoringContext = {
  shape: "structured_artifact",
  skillId: "meddicc-review",
  mustHave: [
    "metrics", "economic buyer", "decision criteria", "decision process",
    "identified pain", "champion", "competition", "gaps named",
  ],
};

// Simulated Strategy output: library-grounded, all sections present with depth
const STRATEGY_MEDDICC = `\`\`\`json
{
  "meddicc_review": {
    "metrics": {
      "status": "partially defined",
      "current_state": "Beechwood references 'guest satisfaction scores' but no quantified baseline or target improvement.",
      "gap": "No agreed success metrics tied to platform consolidation ROI.",
      "commercial_implication": "Without defined metrics, the deal lacks a compelling business case — risk of stalling at procurement.",
      "next_action": "Propose a metrics workshop: define 3 measurable outcomes (e.g., 15% guest satisfaction uplift, 20% operational cost reduction) [KI:abc12345].",
      "library_reasoning": "Per [KI:abc12345], discovery-stage deals without quantified metrics have 40% lower close rates."
    },
    "economic_buyer": {
      "status": "unconfirmed",
      "current_state": "General Manager is the primary contact but may not hold budget authority for platform decisions.",
      "gap": "No confirmation that GM controls the consolidation budget vs. a regional VP or ownership group.",
      "commercial_implication": "Selling to the wrong authority wastes cycles and risks a surprise veto at decision time.",
      "next_action": "Ask GM directly: 'Who signs off on technology investments above $X?' to map the approval chain [KI:def67890]."
    },
    "decision_criteria": {
      "status": "undefined",
      "current_state": "Beechwood has not articulated formal evaluation criteria for the platform consolidation.",
      "gap": "No documented decision criteria — risk of being evaluated on price alone.",
      "commercial_implication": "Without defined criteria that favor our differentiation, competitors can commoditize the deal.",
      "next_action": "Co-create evaluation criteria with GM that emphasize integration depth and guest experience continuity [KI:ghi11111]."
    },
    "decision_process": {
      "status": "unknown",
      "current_state": "No visibility into Beechwood's internal procurement or vendor selection process.",
      "gap": "Timeline, stakeholders involved, and approval steps are all unknown.",
      "commercial_implication": "Blind to process = blind to timeline. Deal could slip quarters without warning.",
      "next_action": "Map the process: 'Walk me through how Beechwood has made similar technology decisions in the past.'"
    },
    "identified_pain": {
      "status": "surface-level",
      "current_state": "GM mentions 'too many platforms' but hasn't quantified the operational or financial pain.",
      "gap": "Pain is stated but not quantified — no compelling event or urgency driver.",
      "commercial_implication": "Unquantified pain = low urgency. Deal sits in pipeline without advancing.",
      "next_action": "Probe for quantified pain: 'What is the cost of running 4 separate platforms today in staff time, errors, and guest complaints?' [KI:jkl22222]."
    },
    "champion": {
      "status": "potential but unvalidated",
      "current_state": "GM appears sympathetic but has not demonstrated internal advocacy behavior.",
      "gap": "No evidence GM has socialized the project internally or taken personal risk to advance it.",
      "commercial_implication": "A sympathetic contact without champion behavior = no internal momentum.",
      "next_action": "Test champion: 'Would you be willing to present the consolidation business case to your leadership team? What would you need from us?' [KI:mno33333]."
    },
    "competition": {
      "status": "unknown",
      "current_state": "No intelligence on whether Beechwood is evaluating alternative vendors or considering status quo.",
      "gap": "Competitive landscape is a complete blind spot.",
      "commercial_implication": "Unknown competition means we can't position differentiation or create urgency against alternatives.",
      "next_action": "Ask directly: 'Are you looking at other solutions for this consolidation, or is the alternative to keep things as they are?'"
    },
    "gaps_named": [
      "No quantified metrics or success criteria defined",
      "Economic buyer not confirmed — GM may lack budget authority",
      "Decision criteria undefined — risk of price-only evaluation",
      "Decision process completely unmapped",
      "Pain is stated but not quantified — no compelling event",
      "Champion behavior unvalidated",
      "Competitive landscape unknown"
    ],
    "overall_assessment": "This deal is at high risk of stalling. 5 of 7 MEDDICC elements are at 'unknown' or 'undefined' status. The immediate priority is a structured discovery session to quantify pain, confirm the economic buyer, and map the decision process.",
    "priority_next_steps": [
      "Schedule metrics definition workshop with GM",
      "Confirm budget authority and map approval chain",
      "Co-create evaluation criteria emphasizing differentiation",
      "Probe for quantified operational pain and compelling event"
    ]
  }
}
\`\`\``;

// Simulated baseline: generic MEDDICC, no library, shallower
const BASELINE_MEDDICC = `\`\`\`json
{
  "meddicc_review": {
    "metrics": {
      "assessment": "Not yet defined. Need to establish measurable success criteria.",
      "recommendation": "Work with stakeholders to define KPIs."
    },
    "economic_buyer": {
      "assessment": "General Manager is the contact but economic buyer needs confirmation.",
      "recommendation": "Identify who controls the budget."
    },
    "decision_criteria": {
      "assessment": "Not documented. Important to understand evaluation framework.",
      "recommendation": "Help define criteria aligned with business needs."
    },
    "decision_process": {
      "assessment": "Unknown. Need to map the buying process.",
      "recommendation": "Ask about previous technology decisions."
    },
    "identified_pain": {
      "assessment": "Platform fragmentation mentioned but not quantified.",
      "recommendation": "Dig deeper into operational impact."
    },
    "champion": {
      "assessment": "GM shows interest but champion status unconfirmed.",
      "recommendation": "Test willingness to advocate internally."
    },
    "competition": {
      "assessment": "No competitive intelligence gathered.",
      "recommendation": "Ask about alternatives being considered."
    },
    "gaps_named": "Multiple MEDDICC elements need further development.",
    "next_steps": [
      "Define success metrics",
      "Confirm economic buyer",
      "Map decision process",
      "Quantify pain points"
    ]
  }
}
\`\`\``;

const INPUT_TERMS = ["Beechwood", "Hotel", "MEDDICC", "Q3", "Platform", "Renewal", "discovery"];

describe("MEDDICC Dominance Regression", () => {
  it("Strategy output contains all 8 mustHave sections explicitly", () => {
    const lower = STRATEGY_MEDDICC.toLowerCase();
    for (const section of MEDDICC_CTX.mustHave!) {
      const underscored = section.replace(/\s+/g, "_");
      const found = lower.includes(section) || lower.includes(underscored);
      expect(found, `Missing mustHave section: "${section}"`).toBe(true);
    }
  });

  it("gaps_named is explicitly present, not just implied", () => {
    expect(STRATEGY_MEDDICC.toLowerCase()).toContain("gaps_named");
    // Must be an array or detailed list, not a single sentence
    const gapsMatch = STRATEGY_MEDDICC.match(/"gaps_named"\s*:\s*\[/);
    expect(gapsMatch, "gaps_named should be an array, not a string").toBeTruthy();
  });

  it("KIs are converted into actionable deal judgment, not decorative", () => {
    // KI citations must appear alongside specific actions/insights
    const kiCitations = STRATEGY_MEDDICC.match(/\[KI:[a-f0-9]+\]/g) || [];
    expect(kiCitations.length).toBeGreaterThanOrEqual(3);

    // Each KI citation should be near actionable language
    for (const cite of kiCitations) {
      const idx = STRATEGY_MEDDICC.indexOf(cite);
      const surrounding = STRATEGY_MEDDICC.slice(Math.max(0, idx - 200), idx + 200).toLowerCase();
      const hasAction = /\b(?:ask|propose|define|confirm|map|probe|test|schedule|establish)\b/.test(surrounding);
      const hasInsight = /\b(?:risk|gap|implication|close rate|stall|blind spot|urgency)\b/.test(surrounding);
      expect(hasAction || hasInsight, `KI citation ${cite} not near actionable language`).toBe(true);
    }
  });

  it("Strategy total score must not be less than baseline total score", () => {
    const comparison = compareOutputs(STRATEGY_MEDDICC, BASELINE_MEDDICC, INPUT_TERMS, MEDDICC_CTX);
    expect(comparison.winner).not.toBe("baseline");
    expect(comparison.strategy_score.total).toBeGreaterThanOrEqual(comparison.baseline_score.total);
  });

  it("Strategy must win evidence dimension over baseline", () => {
    const comparison = compareOutputs(STRATEGY_MEDDICC, BASELINE_MEDDICC, INPUT_TERMS, MEDDICC_CTX);
    expect(comparison.dimension_winners.evidence).toBe("strategy");
  });

  it("Strategy must not lose structure or business_impact", () => {
    const comparison = compareOutputs(STRATEGY_MEDDICC, BASELINE_MEDDICC, INPUT_TERMS, MEDDICC_CTX);
    expect(comparison.dimension_winners.structure).not.toBe("baseline");
    expect(comparison.dimension_winners.business_impact).not.toBe("baseline");
  });
});
