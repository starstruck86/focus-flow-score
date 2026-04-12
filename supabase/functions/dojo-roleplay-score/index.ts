/**
 * Dojo Roleplay Scoring Edge Function
 *
 * Scores a multi-turn roleplay conversation with turn-level analysis,
 * control/adaptation/progression assessment, and canonical focus patterns.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// Canonical focus patterns (same as dojo-score)
const VALID_FOCUS_PATTERNS: Record<string, string[]> = {
  objection_handling: ['isolate_before_answering', 'reframe_to_business_impact', 'use_specific_proof', 'control_next_step', 'stay_concise_under_pressure'],
  discovery: ['deepen_one_level', 'tie_to_business_impact', 'ask_singular_questions', 'test_urgency', 'quantify_the_pain'],
  executive_response: ['lead_with_the_number', 'cut_to_three_sentences', 'anchor_to_their_priority', 'project_certainty', 'close_with_a_specific_ask'],
  deal_control: ['control_next_step', 'name_the_risk', 'lock_mutual_commitment', 'test_before_accepting', 'create_urgency_without_pressure'],
  qualification: ['test_urgency', 'validate_real_pain', 'map_stakeholders', 'disqualify_weak_opportunities', 'tie_problem_to_business_impact'],
};
const ALL_VALID_IDS = new Set(Object.values(VALID_FOCUS_PATTERNS).flat());

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
  const rawWords = raw.toLowerCase().replace(/_/g, ' ').split(' ').filter(w => w.length >= 3);
  let best = ''; let bestScore = 0;
  for (const id of candidates) {
    const idWords = id.split('_');
    let score = 0;
    for (const w of rawWords) { if (idWords.some(k => k.includes(w) || w.includes(k))) score++; }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (bestScore >= 1 && best) return best;
  return 'too_generic';
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

const SKILL_LABELS: Record<string, string> = {
  objection_handling: 'Objection Handling',
  discovery: 'Discovery',
  executive_response: 'Executive Response',
  deal_control: 'Deal Control',
  qualification: 'Qualification',
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

    const repTurns = conversation.filter((m: { role: string }) => m.role === 'rep').length;
    const validPatterns = (VALID_FOCUS_PATTERNS[skillFocus] || []).join(', ');

    const conversationText = conversation
      .map((msg: { role: string; content: string }, i: number) =>
        `Turn ${Math.floor(i / 2) + 1} — ${msg.role === 'buyer' ? 'BUYER' : 'REP'}: "${msg.content}"`
      )
      .join('\n');

    const systemPrompt = `You are Dave — an elite sales coach reviewing a ${repTurns}-turn roleplay session.

SCENARIO:
Skill tested: ${SKILL_LABELS[skillFocus] || skillFocus}
Context: ${scenario.context}
Opening: "${scenario.objection}"

CONVERSATION:
${conversationText}

ROLEPLAY-SPECIFIC ASSESSMENT (evaluate ALL of these):

1. CONTROL ACROSS TURNS (25pts): Did the rep maintain or gain control of the conversation? Did they drive toward an outcome, or did the buyer lead? Losing control early and never recovering = 0-10pts. Starting weak but recovering = 15pts. Consistent control = 20-25pts.

2. ADAPTATION (25pts): Did the rep adjust their approach based on the buyer's responses? Did they hear what the buyer said and respond to it, or did they stick to a script? Repeating the same move across turns = 0-10pts. Noticing buyer signals and pivoting = 15-20pts. Reading the room and shifting strategy = 20-25pts.

3. PROGRESSION (25pts): Did the conversation move forward? Did it get closer to a next step, a deeper understanding, or a commitment? Circular conversations = 0-10pts. Some forward movement = 15pts. Clear progression toward outcome = 20-25pts.

4. CONSISTENCY (25pts): Was the quality stable across turns, or did the rep start strong and fade? Degrading quality = 0-10pts. Uneven = 15pts. Consistent or improving = 20-25pts.

SCORING:
- 85-100: Exceptional across all turns. Maintained control, adapted well, advanced the conversation.
- 70-84: Strong overall with minor lapses.
- 55-69: Average. Some good moments but inconsistent.
- 40-54: Weak. Lost control, failed to adapt, or degraded.
- Below 40: Poor. Conversation went badly.

YOUR DEFAULT IS 55-62. Multi-turn consistency is HARD — most reps degrade after turn 2.

FOCUS PATTERNS (pick ONE from this EXACT list): ${validPatterns}

TURN ANALYSIS: For each rep turn, provide a brief assessment (1-2 sentences) covering:
- What they did well or poorly in that specific moment
- Whether they maintained/gained/lost control
- How they responded to the buyer's previous message

Respond with ONLY valid JSON:
{
  "score": 60,
  "feedback": "2 sentences. What worked across the conversation. The biggest gap.",
  "topMistake": "single_mistake_code",
  "improvedVersion": "What the rep should have said at the WEAKEST moment. Quote the buyer line, then give the better version.",
  "worldClassResponse": "How a top 1% rep would have handled the ENTIRE arc — show the strategic approach across 3-4 key moments.",
  "whyItWorks": ["Pattern 1", "Pattern 2"],
  "moveSequence": ["step 1", "step 2", "step 3"],
  "patternTags": ["tag_one", "tag_two"],
  "focusPattern": "from_the_exact_list_above",
  "focusReason": "Because...",
  "practiceCue": "One concrete behavioral instruction for the next roleplay.",
  "teachingNote": "One sentence coaching principle.",
  "deltaNote": "One sentence on the gap between improved and world-class.",
  "turnAnalysis": [
    {"turn": 1, "assessment": "What the rep did in turn 1 — control, adaptation, quality.", "verdict": "strong|adequate|weak"},
    {"turn": 2, "assessment": "Turn 2 assessment.", "verdict": "strong|adequate|weak"}
  ],
  "controlArc": "One sentence describing how control shifted across the conversation.",
  "adaptationNote": "One sentence on the rep's ability to adjust to buyer signals."
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
        max_tokens: 3000,
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
    if (typeof parsed.controlArc !== "string") parsed.controlArc = "";
    if (typeof parsed.adaptationNote !== "string") parsed.adaptationNote = "";

    // Normalize focusPattern
    if (parsed.focusPattern) {
      parsed.focusPattern = normalizeFocusPattern(parsed.focusPattern, skillFocus);
    }

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
