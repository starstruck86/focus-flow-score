import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Score the rep's original live response from a call transcript.
 * Uses the same scoring format as dojo-score for compatibility.
 * 
 * Input: { scenario, repResponse }
 * Output: { score, topMistake, feedback, improvedVersion, focusPattern, practiceCue }
 */

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
  const candidates = VALID_MISTAKES[skill] || [];
  const rawWords = raw.toLowerCase().replace(/_/g, ' ').split(' ').filter((w: string) => w.length >= 3);
  let best = ''; let bestScore = 0;
  for (const id of candidates) {
    const idWords = id.split('_');
    let score = 0;
    for (const w of rawWords) { if (idWords.some((k: string) => k.includes(w) || w.includes(k))) score++; }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (bestScore >= 1 && best) return best;
  return 'too_generic';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { scenario, repResponse } = await req.json();

    if (!scenario?.skillFocus || !scenario?.objection || !repResponse) {
      return new Response(
        JSON.stringify({ error: "Missing scenario or repResponse" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "Missing API key" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const skillMistakes = VALID_MISTAKES[scenario.skillFocus] || VALID_MISTAKES.objection_handling;

    const systemPrompt = `You are an elite sales coach scoring a rep's ACTUAL live call response.

This is NOT a practice response — this is what the rep really said on a real sales call.
Score it honestly using the same framework as practice scoring.

SKILL: ${scenario.skillFocus}

VALID topMistake values for this skill (pick exactly ONE):
${skillMistakes.join(', ')}

SCORING RULES:
- Score 0-100 based on how well the rep handled this specific moment
- Be calibrated: most real call responses score 30-60 (reps rarely nail live moments)
- A score above 70 on a live call response means genuinely strong execution
- Identify the single highest-leverage mistake
- Provide specific, actionable feedback
- Write an improved version showing what elite execution looks like

IMPORTANT: This is a LIVE response. Score what actually happened, not what could have happened.
Real call responses are messy, interrupted, and imperfect — that's expected.
Do NOT penalize for transcript artifacts (ums, pauses, interruptions).
DO penalize for strategic and structural mistakes.`;

    const userPrompt = `Score this live call response:

SITUATION: ${scenario.context}

BUYER SAID: "${scenario.objection}"

REP ACTUALLY SAID: "${repResponse}"

Return a JSON object with: score (0-100), topMistake (from valid list), feedback (2-3 sentences), improvedVersion (what elite execution looks like), practiceCue (one sentence drill instruction).`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      return new Response(
        JSON.stringify({ error: "AI scoring failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResp.json();
    const content = aiData.choices?.[0]?.message?.content || "{}";
    
    let parsed: Record<string, unknown>;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      return new Response(
        JSON.stringify({ error: "Failed to parse scoring response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 35)));
    const topMistake = normalizeTopMistake(String(parsed.topMistake || ""), scenario.skillFocus);

    const result = {
      score,
      topMistake,
      feedback: String(parsed.feedback || ""),
      improvedVersion: String(parsed.improvedVersion || ""),
      practiceCue: String(parsed.practiceCue || ""),
      isOriginalCall: true,
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("score-original-response error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
