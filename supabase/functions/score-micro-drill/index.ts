import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Lightweight micro-drill scorer.
 * Input:  { skill, prompt, instruction, response }
 * Output: { score, strength, miss, betterVersion, ready }
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { skill, prompt, instruction, response } = await req.json();

    if (!skill || !prompt || !response || response.length < 10) {
      return new Response(
        JSON.stringify({ error: "Missing required fields or response too short" }),
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

    const systemPrompt = `You are an elite sales coach evaluating a micro-drill response.
This is a short written practice exercise, not a full Dojo rep. Keep your evaluation concise.

SKILL: ${skill}
DRILL INSTRUCTION: ${instruction}

EVALUATION RULES:
- Score 1-10 (integer). 1-3 = weak, 4-6 = developing, 7-8 = solid, 9-10 = elite.
- "strength": one short sentence about what the rep did well (max 20 words).
- "miss": one short sentence about the single biggest gap (max 25 words).
- "betterVersion": a rewritten version of the rep's response that fixes the miss while keeping what worked. Write it as if you are the rep speaking. Keep it concise.
- "ready": true if score >= 6, false if score < 6. A score of 6+ means the rep grasps the core concept well enough to practice live.
- "coachingCue": one sentence describing the specific behavior to focus on in the next live practice rep (max 20 words).

Be honest but encouraging. This is a learning moment, not a test.`;

    const userPrompt = `SCENARIO: ${prompt}

REP WROTE: "${response}"

Return a JSON object with exactly these fields: score, strength, miss, betterVersion, ready, coachingCue`;

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

    const score = Math.max(1, Math.min(10, Math.round(Number(parsed.score) || 5)));

    const result = {
      score,
      strength: String(parsed.strength || "Good attempt."),
      miss: String(parsed.miss || "Could be more specific."),
      betterVersion: String(parsed.betterVersion || ""),
      ready: score >= 6,
      coachingCue: String(parsed.coachingCue || "Focus on specificity in your next rep."),
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("score-micro-drill error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
