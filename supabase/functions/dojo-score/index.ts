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
};

// ── Skill-specific coaching tone ────────────────────────────────────

const COACHING_TONE: Record<string, string> = {
  objection_handling: `You are a sharp VP of Sales doing a post-call debrief with a rep you manage. Be direct. Name the exact moment they lost the thread or missed the opening. If they acknowledged but didn't actually reframe, say so. If they pitched into resistance, call it out. Don't pad with "good effort" — tell them what a great rep would have done differently in this exact situation.`,

  discovery: `You are a veteran sales leader who has run thousands of discoveries. Point out exactly where they stayed surface-level when they should have gone deeper. If they accepted "churn is an issue" without asking what it costs, call that out. If they asked a generic question when the buyer gave them a specific thread to pull, name the thread they missed. Be specific about what question they should have asked and why.`,

  executive_response: `You are someone who has briefed C-suite executives hundreds of times. Grade against a ruthless standard: executives give you 30 seconds, and most reps waste 20 of them on setup. If they rambled, say "you lost them after sentence two." If they led with features, say "an exec doesn't care about your platform — they care about their P&L." Reward precision, punish filler.`,
};

// ── Positive-language patterns to strip from low-score feedback ──────
const POSITIVE_PATTERNS = /\b(great job|nice work|well done|excellent|impressive|strong response|good job|solid attempt|good effort|nicely done|smart move|clever)\b/gi;

// ── Business impact keywords for validation ─────────────────────────
const BUSINESS_IMPACT_PATTERNS = /\b(revenue|margin|cost|ROI|LTV|CAC|churn rate|pipeline|quota|P&L|profit|savings|payback|ARR|MRR|\$\d|percent|%|\d+x)\b/i;

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
- 85-100: Exceptional. Would make a VP of Sales stop and say "that was really good." Specific, tight, business-oriented, controlled. You should almost never give this on a first attempt.
- 75-84: Genuinely strong. Hit the key beats with specificity, showed real business acumen. Still uncommon.
- 60-69: Average. This is where MOST responses land. Competent but predictable. Asked obvious follow-ups. Showed awareness but lacked depth or specificity. A manager would say "okay, but what about…"
- 50-59: Below average. Missed the real issue, stayed surface-level, lost control, or went generic. Needs clear coaching.
- 40-49: Weak. Defensive, rambling, pitched into resistance, or fundamentally misread the situation.
- Below 40: Actively harmful. Made the buyer less interested or damaged credibility.

YOUR DEFAULT SCORE IS 58-63. This is where a competent but unexceptional response belongs. If you're about to give above 70, ask yourself: "Would a VP of Sales watching this live be impressed?" If no, the score is too high.

${retryCount > 0 ? `This is retry #${retryCount}. Compare to what a first attempt typically looks like. If they improved, name exactly what changed. If they didn't improve meaningfully, say so directly — don't pretend marginal rewording is progress.` : ''}

RESPONSE RULES:
- "feedback": Exactly 2 sentences. Sentence 1: what they attempted (be specific to their response). Sentence 2: the specific miss or gap (name the exact behavior). If the score is below 70, your tone must be critical — no softening, no "good start," no "on the right track." Below 60, be blunt about what went wrong.
- "improvedVersion": Write the EXACT words a top-performing rep would say OUT LOUD in this conversation. Spoken language — contractions, natural rhythm. NOT marketing copy, NOT a framework recitation. 3-5 sentences that sound like a real human on a real call. Must directly address the buyer's exact words and situation.
- "topMistake": Pick the single most impactful mistake from the list.

INTERNAL VALIDATION (you must check these before finalizing):
1. If score < 70, feedback must NOT contain words like "good," "solid," "nice," "strong," "smart," "well," "clever," or "impressive."
2. If topMistake is "no_business_impact," the improvedVersion MUST include specific business impact language (revenue, margin, cost, ROI, or a concrete metric).
3. If topMistake is "too_long," the improvedVersion MUST be shorter than the rep's response.
4. If the rep's response is under 2 sentences, score cannot exceed 55.
5. For executive_response: if the rep's response exceeds 5 sentences, cap the score at 60.
6. For discovery: if the rep only asked a simple clarifying question without connecting to business impact, cap the score at 64.

Respond with ONLY valid JSON:
{
  "score": 60,
  "feedback": "What they did. What they missed.",
  "topMistake": "one_mistake_code",
  "improvedVersion": "Natural spoken words a great rep would actually say."
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
        regenParts.push(`REGENERATE "feedback": The current feedback is "${parsed.feedback}". The score is ${parsed.score} (below 70). Rewrite the feedback so it is critical and direct — no positive language, no softening. Keep it to exactly 2 sentences. Sentence 1: what they attempted. Sentence 2: the specific miss.`);
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
              { role: "system", content: `You are Dave — an elite, direct sales coach. ${tone} Keep spoken language quality. Be sharp, not soft.` },
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

      // Lightweight post-regen validation: flag if topMistake and improvedVersion may diverge
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
