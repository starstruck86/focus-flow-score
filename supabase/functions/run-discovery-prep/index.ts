import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

/**
 * Discovery Prep template — exact section structure from the Iterable Mid-Market Prep Doc.
 * This is the locked backbone (Output A). Sections, order, and formatting NEVER change.
 */
const TEMPLATE_SECTIONS = [
  {
    id: "cover",
    name: "Prep Doc — Cover",
    type: "key_value_table",
    fields: [
      { key: "Rep Name", source: "input" },
      { key: "Opportunity Name & SFDC Link", source: "input" },
      { key: "Sales Stage", source: "input" },
      { key: "Platform scale opp.", source: "input_or_research", hint: "Monthly active users? Known volumes per channel?" },
    ],
  },
  {
    id: "participants",
    name: "Participants",
    type: "participants_table",
    columns_internal: ["Name", "Role"],
    columns_prospect: ["Name, Title", "Role (EB, Champion, Coach)"],
  },
  {
    id: "cx_audit",
    name: "Have You Run a CX Audit?",
    type: "checklist",
    items: ["Yes: paste your link here", "No: consider building one using this template"],
  },
  {
    id: "value_selling",
    name: "Value Selling Observations Framework",
    type: "observation_table",
    rows: [
      { key: "How do they make money?" },
      { key: "Who do they compete with?" },
      { key: "What is your pain hypothesis? (based on your research / CX Audit findings and what you observed to be broken in the customer journey)" },
      { key: "What do you think their C-Suite initiative and Business Objectives are?" },
      { key: "What are they doing in their Current State that you found in your research? (channels, technology, etc.)" },
      { key: "What pressures are their industry facing?" },
      { key: "What do you think the biggest Problems and Pain points are for the marketing team in creating a better customer journey? How do those end-user level Problems/Pains translate to C-Suite/Business Pains?" },
      { key: "What do you think an Ideal State would look like for this team that would be an improvement for the customer journey you experienced?" },
      { key: "Based on the pains and observations above, what do you think would drive the most Value for them? What do you suppose their Value Driver is?" },
      { key: "Write a 3-5 sentence POV" },
    ],
  },
  {
    id: "discovery_questions",
    name: "Discovery-1 Questions",
    type: "numbered_list",
    count: 6,
    footer: {
      label: "Value Creation Discovery Flow",
      steps: ["CURRENT STATE", "PROBLEM", "IMPACT", "IDEAL SOLUTION", "BUSINESS BENEFIT"],
    },
  },
  {
    id: "customer_examples",
    name: "What are 2-3 customer examples you can share?",
    type: "examples_table",
    columns: ["Customer name", "Links to case studies/testimonials", "How is this relevant?"],
    rows: 3,
  },
  {
    id: "pivot_statements",
    name: "Pivot Statements",
    type: "pivot_table",
    description: "Insert pivot statement if you are not getting relevant business/personal goals using a customer story that you believe will resonate most with them based on your discovery prep.",
    columns: ["Pain statement", "FOMO Statement"],
  },
  {
    id: "objection_handling",
    name: "Objection Handling",
    type: "objections_table",
    description: "Have you prepared an objection handle for objections you know will come up? Have you prepared an objection for when a prospect pushes you to 'just show them the product?' and you need to give them a OOTB Disco/Demo Call instead?",
    columns: ["Anticipated Objections", "Responses"],
    rows: 3,
  },
  {
    id: "marketing_team",
    name: "Who are the other members of the marketing team?",
    type: "contact_list",
    format: "Name & Title (linked to LinkedIn profile)",
  },
  {
    id: "exit_criteria",
    name: "Exit Criteria, MEDDPICC, Deal Inspection",
    type: "meddpicc_checklist",
    description: "Go through this checklist using the Salesforce Opportunity view for the deal.",
    items: [
      "What is the business level pain and impact of that pain?",
      "What is the C-Suite Initiative we are tying this pain to?",
      "Who is the exec sponsor that would fund this? What do they care about?",
      "Do we have connections at Investor Level or C-Level?",
      "Are there ex-customers within the account?",
      "How do we differentiate from the competition? Why are we best suited to solve their business pain?",
      "What Tech and/or Agency partners are/could be involved in the deal?",
      "Have you attached an Org Chart?",
      "Fill in gaps to MEDDPICC on your opportunity",
    ],
  },
];

const PLAYBOOK_SCOPES = [
  "discovery", "hypothesis", "deal_progression", "executive_framing", "meddpicc",
  "objection_handling", "value_selling", "competitive",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("authorization");
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

    const body = await req.json();
    const { action } = body;

    // ── ACTION: apply_redline ──
    if (action === "apply_redline") {
      const { run_id, section_id, proposed_text } = body;
      if (!run_id || !section_id || !proposed_text) {
        return new Response(JSON.stringify({ error: "run_id, section_id, proposed_text required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: run, error: fetchErr } = await supabase
        .from("task_runs")
        .select("*")
        .eq("id", run_id)
        .eq("user_id", user.id)
        .single();

      if (fetchErr || !run) {
        return new Response(JSON.stringify({ error: "Run not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const draft = run.draft_output as any;
      if (draft?.sections) {
        const sectionIdx = draft.sections.findIndex((s: any) => s.id === section_id);
        if (sectionIdx >= 0) {
          draft.sections[sectionIdx].content = proposed_text;
        }
      }

      const review = run.review_output as any;
      if (review?.redlines) {
        review.redlines = review.redlines.map((r: any) =>
          r.section_id === section_id ? { ...r, status: "accepted" } : r
        );
      }

      const { error: updateErr } = await supabase
        .from("task_runs")
        .update({ draft_output: draft, review_output: review, updated_at: new Date().toISOString() })
        .eq("id", run_id);

      if (updateErr) throw updateErr;

      return new Response(JSON.stringify({ success: true, draft_output: draft, review_output: review }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: generate (default) ──
    const { inputs } = body;
    if (!inputs?.company_name) {
      return new Response(JSON.stringify({ error: "company_name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch playbooks for review engine
    let playbookContext = "";
    try {
      const { data: playbooks } = await supabase
        .from("playbooks")
        .select("title, key_actions, anti_patterns, when_to_use, chapter, confidence_score")
        .order("confidence_score", { ascending: false })
        .limit(20);

      if (playbooks?.length) {
        const relevant = (playbooks as any[]).filter((p: any) => {
          const title = (p.title || "").toLowerCase();
          const chapter = (p.chapter || "").toLowerCase();
          return PLAYBOOK_SCOPES.some(scope =>
            title.includes(scope) || chapter.includes(scope)
          );
        }).slice(0, 8);

        if (relevant.length) {
          playbookContext = relevant.map((p: any) =>
            `### ${p.title}\nKey Actions: ${(p.key_actions || []).join("; ")}\nAnti-Patterns: ${(p.anti_patterns || []).join("; ")}\nWhen to Use: ${p.when_to_use || "N/A"}`
          ).join("\n\n");
        }
      }
    } catch (e) {
      console.log("Playbook fetch skipped:", e);
    }

    // ── STEP A: Generate Draft ──
    const participantsText = (inputs.participants || [])
      .map((p: any) => `${p.name}${p.title ? ` (${p.title})` : ""}${p.role ? ` — ${p.role}` : ""}`)
      .join(", ");

    const draftPrompt = `You are filling out a Mid-Market Discovery Prep Doc for a sales meeting. Generate content for EACH section below. Follow these rules EXACTLY:

RULES:
- Use ONLY the inputs provided and publicly verifiable company research
- If information is unknown, write "Unknown — add as discovery question" 
- No assumptions, no hallucinations
- Keep content concise: bullet points and short phrases, NOT paragraphs
- Each observation row gets 2-4 bullet points max
- Discovery questions must be specific to this company/meeting
- POV must be exactly 3-5 sentences

INPUTS:
Company: ${inputs.company_name}
Participants: ${participantsText || "Unknown"}
Opportunity: ${inputs.opportunity || "Unknown"}
Sales Stage: ${inputs.stage || "Unknown"}
Prior Notes: ${inputs.prior_notes || "None"}
Known Scale: ${inputs.scale || "Unknown"}
Desired Next Step: ${inputs.desired_next_step || "Unknown"}

SECTIONS TO FILL (return as JSON with this exact structure):
{
  "sections": [
    {
      "id": "cover",
      "content": {
        "rep_name": "${inputs.rep_name || "Unknown"}",
        "opportunity": "${inputs.opportunity || "Unknown"}",
        "stage": "${inputs.stage || "Unknown"}",
        "platform_scale": "<research-based or input>"
      }
    },
    {
      "id": "participants",
      "content": {
        "internal": [{"name": "...", "role": "..."}],
        "prospect": [{"name": "...", "title": "...", "role": "EB/Champion/Coach/Unknown"}]
      }
    },
    {
      "id": "cx_audit",
      "content": { "completed": false, "notes": "" }
    },
    {
      "id": "value_selling",
      "content": {
        "money": "...",
        "compete": "...",
        "pain_hypothesis": "...",
        "csuite_initiative": "...",
        "current_state": "...",
        "industry_pressures": "...",
        "problems_and_pain": "...",
        "ideal_state": "...",
        "value_driver": "...",
        "pov": "..."
      }
    },
    {
      "id": "discovery_questions",
      "content": {
        "questions": ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
        "value_flow": {
          "current_state": "...",
          "problem": "...",
          "impact": "...",
          "ideal_solution": "...",
          "business_benefit": "..."
        }
      }
    },
    {
      "id": "customer_examples",
      "content": [
        {"customer": "...", "link": "...", "relevance": "..."},
        {"customer": "...", "link": "...", "relevance": "..."},
        {"customer": "...", "link": "...", "relevance": "..."}
      ]
    },
    {
      "id": "pivot_statements",
      "content": {
        "pain_statement": "...",
        "fomo_statement": "..."
      }
    },
    {
      "id": "objection_handling",
      "content": [
        {"objection": "...", "response": "..."},
        {"objection": "...", "response": "..."},
        {"objection": "...", "response": "..."}
      ]
    },
    {
      "id": "marketing_team",
      "content": [{"name": "...", "title": "...", "linkedin": ""}]
    },
    {
      "id": "exit_criteria",
      "content": {
        "known": ["items already known"],
        "gaps": ["questions still needed"],
        "meddpicc_gaps": ["specific MEDDPICC fields to fill"]
      }
    }
  ]
}

Return ONLY valid JSON. No markdown fences.`;

    const draftResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a senior sales prep assistant. You produce structured, meeting-ready discovery prep documents. Be specific and evidence-based. Never hallucinate." },
          { role: "user", content: draftPrompt },
        ],
        temperature: 0.3,
        max_tokens: 6000,
      }),
    });

    if (!draftResp.ok) {
      const errText = await draftResp.text();
      console.error("Draft generation error:", draftResp.status, errText);
      if (draftResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (draftResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Draft generation failed: ${draftResp.status}`);
    }

    const draftData = await draftResp.json();
    let draftContent = draftData.choices?.[0]?.message?.content || "";
    // Strip markdown fences if present
    draftContent = draftContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let draftOutput: any;
    try {
      draftOutput = JSON.parse(draftContent);
    } catch {
      console.error("Failed to parse draft JSON:", draftContent.slice(0, 500));
      draftOutput = { sections: [], raw: draftContent };
    }

    // ── STEP B: Generate Review ──
    let reviewOutput: any = { strengths: [], redlines: [] };

    if (draftOutput.sections?.length) {
      const reviewPrompt = `You are a VP of Sales reviewing a discovery prep document. Evaluate it using these playbook principles:

${playbookContext || "Use standard discovery, MEDDPICC, value selling, and executive framing best practices."}

THE PREP DOCUMENT:
${JSON.stringify(draftOutput.sections, null, 2)}

COMPANY: ${inputs.company_name}
STAGE: ${inputs.stage || "Unknown"}

Produce a review with:
1. "strengths" — max 2-3 items that are genuinely strong and meeting-ready
2. "redlines" — max 3-5 specific proposed edits, each with:
   - "section_id": which section to improve
   - "section_name": human-readable section name  
   - "current_text": what's there now (quote it)
   - "proposed_text": your improved version
   - "rationale": why this change matters (grounded in playbook principles)

Return ONLY valid JSON:
{
  "strengths": ["...", "..."],
  "redlines": [
    {
      "id": "r1",
      "section_id": "value_selling",
      "section_name": "Value Selling Observations",
      "current_text": "...",
      "proposed_text": "...",
      "rationale": "..."
    }
  ]
}

No markdown fences.`;

      try {
        const reviewResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in methodology. No generic feedback." },
              { role: "user", content: reviewPrompt },
            ],
            temperature: 0.4,
            max_tokens: 3000,
          }),
        });

        if (reviewResp.ok) {
          const reviewData = await reviewResp.json();
          let reviewContent = reviewData.choices?.[0]?.message?.content || "";
          reviewContent = reviewContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          try {
            reviewOutput = JSON.parse(reviewContent);
          } catch {
            console.error("Failed to parse review JSON:", reviewContent.slice(0, 500));
          }
        }
      } catch (e) {
        console.error("Review generation error:", e);
      }
    }

    // ── Store run ──
    const { data: run, error: insertErr } = await supabase
      .from("task_runs")
      .insert({
        user_id: user.id,
        task_type: "discovery_prep",
        inputs,
        draft_output: draftOutput,
        review_output: reviewOutput,
        status: "completed",
        thread_id: inputs.thread_id || null,
        account_id: inputs.account_id || null,
        opportunity_id: inputs.opportunity_id || null,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      throw insertErr;
    }

    return new Response(JSON.stringify({
      run_id: run.id,
      draft: draftOutput,
      review: reviewOutput,
      template: TEMPLATE_SECTIONS,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("run-discovery-prep error:", error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
