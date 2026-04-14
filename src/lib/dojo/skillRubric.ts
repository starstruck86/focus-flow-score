/**
 * Canonical Skill Rubric Map — SINGLE source of truth for all skills.
 * Used by: Skill Builder, Dojo scoring, retry feedback, next-step recommendations.
 * Do NOT duplicate dimension definitions elsewhere.
 */

export interface DimensionDef {
  key: string;
  label: string;
  description: string;
  weight: number; // percentage of total score this dimension represents
  bad: string;
  good: string;
  elite: string;
  pointLiftCue: string; // concrete action to improve this dimension
}

export interface SkillRubric {
  skill: string;
  label: string;
  dimensions: DimensionDef[];
  commonFailures: string[];
  retryableDimensions: string[]; // dimensions most likely to improve on retry
  levelExpectations: {
    developing: string; // score < 55
    competent: string;  // 55-69
    strong: string;     // 70-84
    elite: string;      // 85+
  };
}

export const SKILL_RUBRICS: Record<string, SkillRubric> = {
  executive_response: {
    skill: 'executive_response',
    label: 'Executive Response',
    dimensions: [
      {
        key: 'brevity',
        label: 'Brevity',
        description: 'Response deliverable in under 30 seconds',
        weight: 25,
        bad: '4+ sentences, opens with setup or context',
        good: '3 sentences, gets to value quickly',
        elite: '≤2 sentences, no setup, outcome-first',
        pointLiftCue: 'Delete your first sentence entirely — start with the second',
      },
      {
        key: 'numberLed',
        label: 'Number-Led Opening',
        description: 'First sentence contains a metric, dollar amount, or quantified outcome',
        weight: 25,
        bad: '"We help companies..." or no number anywhere',
        good: 'Number appears but not in the opening',
        elite: 'First 3 words include a dollar figure or metric',
        pointLiftCue: 'Your first three words must be a dollar amount or percentage',
      },
      {
        key: 'priorityAnchoring',
        label: 'Priority Anchoring',
        description: "Anchored to the exec's stated priority, not the rep's pitch",
        weight: 25,
        bad: 'Pitched product value without referencing exec priority',
        good: 'Referenced exec priority but loosely',
        elite: "First sentence explicitly names the exec's goal",
        pointLiftCue: "Name the exec's specific initiative in your first sentence",
      },
      {
        key: 'executivePresence',
        label: 'Executive Presence',
        description: 'Projected certainty with zero hedging',
        weight: 25,
        bad: '"I think," "we believe," "potentially" — sounds uncertain',
        good: 'Mostly confident but occasional qualifiers',
        elite: 'States outcomes as facts with proof, zero hedging',
        pointLiftCue: 'Remove every instance of "I think," "we believe," or "potentially"',
      },
    ],
    commonFailures: ['too_long', 'no_business_impact', 'too_generic', 'vendor_language'],
    retryableDimensions: ['brevity', 'numberLed'],
    levelExpectations: {
      developing: 'Opens with setup, no numbers, generic pitch',
      competent: 'Gets to value but takes too long, some hedging',
      strong: 'Concise with numbers, anchors to priority',
      elite: '≤2 sentences, number-led, zero hedging, clear ask',
    },
  },

  objection_handling: {
    skill: 'objection_handling',
    label: 'Objection Handling',
    dimensions: [
      {
        key: 'composure',
        label: 'Composure',
        description: 'Stayed calm and concise under pressure',
        weight: 15,
        bad: 'Defensive, argumentative, or rambling',
        good: 'Calm but slightly thrown off',
        elite: 'Unfazed, pauses before responding, controlled',
        pointLiftCue: 'Pause. Your first words should acknowledge, not argue',
      },
      {
        key: 'isolation',
        label: 'Objection Isolation',
        description: 'Surfaced the real concern behind the stated objection',
        weight: 25,
        bad: 'Answered the surface objection without probing',
        good: 'Asked a follow-up but didn\'t fully isolate',
        elite: 'Asked one targeted question that revealed the real blocker',
        pointLiftCue: 'Ask "What specifically concerns you about that?" before responding',
      },
      {
        key: 'reframing',
        label: 'Reframing',
        description: 'Shifted from feature/cost to business value or risk',
        weight: 25,
        bad: 'Stayed at feature level or argued on price',
        good: 'Attempted reframe but didn\'t connect to business impact',
        elite: 'Shifted to cost of inaction or strategic value smoothly',
        pointLiftCue: 'Replace your product pitch with the cost of NOT solving this',
      },
      {
        key: 'proof',
        label: 'Proof Deployment',
        description: 'Used a specific proof point — customer, metric, or benchmark',
        weight: 15,
        bad: 'Generic claims: "best in class," "proven"',
        good: 'Mentioned a customer but no specific metric',
        elite: 'Named a customer + specific metric + timeframe',
        pointLiftCue: 'Include one customer name and one specific number',
      },
      {
        key: 'commitmentControl',
        label: 'Commitment Control',
        description: 'Maintained control and proposed a concrete next step',
        weight: 20,
        bad: 'Ended without an ask or let buyer dictate next steps',
        good: 'Proposed a next step but vague ("let\'s reconnect")',
        elite: 'Specific, time-bound ask with clear mutual action',
        pointLiftCue: 'End with a specific date and action, not "let\'s connect"',
      },
    ],
    commonFailures: ['pitched_too_early', 'weak_objection_handle', 'reactive_not_reframing', 'no_business_impact'],
    retryableDimensions: ['isolation', 'reframing', 'commitmentControl'],
    levelExpectations: {
      developing: 'Counter-punches, argues, or immediately pitches',
      competent: 'Acknowledges but doesn\'t fully isolate or reframe',
      strong: 'Isolates, reframes to value, includes proof',
      elite: 'Acknowledge → Isolate → Reframe → Evidence → Advance, seamless',
    },
  },

  discovery: {
    skill: 'discovery',
    label: 'Discovery',
    dimensions: [
      {
        key: 'questionArchitecture',
        label: 'Question Architecture',
        description: 'Singular, open, non-leading questions',
        weight: 15,
        bad: 'Stacked 2-3 questions, closed or leading',
        good: 'Single question but somewhat scripted',
        elite: 'One sharp, open question that builds on what buyer said',
        pointLiftCue: 'Ask exactly one question per turn — no stacking',
      },
      {
        key: 'painExcavation',
        label: 'Pain Excavation',
        description: 'Went past surface answers to real pain',
        weight: 25,
        bad: 'Accepted "it\'s fine" or "we\'re exploring" at face value',
        good: 'Asked one follow-up but didn\'t push to consequence',
        elite: 'Pushed to "what happens if you don\'t fix this" and got a real answer',
        pointLiftCue: 'After the buyer answers, ask "what does that cost you?"',
      },
      {
        key: 'painQuantification',
        label: 'Pain Quantification',
        description: 'Attached numbers, costs, or timelines to the pain',
        weight: 15,
        bad: 'No attempt to quantify — kept it abstract',
        good: 'Asked about scale but didn\'t get a number',
        elite: 'Got the buyer to name a dollar amount, percentage, or timeline',
        pointLiftCue: 'Your follow-up must contain "revenue," "cost," or "risk"',
      },
      {
        key: 'businessImpact',
        label: 'Business Impact',
        description: 'Connected problem to revenue, cost, or competitive risk',
        weight: 20,
        bad: 'Stayed at operational level — never connected to business',
        good: 'Mentioned business impact but didn\'t make buyer feel it',
        elite: 'Made the buyer articulate the business consequence themselves',
        pointLiftCue: 'Connect the problem to how it affects their P&L or market position',
      },
      {
        key: 'urgencyTesting',
        label: 'Urgency Testing',
        description: 'Tested for trigger events, timelines, or catalysts',
        weight: 15,
        bad: 'Never tested why now — assumed interest = urgency',
        good: 'Asked about timeline but accepted vague answer',
        elite: 'Surfaced a trigger event or created urgency through consequence',
        pointLiftCue: 'Ask "What happens if you don\'t solve this by Q4?"',
      },
      {
        key: 'stakeholderDiscovery',
        label: 'Stakeholder Discovery',
        description: 'Identified other decision-makers or influencers',
        weight: 10,
        bad: 'Never asked who else is involved',
        good: 'Asked about stakeholders but superficially',
        elite: 'Mapped decision process and identified champion/blocker',
        pointLiftCue: 'Ask "Who else would need to weigh in on this?"',
      },
    ],
    commonFailures: ['stacked_questions', 'failed_to_deepen', 'no_business_impact', 'too_generic'],
    retryableDimensions: ['painExcavation', 'painQuantification', 'questionArchitecture'],
    levelExpectations: {
      developing: 'Stacks questions, accepts surface answers, no quantification',
      competent: 'Asks follow-ups but stays at operational level',
      strong: 'Pushes to business impact, quantifies, single-threads',
      elite: 'Makes the buyer articulate their own pain and urgency',
    },
  },

  deal_control: {
    skill: 'deal_control',
    label: 'Deal Control',
    dimensions: [
      {
        key: 'nextStepControl',
        label: 'Next Step Control',
        description: 'Proposed a specific, time-bound next step',
        weight: 30,
        bad: '"Let me know" or "we\'ll reconnect soon"',
        good: 'Proposed a next step but no specific date',
        elite: 'Specific action + date + named owner',
        pointLiftCue: 'End with "Let\'s schedule [action] for [specific date]"',
      },
      {
        key: 'riskNaming',
        label: 'Risk Naming',
        description: 'Called out deal drift or missing stakeholders directly',
        weight: 25,
        bad: 'Ignored signals of stalling or risk',
        good: 'Hinted at risk but didn\'t name it directly',
        elite: 'Named the risk explicitly and proposed mitigation',
        pointLiftCue: 'Name the specific risk: "I\'m concerned that without [X], this stalls"',
      },
      {
        key: 'mutualPlan',
        label: 'Mutual Plan',
        description: 'Defined mutual commitments — what both sides do by when',
        weight: 25,
        bad: 'Only defined what the rep will do, not the buyer',
        good: 'Asked buyer for commitment but didn\'t lock specifics',
        elite: 'Both sides have clear actions with deadlines',
        pointLiftCue: 'Define what the BUYER commits to, not just what you\'ll do',
      },
      {
        key: 'stakeholderAlignment',
        label: 'Stakeholder Alignment',
        description: 'Ensured alignment across stakeholders or created urgency',
        weight: 20,
        bad: 'Ignored missing stakeholders or competing priorities',
        good: 'Acknowledged stakeholders but didn\'t act on it',
        elite: 'Proposed a multi-stakeholder meeting or alignment step',
        pointLiftCue: 'Ask "Can we include [decision-maker] in the next conversation?"',
      },
    ],
    commonFailures: ['lack_of_control', 'weak_close', 'vague_next_step', 'too_passive', 'accepted_delay'],
    retryableDimensions: ['nextStepControl', 'riskNaming', 'mutualPlan'],
    levelExpectations: {
      developing: 'Accepts delays, vague next steps, no mutual commitment',
      competent: 'Proposes next steps but doesn\'t lock dates or buyer actions',
      strong: 'Names risks, locks specific actions, pushes for commitment',
      elite: 'Mutual plan with dates, named risks, stakeholder alignment',
    },
  },

  qualification: {
    skill: 'qualification',
    label: 'Qualification',
    dimensions: [
      {
        key: 'painValidation',
        label: 'Pain Validation',
        description: 'Distinguished genuine business pain from casual interest',
        weight: 30,
        bad: 'Accepted "we\'re interested" or "sounds cool" as pain',
        good: 'Asked about pain but accepted vague answer',
        elite: 'Made buyer articulate consequence of not solving',
        pointLiftCue: 'Ask "What happens if you don\'t fix this in the next 90 days?"',
      },
      {
        key: 'stakeholderMapping',
        label: 'Stakeholder Mapping',
        description: 'Identified who decides and their roles',
        weight: 20,
        bad: 'Never asked about other stakeholders',
        good: 'Asked who\'s involved but superficially',
        elite: 'Identified champion, blocker, and decision process',
        pointLiftCue: 'Ask "Who else would need to sign off, and what do they care about?"',
      },
      {
        key: 'decisionProcess',
        label: 'Decision Process',
        description: 'Tested for timeline, criteria, and process',
        weight: 25,
        bad: 'No process questions — assumed buyer would figure it out',
        good: 'Asked about timeline but accepted "not sure"',
        elite: 'Mapped evaluation criteria, timeline, and approval steps',
        pointLiftCue: 'Ask "Walk me through how a decision like this gets approved"',
      },
      {
        key: 'disqualification',
        label: 'Disqualification Discipline',
        description: 'Willingness to disqualify or challenge weak opportunities',
        weight: 25,
        bad: 'Kept selling despite red flags',
        good: 'Noticed red flags but didn\'t act on them',
        elite: 'Challenged buyer respectfully: "I want to make sure we\'re both investing time wisely"',
        pointLiftCue: 'Ask one question that could kill the deal — test if it survives',
      },
    ],
    commonFailures: ['failed_to_qualify', 'accepted_weak_pain', 'no_urgency', 'skipped_stakeholders', 'no_disqualification'],
    retryableDimensions: ['painValidation', 'disqualification', 'decisionProcess'],
    levelExpectations: {
      developing: 'Sells to everyone, accepts enthusiasm as qualification',
      competent: 'Asks some qualifying questions but doesn\'t push hard',
      strong: 'Tests pain, maps stakeholders, checks urgency',
      elite: 'Willing to disqualify, rigorous process mapping, protects pipeline quality',
    },
  },
};

/**
 * Rich dimension detail returned from scoring edge function.
 */
export interface DimensionScoreDetail {
  score: number;
  reason: string;
  evidence: string;
  improvementAction: string;
  targetFor7: string;
  targetFor9: string;
}

/**
 * Normalize dimensions — supports both legacy Record<string, number>
 * and rich Record<string, DimensionScoreDetail> formats.
 */
export function normalizeDimensionScores(
  dimensions: Record<string, unknown> | null | undefined,
): Record<string, DimensionScoreDetail> | null {
  if (!dimensions) return null;
  const result: Record<string, DimensionScoreDetail> = {};
  for (const [key, val] of Object.entries(dimensions)) {
    if (typeof val === 'number') {
      result[key] = { score: val, reason: '', evidence: '', improvementAction: '', targetFor7: '', targetFor9: '' };
    } else if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>;
      result[key] = {
        score: typeof v.score === 'number' ? v.score : 5,
        reason: typeof v.reason === 'string' ? v.reason : '',
        evidence: typeof v.evidence === 'string' ? v.evidence : '',
        improvementAction: typeof v.improvementAction === 'string' ? v.improvementAction : '',
        targetFor7: typeof v.targetFor7 === 'string' ? v.targetFor7 : '',
        targetFor9: typeof v.targetFor9 === 'string' ? v.targetFor9 : '',
      };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Get the rubric for a skill, with fallback.
 */
export function getSkillRubric(skill: string): SkillRubric | null {
  return SKILL_RUBRICS[skill] ?? null;
}

/**
 * Given dimension scores (rich or simple), compute point-lift suggestions.
 * Returns concrete actions sorted by likely impact.
 */
export interface PointLiftSuggestion {
  dimension: string;
  dimensionLabel: string;
  earned: number;
  max: number;
  action: string;
  evidence: string;      // what in the rep's answer triggered this
  estimatedLift: [number, number]; // [min, max] point range
}

export function computePointLiftSuggestions(
  dimensions: Record<string, unknown> | null | undefined,
  skill: string,
): PointLiftSuggestion[] {
  if (!dimensions) return [];
  const rubric = SKILL_RUBRICS[skill];
  if (!rubric) return [];
  const normalized = normalizeDimensionScores(dimensions);
  if (!normalized) return [];

  const suggestions: PointLiftSuggestion[] = [];

  for (const dim of rubric.dimensions) {
    const detail = normalized[dim.key];
    const earned = detail?.score ?? 5;
    if (earned >= 8) continue; // already strong

    const gap = 10 - earned;
    const maxLift = Math.round((gap / 10) * dim.weight);
    const minLift = Math.max(1, Math.round(maxLift * 0.5));

    // Prefer rep-specific action from AI, fall back to rubric cue
    const action = detail?.improvementAction || dim.pointLiftCue;
    const evidence = detail?.evidence || '';

    suggestions.push({
      dimension: dim.key,
      dimensionLabel: dim.label,
      earned,
      max: 10,
      action,
      evidence,
      estimatedLift: [minLift, maxLift],
    });
  }

  suggestions.sort((a, b) => b.estimatedLift[1] - a.estimatedLift[1]);
  return suggestions.slice(0, 3);
}

/**
 * Find the biggest scoring drag (lowest dimension relative to weight).
 */
export interface BiggestMiss {
  dimension: string;
  dimensionLabel: string;
  score: number;
  weight: number;
  reason: string;
  evidence: string;
  fix: string;
}

export function findBiggestMiss(
  dimensions: Record<string, unknown> | null | undefined,
  skill: string,
): BiggestMiss | null {
  if (!dimensions) return null;
  const rubric = SKILL_RUBRICS[skill];
  if (!rubric) return null;
  const normalized = normalizeDimensionScores(dimensions);
  if (!normalized) return null;

  let worst: { dim: DimensionDef; detail: DimensionScoreDetail; weightedGap: number } | null = null;

  for (const dim of rubric.dimensions) {
    const detail = normalized[dim.key];
    const score = detail?.score ?? 5;
    const weightedGap = (10 - score) * dim.weight;
    if (!worst || weightedGap > worst.weightedGap) {
      worst = { dim, detail: detail || { score: 5, reason: '', evidence: '', improvementAction: '', targetFor7: '', targetFor9: '' }, weightedGap };
    }
  }

  if (!worst || worst.detail.score >= 8) return null;

  return {
    dimension: worst.dim.key,
    dimensionLabel: worst.dim.label,
    score: worst.detail.score,
    weight: worst.dim.weight,
    reason: worst.detail.reason || worst.dim.bad,
    evidence: worst.detail.evidence || '',
    fix: worst.detail.improvementAction || worst.dim.pointLiftCue,
  };
}
