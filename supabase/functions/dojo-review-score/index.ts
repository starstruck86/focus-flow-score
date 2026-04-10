/**
 * Dojo Review Scoring Edge Function
 *
 * Generates a weak response for the user to critique, then scores their diagnosis + rewrite.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { scenario, skillFocus, action } = await req.json();
    if (!scenario || !skillFocus || !action) {
      return new Response(JSON.stringify({ error: "Missing scenario, skillFocus, or action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (action === 'generate_weak') {
      // Generate a deliberately weak response for the user to critique
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are generating a DELIBERATELY WEAK sales response for training purposes.

SCENARIO:
Skill: ${skillFocus}
Context: ${scenario.context}
Buyer says: "${scenario.objection}"

Write a response that a mediocre rep would give. It should contain 2-3 specific mistakes that a coach would identify. The response should be plausible (something a real rep might say) but clearly flawed.

Common mistakes to include:
- Being too generic
- Missing business impact
- Losing control
- Pitching too early
- Being too long/rambling
- Not addressing the real concern

Respond with ONLY valid JSON:
{
  "weakResponse": "The deliberately flawed response (3-5 sentences, spoken language)",
  "hiddenMistakes": ["mistake_1", "mistake_2", "mistake_3"],
  "primaryMistake": "the_main_mistake_code"
}`
            },
            { role: "user", content: "Generate a weak response for this scenario." },
          ],
          temperature: 0.5,
          max_tokens: 800,
        }),
      });

      if (!aiResp.ok) throw new Error(`AI request failed: ${aiResp.status}`);
      const aiData = await aiResp.json();
      let content = aiData.choices?.[0]?.message?.content || "";
      content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      return new Response(content, { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (action === 'score_review') {
      const { weakResponse, userDiagnosis, userRewrite } = await req.json();

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are Dave — an elite sales coach scoring a REVIEW exercise.

SCENARIO:
Skill: ${skillFocus}
Context: ${scenario.context}
Buyer says: "${scenario.objection}"

WEAK RESPONSE SHOWN TO REP:
"${weakResponse}"

REP'S DIAGNOSIS (what they think is wrong):
"${userDiagnosis}"

REP'S REWRITE (their improved version):
"${userRewrite}"

Score TWO things:
1. DIAGNOSIS quality (50pts): Did they identify the real problems? Were they specific? Did they name the right mistakes?
2. REWRITE quality (50pts): Is the rewrite actually better? Does it fix the identified issues? Is it specific and usable?

Respond with ONLY valid JSON:
{
  "score": 60,
  "diagnosisScore": 30,
  "rewriteScore": 30,
  "feedback": "2 sentences on overall quality.",
  "topMistake": "what they missed in their diagnosis",
  "diagnosisFeedback": "What they caught and what they missed in the weak response.",
  "rewriteFeedback": "How the rewrite compares to what an elite rep would say.",
  "improvedVersion": "What an elite diagnosis + rewrite would look like.",
  "worldClassResponse": "Top 1% response to this scenario.",
  "whyItWorks": ["Pattern 1", "Pattern 2"],
  "moveSequence": ["step 1", "step 2"],
  "patternTags": ["tag_one", "tag_two"],
  "focusPattern": "single_focus",
  "focusReason": "Because...",
  "practiceCue": "Instruction for next review.",
  "teachingNote": "Coaching principle.",
  "deltaNote": "Gap between improved and world-class."
}`
            },
            { role: "user", content: "Score this review exercise." },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
      });

      if (!aiResp.ok) throw new Error(`AI request failed: ${aiResp.status}`);
      const aiData = await aiResp.json();
      let content = aiData.choices?.[0]?.message?.content || "";
      content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(content);

      // Defaults
      if (typeof parsed.score === "number") parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
      if (!Array.isArray(parsed.patternTags)) parsed.patternTags = [];
      if (typeof parsed.focusPattern !== "string") parsed.focusPattern = "";
      if (!Array.isArray(parsed.moveSequence)) parsed.moveSequence = [];
      if (!Array.isArray(parsed.whyItWorks)) parsed.whyItWorks = [];
      if (typeof parsed.focusReason !== "string") parsed.focusReason = "";
      if (typeof parsed.practiceCue !== "string") parsed.practiceCue = "";
      if (typeof parsed.teachingNote !== "string") parsed.teachingNote = "";
      if (typeof parsed.deltaNote !== "string") parsed.deltaNote = "";

      return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("dojo-review-score error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
