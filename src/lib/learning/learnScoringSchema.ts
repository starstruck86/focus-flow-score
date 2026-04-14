/**
 * Structured Scoring Schema
 *
 * Defines per-skill scoring dimensions that the Dojo scoring prompt MUST return.
 * Each dimension maps 1:1 to a sub-skill, enabling grounded progression tracking.
 *
 * All dimensions are scored 0–10 by the AI, normalized to 0–100 downstream.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

// ── Dimension keys per skill ──────────────────────────────────────

export interface DiscoveryDimensions {
  questionArchitecture: number;
  painExcavation: number;
  painQuantification: number;
  businessImpact: number;
  urgencyTesting: number;
  stakeholderDiscovery: number;
}

export interface ObjectionHandlingDimensions {
  composure: number;
  isolation: number;
  reframing: number;
  proof: number;
  commitmentControl: number;
}

export interface DealControlDimensions {
  nextStepControl: number;
  riskNaming: number;
  mutualPlan: number;
  stakeholderAlignment: number;
}

export interface ExecutiveResponseDimensions {
  brevity: number;
  numberLed: number;
  priorityAnchoring: number;
  executivePresence: number;
}

export interface QualificationDimensions {
  painValidation: number;
  stakeholderMapping: number;
  decisionProcess: number;
  disqualification: number;
}

export type SkillDimensions =
  | DiscoveryDimensions
  | ObjectionHandlingDimensions
  | DealControlDimensions
  | ExecutiveResponseDimensions
  | QualificationDimensions;

// ── Dimension keys registry ───────────────────────────────────────

export const SKILL_DIMENSION_KEYS: Record<SkillFocus, string[]> = {
  discovery: ['questionArchitecture', 'painExcavation', 'painQuantification', 'businessImpact', 'urgencyTesting', 'stakeholderDiscovery'],
  objection_handling: ['composure', 'isolation', 'reframing', 'proof', 'commitmentControl'],
  deal_control: ['nextStepControl', 'riskNaming', 'mutualPlan', 'stakeholderAlignment'],
  executive_response: ['brevity', 'numberLed', 'priorityAnchoring', 'executivePresence'],
  qualification: ['painValidation', 'stakeholderMapping', 'decisionProcess', 'disqualification'],
};

// ── Human-readable labels ─────────────────────────────────────────

export const DIMENSION_LABELS: Record<string, string> = {
  questionArchitecture: 'Question Architecture',
  painExcavation: 'Pain Excavation',
  painQuantification: 'Pain Quantification',
  businessImpact: 'Business Impact',
  urgencyTesting: 'Urgency Testing',
  stakeholderDiscovery: 'Stakeholder Discovery',
  composure: 'Composure',
  isolation: 'Isolation',
  reframing: 'Reframing',
  proof: 'Proof Deployment',
  commitmentControl: 'Commitment Control',
  nextStepControl: 'Next Step Control',
  riskNaming: 'Risk Naming',
  mutualPlan: 'Mutual Plan',
  stakeholderAlignment: 'Stakeholder Alignment',
  brevity: 'Brevity',
  numberLed: 'Number-Led',
  priorityAnchoring: 'Priority Anchoring',
  executivePresence: 'Executive Presence',
  painValidation: 'Pain Validation',
  stakeholderMapping: 'Stakeholder Mapping',
  decisionProcess: 'Decision Process',
  disqualification: 'Disqualification',
};

// ── Dimension ↔ Sub-skill mapping ─────────────────────────────────

export const DIMENSION_TO_SUBSKILL: Record<string, string> = {
  // Discovery
  questionArchitecture: 'Pain Excavation',
  painExcavation: 'Depth Creation',
  painQuantification: 'Depth Creation',
  businessImpact: 'Business Impact Mapping',
  urgencyTesting: 'Urgency Testing',
  stakeholderDiscovery: 'Stakeholder Discovery',
  // Objection Handling
  composure: 'Containment',
  isolation: 'Containment',
  reframing: 'Reframing',
  proof: 'Proof Deployment',
  commitmentControl: 'Commitment Recovery',
  // Deal Control
  nextStepControl: 'Next Step Discipline',
  riskNaming: 'Risk Naming',
  mutualPlan: 'Mutual Action Planning',
  stakeholderAlignment: 'Urgency Creation',
  // Executive Response
  brevity: 'Brevity Under Pressure',
  numberLed: 'Number-Led Communication',
  priorityAnchoring: 'Executive Anchoring',
  executivePresence: 'Composure and Certainty',
  // Qualification
  painValidation: 'Pain Validation',
  stakeholderMapping: 'Stakeholder Mapping',
  decisionProcess: 'Pipeline Discipline',
  disqualification: 'Pipeline Discipline',
};

// ── Prompt fragment generator ─────────────────────────────────────

const DIMENSION_DESCRIPTIONS: Record<SkillFocus, Record<string, string>> = {
  discovery: {
    questionArchitecture: 'Quality of question construction — singular, open, non-leading',
    painExcavation: 'Depth of pain exploration — went past surface answers',
    painQuantification: 'Attached numbers, costs, or timelines to the pain',
    businessImpact: 'Connected the problem to revenue, cost, or competitive risk',
    urgencyTesting: 'Tested for trigger events, timelines, or catalysts for action',
    stakeholderDiscovery: 'Identified other decision-makers or influencers',
  },
  objection_handling: {
    composure: 'Stayed calm and concise — no rambling or defensive reaction',
    isolation: 'Surfaced the real concern behind the stated objection',
    reframing: 'Shifted from feature/cost to business value or risk',
    proof: 'Used a specific proof point — customer, metric, or benchmark',
    commitmentControl: 'Maintained control and proposed a concrete next step',
  },
  deal_control: {
    nextStepControl: 'Proposed a specific, time-bound next step',
    riskNaming: 'Called out deal drift, stalling, or missing stakeholders directly',
    mutualPlan: 'Defined mutual commitments — what both sides will do by when',
    stakeholderAlignment: 'Ensured alignment across multiple stakeholders or created urgency',
  },
  executive_response: {
    brevity: 'Response deliverable in under 30 seconds. ≤2 sentences = elite (9-10). 3 sentences = competent (5-6). 4+ sentences = fail (0-2). Setup sentence before the answer = 0.',
    numberLed: 'First sentence contains a specific metric, dollar amount, or quantified outcome. "We help companies..." = 0-1. Generic claim without a number = 2-3. Specific dollar figure in opening clause = 8-10.',
    priorityAnchoring: 'Anchored to the exec\'s stated priority, not own agenda. If exec named a specific goal and rep didn\'t reference it = 0-2. Referenced but loosely = 4-5. First sentence connects directly = 8-10.',
    executivePresence: 'Projected certainty and confidence. "I think" / "we believe" / "potentially" = cap at 4. States outcomes as facts with proof = 8-10. Zero hedging + specific proof point = 9-10.',
  },
  qualification: {
    painValidation: 'Distinguished genuine business pain from casual interest',
    stakeholderMapping: 'Identified other decision-makers and their roles',
    decisionProcess: 'Tested for timeline, process, and decision criteria',
    disqualification: 'Willingness to disqualify or challenge weak opportunities',
  },
};

/**
 * Returns the prompt fragment instructing the AI to score structured dimensions.
 */
export function getDimensionPromptBlock(skill: SkillFocus): string {
  const dims = DIMENSION_DESCRIPTIONS[skill];
  if (!dims) return '';

  const entries = Object.entries(dims)
    .map(([key, desc]) => `    "${key}": 0-10  // ${desc}`)
    .join(',\n');

  return `
STRUCTURED SCORING (REQUIRED):
You MUST return a "dimensions" object scoring each dimension 0-10 for this skill.
Only score dimensions listed below. Do NOT invent new ones.

  "dimensions": {
${entries}
  }

Scoring guide for dimensions:
- 0-2: Not present or actively harmful
- 3-4: Attempted but weak or ineffective  
- 5-6: Competent but not impressive
- 7-8: Genuinely strong execution
- 9-10: Elite — would impress a VP of Sales`;
}

// ── Parse + validate dimensions from AI response ──────────────────

export function parseDimensions(
  raw: Record<string, unknown> | null | undefined,
  skill: SkillFocus,
): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;

  const validKeys = new Set(SKILL_DIMENSION_KEYS[skill]);
  const result: Record<string, number> = {};
  let found = 0;

  for (const [key, val] of Object.entries(raw)) {
    if (validKeys.has(key) && typeof val === 'number') {
      result[key] = Math.max(0, Math.min(10, Math.round(val)));
      found++;
    }
  }

  // Require at least half the dimensions to consider it valid
  if (found < Math.ceil(validKeys.size / 2)) return null;

  // Fill missing with conservative default
  for (const key of validKeys) {
    if (!(key in result)) result[key] = 5;
  }

  return result;
}
