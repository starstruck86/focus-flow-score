import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// ── Skill-specific rubrics ──────────────────────────────────────────

const RUBRICS: Record<string, string> = {
  objection_handling: `GRADING CRITERIA (total 100pts):
1. ACKNOWLEDGE (10pts): Did they validate the concern without dismissing or agreeing too quickly?
2. ISOLATE (15pts): Did they ask a clarifying question to surface the real objection behind the stated one?
3. REFRAME (25pts): Did they shift from feature/cost to business value, risk, or cost of inaction?
4. EVIDENCE (15pts): Did they use a proof point, customer example, or data that's specific — not generic?
5. ADVANCE (15pts): Did they maintain control and propose a clear, concrete next step?
6. TONE (10pts): Was it conversational and confident — not defensive, scripted, or salesy?
7. CONCISENESS (10pts): Was it tight? No rambling, no stacking multiple questions?

COMMON MISTAKES (pick the most relevant):
- pitched_too_early: Jumped to solution before understanding the real concern
- weak_objection_handle: Acknowledged but didn't actually address it
- no_business_impact: Response stayed at feature level, never connected to business outcomes
- lack_of_control: Let the buyer drive, no next step proposed
- too_generic: Could have been said to any buyer — nothing specific
- too_long: Rambled, stacked questions, or over-explained
- no_proof: Made claims without evidence or examples
- weak_close: No clear ask or next step at the end`,

  discovery: `GRADING CRITERIA (total 100pts):
1. DEPTH (25pts): Did they go below surface-level? Did they uncover why this matters, not just what the problem is?
2. IMPLICATION (20pts): Did they help the buyer see the downstream impact of the problem — revenue, risk, time, competitive?
3. SPECIFICITY (15pts): Did they ask targeted questions using context from what the buyer said — or did they default to generic scripts?
4. CONTROL (15pts): Did they guide the conversation purposefully — not just ask questions at random?
5. QUANTIFICATION (10pts): Did they try to attach a number, a timeline, or a measurable cost to the pain?
6. TONE (10pts): Did it feel like a genuine business conversation — not an interrogation or a checklist?
7. BREVITY (5pts): Were questions concise and clear — not stacked or convoluted?

COMMON MISTAKES (pick the most relevant):
- stacked_questions: Asked 2+ questions in one turn — buyer can only answer one
- failed_to_deepen: Accepted a surface answer without probing further
- no_business_impact: Never connected the problem to revenue, risk, or strategic outcome
- too_generic: Asked textbook questions that ignore what the buyer just said
- lack_of_control: Let the conversation drift without steering toward next step
- weak_close: Ended without a clear transition or commitment
- pitched_too_early: Started solving before fully understanding the problem`,

  executive_response: `GRADING CRITERIA (total 100pts):
1. BREVITY (25pts): Did they get to the point in under 30 seconds of reading time? Executives punish rambling.
2. BUSINESS FRAMING (25pts): Did they frame everything in terms of outcomes the exec cares about — revenue, margin, risk, speed?
3. CONFIDENCE (15pts): Did they project certainty and credibility — not hedging, apologizing, or over-qualifying?
4. SPECIFICITY (15pts): Did they use concrete numbers, examples, or benchmarks — not vague promises?
5. STRATEGIC RELEVANCE (10pts): Did they connect to the exec's stated priority or known initiative — not pitch features?
6. CONTROL (10pts): Did they end with a clear, executive-appropriate ask — not a passive "thoughts?"

COMMON MISTAKES (pick the most relevant):
- too_long: Response would take more than 30 seconds to deliver — immediate fail with execs
- no_business_impact: Talked about features or process instead of outcomes
- too_generic: Response could be said by any vendor about any product
- weak_close: Ended passively instead of with a confident, specific ask
- lack_of_control: Deferred authority or sounded uncertain
- no_proof: Made big claims without a single proof point or benchmark
- pitched_too_early: Led with product instead of leading with insight or outcome`,
};

// ── Skill-specific coaching tone instructions ───────────────────────

const COACHING_TONE: Record<string, string> = {
  objection_handling: `Coach like a sharp sales leader doing a ride-along debrief. Be direct about what worked and what didn't. Name the specific moment they lost control or missed an opening. Don't soften — reps need clarity, not comfort.`,

  discovery: `Coach like a veteran who's run thousands of discoveries. Point out exactly where they stayed surface-level vs. where they could have gone deeper. If they stacked questions, call it out. If they missed an implication, name the specific business impact they should have explored.`,

  executive_response: `Coach like someone who's briefed C-suite hundreds of times. If they rambled, say so bluntly. If they led with features instead of outcomes, call it out. Executives give you 30 seconds — grade against that standard ruthlessly. Reward precision and confidence.`,
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

    const systemPrompt = `You are Dave — an elite sales coach grading a rep's response. You are sharp, direct, and specific. You do not give generic praise. You do not soften.

${tone}

${rubric}

SCORING STANDARDS:
- 85-100: Genuinely excellent. Specific, controlled, business-oriented, tight. Rare.
- 70-84: Strong rep. Solid instincts, but left an opening or missed a beat.
- 55-69: Average. Gets through it but predictable. A manager would have notes.
- 40-54: Below average. Missed the real issue or lost control of the conversation.
- <40: Made it worse. Defensive, rambling, or pitched into resistance.

Default to 55-65 unless they genuinely impressed you. Most reps are C-level.

${retryCount > 0 ? `This is retry #${retryCount}. If the rep improved, acknowledge specifically what changed. If they didn't, be direct about it.` : ''}

CRITICAL RULES FOR YOUR RESPONSE:
- "feedback" must be 2 sentences max. First sentence: what they did. Second sentence: what they missed or should change. Be SPECIFIC — reference their actual words.
- "improvedVersion" must be the EXACT words a top rep would say in this moment. Not a template. Not a framework description. The actual words, spoken naturally, 3-5 sentences max.
- "topMistake" must be one value from the common mistakes list above.

Respond with ONLY valid JSON:
{
  "score": 62,
  "feedback": "Two specific sentences about what they did and missed.",
  "topMistake": "one_of_the_mistake_codes",
  "improvedVersion": "The exact words a top rep would say. Natural, specific, powerful."
}`;

    const userPrompt = `SCENARIO:
Skill: ${skill}
Context: ${scenario.context}
Buyer says: "${scenario.objection}"

REP'S RESPONSE:
"${userResponse}"`;

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
