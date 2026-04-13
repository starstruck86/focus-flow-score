/**
 * Skill Level System — Tier + Micro-Level Progression
 *
 * 6 mastery tiers × 5 micro-levels = 30 visible levels per skill.
 * Tiers represent qualitative behavioral jumps.
 * Micro-levels represent measurable progress within a tier.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

// ── Types ──────────────────────────────────────────────────────────

export interface SkillTier {
  tier: number;
  name: string;
  description: string;
  requiredPatterns: string[];
  subSkills: string[];
  whatChanges: string;
  commonFailures: string[];
  eliteBehavior: string;
}

export interface SkillTierDefinition {
  skill: SkillFocus;
  label: string;
  tiers: SkillTier[];
}

/** @deprecated — alias kept for import compat */
export type SkillLevel = SkillTier;

// ── Constants ─────────────────────────────────────────────────────

export const MICRO_LEVELS_PER_TIER = 5;

// ── Discovery ─────────────────────────────────────────────────────

const DISCOVERY_TIERS: SkillTier[] = [
  {
    tier: 1,
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
    tier: 2,
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
    tier: 3,
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
    tier: 4,
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
  {
    tier: 5,
    name: 'Discovery Architect',
    description: 'Orchestrate multi-threaded discovery across stakeholders. Each conversation builds a strategic map.',
    requiredPatterns: ['test_urgency', 'quantify_the_pain', 'tie_to_business_impact', 'deepen_one_level'],
    subSkills: ['Urgency Testing', 'Business Impact Mapping', 'Depth Creation', 'Multi-Thread Navigation'],
    whatChanges: 'Discovery becomes a strategic instrument. You weave insights from multiple stakeholders into a unified business case the buyer didn\'t know they needed.',
    commonFailures: [
      'Running the same discovery with every stakeholder instead of adapting',
      'Losing the strategic thread across multiple conversations',
      'Failing to connect insights from different stakeholders into one narrative',
    ],
    eliteBehavior: 'The buyer says "You understand our business better than my own team does" — and means it.',
  },
  {
    tier: 6,
    name: 'Discovery Master',
    description: 'Teachable mastery. You can coach others and adapt discovery to any context instantly.',
    requiredPatterns: ['test_urgency', 'quantify_the_pain', 'tie_to_business_impact', 'deepen_one_level', 'ask_singular_questions'],
    subSkills: ['Pain Excavation', 'Depth Creation', 'Business Impact Mapping', 'Urgency Testing', 'Multi-Thread Navigation'],
    whatChanges: 'You don\'t just execute discovery — you design discovery frameworks for others. Your instinct is your methodology.',
    commonFailures: [
      'Over-engineering discovery for simple deals',
      'Coaching through theory instead of live demonstration',
      'Assuming your framework works universally without adapting',
    ],
    eliteBehavior: 'Can take any junior rep\'s discovery recording, diagnose the structural gap in 60 seconds, and prescribe the exact fix.',
  },
];

// ── Objection Handling ────────────────────────────────────────────

const OBJECTION_HANDLING_TIERS: SkillTier[] = [
  {
    tier: 1,
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
    tier: 2,
    name: 'Isolator',
    description: 'Surface the real concern before answering. Shift from feature/cost to impact.',
    requiredPatterns: ['isolate_before_answering', 'reframe_to_business_impact'],
    subSkills: ['Emotional Control', 'Pattern Recognition'],
    whatChanges: 'You stop answering the stated objection and start finding the real one.',
    commonFailures: [
      'Answering the surface objection without checking what\'s underneath',
      'Reframing too aggressively before earning the right',
      'Treating every objection as a price problem',
    ],
    eliteBehavior: 'Asks "Is it really about X, or is there something else behind this?" and waits for the real answer.',
  },
  {
    tier: 3,
    name: 'Proof Anchor',
    description: 'Anchor responses with concrete proof and drive to commitment.',
    requiredPatterns: ['use_specific_proof', 'control_next_step'],
    subSkills: ['Pattern Recognition', 'Proof Deployment'],
    whatChanges: 'Objection responses include specific customer stories, metrics, or case studies.',
    commonFailures: [
      'Using generic proof ("many customers see results") instead of specific stories',
      'Deploying proof before isolating the real concern',
      'Failing to bridge from proof back to the next step',
    ],
    eliteBehavior: 'Names a specific customer, a specific metric, and a specific timeline — then asks for commitment.',
  },
  {
    tier: 4,
    name: 'Objection Architect',
    description: 'Anticipate and preempt objections. Turn resistance into deal acceleration.',
    requiredPatterns: ['use_specific_proof', 'control_next_step', 'isolate_before_answering', 'reframe_to_business_impact'],
    subSkills: ['Pattern Recognition', 'Proof Deployment', 'Emotional Control'],
    whatChanges: 'You address objections before they\'re raised. When they do come, you use them to deepen commitment.',
    commonFailures: [
      'Over-engineering preemptive objection handling into a monologue',
      'Missing the emotional signal behind a repackaged objection',
      'Winning the argument but losing the relationship',
    ],
    eliteBehavior: 'The buyer feels heard, not handled. Objections become collaborative problem-solving moments.',
  },
  {
    tier: 5,
    name: 'Resistance Strategist',
    description: 'Use objections as strategic leverage. Map patterns across deals to predict and neutralize resistance.',
    requiredPatterns: ['use_specific_proof', 'control_next_step', 'isolate_before_answering', 'reframe_to_business_impact', 'stay_concise_under_pressure'],
    subSkills: ['Pattern Recognition', 'Proof Deployment', 'Emotional Control', 'Strategic Positioning'],
    whatChanges: 'Objections become data. You recognize patterns across deals and preempt resistance at the account-strategy level.',
    commonFailures: [
      'Becoming formulaic — applying the same counter-pattern to every objection',
      'Over-relying on past wins without adapting to new buyer personas',
      'Losing empathy in pursuit of efficiency',
    ],
    eliteBehavior: 'Predicts the exact objection before the meeting based on stakeholder role and deal stage — and is right 80%+ of the time.',
  },
  {
    tier: 6,
    name: 'Objection Master',
    description: 'Teachable mastery. You can train others and handle novel objections with instinct.',
    requiredPatterns: ['use_specific_proof', 'control_next_step', 'isolate_before_answering', 'reframe_to_business_impact', 'stay_concise_under_pressure'],
    subSkills: ['Pattern Recognition', 'Proof Deployment', 'Emotional Control', 'Strategic Positioning', 'Coaching'],
    whatChanges: 'You don\'t just handle objections — you build objection frameworks for your team. Your instinct is transferable.',
    commonFailures: [
      'Teaching tactics without the underlying mental model',
      'Assuming your personal style works for everyone',
      'Neglecting practice in favor of theory',
    ],
    eliteBehavior: 'Can listen to any rep\'s objection-handling recording and name the exact mental model that was missing.',
  },
];

// ── Deal Control ──────────────────────────────────────────────────

const DEAL_CONTROL_TIERS: SkillTier[] = [
  {
    tier: 1,
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
    tier: 2,
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
    tier: 3,
    name: 'Mutual Planner',
    description: 'Define what both sides will do by when. Lock the deal mechanics.',
    requiredPatterns: ['lock_mutual_commitment', 'name_the_risk', 'test_before_accepting'],
    subSkills: ['Process Control', 'Risk Assessment', 'Stakeholder Alignment'],
    whatChanges: 'Deals have mutual action plans. Both sides know what they owe and by when.',
    commonFailures: [
      'Building a plan the buyer hasn\'t actually agreed to',
      'Over-documenting without testing for real commitment',
      'Letting the buyer control the timeline without pushback',
    ],
    eliteBehavior: 'Creates a shared document with clear mutual commitments, reviews it on the call, and gets verbal confirmation on each item.',
  },
  {
    tier: 4,
    name: 'Deal Strategist',
    description: 'Orchestrate complex multi-stakeholder deals. Control timeline and power dynamics.',
    requiredPatterns: ['lock_mutual_commitment', 'name_the_risk', 'test_before_accepting', 'control_next_step'],
    subSkills: ['Process Control', 'Risk Assessment', 'Stakeholder Alignment', 'Power Mapping'],
    whatChanges: 'You see the entire deal chess board. Every action is sequenced to build momentum and close access gaps.',
    commonFailures: [
      'Losing sight of the economic buyer while managing multiple threads',
      'Over-controlling the process to the point of annoying the buyer',
      'Ignoring political dynamics between stakeholders',
    ],
    eliteBehavior: 'Maps the org chart, identifies the blocker, and engineers a meeting sequence that neutralizes them before the final presentation.',
  },
  {
    tier: 5,
    name: 'Deal Architect',
    description: 'Design deal structures that create urgency, lock commitment, and prevent competitive displacement.',
    requiredPatterns: ['lock_mutual_commitment', 'name_the_risk', 'test_before_accepting', 'control_next_step', 'create_urgency_without_pressure'],
    subSkills: ['Process Control', 'Risk Assessment', 'Stakeholder Alignment', 'Power Mapping', 'Commercial Strategy'],
    whatChanges: 'Deals are engineered, not managed. You design the buying process itself — terms, timeline, decision criteria — to favor close.',
    commonFailures: [
      'Over-engineering simple deals',
      'Designing processes that serve you but not the buyer',
      'Losing the human relationship in pursuit of deal mechanics',
    ],
    eliteBehavior: 'The buyer adopts your proposed evaluation process as their own and defends it internally.',
  },
  {
    tier: 6,
    name: 'Deal Control Master',
    description: 'Teachable mastery. You design deal control playbooks and coach others through complex cycles.',
    requiredPatterns: ['lock_mutual_commitment', 'name_the_risk', 'test_before_accepting', 'control_next_step', 'create_urgency_without_pressure'],
    subSkills: ['Process Control', 'Risk Assessment', 'Stakeholder Alignment', 'Power Mapping', 'Commercial Strategy', 'Coaching'],
    whatChanges: 'You don\'t just close deals — you build the deal methodology for your org. Your frameworks become the team standard.',
    commonFailures: [
      'Teaching process without teaching judgment',
      'Coaching from outdated deal patterns',
      'Assuming what works at enterprise works at mid-market',
    ],
    eliteBehavior: 'Can diagnose a stalled deal in a 5-minute conversation and prescribe the exact intervention.',
  },
];

// ── Executive Response ────────────────────────────────────────────

const EXECUTIVE_RESPONSE_TIERS: SkillTier[] = [
  {
    tier: 1,
    name: 'Brevity',
    description: 'Say it in 3 sentences or fewer. No hedging.',
    requiredPatterns: ['cut_to_three_sentences', 'project_certainty'],
    subSkills: ['Concision'],
    whatChanges: 'You stop over-explaining. Executives get the point in 15 seconds, not 2 minutes.',
    commonFailures: [
      'Adding context the executive didn\'t ask for',
      'Hedging with "I think" or "it depends"',
      'Starting with background instead of the headline',
    ],
    eliteBehavior: 'Opens with the conclusion. If the exec wants detail, they\'ll ask.',
  },
  {
    tier: 2,
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
    tier: 3,
    name: 'Executive Partner',
    description: 'Anchor to their priority, project certainty, and close with a specific ask.',
    requiredPatterns: ['anchor_to_their_priority', 'close_with_a_specific_ask', 'project_certainty'],
    subSkills: ['Concision', 'Executive Framing', 'Strategic Closing'],
    whatChanges: 'You speak as a strategic advisor, not a vendor. Every interaction ends with a clear ask.',
    commonFailures: [
      'Forgetting to ask for something specific at the end',
      'Anchoring to your priority instead of theirs',
      'Projecting uncertainty through language or tone',
    ],
    eliteBehavior: 'The exec feels like they\'re talking to a peer who understands their world.',
  },
  {
    tier: 4,
    name: 'Boardroom Operator',
    description: 'Navigate multi-executive dynamics. Adapt tone, depth, and framing per audience.',
    requiredPatterns: ['anchor_to_their_priority', 'close_with_a_specific_ask', 'project_certainty', 'lead_with_the_number'],
    subSkills: ['Concision', 'Executive Framing', 'Strategic Closing', 'Audience Adaptation'],
    whatChanges: 'You read the room. CFO gets ROI. CTO gets architecture. CEO gets strategic vision. Same deal, different language.',
    commonFailures: [
      'Using the same pitch for every executive',
      'Failing to read body language or disengagement signals',
      'Overloading a group meeting with detail meant for a 1-on-1',
    ],
    eliteBehavior: 'Shifts messaging mid-presentation when an exec\'s body language signals disengagement, and re-engages them with a targeted question.',
  },
  {
    tier: 5,
    name: 'C-Suite Strategist',
    description: 'Shape executive thinking. Position yourself as essential to their strategic agenda.',
    requiredPatterns: ['anchor_to_their_priority', 'close_with_a_specific_ask', 'project_certainty', 'lead_with_the_number', 'cut_to_three_sentences'],
    subSkills: ['Concision', 'Executive Framing', 'Strategic Closing', 'Audience Adaptation', 'Strategic Influence'],
    whatChanges: 'Executives seek your perspective before making decisions. You\'re no longer selling — you\'re advising.',
    commonFailures: [
      'Overstepping advisory boundaries',
      'Confusing access with influence',
      'Becoming too comfortable and losing deal urgency',
    ],
    eliteBehavior: 'The exec calls you before their board meeting to pressure-test their narrative. You\'re part of their prep, not their vendor list.',
  },
  {
    tier: 6,
    name: 'Executive Presence Master',
    description: 'Teachable mastery. You can coach others to command executive attention and respect.',
    requiredPatterns: ['anchor_to_their_priority', 'close_with_a_specific_ask', 'project_certainty', 'lead_with_the_number', 'cut_to_three_sentences'],
    subSkills: ['Concision', 'Executive Framing', 'Strategic Closing', 'Audience Adaptation', 'Strategic Influence', 'Coaching'],
    whatChanges: 'Your executive communication style is a transferable framework. You elevate the entire team\'s executive presence.',
    commonFailures: [
      'Teaching mechanics without teaching situational judgment',
      'Coaching from a single-industry perspective',
      'Underestimating the role of genuine curiosity in executive relationships',
    ],
    eliteBehavior: 'Can listen to 30 seconds of a rep\'s exec call and name the exact shift that would change the outcome.',
  },
];

// ── Qualification ─────────────────────────────────────────────────

const QUALIFICATION_TIERS: SkillTier[] = [
  {
    tier: 1,
    name: 'Pain Validator',
    description: 'Distinguish between genuine business pain and casual interest.',
    requiredPatterns: ['validate_real_pain', 'tie_problem_to_business_impact'],
    subSkills: ['Pain Assessment'],
    whatChanges: 'You stop treating every interested buyer as a real opportunity.',
    commonFailures: [
      'Treating interest as intent',
      'Filling in the buyer\'s pain for them',
      'Moving to demo before pain is validated',
    ],
    eliteBehavior: 'If the buyer can\'t articulate the cost of inaction, they don\'t get a proposal.',
  },
  {
    tier: 2,
    name: 'Stakeholder Mapper',
    description: 'Identify who decides, who influences, who controls budget.',
    requiredPatterns: ['map_stakeholders', 'validate_real_pain'],
    subSkills: ['Pain Assessment', 'Power Mapping'],
    whatChanges: 'You know who actually decides before you invest in a deep engagement.',
    commonFailures: [
      'Trusting the champion\'s claim that they can decide alone',
      'Not asking who else needs to approve',
      'Confusing influence with authority',
    ],
    eliteBehavior: 'Asks "Walk me through how a purchase like this actually gets approved" and maps the real process.',
  },
  {
    tier: 3,
    name: 'Pipeline Disciplinarian',
    description: 'Be willing to walk away from low-quality pipeline.',
    requiredPatterns: ['disqualify_weak_opportunities', 'map_stakeholders', 'tie_problem_to_business_impact'],
    subSkills: ['Pain Assessment', 'Power Mapping', 'Pipeline Hygiene'],
    whatChanges: 'Pipeline shrinks but close rate doubles. You kill bad deals early.',
    commonFailures: [
      'Keeping dead deals alive for pipeline optics',
      'Hoping the buyer will "come around"',
      'Avoiding the disqualification conversation',
    ],
    eliteBehavior: '"Based on what you\'ve shared, I\'m not sure this is the right fit right now. Here\'s why — tell me if I\'m wrong."',
  },
  {
    tier: 4,
    name: 'Qualification Strategist',
    description: 'Use qualification as a selling tool. The questions themselves create urgency and differentiation.',
    requiredPatterns: ['disqualify_weak_opportunities', 'map_stakeholders', 'tie_problem_to_business_impact', 'validate_real_pain'],
    subSkills: ['Pain Assessment', 'Power Mapping', 'Pipeline Hygiene', 'Strategic Qualification'],
    whatChanges: 'Qualification is no longer a gate — it\'s a weapon. Your questions position you as the serious vendor.',
    commonFailures: [
      'Being so rigorous that you intimidate early-stage buyers',
      'Qualifying out too aggressively in competitive situations',
      'Forgetting that qualification should serve the buyer too',
    ],
    eliteBehavior: 'The buyer says "Nobody else asked us these questions" — and it makes them trust you more.',
  },
  {
    tier: 5,
    name: 'Pipeline Architect',
    description: 'Design qualification frameworks that scale across teams and segments.',
    requiredPatterns: ['disqualify_weak_opportunities', 'map_stakeholders', 'tie_problem_to_business_impact', 'validate_real_pain'],
    subSkills: ['Pain Assessment', 'Power Mapping', 'Pipeline Hygiene', 'Strategic Qualification', 'Segment Design'],
    whatChanges: 'You don\'t just qualify deals — you design qualification criteria for different segments, deal sizes, and buyer types.',
    commonFailures: [
      'Creating frameworks that are too rigid for field use',
      'Optimizing for false-positive reduction at the expense of coverage',
      'Designing for enterprise and applying to SMB unchanged',
    ],
    eliteBehavior: 'Builds a qualification rubric that new reps can apply in their first week and get 80% of the accuracy of a veteran.',
  },
  {
    tier: 6,
    name: 'Qualification Master',
    description: 'Teachable mastery. You coach qualification instinct and build pipeline culture.',
    requiredPatterns: ['disqualify_weak_opportunities', 'map_stakeholders', 'tie_problem_to_business_impact', 'validate_real_pain'],
    subSkills: ['Pain Assessment', 'Power Mapping', 'Pipeline Hygiene', 'Strategic Qualification', 'Segment Design', 'Coaching'],
    whatChanges: 'You shape how your entire org thinks about pipeline quality. Your instinct is teachable.',
    commonFailures: [
      'Coaching qualification without coaching the underlying judgment',
      'Pushing for pipeline purity in a growth-at-all-costs culture',
      'Losing touch with frontline qualification challenges',
    ],
    eliteBehavior: 'Can review 10 deals in a pipeline and in 5 minutes identify the 3 that will never close — and explain why.',
  },
];

// ── Registry ──────────────────────────────────────────────────────

export const SKILL_TIER_DEFINITIONS: Record<SkillFocus, SkillTierDefinition> = {
  discovery: { skill: 'discovery', label: 'Discovery', tiers: DISCOVERY_TIERS },
  objection_handling: { skill: 'objection_handling', label: 'Objection Handling', tiers: OBJECTION_HANDLING_TIERS },
  deal_control: { skill: 'deal_control', label: 'Deal Control', tiers: DEAL_CONTROL_TIERS },
  executive_response: { skill: 'executive_response', label: 'Executive Response', tiers: EXECUTIVE_RESPONSE_TIERS },
  qualification: { skill: 'qualification', label: 'Qualification', tiers: QUALIFICATION_TIERS },
};

/** @deprecated — alias for backward compat */
export const SKILL_LEVEL_DEFINITIONS = SKILL_TIER_DEFINITIONS;

// ── Helpers ───────────────────────────────────────────────────────

/** Get all tiers for a skill */
export function getSkillTiers(skill: SkillFocus): SkillTier[] {
  return SKILL_TIER_DEFINITIONS[skill].tiers;
}

/** Get a specific tier definition */
export function getSkillTier(skill: SkillFocus, tier: number): SkillTier | null {
  return SKILL_TIER_DEFINITIONS[skill].tiers.find(t => t.tier === tier) ?? null;
}

/** Get max tier for a skill */
export function getMaxTier(skill: SkillFocus): number {
  return SKILL_TIER_DEFINITIONS[skill].tiers.length;
}

/** Compute overall level (1–30) from tier + micro-level */
export function getOverallLevel(
  tier: number,
  levelWithinTier: number,
  maxLevelWithinTier: number = MICRO_LEVELS_PER_TIER,
): number {
  return (tier - 1) * maxLevelWithinTier + levelWithinTier;
}

/** @deprecated — compat alias for getSkillTier */
export function getSkillLevel(skill: SkillFocus, level: number): SkillTier | null {
  return getSkillTier(skill, level);
}

/** @deprecated — compat alias for getMaxTier */
export function getMaxLevel(skill: SkillFocus): number {
  return getMaxTier(skill);
}

/** Get all levels/tiers for a skill — compat alias */
export function getSkillLevels(skill: SkillFocus): SkillTier[] {
  return getSkillTiers(skill);
}

/** Get cumulative patterns up to a given tier */
export function getCumulativePatterns(skill: SkillFocus, upToTier: number): string[] {
  const patterns = new Set<string>();
  for (const t of SKILL_TIER_DEFINITIONS[skill].tiers) {
    if (t.tier <= upToTier) {
      for (const p of t.requiredPatterns) patterns.add(p);
    }
  }
  return Array.from(patterns);
}

/** Get the next tier's requirements */
export function getNextLevelRequirements(skill: SkillFocus, currentTier: number): SkillTier | null {
  return getSkillTier(skill, currentTier + 1);
}

/** Get cumulative sub-skills up to a given tier */
export function getCumulativeSubSkills(skill: SkillFocus, upToTier: number): string[] {
  const subs = new Set<string>();
  for (const t of SKILL_TIER_DEFINITIONS[skill].tiers) {
    if (t.tier <= upToTier) {
      for (const s of t.subSkills) subs.add(s);
    }
  }
  return Array.from(subs);
}
