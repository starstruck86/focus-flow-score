import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// ── Canonical focus pattern IDs ─────────────────────────────────────
const VALID_FOCUS_PATTERNS: Record<string, string[]> = {
  objection_handling: ['isolate_before_answering', 'reframe_to_business_impact', 'use_specific_proof', 'control_next_step', 'stay_concise_under_pressure'],
  discovery: ['deepen_one_level', 'tie_to_business_impact', 'ask_singular_questions', 'test_urgency', 'quantify_the_pain'],
  executive_response: ['lead_with_the_number', 'cut_to_three_sentences', 'anchor_to_their_priority', 'project_certainty', 'close_with_a_specific_ask'],
  deal_control: ['control_next_step', 'name_the_risk', 'lock_mutual_commitment', 'test_before_accepting', 'create_urgency_without_pressure'],
  qualification: ['test_urgency', 'validate_real_pain', 'map_stakeholders', 'disqualify_weak_opportunities', 'tie_problem_to_business_impact'],
};

const ALL_VALID_IDS = new Set(Object.values(VALID_FOCUS_PATTERNS).flat());

// ── Canonical mistake IDs per skill (must match client taxonomy) ────
const VALID_MISTAKES: Record<string, string[]> = {
  objection_handling: ['pitched_too_early', 'weak_objection_handle', 'reactive_not_reframing', 'vendor_language', 'no_business_impact', 'lack_of_control', 'too_generic', 'too_long', 'no_proof', 'weak_close'],
  discovery: ['stacked_questions', 'failed_to_deepen', 'no_business_impact', 'too_generic', 'lack_of_control', 'weak_close', 'pitched_too_early'],
  executive_response: ['too_long', 'no_business_impact', 'too_generic', 'weak_close', 'lack_of_control', 'no_proof', 'pitched_too_early', 'vendor_language'],
  deal_control: ['lack_of_control', 'weak_close', 'vague_next_step', 'too_passive', 'accepted_delay', 'no_mutual_plan', 'too_generic', 'too_long'],
  qualification: ['failed_to_qualify', 'accepted_weak_pain', 'no_urgency', 'skipped_stakeholders', 'too_generic', 'pitched_too_early', 'no_disqualification', 'no_business_impact'],
};
const ALL_VALID_MISTAKES = new Set(Object.values(VALID_MISTAKES).flat());

function normalizeTopMistake(raw: string, skill: string): string {
  if (!raw) return 'too_generic';
  if (ALL_VALID_MISTAKES.has(raw)) return raw;
  const cleaned = raw.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  if (ALL_VALID_MISTAKES.has(cleaned)) return cleaned;
  // Fuzzy match within skill
  const candidates = VALID_MISTAKES[skill] || [];
  const rawWords = raw.toLowerCase().replace(/_/g, ' ').split(' ').filter(w => w.length >= 3);
  let best = ''; let bestScore = 0;
  for (const id of candidates) {
    const idWords = id.split('_');
    let score = 0;
    for (const w of rawWords) { if (idWords.some(k => k.includes(w) || w.includes(k))) score++; }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (bestScore >= 1 && best) return best;
  return 'too_generic'; // safe fallback — always in taxonomy
}

function normalizeFocusPattern(raw: string, skill: string): string {
  if (!raw) return '';
  if (ALL_VALID_IDS.has(raw)) return raw;
  const cleaned = raw.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  if (ALL_VALID_IDS.has(cleaned)) return cleaned;
  const candidates = VALID_FOCUS_PATTERNS[skill] || [];
  const rawWords = raw.toLowerCase().replace(/_/g, ' ').split(' ').filter(w => w.length >= 3);
  let best = ''; let bestScore = 0;
  for (const id of candidates) {
    const idWords = id.split('_');
    let score = 0;
    for (const w of rawWords) { if (idWords.some(k => k.includes(w) || w.includes(k))) score++; }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (bestScore >= 1 && best) return best;
  return candidates[0] || raw;
}

// ── Skill-specific rubrics ──────────────────────────────────────────

const RUBRICS: Record<string, string> = {
  objection_handling: `GRADING CRITERIA (total 100pts):
1. ACKNOWLEDGE (10pts): Did they validate the concern without dismissing it or agreeing too fast?
2. ISOLATE (15pts): Did they surface the real objection behind the stated one with a targeted question?
3. REFRAME (25pts): Did they shift the frame from feature/cost to business risk, cost of inaction, or strategic value?
4. EVIDENCE (15pts): Did they use a specific proof point — a customer name, a metric, a benchmark — not a vague claim?
5. ADVANCE (15pts): Did they maintain control and propose a concrete, time-bound next step?
6. TONE (10pts): Conversational and confident — not defensive, robotic, or over-eager?
7. CONCISENESS (10pts): Tight delivery? No rambling, no stacked questions, no filler?

COMMON MISTAKES (pick the single most impactful):
- pitched_too_early: Jumped to solution before understanding the real concern
- weak_objection_handle: Acknowledged but didn't actually resolve or reframe it
- no_business_impact: Stayed at feature level — never connected to revenue, margin, or risk
- lack_of_control: Let the buyer dictate next steps or ended without a clear ask
- too_generic: Response could be said to any buyer about any product
- too_long: Rambled, over-explained, or stacked multiple questions
- no_proof: Made claims without a single specific example or data point
- weak_close: No clear, confident ask at the end`,

  discovery: `GRADING CRITERIA (total 100pts):
1. DEPTH (25pts): Did they push past the surface answer? Did they ask "why does that matter" or "what happens if you don't fix it"? Simply asking "how much" or "how long" without connecting to business impact is shallow — that's worth at most 10pts.
2. IMPLICATION (20pts): Did they help the buyer see the downstream impact — revenue lost, time wasted, competitive risk, team strain? If they didn't explicitly connect the problem to a business consequence, this is 0-5pts.
3. SPECIFICITY (15pts): Did they use what the buyer said to ask a targeted follow-up — or did they default to a generic question?
4. CONTROL (15pts): Did they steer the conversation toward a business outcome — not just gather information passively?
5. QUANTIFICATION (10pts): Did they try to attach a number, timeline, or measurable cost to the problem?
6. TONE (10pts): Did it feel like a genuine business conversation between equals — not an interrogation or a script?
7. BREVITY (5pts): Were questions concise and singular — not stacked or compound?

SCORING ANCHORS:
- "How much has churn increased?" alone = 55-60.
- "What's that costing you in monthly revenue?" = 62-67.
- "When you lose those customers in month 3, what does that do to your LTV math? And has that changed how your CFO looks at acquisition spend?" = 72-78.

COMMON MISTAKES (pick the single most impactful):
- stacked_questions / failed_to_deepen / no_business_impact / too_generic / lack_of_control / weak_close / pitched_too_early`,

  executive_response: `GRADING CRITERIA (total 100pts):
1. BREVITY (25pts): Could this be delivered in under 30 seconds? ≤2 sentences is elite. 3 sentences is acceptable. 4+ sentences is a fail on this dimension. If the rep opens with setup or context before the outcome, deduct heavily — executives tune out after the first clause if it's not the answer.
2. BUSINESS FRAMING (25pts): Did they lead with an outcome the exec cares about — revenue, margin, speed, risk? First words matter: if the opening sentence doesn't contain a number, dollar amount, or quantified business result, cap this at 12pts. "We help companies..." is a 0.
3. CONFIDENCE (15pts): Did they project certainty? No hedging ("I think," "we believe," "potentially," "it depends"). Every qualifier costs 3pts. Elite reps state outcomes as facts with proof.
4. SPECIFICITY (15pts): Concrete number, benchmark, or customer example? Generic claims ("best in class," "industry-leading," "proven") score 0. A specific customer with a specific metric scores 12+.
5. STRATEGIC RELEVANCE (10pts): Connected to the exec's stated priority? If the exec named a specific initiative and the rep didn't reference it, this is 0. Anchoring to a priority the exec didn't mention is worse than not anchoring at all.
6. CONTROL (10pts): Clear, executive-appropriate ask at the end? Not "thoughts?" but a specific next step.

EXECUTIVE-SPECIFIC SCORING PENALTIES:
- Setup sentence before the answer: -10pts from total. Executives don't need warming up.
- First sentence doesn't contain a number or outcome: -5pts from BUSINESS FRAMING.
- Response exceeds 4 sentences: cap BREVITY at 3/25.
- Uses "I think" or "we believe": cap CONFIDENCE at 8/15.

COMMON MISTAKES: too_long / no_business_impact / too_generic / weak_close / lack_of_control / no_proof / pitched_too_early / vendor_language`,

  deal_control: `GRADING CRITERIA (total 100pts):
1. CONTROL (25pts): Did they take ownership of the next step? Propose a specific action with a date?
2. CLARITY (20pts): Did they define what happens next in concrete, unambiguous terms?
3. COMMITMENT (20pts): Did they secure a concrete commitment — a meeting, a deliverable, a decision date?
4. RISK DETECTION (15pts): Did they identify and address the real risk in the deal?
5. TONE (10pts): Confident and firm without being pushy or transactional?
6. BREVITY (10pts): Tight and purposeful?

COMMON MISTAKES: lack_of_control / weak_close / vague_next_step / too_passive / accepted_delay / no_mutual_plan / too_generic / too_long`,

  qualification: `GRADING CRITERIA (total 100pts):
1. DEPTH (25pts): Did they push past the buyer's surface statement?
2. PAIN VALIDATION (20pts): Did they distinguish between genuine business pain and casual interest?
3. URGENCY (15pts): Did they test whether there's a timeline or trigger event?
4. STAKEHOLDER AWARENESS (15pts): Did they identify who else is involved?
5. BUSINESS IMPACT (15pts): Did they connect the stated problem to a measurable business outcome?
6. CONTROL (10pts): Did they steer toward a qualifying or disqualifying conclusion?

COMMON MISTAKES: failed_to_qualify / accepted_weak_pain / no_urgency / skipped_stakeholders / too_generic / pitched_too_early / no_disqualification / no_business_impact`,
};

// ── Structured scoring dimensions per skill ─────────────────────────
const SKILL_DIMENSIONS: Record<string, Record<string, string>> = {
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
    brevity: 'Response deliverable in under 30 seconds. ≤2 sentences = elite. 4+ sentences = fail. Setup before outcome = 0.',
    numberLed: 'First sentence contains a specific metric, dollar amount, or quantified outcome. "We help companies..." = 0.',
    priorityAnchoring: 'Anchored to the exec\'s stated priority — not the rep\'s pitch. If exec named a goal and rep ignored it = 0.',
    executivePresence: 'Projected certainty. Zero hedging ("I think," "we believe," "potentially"). States outcomes as facts with proof.',
  },
  qualification: {
    painValidation: 'Distinguished genuine business pain from casual interest',
    stakeholderMapping: 'Identified other decision-makers and their roles',
    decisionProcess: 'Tested for timeline, process, and decision criteria',
    disqualification: 'Willingness to disqualify or challenge weak opportunities',
  },
};

function getDimensionPromptBlock(skill: string): string {
  const dims = SKILL_DIMENSIONS[skill];
  if (!dims) return '';
  const entries = Object.entries(dims)
    .map(([key, desc]) => `    "${key}": { "score": 0-10, "reason": "why this score on THIS answer", "evidence": "quote or paraphrase from the rep's actual words", "improvementAction": "specific action to raise this dimension", "targetFor7": "what ~7/10 looks like for this dimension", "targetFor9": "what ~9/10 looks like for this dimension" }  // ${desc}`)
    .join(',\n');
  return `\nSTRUCTURED SCORING (REQUIRED):\nYou MUST return a "dimensions" object with RICH per-dimension explanations tied to the rep's ACTUAL response.\nOnly score dimensions listed below. Do NOT invent new ones.\n\n  "dimensions": {\n${entries}\n  }\n\nDimension scoring guide: 0-2 not present, 3-4 attempted but weak, 5-6 competent, 7-8 genuinely strong, 9-10 elite.\n\nCRITICAL for dimensions:\n- "reason" must reference the rep's actual answer, not generic rubric language\n- "evidence" must quote or closely paraphrase actual words from the rep's response\n- "improvementAction" must be a concrete, single-sentence behavioral fix\n- "targetFor7" and "targetFor9" must be specific to this scenario, not generic`;
}

interface DimensionDetail {
  score: number;
  reason: string;
  evidence: string;
  improvementAction: string;
  targetFor7: string;
  targetFor9: string;
}

function parseDimensions(raw: unknown, skill: string): Record<string, DimensionDetail> | null {
  if (!raw || typeof raw !== 'object') return null;
  const validKeys = new Set(Object.keys(SKILL_DIMENSIONS[skill] || {}));
  const result: Record<string, DimensionDetail> = {};
  let found = 0;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!validKeys.has(key)) continue;
    // Support both rich object format and legacy number format
    if (typeof val === 'number') {
      result[key] = {
        score: Math.max(0, Math.min(10, Math.round(val))),
        reason: '',
        evidence: '',
        improvementAction: '',
        targetFor7: '',
        targetFor9: '',
      };
      found++;
    } else if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>;
      const score = typeof v.score === 'number' ? Math.max(0, Math.min(10, Math.round(v.score))) : 5;
      result[key] = {
        score,
        reason: typeof v.reason === 'string' ? v.reason : '',
        evidence: typeof v.evidence === 'string' ? v.evidence : '',
        improvementAction: typeof v.improvementAction === 'string' ? v.improvementAction : '',
        targetFor7: typeof v.targetFor7 === 'string' ? v.targetFor7 : '',
        targetFor9: typeof v.targetFor9 === 'string' ? v.targetFor9 : '',
      };
      found++;
    }
  }
  if (found < Math.ceil(validKeys.size / 2)) return null;
  for (const key of validKeys) {
    if (!(key in result)) result[key] = { score: 5, reason: '', evidence: '', improvementAction: '', targetFor7: '', targetFor9: '' };
  }
  return result;
}

// ── Coaching tone ───────────────────────────────────────────────────

const COACHING_TONE: Record<string, string> = {
  objection_handling: `You are an elite sales coach doing a post-call debrief. You've watched 10,000 objection handles and can tell in the first sentence whether a rep will win or lose.

YOUR FEEDBACK STYLE FOR OBJECTION HANDLING:

TOP-LINE VERDICT (first sentence of "feedback"):
- Diagnose the core failure pattern in the rep's actual words. Quote or paraphrase their mistake.
- Good verdicts: "You answered the objection before diagnosing it — that's counter-punching, not handling." / "You acknowledged but never redirected — the buyer still owns the frame." / "You went straight to features — the buyer said 'too expensive' and you heard 'explain the product.'" / "Strong — you isolated the real concern and redirected to business impact."
- Bad verdicts: "Needs work." / "Try to acknowledge better." / "Good attempt."
- If they pitched into the objection, say: "You jumped to [quote their pitch] before understanding what's really behind '[quote objection].' Diagnose first."
- If they didn't isolate, say: "The buyer said '[quote objection]' — but what's the real concern? You never asked."
- If they had no proof, say: "You made a claim but gave zero evidence. Name a customer, a number, or a benchmark."

REWRITE RULES (for "improvedVersion"):
- Must follow Acknowledge → Isolate → Reframe → Evidence → Advance structure
- Must sound conversational, not scripted
- Must include at least one specific proof point
- Must end with a clear, confident next step

NEXT-REP CUE (for "practiceCue"):
- Must be a single, constraint-based instruction
- Good: "Next rep: ask one diagnostic question before saying anything about your product." / "Next rep: your first sentence must acknowledge their concern using their exact words." / "Next rep: include a specific customer name and metric in your reframe."
- Bad: "Work on your objection handling skills." / "Be more confident."`,

  discovery: `You are a veteran sales leader who has run thousands of discoveries. You can hear when a rep accepts a surface answer and moves on — and it makes you cringe.

YOUR FEEDBACK STYLE FOR DISCOVERY:

TOP-LINE VERDICT (first sentence of "feedback"):
- Diagnose exactly where they stopped digging. Quote the moment they accepted a surface answer.
- Good verdicts: "The buyer said 'churn is up' and you moved on — that's where the real conversation should have started." / "You asked 'how much' but never asked 'what does that cost you' — that's the gap." / "You stacked three questions in one sentence — the buyer answered the easiest one and you lost the thread." / "Sharp — you pushed past the surface and connected to revenue impact."
- Bad verdicts: "Dig deeper next time." / "Good questions." / "Try to be more specific."
- If they stacked questions: "You asked '[quote stacked question]' — that's 3 questions. The buyer picked the easiest one. Ask one question, then wait."
- If they didn't quantify: "The buyer told you the problem. You never attached a number to it. No number = no urgency."
- If they stayed surface: "You accepted '[quote surface answer]' at face value. What happens if they don't fix it? What's it costing them? That's where you needed to go."

REWRITE RULES (for "improvedVersion"):
- Must push one level deeper than the rep went
- Must include a question that connects to business impact (revenue, cost, time, risk)
- Must be a single, focused follow-up — not a stack
- Must sound like a business advisor, not an interrogator

NEXT-REP CUE (for "practiceCue"):
- Must be a single, constraint-based instruction
- Good: "Next rep: after the buyer answers, your next words must be 'What does that cost you?'" / "Next rep: you may only ask one question per turn — no stacking." / "Next rep: your follow-up must contain the word 'revenue,' 'cost,' or 'risk.'"
- Bad: "Ask better discovery questions." / "Go deeper."`,

  executive_response: `You are someone who has coached 200+ AEs for C-suite meetings. You've watched reps blow million-dollar meetings in the first sentence.

YOUR FEEDBACK STYLE FOR EXECUTIVE RESPONSE:

TOP-LINE VERDICT (first sentence of "feedback"):
- Diagnose the core failure pattern in the rep's actual words. Quote or paraphrase their mistake.
- Good verdicts: "You opened with context instead of the outcome — the exec checked out after your first clause." / "The number came in sentence three. The exec should hear it first." / "You hedged with 'I think' — executives hear uncertainty, not insight." / "Strong — direct, quantified, anchored to their priority."
- Bad verdicts: "Needs improvement." / "Try to be more concise." / "Good effort but could be tighter."
- If they used a setup sentence before the value, say exactly: "You started with [quote their opening phrase] — that's setup. Delete it. Start with [what should have been first]."
- If they didn't lead with a number, say: "Your first sentence had no number. Executives need to hear the dollar figure or metric before anything else."
- If they hedged, quote the hedge word: "You said '[their hedge word]' — that's uncertainty. State it as fact."

REWRITE RULES (for "improvedVersion"):
- MUST be ≤2 sentences for executive_response
- First sentence MUST contain a specific number, dollar amount, percentage, or metric
- Must sound like something a real person would say out loud — not robotic or templated
- Must anchor to the exec's stated priority when one exists
- Zero hedging, zero setup, zero filler

REWRITE PATTERNS TO USE:
- ROI skepticism → "You're losing $X per [period] from [specific problem]. We cut that by Y% — payback is Z weeks."
- Strategic priority shift → "[Their priority] is costing you $X in [metric]. We move that needle by Y% in [timeframe]."
- "Heard this before" → "The difference is [specific metric]: [customer name] saw X% improvement in Y weeks. Happy to connect you."
- Tool fatigue → "Unlike [what failed before], we [specific differentiator]. [Customer] went live in X weeks, not months."
- Time pressure → "$X in [lost revenue/cost]. Fixed in Y weeks. [One-sentence proof point]."

WHY IT WORKS (for "whyItWorks"):
- Explain what changed between their version and the rewrite in concrete terms
- Name the structural shift: "The rewrite leads with the cost of the problem, not the description of the solution"
- Keep to 2 bullets max

NEXT-REP CUE (for "practiceCue"):
- Must be a single, constraint-based instruction
- Good: "Next rep: your first three words must be a dollar amount." / "Next rep: no sentence can start with 'We' or 'Our'." / "Next rep: delete your first sentence entirely and start with the second."
- Bad: "Keep practicing brevity and confidence." / "Try to be more executive-ready."`,

  deal_control: `You are a sales leader who has reviewed 5,000 pipeline deals. You can smell a stalled deal from the first sentence of a forecast update. You know that most deals die not from objections but from lack of control.

YOUR FEEDBACK STYLE FOR DEAL CONTROL:

TOP-LINE VERDICT (first sentence of "feedback"):
- Diagnose exactly where they lost control of the deal. Quote the moment they accepted vagueness.
- Good verdicts: "The buyer said 'let me think about it' and you said 'sounds good' — you just gave away control of the timeline." / "You named the risk but didn't lock a commitment — naming it without acting on it is just commentary." / "You accepted 'I'll circle back' without defining what 'back' means — that's a dead deal walking." / "Strong — you named the risk, proposed a specific next step, and got a commitment."
- Bad verdicts: "Work on deal control." / "Good follow-up." / "Be more assertive."
- If they accepted a delay: "The buyer said '[quote delay]' and you accepted it. What specifically needs to happen before they can decide? You never asked."
- If no mutual plan: "You proposed a next step but didn't define what the buyer is committing to. A meeting without mutual accountability is just a conversation."
- If too passive: "You asked 'what do you think?' instead of proposing 'here's what I recommend we do by [date].' Control means leading, not asking."

REWRITE RULES (for "improvedVersion"):
- Must include a specific, time-bound next step
- Must define mutual accountability (what both sides will do)
- Must name the risk or consequence of delay when relevant
- Must sound firm but collaborative — not pushy

NEXT-REP CUE (for "practiceCue"):
- Must be a single, constraint-based instruction
- Good: "Next rep: end with a specific date and action — not 'let's reconnect soon.'" / "Next rep: before accepting any timeline, ask 'What needs to happen between now and then?'" / "Next rep: name what the buyer is committing to, not just what you'll do."
- Bad: "Be more assertive." / "Control the deal better."`,

  qualification: `You are a sales leader who values pipeline quality over quantity. You've watched reps waste months on deals that were never real. You know the difference between enthusiasm and qualification — and most reps don't.

YOUR FEEDBACK STYLE FOR QUALIFICATION:

TOP-LINE VERDICT (first sentence of "feedback"):
- Diagnose exactly where they failed to qualify or disqualify. Quote the signal they missed.
- Good verdicts: "The buyer said 'I love this!' but has no budget, no authority, and no timeline — you treated enthusiasm as qualification." / "You accepted 'we'll find budget' without asking who controls it — that's hope, not qualification." / "The buyer deflected every process question and you kept selling — that's a red flag you ignored." / "Sharp — you tested urgency, mapped stakeholders, and identified the real blocker."
- Bad verdicts: "Qualify better." / "Ask about the decision process." / "Good discovery."
- If they accepted weak pain: "The buyer said '[quote vague pain]' — is that a real business problem or a nice-to-have? You never tested it."
- If they skipped stakeholders: "You're four calls in and you've met one person. Who else needs to approve this? You never asked."
- If no urgency test: "The buyer has no timeline, no trigger event, and no consequence of waiting. Why is this deal in your pipeline?"
- If they didn't disqualify: "This buyer has enthusiasm but no authority. A great qualifier would say: 'I want to make sure we're both investing time wisely — can you walk me through how a decision like this gets made?'"

REWRITE RULES (for "improvedVersion"):
- Must include at least one qualifying or disqualifying question
- Must test for real pain, authority, urgency, or process — not just interest
- Must sound respectful but rigorous — frame it as protecting the buyer's time too
- Must avoid accepting vague answers at face value

NEXT-REP CUE (for "practiceCue"):
- Must be a single, constraint-based instruction
- Good: "Next rep: before any pricing discussion, ask 'Who else needs to approve this and what's their timeline?'" / "Next rep: when the buyer says 'we need this,' respond with 'What happens if you don't do it this quarter?'" / "Next rep: you must ask one disqualifying question — something that could kill the deal."
- Bad: "Qualify the opportunity better." / "Ask about decision-makers."`,
};

const WORLD_CLASS_TONE: Record<string, string> = {
  objection_handling: 'calm, specific, isolates before pitching, reframes to business value, moves forward with control',
  discovery: 'deepens pain fast, connects to business implications, asks sharp singular questions, sounds like a business advisor',
  executive_response: 'concise (≤2 sentences), opens with a specific number or dollar figure, anchors to the exec\'s stated priority, projects absolute certainty, ends with a clear ask — zero filler, zero hedging, zero setup',
  deal_control: 'disciplined, clear about next steps, unafraid to name drift or risk, locks mutual accountability',
  qualification: 'rigorous, skeptical in the right way, willing to disqualify, tests urgency and stakeholders before advancing',
};

const FOCUS_PATTERN_GUIDE: Record<string, string> = {
  objection_handling: `FOCUS PATTERNS (pick ONE from this EXACT list):
- isolate_before_answering
- reframe_to_business_impact
- use_specific_proof
- control_next_step
- stay_concise_under_pressure`,
  discovery: `FOCUS PATTERNS (pick ONE from this EXACT list):
- deepen_one_level
- tie_to_business_impact
- ask_singular_questions
- test_urgency
- quantify_the_pain`,
  executive_response: `FOCUS PATTERNS (pick ONE from this EXACT list):
- lead_with_the_number
- cut_to_three_sentences
- anchor_to_their_priority
- project_certainty
- close_with_a_specific_ask`,
  deal_control: `FOCUS PATTERNS (pick ONE from this EXACT list):
- control_next_step
- name_the_risk
- lock_mutual_commitment
- test_before_accepting
- create_urgency_without_pressure`,
  qualification: `FOCUS PATTERNS (pick ONE from this EXACT list):
- test_urgency
- validate_real_pain
- map_stakeholders
- disqualify_weak_opportunities
- tie_problem_to_business_impact`,
};

const POSITIVE_PATTERNS = /\b(great job|nice work|well done|excellent|impressive|strong response|good job|solid attempt|good effort|nicely done|smart move|clever)\b/gi;
const BUSINESS_IMPACT_PATTERNS = /\b(revenue|margin|cost|ROI|LTV|CAC|churn rate|pipeline|quota|P&L|profit|savings|payback|ARR|MRR|\$\d|percent|%|\d+x)\b/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { scenario, userResponse, retryCount, focusReminder } = await req.json();
    if (!scenario || !userResponse) {
      return new Response(JSON.stringify({ error: "Missing scenario or userResponse" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const skill = scenario.skillFocus || "objection_handling";
    const rubric = RUBRICS[skill] || RUBRICS.objection_handling;
    const tone = COACHING_TONE[skill] || COACHING_TONE.objection_handling;
    const focusPatternGuide = FOCUS_PATTERN_GUIDE[skill] || FOCUS_PATTERN_GUIDE.objection_handling;

    const retryBlock = retryCount > 0
      ? `This is retry #${retryCount}.${focusReminder ? ` The rep was told to focus on: "${focusReminder}". You MUST explicitly assess whether they applied this pattern. If they did, name exactly how in your feedback. If they didn't, call it out directly: "You were asked to focus on ${focusReminder} — this attempt still doesn't do that." Do not ignore the focus reminder.

FOCUS APPLICATION ASSESSMENT (REQUIRED for retries):
You MUST return these two fields:
- "focusApplied": "yes" if the rep clearly applied the assigned focus, "partial" if they attempted it but incompletely, "no" if they did not apply it at all.
- "focusAppliedReason": One sentence explaining your assessment. Be specific: name what the rep did or didn't do relative to the focus pattern.` : ''} Compare to what a first attempt typically looks like. If they improved, name exactly what changed. If they didn't improve meaningfully, say so directly.`
      : '';

    const wcTone = WORLD_CLASS_TONE[skill] || 'calm, specific, commercially sharp, confident';

    const systemPrompt = `You are Dave — an elite sales coach. You are sharp, direct, and hold a high standard. But you are also encouraging — you believe this rep can improve quickly with focused repetition. You never give fake praise, but you acknowledge real progress and frame every gap as a specific thing to practice next.

${tone}

${rubric}

${focusPatternGuide}

${getDimensionPromptBlock(skill)}

CRITICAL: focusPattern MUST be selected from the EXACT list above. Do not invent new pattern names.

SCORE CALIBRATION (CRITICAL — follow this distribution strictly):
- 85-100: Exceptional. Would make a VP of Sales stop and say "that was really good." Almost never on first attempt.
- 75-84: Genuinely strong. Hit the key beats with specificity. Uncommon.
- 60-69: Average. This is where MOST responses land. Competent but predictable.
- 50-59: Below average. Missed the real issue, stayed surface-level, lost control, or went generic.
- 40-49: Weak. Defensive, rambling, pitched into resistance, or misread the situation.
- Below 40: Actively harmful.

YOUR DEFAULT SCORE IS 58-63. If you're about to give above 70, ask yourself: "Would a VP of Sales watching this live be impressed?" If no, the score is too high.

${retryBlock}

RESPONSE RULES:
- "feedback": Exactly 2 sentences. Sentence 1: quote or paraphrase the rep's actual words to show what went right or wrong — be specific. Sentence 2: the ONE structural fix that would make this significantly better.${skill === 'executive_response' ? ` Example: "You opened with 'So our platform helps companies...' — that's a setup sentence the exec didn't ask for. Lead with the dollar figure: their cost of inaction."` : ''}
- "improvedVersion": Exact words a better rep would say OUT LOUD. ${skill === 'executive_response' ? '≤2 sentences. First sentence must contain a number. Zero setup.' : '3-5 sentences. Must fix the specific mistake identified.'} Achievable upgrade.
- "worldClassResponse": What a top 1% rep would ACTUALLY SAY from scratch. MATERIALLY STRONGER than improvedVersion. For ${skill}: ${wcTone}
- "whyItWorks": 2-3 bullets explaining UNDERLYING PATTERNS of worldClassResponse. Reusable principles.
- "moveSequence": 2-4 verb-first steps showing the STRUCTURE of worldClassResponse. Scenario-specific.
- "patternTags": 2-4 snake_case REUSABLE selling behaviors. Portable across scenarios.
- "focusPattern": Single pattern from the FOCUS PATTERNS list above. MUST be from that exact list.
- "focusReason": One sentence starting with "Because" explaining why this is highest-leverage.
- "practiceCue": One concrete, constraint-based behavioral instruction for the retry. Must be a single rule the rep can immediately apply. Good: "Your first sentence must acknowledge using their exact words." Bad: "Be more confident."
- "teachingNote": One sentence generalizing the lesson beyond this scenario.
- "deltaNote": One sentence explaining the BIGGEST DIFFERENCE between improvedVersion and worldClassResponse.
- "topMistake": REQUIRED. Pick exactly ONE from the COMMON MISTAKES list above. You MUST always return a valid mistake code — never leave this empty or invent a new one.

COHERENCE RULE (CRITICAL):
feedback, topMistake, focusPattern, focusReason, and practiceCue MUST all point at the SAME core coaching lesson.

MISTAKE SELECTION PRIORITY (CRITICAL — when multiple mistakes are present, pick the highest-leverage one):
Priority 1 — CONTROL failures: Did the rep lose control of the conversation or next steps? (lack_of_control, weak_close, vague_next_step, too_passive, accepted_delay, no_mutual_plan). These kill deals.
Priority 2 — STRUCTURAL failures: Did the rep pitch before understanding, miss the real issue, or fail to qualify? (pitched_too_early, failed_to_qualify, reactive_not_reframing, accepted_weak_pain, failed_to_deepen). These waste cycles.
Priority 3 — CONTENT failures: Was the response missing proof, impact, or specificity? (no_business_impact, no_proof, too_generic, vendor_language). These weaken positioning.
Priority 4 — STYLE failures: Was the response too long or questions stacked? (too_long, stacked_questions, no_urgency, skipped_stakeholders, no_disqualification). These reduce effectiveness.

TIE-BREAKING: If a control failure AND a content failure are both present, ALWAYS pick the control failure — the rep can add better content later, but losing control loses the deal now. Exception: if the rep literally pitched product features into an objection (pitched_too_early), that trumps weak_close because the fundamental approach was wrong.

TONE RULES:
- Below 70: encouraging but NOT falsely positive. AVOID "great job", "solid work", etc.

Respond with ONLY valid JSON:
{
  "score": 60,
  "dimensions": { ... },
  "feedback": "What they got right. The one thing to improve.",
  "topMistake": "one_mistake_code",
  "improvedVersion": "Better version of the rep's approach.",
  "worldClassResponse": "What an elite rep would naturally say from scratch.",
  "whyItWorks": ["Reusable pattern 1", "Reusable pattern 2"],
  "moveSequence": ["step 1", "step 2", "step 3"],
  "patternTags": ["pattern_one", "pattern_two"],
  "focusPattern": "single_focus_pattern",
  "focusReason": "Because the biggest gap here was X.",
  "practiceCue": "Short behavioral instruction.",
  "teachingNote": "General coaching principle from this rep.",
  "deltaNote": "One sentence on the biggest difference between improvedVersion and worldClassResponse."
}` + (retryCount > 0 ? `

RETRY-ONLY FIELDS (you MUST include these since this is a retry):
Add these to your JSON response:
  "focusApplied": "yes" or "partial" or "no",
  "focusAppliedReason": "One sentence."` : '') + (scenario.multiThread?.active ? `

MULTI-STAKEHOLDER ASSESSMENT (REQUIRED — this scenario contains stakeholder tension):
The buyer input includes multiple stakeholder viewpoints, conflicting priorities, or internal tension.

1. Identify the distinct stakeholder perspectives present.
2. Evaluate whether the rep:
   - acknowledged multiple perspectives
   - aligned them into a shared direction
   - or focused too narrowly on one stakeholder
3. Evaluate whether the rep strengthened an internal champion or left internal resistance unresolved.
4. Evaluate whether the response improved deal momentum.

IMPORTANT: Do NOT invent stakeholders that are not present. Only assess what is genuinely in the scenario.

Add this to your JSON response:
  "multiThread": {
    "stakeholdersDetected": ["role1", "role2"],
    "stakeholdersAddressed": ["role1"],
    "alignmentScore": 0-100,
    "championStrengthScore": 0-100,
    "politicalAwarenessScore": 0-100,
    "dealMomentum": "forward" or "neutral" or "at_risk",
    "breakdown": {
      "missedStakeholders": ["role2"],
      "conflictingSignalsUnresolved": false,
      "wrongPriorityFocus": false,
      "statusQuoDefenderIgnored": false
    },
    "coachingNote": "1-2 sentences on internal deal movement."
  }

SCORING GUIDE for multiThread:
- alignmentScore HIGH: rep connects multiple perspectives into one shared problem or decision path
- alignmentScore LOW: rep answers only one stakeholder, leaves conflict unresolved
- championStrengthScore HIGH: rep arms someone with language, framing, or a usable next step internally
- championStrengthScore LOW: rep weakens the likely champion or gives nothing reusable
- politicalAwarenessScore HIGH: rep reads the room correctly, knows when to align, challenge, or structure
- politicalAwarenessScore LOW: over-indexes on the loudest voice, ignores status-quo defenders
- dealMomentum "forward": clearer path, more internal alignment, better decision movement
- dealMomentum "neutral": handled but not moved
- dealMomentum "at_risk": conflict increased or likely blocker ignored
Keep coachingNote short and concrete. Anchor judgment to internal deal movement, not just correctness.` : '');

    // Build stakeholder context for multi-thread scenarios
    let stakeholderBlock = '';
    if (scenario.multiThread?.active && Array.isArray(scenario.multiThread.stakeholders)) {
      const lines = scenario.multiThread.stakeholders.map((sh: { role: string; stance: string; priority: string; perspective: string }) =>
        `- ${sh.role} (${sh.stance}, priority: ${sh.priority}): "${sh.perspective}"`
      );
      const tensionLabel = scenario.multiThread.tensionType ? ` Tension type: ${scenario.multiThread.tensionType.replace(/_/g, ' ')}.` : '';
      stakeholderBlock = `\n\nSTAKEHOLDER CONTEXT:${tensionLabel}\n${lines.join('\n')}`;
    }

    const userPrompt = `SCENARIO:
Skill being tested: ${skill}
Situation: ${scenario.context}
Buyer says: "${scenario.objection}"${stakeholderBlock}

REP'S RESPONSE:
"${userResponse}"

Grade this response strictly. Your default is 58-63. Go higher only if genuinely earned.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limited — try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI request failed: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(content);

    // ── Server-side enforcement ─────────────────────────────────
    if (typeof parsed.score === "number") parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));

    if (skill === "executive_response" && typeof userResponse === "string") {
      const sc = userResponse.split(/[.!?]+/).filter((s: string) => s.trim().length > 5).length;
      if (sc > 5 && parsed.score > 60) parsed.score = 60;
    }
    if (typeof userResponse === "string") {
      const sc = userResponse.split(/[.!?]+/).filter((s: string) => s.trim().length > 5).length;
      if (sc < 2 && parsed.score > 55) parsed.score = 55;
    }

    // ── Parse and validate structured dimensions ──────────────────
    parsed.dimensions = parseDimensions(parsed.dimensions, skill);

    // ── Compute Primary Coaching Lever (server-side, canonical algorithm) ──
    // This MUST match the client-side computeLeverSelection in leverConfig.ts.
    // Constants are duplicated here because edge functions can't import from src/.
    // Any change to leverConfig.ts MUST be mirrored here.
    if (parsed.dimensions) {
      const STRAT_PRIORITY: Record<string, string[]> = {
        executive_response: ['numberLed', 'brevity', 'priorityAnchoring', 'executivePresence'],
        objection_handling: ['isolation', 'reframing', 'commitmentControl', 'proof', 'composure'],
        discovery: ['painExcavation', 'businessImpact', 'questionArchitecture', 'painQuantification', 'urgencyTesting', 'stakeholderDiscovery'],
        deal_control: ['nextStepControl', 'riskNaming', 'mutualPlan', 'stakeholderAlignment'],
        qualification: ['painValidation', 'disqualification', 'decisionProcess', 'stakeholderMapping'],
      };
      const OPENING_DIMS = new Set(['numberLed', 'brevity', 'composure', 'questionArchitecture', 'painValidation', 'nextStepControl']);
      const DIM_WEIGHTS: Record<string, Record<string, number>> = {
        executive_response: { brevity: 25, numberLed: 25, priorityAnchoring: 25, executivePresence: 25 },
        objection_handling: { composure: 15, isolation: 25, reframing: 25, proof: 15, commitmentControl: 20 },
        discovery: { questionArchitecture: 15, painExcavation: 25, painQuantification: 15, businessImpact: 20, urgencyTesting: 15, stakeholderDiscovery: 10 },
        deal_control: { nextStepControl: 30, riskNaming: 25, mutualPlan: 25, stakeholderAlignment: 20 },
        qualification: { painValidation: 30, stakeholderMapping: 20, decisionProcess: 25, disqualification: 25 },
      };
      // Tuning constants — MUST match leverConfig.ts LEVER_TUNING
      const STRAT_MAX = 35;
      const OPEN_MAX = 20;
      const BONUS_THRESH = 6;
      const SEVERE_MULT = 1.3;
      const SEVERE_THRESH = 3;

      const priorities = STRAT_PRIORITY[skill] || [];
      const weights = DIM_WEIGHTS[skill] || {};
      const dims = parsed.dimensions as Record<string, DimensionDetail>;

      let bestKey = ''; let bestLeverScore = -1;
      let weakestKey = ''; let weakestScore = 11;
      let biggestDragKey = ''; let biggestDragGap = -1;

      for (const [key, detail] of Object.entries(dims)) {
        if (!(key in weights)) continue;
        const s = detail.score;
        const w = weights[key];

        if (s < weakestScore) { weakestScore = s; weakestKey = key; }
        let wGap = (10 - s) * w;
        if (s <= SEVERE_THRESH) wGap *= SEVERE_MULT;
        if (wGap > biggestDragGap) { biggestDragGap = wGap; biggestDragKey = key; }

        if (s >= 8) continue;
        const pIdx = priorities.indexOf(key);
        let stratBonus = 0;
        if (pIdx >= 0) {
          const rawB = (priorities.length - pIdx) / priorities.length * STRAT_MAX;
          const scale = Math.max(0, Math.min(1, (BONUS_THRESH - s + 2) / (BONUS_THRESH - 2)));
          stratBonus = rawB * scale;
        }
        let openBonus = 0;
        if (OPENING_DIMS.has(key)) {
          const scale = Math.max(0, Math.min(1, (BONUS_THRESH - s + 2) / (BONUS_THRESH - 2)));
          openBonus = OPEN_MAX * scale;
        }
        const leverScore = wGap + stratBonus + openBonus;
        if (leverScore > bestLeverScore) { bestLeverScore = leverScore; bestKey = key; }
      }

      if (bestKey) {
        parsed.primaryCoachingLever = bestKey;
        parsed.weakestDimension = weakestKey;
        parsed.biggestWeightedDrag = biggestDragKey;
        const parts: string[] = [];
        const pIdx = priorities.indexOf(bestKey);
        if (pIdx >= 0 && pIdx < 2) parts.push('strategic priority');
        if (OPENING_DIMS.has(bestKey)) parts.push('opening-shaping');
        if (bestKey === biggestDragKey) parts.push('biggest weighted drag');
        if (weakestScore <= SEVERE_THRESH && bestKey === weakestKey) parts.push('severe miss');
        parsed.whyPrimaryLeverWasChosen = parts.length > 0
          ? `${bestKey}: ${parts.join(', ')} (leverScore=${bestLeverScore.toFixed(1)})`
          : `${bestKey}: highest combined leverage (${bestLeverScore.toFixed(1)})`;
        parsed.leverDiffersFromWeakest = bestKey !== weakestKey;
        parsed.serverLeverScore = bestLeverScore; // for client-side mismatch detection
      }
    }

    // Ensure fields exist
    if (!Array.isArray(parsed.patternTags)) parsed.patternTags = [];
    if (typeof parsed.focusPattern !== "string") parsed.focusPattern = "";
    if (!Array.isArray(parsed.moveSequence)) parsed.moveSequence = [];
    if (typeof parsed.focusReason !== "string") parsed.focusReason = "";
    if (typeof parsed.practiceCue !== "string") parsed.practiceCue = "";
    if (typeof parsed.teachingNote !== "string") parsed.teachingNote = "";
    if (typeof parsed.deltaNote !== "string") parsed.deltaNote = "";
    if (!Array.isArray(parsed.whyItWorks)) parsed.whyItWorks = [];
    if (retryCount > 0) {
      if (typeof parsed.focusApplied !== "string" || !["yes", "partial", "no"].includes(parsed.focusApplied)) parsed.focusApplied = "no";
      if (typeof parsed.focusAppliedReason !== "string") parsed.focusAppliedReason = "";
    }

    // ── V6: Normalize multiThread if present ────────────────────
    if (scenario.multiThread?.active && parsed.multiThread) {
      const mt = parsed.multiThread;
      if (!Array.isArray(mt.stakeholdersDetected)) mt.stakeholdersDetected = [];
      if (!Array.isArray(mt.stakeholdersAddressed)) mt.stakeholdersAddressed = [];
      if (typeof mt.alignmentScore !== "number") mt.alignmentScore = 0;
      if (typeof mt.championStrengthScore !== "number") mt.championStrengthScore = 0;
      if (typeof mt.politicalAwarenessScore !== "number") mt.politicalAwarenessScore = 0;
      if (!["forward", "neutral", "at_risk"].includes(mt.dealMomentum)) mt.dealMomentum = "neutral";
      if (typeof mt.coachingNote !== "string") mt.coachingNote = "";
      // Clamp scores
      mt.alignmentScore = Math.max(0, Math.min(100, Math.round(mt.alignmentScore)));
      mt.championStrengthScore = Math.max(0, Math.min(100, Math.round(mt.championStrengthScore)));
      mt.politicalAwarenessScore = Math.max(0, Math.min(100, Math.round(mt.politicalAwarenessScore)));
    } else {
      // Strip multiThread if not a multi-thread scenario
      delete parsed.multiThread;
    }

    // ── Normalize topMistake to canonical taxonomy ────────────────
    parsed.topMistake = normalizeTopMistake(parsed.topMistake || '', skill);

    // ── Normalize focusPattern to canonical list ─────────────────
    if (parsed.focusPattern) {
      parsed.focusPattern = normalizeFocusPattern(parsed.focusPattern, skill);
    }

    // ── Targeted regeneration ───────────────────────────────────
    const needsRegen: string[] = [];

    if (parsed.score < 70 && typeof parsed.feedback === "string" && POSITIVE_PATTERNS.test(parsed.feedback)) {
      needsRegen.push("feedback");
    }
    if (parsed.topMistake === "no_business_impact" && typeof parsed.improvedVersion === "string" && !BUSINESS_IMPACT_PATTERNS.test(parsed.improvedVersion)) {
      needsRegen.push("improvedVersion");
    }
    if (parsed.topMistake === "too_long" && typeof parsed.improvedVersion === "string" && typeof userResponse === "string" && parsed.improvedVersion.length > userResponse.length) {
      if (!needsRegen.includes("improvedVersion")) needsRegen.push("improvedVersion");
    }
    if (skill === "executive_response" && typeof parsed.improvedVersion === "string") {
      const ivS = parsed.improvedVersion.split(/[.!?]+/).filter((s: string) => s.trim().length > 5).length;
      if (ivS > 5 && !needsRegen.includes("improvedVersion")) needsRegen.push("improvedVersion");
    }
    if (typeof parsed.focusReason === "string" && parsed.focusReason.length > 0 && !parsed.focusReason.startsWith("Because")) {
      needsRegen.push("focusReason");
    }
    const VAGUE_CUE_PATTERNS = /^(focus on|improve|show more|be more|work on|try to)/i;
    if (typeof parsed.practiceCue === "string" && (parsed.practiceCue.split(" ").length < 4 || VAGUE_CUE_PATTERNS.test(parsed.practiceCue))) {
      if (!needsRegen.includes("practiceCue")) needsRegen.push("practiceCue");
    }

    // Coherence: focusPattern should remedy topMistake
    if (parsed.focusPattern && parsed.topMistake) {
      const tmWords = parsed.topMistake.replace(/_/g, ' ').toLowerCase();
      const fpWords = parsed.focusPattern.replace(/_/g, ' ').toLowerCase();
      const tmTokens = tmWords.split(' ');
      const fpTokens = fpWords.split(' ');
      const hasOverlap = tmTokens.some((t: string) => fpTokens.includes(t)) ||
        (tmWords.includes('impact') && fpWords.includes('impact')) ||
        (tmWords.includes('control') && fpWords.includes('control')) ||
        (tmWords.includes('close') && fpWords.includes('step')) ||
        (tmWords.includes('generic') && (fpWords.includes('specific') || fpWords.includes('proof'))) ||
        (tmWords.includes('long') && fpWords.includes('concise')) ||
        (tmWords.includes('deepen') && fpWords.includes('deepen')) ||
        (tmWords.includes('qualify') && (fpWords.includes('pain') || fpWords.includes('urgency') || fpWords.includes('stakeholder'))) ||
        (tmWords.includes('passive') && fpWords.includes('control'));
      if (!hasOverlap) {
        if (!needsRegen.includes("focusPattern")) needsRegen.push("focusPattern");
        if (!needsRegen.includes("practiceCue")) needsRegen.push("practiceCue");
        if (!needsRegen.includes("focusReason")) needsRegen.push("focusReason");
      }
    }

    if (needsRegen.length > 0) {
      const triggerReasons: Record<string, string> = {};
      const regenParts: string[] = [];

      if (needsRegen.includes("feedback")) {
        triggerReasons.feedback = "positive_language_in_low_score";
        regenParts.push(`REGENERATE "feedback": Rewrite to be direct but encouraging — no generic praise. 2 sentences.`);
      }
      if (needsRegen.includes("improvedVersion")) {
        const reasons: string[] = [];
        if (parsed.topMistake === "no_business_impact") reasons.push("must include business impact language");
        if (parsed.topMistake === "too_long") reasons.push("must be shorter than rep's response");
        if (skill === "executive_response") reasons.push("must be under 4 sentences");
        triggerReasons.improvedVersion = reasons.join("; ") || "consistency_check_failed";
        regenParts.push(`REGENERATE "improvedVersion": Issues: ${reasons.join("; ")}. Write exact words a top rep would say OUT LOUD.`);
      }
      if (needsRegen.includes("focusReason")) {
        triggerReasons.focusReason = "missing_because_prefix";
        regenParts.push(`REGENERATE "focusReason": Must start with "Because" and reference rep's actual miss.`);
      }
      if (needsRegen.includes("practiceCue")) {
        triggerReasons.practiceCue = "too_vague";
        regenParts.push(`REGENERATE "practiceCue": Rewrite as one concrete behavioral instruction the rep can immediately execute.`);
      }
      if (needsRegen.includes("focusPattern")) {
        const validList = (VALID_FOCUS_PATTERNS[skill] || []).join(', ');
        triggerReasons.focusPattern = "misaligned_with_topMistake";
        regenParts.push(`REGENERATE "focusPattern", "focusReason", and "practiceCue": topMistake="${parsed.topMistake}" but focusPattern="${parsed.focusPattern}" don't align. Pick from: ${validList}. Then write aligned focusReason and practiceCue.`);
      }

      const regenPrompt = `You previously scored a sales rep's response. Some outputs need regeneration.\n\n${regenParts.join("\n\n")}\n\nRespond with ONLY valid JSON containing the regenerated fields.`;

      let regenSucceeded = false;
      try {
        const regenResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: `You are Dave — an elite, encouraging sales coach. ${tone}` },
              { role: "user", content: regenPrompt },
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
        });

        if (regenResp.ok) {
          const rd = await regenResp.json();
          let rc = rd.choices?.[0]?.message?.content || "";
          rc = rc.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          const rp = JSON.parse(rc);
          for (const field of needsRegen) {
            if (rp[field]) parsed[field] = rp[field];
          }
          regenSucceeded = true;
          // Re-normalize focusPattern after regen
          if (parsed.focusPattern) parsed.focusPattern = normalizeFocusPattern(parsed.focusPattern, skill);
        }
      } catch (regenErr) {
        console.error("Regeneration failed, keeping originals:", regenErr);
      }

      console.log(JSON.stringify({
        event: "dojo_regen",
        skill,
        score: parsed.score,
        topMistake: parsed.topMistake,
        fieldsRegenerated: needsRegen,
        triggerReasons,
        succeeded: regenSucceeded,
      }));
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("dojo-score error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
