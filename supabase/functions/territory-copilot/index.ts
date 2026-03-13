import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type CopilotMode = "quick" | "deep" | "meeting" | "deal-strategy" | "recap-email";

// ─── Compact serializers ──────────────────────────────────
function compactAccount(a: any): string {
  const p = [a.name, `id:${a.id}`];
  if (a.tier) p.push(`T:${a.tier}`);
  if (a.account_status) p.push(`S:${a.account_status}`);
  if (a.motion) p.push(`M:${a.motion}`);
  if (a.icp_fit_score != null) p.push(`Fit:${a.icp_fit_score}`);
  if (a.timing_score != null) p.push(`Tim:${a.timing_score}`);
  if (a.priority_score != null) p.push(`Pri:${a.priority_score}`);
  if (a.lifecycle_tier) p.push(`LC:${a.lifecycle_tier}`);
  if (a.last_touch_date) p.push(`LT:${a.last_touch_date}`);
  if (a.outreach_status) p.push(`OS:${a.outreach_status}`);
  if (a.next_step) p.push(`NS:${a.next_step.slice(0, 60)}`);
  if (a.tags?.length) p.push(`Tags:${a.tags.join(',')}`);
  if (a.tech_stack?.length) p.push(`Tech:${a.tech_stack.join(',')}`);
  if (a.enrichment_source_summary) p.push(`Enrich:${a.enrichment_source_summary.slice(0, 100)}`);
  if (a.notes) p.push(`Notes:${a.notes.slice(0, 120)}`);
  if (a.high_probability_buyer) p.push('HPB');
  if (a.triggered_account) p.push('TRIG');
  if (a.website) p.push(`Web:${a.website}`);
  if (a.industry) p.push(`Ind:${a.industry}`);
  return p.join(' | ');
}

function compactOpp(o: any, accounts: any[]): string {
  const acct = accounts.find((a: any) => a.id === o.account_id);
  const p = [o.name, `id:${o.id}`];
  if (acct) p.push(`Acct:${acct.name}`);
  p.push(`St:${o.status || '?'}`);
  if (o.stage) p.push(`Stg:${o.stage}`);
  if (o.arr) p.push(`ARR:$${o.arr}`);
  if (o.close_date) p.push(`Close:${o.close_date}`);
  if (o.next_step) p.push(`NS:${o.next_step.slice(0, 50)}`);
  if (o.last_touch_date) p.push(`LT:${o.last_touch_date}`);
  if (o.deal_type) p.push(`DT:${o.deal_type}`);
  if (o.is_new_logo) p.push('NL');
  if (o.churn_risk) p.push(`Risk:${o.churn_risk}`);
  if (o.notes) p.push(`Notes:${o.notes.slice(0, 80)}`);
  return p.join(' | ');
}

function compactRenewal(r: any): string {
  const p = [r.account_name];
  p.push(`ARR:$${r.arr}`);
  p.push(`Due:${r.renewal_due}`);
  if (r.churn_risk) p.push(`Risk:${r.churn_risk}`);
  if (r.health_status) p.push(`HP:${r.health_status}`);
  if (r.renewal_stage) p.push(`Stg:${r.renewal_stage}`);
  if (r.next_step) p.push(`NS:${r.next_step.slice(0, 50)}`);
  if (r.auto_renew) p.push('AR');
  if (r.risk_reason) p.push(`RR:${r.risk_reason.slice(0, 40)}`);
  return p.join(' | ');
}

function compactContact(c: any): string {
  const p = [c.name];
  if (c.title) p.push(c.title);
  if (c.seniority) p.push(`Sen:${c.seniority}`);
  if (c.department) p.push(`Dept:${c.department}`);
  if (c.status) p.push(`S:${c.status}`);
  if (c.last_touch_date) p.push(`LT:${c.last_touch_date}`);
  if (c.notes) p.push(`N:${c.notes.slice(0, 60)}`);
  return p.join(' | ');
}

function compactTranscript(t: any): string {
  const p = [`"${t.title || t.call_type || 'Call'}"`, `Date:${t.call_date}`];
  if (t.participants) p.push(`With:${t.participants.slice(0, 60)}`);
  if (t.duration_minutes) p.push(`${t.duration_minutes}min`);
  if (t.summary) p.push(`Summary:${t.summary.slice(0, 200)}`);
  if (t.tags?.length) p.push(`Tags:${t.tags.join(',')}`);
  // Include content excerpt for deep modes
  if (t.content) p.push(`Content:${t.content.slice(0, 500)}`);
  return p.join(' | ');
}

function compactResource(r: any): string {
  return `[${r.category.toUpperCase()}] "${r.label}" → ${r.url}${r.notes ? ` (${r.notes.slice(0, 80)})` : ''}`;
}

// ─── Perplexity web research ──────────────────────────────
async function perplexitySearch(query: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "You are a sales research assistant. Provide concise, factual intelligence about companies. Focus on: recent news, executive changes, marketing/digital initiatives, funding, partnerships, tech stack changes, and competitive positioning. Cite sources." },
          { role: "user", content: query },
        ],
        search_recency_filter: "month",
      }),
    });
    if (!response.ok) return `[Web research unavailable: ${response.status}]`;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const citations = data.citations?.map((c: string, i: number) => `[${i + 1}] ${c}`).join('\n') || "";
    return content + (citations ? `\n\nSources:\n${citations}` : "");
  } catch (e) {
    console.error("Perplexity search error:", e);
    return "[Web research failed]";
  }
}

// ─── Firecrawl website scrape ─────────────────────────────
async function scrapeWebsite(url: string, apiKey: string): Promise<string> {
  try {
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith("http")) formattedUrl = `https://${formattedUrl}`;
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: formattedUrl, formats: ["markdown"], onlyMainContent: true, waitFor: 3000 }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    return (data.data?.markdown || data.markdown || "").slice(0, 3000);
  } catch { return ""; }
}

// ─── Deep research ────────────────────────────────────────
async function deepResearch(accountName: string, website: string | null, industry: string | null, perplexityKey: string, firecrawlKey: string | null): Promise<string> {
  const queries = [
    `${accountName} company recent news executive changes marketing digital transformation 2025 2026`,
    `${accountName} ${industry || 'ecommerce'} marketing technology stack CRM lifecycle email marketing automation`,
    `${accountName} company hiring marketing CRM lifecycle retention growth job postings`,
  ];
  const tasks: Promise<string>[] = queries.map(q => perplexitySearch(q, perplexityKey));
  if (website && firecrawlKey) tasks.push(scrapeWebsite(website, firecrawlKey));
  const results = await Promise.allSettled(tasks);
  const sections = ["### Recent News & Executive Changes", "### Marketing Tech & Digital Strategy", "### Hiring & Growth Signals"];
  let output = "";
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      output += i < sections.length ? `\n${sections[i]}\n${r.value}\n` : `\n### Website Analysis\n${r.value.slice(0, 1500)}\n`;
    }
  });
  return output || "[No research results found]";
}

// ─── Tool definitions for AI write-back ───────────────────
const ACCOUNT_TOOLS = [
  {
    type: "function",
    function: {
      name: "update_account",
      description: "Update an account's fields based on research findings. Use this when you discover new intel about an account — industry, tech stack, notes, next steps, tags, etc. Always include a reason for the update. You can update multiple fields at once.",
      parameters: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "UUID of the account to update" },
          updates: {
            type: "object",
            description: "Fields to update on the account",
            properties: {
              industry: { type: "string" },
              tech_stack: { type: "array", items: { type: "string" } },
              notes: { type: "string" },
              next_step: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              tier: { type: "string", enum: ["A", "B", "C", "D"] },
              enrichment_source_summary: { type: "string" },
              mar_tech: { type: "string" },
              ecommerce: { type: "string" },
              direct_ecommerce: { type: "boolean" },
              email_sms_capture: { type: "boolean" },
              loyalty_membership: { type: "boolean" },
              mobile_app: { type: "boolean" },
              category_complexity: { type: "boolean" },
              marketing_platform_detected: { type: "string" },
              crm_lifecycle_team_size: { type: "number" },
            },
          },
          reason: { type: "string", description: "Why this update is being made" },
        },
        required: ["account_id", "updates", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_multiple_accounts",
      description: "Batch update multiple accounts at once.",
      parameters: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                account_id: { type: "string" },
                updates: { type: "object" },
                reason: { type: "string" },
              },
              required: ["account_id", "updates", "reason"],
            },
          },
        },
        required: ["updates"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Execute tool calls against DB ────────────────────────
async function executeToolCalls(toolCalls: any[], supabase: any, userId: string): Promise<{ name: string; result: any; id: string }[]> {
  const results: { name: string; result: any; id: string }[] = [];

  for (const tc of toolCalls) {
    const fn = tc.function;
    const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;

    if (fn.name === "update_account") {
      const { account_id, updates, reason } = args;
      let finalUpdates = { ...updates };
      if (updates.notes) {
        const { data: existing } = await supabase.from("accounts").select("notes").eq("id", account_id).eq("user_id", userId).single();
        const existingNotes = existing?.notes || "";
        const timestamp = new Date().toISOString().split("T")[0];
        finalUpdates.notes = existingNotes
          ? `${existingNotes}\n\n---\n📡 AI Research (${timestamp}): ${updates.notes}`
          : `📡 AI Research (${timestamp}): ${updates.notes}`;
      }
      finalUpdates.last_enriched_at = new Date().toISOString();
      
      const { error } = await supabase.from("accounts").update(finalUpdates).eq("id", account_id).eq("user_id", userId);
      results.push({
        id: tc.id,
        name: fn.name,
        result: error ? { success: false, error: error.message } : { success: true, account_id, fields_updated: Object.keys(updates), reason },
      });
    } else if (fn.name === "update_multiple_accounts") {
      const batchResults: any[] = [];
      for (const item of args.updates) {
        let finalUpdates = { ...item.updates };
        if (item.updates.notes) {
          const { data: existing } = await supabase.from("accounts").select("notes").eq("id", item.account_id).eq("user_id", userId).single();
          const existingNotes = existing?.notes || "";
          const timestamp = new Date().toISOString().split("T")[0];
          finalUpdates.notes = existingNotes
            ? `${existingNotes}\n\n---\n📡 AI Research (${timestamp}): ${item.updates.notes}`
            : `📡 AI Research (${timestamp}): ${item.updates.notes}`;
        }
        finalUpdates.last_enriched_at = new Date().toISOString();
        const { error } = await supabase.from("accounts").update(finalUpdates).eq("id", item.account_id).eq("user_id", userId);
        batchResults.push(error ? { account_id: item.account_id, success: false } : { account_id: item.account_id, success: true, fields: Object.keys(item.updates) });
      }
      results.push({ id: tc.id, name: fn.name, result: { updates: batchResults } });
    }
  }
  return results;
}

// ─── System prompts ──────────────────────────────────────
function buildSystemPrompt(ctx: any, mode: CopilotMode, researchData?: string): string {
  const today = new Date().toISOString().split("T")[0];
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const toolInstructions = `

## ACTIONS YOU CAN TAKE
You have tools to UPDATE account data directly. When your research reveals new intel, USE THEM proactively:
- Discovered their tech stack? → update_account with tech_stack
- Found their industry? → update_account with industry
- Found marketing platform? → update_account with marketing_platform_detected, mar_tech
- Detected ecommerce signals? → update direct_ecommerce, email_sms_capture, etc.
- Research reveals team size? → update crm_lifecycle_team_size
- Multiple accounts researched? → update_multiple_accounts

IMPORTANT RULES FOR UPDATES:
- ALWAYS use the exact account UUID (id) from the data below
- ALWAYS provide a reason citing what research revealed
- For notes, provide NEW findings only (system appends with timestamp)
- For tags, include ALL existing tags plus new ones
- After updating, tell the user exactly what you changed and why
- Be aggressive about updating — the user wants you to maintain their data`;

  const resourceInstructions = ctx.resources?.length ? `

## USER'S FRAMEWORKS, TEMPLATES & PLAYBOOKS
The user has linked the following resources. Reference them by name when giving advice, and recommend specific templates/frameworks when relevant to their question. If a framework like MEDDICC or Command of the Message is linked, use its methodology to structure your analysis.

${ctx.resources.map(compactResource).join('\n')}
` : '';

  const transcriptInstructions = ctx.transcripts?.length ? `

## RECENT CALL TRANSCRIPTS
These are the user's recent call transcripts for context. Reference specific conversations when relevant.

${ctx.transcripts.map(compactTranscript).join('\n\n')}
` : '';

  const modeInstructions: Record<CopilotMode, string> = {
    quick: `You are Territory Intelligence — a chief of staff for a B2B Account Executive.
Answer concisely from the data below. Bullet points. Actionable. Explain WHY using signals and scores.
When the user has linked frameworks (MEDDICC, Command of the Message, etc.), apply those frameworks to structure your analysis.
${toolInstructions}`,
    deep: `You are Territory Intelligence running in DEEP RESEARCH mode.
You have access to both internal CRM data AND live web research results.
Synthesize internal data + web intel into actionable insights, then UPDATE accounts with what you found.
When frameworks are available, use them to frame your findings (e.g., MEDDICC gaps, Command of the Message alignment).
Structure: 1. Key Findings 2. Signals Detected 3. Framework Analysis (if applicable) 4. Account Updates Applied 5. Recommended Actions
${toolInstructions}`,
    meeting: `You are Territory Intelligence running in MEETING PREP mode.
Create a comprehensive meeting brief. Use any linked frameworks (MEDDICC, etc.) to structure your prep.
Reference relevant call transcripts to highlight what was discussed previously and what follow-ups are needed.
Reference linked templates/playbooks and recommend which ones to use for this meeting.
Structure:
1. Account Overview & Framework Scorecard (MEDDICC/etc. if available)
2. Previous Conversations (from transcripts)
3. Key Contacts & Stakeholder Map
4. Our Position & Required Outcomes
5. Talking Points & Discovery Questions (aligned to frameworks)
6. Relevant Templates/Resources to Reference
7. Risk Factors & Objection Handling
8. Success Criteria & Next Steps
After building the brief, update the account with any new intel discovered.
${toolInstructions}`,
    "deal-strategy": `You are Territory Intelligence running in DEAL STRATEGY mode.
You are an expert deal strategist. Analyze opportunities using the user's linked sales frameworks (MEDDICC, Command of the Message, Challenger, etc.).
If MEDDICC is linked, score each letter: Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion.
If Command of the Message is linked, assess: Required Capabilities, Metrics, Before/After Scenarios, Positive Business Outcomes, Negative Consequences.
Reference specific transcript content to validate your assessment.
Reference linked templates and recommend which to use for advancing the deal.

Structure:
1. Deal Health Assessment (framework-based scorecard)
2. Strengths & Gaps (cite specific evidence from transcripts/notes)
3. Stakeholder Analysis (from contacts + transcripts)
4. Pipeline Risk Factors
5. Specific Actions to Advance (reference templates/playbooks)
6. Competitive Positioning
7. Recommended Next Steps with Timeline
${toolInstructions}`,
    "recap-email": `You are Territory Intelligence running in RECAP EMAIL mode.
Draft a professional follow-up/recap email based on the most recent call transcript for the specified account.
Use the user's linked email templates/frameworks to match their communication style.
The email should:
- Reference specific discussion points from the transcript
- Include clear action items and owners
- Propose next steps aligned with the opportunity stage
- Be concise, professional, and value-driven
- Match the user's frameworks (e.g., Command of the Message: tie back to business outcomes)

Output the email in a ready-to-send format with Subject line, Body, and a brief strategy note about why you structured it this way.
${toolInstructions}`,
  };

  let prompt = `${modeInstructions[mode]}
Today: ${dayOfWeek}, ${today}

Key: T=Tier, S=Status, M=Motion, Fit=ICP Fit, Tim=Timing, Pri=Priority, LC=Lifecycle, LT=Last Touch, OS=Outreach Status, NS=Next Step, HPB=High Probability Buyer, TRIG=Triggered, NL=New Logo

## Accounts (${ctx.accounts?.length || 0})
${ctx.accounts?.map(compactAccount).join('\n') || 'None'}

## Opportunities (${ctx.opportunities?.length || 0})
${ctx.opportunities?.map((o: any) => compactOpp(o, ctx.accounts || [])).join('\n') || 'None'}

## Renewals (${ctx.renewals?.length || 0})
${ctx.renewals?.map(compactRenewal).join('\n') || 'None'}`;

  if (ctx.contacts?.length) {
    prompt += `\n\n## Contacts (${ctx.contacts.length})\n${ctx.contacts.map(compactContact).join('\n')}`;
  }

  prompt += `\n\n## Today's Calendar
${ctx.events?.map((e: any) => `${e.start_time?.slice(11, 16) || '?'} ${e.title}${e.location ? ' @ ' + e.location : ''}`).join('\n') || 'No events'}

## Quota
${ctx.quota ? `New ARR: $${ctx.quota.new_arr_quota} | Renewal ARR: $${ctx.quota.renewal_arr_quota} | FY: ${ctx.quota.fiscal_year_start}→${ctx.quota.fiscal_year_end}` : 'Not configured'}

## Last Check-in
${ctx.journal ? `${ctx.journal.date} | Dials:${ctx.journal.dials} Conv:${ctx.journal.conversations} MtgSet:${ctx.journal.meetings_set} Score:${ctx.journal.daily_score || '?'} Focus:${ctx.journal.focus_mode}` : 'None'}`;

  // Add resources and transcripts
  prompt += resourceInstructions;
  prompt += transcriptInstructions;

  if (researchData) {
    prompt += `\n\n## Live Web Research Results\n${researchData}`;
  }

  return prompt;
}

// ─── Account focus detection ─────────────────────────────
function detectAccountFocus(userMessage: string, accounts: any[]): any | null {
  if (!accounts?.length) return null;
  const lower = userMessage.toLowerCase();
  const sorted = [...accounts].sort((a, b) => b.name.length - a.name.length);
  return sorted.find(a => lower.includes(a.name.toLowerCase())) || null;
}

// ─── Main handler ─────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { messages, mode: requestedMode, accountId } = body as {
      messages: any[];
      mode?: CopilotMode;
      accountId?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Please sign in to use Territory Intelligence." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mode: CopilotMode = requestedMode || "quick";
    const today = new Date().toISOString().split("T")[0];
    const needsDeepContext = mode !== "quick";

    // Gather DB context in parallel — always include resources & transcripts now
    const dbQueries: Promise<any>[] = [
      supabase.from("accounts").select("*").eq("user_id", user.id).limit(200),
      supabase.from("opportunities").select("*").eq("user_id", user.id).limit(200),
      supabase.from("renewals").select("*").eq("user_id", user.id).limit(200),
      supabase.from("calendar_events").select("*").eq("user_id", user.id)
        .gte("start_time", `${today}T00:00:00`).lte("start_time", `${today}T23:59:59`)
        .order("start_time"),
      supabase.from("daily_journal_entries").select("*").eq("user_id", user.id)
        .order("date", { ascending: false }).limit(1),
      supabase.from("quota_targets").select("*").eq("user_id", user.id).limit(1),
      // Always fetch resources
      supabase.from("resource_links").select("*").eq("user_id", user.id).limit(100),
    ];

    // For modes that need deep context, also fetch contacts and transcripts
    if (needsDeepContext) {
      dbQueries.push(
        supabase.from("contacts").select("*").eq("user_id", user.id).limit(500),
        supabase.from("call_transcripts").select("*").eq("user_id", user.id)
          .order("call_date", { ascending: false }).limit(20),
      );
    }

    const dbResults = await Promise.all(dbQueries);
    const [accountsRes, oppsRes, renewalsRes, eventsRes, journalRes, quotaRes, resourcesRes, contactsRes, transcriptsRes] = dbResults;

    const ctx: any = {
      accounts: accountsRes.data || [],
      opportunities: oppsRes.data || [],
      renewals: renewalsRes.data || [],
      events: eventsRes.data || [],
      journal: journalRes.data?.[0] || null,
      quota: quotaRes.data?.[0] || null,
      resources: resourcesRes.data || [],
      contacts: contactsRes?.data || [],
      transcripts: transcriptsRes?.data || [],
    };

    // If an account is focused, filter transcripts and resources to that account for relevance
    let focusAccount: any = null;
    if (accountId) {
      focusAccount = ctx.accounts.find((a: any) => a.id === accountId);
    } else {
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
      focusAccount = detectAccountFocus(lastUserMsg, ctx.accounts);
    }

    if (focusAccount && needsDeepContext) {
      // Filter transcripts to focused account (+ keep some general ones)
      const accountTranscripts = ctx.transcripts.filter((t: any) => t.account_id === focusAccount.id);
      const accountOpps = ctx.opportunities.filter((o: any) => o.account_id === focusAccount.id);
      const oppIds = new Set(accountOpps.map((o: any) => o.id));
      const oppTranscripts = ctx.transcripts.filter((t: any) => t.opportunity_id && oppIds.has(t.opportunity_id));
      const allRelevant = [...new Map([...accountTranscripts, ...oppTranscripts].map(t => [t.id, t])).values()];
      if (allRelevant.length > 0) {
        ctx.transcripts = allRelevant;
      }

      // Filter resources to focused account
      const accountResources = ctx.resources.filter((r: any) =>
        r.account_id === focusAccount.id ||
        oppIds.has(r.opportunity_id) ||
        (!r.account_id && !r.opportunity_id && !r.renewal_id) // Global resources always included
      );
      if (accountResources.length > 0) {
        ctx.resources = accountResources;
      }
    }

    // Deep/meeting/deal-strategy: web research
    let researchData: string | undefined;
    if (mode === "deep" || mode === "meeting" || mode === "deal-strategy") {
      const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

      if (perplexityKey && focusAccount) {
        console.log(`Deep research on: ${focusAccount.name}`);
        researchData = await deepResearch(focusAccount.name, focusAccount.website, focusAccount.industry, perplexityKey, firecrawlKey || null);
      } else if (perplexityKey && !focusAccount) {
        const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
        researchData = await perplexitySearch(lastUserMsg, perplexityKey);
      } else if (!perplexityKey && mode !== "deal-strategy") {
        researchData = "[Deep research unavailable: Perplexity not connected.]";
      }
    }

    const useProModel = mode === "deep" || mode === "deal-strategy";
    const model = useProModel ? "google/gemini-2.5-pro" : "google/gemini-3-flash-preview";
    const systemPrompt = buildSystemPrompt(ctx, mode, researchData);

    // First call: non-streaming with tools to get potential tool calls
    const aiPayload: any = {
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: ACCOUNT_TOOLS,
      stream: false,
    };

    const firstResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiPayload),
    });

    if (!firstResponse.ok) {
      const status = firstResponse.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const text = await firstResponse.text();
      console.error("AI gateway error:", status, text);
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const firstResult = await firstResponse.json();
    const choice = firstResult.choices?.[0];
    const toolCalls = choice?.message?.tool_calls;

    // If no tool calls, stream the response directly
    if (!toolCalls || toolCalls.length === 0) {
      const streamPayload = { ...aiPayload, stream: true };
      delete streamPayload.tools;
      const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(streamPayload),
      });
      if (!streamResponse.ok) {
        return new Response(JSON.stringify({ error: "AI service error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(streamResponse.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    // Execute tool calls
    console.log(`Executing ${toolCalls.length} tool call(s)...`);
    const toolResults = await executeToolCalls(toolCalls, supabase, user.id);

    // Build tool result messages
    const toolMessages = toolCalls.map((tc: any, i: number) => ({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify(toolResults[i]?.result || { success: false }),
    }));

    // Second call: stream final response with tool results
    const followUpPayload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
        choice.message,
        ...toolMessages,
      ],
      stream: true,
    };

    const followUpResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(followUpPayload),
    });

    if (!followUpResponse.ok) {
      const content = (choice.message.content || "") + "\n\n✅ **Account Updates Applied:**\n" +
        toolResults.map(r => `- ${r.name}: ${JSON.stringify(r.result)}`).join('\n');
      const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sseData, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    const updateSummary = toolResults.map(r => {
      if (r.name === "update_account" && r.result.success) {
        return `✅ Updated account (${r.result.fields_updated.join(', ')}): ${r.result.reason}`;
      }
      if (r.name === "update_multiple_accounts") {
        const count = r.result.updates?.filter((u: any) => u.success).length || 0;
        return `✅ Updated ${count} account(s)`;
      }
      return null;
    }).filter(Boolean).join('\n');

    const notificationEvent = updateSummary
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: `> 🔄 **Data Updates Applied**\n> ${updateSummary.replace(/\n/g, '\n> ')}\n\n` } }] })}\n\n`
      : "";

    const encoder = new TextEncoder();
    const notifChunk = encoder.encode(notificationEvent);
    const mergedStream = new ReadableStream({
      async start(controller) {
        if (notifChunk.length > 0) controller.enqueue(notifChunk);
        const reader = followUpResponse.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      },
    });

    return new Response(mergedStream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("territory-copilot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
