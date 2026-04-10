import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

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
3. SPECIFICITY (15pts): Did they use what the buyer said to ask a targeted follow-up — or did they default to a generic question? Restating the buyer's words back as a question is not specificity.
4. CONTROL (15pts): Did they steer the conversation toward a business outcome — not just gather information passively?
5. QUANTIFICATION (10pts): Did they try to attach a number, timeline, or measurable cost to the problem?
6. TONE (10pts): Did it feel like a genuine business conversation between equals — not an interrogation or a script?
7. BREVITY (5pts): Were questions concise and singular — not stacked or compound?

SCORING ANCHORS FOR DISCOVERY:
- "How much has churn increased?" alone = 55-60. It's a surface question with no implication or business framing.
- "What's that costing you in monthly revenue?" = 62-67. Better — attaches a number, but still one-dimensional.
- "When you lose those customers in month 3, what does that do to your LTV math? And has that changed how your CFO looks at acquisition spend?" = 72-78. Connects to downstream business impact with specificity.

COMMON MISTAKES (pick the single most impactful):
- stacked_questions: Asked 2+ questions at once — the buyer can only answer one
- failed_to_deepen: Accepted a surface answer without probing further
- no_business_impact: Never connected the problem to a business outcome the buyer cares about
- too_generic: Asked a textbook question that ignores what the buyer just said
- lack_of_control: Let the conversation drift without steering toward next step or commitment
- weak_close: Ended without a transition, next step, or reason to continue
- pitched_too_early: Started solving or presenting before understanding the problem`,

  executive_response: `GRADING CRITERIA (total 100pts):
1. BREVITY (25pts): Could this be delivered in under 30 seconds? Count the sentences — more than 4 and this score drops fast. Every filler word costs points.
2. BUSINESS FRAMING (25pts): Did they lead with an outcome the exec cares about — revenue, margin, speed, risk — not features or process? "We help brands improve retention" is too vague for full credit. Need a specific number or benchmark.
3. CONFIDENCE (15pts): Did they project certainty? No hedging, no "I think," no apologizing for taking their time?
4. SPECIFICITY (15pts): Did they use a concrete number, benchmark, customer example, or timeline — not vague promises?
5. STRATEGIC RELEVANCE (10pts): Did they connect to the exec's stated priority or known initiative — not a generic value prop?
6. CONTROL (10pts): Did they end with a clear, executive-appropriate ask — not "what do you think?" or "any questions?"

SCORING ANCHORS FOR EXECUTIVE RESPONSE:
- Generic platform pitch with no numbers = 42-52. Execs hear this 10 times a week.
- Mentions retention + a vague benefit + asks for a demo = 53-60. Shows awareness but no teeth.
- Leads with a specific metric, ties to their known priority, ends with a tight ask = 72-80.
- Under 3 sentences, specific ROI, references their situation, confident close = 82-90.

COMMON MISTAKES (pick the single most impactful):
- too_long: Would take more than 30 seconds to say out loud — automatic fail with execs
- no_business_impact: Talked about features, process, or "the platform" instead of business outcomes
- too_generic: Could be said by any vendor about any product to any exec
- weak_close: Ended passively or without a specific ask
- lack_of_control: Deferred authority, hedged, or sounded uncertain
- no_proof: Made bold claims without a single proof point
- pitched_too_early: Led with product description instead of insight or outcome`,

  deal_control: `GRADING CRITERIA (total 100pts):
1. CONTROL (25pts): Did they take ownership of the next step? Did they propose a specific action with a date — not "let's reconnect soon"? Accepting the buyer's vague timeline without pushback = 0-5pts.
2. CLARITY (20pts): Did they define what happens next in concrete, unambiguous terms? The buyer should leave knowing exactly what's expected from both sides.
3. COMMITMENT (20pts): Did they secure a concrete commitment — a meeting, a deliverable, a decision date? Verbal agreement to "think about it" is not commitment. If they let the buyer off with "I'll get back to you," this is 0-5pts.
4. RISK DETECTION (15pts): Did they identify and address the real risk in the deal — stalling, competitor, missing stakeholder, lack of urgency? If they ignored obvious warning signs, 0pts.
5. TONE (10pts): Confident and firm without being pushy or transactional. Did it feel like a trusted advisor holding the buyer accountable, not a desperate rep chasing?
6. BREVITY (10pts): Tight and purposeful. No rambling justifications or over-explaining.

SCORING ANCHORS FOR DEAL CONTROL:
- "Sounds good, just let me know when you're ready" = 38-45. Zero control. The deal is now in the buyer's hands.
- "Can we schedule something for next week?" without addressing the underlying issue = 52-58. Shows awareness but no teeth.
- Names the risk, proposes a specific plan, and secures agreement = 72-80.
- Reframes the delay as business risk, locks a commitment, and defines mutual accountability = 82-90.

COMMON MISTAKES (pick the single most impactful):
- lack_of_control: Accepted the buyer's timeline or vague plan without pushback
- weak_close: Ended without a concrete, time-bound next step
- vague_next_step: Proposed a next step but left it ambiguous — "let's touch base" is not a plan
- too_passive: Waited for the buyer to lead instead of driving the conversation
- accepted_delay: Let the buyer push the timeline without exploring what's really happening
- no_mutual_plan: Didn't establish shared accountability — next steps were one-sided
- too_generic: Response didn't address the specific deal dynamics or warning signs
- too_long: Over-explained or justified when directness was needed`,

  qualification: `GRADING CRITERIA (total 100pts):
1. DEPTH (25pts): Did they push past the buyer's surface statement to understand whether real pain exists? Simply asking "tell me more" is worth 5pts. Probing for impact, cost, and consequence is worth full credit.
2. PAIN VALIDATION (20pts): Did they distinguish between genuine business pain and casual interest? If the buyer said "we're just exploring" and the rep treated it as a real opportunity, 0pts.
3. URGENCY (15pts): Did they test whether there's a timeline, a trigger event, or a consequence of inaction? If they accepted "no rush" without probing, 0-5pts.
4. STAKEHOLDER AWARENESS (15pts): Did they identify who else is involved, who decides, and who controls budget? Accepting "I'm the decision maker" at face value from a mid-level buyer = 0pts.
5. BUSINESS IMPACT (15pts): Did they connect the stated problem to a measurable business outcome — revenue, cost, competitive risk, team capacity?
6. CONTROL (10pts): Did they steer toward a qualifying or disqualifying conclusion — not just gather information?

SCORING ANCHORS FOR QUALIFICATION:
- "That sounds great, let me send you pricing" without qualifying = 35-45. The rep is chasing, not qualifying.
- Asks surface questions but accepts vague answers = 52-58. Going through motions without rigor.
- Probes for real pain, tests urgency, maps stakeholders, and decides whether to invest more time = 72-80.
- Identifies that this isn't a real opportunity and professionally redirects or disqualifies = 82-90 (disqualifying well is a top-tier skill).

COMMON MISTAKES (pick the single most impactful):
- failed_to_qualify: Treated a casual inquiry as a real opportunity without testing
- accepted_weak_pain: Buyer described a minor inconvenience and the rep treated it as critical
- no_urgency: Didn't test whether there's a timeline or consequence of waiting
- skipped_stakeholders: Didn't ask who else is involved in the decision
- too_generic: Asked textbook qualification questions without adapting to the situation
- pitched_too_early: Jumped to solution or pricing before understanding if opportunity is real
- no_disqualification: Failed to consider whether this deal is worth pursuing
- no_business_impact: Never connected the problem to a measurable outcome`,
};

// ── Skill-specific coaching tone ────────────────────────────────────

const COACHING_TONE: Record<string, string> = {
  objection_handling: `You are an elite sales coach doing a post-call debrief. Be direct and specific — name the exact moment they lost the thread or missed the opening. But be encouraging: you believe this rep can get sharper with focused practice. Don't pad with fake praise, but do acknowledge real progress. Your tone is: "You're close — here's the one thing that would level this up."`,

  discovery: `You are a veteran sales leader who has run thousands of discoveries. Point out exactly where they stayed surface-level when they should have gone deeper. Be specific about what question they should have asked and why. But frame it as a growth opportunity: "You had the right instinct — push one level deeper next time." Never condescending, always constructive.`,

  executive_response: `You are someone who coaches reps for C-suite meetings. Grade against a high standard: executives give you 30 seconds. If they rambled, say "tighten this to 2 sentences and it lands." If they led with features, say "lead with the number, not the platform." Your tone is confident and encouraging: "The insight is there — now make it hit faster."`,

  deal_control: `You are a sales leader reviewing pipeline discipline. If they accepted a vague timeline, name it directly. If they proposed a weak next step, call it out. But your tone should build confidence: "You spotted the risk — now lock down the commitment." You're coaching a rep you believe in, not lecturing them.`,

  qualification: `You are a sales leader who values pipeline quality over quantity. If the rep chased a weak opportunity, say so clearly. If they skipped stakeholder mapping, name it. But frame coaching around judgment: "Your instinct to engage was right — but test urgency before investing more time." Reward reps who show rigor.`,
};

// ── World-class response tone by skill ──────────────────────────────
const WORLD_CLASS_TONE: Record<string, string> = {
  objection_handling: 'calm, specific, isolates before pitching, reframes to business value, moves the conversation forward with control',
  discovery: 'deepens pain fast, connects to business implications, asks sharp singular questions, sounds like a business advisor not an interrogator',
  executive_response: 'concise, commercially sharp, confident, outcome-led, zero filler, under 30 seconds spoken',
  deal_control: 'disciplined, clear about next steps, unafraid to name drift or risk, locks mutual accountability',
  qualification: 'rigorous, skeptical in the right way, willing to disqualify, tests urgency and stakeholders and real pain before advancing',
};

// ── Focus pattern definitions by skill ──────────────────────────────
const FOCUS_PATTERNS: Record<string, string> = {
  objection_handling: `FOCUS PATTERNS (pick the single most valuable one for this rep to practice next):
- isolate_before_answering: Pause and surface the real concern before responding
- reframe_to_business_impact: Shift from feature/cost to revenue/margin/risk
- use_specific_proof: Anchor claims with a concrete customer story or metric
- control_next_step: End with a clear, time-bound ask
- stay_concise_under_pressure: Say less, land harder`,

  discovery: `FOCUS PATTERNS (pick the single most valuable one for this rep to practice next):
- deepen_one_level: When the buyer gives a surface answer, ask "what does that cost you?"
- tie_to_business_impact: Connect every problem to revenue, cost, or competitive risk
- ask_singular_questions: One question at a time — let the buyer go deep
- test_urgency: Probe for timeline, trigger event, or consequence of inaction
- quantify_the_pain: Attach a number, dollar amount, or timeline to the problem`,

  executive_response: `FOCUS PATTERNS (pick the single most valuable one for this rep to practice next):
- lead_with_the_number: Open with a specific metric or outcome, not context
- cut_to_three_sentences: Brevity is the skill — say it in 3 sentences or fewer
- anchor_to_their_priority: Reference the exec's known initiative or stated goal
- project_certainty: No hedging, no "I think" — speak with authority
- close_with_a_specific_ask: End with exactly what you want — not "thoughts?"`,

  deal_control: `FOCUS PATTERNS (pick the single most valuable one for this rep to practice next):
- control_next_step: Propose a specific action with a specific date
- name_the_risk: Call out deal drift, stalling, or missing stakeholders directly
- lock_mutual_commitment: Define what both sides will do by when
- test_before_accepting: Don't accept "let's circle back" — probe what's really happening
- create_urgency_without_pressure: Show the cost of waiting without being aggressive`,

  qualification: `FOCUS PATTERNS (pick the single most valuable one for this rep to practice next):
- test_urgency: Ask about timeline, trigger, or consequence of inaction
- validate_real_pain: Distinguish between genuine business pain and casual interest
- map_stakeholders: Identify who decides, who influences, who controls budget
- disqualify_weak_opportunities: Be willing to walk away from low-quality pipeline
- tie_problem_to_business_impact: Connect the stated issue to a measurable outcome`,
};

// ── Positive-language patterns to strip from low-score feedback ──────
const POSITIVE_PATTERNS = /\b(great job|nice work|well done|excellent|impressive|strong response|good job|solid attempt|good effort|nicely done|smart move|clever)\b/gi;

// ── Business impact keywords for validation ─────────────────────────
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
    const focusPatternGuide = FOCUS_PATTERNS[skill] || FOCUS_PATTERNS.objection_handling;

    const systemPrompt = `You are Dave — an elite sales coach. You are sharp, direct, and hold a high standard. But you are also encouraging — you believe this rep can improve quickly with focused repetition. You never give fake praise, but you acknowledge real progress and frame every gap as a specific thing to practice next.

${tone}

${rubric}

${focusPatternGuide}

SCORE CALIBRATION (CRITICAL — follow this distribution strictly):
- 85-100: Exceptional. Would make a VP of Sales stop and say "that was really good." Specific, tight, business-oriented, controlled. You should almost never give this on a first attempt.
- 75-84: Genuinely strong. Hit the key beats with specificity, showed real business acumen. Still uncommon.
- 60-69: Average. This is where MOST responses land. Competent but predictable. Asked obvious follow-ups. Showed awareness but lacked depth or specificity. A manager would say "okay, but what about…"
- 50-59: Below average. Missed the real issue, stayed surface-level, lost control, or went generic. Needs clear coaching.
- 40-49: Weak. Defensive, rambling, pitched into resistance, or fundamentally misread the situation.
- Below 40: Actively harmful. Made the buyer less interested or damaged credibility.

YOUR DEFAULT SCORE IS 58-63. This is where a competent but unexceptional response belongs. If you're about to give above 70, ask yourself: "Would a VP of Sales watching this live be impressed?" If no, the score is too high.

${retryCount > 0 ? `This is retry #${retryCount}.${focusReminder ? ` The rep was told to focus on: "${focusReminder}". You MUST explicitly assess whether they applied this pattern. If they did, name exactly how in your feedback. If they didn't, call it out directly: "You were asked to focus on ${focusReminder} — this attempt still doesn't do that." Do not ignore the focus reminder.` : ''} Compare to what a first attempt typically looks like. If they improved, name exactly what changed. If they didn't improve meaningfully, say so directly.` : ''}

RESPONSE RULES:
- "feedback": Exactly 2 sentences. Encouraging but specific. Sentence 1: what they attempted or got right (be specific — not generic praise). Sentence 2: the ONE thing that would make this significantly better.
- "improvedVersion": Write the EXACT words a better version of the rep's response would sound like OUT LOUD. Fix their specific mistakes while keeping their general approach. 3-5 sentences. This should feel achievable — a realistic upgrade from where they are.
- "worldClassResponse": Write what a top 1% rep would ACTUALLY SAY — not an improved version of the user's answer, but what elite instinct sounds like from scratch. This must be MATERIALLY STRONGER than improvedVersion — more commercially sharp, more controlled, more precise. improvedVersion = better rep. worldClassResponse = elite rep. The gap should be visible. Requirements:
  * Exact spoken words — natural, conversational, believable on a real call
  * NOT marketing copy, NOT a framework recitation
  * For ${skill}: ${WORLD_CLASS_TONE[skill] || 'calm, specific, commercially sharp, confident'}
  * If score < 70: gap between improvedVersion and worldClassResponse should be SIGNIFICANT
  * If score 70-84: gap visible but narrower
  * If score > 84: subtle level-up in precision
- "whyItWorks": Array of exactly 2-3 bullets (one sentence each) explaining the UNDERLYING PATTERN that makes the worldClassResponse elite. Must teach reusable principles — not restate the response. Good: "It slows the conversation down long enough to isolate whether the objection is real or reflexive." Bad: "It is specific."
- "moveSequence": Array of 2-4 short steps showing the STRUCTURE of the worldClassResponse in sequential order. Verb-first, under 8 words, specific to this scenario, reflects a real move in the worldClassResponse. Good: "isolate the real concern", "reframe to pipeline risk". Bad: "communicate clearly", "be confident".
- "patternTags": Array of 2-4 snake_case labels representing repeatable selling behaviors. Must feel like moves a rep can name and practice.
- "focusPattern": Single most valuable pattern from the FOCUS PATTERNS list.
- "focusReason": One sentence starting with "Because" explaining why this is the highest-leverage fix. Must reference the rep's actual miss.
- "practiceCue": One short behavioral instruction for the retry — concrete and immediately usable. Good: "Ask one sharp question before making your point." Bad: "Focus on qualification."
- "teachingNote": One sentence that generalizes the lesson BEYOND this scenario. Should sound like a world-class coach's final takeaway. Good: "The rep who wins this moment is usually the one who slows the objection down before trying to solve it." Different from whyItWorks — this turns the moment into a broader lesson.
- "topMistake": Pick the single most impactful mistake from the list.

TONE RULES:
- Direct, constructive, confidence-building, high-standard. NOT soft, flattering, generic, or overly intense.
- Below 70: encouraging but NOT falsely positive. AVOID "great job", "solid work", "nice answer". Encouraging ≠ praising.

INTERNAL VALIDATION:
1. If score < 70, feedback must NOT contain "great job," "solid," "nice work," "strong," "impressive," or "clever."
2. If topMistake is "no_business_impact," improvedVersion MUST include business impact language.
3. If topMistake is "too_long," improvedVersion MUST be shorter than rep's response.
4. If rep's response under 2 sentences, cap score at 55.
5. For executive_response: if rep exceeds 5 sentences, cap at 60.
6. For discovery: simple question without business impact → cap at 64.
7. worldClassResponse MUST be meaningfully different from and stronger than improvedVersion.
8. whyItWorks: reusable patterns only, no generic bullets.
9. focusPattern: from FOCUS PATTERNS list.
10. patternTags: 2-4, snake_case, teachable.
11. moveSequence: 2-4, verb-first, under 8 words, sequential, scenario-specific.
12. focusReason: starts with "Because", references rep's miss.
13. practiceCue: one behavioral instruction, not a label.
14. teachingNote: one sentence generalizing beyond this scenario.

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
  "teachingNote": "General coaching principle from this rep."
}`;

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
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI request failed: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    const parsed = JSON.parse(content);

    // ── Server-side enforcement ─────────────────────────────────

    // Clamp score
    if (typeof parsed.score === "number") {
      parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    }

    // Enforce: exec responses over 5 sentences from rep → cap at 60
    if (skill === "executive_response" && typeof userResponse === "string") {
      const sentenceCount = userResponse.split(/[.!?]+/).filter((s: string) => s.trim().length > 5).length;
      if (sentenceCount > 5 && parsed.score > 60) {
        parsed.score = 60;
      }
    }

    // Enforce: very short rep responses → cap at 55
    if (typeof userResponse === "string") {
      const sentenceCount = userResponse.split(/[.!?]+/).filter((s: string) => s.trim().length > 5).length;
      if (sentenceCount < 2 && parsed.score > 55) {
        parsed.score = 55;
      }
    }

    // Ensure new teaching fields exist
    if (!Array.isArray(parsed.patternTags)) parsed.patternTags = [];
    if (typeof parsed.focusPattern !== "string") parsed.focusPattern = "";
    if (!Array.isArray(parsed.moveSequence)) parsed.moveSequence = [];
    if (typeof parsed.focusReason !== "string") parsed.focusReason = "";
    if (typeof parsed.practiceCue !== "string") parsed.practiceCue = "";
    if (typeof parsed.teachingNote !== "string") parsed.teachingNote = "";

    // ── Targeted regeneration for consistency issues ─────────────

    const needsRegen: string[] = [];

    // Check: praise in low-score feedback → regenerate feedback
    if (parsed.score < 70 && typeof parsed.feedback === "string" && POSITIVE_PATTERNS.test(parsed.feedback)) {
      needsRegen.push("feedback");
    }

    // Check: no_business_impact but improvedVersion lacks business language → regenerate improvedVersion
    if (parsed.topMistake === "no_business_impact" && typeof parsed.improvedVersion === "string" && !BUSINESS_IMPACT_PATTERNS.test(parsed.improvedVersion)) {
      needsRegen.push("improvedVersion");
    }

    // Check: too_long but improvedVersion is longer than rep's response → regenerate improvedVersion
    if (parsed.topMistake === "too_long" && typeof parsed.improvedVersion === "string" && typeof userResponse === "string" && parsed.improvedVersion.length > userResponse.length) {
      if (!needsRegen.includes("improvedVersion")) needsRegen.push("improvedVersion");
    }

    // Check: exec improvedVersion over 5 sentences → regenerate shorter
    if (skill === "executive_response" && typeof parsed.improvedVersion === "string") {
      const ivSentences = parsed.improvedVersion.split(/[.!?]+/).filter((s: string) => s.trim().length > 5).length;
      if (ivSentences > 5 && !needsRegen.includes("improvedVersion")) {
        needsRegen.push("improvedVersion");
      }
    }

    if (needsRegen.length > 0) {
      const triggerReasons: Record<string, string> = {};
      const regenParts: string[] = [];

      if (needsRegen.includes("feedback")) {
        triggerReasons.feedback = "positive_language_in_low_score";
        regenParts.push(`REGENERATE "feedback": The current feedback is "${parsed.feedback}". The score is ${parsed.score} (below 70). Rewrite the feedback to be direct but encouraging — no generic praise words, but CAN use phrases like "you're close," "right instinct," "getting there." Keep it to exactly 2 sentences. Sentence 1: what they attempted or got right. Sentence 2: the ONE thing to improve.`);
      }

      if (needsRegen.includes("improvedVersion")) {
        const reasons: string[] = [];
        if (parsed.topMistake === "no_business_impact") { reasons.push("it must include specific business impact language (revenue, margin, cost, ROI, or a concrete metric)"); triggerReasons.improvedVersion = "missing_business_impact"; }
        if (parsed.topMistake === "too_long") { reasons.push("it must be significantly shorter than the rep's response — tight and punchy"); triggerReasons.improvedVersion = "too_long_improved_version"; }
        if (skill === "executive_response") { reasons.push("it must be under 4 sentences — brevity is non-negotiable for exec communication"); triggerReasons.improvedVersion = triggerReasons.improvedVersion || "exec_too_verbose"; }
        if (!triggerReasons.improvedVersion) triggerReasons.improvedVersion = "consistency_check_failed";
        regenParts.push(`REGENERATE "improvedVersion": The current version is "${parsed.improvedVersion}". Issues: ${reasons.join("; ")}. Write the exact words a top rep would say OUT LOUD. Spoken language, natural rhythm, 3-5 sentences max (3 preferred for exec). Must sound like a real person on a real call, not polished copy.`);
      }

      const regenPrompt = `You previously scored a sales rep's response. Some outputs need regeneration for consistency. Keep the same score (${parsed.score}) and topMistake (${parsed.topMistake}). Only regenerate the fields listed below.\n\n${regenParts.join("\n\n")}\n\nRespond with ONLY valid JSON containing the regenerated fields. Example: {"feedback": "...", "improvedVersion": "..."}. Only include fields that need regeneration.`;

      let regenSucceeded = false;
      try {
        const regenResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: `You are Dave — an elite, encouraging sales coach. ${tone} Be sharp but constructive.` },
              { role: "user", content: regenPrompt },
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
        });

        if (regenResp.ok) {
          const regenData = await regenResp.json();
          let regenContent = regenData.choices?.[0]?.message?.content || "";
          regenContent = regenContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          const regenParsed = JSON.parse(regenContent);

          if (regenParsed.feedback && needsRegen.includes("feedback")) {
            parsed.feedback = regenParsed.feedback;
          }
          if (regenParsed.improvedVersion && needsRegen.includes("improvedVersion")) {
            parsed.improvedVersion = regenParsed.improvedVersion;
          }
          regenSucceeded = true;
        }
      } catch (regenErr) {
        console.error("Regeneration failed, keeping originals:", regenErr);
      }

      // Structured regeneration log
      console.log(JSON.stringify({
        event: "dojo_regen",
        skill,
        score: parsed.score,
        topMistake: parsed.topMistake,
        fieldsRegenerated: needsRegen,
        triggerReasons,
        succeeded: regenSucceeded,
      }));

      // Lightweight post-regen validation
      if (regenSucceeded && parsed.topMistake === "no_business_impact" && typeof parsed.improvedVersion === "string" && !BUSINESS_IMPACT_PATTERNS.test(parsed.improvedVersion)) {
        console.log(JSON.stringify({ event: "dojo_regen_drift", detail: "improvedVersion still lacks business impact after regen", topMistake: parsed.topMistake, skill }));
      }
      if (regenSucceeded && parsed.topMistake === "too_long" && typeof parsed.improvedVersion === "string" && typeof userResponse === "string" && parsed.improvedVersion.length > userResponse.length) {
        console.log(JSON.stringify({ event: "dojo_regen_drift", detail: "improvedVersion still longer than rep response after regen", topMistake: parsed.topMistake, skill }));
      }
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
