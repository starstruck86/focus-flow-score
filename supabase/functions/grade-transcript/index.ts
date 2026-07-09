import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getModelConfig } from '../_shared/getModelConfig.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const traceId = req.headers.get("x-trace-id") || "no-trace";

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Parse body early so service role requests can pass user_id
    const body = await req.json();
    const { transcript_id, call_goals, user_id: bodyUserId } = body;

    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}` && !!bodyUserId;

    let userId: string;
    let supabase;

    if (isServiceRole) {
      // Server-side batch call — use admin client, trust provided user_id
      supabase = createClient(supabaseUrl, serviceRoleKey);
      userId = bodyUserId;
    } else {
      // Normal client call — validate user JWT
      supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader! } },
      });
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }
    const { primary: model } = await getModelConfig('grade-transcript');
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
            .eq("user_id", userId)
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

    // Fetch top KIs per dimension to ground grading in the actual knowledge library
    const { data: relevantKIs } = await supabase
      .from('knowledge_items')
      .select('tactic_summary, spider_dimension')
      .eq('active', true)
      .in('spider_dimension', ['discovery', 'deal_control', 'competitive', 'stakeholder_navigation', 'expansion_strategy', 'messaging', 'objection_handling'])
      .order('created_at', { ascending: false })
      .limit(24);

    const kiContext = relevantKIs && relevantKIs.length > 0
      ? `\n\n## KNOWLEDGE LIBRARY — ELITE TACTIC BENCHMARKS\nGrade the rep's execution against these specific elite tactics from their training library. A 4-5 score requires evidence of these behaviors:\n${relevantKIs.map((ki: any) => `- [${ki.spider_dimension}] ${ki.tactic_summary}`).join('\n')}\n\nWhen a tactic from this library was clearly missed, call it out specifically in missed_opportunities and replacement_behavior.`
      : '';

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

    const isRolePlay = (transcript.call_type || '').toLowerCase().includes('role play') || (transcript.call_type || '').toLowerCase().includes('mock');

    const rolePlayContext = isRolePlay ? `

## CRITICAL: THIS IS A MOCK / ROLE PLAY — PRESSURE TEST EVALUATION

Call: ${transcript.title}
Participants: ${transcript.participants || 'Unknown'}

This is a standalone practice call simulating a high-stakes enterprise sales scenario. The interviewers are sales leaders deliberately pressure-testing the rep. There is no real deal.

DO NOT require complete MEDDICC or CotM — they are diagnostic lenses only.
DO NOT penalize for lack of deal movement — there is no deal.
DO NOT grade this like a routine call — grade it like what it is: a performance evaluation.

WHAT INTERVIEWERS ARE ACTUALLY EVALUATING:

1. CONTROL — Does the rep own the room? Do they set the agenda and defend it? When the interviewer goes off-script, does the rep redirect or follow?

2. CHALLENGER POSTURE — Does the rep ever push back, reframe, or teach? Elite reps don't just ask questions — they offer perspectives the prospect hadn't considered, challenge assumptions, and take a position. Did the rep ever make the prospect think differently?

3. NARRATIVE ARC — Was there a coherent story from opener to close? Current state → acknowledged problem → quantified gap → why change now → solution need. Or did the call bounce between topics with no through-line?

4. PRESSURE RECOVERY — When the interviewer threw a curveball (timeout, hostile challenge, technical question, panel dynamics), did the rep handle it? Did they stay composed, adapt, and re-establish control?

5. MULTI-STAKEHOLDER NAVIGATION — Did the rep engage each person in the room distinctly based on their role? Different personas care about different things. Did the rep understand that and act on it?

6. SELF-AWARENESS — If the rep gave a post-call self-assessment, how accurate and candid was it? This is a signal of coachability and growth mindset.

CALL TYPE STANDARDS:
- 1st discovery: Elite = uncovers 3+ quantified pain points, maps decision process, locks specific demo with pre-call
- 2nd discovery / multi-stakeholder panel: Elite = deepens prior pain, threads every stakeholder, creates urgency, gets commitment
- Demo included: Elite = demo tied to specific pain, objections handled confidently, firm POC commitment
- Panel format: Elite = controls a multi-person room, demonstrates expertise under pressure, closes confidently

SCORING — BE BRUTALLY HONEST:
- 5 = Elite. Would have won the deal or got the job offer on the spot.
- 4 = Strong. One or two clear gaps, but rep controlled the narrative throughout.
- 3 = Adequate. Skills present but inconsistent. Prospect/interviewer led more than rep.
- 2 = Developing. Significant gaps. Lost control multiple times.
- 1 = Needs urgent work. Directionless.

MANDATORY: Scores must be differentiated across ALL dimensions. Each must have specific transcript evidence. Do not cluster.

COMPUTING overall_score FOR ROLE PLAYS — follow this formula exactly:
Do NOT include meddicc_score or cotm_score in the overall — they measure deal execution, not standalone practice performance.

overall_score (1-5) = weighted average of:
  discovery_score          × 0.20
  challenger_posture_score × 0.20
  narrative_arc_score      × 0.20
  structure_score          × 0.15
  multi_thread_score       × 0.10
  commercial_score         × 0.10
  next_step_score          × 0.05

Round to nearest integer. Then map to overall_grade:
  5 → A or A+ (reserve A+ for flawless execution)
  4 → B+ or A- (strong, 1-2 clear gaps)
  3.5 → B or B- (adequate, rep was mostly reactive)
  3 → C+ or C (developing, significant gaps)
  2.5 or below → C- or D (needs urgent work)

Example: discovery=4, challenger=3, narrative=2, structure=3, multi_thread=3, commercial=3, next_step=3
= (4×0.20)+(3×0.20)+(2×0.20)+(3×0.15)+(3×0.10)+(3×0.10)+(3×0.05)
= 0.80+0.60+0.40+0.45+0.30+0.30+0.15 = 3.0 → C+ or B-

deal_progressed = false
likelihood_impact = "unchanged"` : '';

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

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

## Branch-Specific Expansion Dimensions (score each 1-5)

This rep is a Branch.io expansion AE. In addition to generic frameworks, score Branch execution on every call:

**branch_expansion_hypothesis_score**: Did the AE open or identify a specific expansion hypothesis for this account? Did they articulate which Branch product could be added, to which BU or use case, and why now? Score 5 if they named a specific hypothesis with evidence (e.g., "Your email campaigns aren't deep-linking to the app — Branch Email-to-App would solve that"). Score 1 if no expansion angle was surfaced.

**branch_product_fit_score**: Did the AE correctly identify and explain the right Branch product(s) for this account's situation? Score 5 if they accurately matched Branch capabilities (deep linking, attribution, Email-to-App, SMS-to-App, Universal Ads, QR, AIO) to the account's use case with specifics. Score 1 if they gave generic Branch positioning or mismatched the product.

**branch_value_prop_score**: Did the AE articulate Branch's unique differentiation — specifically the combination of measurement AND deep linking in one SDK, or another core Branch differentiator? Score 5 if they delivered a crisp, specific value prop beyond "we do attribution." Score 1 if it was generic or cliché.

**branch_objection_handling_score**: If any Branch-specific objections arose (build internally, "we already have Adjust/AppsFlyer", vendor consolidation, "we can use Firebase"), did the AE handle them correctly? Score 5 if they acknowledged the objection, quantified the build/switch cost, and pivoted to Branch's specific advantage. Score 1 if they folded or gave a generic response. Score 3 if no Branch-specific objection arose.

Also produce a **branch_coaching_note**: 1-2 sentences specifically about Branch execution on this call — what was right or wrong about how Branch was positioned.

${resourceContext}
${accountContext}
${opportunityContext}
${cumulativeContext}
${goalsContext}
${customScorecardContext}
${rolePlayContext}
${kiContext}`;


    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          { role: "user", content: `Analyze this call transcript with full framework enforcement.\n\nTitle: ${transcript.title}\nType: ${transcript.call_type || 'Unknown'}\nParticipants: ${transcript.participants || 'Unknown'}\n\nTranscript:\n${transcript.content}` },
        ],
        tools: [{
          name: "score_transcript",
          description: "Submit comprehensive framework-based scoring for a sales call transcript",
          input_schema: {
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

                // ROLE PLAY SPECIFIC DIMENSIONS — populated only for call_type Role Play / Mock
                challenger_posture_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Did the rep push back, reframe, or take control when the prospect went off script or offered an easy out? 5 = confidently challenged assumptions, reframed the conversation, taught the prospect something. 1 = followed wherever the prospect led, never pushed back."
                },
                challenger_posture_evidence: {
                  type: "string",
                  description: "Exact transcript quote or specific moment that justifies this score."
                },
                narrative_arc_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Was there a coherent story arc? Current state → problem → gap → why change now → solution need. 5 = the narrative built logically and compellingly from first question to close. 1 = disjointed, jumped between topics, no through-line."
                },
                narrative_arc_evidence: {
                  type: "string",
                  description: "Exact transcript quote or specific moment that justifies this score."
                },
                pressure_recovery_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "When the conversation went sideways — timeout, hostile question, unexpected objection, hallucination challenge, panel format pressure — how did the rep handle it? 5 = adapted immediately, stayed composed, redirected skillfully. 1 = visibly lost control, never recovered."
                },
                pressure_recovery_evidence: {
                  type: "string",
                  description: "Exact transcript quote or specific moment that justifies this score."
                },
                multi_thread_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Did the rep engage each stakeholder differently based on their role and what they care about? 5 = directed distinct questions to each person, named them, understood their perspective, bridged between personas. 1 = talked to the room generically, ignored one or more attendees."
                },
                multi_thread_evidence: {
                  type: "string",
                  description: "Exact transcript quote or specific moment that justifies this score."
                },
                self_awareness_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Based on the rep's post-call self-assessment (if present in transcript): accuracy of self-diagnosis, growth mindset, candor about gaps. 5 = precisely identified strengths and gaps, showed genuine coachability. 1 = deflected, defensive, or had no self-awareness. Score 3 if no self-assessment present."
                },
                self_awareness_evidence: {
                  type: "string",
                  description: "Exact transcript quote from self-assessment that justifies this score."
                },
                product_knowledge_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Did the rep demonstrate accurate, specific knowledge of what the product does and how the market works? 5 = correct technical terms, accurate product mechanics, credible market context, avoided overclaiming. 3 = generally accurate but vague. 1 = generic, technically incorrect, couldn't explain how the product works. Score 3 for calls where product knowledge wasn't explicitly tested."
                },

                // Branch-specific expansion dimensions
                branch_expansion_hypothesis_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Did the AE open or identify a specific Branch expansion hypothesis (which product, which BU, why now)? 5 = named specific hypothesis with evidence. 1 = no expansion angle surfaced.",
                },
                branch_product_fit_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Did the AE correctly identify and explain the right Branch product(s) (deep linking, attribution, Email-to-App, SMS-to-App, Universal Ads, QR, AIO) for this account's situation? 5 = accurate match with specifics. 1 = generic positioning or mismatch.",
                },
                branch_value_prop_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Did the AE articulate Branch's unique differentiation — measurement + deep linking in one SDK, or another core differentiator? 5 = crisp specific value prop. 1 = generic or cliché.",
                },
                branch_objection_handling_score: {
                  type: "integer", minimum: 1, maximum: 5,
                  description: "Did the AE handle Branch-specific objections (build internally, Adjust/AppsFlyer, vendor consolidation, Firebase) correctly? 5 = acknowledged, quantified, pivoted to Branch advantage. 1 = folded or generic. Score 3 if no Branch-specific objection arose.",
                },
                branch_coaching_note: {
                  type: "string",
                  description: "1-2 sentences specifically about Branch execution on this call — what was right or wrong about how Branch was positioned.",
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

                // Next step extraction
                extracted_next_step: {
                  type: "string",
                  description: "Concise actionable next step extracted from the call (e.g. 'Send pricing proposal by Friday'). Look for phrases like 'next step is...', 'I'll follow up...', 'we'll send...', 'circle back...', 'decision by...'. Return empty string if none found.",
                },
                extracted_next_step_date: {
                  type: "string",
                  description: "ISO date (YYYY-MM-DD) for when the next step should happen, parsed from expressions like specific dates, weekdays, 'next week', 'end of month'. Return empty string if unclear or not mentioned.",
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
                "call_goals_inferred", "goals_achieved", "deal_progressed", "progression_evidence", "likelihood_impact", "competitors_mentioned",
                "extracted_next_step", "extracted_next_step_date",
                "challenger_posture_score", "challenger_posture_evidence",
                "narrative_arc_score", "narrative_arc_evidence",
                "pressure_recovery_score", "pressure_recovery_evidence",
                "multi_thread_score", "multi_thread_evidence",
                "self_awareness_score", "self_awareness_evidence",
                "product_knowledge_score",
                "branch_expansion_hypothesis_score", "branch_product_fit_score",
                "branch_value_prop_score", "branch_objection_handling_score",
                "branch_coaching_note"

              ],
              additionalProperties: false,
            },
        }],
        tool_choice: { type: "tool", name: "score_transcript" },
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
    const toolCall = aiResult.content?.find((b: any) => b.type === "tool_use");
    if (!toolCall) throw new Error("No grading response from AI");

    const grade = toolCall.input;

    // Transform strengths array to simple strings for backward compat
    const strengthStrings = (grade.strengths || []).map((s: any) => typeof s === 'string' ? s : s.point);
    const improvementStrings = (grade.missed_opportunities || []).map((m: any) => typeof m === 'string' ? m : m.opportunity);

    const { data: saved, error: saveErr } = await supabase
      .from("transcript_grades")
      .upsert({
        user_id: userId,
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
        product_knowledge_score: grade.product_knowledge_score ?? null,
        branch_expansion_hypothesis_score: grade.branch_expansion_hypothesis_score ?? null,
        branch_product_fit_score: grade.branch_product_fit_score ?? null,
        branch_value_prop_score: grade.branch_value_prop_score ?? null,
        branch_objection_handling_score: grade.branch_objection_handling_score ?? null,
        branch_coaching_note: grade.branch_coaching_note ?? null,
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
        custom_scorecard_results: (() => {
          if (isRolePlay) {
            // For role plays, store the 5 key dimensions with real evidence from the AI
            return [
              { category: 'Challenger Posture', score: grade.challenger_posture_score, evidence: grade.challenger_posture_evidence || '' },
              { category: 'Narrative Arc', score: grade.narrative_arc_score, evidence: grade.narrative_arc_evidence || '' },
              { category: 'Pressure Recovery', score: grade.pressure_recovery_score, evidence: grade.pressure_recovery_evidence || '' },
              { category: 'Multi-Stakeholder Navigation', score: grade.multi_thread_score, evidence: grade.multi_thread_evidence || '' },
              { category: 'Self-Awareness', score: grade.self_awareness_score, evidence: grade.self_awareness_evidence || '' },
            ].filter(s => s.score != null);
          }
          return grade.custom_scores?.length ? grade.custom_scores : null;
        })(),
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
          user_id: userId,
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

      // Auto-fill next step fields if empty on the opportunity
      try {
        const extractedStep = grade.extracted_next_step?.trim();
        const extractedDate = grade.extracted_next_step_date?.trim();

        if (extractedStep || extractedDate) {
          const { data: opp2 } = await supabase
            .from("opportunities")
            .select("next_step, next_step_date")
            .eq("id", transcript.opportunity_id)
            .single();

          const updates: Record<string, any> = {};
          if (extractedStep && !opp2?.next_step) {
            updates.next_step = extractedStep;
          }
          if (extractedDate && !opp2?.next_step_date) {
            updates.next_step_date = extractedDate;
          }

          if (Object.keys(updates).length > 0) {
            await supabase
              .from("opportunities")
              .update(updates)
              .eq("id", transcript.opportunity_id);
            console.log("Auto-filled next step for opportunity:", transcript.opportunity_id, updates);
          }
        }
      } catch (nextStepErr) {
        console.error("Next step auto-fill failed (non-fatal):", nextStepErr);
      }

    // Recompute spider dimension scores from all transcript grades and write to dimension_scores
    // Role plays use dedicated dimensions; real calls use standard framework scores
    try {
      const { data: allGrades } = await supabase
        .from('transcript_grades')
        .select('discovery_score, cotm_score, meddicc_score, presence_score, commercial_score, next_step_score, structure_score, product_knowledge_score, call_type, custom_scorecard_results')
        .eq('user_id', userId);

      if (allGrades && allGrades.length > 0) {
        const avg100 = (scores: (number | null)[]) => {
          const valid = scores.filter((s): s is number => s != null && s > 0);
          if (!valid.length) return 0;
          return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 20);
        };

        // For each grade, compute its contribution to each spider dimension
        const discoveryScores: number[] = [];
        const dealControlScores: number[] = [];
        const stakeholderScores: number[] = [];
        const expansionScores: number[] = [];
        const competitiveScores: number[] = [];

        for (const g of allGrades as any[]) {
          const isRP = (g.call_type || '').toLowerCase().includes('role play') || (g.call_type || '').toLowerCase().includes('mock');
          const custom = g.custom_scorecard_results || [];
          const getCustom = (cat: string) => custom.find((c: any) => c.category === cat)?.score || null;

          if (isRP) {
            // Role plays: use dedicated role-play-specific scores for competitive and expansion dimensions
            const challenger = getCustom('Challenger Posture');
            const narrative = getCustom('Narrative Arc');
            const pressure = getCustom('Pressure Recovery');
            const multithread = getCustom('Multi-Stakeholder Navigation');

            discoveryScores.push(g.discovery_score);
            dealControlScores.push(g.structure_score, g.next_step_score, pressure || g.commercial_score);
            stakeholderScores.push(g.presence_score, multithread || g.presence_score);
            expansionScores.push(narrative || g.cotm_score);
            competitiveScores.push(challenger || g.meddicc_score);
          } else {
            // Real calls: use standard framework scores
            discoveryScores.push(g.discovery_score);
            dealControlScores.push(g.structure_score, g.next_step_score, g.commercial_score);
            stakeholderScores.push(g.presence_score);
            expansionScores.push(g.cotm_score);
            competitiveScores.push(g.meddicc_score);
          }
        }

        const dimensionMap = [
          { dimension: 'discovery', scores: discoveryScores },
          { dimension: 'deal_control', scores: dealControlScores },
          { dimension: 'stakeholder_navigation', scores: stakeholderScores },
          { dimension: 'expansion_strategy', scores: expansionScores },
          { dimension: 'competitive', scores: competitiveScores },
          { dimension: 'product_knowledge', scores: allGrades.map((g: any) => g.product_knowledge_score).filter(Boolean) },
        ];

        for (const { dimension, scores } of dimensionMap) {
          const avgScore = avg100(scores);
          if (avgScore === 0) continue;
          const { data: existing } = await supabase
            .from('dimension_scores')
            .select('id')
            .eq('user_id', userId)
            .eq('spider_dimension', dimension)
            .maybeSingle();
          if (existing) {
            await supabase.from('dimension_scores').update({ avg_score_100: avgScore }).eq('id', existing.id);
          } else {
            await supabase.from('dimension_scores').insert({ user_id: userId, spider_dimension: dimension, avg_score_100: avgScore });
          }
        }
        console.log(`[grade-transcript] Spider dimensions recomputed from ${allGrades.length} grades`);
      }
    } catch (spiderErr) {
      console.error('[grade-transcript] Spider dimension recompute failed (non-fatal):', spiderErr);
    }

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(`[grade-transcript] [${traceId}] error:`, e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", traceId }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
