import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const { transcript_id } = await req.json();
    if (!transcript_id) throw new Error("transcript_id required");

    const { data: transcript, error: tErr } = await supabase
      .from("call_transcripts")
      .select("*")
      .eq("id", transcript_id)
      .single();
    if (tErr || !transcript) throw new Error("Transcript not found");

    // Fetch resources for methodology context
    const { data: resources } = await supabase
      .from("resource_links")
      .select("label, category, url, notes")
      .limit(20);

    const resourceContext = (resources || []).length > 0
      ? `The user follows these sales methodologies:\n${(resources || []).map((r: any) => `- ${r.label} (${r.category})${r.notes ? ': ' + r.notes : ''}`).join('\n')}`
      : "No specific methodology resources uploaded. Use Command of the Message + MEDDICC as primary frameworks.";

    let accountContext = "";
    if (transcript.account_id) {
      const { data: account } = await supabase
        .from("accounts")
        .select("name, industry, tier, motion")
        .eq("id", transcript.account_id)
        .single();
      if (account) {
        accountContext = `\nAccount: ${account.name} (${account.industry || 'unknown'}, Tier ${account.tier || 'B'}, ${account.motion || 'new-logo'})`;
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an elite sales performance enforcement engine. You analyze call transcripts with brutal precision using mandatory frameworks. You are NOT a summarizer — you are a coaching system that drives behavioral change.

## MANDATORY FRAMEWORKS

### Command of the Message (CotM)
Detect whether the rep established:
- BEFORE: Current state / status quo pain
- Negative Consequences: What happens if they don't change
- AFTER: Desired future state
- Positive Business Outcomes (PBOs): Quantified business impact
- Required Capabilities: What they need to achieve the AFTER
- Metrics: Specific numbers tied to outcomes

### MEDDICC
Evaluate coverage of:
- Metrics: Were specific success metrics discussed?
- Economic Buyer: Was the EB identified or engaged?
- Decision Criteria: Were buying criteria uncovered?
- Decision Process: Was the buying process mapped?
- Identify Pain: Was pain clearly articulated with impact?
- Champion: Was a champion identified or tested?
- Competition: Was competitive landscape discussed?

### Call Structure & Coaching Framework
Evaluate segments:
- Kickoff / Agenda Setting
- Discovery quality
- Pain + Impact exploration
- Executive Business Case building
- Objection Handling
- Next Steps / Close control
- Executive Presence (talk ratio, rambling, interruptions, flow control)

## GRADING RULES
- Use 1-5 scale for ALL category scores. Most reps are 2-3. A 5 requires exceptional execution.
- Overall score is 1-5 weighted average.
- Be brutally honest. Generic praise is failure.
- Every score MUST have evidence (exact transcript quotes).
- ALWAYS identify the ONE highest-ROI coaching action.
- Tie all feedback to revenue, risk, or deal progression — never abstract advice.

${resourceContext}
${accountContext}`;

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
          { role: "user", content: `Analyze this call transcript with full framework enforcement.\n\nTitle: ${transcript.title}\nType: ${transcript.call_type || 'Unknown'}\nParticipants: ${transcript.participants || 'Unknown'}\n\nTranscript:\n${transcript.content.substring(0, 15000)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "score_transcript",
            description: "Submit comprehensive framework-based scoring for a sales call transcript",
            parameters: {
              type: "object",
              properties: {
                // Overall
                overall_score: { type: "integer", minimum: 1, maximum: 5, description: "Overall score 1-5" },
                overall_grade: { type: "string", enum: ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"] },
                summary: { type: "string", description: "2-3 sentence executive summary. Direct, analytical." },

                // Category scores (1-5 each)
                structure_score: { type: "integer", minimum: 1, maximum: 5, description: "Call structure quality" },
                cotm_score: { type: "integer", minimum: 1, maximum: 5, description: "Command of the Message coverage" },
                meddicc_score: { type: "integer", minimum: 1, maximum: 5, description: "MEDDICC completeness" },
                discovery_score: { type: "integer", minimum: 1, maximum: 5, description: "Discovery depth and quality" },
                presence_score: { type: "integer", minimum: 1, maximum: 5, description: "Executive presence" },
                commercial_score: { type: "integer", minimum: 1, maximum: 5, description: "Commercial acumen" },
                next_step_score: { type: "integer", minimum: 1, maximum: 5, description: "Next step control and close" },

                // Legacy dimension scores (0-100 for backward compat)
                style_score: { type: "integer", minimum: 0, maximum: 100 },
                acumen_score: { type: "integer", minimum: 0, maximum: 100 },
                cadence_score: { type: "integer", minimum: 0, maximum: 100 },

                // CotM signals
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

                // MEDDICC signals
                meddicc_signals: {
                  type: "object",
                  properties: {
                    metrics: { type: "boolean" },
                    metrics_detail: { type: "string" },
                    economic_buyer: { type: "boolean" },
                    economic_buyer_detail: { type: "string" },
                    decision_criteria: { type: "boolean" },
                    decision_criteria_detail: { type: "string" },
                    decision_process: { type: "boolean" },
                    decision_process_detail: { type: "string" },
                    identify_pain: { type: "boolean" },
                    identify_pain_detail: { type: "string" },
                    champion: { type: "boolean" },
                    champion_detail: { type: "string" },
                    competition: { type: "boolean" },
                    competition_detail: { type: "string" },
                  },
                  required: ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion", "competition"],
                  additionalProperties: false,
                },

                // Discovery stats
                discovery_stats: {
                  type: "object",
                  properties: {
                    total_questions: { type: "integer" },
                    open_ended_pct: { type: "integer", description: "Percentage of open-ended questions" },
                    impact_questions: { type: "integer", description: "Count of why/impact/example questions" },
                    follow_up_depth: { type: "integer", minimum: 1, maximum: 5, description: "How deep the follow-up chains went" },
                  },
                  required: ["total_questions", "open_ended_pct", "impact_questions", "follow_up_depth"],
                  additionalProperties: false,
                },

                // Presence stats
                presence_stats: {
                  type: "object",
                  properties: {
                    talk_ratio_estimate: { type: "integer", description: "Estimated rep talk % (0-100)" },
                    rambling_detected: { type: "boolean" },
                    interruptions_detected: { type: "boolean" },
                    flow_control: { type: "integer", minimum: 1, maximum: 5 },
                  },
                  required: ["talk_ratio_estimate", "rambling_detected", "interruptions_detected", "flow_control"],
                  additionalProperties: false,
                },

                // Call segments identified
                call_segments: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      segment: { type: "string", enum: ["intro_agenda", "discovery", "pain_impact", "solution_framing", "objection_handling", "next_steps", "other"] },
                      quality: { type: "integer", minimum: 1, maximum: 5 },
                      notes: { type: "string" },
                    },
                    required: ["segment", "quality", "notes"],
                    additionalProperties: false,
                  },
                },

                // Evidence layer - exact quotes with context
                evidence: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string" },
                      score_given: { type: "integer" },
                      quote: { type: "string", description: "Exact transcript quote" },
                      assessment: { type: "string", description: "Why this matters" },
                    },
                    required: ["category", "score_given", "quote", "assessment"],
                    additionalProperties: false,
                  },
                },

                // PRIMARY COACHING ACTION (single focus rule)
                feedback_focus: { type: "string", enum: ["style", "acumen", "cadence"] },
                coaching_issue: { type: "string", description: "Specific issue identified" },
                coaching_why: { type: "string", description: "Why this matters — tie to revenue/risk/deal progression" },
                transcript_moment: { type: "string", description: "Exact transcript moment where this occurred" },
                replacement_behavior: { type: "string", description: "Exact wording/behavior to use instead. Be prescriptive." },
                actionable_feedback: { type: "string", description: "Full coaching insight combining issue + why + replacement" },

                // Strengths (max 3, evidence-backed)
                strengths: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      point: { type: "string" },
                      evidence: { type: "string" },
                    },
                    required: ["point", "evidence"],
                    additionalProperties: false,
                  },
                  maxItems: 3,
                },

                // Missed opportunities
                missed_opportunities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      opportunity: { type: "string" },
                      moment: { type: "string", description: "Where in the call this could have happened" },
                      example: { type: "string", description: "What they should have said/done" },
                    },
                    required: ["opportunity", "moment", "example"],
                    additionalProperties: false,
                  },
                },

                // Questions they should have asked (framework-generated)
                suggested_questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      framework: { type: "string", description: "Which framework this maps to" },
                      why: { type: "string" },
                    },
                    required: ["question", "framework", "why"],
                    additionalProperties: false,
                  },
                },

                // Behavioral flags for pattern tracking
                behavioral_flags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Behavioral patterns detected, e.g. 'over_talking', 'weak_questioning', 'premature_solution', 'no_next_step', 'weak_close', 'no_business_case', 'skipped_discovery'"
                },

                // Notes per dimension
                style_notes: { type: "string" },
                acumen_notes: { type: "string" },
                cadence_notes: { type: "string" },
                methodology_alignment: { type: "string" },
              },
              required: [
                "overall_score", "overall_grade", "summary",
                "structure_score", "cotm_score", "meddicc_score", "discovery_score",
                "presence_score", "commercial_score", "next_step_score",
                "style_score", "acumen_score", "cadence_score",
                "cotm_signals", "meddicc_signals", "discovery_stats", "presence_stats",
                "call_segments", "evidence",
                "feedback_focus", "coaching_issue", "coaching_why",
                "transcript_moment", "replacement_behavior", "actionable_feedback",
                "strengths", "missed_opportunities", "suggested_questions",
                "behavioral_flags", "style_notes", "acumen_notes", "cadence_notes"
              ],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "score_transcript" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      throw new Error("AI grading failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No grading response from AI");

    const grade = JSON.parse(toolCall.function.arguments);

    // Transform strengths array to simple strings for backward compat
    const strengthStrings = (grade.strengths || []).map((s: any) => typeof s === 'string' ? s : s.point);
    const improvementStrings = (grade.missed_opportunities || []).map((m: any) => typeof m === 'string' ? m : m.opportunity);

    const { data: saved, error: saveErr } = await supabase
      .from("transcript_grades")
      .upsert({
        user_id: user.id,
        transcript_id,
        overall_grade: grade.overall_grade,
        overall_score: grade.overall_score * 20, // Scale 1-5 to 0-100 for storage
        style_score: grade.style_score,
        acumen_score: grade.acumen_score,
        cadence_score: grade.cadence_score,
        style_notes: grade.style_notes,
        acumen_notes: grade.acumen_notes,
        cadence_notes: grade.cadence_notes,
        strengths: strengthStrings,
        improvements: improvementStrings,
        actionable_feedback: grade.actionable_feedback,
        feedback_focus: grade.feedback_focus,
        summary: grade.summary,
        methodology_alignment: grade.methodology_alignment || null,
        // New framework fields
        structure_score: grade.structure_score,
        cotm_score: grade.cotm_score,
        meddicc_score: grade.meddicc_score,
        discovery_score: grade.discovery_score,
        presence_score: grade.presence_score,
        commercial_score: grade.commercial_score,
        next_step_score: grade.next_step_score,
        call_segments: grade.call_segments,
        cotm_signals: grade.cotm_signals,
        meddicc_signals: grade.meddicc_signals,
        discovery_stats: grade.discovery_stats,
        presence_stats: grade.presence_stats,
        evidence: grade.evidence,
        missed_opportunities: grade.missed_opportunities,
        suggested_questions: grade.suggested_questions,
        behavioral_flags: grade.behavioral_flags,
        replacement_behavior: grade.replacement_behavior,
        coaching_issue: grade.coaching_issue,
        coaching_why: grade.coaching_why,
        transcript_moment: grade.transcript_moment,
        call_type: transcript.call_type,
      }, { onConflict: "transcript_id" })
      .select()
      .single();

    if (saveErr) {
      console.error("Save error:", saveErr);
      throw new Error("Failed to save grade");
    }

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("grade-transcript error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
