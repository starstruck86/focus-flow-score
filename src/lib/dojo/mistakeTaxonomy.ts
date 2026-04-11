/**
 * Mistake Taxonomy — structured coaching metadata for every mistake type.
 * Maps each mistake to: why it's wrong, what good looks like, and a targeted drill cue.
 */

import type { SkillFocus } from './scenarios';

export interface MistakeEntry {
  id: string;
  label: string;
  skill: SkillFocus;
  /** One-sentence explanation of why this hurts the rep */
  whyItHurts: string;
  /** What the rep should do instead — specific, actionable */
  whatGoodLooksLike: string;
  /** Micro-drill: one thing to practice immediately */
  drillCue: string;
  /** Severity weight (1–3): 3 = fundamental gap, 1 = polish issue */
  severity: 1 | 2 | 3;
}

export const MISTAKE_TAXONOMY: Record<string, MistakeEntry> = {
  // ── Objection Handling ──────────────────────────────────────────
  pitched_too_early: {
    id: 'pitched_too_early',
    label: 'Pitched too early',
    skill: 'objection_handling',
    whyItHurts: 'You jumped to selling before understanding the real concern — the buyer feels unheard and shuts down.',
    whatGoodLooksLike: 'Acknowledge the objection, ask one clarifying question, then reframe — never pitch until you understand the root.',
    drillCue: 'Replay this scenario: pause after the objection and ask "What specifically concerns you about that?" before responding.',
    severity: 3,
  },
  weak_objection_handle: {
    id: 'weak_objection_handle',
    label: 'Weak objection handle',
    skill: 'objection_handling',
    whyItHurts: 'A soft handle signals you don\'t believe in your own position — the buyer gains control of the conversation.',
    whatGoodLooksLike: 'Isolate the objection, name the real risk behind it, and offer a concrete path forward.',
    drillCue: 'Take the same objection and respond with: "I hear you. The real risk is [X]. Here\'s what I\'d recommend…"',
    severity: 2,
  },
  reactive_not_reframing: {
    id: 'reactive_not_reframing',
    label: 'Reactive instead of reframing',
    skill: 'objection_handling',
    whyItHurts: 'Answering an objection at face value keeps you in the buyer\'s frame — you lose the ability to redirect.',
    whatGoodLooksLike: 'Acknowledge, then shift the conversation to what matters: the cost of inaction or the business impact.',
    drillCue: 'Practice the "acknowledge + redirect" pattern: "That makes sense. The bigger question is…"',
    severity: 3,
  },
  vendor_language: {
    id: 'vendor_language',
    label: 'Vendor language',
    skill: 'objection_handling',
    whyItHurts: 'Marketing-speak triggers buyer skepticism — you sound like a pitch deck instead of a trusted advisor.',
    whatGoodLooksLike: 'Speak in the buyer\'s language. Use their words, their metrics, their problems.',
    drillCue: 'Rewrite your response using zero product jargon — only the buyer\'s business terms.',
    severity: 2,
  },

  // ── Discovery ───────────────────────────────────────────────────
  no_business_impact: {
    id: 'no_business_impact',
    label: 'No business impact',
    skill: 'discovery',
    whyItHurts: 'Without tying pain to money or risk, the buyer has no reason to prioritize your conversation.',
    whatGoodLooksLike: 'Connect every problem to a measurable consequence: revenue lost, time wasted, risk exposed.',
    drillCue: 'After surfacing pain, ask: "What does that cost you per quarter?" or "What happens if this doesn\'t get fixed?"',
    severity: 3,
  },
  too_generic: {
    id: 'too_generic',
    label: 'Too generic',
    skill: 'discovery',
    whyItHurts: 'Generic questions get generic answers — you learn nothing the buyer hasn\'t told the last three vendors.',
    whatGoodLooksLike: 'Ask situation-specific questions that reference what you already know about their business.',
    drillCue: 'Rewrite your question starting with "You mentioned [specific detail]… how does that affect [business metric]?"',
    severity: 2,
  },
  stacked_questions: {
    id: 'stacked_questions',
    label: 'Stacked questions',
    skill: 'discovery',
    whyItHurts: 'Multiple questions at once overwhelm the buyer — they answer the easiest one and you miss the important one.',
    whatGoodLooksLike: 'One question at a time. Wait for the answer. Then go deeper.',
    drillCue: 'Practice the "one question, full pause" pattern — ask, then count to 3 in silence.',
    severity: 1,
  },
  failed_to_deepen: {
    id: 'failed_to_deepen',
    label: 'Failed to deepen pain',
    skill: 'discovery',
    whyItHurts: 'Surface-level pain doesn\'t create urgency — the buyer can deprioritize you without consequence.',
    whatGoodLooksLike: 'Follow up with "What happens if…" or "How does that affect…" to move from symptom to consequence.',
    drillCue: 'Take the buyer\'s last answer and ask two "so what" follow-ups to reach the business consequence.',
    severity: 3,
  },

  // ── Executive Response ──────────────────────────────────────────
  too_long: {
    id: 'too_long',
    label: 'Too long / rambling',
    skill: 'executive_response',
    whyItHurts: 'Executives filter for signal. Rambling signals low confidence and wastes their limited attention.',
    whatGoodLooksLike: 'Lead with the answer, support with one proof point, close with a question. Under 30 seconds.',
    drillCue: 'Rewrite your response in exactly 3 sentences: position, proof, question.',
    severity: 2,
  },
  no_proof: {
    id: 'no_proof',
    label: 'No proof points',
    skill: 'executive_response',
    whyItHurts: 'Claims without evidence are noise. Executives need data or examples to take you seriously.',
    whatGoodLooksLike: 'Anchor every claim with a specific number, customer example, or outcome.',
    drillCue: 'Add one concrete proof point: "[Company X] saw [Y% improvement] in [Z time]."',
    severity: 2,
  },
  weak_close: {
    id: 'weak_close',
    label: 'Weak close',
    skill: 'executive_response',
    whyItHurts: 'Ending without a clear ask gives the executive an easy exit — you lose momentum.',
    whatGoodLooksLike: 'End with a specific, time-bound ask: "Can we get 30 minutes Thursday to map this out?"',
    drillCue: 'Practice replacing "let me know" with a concrete next step and specific date.',
    severity: 2,
  },

  // ── Deal Control ────────────────────────────────────────────────
  lack_of_control: {
    id: 'lack_of_control',
    label: 'Lack of control',
    skill: 'deal_control',
    whyItHurts: 'When the buyer drives the process, they control the timeline — and they\'ll deprioritize you.',
    whatGoodLooksLike: 'Own the next step. Propose the agenda. Set mutual deadlines.',
    drillCue: 'End your next response with: "Here\'s what I\'d recommend as a next step…" and be specific.',
    severity: 3,
  },
  vague_next_step: {
    id: 'vague_next_step',
    label: 'Vague next step',
    skill: 'deal_control',
    whyItHurts: '"Let\'s reconnect soon" means nothing happens — the deal stalls and you lose momentum.',
    whatGoodLooksLike: 'Every interaction ends with who does what by when.',
    drillCue: 'Replace "let\'s circle back" with: "[Specific person] will [specific action] by [specific date]."',
    severity: 2,
  },
  too_passive: {
    id: 'too_passive',
    label: 'Too passive',
    skill: 'deal_control',
    whyItHurts: 'Passivity signals you don\'t believe this deal matters — the buyer mirrors your energy.',
    whatGoodLooksLike: 'Take a position. Recommend an action. Show you\'ve thought about their situation.',
    drillCue: 'Practice starting with "Based on what you\'ve told me, I\'d recommend…" instead of asking what they want.',
    severity: 2,
  },
  no_mutual_plan: {
    id: 'no_mutual_plan',
    label: 'No mutual plan',
    skill: 'deal_control',
    whyItHurts: 'Without a shared plan, you\'re hoping instead of managing — and hoping is not a strategy.',
    whatGoodLooksLike: 'Propose a 3-step timeline with clear milestones and owner for each step.',
    drillCue: 'Draft a mutual action plan: "Step 1: [X] by [date]. Step 2: [Y] by [date]. Step 3: [Z] by [date]."',
    severity: 3,
  },
  accepted_delay: {
    id: 'accepted_delay',
    label: 'Accepted the delay',
    skill: 'deal_control',
    whyItHurts: 'Accepting "let\'s revisit next quarter" without pressure means the deal dies quietly.',
    whatGoodLooksLike: 'Name the cost of waiting. Quantify what they lose between now and next quarter.',
    drillCue: 'Respond to a delay with: "I understand. What happens to [their pain] between now and then?"',
    severity: 2,
  },

  // ── Qualification ───────────────────────────────────────────────
  failed_to_qualify: {
    id: 'failed_to_qualify',
    label: 'Failed to qualify',
    skill: 'qualification',
    whyItHurts: 'Pursuing unqualified deals wastes your most limited resource: time.',
    whatGoodLooksLike: 'Ask the hard questions early: budget, authority, timeline, consequences of doing nothing.',
    drillCue: 'Before your next response, answer: "Does this person have the budget, authority, and urgency to buy?"',
    severity: 3,
  },
  accepted_weak_pain: {
    id: 'accepted_weak_pain',
    label: 'Accepted weak pain',
    skill: 'qualification',
    whyItHurts: '"It would be nice to have" is not pain — it\'s a wish. Wishes don\'t close deals.',
    whatGoodLooksLike: 'Probe until you find a consequence: "What happens if you don\'t solve this?"',
    drillCue: 'Ask: "Is this a nice-to-have or a must-fix? What breaks if nothing changes?"',
    severity: 3,
  },
  no_urgency: {
    id: 'no_urgency',
    label: 'Didn\'t test urgency',
    skill: 'qualification',
    whyItHurts: 'Without urgency, deals sit in pipeline forever — they don\'t die, they just never close.',
    whatGoodLooksLike: 'Surface a deadline, trigger event, or consequence that creates natural urgency.',
    drillCue: 'Ask: "What would need to happen for this to become a priority this quarter?"',
    severity: 2,
  },
  skipped_stakeholders: {
    id: 'skipped_stakeholders',
    label: 'Skipped stakeholder mapping',
    skill: 'qualification',
    whyItHurts: 'Selling to one person means you\'re building a single point of failure — deals die in committee.',
    whatGoodLooksLike: 'Map the decision process: who else cares, who can block, who signs.',
    drillCue: 'Ask: "Who else would need to weigh in on this decision? What would their concerns be?"',
    severity: 2,
  },
  no_disqualification: {
    id: 'no_disqualification',
    label: 'Didn\'t consider disqualifying',
    skill: 'qualification',
    whyItHurts: 'If you can\'t walk away, you can\'t negotiate — the buyer knows you need the deal more than they do.',
    whatGoodLooksLike: 'Actively test whether this deal deserves your time. If it doesn\'t, move on.',
    drillCue: 'Score this opportunity 1–10 on pain, authority, and timeline. If it\'s below 5, challenge it.',
    severity: 1,
  },
};

/** Get enriched mistake data — falls back to a generic entry if unknown */
export function getMistakeEntry(mistakeId: string): MistakeEntry {
  return MISTAKE_TAXONOMY[mistakeId] ?? {
    id: mistakeId,
    label: mistakeId.replace(/_/g, ' '),
    skill: 'objection_handling' as SkillFocus,
    whyItHurts: 'This pattern weakens your response and gives the buyer control.',
    whatGoodLooksLike: 'Be more specific, more direct, and anchor to business impact.',
    drillCue: 'Rewrite your response with one concrete proof point and a clear next step.',
    severity: 2,
  };
}

/** Get all mistakes for a given skill */
export function getMistakesBySkill(skill: SkillFocus): MistakeEntry[] {
  return Object.values(MISTAKE_TAXONOMY).filter(m => m.skill === skill);
}

/** Find the most severe mistake from a list of mistake IDs */
export function getMostSevereMistake(mistakeIds: string[]): MistakeEntry | null {
  if (!mistakeIds.length) return null;
  return mistakeIds
    .map(id => getMistakeEntry(id))
    .sort((a, b) => b.severity - a.severity)[0];
}
