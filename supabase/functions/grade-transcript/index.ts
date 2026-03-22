import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const traceId = req.headers.get("x-trace-id") || "no-trace";

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

    const { transcript_id, call_goals } = await req.json();
    if (!transcript_id) throw new Error("transcript_id required");

    const { data: transcript, error: tErr } = await supabase
      .from("call_transcripts")
      .select("*")
      .eq("id", transcript_id)
      .single();
    if (tErr || !transcript) throw new Error("Transcript not found");

    // Fetch resources, digests, prior grades for cumulative context, and opportunity data
    const [resourceLinksRes, digestsRes, priorGradesRes, opportunityRes] = await Promise.all([
      supabase
        .from("resource_links")
        .select("label, category, url, notes")
        .limit(20),
      supabase
        .from("resource_digests")
        .select("resource_id, grading_criteria")
        .not("grading_criteria", "is", null),
      // Fetch prior grades for same opportunity to build cumulative MEDDICC context
      transcript.opportunity_id
        ? supabase
            .from("transcript_grades")
            .select("meddicc_signals, cotm_signals, overall_grade, call_goals_inferred, deal_progressed, created_at")
            .eq("user_id", user.id)
            .neq("transcript_id", transcript_id)
            .order("created_at", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [] }),
      // Fetch opportunity stage/next steps for cycle context
      transcript.opportunity_id
        ? supabase
            .from("opportunities")
            .select("name, stage, next_step, next_step_date, arr, close_date, status")
            .eq("id", transcript.opportunity_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const resources = resourceLinksRes.data || [];
    const digests = digestsRes.data || [];
    const priorGrades = priorGradesRes.data || [];
    const opportunity = opportunityRes.data;

    const resourceContext = resources.length > 0
      ? `The user follows these sales methodologies:\n${resources.map((r: any) => `- ${r.label} (${r.category})${r.notes ? ': ' + r.notes : ''}`).join('\n')}`
      : "No specific methodology resources uploaded. Use Command of the Message + MEDDICC as primary frameworks.";

    // Build custom scorecard context from digested resources
    let customScorecardContext = "";
    const customCriteria: any[] = [];
    if (digests.length > 0) {
      for (const d of digests as any[]) {
        if (d.grading_criteria && Array.isArray(d.grading_criteria)) {
          customCriteria.push(...d.grading_criteria);
        }
      }
      if (customCriteria.length > 0) {
        customScorecardContext = `\n\n## CUSTOM SCORECARD CRITERIA\nIn addition to standard frameworks, also score the transcript against these custom criteria (1-5 each):\n${customCriteria.map((c: any, i: number) => `${i + 1}. ${c.category}: ${c.description} (weight: ${c.weight})`).join('\n')}`;
      }
    }

    // Build cumulative MEDDICC context from prior grades
    let cumulativeContext = "";
    if (priorGrades.length > 0) {
      const confirmed: string[] = [];
      const unconfirmed: string[] = [];
      const meddiccFields = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'];
      const fieldLabels: Record<string, string> = { metrics: 'Metrics', economic_buyer: 'Economic Buyer', decision_criteria: 'Decision Criteria', decision_process: 'Decision Process', identify_pain: 'Identify Pain', champion: 'Champion', competition: 'Competition' };
      
      for (const field of meddiccFields) {
        const everConfirmed = priorGrades.some((g: any) => g.meddicc_signals?.[field]);
        if (everConfirmed) confirmed.push(fieldLabels[field]);
        else unconfirmed.push(fieldLabels[field]);
      }
      
      cumulativeContext = `\n\n## CUMULATIVE DEAL CONTEXT\nPrior calls have confirmed these MEDDICC elements: ${confirmed.join(', ') || 'None'}\nStill unconfirmed: ${unconfirmed.join(', ') || 'All confirmed'}\nPrior call count: ${priorGrades.length}\nPrior grades: ${priorGrades.map((g: any) => g.overall_grade).join(', ')}`;
      
      if (priorGrades.some((g: any) => g.deal_progressed)) {
        cumulativeContext += "\nDeal has shown forward progression in prior calls.";
      }
    }

    // Build opportunity context
    let opportunityContext = "";
    if (opportunity) {
      opportunityContext = `\n\n## OPPORTUNITY CONTEXT\nDeal: ${opportunity.name}\nStage: ${opportunity.stage || 'Unknown'}\nARR: $${opportunity.arr || 0}\nClose Date: ${opportunity.close_date || 'Unknown'}\nNext Step: ${opportunity.next_step || 'None'}\nStatus: ${opportunity.status || 'active'}`;
    }

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

    // Build call goals context
    const goalsContext = (call_goals || transcript.call_goals)
      ? `\n\n## CALL GOALS (set by rep before this call)\n${(call_goals || transcript.call_goals).map((g: string, i: number) => `${i + 1}. ${g}`).join('\n')}\nEvaluate whether each goal was achieved in the transcript.`
      : "";

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
- Use 1-5 scale for ALL category scores. Grade based on OUTCOME and DEAL PROGRESSION, not just technique.
- Score by call type: Discovery calls prioritize question depth + pain identification. Demo calls prioritize solution framing + business case. Negotiation calls prioritize commercial acumen + close control. QBR calls prioritize expansion + relationship deepening.
- A score of 5 = the call achieved its objectives AND moved the deal forward measurably. A 4 = strong execution with minor gaps. A 3 = adequate but missed key opportunities. A 2 = significant methodology gaps. A 1 = call was counterproductive.
- Overall score is 1-5 weighted average.
- Be brutally honest. Generic praise is failure.
- Every score MUST have evidence (exact transcript quotes).
- ALWAYS identify the ONE highest-ROI coaching action.
- Tie all feedback to revenue, risk, or deal progression — never abstract advice.
- When cumulative context is provided, factor in what was ALREADY confirmed in prior calls vs what is NEW.

${resourceContext}
${accountContext}
${opportunityContext}
${cumulativeContext}
${goalsContext}
${customScorecardContext}`;

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

                // Custom scorecard scores (if custom criteria provided)
                custom_scores: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string" },
                      score: { type: "integer", minimum: 1, maximum: 5 },
                      evidence: { type: "string" },
                    },
                    required: ["category", "score", "evidence"],
                    additionalProperties: false,
                  },
                  description: "Scores for custom scorecard criteria, if any were provided",
                },

                // NEW: Outcome-based fields
                call_goals_inferred: {
                  type: "array",
                  items: { type: "string" },
                  description: "What were the likely goals/objectives of this call? Infer 2-5 goals from context and content.",
                },
                goals_achieved: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      goal: { type: "string" },
                      achieved: { type: "boolean" },
                      evidence: { type: "string" },
                    },
                    required: ["goal", "achieved", "evidence"],
                    additionalProperties: false,
                  },
                  description: "For each call goal (inferred or provided), was it achieved?",
                },
                deal_progressed: { type: "boolean", description: "Did this call move the deal forward in a meaningful way?" },
                progression_evidence: { type: "string", description: "Specific evidence of deal progression or lack thereof" },
                likelihood_impact: { type: "string", enum: ["increased", "decreased", "unchanged"], description: "Did this call increase, decrease, or leave unchanged the likelihood of winning?" },
                competitors_mentioned: {
                  type: "array",
                  items: { type: "string" },
                  description: "List of competitor names mentioned in the transcript",
                },
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
                "behavioral_flags", "style_notes", "acumen_notes", "cadence_notes",
                "call_goals_inferred", "goals_achieved", "deal_progressed", "progression_evidence", "likelihood_impact", "competitors_mentioned"
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
        custom_scorecard_results: grade.custom_scores?.length ? grade.custom_scores : null,
        // Outcome-based fields
        call_goals_inferred: grade.call_goals_inferred || [],
        goals_achieved: grade.goals_achieved || [],
        deal_progressed: grade.deal_progressed || false,
        progression_evidence: grade.progression_evidence || null,
        likelihood_impact: grade.likelihood_impact || null,
        competitors_mentioned: grade.competitors_mentioned || [],
      }, { onConflict: "transcript_id" })
      .select()
      .single();

    if (saveErr) {
      console.error("Save error:", saveErr);
      throw new Error("Failed to save grade");
    }

    // Auto-enrich opportunity methodology tracker with MEDDICC/CotM signals
    if (transcript.opportunity_id) {
      try {
        const meddicc = grade.meddicc_signals || {};
        const cotm = grade.cotm_signals || {};

        // Build methodology update — only set fields to true (never revert confirmed items)
        const methodologyUpdate: Record<string, any> = {
          user_id: user.id,
          opportunity_id: transcript.opportunity_id,
        };

        // MEDDICC: confirm + append evidence
        const meddiccFields = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'];
        for (const field of meddiccFields) {
          if (meddicc[field]) {
            methodologyUpdate[`${field}_confirmed`] = true;
            if (meddicc[`${field}_detail`]) {
              methodologyUpdate[`${field}_notes`] = meddicc[`${field}_detail`];
            }
          }
        }

        // CotM: append evidence notes
        if (cotm.before_identified && cotm.before_evidence) {
          methodologyUpdate.before_state_notes = cotm.before_evidence;
        }
        if (cotm.after_defined && cotm.after_evidence) {
          methodologyUpdate.after_state_notes = cotm.after_evidence;
        }
        if (cotm.negative_consequences && cotm.negative_consequences_evidence) {
          methodologyUpdate.negative_consequences_notes = cotm.negative_consequences_evidence;
        }
        if (cotm.pbo_articulated && cotm.pbo_evidence) {
          methodologyUpdate.positive_business_outcomes_notes = cotm.pbo_evidence;
        }
        if (cotm.required_capabilities && cotm.capabilities_evidence) {
          methodologyUpdate.required_capabilities_notes = cotm.capabilities_evidence;
        }
        if (cotm.metrics_captured && cotm.metrics_evidence) {
          methodologyUpdate.metrics_value_notes = cotm.metrics_evidence;
        }

        // Upsert — uses service role to avoid needing existing row
        // First check if row exists
        const { data: existing } = await supabase
          .from("opportunity_methodology")
          .select("id, metrics_notes, economic_buyer_notes, decision_criteria_notes, decision_process_notes, identify_pain_notes, champion_notes, competition_notes, before_state_notes, after_state_notes, negative_consequences_notes, positive_business_outcomes_notes, required_capabilities_notes, metrics_value_notes")
          .eq("opportunity_id", transcript.opportunity_id)
          .maybeSingle();

        if (existing) {
          // Merge notes — append new evidence to existing if not already there
          for (const field of meddiccFields) {
            const notesKey = `${field}_notes`;
            const existingNotes = (existing as any)[notesKey] || '';
            const newNotes = methodologyUpdate[notesKey];
            if (newNotes && existingNotes && !existingNotes.includes(newNotes)) {
              methodologyUpdate[notesKey] = `${existingNotes}\n\n📞 ${transcript.title} (${transcript.call_date}):\n${newNotes}`;
            } else if (newNotes && !existingNotes) {
              methodologyUpdate[notesKey] = `📞 ${transcript.title} (${transcript.call_date}):\n${newNotes}`;
            }
          }
          // Same for CotM notes
          const cotmKeys = ['before_state_notes', 'after_state_notes', 'negative_consequences_notes', 'positive_business_outcomes_notes', 'required_capabilities_notes', 'metrics_value_notes'];
          for (const key of cotmKeys) {
            const existingNotes = (existing as any)[key] || '';
            const newNotes = methodologyUpdate[key];
            if (newNotes && existingNotes && !existingNotes.includes(newNotes)) {
              methodologyUpdate[key] = `${existingNotes}\n\n📞 ${transcript.title} (${transcript.call_date}):\n${newNotes}`;
            } else if (newNotes && !existingNotes) {
              methodologyUpdate[key] = `📞 ${transcript.title} (${transcript.call_date}):\n${newNotes}`;
            }
          }

          await supabase
            .from("opportunity_methodology")
            .update(methodologyUpdate)
            .eq("id", existing.id);
        } else {
          // Create new row with enriched data
          for (const field of meddiccFields) {
            const notesKey = `${field}_notes`;
            if (methodologyUpdate[notesKey]) {
              methodologyUpdate[notesKey] = `📞 ${transcript.title} (${transcript.call_date}):\n${methodologyUpdate[notesKey]}`;
            }
          }
          const cotmKeys = ['before_state_notes', 'after_state_notes', 'negative_consequences_notes', 'positive_business_outcomes_notes', 'required_capabilities_notes', 'metrics_value_notes'];
          for (const key of cotmKeys) {
            if (methodologyUpdate[key]) {
              methodologyUpdate[key] = `📞 ${transcript.title} (${transcript.call_date}):\n${methodologyUpdate[key]}`;
            }
          }
          await supabase
            .from("opportunity_methodology")
            .insert(methodologyUpdate);
        }

        console.log("Methodology tracker enriched for opportunity:", transcript.opportunity_id);
      } catch (enrichErr) {
        console.error("Methodology enrichment failed (non-fatal):", enrichErr);
      }

      // Auto-append structured summary to opportunity notes
      try {
        const goalsSummary = (grade.goals_achieved || [])
          .map((g: any) => `${g.achieved ? '✅' : '❌'} ${g.goal}`)
          .join('\n');
        const noteEntry = `\n\n📞 ${transcript.title} (${transcript.call_date}) — Grade: ${grade.overall_grade}\n${grade.summary}\n${grade.deal_progressed ? '📈 Deal progressed' : '⚠️ No deal progression'} | Likelihood: ${grade.likelihood_impact || 'unchanged'}${goalsSummary ? '\nGoals:\n' + goalsSummary : ''}${(grade.competitors_mentioned || []).length ? '\n🏁 Competitors: ' + grade.competitors_mentioned.join(', ') : ''}`;

        const { data: opp } = await supabase
          .from("opportunities")
          .select("notes")
          .eq("id", transcript.opportunity_id)
          .single();

        await supabase
          .from("opportunities")
          .update({ notes: ((opp?.notes || '') + noteEntry).trim() })
          .eq("id", transcript.opportunity_id);

        console.log("Opportunity notes enriched for:", transcript.opportunity_id);
      } catch (notesErr) {
        console.error("Opportunity notes enrichment failed (non-fatal):", notesErr);
      }
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
