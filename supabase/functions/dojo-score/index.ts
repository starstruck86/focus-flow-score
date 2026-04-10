import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
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

    const systemPrompt = `You are an elite sales coach grading a rep's response to a sales scenario. Grade HONESTLY — most reps are C-level.

GRADING CRITERIA (total 100pts):
1. ACKNOWLEDGE (10pts): Did they validate the buyer's concern without dismissing it?
2. ISOLATE (15pts): Did they ask a clarifying question or isolate the real issue?
3. REFRAME (25pts): Did they shift from cost/feature to value/impact?
4. EVIDENCE (15pts): Did they use proof points, data, or relevant examples?
5. ADVANCE (15pts): Did they maintain control and move toward a next step?
6. TONE (10pts): Was it conversational, not robotic?
7. CONCISENESS (10pts): Was it tight, not rambling?

SCORING:
- 85-100: Excellent — genuinely strong handle
- 70-84: Good — solid but has gaps
- 55-69: Average — gets through it but predictable
- 40-54: Below average — misses key opportunities
- <40: Poor — made it worse

Default to 55-65 unless they genuinely impressed you.

${retryCount > 0 ? `This is retry #${retryCount}. Note any improvement from a typical first attempt.` : ''}

Respond with ONLY valid JSON:
{
  "score": 62,
  "feedback": "Two sentences max. What they did well and what they missed. Be specific and direct — like a real coach.",
  "topMistake": "one of: pitched_too_early | weak_objection_handle | no_business_impact | lack_of_control | too_generic | too_long | no_proof | weak_close | stacked_questions | failed_to_deepen",
  "improvedVersion": "The exact words a strong rep would say. 3-5 sentences max. Natural, specific, powerful."
}`;

    const userPrompt = `SCENARIO:
Skill: ${scenario.skillFocus}
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
