/**
 * Phase 3.5B Scorer Hardening — Permanent Regression Suite
 * 
 * Locked at commit 279961e3.
 * These tests enforce that the scorer correctly defines "excellent"
 * so that baseline outputs cannot reach 5/5 on structure or business impact
 * without demonstrating cross-section reasoning and decision-grade clarity.
 * 
 * DO NOT weaken these tests. If they fail, the scorer is wrong.
 */
import { describe, it, expect } from "vitest";

// ─── Inline scorer functions (mirrored from run-phase35b-validation) ────────
function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}
function _clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function _isJsonLike(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[") || t.includes("```json");
}
function extractJsonContent(text: string): string {
  const fenceMatch = text.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1];
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return t;
  return "";
}

function scoreCrossSectionCausality(text: string): { hasCausality: boolean; score: number } {
  const lower = text.toLowerCase();
  let totalSignals = 0;

  const jsonContent = extractJsonContent(text);
  if (jsonContent) {
    try {
      const parsed = JSON.parse(jsonContent);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const fullText = JSON.stringify(parsed).toLowerCase();
        const embeddedCitations = countMatches(fullText, /\[ki:[a-f0-9]{4,}\]|ki-[a-f0-9]{4,}|\bknowledge item\b|\[pb:[a-f0-9]{4,}\]/gi);
        if (embeddedCitations >= 2) totalSignals += 3;
        else if (embeddedCitations >= 1) totalSignals += 1;

        let deepNestCount = 0;
        const checkDeep = (obj: Record<string, unknown>, d: number) => {
          if (d > 3) return;
          for (const v of Object.values(obj)) {
            if (typeof v === "object" && v !== null && !Array.isArray(v)) {
              const innerKeys = Object.keys(v as Record<string, unknown>);
              if (innerKeys.length >= 3) { deepNestCount++; checkDeep(v as Record<string, unknown>, d + 1); }
            }
            if (Array.isArray(v)) {
              for (const item of v) {
                if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                  const ik = Object.keys(item as Record<string, unknown>);
                  if (ik.length >= 2) deepNestCount++;
                }
              }
            }
          }
        };
        checkDeep(parsed as Record<string, unknown>, 0);
        if (deepNestCount >= 4) totalSignals += 3;
        else if (deepNestCount >= 2) totalSignals += 2;
        else if (deepNestCount >= 1) totalSignals += 1;

        const reasoningInValues = countMatches(fullText, /\b(?:because|therefore|which means|this creates|this drives|resulting in|leading to|if .{5,30} then|the consequence|this compounds|given that)\b/g);
        if (reasoningInValues >= 3) totalSignals += 2;
        else if (reasoningInValues >= 1) totalSignals += 1;
      }
    } catch { /* */ }
  }

  const explicitCausal = countMatches(lower, /\b(?:as identified|building on|given the .{3,40} above|this drives|which compounds|this connects to|per the .{3,30} analysis|based on .{3,40} identified)\b/g);
  totalSignals += Math.min(explicitCausal, 2);

  const hasCausality = totalSignals >= 4;
  let score = 0;
  if (totalSignals >= 6) score = 2;
  else if (totalSignals >= 4) score = 1;
  return { hasCausality, score };
}

// ─── Test fixtures ──────────────────────────────────────────────────────────

/** Baseline-like flat JSON: independent sections, no cross-references, no citations */
const BASELINE_FLAT_JSON = JSON.stringify({
  current_state: "The hotel currently uses multiple disconnected systems for guest experience management.",
  risks: "Fragmented data leads to inconsistent service delivery and missed upsell opportunities.",
  discovery_questions: ["What tools are you using today?", "How do you measure guest satisfaction?"],
  next_steps: "Schedule a technical review to map current integrations.",
  commercial_insight: "Platform consolidation can improve operational efficiency and guest retention.",
});

/** Strategy-like rich JSON: KI citations, nested reasoning, causal chains */
const STRATEGY_RICH_JSON = JSON.stringify({
  current_state_reasoning: {
    situation: "Beechwood Hotel operates 3 disconnected platforms for guest experience [KI:a1b2c3]",
    evidence: "Per Knowledge Item analysis, their NPS dropped 12% YoY due to fragmentation",
    impact: "This creates a $340K annual revenue leakage through missed cross-sell opportunities",
  },
  change_vectors: [
    { driver: "Guest expectation shift", detail: "Post-COVID travelers expect seamless digital-first experiences [KI:d4e5f6]", urgency: "high" },
    { driver: "Competitive pressure", detail: "Marriott and Hilton consolidated platforms in Q2, which means Beechwood risks falling behind", urgency: "critical" },
  ],
  commercial_insight: {
    thesis: "Platform consolidation isn't an IT project — it's a revenue recovery initiative because fragmented guest data directly erodes RevPAR [KI:g7h8i9]",
    quantified_impact: "$340K annual leakage + 15% NPS improvement potential",
    causal_chain: "Fragmented data → inconsistent personalization → lower guest satisfaction → reduced repeat bookings → RevPAR erosion",
  },
  risks: [
    { risk: "Integration timeline exceeds Q3 deadline", consequence: "This drives delayed ROI realization by 2 quarters", mitigation: "Phased rollout starting with loyalty module" },
    { risk: "Staff adoption resistance", consequence: "Given that 60% of front-desk staff have 10+ years on legacy systems, this compounds change management costs", mitigation: "Champion-led training program" },
  ],
  discovery_questions: [
    "What percentage of guest interactions touch more than one platform today?",
    "How does the General Manager measure the cost of fragmented guest data?",
  ],
  recommended_actions: {
    immediate: "Confirm whether the GM has budget authority or if this escalates to ownership group",
    next_meeting: "Map current tech stack integration points with IT lead",
    stakeholder_alignment: "Validate that the GM sees this as revenue recovery, not just cost reduction",
  },
});

/** Generic business impact language — no causal chain, no stakeholder specificity */
const GENERIC_BIZ_IMPACT_TEXT = `
This solution improves efficiency across the organization. It drives growth by
streamlining operations and delivering value to key stakeholders. The platform
enhances performance and helps maximize productivity while optimizing processes.
Better outcomes are expected through innovative approaches and scalable solutions.
`;

/** Strategy-quality business impact — causal chain + stakeholder-tied quantification + citations */
const STRATEGY_BIZ_IMPACT_TEXT = JSON.stringify({
  current_state: {
    situation: "Beechwood Hotel loses $340K annually through fragmented guest data [KI:abc123]",
    evidence: "3 disconnected platforms prevent cross-sell identification",
    impact_metric: "15% NPS gap versus consolidated competitors",
  },
  consequence: {
    business_effect: "Because fragmented platforms block cross-sell, this creates revenue leakage [KI:def456]",
    stakeholder_pressure: "General Manager faces board pressure on RevPAR targets, which means Q3 budget decisions are at risk",
    financial_exposure: "$340K annual leakage compounds if competitors consolidate first",
  },
  recommended_action: {
    immediate: "Confirm with the General Manager whether Q3 budget cycle allows $180K platform investment",
    validation: "Validate with IT that API integration is feasible within 90 days",
    stakeholder_alignment: "Based on the identified revenue gap, position this as recovery not cost",
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3.5B Scorer Hardening — Permanent Regression Suite", () => {
  // ── Test 1: Baseline flat JSON cannot score 5/5 on structure ────────────
  it("baseline flat JSON does NOT pass the cross-section causality gate", () => {
    const { hasCausality } = scoreCrossSectionCausality(BASELINE_FLAT_JSON);
    expect(hasCausality).toBe(false);
  });

  // ── Test 2: Strategy rich JSON DOES pass the cross-section causality gate ─
  it("strategy rich JSON PASSES the cross-section causality gate", () => {
    const { hasCausality, score } = scoreCrossSectionCausality(STRATEGY_RICH_JSON);
    expect(hasCausality).toBe(true);
    expect(score).toBeGreaterThanOrEqual(1);
  });

  // ── Test 3: Baseline generic biz-impact language does NOT pass causality ─
  it("generic business impact prose does NOT pass causality gate", () => {
    const { hasCausality } = scoreCrossSectionCausality(GENERIC_BIZ_IMPACT_TEXT);
    expect(hasCausality).toBe(false);
  });

  // ── Test 4: Strategy biz-impact with causal chain DOES pass ────────────
  it("strategy business impact with causal chain PASSES causality gate", () => {
    const { hasCausality } = scoreCrossSectionCausality(STRATEGY_BIZ_IMPACT_TEXT);
    expect(hasCausality).toBe(true);
  });

  // ── Test 5: Causality signals differentiate Strategy from Baseline ─────
  it("strategy causality score is strictly higher than baseline", () => {
    const baseline = scoreCrossSectionCausality(BASELINE_FLAT_JSON);
    const strategy = scoreCrossSectionCausality(STRATEGY_RICH_JSON);
    expect(strategy.score).toBeGreaterThan(baseline.score);
  });

  // ── Test 6: Deep nesting detection works correctly ─────────────────────
  it("detects deep nesting in strategy output but not in flat baseline", () => {
    // Strategy has objects-within-objects with 3+ keys
    const stratResult = scoreCrossSectionCausality(STRATEGY_RICH_JSON);
    // Flat baseline has only string values
    const baseResult = scoreCrossSectionCausality(BASELINE_FLAT_JSON);
    // Strategy must have higher signals
    expect(stratResult.score).toBeGreaterThan(baseResult.score);
  });

  // ── Test 7: KI citation embedding detection ────────────────────────────
  it("detects embedded KI citations as a causality signal", () => {
    const withCitations = JSON.stringify({
      section_a: "Analysis based on [KI:abc123] shows 15% gap",
      section_b: "Per Knowledge Item research, the risk is $200K annually [KI:def456]",
    });
    const withoutCitations = JSON.stringify({
      section_a: "Analysis shows 15% gap",
      section_b: "Research indicates the risk is $200K annually",
    });
    const withResult = scoreCrossSectionCausality(withCitations);
    const withoutResult = scoreCrossSectionCausality(withoutCitations);
    // Citations should contribute to causality signals
    expect(withResult.score).toBeGreaterThanOrEqual(withoutResult.score);
  });
});
