/**
 * Dojo Roleplay Scoring Edge Function
 *
 * Scores a multi-turn roleplay conversation using the same teaching framework as drill scoring.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { scenario, conversation, skillFocus } = await req.json();
    if (!scenario || !conversation || !skillFocus) {
      return new Response(JSON.stringify({ error: "Missing scenario, conversation, or skillFocus" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const SKILL_LABELS: Record<string, string> = {
      objection_handling: 'Objection Handling',
      discovery: 'Discovery',
      executive_response: 'Executive Response',
      deal_control: 'Deal Control',
      qualification: 'Qualification',
    };

    const conversationText = conversation
      .map((msg: { role: string; content: string }, i: number) => 
        `${msg.role === 'buyer' ? 'BUYER' : 'REP'}: "${msg.content}"`
      )
      .join('\n');

    const systemPrompt = `You are Dave — an elite sales coach reviewing a multi-turn roleplay session.

SCENARIO:
Skill tested: ${SKILL_LABELS[skillFocus] || skillFocus}
Context: ${scenario.context}
Opening: "${scenario.objection}"

CONVERSATION:
${conversationText}

Evaluate the REP's performance across ALL turns. Assess:
1. Consistency — did they maintain quality across turns or degrade?
2. Adaptability — did they adjust their approach based on buyer responses?
3. Control — did they maintain conversation direction or lose it?
4. Progression — did the conversation improve or get worse from the rep's side?

SCORING (100pts):
- 85-100: Exceptional across all turns. Maintained control, adapted well, advanced the conversation.
- 70-84: Strong overall with minor lapses. Good adaptation.
- 55-69: Average. Some good moments but inconsistent across turns.
- 40-54: Weak. Lost control, failed to adapt, or degraded across turns.
- Below 40: Poor. Conversation went badly due to rep's approach.

Respond with ONLY valid JSON:
{
  "score": 60,
  "feedback": "2 sentences. What worked across the conversation. What was the biggest gap.",
  "topMistake": "single_mistake_code",
  "improvedVersion": "What the rep should have said at the weakest moment in the conversation. Quote the buyer line they responded poorly to, then give the better version.",
  "worldClassResponse": "How a top 1% rep would have handled the ENTIRE conversation arc. Not just one turn — show the strategic approach across 3-4 key moments.",
  "whyItWorks": ["Pattern 1", "Pattern 2"],
  "moveSequence": ["step 1", "step 2", "step 3"],
  "patternTags": ["tag_one", "tag_two"],
  "focusPattern": "single_focus_pattern",
  "focusReason": "Because...",
  "practiceCue": "Short behavioral instruction for the next roleplay.",
  "teachingNote": "One sentence coaching principle.",
  "deltaNote": "One sentence on the gap between improved and world-class.",
  "turnAnalysis": [
    {"turn": 1, "assessment": "brief assessment of rep's turn 1"},
    {"turn": 2, "assessment": "brief assessment of rep's turn 2"}
  ]
}`;

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
          { role: "user", content: "Score this roleplay session." },
        ],
        temperature: 0.3,
        max_tokens: 2500,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limited." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI request failed: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(content);

    // Defaults
    if (typeof parsed.score === "number") parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    if (!Array.isArray(parsed.patternTags)) parsed.patternTags = [];
    if (typeof parsed.focusPattern !== "string") parsed.focusPattern = "";
    if (!Array.isArray(parsed.moveSequence)) parsed.moveSequence = [];
    if (typeof parsed.focusReason !== "string") parsed.focusReason = "";
    if (typeof parsed.practiceCue !== "string") parsed.practiceCue = "";
    if (typeof parsed.teachingNote !== "string") parsed.teachingNote = "";
    if (typeof parsed.deltaNote !== "string") parsed.deltaNote = "";
    if (!Array.isArray(parsed.whyItWorks)) parsed.whyItWorks = [];
    if (!Array.isArray(parsed.turnAnalysis)) parsed.turnAnalysis = [];

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("dojo-roleplay-score error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
