/**
 * Skill Level System — Progression Definitions
 *
 * Defines 3–5 levels per skill with patterns, sub-skills, behaviors,
 * common failures, and elite benchmarks.
 * Levels reflect real ability, not content completion.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

// ── Types ──────────────────────────────────────────────────────────

export interface SkillLevel {
  level: number;
  name: string;
  description: string;
  /** Focus patterns the user should demonstrate at this level */
  requiredPatterns: string[];
  /** Sub-skills activated at this level */
  subSkills: string[];
  /** What changes when the user reaches this level */
  whatChanges: string;
  /** Common failures users exhibit at this level */
  commonFailures: string[];
  /** What elite performance looks like at this level */
  eliteBehavior: string;
}

export interface SkillLevelDefinition {
  skill: SkillFocus;
  label: string;
  levels: SkillLevel[];
}

// ── Discovery ─────────────────────────────────────────────────────

const DISCOVERY_LEVELS: SkillLevel[] = [
  {
    level: 1,
    name: 'Surface Listener',
    description: 'Ask singular questions. Don\'t stack. Let the buyer talk.',
    requiredPatterns: ['ask_singular_questions', 'deepen_one_level'],
    subSkills: ['Pain Excavation'],
    whatChanges: 'You stop interrogating and start listening. Questions become singular instead of stacked.',
    commonFailures: [
      'Stacking 2–3 questions in one breath',
      'Jumping to solution after the first answer',
      'Talking more than the buyer',
    ],
    eliteBehavior: 'Asks one question, then goes silent. Lets the buyer fill the space.',
  },
  {
    level: 2,
    name: 'Depth Creator',
    description: 'When the buyer gives a surface answer, push for cost and consequence.',
    requiredPatterns: ['deepen_one_level', 'quantify_the_pain'],
    subSkills: ['Pain Excavation', 'Depth Creation'],
    whatChanges: 'You stop accepting polished answers. You push past the first response into operational reality.',
    commonFailures: [
      'Accepting "we need better efficiency" without drilling into what that means',
      'Moving on when the buyer pauses (that pause is gold)',
      'Using your language instead of theirs',
    ],
    eliteBehavior: 'Treats every surface answer as an invitation to go one level deeper. Comfortable sitting in ambiguity.',
  },
  {
    level: 3,
    name: 'Business Connector',
    description: 'Connect every problem to revenue, cost, or competitive risk.',
    requiredPatterns: ['tie_to_business_impact', 'test_urgency'],
    subSkills: ['Business Impact Mapping', 'Urgency Testing'],
    whatChanges: 'Problems stop being complaints and start being funded projects. You connect pain to metrics and stakeholders.',
    commonFailures: [
      'Stopping at the team level without reaching the business metric',
      'Assuming you know which metric matters',
      'Leading the buyer with your own numbers instead of letting them calculate',
    ],
    eliteBehavior: 'Never leaves a discovery call without at least one quantified business impact stated by the buyer.',
  },
  {
    level: 4,
    name: 'Strategic Prober',
    description: 'Probe for timeline, trigger events, and urgency with precision. Map the full decision landscape.',
    requiredPatterns: ['test_urgency', 'quantify_the_pain', 'tie_to_business_impact'],
    subSkills: ['Urgency Testing', 'Business Impact Mapping', 'Depth Creation'],
    whatChanges: 'You triangulate revenue impact, risk, and timeline in a single conversation. Deals qualify themselves.',
    commonFailures: [
      'Running through urgency questions like a checklist',
      'Accepting vague timeline answers ("sometime next quarter")',
      'Not testing whether the trigger event is real or manufactured',
    ],
    eliteBehavior: 'The buyer names a specific event driving timeline. You hear exact dates, board meetings, or competitive deadlines — not vague intent.',
  },
];

// ── Objection Handling ────────────────────────────────────────────

const OBJECTION_HANDLING_LEVELS: SkillLevel[] = [
  {
    level: 1,
    name: 'Composure',
    description: 'Stay calm and concise when objections hit. Don\'t ramble or over-explain.',
    requiredPatterns: ['stay_concise_under_pressure', 'control_next_step'],
    subSkills: ['Emotional Control'],
    whatChanges: 'You stop flinching when pushback arrives. Responses become shorter, not longer.',
    commonFailures: [
      'Rambling when caught off guard',
      'Over-explaining the feature instead of addressing the concern',
      'Apologizing or hedging unnecessarily',
    ],
    eliteBehavior: 'Takes a beat, responds in 2–3 sentences, then redirects to the next step.',
  },
  {
    level: 2,
    name: 'Isolator',
    description: 'Surface the real concern before answering. Shift from feature/cost to impact.',
    requiredPatterns: ['isolate_before_answering', 'reframe_to_business_impact'],
    subSkills: ['Emotional Control', 'Pattern Recognition'],
    whatChanges: 'You stop answering the stated objection and start finding the real one. Reframes land because they address the actual concern.',
    commonFailures: [
      'Answering the surface objection without checking what\'s underneath',
      'Reframing too aggressively before earning the right',
      'Treating every objection as a price problem',
    ],
    eliteBehavior: 'Asks "Is it really about X, or is there something else behind this?" and waits for the real answer.',
  },
  {
    level: 3,
    name: 'Proof Anchor',
    description: 'Anchor responses with concrete proof and drive to commitment.',
    requiredPatterns: ['use_specific_proof', 'control_next_step'],
    subSkills: ['Pattern Recognition', 'Proof Deployment'],
    whatChanges: 'Objection responses include specific customer stories, metrics, or case studies. The buyer hears evidence, not promises.',
    commonFailures: [
      'Using generic proof ("many customers see results") instead of specific stories',
      'Deploying proof before isolating the real concern',
      'Failing to bridge from proof back to the next step',
    ],
    eliteBehavior: 'Names a specific customer, a specific metric, and a specific timeline — then asks for commitment.',
  },
  {
    level: 4,
    name: 'Objection Architect',
    description: 'Anticipate and preempt objections. Turn resistance into deal acceleration.',
    requiredPatterns: ['use_specific_proof', 'control_next_step', 'isolate_before_answering', 'reframe_to_business_impact'],
    subSkills: ['Pattern Recognition', 'Proof Deployment', 'Emotional Control'],
    whatChanges: 'You address objections before they\'re raised. When they do come, you use them as opportunities to deepen commitment.',
    commonFailures: [
      'Over-engineering preemptive objection handling into a monologue',
      'Missing the emotional signal behind a "new" objection that\'s really an old one repackaged',
      'Winning the argument but losing the relationship',
    ],
    eliteBehavior: 'The buyer feels heard, not handled. Objections become collaborative problem-solving moments.',
  },
];

// ── Deal Control ──────────────────────────────────────────────────

const DEAL_CONTROL_LEVELS: SkillLevel[] = [
  {
    level: 1,
    name: 'Next Step Owner',
    description: 'End every conversation with a clear, time-bound next step.',
    requiredPatterns: ['control_next_step', 'test_before_accepting'],
    subSkills: ['Process Control'],
    whatChanges: 'Conversations stop ending with "I\'ll follow up." Every call ends with a specific date, time, and attendee list.',
    commonFailures: [
      'Ending with "let me know" instead of proposing a next step',
      'Accepting vague commitments like "sometime next week"',
      'Not testing the buyer\'s commitment before ending the call',
    ],
    eliteBehavior: 'Says "Let\'s lock Tuesday at 2pm with your VP — I\'ll send the invite now" and does it before hanging up.',
  },
  {
    level: 2,
    name: 'Risk Namer',
    description: 'Call out deal drift, stalling, or missing stakeholders directly.',
    requiredPatterns: ['name_the_risk', 'create_urgency_without_pressure'],
    subSkills: ['Process Control', 'Risk Assessment'],
    whatChanges: 'You stop pretending everything is fine. Stalled deals get called out directly, with respect but without avoidance.',
    commonFailures: [
      'Avoiding uncomfortable conversations about deal health',
      'Creating artificial urgency that feels manipulative',
      'Naming risk without offering a path forward',
    ],
    eliteBehavior: '"I want to be direct — the last two meetings were rescheduled and your CFO hasn\'t engaged. What\'s really going on?"',
  },
  {
    level: 3,
    name: 'Mutual Planner',
    description: 'Define what both sides will do by when. Lock the deal mechanics.',
    requiredPatterns: ['lock_mutual_commitment', 'name_the_risk', 'test_before_accepting'],
    subSkills: ['Process Control', 'Risk Assessment', 'Stakeholder Alignment'],
    whatChanges: 'Deals have mutual action plans. Both sides know what they owe and by when. Ghosting becomes nearly impossible.',
    commonFailures: [
      'Building a plan the buyer hasn\'t actually agreed to',
      'Over-documenting without testing for real commitment',
      'Letting the buyer control the timeline without pushback',
    ],
    eliteBehavior: 'Creates a shared document with clear mutual commitments, reviews it on the call, and gets verbal confirmation on each item.',
  },
];

// ── Executive Response ────────────────────────────────────────────

const EXECUTIVE_RESPONSE_LEVELS: SkillLevel[] = [
  {
    level: 1,
    name: 'Brevity',
    description: 'Say it in 3 sentences or fewer. No hedging.',
    requiredPatterns: ['cut_to_three_sentences', 'project_certainty'],
    subSkills: ['Concision'],
    whatChanges: 'You stop over-explaining. Executives get the point in 15 seconds, not 2 minutes.',
    commonFailures: [
      'Adding context the executive didn\'t ask for',
      'Hedging with "I think" or "it depends" when certainty is expected',
      'Starting with background instead of the headline',
    ],
    eliteBehavior: 'Opens with the conclusion. If the exec wants detail, they\'ll ask.',
  },
  {
    level: 2,
    name: 'Number-Led',
    description: 'Open with a specific metric or outcome, not context.',
    requiredPatterns: ['lead_with_the_number', 'anchor_to_their_priority'],
    subSkills: ['Concision', 'Executive Framing'],
    whatChanges: 'Every response opens with a number or outcome. Context becomes supporting evidence, not the opening.',
    commonFailures: [
      'Burying the number in paragraph two',
      'Using generic metrics instead of the exec\'s specific priorities',
      'Presenting your metric, not theirs',
    ],
    eliteBehavior: '"Your churn dropped 14% in 90 days." Then silence. Let the exec react.',
  },
  {
    level: 3,
    name: 'Executive Partner',
    description: 'Anchor to their priority, project certainty, and close with a specific ask.',
    requiredPatterns: ['anchor_to_their_priority', 'close_with_a_specific_ask', 'project_certainty'],
    subSkills: ['Concision', 'Executive Framing', 'Strategic Closing'],
    whatChanges: 'You speak as a strategic advisor, not a vendor. Every interaction ends with a clear ask that respects their time.',
    commonFailures: [
      'Forgetting to ask for something specific at the end',
      'Anchoring to your priority instead of theirs',
      'Projecting uncertainty through language or tone',
    ],
    eliteBehavior: 'The exec feels like they\'re talking to a peer who understands their world. The ask is specific, time-bound, and clearly beneficial.',
  },
];

// ── Qualification ─────────────────────────────────────────────────

const QUALIFICATION_LEVELS: SkillLevel[] = [
  {
    level: 1,
    name: 'Pain Validator',
    description: 'Distinguish between genuine business pain and casual interest.',
    requiredPatterns: ['validate_real_pain', 'tie_problem_to_business_impact'],
    subSkills: ['Pain Assessment'],
    whatChanges: 'You stop treating every interested buyer as a real opportunity. You learn to separate curiosity from urgency.',
    commonFailures: [
      'Treating interest as intent',
      'Filling in the buyer\'s pain for them',
      'Moving to demo before pain is validated',
    ],
    eliteBehavior: 'If the buyer can\'t articulate the cost of inaction, they don\'t get a proposal.',
  },
  {
    level: 2,
    name: 'Stakeholder Mapper',
    description: 'Identify who decides, who influences, who controls budget.',
    requiredPatterns: ['map_stakeholders', 'validate_real_pain'],
    subSkills: ['Pain Assessment', 'Power Mapping'],
    whatChanges: 'You know who actually decides before you invest in a deep engagement. Champion ≠ buyer.',
    commonFailures: [
      'Trusting the champion\'s claim that they can decide alone',
      'Not asking who else needs to approve',
      'Confusing influence with authority',
    ],
    eliteBehavior: 'Asks "Walk me through how a purchase like this actually gets approved in your org" and maps the real process.',
  },
  {
    level: 3,
    name: 'Pipeline Disciplinarian',
    description: 'Be willing to walk away from low-quality pipeline.',
    requiredPatterns: ['disqualify_weak_opportunities', 'map_stakeholders', 'tie_problem_to_business_impact'],
    subSkills: ['Pain Assessment', 'Power Mapping', 'Pipeline Hygiene'],
    whatChanges: 'Pipeline shrinks but close rate doubles. You kill bad deals early instead of nursing them for months.',
    commonFailures: [
      'Keeping dead deals alive for pipeline optics',
      'Hoping the buyer will "come around" without evidence',
      'Avoiding the disqualification conversation',
    ],
    eliteBehavior: '"Based on what you\'ve shared, I\'m not sure this is the right fit right now. Here\'s why — tell me if I\'m wrong."',
  },
];

// ── Registry ──────────────────────────────────────────────────────

export const SKILL_LEVEL_DEFINITIONS: Record<SkillFocus, SkillLevelDefinition> = {
  discovery: {
    skill: 'discovery',
    label: 'Discovery',
    levels: DISCOVERY_LEVELS,
  },
  objection_handling: {
    skill: 'objection_handling',
    label: 'Objection Handling',
    levels: OBJECTION_HANDLING_LEVELS,
  },
  deal_control: {
    skill: 'deal_control',
    label: 'Deal Control',
    levels: DEAL_CONTROL_LEVELS,
  },
  executive_response: {
    skill: 'executive_response',
    label: 'Executive Response',
    levels: EXECUTIVE_RESPONSE_LEVELS,
  },
  qualification: {
    skill: 'qualification',
    label: 'Qualification',
    levels: QUALIFICATION_LEVELS,
  },
};

// ── Helpers ───────────────────────────────────────────────────────

/** Get all levels for a skill */
export function getSkillLevels(skill: SkillFocus): SkillLevel[] {
  return SKILL_LEVEL_DEFINITIONS[skill].levels;
}

/** Get a specific level definition */
export function getSkillLevel(skill: SkillFocus, level: number): SkillLevel | null {
  return SKILL_LEVEL_DEFINITIONS[skill].levels.find(l => l.level === level) ?? null;
}

/** Get max level for a skill */
export function getMaxLevel(skill: SkillFocus): number {
  return SKILL_LEVEL_DEFINITIONS[skill].levels.length;
}

/** Get the patterns required at a given level and all levels below */
export function getCumulativePatterns(skill: SkillFocus, upToLevel: number): string[] {
  const patterns = new Set<string>();
  for (const lvl of SKILL_LEVEL_DEFINITIONS[skill].levels) {
    if (lvl.level <= upToLevel) {
      for (const p of lvl.requiredPatterns) patterns.add(p);
    }
  }
  return Array.from(patterns);
}

/** Get the next level's requirements (or null if at max) */
export function getNextLevelRequirements(skill: SkillFocus, currentLevel: number): SkillLevel | null {
  return getSkillLevel(skill, currentLevel + 1);
}

/** Get all sub-skills activated up to a given level */
export function getCumulativeSubSkills(skill: SkillFocus, upToLevel: number): string[] {
  const subs = new Set<string>();
  for (const lvl of SKILL_LEVEL_DEFINITIONS[skill].levels) {
    if (lvl.level <= upToLevel) {
      for (const s of lvl.subSkills) subs.add(s);
    }
  }
  return Array.from(subs);
}
