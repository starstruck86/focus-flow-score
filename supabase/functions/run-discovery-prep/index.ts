import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// ── Firecrawl research helpers ──

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

async function searchWeb(query: string, apiKey: string, limit = 5): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(`${FIRECRAWL_API}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, scrapeOptions: { formats: ["markdown"] } }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return "";
    const data = await resp.json();
    return (data.data || [])
      .map((r: any) => `## ${r.title || "Untitled"}\n${(r.markdown || r.description || "").slice(0, 2500)}`)
      .join("\n\n---\n\n")
      .slice(0, 8000);
  } catch (e) {
    console.error("Firecrawl search error:", e);
    return "";
  }
}

async function scrapeUrl(url: string, apiKey: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(`${FIRECRAWL_API}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return "";
    const data = await resp.json();
    return (data.data?.markdown || "").slice(0, 10000);
  } catch (e) {
    console.error("Firecrawl scrape error:", e);
    return "";
  }
}

async function gatherResearch(companyName: string, website?: string) {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    console.log("No FIRECRAWL_API_KEY, skipping web research");
    return { website: "", business: "", casestudies: "", techstack: "", subscription: "" };
  }

  console.log(`Starting Firecrawl research for ${companyName}...`);

  const [websiteContent, business, casestudies, techstack, subscription] = await Promise.all([
    website ? scrapeUrl(website, apiKey) : searchWeb(`${companyName} official website about`, apiKey, 3),
    searchWeb(`${companyName} business model revenue products annual report investors`, apiKey),
    searchWeb(`${companyName} case study marketing lifecycle email personalization`, apiKey),
    searchWeb(`${companyName} marketing technology stack platform ESP CDP analytics`, apiKey),
    searchWeb(`${companyName} subscription subscribe save auto replenish ecommerce`, apiKey, 3),
  ]);

  console.log(`Research complete: website=${websiteContent.length}ch, business=${business.length}ch, cases=${casestudies.length}ch, tech=${techstack.length}ch, sub=${subscription.length}ch`);

  return { website: websiteContent, business, casestudies, techstack, subscription };
}

// ── AI helper ──

async function callAI(
  messages: { role: string; content: string }[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model || "google/gemini-2.5-pro",
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 12000,
    }),
  });

  if (!resp.ok) {
    const status = resp.status;
    const text = await resp.text();
    console.error(`AI error ${status}:`, text);
    if (status === 429) throw { status: 429, message: "Rate limited — please try again in a moment." };
    if (status === 402) throw { status: 402, message: "AI credits exhausted." };
    throw new Error(`AI generation failed: ${status}`);
  }

  const data = await resp.json();
  let content = data.choices?.[0]?.message?.content || "";
  return content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

// ── Prompts ──

const SYSTEM_PROMPT = `You are a senior sales strategist embedded in a sales execution system. You produce comprehensive, meeting-ready Discovery Prep documents.

METHODOLOGY:
1. Research the company using ALL provided context (web research, inputs, prior notes)
2. Synthesize findings into actionable sales intelligence
3. Build a working hypothesis connecting business pain → executive initiative → solution value
4. Fill every section with specific, evidence-based content
5. Convert every unknown into a precise discovery question

RULES — NON-NEGOTIABLE:
- Use ONLY the provided inputs and research context. No hallucinated facts.
- If information is unverifiable: label it "Unknown" and generate an exact discovery question
- No generic filler. Every bullet must be specific to THIS company.
- Max 3 bullets per card/cell. Overflow belongs in the appendix.
- Every metric needs date + source, or labeled "Unknown"
- POV must be exactly 3-5 sentences, specific and grounded
- Discovery questions must sound prepared, not generic
- All content must be scannable: bullets, tables, cards. NO long paragraphs.

SUBSCRIPTION CHECK — MANDATORY:
- Look for subscribe & save, auto-delivery, replenishment, subscription programs
- Check for vendors: Ordergroove, Recharge, Skio, Shopify Subscriptions
- If found: capture model type, discount structure, frequency options, cancel controls
- Surface in cockpit, loyalty analysis, tech stack, and appendix

LIFECYCLE CASE STUDIES — MANDATORY:
- Search for public proof points from vendor case study libraries
- Extract: program/use case, result + timeframe, maturity implication
- Surface top 1-2 in cockpit, full list in appendix

ROI PROTOCOL:
- Use defensible logic: Incremental Orders × AOV × Margin% − variable costs − discount leakage
- Include sensitivity model: +5-10% AOV, +5% frequency, -3% churn
- Use M.A.T.H.: Metric, Actual, Target, Holding back`;

function buildDraftPrompt(inputs: any, research: any): string {
  const participantsText = (inputs.participants || [])
    .map((p: any) => `- ${p.name}${p.title ? ` (${p.title})` : ""}${p.role ? ` — ${p.role}` : ""} [${p.side || "prospect"}]`)
    .join("\n");

  const researchBlock = [
    research.website && `=== COMPANY WEBSITE ===\n${research.website}`,
    research.business && `=== BUSINESS INTELLIGENCE ===\n${research.business}`,
    research.casestudies && `=== CASE STUDIES & PROOF POINTS ===\n${research.casestudies}`,
    research.techstack && `=== TECHNOLOGY STACK EVIDENCE ===\n${research.techstack}`,
    research.subscription && `=== SUBSCRIPTION / AUTO-REPLENISH SIGNALS ===\n${research.subscription}`,
  ].filter(Boolean).join("\n\n");

  return `Generate a complete Discovery Prep document for:

COMPANY: ${inputs.company_name}
REP: ${inputs.rep_name || "Unknown"}
OPPORTUNITY: ${inputs.opportunity || "Unknown"}
STAGE: ${inputs.stage || "Unknown"}
PLATFORM SCALE: ${inputs.scale || "Unknown"}
DESIRED NEXT STEP: ${inputs.desired_next_step || "Unknown"}
PRIOR NOTES: ${inputs.prior_notes || "None"}

MEETING PARTICIPANTS:
${participantsText || "Unknown"}

${researchBlock ? `\n--- WEB RESEARCH CONTEXT ---\n${researchBlock}\n--- END RESEARCH ---\n` : "No web research available. Use your knowledge of this company."}

Return a JSON object with this EXACT structure. Fill EVERY field with specific, researched content:

{
  "sections": [
    {
      "id": "cockpit",
      "name": "Page-1 Cockpit",
      "content": {
        "cards": [
          { "label": "Objective & Next Step", "value": "specific objective + desired next step" },
          { "label": "Working Hypothesis & Why Now", "value": "hypothesis connecting pain to initiative + timing trigger" },
          { "label": "Must-Confirm", "bullets": ["3 critical items to validate in this meeting"] },
          { "label": "Deal Risks & Call Control", "bullets": ["2-3 risks + mitigation strategies"] },
          { "label": "Subscription Model", "value": "Yes/No + key mechanics if found" },
          { "label": "Lifecycle Proof Points", "bullets": ["top 1-2 public case studies relevant to this company"] }
        ]
      }
    },
    {
      "id": "cover",
      "name": "Prep Doc — Cover",
      "content": {
        "rep_name": "${inputs.rep_name || "Unknown"}",
        "opportunity": "${inputs.opportunity || "Unknown"}",
        "stage": "${inputs.stage || "Unknown"}",
        "platform_scale": "researched or input value"
      }
    },
    {
      "id": "participants",
      "name": "Participants",
      "content": {
        "internal": [{"name": "...", "role": "..."}],
        "prospect": [{"name": "...", "title": "...", "role": "EB/Champion/Coach/Unknown"}]
      }
    },
    {
      "id": "cx_audit",
      "name": "CX Audit Check",
      "content": { "completed": false, "notes": "Brief CX audit observations from research" }
    },
    {
      "id": "executive_snapshot",
      "name": "Executive Snapshot",
      "content": {
        "company_overview": "2-3 sentence company summary",
        "why_now": "Why this company, why now — timing triggers and catalysts",
        "key_metrics": [
          { "metric": "Revenue", "value": "...", "source": "..." },
          { "metric": "Employees", "value": "...", "source": "..." },
          { "metric": "Industry", "value": "...", "source": "..." }
        ],
        "exec_priorities": ["stated executive priorities from research"]
      }
    },
    {
      "id": "value_selling",
      "name": "Value Selling Observations Framework",
      "content": {
        "money": "How they make money — specific revenue model, channels, products",
        "compete": "Direct competitors and substitutes",
        "pain_hypothesis": "Pain hypothesis based on research/CX audit observations",
        "csuite_initiative": "C-Suite initiatives and business objectives",
        "current_state": "Current state: channels, technology, programs found in research",
        "industry_pressures": "Industry pressures and market dynamics",
        "problems_and_pain": "Marketing team problems → how they translate to C-Suite/Business pains",
        "ideal_state": "What ideal state would look like for this team",
        "value_driver": "Primary value driver based on pains and observations",
        "pov": "3-5 sentence POV — specific, grounded, compelling"
      }
    },
    {
      "id": "discovery_questions",
      "name": "Discovery-1 Questions",
      "content": {
        "questions": ["6 specific, prepared discovery questions for this company"],
        "value_flow": {
          "current_state": "Their current situation",
          "problem": "The problem to define",
          "impact": "Business impact of the problem",
          "ideal_solution": "What ideal looks like",
          "business_benefit": "Quantified business benefit"
        }
      }
    },
    {
      "id": "customer_examples",
      "name": "Customer Examples",
      "content": [
        { "customer": "Relevant customer name", "link": "case study URL if known", "relevance": "Why this is relevant to prospect" }
      ]
    },
    {
      "id": "pivot_statements",
      "name": "Pivot Statements",
      "content": {
        "pain_statement": "Many of our customers came to us because they faced [SPECIFIC PAIN]. In helping [BRAND], with [PAIN], they found [RESULT] — how does that resonate with you?",
        "fomo_statement": "[CUSTOMER] uses Iterable to [SPECIFIC USE CASE]. What would something like that mean for you and your business?"
      }
    },
    {
      "id": "objection_handling",
      "name": "Objection Handling",
      "content": [
        { "objection": "Anticipated objection specific to this deal", "response": "Prepared response" }
      ]
    },
    {
      "id": "marketing_team",
      "name": "Marketing Team Members",
      "content": [{ "name": "Name", "title": "Title", "linkedin": "URL if found" }]
    },
    {
      "id": "exit_criteria",
      "name": "Exit Criteria & MEDDPICC",
      "content": {
        "known": ["What we already know about MEDDPICC elements"],
        "gaps": ["Questions we still need answered"],
        "meddpicc_gaps": ["Specific MEDDPICC fields to fill: Metrics, Economic Buyer, Decision Criteria, Decision Process, Paper Process, Identify Pain, Champion, Competition"]
      }
    },
    {
      "id": "revenue_pathway",
      "name": "Revenue Pathway & Sensitivity",
      "content": {
        "model": [
          { "driver": "Revenue driver", "current": "Current state estimate", "potential": "Potential with solution", "assumptions": "Key assumptions" }
        ],
        "sensitivity": [
          { "scenario": "+5-10% AOV lift", "impact": "Revenue impact estimate", "question": "Discovery question to validate" },
          { "scenario": "+5% purchase frequency", "impact": "Impact estimate", "question": "Validation question" },
          { "scenario": "-3% churn reduction", "impact": "Impact estimate", "question": "Validation question" }
        ],
        "math": {
          "metric": "Key metric",
          "actual": "Current value or Unknown",
          "target": "Target value or Unknown",
          "holding_back": "What's preventing target achievement"
        }
      }
    },
    {
      "id": "metrics_intelligence",
      "name": "Metrics Intelligence",
      "content": [
        { "metric": "Metric name", "value": "Value or Unknown", "date": "Date or Unknown", "source": "Source or Unknown", "implication": "Strategic implication", "question": "Discovery question to validate" }
      ]
    },
    {
      "id": "loyalty_analysis",
      "name": "Loyalty Program Analysis",
      "content": {
        "program_exists": true,
        "program_type": "Type of loyalty program",
        "tiers": "Tier structure if found",
        "subscription_tie_in": "How subscription connects to loyalty",
        "key_observations": ["Specific observations about their loyalty/retention programs"],
        "gaps": ["What we don't know and need to discover"]
      }
    },
    {
      "id": "tech_stack",
      "name": "Tech Stack & Consolidation",
      "content": [
        { "layer": "Commerce", "vendor": "Vendor or Unknown", "evidence": "How we know this", "consolidation_opportunity": "Opportunity if any" },
        { "layer": "ESP", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "SMS", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Push", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "CMS", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "CDP", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Analytics", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Experimentation", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Reviews", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Loyalty", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Support", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Attribution", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "AI", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." },
        { "layer": "Subscription/Auto-replenish", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..." }
      ]
    },
    {
      "id": "competitive_war_game",
      "name": "Competitive War Game",
      "content": [
        { "competitor": "Competitor name", "strengths": "Their strengths vs us", "weaknesses": "Their weaknesses", "differentiation": "How we win against them", "trap_question": "Question to set a trap" }
      ]
    },
    {
      "id": "hypotheses_risks",
      "name": "Hypotheses, Blockers & Risk Heatmap",
      "content": {
        "hypotheses": ["Top 3-5 working hypotheses to validate"],
        "blockers": ["Known blockers to deal progression"],
        "gap_log": ["Critical information gaps"],
        "risk_heatmap": [
          { "risk": "Risk description", "likelihood": "High/Med/Low", "impact": "High/Med/Low", "mitigation": "Mitigation strategy" }
        ]
      }
    },
    {
      "id": "appendix",
      "name": "APPENDIX: Deep Research",
      "content": {
        "cx_audit_detail": "Detailed CX audit findings across the customer journey: capture, browse, checkout, post-purchase, cross-sell, reviews, education, replenishment, winback, loyalty moments",
        "subscription_teardown": "Full subscription model teardown if applicable: model type, discount structure, frequency options, edit window, reminder timing, pause/skip/cancel controls, cancel reason capture, lifecycle trigger map",
        "case_studies_full": [
          { "source": "Vendor/partner", "program": "Use case", "result": "Result + timeframe", "maturity_implication": "What it implies", "talk_track": "1 talk track line", "trap_question": "1 trap question", "validation_question": "1 validation question" }
        ],
        "business_model_detail": "Extended business model analysis: revenue model, channel mix, geo mix, key products, pricing position, M&A, recent launches",
        "industry_analysis": "Industry pressures, trends, and competitive dynamics"
      }
    }
  ]
}

CRITICAL: Return ONLY the JSON object. No explanation, no markdown fences. Every section must have content — no empty strings.`;
}

// ── Playbook scopes for review ──
const PLAYBOOK_SCOPES = [
  "discovery", "hypothesis", "deal_progression", "executive_framing", "meddpicc",
  "objection_handling", "value_selling", "competitive",
];

// ── Main handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    // STEP 1: Gather web research
    const research = await gatherResearch(inputs.company_name, inputs.website);

    // STEP 2: Fetch playbooks for review engine
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
          return PLAYBOOK_SCOPES.some(scope => title.includes(scope) || chapter.includes(scope));
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

    // STEP 3: Generate full document (Output A)
    console.log(`Generating draft for ${inputs.company_name}...`);
    const draftPrompt = buildDraftPrompt(inputs, research);

    const draftContent = await callAI([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: draftPrompt },
    ], { model: "google/gemini-2.5-pro", temperature: 0.3, maxTokens: 12000 });

    let draftOutput: any;
    try {
      draftOutput = JSON.parse(draftContent);
    } catch {
      console.error("Failed to parse draft JSON:", draftContent.slice(0, 500));
      // Try to extract JSON from the response
      const jsonMatch = draftContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          draftOutput = JSON.parse(jsonMatch[0]);
        } catch {
          draftOutput = { sections: [], raw: draftContent };
        }
      } else {
        draftOutput = { sections: [], raw: draftContent };
      }
    }

    // STEP 4: Generate Review (Output B)
    let reviewOutput: any = { strengths: [], redlines: [] };

    if (draftOutput.sections?.length) {
      console.log("Generating review...");
      const reviewPrompt = `You are a VP of Sales and a senior deal strategist reviewing a Discovery Prep document for ${inputs.company_name}.

Evaluate using these playbook principles:
${playbookContext || "Use standard discovery execution, MEDDPICC discipline, value selling, hypothesis development, executive framing, and competitive positioning best practices."}

THE PREP DOCUMENT:
${JSON.stringify(draftOutput.sections, null, 2)}

COMPANY: ${inputs.company_name}
STAGE: ${inputs.stage || "Unknown"}

Produce a unified review (NOT multiple frameworks — one coherent review):

1. "strengths" — max 2-3 genuinely strong, meeting-ready elements
2. "redlines" — max 3-5 specific proposed edits:
   - "section_id": which section to improve
   - "section_name": human-readable section name
   - "current_text": quote the current text
   - "proposed_text": your improved version
   - "rationale": why this matters (grounded in methodology)

Redlines must be:
- Specific and actionable
- Grounded in the relevant playbooks
- Focused on making this document meeting-ready
- NOT generic advice — specific rewrites

Return ONLY valid JSON:
{
  "strengths": ["..."],
  "redlines": [
    {
      "id": "r1",
      "section_id": "...",
      "section_name": "...",
      "current_text": "...",
      "proposed_text": "...",
      "rationale": "..."
    }
  ]
}

No markdown fences.`;

      try {
        const reviewContent = await callAI([
          { role: "system", content: "You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in methodology. Produce one unified review, not multiple competing frameworks." },
          { role: "user", content: reviewPrompt },
        ], { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 4000 });

        try {
          reviewOutput = JSON.parse(reviewContent);
        } catch {
          const jsonMatch = reviewContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { reviewOutput = JSON.parse(jsonMatch[0]); } catch { /* keep default */ }
          }
          console.error("Failed to parse review JSON");
        }
      } catch (e) {
        console.error("Review generation error:", e);
      }
    }

    // STEP 5: Store run
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
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("run-discovery-prep error:", error);
    const status = error?.status || 500;
    return new Response(JSON.stringify({ error: error?.message || "An unexpected error occurred. Please try again." }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
