/**
 * Dojo Review Scoring Edge Function
 *
 * Generates a deliberately weak response for critique, then scores
 * both diagnosis quality and rewrite quality separately.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// Canonical focus patterns
const VALID_FOCUS_PATTERNS: Record<string, string[]> = {
  objection_handling: ['isolate_before_answering', 'reframe_to_business_impact', 'use_specific_proof', 'control_next_step', 'stay_concise_under_pressure'],
  discovery: ['deepen_one_level', 'tie_to_business_impact', 'ask_singular_questions', 'test_urgency', 'quantify_the_pain'],
  executive_response: ['lead_with_the_number', 'cut_to_three_sentences', 'anchor_to_their_priority', 'project_certainty', 'close_with_a_specific_ask'],
  deal_control: ['control_next_step', 'name_the_risk', 'lock_mutual_commitment', 'test_before_accepting', 'create_urgency_without_pressure'],
  qualification: ['test_urgency', 'validate_real_pain', 'map_stakeholders', 'disqualify_weak_opportunities', 'tie_problem_to_business_impact'],
};
const ALL_VALID_IDS = new Set(Object.values(VALID_FOCUS_PATTERNS).flat());

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { scenario, skillFocus, action } = body;
    if (!scenario || !skillFocus || !action) {
      return new Response(JSON.stringify({ error: "Missing scenario, skillFocus, or action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (action === 'generate_weak') {
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
              content: `You are generating a SUBTLY FLAWED sales response for training purposes. The user will try to diagnose what's wrong, so the mistakes must require real skill to identify.

SCENARIO:
Skill: ${skillFocus}
Context: ${scenario.context}
Buyer says: "${scenario.objection}"

Write a response that sounds like a REAL rep on a REAL call — someone who is trying, has decent instincts, but makes 2-3 specific mistakes that separate them from elite.

CRITICAL RULES FOR REALISM:
1. The response must sound NATURAL — like spoken language on a call, not written text
2. It should sound COMPETENT on the surface — not obviously bad
3. The mistakes must be STRUCTURAL, not cosmetic:
   - Addressing the STATED concern but missing the REAL one (e.g., they say "timing" but mean "trust")
   - Using proof that is GENERIC instead of SPECIFIC to this buyer's situation
   - Asking a follow-up question but not the RIGHT follow-up question
   - Proposing a next step but ceding CONTROL of that step to the buyer
   - Showing knowledge but not CONNECTING it to this buyer's business impact
   - Being responsive but not ADVANCING the conversation
4. AVOID cartoonish mistakes like: "Our product is amazing!" / rambling nonsense / obvious feature-dumping
5. The response should be 2-4 sentences. A mediocre rep on their best day, not their worst.

A GOOD weak response makes you think "that's not terrible" on first read, but falls apart when you analyze what it ACTUALLY accomplishes.

Respond with ONLY valid JSON:
{
  "weakResponse": "The subtly flawed response (2-4 sentences, natural spoken tone)",
  "hiddenMistakes": ["mistake_code_1", "mistake_code_2"],
  "primaryMistake": "the_main_structural_mistake",
  "mistakeExplanations": {
    "mistake_code_1": "Why this specific choice weakens the response in THIS context",
    "mistake_code_2": "Why this matters for THIS buyer"
  }
}`
            },
            { role: "user", content: "Generate a weak response for this scenario." },
          ],
          temperature: 0.6,
          max_tokens: 1000,
        }),
      });

      if (!aiResp.ok) throw new Error(`AI request failed: ${aiResp.status}`);
      const aiData = await aiResp.json();
      let content = aiData.choices?.[0]?.message?.content || "";
      content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      return new Response(content, { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (action === 'score_review') {
      const { weakResponse, userDiagnosis, userRewrite } = body;
      const validPatterns = (VALID_FOCUS_PATTERNS[skillFocus] || []).join(', ');

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

Score TWO things separately:

DIAGNOSIS (50pts):
- Did they identify the PRIMARY mistake? (20pts) — not just a surface symptom
- Did they name SPECIFIC problems? (15pts) — not "it's too generic" but "they pitched features without understanding the real concern"
- Did they catch the DEEPER issue? (15pts) — the underlying pattern, not just the surface mistake

REWRITE (50pts):
- Does the rewrite ACTUALLY FIX the identified issues? (20pts) — or did they just rearrange the same approach?
- Is the rewrite materially STRONGER? (15pts) — specific, controlled, business-oriented?
- Would this rewrite work on a REAL call? (15pts) — natural language, appropriate length, confident?

CRITICAL DISTINCTION: "caught the issue" vs "fixed the issue"
- A rep who diagnoses "too generic" but rewrites with another generic answer gets high diagnosis, low rewrite.
- A rep who writes a great answer but misidentifies the problem gets low diagnosis, high rewrite.
- Score each independently.

FOCUS PATTERNS (pick ONE from this EXACT list): ${validPatterns}

Respond with ONLY valid JSON:
{
  "score": 60,
  "diagnosisScore": 30,
  "rewriteScore": 30,
  "feedback": "2 sentences on overall quality.",
  "topMistake": "what they missed in their diagnosis",
  "diagnosisFeedback": "What they correctly identified. What they missed. Was their analysis surface-level or did they see the deeper issue?",
  "rewriteFeedback": "Does the rewrite actually fix the problems? Where is it still weak? How does it compare to elite?",
  "diagnosisAccuracy": "correct|partial|missed",
  "rewriteFixedIssue": true,
  "improvedVersion": "What an elite diagnosis + rewrite combination would look like.",
  "worldClassResponse": "Top 1% response to this scenario.",
  "whyItWorks": ["Pattern 1", "Pattern 2"],
  "moveSequence": ["step 1", "step 2"],
  "patternTags": ["tag_one", "tag_two"],
  "focusPattern": "from_the_exact_list_above",
  "focusReason": "Because...",
  "practiceCue": "Instruction for next review.",
  "teachingNote": "Coaching principle.",
  "deltaNote": "Gap between improved and world-class."
}`
            },
            { role: "user", content: "Score this review exercise." },
          ],
          temperature: 0.3,
          max_tokens: 2500,
        }),
      });

      if (!aiResp.ok) throw new Error(`AI request failed: ${aiResp.status}`);
      const aiData = await aiResp.json();
      let content = aiData.choices?.[0]?.message?.content || "";
      content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(content);

      // Defaults
      if (typeof parsed.score === "number") parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
      if (typeof parsed.diagnosisScore !== "number") parsed.diagnosisScore = 0;
      if (typeof parsed.rewriteScore !== "number") parsed.rewriteScore = 0;
      if (!Array.isArray(parsed.patternTags)) parsed.patternTags = [];
      if (typeof parsed.focusPattern !== "string") parsed.focusPattern = "";
      if (!Array.isArray(parsed.moveSequence)) parsed.moveSequence = [];
      if (!Array.isArray(parsed.whyItWorks)) parsed.whyItWorks = [];
      if (typeof parsed.focusReason !== "string") parsed.focusReason = "";
      if (typeof parsed.practiceCue !== "string") parsed.practiceCue = "";
      if (typeof parsed.teachingNote !== "string") parsed.teachingNote = "";
      if (typeof parsed.deltaNote !== "string") parsed.deltaNote = "";
      if (typeof parsed.diagnosisFeedback !== "string") parsed.diagnosisFeedback = "";
      if (typeof parsed.rewriteFeedback !== "string") parsed.rewriteFeedback = "";
      if (typeof parsed.diagnosisAccuracy !== "string") parsed.diagnosisAccuracy = "partial";
      if (typeof parsed.rewriteFixedIssue !== "boolean") parsed.rewriteFixedIssue = false;

      // Normalize focusPattern
      if (parsed.focusPattern) {
        parsed.focusPattern = normalizeFocusPattern(parsed.focusPattern, skillFocus);
      }

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
