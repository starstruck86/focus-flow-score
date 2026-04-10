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
1. DEPTH (25pts): Did they push past the surface answer? Did they ask "why does that matter" or "what happens if you don't fix it"?
2. IMPLICATION (20pts): Did they help the buyer see the downstream impact — revenue lost, time wasted, competitive risk, team strain?
3. SPECIFICITY (15pts): Did they use what the buyer said to ask a targeted follow-up — or did they default to a generic question?
4. CONTROL (15pts): Did they steer the conversation toward a business outcome — not just gather information passively?
5. QUANTIFICATION (10pts): Did they try to attach a number, timeline, or measurable cost to the problem?
6. TONE (10pts): Did it feel like a genuine business conversation between equals — not an interrogation or a script?
7. BREVITY (5pts): Were questions concise and singular — not stacked or compound?

COMMON MISTAKES (pick the single most impactful):
- stacked_questions: Asked 2+ questions at once — the buyer can only answer one
- failed_to_deepen: Accepted a surface answer without probing further
- no_business_impact: Never connected the problem to a business outcome the buyer cares about
- too_generic: Asked a textbook question that ignores what the buyer just said
- lack_of_control: Let the conversation drift without steering toward next step or commitment
- weak_close: Ended without a transition, next step, or reason to continue
- pitched_too_early: Started solving or presenting before understanding the problem`,

  executive_response: `GRADING CRITERIA (total 100pts):
1. BREVITY (25pts): Could this be delivered in under 30 seconds? Executives stop listening after that. Every extra sentence costs points.
2. BUSINESS FRAMING (25pts): Did they lead with an outcome the exec cares about — revenue, margin, speed, risk — not features or process?
3. CONFIDENCE (15pts): Did they project certainty? No hedging, no "I think," no apologizing for taking their time?
4. SPECIFICITY (15pts): Did they use a concrete number, benchmark, customer example, or timeline — not vague promises?
5. STRATEGIC RELEVANCE (10pts): Did they connect to the exec's stated priority or known initiative — not a generic value prop?
6. CONTROL (10pts): Did they end with a clear, executive-appropriate ask — not "what do you think?" or "any questions?"

COMMON MISTAKES (pick the single most impactful):
- too_long: Would take more than 30 seconds to say out loud — automatic fail with execs
- no_business_impact: Talked about features, process, or "the platform" instead of business outcomes
- too_generic: Could be said by any vendor about any product to any exec
- weak_close: Ended passively or without a specific ask
- lack_of_control: Deferred authority, hedged, or sounded uncertain
- no_proof: Made bold claims without a single proof point
- pitched_too_early: Led with product description instead of insight or outcome`,
};

// ── Skill-specific coaching tone ────────────────────────────────────

const COACHING_TONE: Record<string, string> = {
  objection_handling: `You are a sharp VP of Sales doing a post-call debrief with a rep you manage. Be direct. Name the exact moment they lost the thread or missed the opening. If they acknowledged but didn't actually reframe, say so. If they pitched into resistance, call it out. Don't pad with "good effort" — tell them what a great rep would have done differently in this exact situation.`,

  discovery: `You are a veteran sales leader who has run thousands of discoveries. Point out exactly where they stayed surface-level when they should have gone deeper. If they accepted "churn is an issue" without asking what it costs, call that out. If they asked a generic question when the buyer gave them a specific thread to pull, name the thread they missed. Be specific about what question they should have asked and why.`,

  executive_response: `You are someone who has briefed C-suite executives hundreds of times. Grade against a ruthless standard: executives give you 30 seconds, and most reps waste 20 of them on setup. If they rambled, say "you lost them after sentence two." If they led with features, say "an exec doesn't care about your platform — they care about their P&L." Reward precision, punish filler.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { scenario, userResponse, retryCount } = await req.json();
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

    const systemPrompt = `You are Dave — an elite sales coach grading a rep's live response. You are sharp, direct, and unimpressed by mediocrity. You do not give generic praise. You do not soften.

${tone}

${rubric}

SCORE CALIBRATION (CRITICAL — follow this distribution strictly):
- 85-100: Exceptional. Would impress a VP of Sales watching live. Specific, tight, business-oriented, controlled. RARE — most reps never hit this on first attempt.
- 70-84: Strong. Solid instincts, hit the main beats, but left an opening or missed a beat a great rep wouldn't.
- 55-69: Average. This is where MOST first attempts should land. Gets through it but predictable, slightly generic, or misses an implication. A manager would have notes.
- 40-54: Below average. Missed the real issue, lost control, or went too long. Needs clear coaching.
- Below 40: Actively harmful. Defensive, rambling, pitched into resistance, or made the buyer less interested.

YOUR DEFAULT SCORE FOR A DECENT-BUT-NOT-GREAT RESPONSE IS 58-63. Do NOT inflate. If you're giving above 75, the response better be genuinely impressive with specific evidence, tight framing, and executive-level control.

${retryCount > 0 ? `This is retry #${retryCount}. Compare to what a first attempt typically looks like. If they improved, name exactly what changed. If they didn't improve meaningfully, say so directly — don't pretend marginal rewording is progress.` : ''}

RESPONSE RULES:
- "feedback": Exactly 2 sentences. Sentence 1: what they attempted or got right (be specific to their response — not generic praise). Sentence 2: the specific miss, gap, or mistake (name the exact behavior, not a vague "could improve"). Do NOT say "great job" or "nice work" if the score is below 75. Match your tone to the score.
- "improvedVersion": Write the EXACT words a top-performing rep would say OUT LOUD in this conversation. This is spoken language — contractions, natural rhythm, slightly imperfect. NOT marketing copy, NOT a framework recitation, NOT a bullet-point list. 3-5 sentences that sound like a real human on a real call. Must directly address the buyer's exact words and situation.
- "topMistake": Pick the single most impactful mistake from the list. This should be the #1 thing that, if fixed, would most improve their effectiveness.

INTERNAL VALIDATION (check before responding):
1. If score < 70, feedback must NOT contain positive framing like "good," "nice," "solid," or "well done."
2. The improvedVersion must address the topMistake — if the mistake is "no_business_impact," the improved version must include a business impact.
3. If the response is under 2 sentences, it cannot score above 55 (too thin to be effective).
4. If the response is over 8 sentences, it cannot score above 65 for executive_response (too long for an exec).

Respond with ONLY valid JSON:
{
  "score": 60,
  "feedback": "Specific sentence about what they did. Specific sentence about what they missed.",
  "topMistake": "one_mistake_code",
  "improvedVersion": "Natural spoken words a great rep would actually say on this call."
}`;

    const userPrompt = `SCENARIO:
Skill being tested: ${skill}
Situation: ${scenario.context}
Buyer says: "${scenario.objection}"

REP'S RESPONSE:
"${userResponse}"

Grade this response strictly using the rubric. Default to 58-63 unless genuinely strong.`;

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
        max_tokens: 800,
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

    // ── Server-side validation ──────────────────────────────────
    // Clamp score to sane range
    if (typeof parsed.score === "number") {
      parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    }

    // Tone-score consistency: strip positive language from low-score feedback
    if (parsed.score < 70 && typeof parsed.feedback === "string") {
      const positivePatterns = /\b(great job|nice work|well done|excellent|impressive|strong response|good job)\b/gi;
      if (positivePatterns.test(parsed.feedback)) {
        // Flag inconsistency in logs but don't block response
        console.warn(`Score-tone mismatch: score=${parsed.score} but feedback contains positive language`);
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
