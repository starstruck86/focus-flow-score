/**
 * Canonical Lever Selection Config — SINGLE source of truth.
 * Used by: client (skillRubric.ts) AND server (dojo-score edge function).
 * Do NOT duplicate these constants elsewhere.
 */

/**
 * Strategic priority order per skill — which dimensions matter most for coaching,
 * independent of score. Ordered from most strategically important to least.
 */
export const STRATEGIC_PRIORITY: Record<string, string[]> = {
  executive_response: ['numberLed', 'brevity', 'priorityAnchoring', 'executivePresence'],
  objection_handling: ['isolation', 'reframing', 'commitmentControl', 'proof', 'composure'],
  discovery: ['painExcavation', 'businessImpact', 'questionArchitecture', 'painQuantification', 'urgencyTesting', 'stakeholderDiscovery'],
  deal_control: ['nextStepControl', 'riskNaming', 'mutualPlan', 'stakeholderAlignment'],
  qualification: ['painValidation', 'disqualification', 'decisionProcess', 'stakeholderMapping'],
};

/**
 * Dimensions that affect the OPENING of the answer — higher coaching leverage
 * because they shape the entire response trajectory.
 */
export const OPENING_DIMENSIONS: Set<string> = new Set([
  'numberLed', 'brevity', 'composure', 'questionArchitecture', 'painValidation', 'nextStepControl',
]);

/**
 * Dimension weights per skill — mirrors the rubric definitions.
 * Must stay in sync with SKILL_RUBRICS in skillRubric.ts.
 */
export const DIMENSION_WEIGHTS: Record<string, Record<string, number>> = {
  executive_response: { brevity: 25, numberLed: 25, priorityAnchoring: 25, executivePresence: 25 },
  objection_handling: { composure: 15, isolation: 25, reframing: 25, proof: 15, commitmentControl: 20 },
  discovery: { questionArchitecture: 15, painExcavation: 25, painQuantification: 15, businessImpact: 20, urgencyTesting: 15, stakeholderDiscovery: 10 },
  deal_control: { nextStepControl: 30, riskNaming: 25, mutualPlan: 25, stakeholderAlignment: 20 },
  qualification: { painValidation: 30, stakeholderMapping: 20, decisionProcess: 25, disqualification: 25 },
};

/**
 * Lever selection tuning constants.
 * 
 * Calibration philosophy:
 * - strategicMaxBonus: capped contribution from strategic priority.
 *   Scaled so it can nudge close decisions but NOT override a severely broken dimension.
 * - openingMaxBonus: capped contribution for opening-shaping dimensions.
 * - bonusActivationThreshold: bonus only applies at full strength when score ≤ this.
 *   Above this, bonus scales down linearly. Prevents a mildly weak strategic
 *   dimension from always beating a severely broken non-strategic one.
 * - severeMissThreshold: score at or below this is considered a severe miss.
 *   Severe misses get a multiplier on weightedGap to resist being overridden.
 */
export const LEVER_TUNING = {
  strategicMaxBonus: 35,      // down from 50 — less aggressive
  openingMaxBonus: 20,        // down from 30 — less aggressive
  bonusActivationThreshold: 6, // bonuses scale to 0 as score approaches 8
  severeMissMultiplier: 1.3,   // severe misses (score ≤ 3) get 30% boost to weightedGap
  severeMissThreshold: 3,
};

/**
 * Coach-like explanations for WHY a dimension was chosen as the primary lever.
 * Used in user-facing UI. Keyed by dimension key.
 */
export const COACHING_WHY_EXPLANATIONS: Record<string, string> = {
  // Executive Response
  numberLed: "This matters most because your first sentence determines whether the exec keeps listening. Without a number up front, everything after it lands weaker.",
  brevity: "This matters most because executives decide in seconds whether you're worth their time. Every extra sentence costs you credibility.",
  priorityAnchoring: "This matters most because if you're not anchored to what they care about, you're pitching — not advising.",
  executivePresence: "This matters most because hedging signals you don't believe your own message. Executives trust people who speak with certainty.",

  // Objection Handling
  isolation: "This matters most because without isolating the real objection, the rest of your answer is built on the wrong premise.",
  reframing: "This matters most because staying at feature level lets the buyer control the frame. You need to shift to business value.",
  commitmentControl: "This matters most because handling an objection without advancing the deal just means you'll face the same objection again.",
  proof: "This matters most because claims without evidence feel like sales talk. One specific example changes the entire conversation.",
  composure: "This matters most because if you sound rattled, the buyer trusts the objection more than your response.",

  // Discovery
  painExcavation: "This matters most because surface-level pain never creates urgency. You need to get to what it's actually costing them.",
  businessImpact: "This matters most because until the buyer feels the business consequence, they have no reason to act.",
  questionArchitecture: "This matters most because stacked or leading questions let the buyer dodge the hard answer. One sharp question forces honesty.",
  painQuantification: "This matters most because without a number attached to the pain, there's no urgency and no business case.",
  urgencyTesting: "This matters most because without a trigger event or deadline, this deal will drift indefinitely.",
  stakeholderDiscovery: "This matters most because you can't close a deal with someone who can't approve it.",

  // Deal Control
  nextStepControl: "This matters most because vague next steps are where deals go to die. If you don't own the calendar, you don't own the deal.",
  riskNaming: "This matters most because ignoring deal risk doesn't make it go away — it just means the deal stalls later when you have no leverage.",
  mutualPlan: "This matters most because one-sided commitments aren't plans — they're hopes. The buyer needs to commit to something too.",
  stakeholderAlignment: "This matters most because a deal with one champion and no alignment is a deal that dies in committee.",

  // Qualification
  painValidation: "This matters most because enthusiasm isn't qualification. Until you've confirmed real business pain, this isn't a deal — it's a conversation.",
  disqualification: "This matters most because the willingness to walk away is what separates pipeline quality from pipeline fiction.",
  decisionProcess: "This matters most because without understanding how they buy, you're guessing at every step. Map the process or lose to it.",
  stakeholderMapping: "This matters most because the person you're talking to might love you — but they might not be the person who signs.",
};

/**
 * Compute primary coaching lever using the canonical config.
 * Used by both client and server. Pure function — no side effects.
 */
export interface LeverCandidate {
  key: string;
  score: number;
  weight: number;
  weightedGap: number;
  strategicBonus: number;
  openingBonus: number;
  leverScore: number;
}

export interface LeverSelectionResult {
  primaryLever: string;
  primaryLeverScore: number;
  weakestDimension: string;
  weakestDimensionScore: number;
  biggestWeightedDrag: string;
  leverDiffersFromWeakest: boolean;
  whyChosen: string;         // technical (debug)
  whyChosenCoaching: string; // user-facing (coach-like)
  candidates: LeverCandidate[];
}

export function computeLeverSelection(
  dimensionScores: Record<string, number>,
  skill: string,
): LeverSelectionResult | null {
  const weights = DIMENSION_WEIGHTS[skill];
  const priorities = STRATEGIC_PRIORITY[skill];
  if (!weights || !priorities) return null;

  const { strategicMaxBonus, openingMaxBonus, bonusActivationThreshold, severeMissMultiplier, severeMissThreshold } = LEVER_TUNING;

  const candidates: LeverCandidate[] = [];
  let weakest = { key: '', score: 11 };
  let biggestDrag = { key: '', gap: -1 };

  for (const [key, weight] of Object.entries(weights)) {
    const score = dimensionScores[key] ?? 5;

    if (score < weakest.score) weakest = { key, score };

    let weightedGap = (10 - score) * weight;

    // Severe miss amplification: scores ≤ threshold get a multiplier
    if (score <= severeMissThreshold) {
      weightedGap *= severeMissMultiplier;
    }

    if (weightedGap > biggestDrag.gap) biggestDrag = { key, gap: weightedGap };

    if (score >= 8) continue; // skip strong dimensions for lever candidacy

    // Strategic bonus: scales down as score approaches 8
    const priorityIndex = priorities.indexOf(key);
    let strategicBonus = 0;
    if (priorityIndex >= 0) {
      const rawBonus = (priorities.length - priorityIndex) / priorities.length * strategicMaxBonus;
      // Scale bonus: full at score ≤ bonusActivationThreshold, zero at score ≥ 8
      const bonusScale = Math.max(0, Math.min(1, (bonusActivationThreshold - score + 2) / (bonusActivationThreshold - 2)));
      strategicBonus = rawBonus * bonusScale;
    }

    // Opening bonus: same scaling
    let openingBonus = 0;
    if (OPENING_DIMENSIONS.has(key)) {
      const bonusScale = Math.max(0, Math.min(1, (bonusActivationThreshold - score + 2) / (bonusActivationThreshold - 2)));
      openingBonus = openingMaxBonus * bonusScale;
    }

    const leverScore = weightedGap + strategicBonus + openingBonus;
    candidates.push({ key, score, weight, weightedGap, strategicBonus, openingBonus, leverScore });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.leverScore - a.leverScore);
  const winner = candidates[0];

  // Technical explanation (debug)
  const parts: string[] = [];
  if (winner.strategicBonus > 5) parts.push(`strategic priority for ${skill}`);
  if (winner.openingBonus > 5) parts.push('opening-shaping');
  if (winner.key === biggestDrag.key) parts.push('biggest weighted drag');
  if (winner.score <= severeMissThreshold) parts.push('severe miss');
  const whyChosen = parts.length > 0
    ? `${winner.key}: ${parts.join(', ')} (leverScore=${winner.leverScore.toFixed(1)})`
    : `${winner.key}: highest combined leverage (${winner.leverScore.toFixed(1)})`;

  // Coach-like explanation (user-facing)
  const whyChosenCoaching = COACHING_WHY_EXPLANATIONS[winner.key]
    || `Fixing ${winner.key} will have the biggest impact on your next rep.`;

  return {
    primaryLever: winner.key,
    primaryLeverScore: winner.score,
    weakestDimension: weakest.key,
    weakestDimensionScore: weakest.score,
    biggestWeightedDrag: biggestDrag.key,
    leverDiffersFromWeakest: winner.key !== weakest.key,
    whyChosen,
    whyChosenCoaching,
    candidates,
  };
}
