import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// ═══════════════════════════════════════════════════════════
// MULTI-LLM ORCHESTRATION — Same adapter pattern as strategy-chat
//
// Perplexity  = external research & signal gathering
// OpenAI      = deep reasoning, synthesis, POV, hypotheses
// Claude      = final structured Discovery Prep document author
// ═══════════════════════════════════════════════════════════

// ── Provider Adapters ──

function getPerplexityHeaders(): Record<string, string> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) throw new Error("PERPLEXITY_API_KEY not configured");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function getOpenAIHeaders(): Record<string, string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function getAnthropicHeaders(): Record<string, string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

async function callPerplexity(messages: { role: string; content: string }[], opts: { model?: string; maxTokens?: number } = {}): Promise<{ text: string; citations: string[] }> {
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: getPerplexityHeaders(),
    body: JSON.stringify({
      model: opts.model || "sonar-pro",
      messages,
      temperature: 0.3,
      max_tokens: opts.maxTokens || 8192,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[perplexity] error ${resp.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Perplexity error: ${resp.status}`);
  }
  const data = await resp.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    citations: data.citations || [],
  };
}

async function callOpenAI(messages: { role: string; content: string }[], opts: { model?: string; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: getOpenAIHeaders(),
    body: JSON.stringify({
      model: opts.model || "gpt-4o",
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens || 8192,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[openai] error ${resp.status}: ${errText.slice(0, 200)}`);
    throw new Error(`OpenAI error: ${resp.status}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callClaude(messages: { role: string; content: string }[], opts: { model?: string; maxTokens?: number; temperature?: number } = {}): Promise<string> {
  let systemPrompt = "";
  const anthropicMessages: { role: string; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") { systemPrompt += (systemPrompt ? "\n" : "") + m.content; }
    else { anthropicMessages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }); }
  }
  if (anthropicMessages.length === 0 && systemPrompt) {
    anthropicMessages.push({ role: "user", content: systemPrompt });
    systemPrompt = "";
  }

  const body: any = {
    model: opts.model || "claude-sonnet-4-20250514",
    max_tokens: opts.maxTokens || 12000,
    messages: anthropicMessages,
    temperature: opts.temperature ?? 0.3,
  };
  if (systemPrompt) body.system = systemPrompt;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: getAnthropicHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[claude] error ${resp.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Claude error: ${resp.status}`);
  }
  const data = await resp.json();
  let text = "";
  for (const block of (data.content || [])) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

// ═══════════════════════════════════════════════════════════
// STAGE 1 — PERPLEXITY RESEARCH
// Parallel research queries for comprehensive evidence gathering
// ═══════════════════════════════════════════════════════════

async function gatherResearch(companyName: string, website?: string): Promise<Record<string, { text: string; citations: string[] }>> {
  console.log(`[stage-1] Perplexity research for ${companyName}...`);

  const queries = [
    {
      key: "business",
      prompt: `Research ${companyName}: revenue model, channel mix, key products/lines, pricing position, stated exec priorities, recent earnings/investor info, press releases, product launches, M&A activity, and competitive set (direct + substitutes). ${website ? `Their website is ${website}.` : ""} Be specific with numbers, dates, and sources.`,
    },
    {
      key: "cx_lifecycle",
      prompt: `Research ${companyName}'s customer experience and lifecycle marketing: signup/capture flows, browse/cart/checkout experience, post-purchase communications, cross-sell programs, reviews/UGC strategy, education content, replenishment signals, winback triggers, loyalty moments, subscription programs. ${website ? `Website: ${website}` : ""} Focus on observable evidence.`,
    },
    {
      key: "tech_stack",
      prompt: `Research ${companyName}'s marketing technology stack. Look for evidence of: Commerce platform, ESP/email, SMS, Push notifications, CMS, CDP, Analytics, Experimentation/testing, Reviews, Loyalty program platform, Support tools, Attribution, AI tools, Subscription/auto-replenish vendors. Check job posts, partner pages, help center, app store integrations. ${website ? `Website: ${website}` : ""}`,
    },
    {
      key: "case_studies",
      prompt: `Find public case studies, proof points, or vendor announcements involving ${companyName} related to: marketing automation, lifecycle marketing, email/SMS personalization, customer engagement platforms, CDP, loyalty programs, subscription commerce. Search vendor case study libraries (e.g., Iterable, Braze, Klaviyo, Salesforce, Adobe). Extract: program/use case, result + timeframe, what it implies about maturity.`,
    },
    {
      key: "subscription",
      prompt: `Does ${companyName} have a subscription or auto-replenish program? Look for: subscribe & save, auto-delivery, replenishment, subscription programs on their site. Check for vendors: Ordergroove, Recharge, Skio, Shopify Subscriptions, Bold Subscriptions. ${website ? `Website: ${website}` : ""} If found, capture: model type, discount structure, frequency options, cancel controls.`,
    },
  ];

  const results: Record<string, { text: string; citations: string[] }> = {};

  const settled = await Promise.allSettled(
    queries.map(async (q) => {
      try {
        const result = await callPerplexity([
          { role: "system", content: "You are a sales research analyst. Provide specific, sourced facts. Include dates and numbers when available. If information is not found, say so explicitly." },
          { role: "user", content: q.prompt },
        ]);
        return { key: q.key, result };
      } catch (e) {
        console.error(`[stage-1] ${q.key} research failed:`, e);
        return { key: q.key, result: { text: "", citations: [] } };
      }
    })
  );

  for (const s of settled) {
    if (s.status === "fulfilled") {
      results[s.value.key] = s.value.result;
    }
  }

  const totalChars = Object.values(results).reduce((sum, r) => sum + r.text.length, 0);
  console.log(`[stage-1] Research complete: ${totalChars} chars across ${Object.keys(results).length} queries`);
  return results;
}

// ═══════════════════════════════════════════════════════════
// STAGE 2 — OPENAI SYNTHESIS
// Deep reasoning: hypothesis, POV, strategy, prioritization
// ═══════════════════════════════════════════════════════════

function buildSynthesisPrompt(inputs: any, research: Record<string, { text: string; citations: string[] }>, playbookContext: string): string {
  const participantsText = (inputs.participants || [])
    .map((p: any) => `- ${p.name}${p.title ? ` (${p.title})` : ""}${p.role ? ` — ${p.role}` : ""} [${p.side || "prospect"}]`)
    .join("\n");

  const researchText = Object.entries(research)
    .filter(([_, v]) => v.text)
    .map(([key, v]) => `=== ${key.toUpperCase()} RESEARCH ===\n${v.text}\n\nSources: ${v.citations.join(", ") || "inline"}`)
    .join("\n\n---\n\n");

  return `You are a senior sales strategist synthesizing research into actionable discovery strategy.

COMPANY: ${inputs.company_name}
REP: ${inputs.rep_name || "Corey"}
OPPORTUNITY: ${inputs.opportunity || "Unknown"}
STAGE: ${inputs.stage || "Unknown"}
PLATFORM SCALE: ${inputs.scale || "Unknown"}
DESIRED NEXT STEP: ${inputs.desired_next_step || "Unknown"}
PRIOR NOTES: ${inputs.prior_notes || "None"}

MEETING PARTICIPANTS:
${participantsText || "Unknown"}

--- PERPLEXITY RESEARCH ---
${researchText || "No research available."}
--- END RESEARCH ---

${playbookContext ? `\n--- PLAYBOOK CONTEXT ---\n${playbookContext}\n--- END PLAYBOOKS ---\n` : ""}

YOUR TASK:
Synthesize ALL research into a comprehensive strategic analysis. Do NOT just summarize — connect evidence into actionable intelligence.

You must produce:

1. WORKING HYPOTHESIS: Connect business pain → executive initiative → solution value. Be specific to this company.
2. WHY NOW: Timing triggers, catalysts, urgency drivers based on evidence
3. POV: 3-5 sentences, specific and grounded — not generic
4. DISCOVERY STRATEGY: What we need to validate, confirm, or uncover
5. PAIN MAPPING: Marketing team problems → how they translate to C-Suite/business pains
6. SUBSCRIPTION ANALYSIS: Yes/No + full mechanics if found
7. LIFECYCLE MATURITY ASSESSMENT: Based on case studies and observable evidence
8. TECH STACK EVIDENCE MAP: Layer-by-layer with evidence quality
9. ROI FRAMEWORK: Defensible logic, sensitivity model, M.A.T.H.
10. COMPETITIVE POSITIONING: How to win against their current/alternative solutions
11. RISK ASSESSMENT: Deal risks, information gaps, mitigation strategies
12. MUST-CONFIRM ITEMS: Top 3-5 critical validations for the meeting

RULES:
- Every claim must trace to research evidence or be labeled "Unknown — discovery question needed"
- No generic filler. Every bullet must be specific to THIS company.
- Include sensitivity model: +5-10% AOV, +5% frequency, -3% churn with revenue direction
- Use M.A.T.H.: Metric, Actual, Target, Holding back
- Max 3 bullets per concept. Overflow is fine — Claude will structure it.

Return your synthesis as a structured JSON object:
{
  "hypothesis": "...",
  "why_now": "...",
  "pov": "3-5 sentence POV",
  "must_confirm": ["item1", "item2", "item3"],
  "deal_risks": [{"risk": "...", "mitigation": "..."}],
  "pain_mapping": {"marketing_pains": ["..."], "csuite_pains": ["..."], "connection": "..."},
  "subscription_analysis": {"exists": true/false, "model_type": "...", "discount_structure": "...", "frequency_options": "...", "cancel_controls": "...", "vendors": "..."},
  "lifecycle_maturity": {"level": "early/developing/mature/advanced", "evidence": ["..."], "case_studies": [{"source": "...", "program": "...", "result": "...", "maturity_implication": "...", "talk_track": "...", "trap_question": "...", "validation_question": "..."}]},
  "tech_stack": [{"layer": "Commerce", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..."}, ...],
  "roi_framework": {"primary_logic": "...", "sensitivity": [{"scenario": "...", "impact": "...", "question": "..."}], "math": {"metric": "...", "actual": "...", "target": "...", "holding_back": "..."}},
  "competitive_positioning": [{"competitor": "...", "strengths": "...", "weaknesses": "...", "differentiation": "...", "trap_question": "..."}],
  "discovery_questions": ["6 specific questions"],
  "value_selling": {"money": "...", "compete": "...", "current_state": "...", "industry_pressures": "...", "problems_and_pain": "...", "ideal_state": "...", "value_driver": "..."},
  "customer_examples": [{"customer": "...", "relevance": "...", "link": "..."}],
  "pivot_statements": {"pain": "...", "fomo": "..."},
  "objection_handling": [{"objection": "...", "response": "..."}],
  "executive_snapshot": {"company_overview": "...", "key_metrics": [{"metric": "...", "value": "...", "source": "..."}], "exec_priorities": ["..."]},
  "appendix": {"cx_audit_detail": "...", "subscription_teardown": "...", "business_model_detail": "...", "industry_analysis": "..."}
}

Return ONLY the JSON. No markdown fences.`;
}

// ═══════════════════════════════════════════════════════════
// STAGE 3 — CLAUDE DOCUMENT AUTHORING
// Final structured output aligned to approved template
// ═══════════════════════════════════════════════════════════

function buildDocumentPrompt(inputs: any, synthesis: any): string {
  return `You are the document author for a Discovery Prep artifact. Your role is to take synthesized intelligence and shape it into the approved template structure.

COMPANY: ${inputs.company_name}
REP: ${inputs.rep_name || "Corey"}
OPPORTUNITY: ${inputs.opportunity || "Unknown"}
STAGE: ${inputs.stage || "Unknown"}
SCALE: ${inputs.scale || "Unknown"}
DESIRED NEXT STEP: ${inputs.desired_next_step || "Unknown"}

PARTICIPANTS:
${(inputs.participants || []).map((p: any) => `- ${p.name}${p.title ? ` (${p.title})` : ""} [${p.side || "prospect"}]`).join("\n")}

SYNTHESIZED INTELLIGENCE:
${JSON.stringify(synthesis, null, 2)}

YOUR TASK:
Shape this synthesis into the EXACT Discovery Prep template structure below. You are the final document author — make it polished, scannable, and meeting-ready.

RULES — NON-NEGOTIABLE:
- Use ONLY the synthesis provided. Do not invent new facts.
- If information is missing: label "Unknown" and include a discovery question
- Max 3 bullets per card/cell. Overflow goes to appendix.
- Every metric needs date + source, or labeled "Unknown"
- POV must be exactly 3-5 sentences
- All content must be scannable: bullets, tables, cards. NO long paragraphs.
- Discovery questions must sound prepared, not generic.

Return a JSON object with this EXACT structure:
{
  "sections": [
    {
      "id": "cockpit",
      "name": "Page-1 Cockpit",
      "content": {
        "cards": [
          { "label": "Objective & Next Step", "value": "specific objective + desired next step" },
          { "label": "Working Hypothesis & Why Now", "value": "from synthesis" },
          { "label": "Must-Confirm", "bullets": ["from synthesis must_confirm"] },
          { "label": "Deal Risks & Call Control", "bullets": ["from synthesis deal_risks"] },
          { "label": "Subscription Model", "value": "Yes/No + key mechanics" },
          { "label": "Lifecycle Proof Points", "bullets": ["top 1-2 from case studies"] }
        ]
      }
    },
    {
      "id": "cover",
      "name": "Prep Doc — Cover",
      "content": {
        "rep_name": "${inputs.rep_name || "Corey"}",
        "opportunity": "${inputs.opportunity || "Unknown"}",
        "stage": "${inputs.stage || "Unknown"}",
        "platform_scale": "from synthesis or input"
      }
    },
    {
      "id": "participants",
      "name": "Participants",
      "content": {
        "internal": [{"name": "...", "role": "AE/SE/Manager"}],
        "prospect": [{"name": "...", "title": "...", "role": "EB/Champion/Coach/Unknown"}]
      }
    },
    {
      "id": "cx_audit",
      "name": "CX Audit Check",
      "content": { "completed": true, "notes": "from synthesis" }
    },
    {
      "id": "executive_snapshot",
      "name": "Executive Snapshot",
      "content": {
        "company_overview": "from synthesis",
        "why_now": "from synthesis",
        "key_metrics": [{"metric": "...", "value": "...", "source": "..."}],
        "exec_priorities": ["from synthesis"]
      }
    },
    {
      "id": "value_selling",
      "name": "Value Selling Observations Framework",
      "content": {
        "money": "...", "compete": "...", "pain_hypothesis": "...",
        "csuite_initiative": "...", "current_state": "...", "industry_pressures": "...",
        "problems_and_pain": "...", "ideal_state": "...", "value_driver": "...",
        "pov": "3-5 sentence POV"
      }
    },
    {
      "id": "discovery_questions",
      "name": "Discovery-1 Questions",
      "content": {
        "questions": ["6 specific questions"],
        "value_flow": {
          "current_state": "...", "problem": "...", "impact": "...",
          "ideal_solution": "...", "business_benefit": "..."
        }
      }
    },
    {
      "id": "customer_examples",
      "name": "Customer Examples",
      "content": [{"customer": "...", "link": "...", "relevance": "..."}]
    },
    {
      "id": "pivot_statements",
      "name": "Pivot Statements",
      "content": {
        "pain_statement": "from synthesis",
        "fomo_statement": "from synthesis"
      }
    },
    {
      "id": "objection_handling",
      "name": "Objection Handling",
      "content": [{"objection": "...", "response": "..."}]
    },
    {
      "id": "marketing_team",
      "name": "Marketing Team Members",
      "content": [{"name": "...", "title": "...", "linkedin": "URL if found"}]
    },
    {
      "id": "exit_criteria",
      "name": "Exit Criteria & MEDDPICC",
      "content": {
        "known": ["..."], "gaps": ["..."],
        "meddpicc_gaps": ["Metrics", "Economic Buyer", "Decision Criteria", "Decision Process", "Paper Process", "Identify Pain", "Champion", "Competition"]
      }
    },
    {
      "id": "revenue_pathway",
      "name": "Revenue Pathway & Sensitivity",
      "content": {
        "model": [{"driver": "...", "current": "...", "potential": "...", "assumptions": "..."}],
        "sensitivity": [{"scenario": "...", "impact": "...", "question": "..."}],
        "math": {"metric": "...", "actual": "...", "target": "...", "holding_back": "..."}
      }
    },
    {
      "id": "metrics_intelligence",
      "name": "Metrics Intelligence",
      "content": [{"metric": "...", "value": "...", "date": "...", "source": "...", "implication": "...", "question": "..."}]
    },
    {
      "id": "loyalty_analysis",
      "name": "Loyalty Program Analysis",
      "content": {
        "program_exists": true, "program_type": "...", "tiers": "...",
        "subscription_tie_in": "...", "key_observations": ["..."], "gaps": ["..."]
      }
    },
    {
      "id": "tech_stack",
      "name": "Tech Stack & Consolidation",
      "content": [{"layer": "Commerce", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..."}]
    },
    {
      "id": "competitive_war_game",
      "name": "Competitive War Game",
      "content": [{"competitor": "...", "strengths": "...", "weaknesses": "...", "differentiation": "...", "trap_question": "..."}]
    },
    {
      "id": "hypotheses_risks",
      "name": "Hypotheses, Blockers & Risk Heatmap",
      "content": {
        "hypotheses": ["..."], "blockers": ["..."], "gap_log": ["..."],
        "risk_heatmap": [{"risk": "...", "likelihood": "High/Med/Low", "impact": "High/Med/Low", "mitigation": "..."}]
      }
    },
    {
      "id": "appendix",
      "name": "APPENDIX: Deep Research",
      "content": {
        "cx_audit_detail": "...", "subscription_teardown": "...",
        "case_studies_full": [{"source": "...", "program": "...", "result": "...", "maturity_implication": "...", "talk_track": "...", "trap_question": "...", "validation_question": "..."}],
        "business_model_detail": "...", "industry_analysis": "..."
      }
    }
  ]
}

Return ONLY the JSON. No markdown fences.`;
}

// ═══════════════════════════════════════════════════════════
// STAGE 4 — REVIEW (Playbook-grounded, use-case specific)
// Uses Lovable AI Gateway for cost efficiency
// ═══════════════════════════════════════════════════════════

async function callLovableAI(messages: { role: string; content: string }[], opts: { model?: string; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model || "google/gemini-2.5-flash",
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens || 4000,
    }),
  });
  if (!resp.ok) {
    const status = resp.status;
    if (status === 429) throw { status: 429, message: "Rate limited" };
    if (status === 402) throw { status: 402, message: "AI credits exhausted" };
    throw new Error(`Lovable AI error: ${status}`);
  }
  const data = await resp.json();
  let content = data.choices?.[0]?.message?.content || "";
  return content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

// Playbook scopes relevant to Discovery Prep
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

    console.log(`[discovery-prep] Starting for ${inputs.company_name}`);

    // STAGE 1: Perplexity — External research & signal gathering
    const research = await gatherResearch(inputs.company_name, inputs.website);

    // Fetch playbooks for review + synthesis context
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

    // STAGE 2: OpenAI — Deep reasoning, synthesis, POV, hypotheses
    console.log(`[stage-2] OpenAI synthesis...`);
    const synthesisPrompt = buildSynthesisPrompt(inputs, research, playbookContext);
    const synthesisRaw = await callOpenAI([
      { role: "system", content: "You are a senior sales strategist. Synthesize research into actionable intelligence. Return structured JSON only." },
      { role: "user", content: synthesisPrompt },
    ], { model: "gpt-4o", temperature: 0.4, maxTokens: 8192 });

    let synthesis: any;
    try {
      const cleaned = synthesisRaw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      synthesis = JSON.parse(cleaned);
    } catch {
      const jsonMatch = synthesisRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { synthesis = JSON.parse(jsonMatch[0]); } catch { synthesis = { raw: synthesisRaw }; }
      } else {
        synthesis = { raw: synthesisRaw };
      }
    }
    console.log(`[stage-2] Synthesis complete: ${Object.keys(synthesis).length} fields`);

    // STAGE 3: Claude — Final structured Discovery Prep document author
    console.log(`[stage-3] Claude document authoring...`);
    const documentPrompt = buildDocumentPrompt(inputs, synthesis);
    const documentRaw = await callClaude([
      { role: "system", content: "You are a document author. Shape synthesized intelligence into the exact approved Discovery Prep template. Return ONLY valid JSON matching the specified structure. No markdown fences." },
      { role: "user", content: documentPrompt },
    ], { model: "claude-sonnet-4-20250514", maxTokens: 12000, temperature: 0.3 });

    let draftOutput: any;
    try {
      const cleaned = documentRaw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      draftOutput = JSON.parse(cleaned);
    } catch {
      const jsonMatch = documentRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { draftOutput = JSON.parse(jsonMatch[0]); } catch { draftOutput = { sections: [], raw: documentRaw }; }
      } else {
        draftOutput = { sections: [], raw: documentRaw };
      }
    }
    console.log(`[stage-3] Document authored: ${draftOutput.sections?.length || 0} sections`);

    // STAGE 4: Review — Playbook-grounded, use-case specific (Lovable AI for cost efficiency)
    let reviewOutput: any = { strengths: [], redlines: [] };

    if (draftOutput.sections?.length) {
      console.log("[stage-4] Generating review...");
      const reviewPrompt = `You are a VP of Sales and senior deal strategist reviewing a Discovery Prep document for ${inputs.company_name}.

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

Redlines must be specific rewrites, not generic advice.

Return ONLY valid JSON:
{
  "strengths": ["..."],
  "redlines": [{"id": "r1", "section_id": "...", "section_name": "...", "current_text": "...", "proposed_text": "...", "rationale": "..."}]
}

No markdown fences.`;

      try {
        const reviewContent = await callLovableAI([
          { role: "system", content: "You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in methodology." },
          { role: "user", content: reviewPrompt },
        ], { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 4000 });

        try {
          reviewOutput = JSON.parse(reviewContent);
        } catch {
          const jsonMatch = reviewContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { reviewOutput = JSON.parse(jsonMatch[0]); } catch { /* keep default */ }
          }
        }
      } catch (e) {
        console.error("[stage-4] Review generation error:", e);
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

    console.log(`[discovery-prep] Complete. Run: ${run.id}, Sections: ${draftOutput.sections?.length || 0}, Redlines: ${reviewOutput.redlines?.length || 0}`);

    return new Response(JSON.stringify({
      run_id: run.id,
      draft: draftOutput,
      review: reviewOutput,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("[discovery-prep] Error:", e);
    const status = e.status || 500;
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
