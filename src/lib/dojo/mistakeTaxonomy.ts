/**
 * Mistake Taxonomy — structured coaching metadata for every mistake type.
 * Each entry provides: exact behavioral failure, business impact, concrete better phrasing, and a micro-drill.
 *
 * Quality bar:
 * - whyItHurts: explains impact on buyer relationship, not just "this is bad"
 * - whatGoodLooksLike: includes EXACT phrasing a rep could say — never conceptual
 * - drillCue: one specific, immediately executable action — not a lecture
 */

import type { SkillFocus } from './scenarios';

export interface MistakeEntry {
  id: string;
  label: string;
  skill: SkillFocus;
  /** One-sentence explanation of the business impact on the buyer */
  whyItHurts: string;
  /** Exact phrasing or concrete technique the rep should use instead */
  whatGoodLooksLike: string;
  /** One specific micro-drill to practice immediately */
  drillCue: string;
  /** Severity weight (1–3): 3 = fundamental gap, 2 = execution gap, 1 = polish issue */
  severity: 1 | 2 | 3;
}

export const MISTAKE_TAXONOMY: Record<string, MistakeEntry> = {
  // ── Objection Handling ──────────────────────────────────────────
  pitched_too_early: {
    id: 'pitched_too_early',
    label: 'Pitched too early',
    skill: 'objection_handling',
    whyItHurts: 'The buyer raised a concern and you answered with product — they feel sold to, not heard. Trust drops immediately.',
    whatGoodLooksLike: 'Say: "That\'s a fair concern. Before I respond — what specifically worries you about that?" Then wait. Only respond to what they actually said.',
    drillCue: 'Replay this scenario. When the objection lands, your only job is to ask one clarifying question before you say anything else.',
    severity: 3,
  },
  weak_objection_handle: {
    id: 'weak_objection_handle',
    label: 'Weak objection handle',
    skill: 'objection_handling',
    whyItHurts: 'A soft handle tells the buyer you\'re not confident in your own position — they smell blood and push harder.',
    whatGoodLooksLike: 'Say: "I hear you. Here\'s what I\'d actually worry about if I were you — [name the real risk]. Here\'s how we\'d handle it: [concrete step]."',
    drillCue: 'Take the same objection. Start your response with "The real risk is…" and name something specific. Then give one concrete action.',
    severity: 2,
  },
  reactive_not_reframing: {
    id: 'reactive_not_reframing',
    label: 'Reactive instead of reframing',
    skill: 'objection_handling',
    whyItHurts: 'You answered the objection at face value, which keeps you in the buyer\'s frame. You lose the ability to redirect the conversation.',
    whatGoodLooksLike: 'Say: "That makes sense. The bigger question is — what happens to [their stated pain] if you wait another quarter? How are you solving that today?"',
    drillCue: 'Practice the acknowledge-redirect: "That makes sense. The bigger question is…" — use it on the next three objections you face.',
    severity: 3,
  },
  vendor_language: {
    id: 'vendor_language',
    label: 'Vendor language',
    skill: 'objection_handling',
    whyItHurts: 'Phrases like "our platform enables" or "we provide solutions" trigger the buyer\'s sales filter — you sound like a brochure, not an advisor.',
    whatGoodLooksLike: 'Replace product language with the buyer\'s own words. Instead of "our CDP unifies data," say: "You mentioned your lifecycle team spends 3 hours pulling segment lists — that goes away."',
    drillCue: 'Rewrite your last response using zero product terms. Only use the buyer\'s business language, their metrics, their problems.',
    severity: 2,
  },

  // ── Discovery ───────────────────────────────────────────────────
  no_business_impact: {
    id: 'no_business_impact',
    label: 'No business impact',
    skill: 'discovery',
    whyItHurts: 'You surfaced a problem but didn\'t connect it to money, risk, or time — the buyer has no reason to prioritize this conversation over anything else.',
    whatGoodLooksLike: 'After any pain statement, ask: "What does that cost you per quarter?" or "What breaks downstream when that happens?" Don\'t move on until you have a number or a consequence.',
    drillCue: 'Take the last pain point the buyer mentioned. Ask two follow-ups: "What does that cost you?" and "Who else feels that?"',
    severity: 3,
  },
  too_generic: {
    id: 'too_generic',
    label: 'Too generic',
    skill: 'discovery',
    whyItHurts: 'Generic questions get generic answers. The buyer gives you nothing useful because you asked them nothing specific.',
    whatGoodLooksLike: 'Instead of "What are your challenges?", say: "You mentioned your team runs 12 campaigns a month — when one underperforms, what\'s the process to catch it?"',
    drillCue: 'Rewrite your question starting with "You mentioned…" referencing something specific from the conversation. Then ask about impact.',
    severity: 2,
  },
  stacked_questions: {
    id: 'stacked_questions',
    label: 'Stacked questions',
    skill: 'discovery',
    whyItHurts: 'Three questions at once means the buyer answers the easiest one and you miss the important one. You also signal nervousness.',
    whatGoodLooksLike: 'Ask one question. Full stop. Wait for the complete answer. Then ask the next one. Silence is your tool.',
    drillCue: 'In your next rep, ask exactly one question per turn. Count to three silently after you finish speaking.',
    severity: 1,
  },
  failed_to_deepen: {
    id: 'failed_to_deepen',
    label: 'Failed to deepen pain',
    skill: 'discovery',
    whyItHurts: 'Surface-level pain doesn\'t create urgency. The buyer thinks "yeah, it\'s annoying but not urgent" — and your deal stalls.',
    whatGoodLooksLike: 'Say: "You said [pain]. Walk me through what happens downstream when that occurs — who feels it and what does it cost?" Keep going until you reach a consequence with a number.',
    drillCue: 'Take the buyer\'s last answer and ask "so what happens next?" twice. Don\'t stop at the symptom — reach the business consequence.',
    severity: 3,
  },

  // ── Executive Response ──────────────────────────────────────────
  too_long: {
    id: 'too_long',
    label: 'Too long / rambling',
    skill: 'executive_response',
    whyItHurts: 'Executives filter for signal in the first 10 seconds. Rambling signals low confidence and wastes their most scarce resource: attention.',
    whatGoodLooksLike: 'Structure: position (1 sentence), proof (1 specific example), question (1 ask). Say: "Here\'s what we\'re seeing with [similar company]: [result]. Would that be relevant to what you\'re working on?"',
    drillCue: 'Rewrite your response in exactly 3 sentences. Sentence 1: your position. Sentence 2: one proof point. Sentence 3: one question.',
    severity: 2,
  },
  no_proof: {
    id: 'no_proof',
    label: 'No proof points',
    skill: 'executive_response',
    whyItHurts: 'Claims without evidence are noise to an executive. "We help companies grow" means nothing without a specific example.',
    whatGoodLooksLike: 'Say: "[Company in their space] was dealing with the same issue — [specific problem]. In [timeframe], they [specific measurable result]." Always name the company, the problem, and the number.',
    drillCue: 'Add one proof point to your response using this format: "[Company] saw [X% improvement] in [Y metric] within [Z months]."',
    severity: 2,
  },
  weak_close: {
    id: 'weak_close',
    label: 'Weak close',
    skill: 'executive_response',
    whyItHurts: 'Ending with "let me know your thoughts" gives the executive a free exit. You lose momentum and they forget you by tomorrow.',
    whatGoodLooksLike: 'Say: "Based on this, I\'d recommend we get 30 minutes Thursday to map out what this looks like for [their company]. Does that work, or is Friday better?"',
    drillCue: 'Replace every "let me know" with a specific time and date. Practice: "Can we get 30 minutes on [day] to [specific purpose]?"',
    severity: 2,
  },

  // ── Deal Control ────────────────────────────────────────────────
  lack_of_control: {
    id: 'lack_of_control',
    label: 'Lack of control',
    skill: 'deal_control',
    whyItHurts: 'When the buyer owns the process, they control your timeline — and they will deprioritize you the moment something else comes up.',
    whatGoodLooksLike: 'Say: "Here\'s what I\'d recommend as a path forward: [Step 1] this week, [Step 2] by [date], then [Step 3] so you can make a decision by [date]. Does that timeline work?"',
    drillCue: 'End your next response with a proposed 3-step plan including specific dates. Don\'t ask "what do you think?" — ask "does this timeline work?"',
    severity: 3,
  },
  vague_next_step: {
    id: 'vague_next_step',
    label: 'Vague next step',
    skill: 'deal_control',
    whyItHurts: '"Let\'s circle back" is not a next step — it\'s permission to forget. The deal stalls because nobody owns the action.',
    whatGoodLooksLike: 'Say: "[Name] will send the technical requirements by Wednesday. I\'ll have the business case to you by Friday. Then we\'ll regroup Monday to align on next steps."',
    drillCue: 'Replace every vague next step with: "[Who] will [what] by [when]." Name the person, the action, and the date.',
    severity: 2,
  },
  too_passive: {
    id: 'too_passive',
    label: 'Too passive',
    skill: 'deal_control',
    whyItHurts: 'Asking "what would you like to do?" signals you haven\'t thought about their situation. The buyer mirrors your low energy.',
    whatGoodLooksLike: 'Say: "Based on what you\'ve shared, here\'s what I\'d recommend: [specific action]. The reason is [one sentence why]. Should we move on that?"',
    drillCue: 'Start your next response with "Based on what you\'ve told me, I\'d recommend…" and make a specific recommendation before asking for input.',
    severity: 2,
  },
  no_mutual_plan: {
    id: 'no_mutual_plan',
    label: 'No mutual plan',
    skill: 'deal_control',
    whyItHurts: 'Without a shared plan, you\'re hoping instead of managing. Hope is not a strategy — deals without plans die in committee.',
    whatGoodLooksLike: 'Say: "Let me propose a timeline: Week 1 — [action + owner]. Week 2 — [action + owner]. Week 3 — [decision point]. I\'ll send this over so we\'re aligned."',
    drillCue: 'Draft a 3-week mutual action plan with one milestone per week. Each milestone has an owner and a date.',
    severity: 3,
  },
  accepted_delay: {
    id: 'accepted_delay',
    label: 'Accepted the delay',
    skill: 'deal_control',
    whyItHurts: 'Accepting "let\'s revisit next quarter" without testing it means the deal dies quietly. The buyer was testing your conviction.',
    whatGoodLooksLike: 'Say: "I understand the timing pressure. Help me understand — what happens to [their stated pain] between now and next quarter? What\'s the cost of waiting?"',
    drillCue: 'When you hear a delay, respond with: "What happens to [pain] between now and then?" — quantify the cost of inaction before accepting.',
    severity: 2,
  },

  // ── Qualification ───────────────────────────────────────────────
  failed_to_qualify: {
    id: 'failed_to_qualify',
    label: 'Failed to qualify',
    skill: 'qualification',
    whyItHurts: 'Pursuing unqualified deals wastes your most limited resource — time. Every hour on a bad deal is an hour not spent on a real one.',
    whatGoodLooksLike: 'Ask directly: "Help me understand — if we can solve [pain], what does the decision process look like? Who else needs to be involved, and what\'s the timeline?"',
    drillCue: 'Before responding, answer internally: "Does this person have budget, authority, and urgency?" If you can\'t answer yes to all three, your next question should fill the gap.',
    severity: 3,
  },
  accepted_weak_pain: {
    id: 'accepted_weak_pain',
    label: 'Accepted weak pain',
    skill: 'qualification',
    whyItHurts: '"It would be nice to have" is not pain — it\'s a wish. Wishes don\'t get budget, don\'t get executive sponsorship, and don\'t close.',
    whatGoodLooksLike: 'Say: "You mentioned [pain]. Is this a nice-to-have or a must-fix? What breaks if nothing changes in the next 6 months?"',
    drillCue: 'Test the pain: "Is this a priority or an interest?" If they say "interest," ask what would make it a priority.',
    severity: 3,
  },
  no_urgency: {
    id: 'no_urgency',
    label: 'Didn\'t test urgency',
    skill: 'qualification',
    whyItHurts: 'Without urgency, deals live in pipeline forever. They don\'t die — they just never close. Your forecast becomes fiction.',
    whatGoodLooksLike: 'Say: "What would need to happen for this to become a priority this quarter? Is there a trigger — a renewal date, a board meeting, a competitive threat — that creates a deadline?"',
    drillCue: 'Ask: "What\'s the trigger that makes this a now problem vs. a someday problem?" Don\'t move forward until you have an answer.',
    severity: 2,
  },
  skipped_stakeholders: {
    id: 'skipped_stakeholders',
    label: 'Skipped stakeholder mapping',
    skill: 'qualification',
    whyItHurts: 'Selling to one person creates a single point of failure. When it goes to committee, your champion can\'t sell it for you.',
    whatGoodLooksLike: 'Say: "Who else would need to weigh in on this? What would [their CFO/CTO/VP] care about that\'s different from what you care about?"',
    drillCue: 'Ask: "Walk me through how a decision like this gets made. Who else has a voice, and what are their priorities?"',
    severity: 2,
  },
  no_disqualification: {
    id: 'no_disqualification',
    label: 'Didn\'t consider disqualifying',
    skill: 'qualification',
    whyItHurts: 'If you can\'t walk away, you can\'t negotiate from strength. The buyer senses desperation and controls the terms.',
    whatGoodLooksLike: 'Internally score: pain (1–5), authority (1–5), timeline (1–5). If total < 8, say: "I want to be direct — based on what I\'m hearing, I\'m not sure this is the right fit right now. Help me understand what I\'m missing."',
    drillCue: 'Score this opportunity on pain, authority, and timeline (1–5 each). If it\'s below 8, your next move is to challenge the fit directly.',
    severity: 1,
  },
};

/** Get enriched mistake data — falls back to a generic entry if unknown */
export function getMistakeEntry(mistakeId: string): MistakeEntry {
  return MISTAKE_TAXONOMY[mistakeId] ?? {
    id: mistakeId,
    label: mistakeId.replace(/_/g, ' '),
    skill: 'objection_handling' as SkillFocus,
    whyItHurts: 'This pattern weakens your position and gives the buyer control of the conversation.',
    whatGoodLooksLike: 'Be specific. Name the real risk, anchor to a business consequence, and propose a concrete next step.',
    drillCue: 'Rewrite your response: lead with the buyer\'s problem (not your product), add one proof point, and end with a specific ask.',
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
