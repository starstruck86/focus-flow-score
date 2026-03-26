import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_id } = await req.json();
    if (!session_id) throw new Error("session_id required");

    // Fetch session
    const { data: session, error: sErr } = await supabase
      .from("mock_call_sessions")
      .select("*")
      .eq("id", session_id)
      .single();
    if (sErr || !session) throw new Error("Session not found");

    const messages = (session.messages as any[]) || [];
    if (messages.length < 4) throw new Error("Not enough conversation to grade");

    // Build transcript from messages
    const transcript = messages
      .map((m: any) => `${m.role === 'user' ? 'REP' : 'BUYER'}: ${m.content}`)
      .join('\n\n');

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an elite sales performance enforcement engine analyzing a MOCK CALL SIMULATION. The conversation was between a sales rep (REP) and an AI buyer (BUYER) in a roleplay exercise.

Grade this simulation with the SAME rigor as a real call. The frameworks are identical.

## CONTEXT
- Call Type: ${session.call_type}
- Persona: ${session.persona}
- Industry: ${session.industry || 'Unknown'}
- Difficulty: ${session.difficulty}/4
${session.skill_mode ? `- Skill Focus: ${session.skill_mode}` : ''}

## MANDATORY FRAMEWORKS

### Command of the Message (CotM)
- BEFORE: Current state / status quo pain identified?
- Negative Consequences explored?
- AFTER: Desired future state defined?
- PBOs: Quantified business outcomes?
- Required Capabilities uncovered?
- Metrics captured?

### MEDDICC
- Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion, Competition

### Discovery Quality
- Open vs closed questions, depth, impact questions, follow-up strength

### Executive Presence
- Talk ratio, conciseness, confidence, flow control

## GRADING RULES
- 1-5 scale. Most reps score 2-3. A 5 requires exceptional execution.
- Be brutally honest. No participation trophies.
- Quote exact moments from the simulation as evidence.
- Identify the ONE highest-ROI coaching action.
- Include "What Elite Would Have Done" — better questions and approaches the rep should have used.

## ADDITIONAL FOR MOCK CALLS
- Also provide an "elite_alternatives" array showing 3-5 specific things an elite rep would have done differently, with exact example phrases.
- Provide a "win_assessment" — did the rep earn the right to a next step? Would a real buyer agree to advance?`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Grade this mock call simulation:\n\n${transcript.substring(0, 15000)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "grade_mock_call",
            description: "Submit comprehensive grading for a mock call simulation",
            parameters: {
              type: "object",
              properties: {
                overall_score: { type: "integer", minimum: 1, maximum: 5 },
                overall_grade: { type: "string", enum: ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"] },
                summary: { type: "string" },
                structure_score: { type: "integer", minimum: 1, maximum: 5 },
                cotm_score: { type: "integer", minimum: 1, maximum: 5 },
                meddicc_score: { type: "integer", minimum: 1, maximum: 5 },
                discovery_score: { type: "integer", minimum: 1, maximum: 5 },
                presence_score: { type: "integer", minimum: 1, maximum: 5 },
                commercial_score: { type: "integer", minimum: 1, maximum: 5 },
                next_step_score: { type: "integer", minimum: 1, maximum: 5 },
                cotm_signals: {
                  type: "object",
                  properties: {
                    before_identified: { type: "boolean" },
                    before_evidence: { type: "string" },
                    negative_consequences: { type: "boolean" },
                    negative_consequences_evidence: { type: "string" },
                    after_defined: { type: "boolean" },
                    after_evidence: { type: "string" },
                    pbo_articulated: { type: "boolean" },
                    pbo_evidence: { type: "string" },
                    required_capabilities: { type: "boolean" },
                    capabilities_evidence: { type: "string" },
                    metrics_captured: { type: "boolean" },
                    metrics_evidence: { type: "string" },
                  },
                  required: ["before_identified", "negative_consequences", "after_defined", "pbo_articulated", "required_capabilities", "metrics_captured"],
                  additionalProperties: false,
                },
                meddicc_signals: {
                  type: "object",
                  properties: {
                    metrics: { type: "boolean" }, metrics_detail: { type: "string" },
                    economic_buyer: { type: "boolean" }, economic_buyer_detail: { type: "string" },
                    decision_criteria: { type: "boolean" }, decision_criteria_detail: { type: "string" },
                    decision_process: { type: "boolean" }, decision_process_detail: { type: "string" },
                    identify_pain: { type: "boolean" }, identify_pain_detail: { type: "string" },
                    champion: { type: "boolean" }, champion_detail: { type: "string" },
                    competition: { type: "boolean" }, competition_detail: { type: "string" },
                  },
                  required: ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion", "competition"],
                  additionalProperties: false,
                },
                discovery_stats: {
                  type: "object",
                  properties: {
                    total_questions: { type: "integer" },
                    open_ended_pct: { type: "integer" },
                    impact_questions: { type: "integer" },
                    follow_up_depth: { type: "integer", minimum: 1, maximum: 5 },
                  },
                  required: ["total_questions", "open_ended_pct", "impact_questions", "follow_up_depth"],
                  additionalProperties: false,
                },
                presence_stats: {
                  type: "object",
                  properties: {
                    talk_ratio_estimate: { type: "integer" },
                    rambling_detected: { type: "boolean" },
                    interruptions_detected: { type: "boolean" },
                    flow_control: { type: "integer", minimum: 1, maximum: 5 },
                  },
                  required: ["talk_ratio_estimate", "rambling_detected", "interruptions_detected", "flow_control"],
                  additionalProperties: false,
                },
                evidence: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string" },
                      score_given: { type: "integer" },
                      quote: { type: "string" },
                      assessment: { type: "string" },
                    },
                    required: ["category", "score_given", "quote", "assessment"],
                    additionalProperties: false,
                  },
                },
                feedback_focus: { type: "string", enum: ["style", "acumen", "cadence"] },
                coaching_issue: { type: "string" },
                coaching_why: { type: "string" },
                transcript_moment: { type: "string" },
                replacement_behavior: { type: "string" },
                strengths: {
                  type: "array",
                  items: { type: "object", properties: { point: { type: "string" }, evidence: { type: "string" } }, required: ["point", "evidence"], additionalProperties: false },
                  maxItems: 3,
                },
                missed_opportunities: {
                  type: "array",
                  items: { type: "object", properties: { opportunity: { type: "string" }, moment: { type: "string" }, example: { type: "string" } }, required: ["opportunity", "moment", "example"], additionalProperties: false },
                },
                suggested_questions: {
                  type: "array",
                  items: { type: "object", properties: { question: { type: "string" }, framework: { type: "string" }, why: { type: "string" } }, required: ["question", "framework", "why"], additionalProperties: false },
                },
                behavioral_flags: { type: "array", items: { type: "string" } },
                elite_alternatives: {
                  type: "array",
                  items: { type: "object", properties: { what_rep_did: { type: "string" }, what_elite_would_do: { type: "string" }, example_phrase: { type: "string" } }, required: ["what_rep_did", "what_elite_would_do", "example_phrase"], additionalProperties: false },
                },
                win_assessment: { type: "string", description: "Did the rep earn the right to advance? Would a real buyer agree to a next step?" },
              },
              required: [
                "overall_score", "overall_grade", "summary",
                "structure_score", "cotm_score", "meddicc_score", "discovery_score",
                "presence_score", "commercial_score", "next_step_score",
                "cotm_signals", "meddicc_signals", "discovery_stats", "presence_stats",
                "evidence", "feedback_focus", "coaching_issue", "coaching_why",
                "transcript_moment", "replacement_behavior",
                "strengths", "missed_opportunities", "suggested_questions",
                "behavioral_flags", "elite_alternatives", "win_assessment"
              ],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "grade_mock_call" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI grading failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No grading response from AI");

    const grade = JSON.parse(toolCall.function.arguments);

    // Save grade to session
    const { error: updateErr } = await supabase
      .from("mock_call_sessions")
      .update({
        grade_data: grade,
        overall_grade: grade.overall_grade,
        overall_score: grade.overall_score,
        status: 'graded',
        ended_at: new Date().toISOString(),
      })
      .eq("id", session_id);

    if (updateErr) console.error("Failed to save grade:", updateErr);

    return new Response(JSON.stringify(grade), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("grade-mock-call error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
