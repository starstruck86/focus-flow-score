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
1. BREVITY (25pts): Could this be delivered in under 30 seconds? More than 4 sentences drops fast.
2. BUSINESS FRAMING (25pts): Did they lead with an outcome the exec cares about — revenue, margin, speed, risk?
3. CONFIDENCE (15pts): Did they project certainty? No hedging.
4. SPECIFICITY (15pts): Concrete number, benchmark, customer example?
5. STRATEGIC RELEVANCE (10pts): Connected to the exec's stated priority?
6. CONTROL (10pts): Clear, executive-appropriate ask at the end?

COMMON MISTAKES: too_long / no_business_impact / too_generic / weak_close / lack_of_control / no_proof / pitched_too_early`,

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

// ── Coaching tone ───────────────────────────────────────────────────

const COACHING_TONE: Record<string, string> = {
  objection_handling: `You are an elite sales coach doing a post-call debrief. Be direct and specific — name the exact moment they lost the thread or missed the opening. But be encouraging: you believe this rep can get sharper with focused practice. Don't pad with fake praise, but do acknowledge real progress. Your tone is: "You're close — here's the one thing that would level this up."`,
  discovery: `You are a veteran sales leader who has run thousands of discoveries. Point out exactly where they stayed surface-level when they should have gone deeper. Be specific about what question they should have asked and why.`,
  executive_response: `You are someone who coaches reps for C-suite meetings. Grade against a high standard: executives give you 30 seconds. If they rambled, say "tighten this to 2 sentences." Your tone is confident and encouraging.`,
  deal_control: `You are a sales leader reviewing pipeline discipline. If they accepted a vague timeline, name it directly. Build confidence: "You spotted the risk — now lock down the commitment."`,
  qualification: `You are a sales leader who values pipeline quality over quantity. If the rep chased a weak opportunity, say so clearly. Frame coaching around judgment.`,
};

const WORLD_CLASS_TONE: Record<string, string> = {
  objection_handling: 'calm, specific, isolates before pitching, reframes to business value, moves forward with control',
  discovery: 'deepens pain fast, connects to business implications, asks sharp singular questions, sounds like a business advisor',
  executive_response: 'concise, commercially sharp, confident, outcome-led, zero filler, under 30 seconds spoken',
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
- "feedback": Exactly 2 sentences. Sentence 1: what they attempted or got right (specific). Sentence 2: the ONE thing that would make this significantly better.
- "improvedVersion": Exact words a better rep would say OUT LOUD. 3-5 sentences. Achievable upgrade.
- "worldClassResponse": What a top 1% rep would ACTUALLY SAY from scratch. MATERIALLY STRONGER than improvedVersion. For ${skill}: ${wcTone}
- "whyItWorks": 2-3 bullets explaining UNDERLYING PATTERNS of worldClassResponse. Reusable principles.
- "moveSequence": 2-4 verb-first steps showing the STRUCTURE of worldClassResponse. Scenario-specific.
- "patternTags": 2-4 snake_case REUSABLE selling behaviors. Portable across scenarios.
- "focusPattern": Single pattern from the FOCUS PATTERNS list above. MUST be from that exact list.
- "focusReason": One sentence starting with "Because" explaining why this is highest-leverage.
- "practiceCue": One concrete behavioral instruction for the retry. Immediately executable.
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
  "focusAppliedReason": "One sentence."` : '');

    const userPrompt = `SCENARIO:
Skill being tested: ${skill}
Situation: ${scenario.context}
Buyer says: "${scenario.objection}"

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
