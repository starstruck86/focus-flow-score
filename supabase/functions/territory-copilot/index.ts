import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Modes ────────────────────────────────────────────────
// quick    → fast answer from DB context only (default)
// deep     → DB context + live web research via Perplexity
// meeting  → focused meeting prep: account intel + recent news + contacts
type CopilotMode = "quick" | "deep" | "meeting";

// ─── Compact serializers (token-efficient) ────────────────
function compactAccount(a: any): string {
  const p = [a.name];
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
  const p = [o.name];
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

// ─── Perplexity web research ──────────────────────────────
async function perplexitySearch(query: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "You are a sales research assistant. Provide concise, factual intelligence about companies. Focus on: recent news, executive changes, marketing/digital initiatives, funding, partnerships, tech stack changes, and competitive positioning. Cite sources." },
          { role: "user", content: query },
        ],
        search_recency_filter: "month",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Perplexity error:", response.status, text);
      return `[Web research unavailable: ${response.status}]`;
    }

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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Firecrawl error:", response.status, text);
      return "";
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || "";
    // Truncate to keep context manageable
    return markdown.slice(0, 3000);
  } catch (e) {
    console.error("Firecrawl error:", e);
    return "";
  }
}

// ─── Deep research: multi-query Perplexity ────────────────
async function deepResearch(accountName: string, website: string | null, industry: string | null, perplexityKey: string, firecrawlKey: string | null): Promise<string> {
  const queries = [
    `${accountName} company recent news executive changes marketing digital transformation 2025 2026`,
    `${accountName} ${industry || 'ecommerce'} marketing technology stack CRM lifecycle email marketing automation`,
    `${accountName} company hiring marketing CRM lifecycle retention growth job postings`,
  ];

  const tasks: Promise<string>[] = queries.map(q => perplexitySearch(q, perplexityKey));

  // Optionally scrape website for tech signals
  if (website && firecrawlKey) {
    tasks.push(scrapeWebsite(website, firecrawlKey));
  }

  const results = await Promise.allSettled(tasks);
  const sections = [
    "### Recent News & Executive Changes",
    "### Marketing Tech & Digital Strategy",
    "### Hiring & Growth Signals",
  ];

  let output = "";
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      if (i < sections.length) {
        output += `\n${sections[i]}\n${r.value}\n`;
      } else {
        output += `\n### Website Analysis\n${r.value.slice(0, 1500)}\n`;
      }
    }
  });

  return output || "[No research results found]";
}

// ─── System prompts by mode ──────────────────────────────
function buildSystemPrompt(ctx: any, mode: CopilotMode, researchData?: string): string {
  const today = new Date().toISOString().split("T")[0];
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const modeInstructions: Record<CopilotMode, string> = {
    quick: `You are Territory Intelligence — a chief of staff for a B2B Account Executive.
Answer concisely from the data below. Bullet points. Actionable. Explain WHY using signals and scores.`,

    deep: `You are Territory Intelligence running in DEEP RESEARCH mode.
You have access to both internal CRM data AND live web research results.
Your job: synthesize internal data + web intel into actionable insights.
Structure your answer:
1. **Key Findings** — what's most important
2. **Signals Detected** — buying signals, risk indicators, changes
3. **Recommended Actions** — specific next steps with rationale
4. **Confidence Assessment** — how confident you are and what's missing
Be thorough but organized. Cite specific data points and web sources.`,

    meeting: `You are Territory Intelligence running in MEETING PREP mode.
Create a comprehensive meeting brief. Structure:
1. **Account Overview** — who they are, what they do, our relationship
2. **Recent Intel** — news, changes, signals from web research
3. **Key Contacts** — who to reference, their roles
4. **Our Position** — current status, pipeline, opportunities
5. **Talking Points** — 3-5 specific things to discuss
6. **Risk Factors** — what to watch out for
7. **Success Criteria** — what a great meeting looks like
Be specific. Use real data. Flag unknowns.`,
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

  // Add contacts for meeting mode
  if (mode === 'meeting' && ctx.contacts?.length) {
    prompt += `\n\n## Contacts (${ctx.contacts.length})
${ctx.contacts.map(compactContact).join('\n')}`;
  }

  prompt += `\n\n## Today's Calendar
${ctx.events?.map((e: any) => `${e.start_time?.slice(11, 16) || '?'} ${e.title}${e.location ? ' @ ' + e.location : ''}`).join('\n') || 'No events'}

## Quota
${ctx.quota ? `New ARR: $${ctx.quota.new_arr_quota} | Renewal ARR: $${ctx.quota.renewal_arr_quota} | FY: ${ctx.quota.fiscal_year_start}→${ctx.quota.fiscal_year_end}` : 'Not configured'}

## Last Check-in
${ctx.journal ? `${ctx.journal.date} | Dials:${ctx.journal.dials} Conv:${ctx.journal.conversations} MtgSet:${ctx.journal.meetings_set} Score:${ctx.journal.daily_score || '?'} Focus:${ctx.journal.focus_mode}` : 'None'}`;

  // Append web research for deep/meeting modes
  if (researchData) {
    prompt += `\n\n## Live Web Research Results\n${researchData}`;
  }

  return prompt;
}

// ─── Detect if query is about a specific account ─────────
function detectAccountFocus(userMessage: string, accounts: any[]): any | null {
  if (!accounts?.length) return null;
  const lower = userMessage.toLowerCase();
  // Sort by name length desc to match longest first (avoid partial matches)
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

    // Determine mode
    const mode: CopilotMode = requestedMode || "quick";
    const today = new Date().toISOString().split("T")[0];

    // Gather DB context in parallel
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
    ];

    // For deep/meeting modes, also fetch contacts
    if (mode === "deep" || mode === "meeting") {
      dbQueries.push(
        supabase.from("contacts").select("*").eq("user_id", user.id).limit(500)
      );
    }

    const dbResults = await Promise.all(dbQueries);
    const [accountsRes, oppsRes, renewalsRes, eventsRes, journalRes, quotaRes, contactsRes] = dbResults;

    const ctx: any = {
      accounts: accountsRes.data || [],
      opportunities: oppsRes.data || [],
      renewals: renewalsRes.data || [],
      events: eventsRes.data || [],
      journal: journalRes.data?.[0] || null,
      quota: quotaRes.data?.[0] || null,
      contacts: contactsRes?.data || [],
    };

    // For deep/meeting modes, run web research
    let researchData: string | undefined;
    if (mode === "deep" || mode === "meeting") {
      const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

      if (perplexityKey) {
        // Detect which account the user is asking about
        const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
        let focusAccount = accountId
          ? ctx.accounts.find((a: any) => a.id === accountId)
          : detectAccountFocus(lastUserMsg, ctx.accounts);

        if (focusAccount) {
          console.log(`Deep research on: ${focusAccount.name}`);
          researchData = await deepResearch(
            focusAccount.name,
            focusAccount.website,
            focusAccount.industry,
            perplexityKey,
            firecrawlKey || null
          );
        } else {
          // General territory research — use the question itself
          console.log("Deep research: general territory query");
          researchData = await perplexitySearch(lastUserMsg, perplexityKey);
        }
      } else {
        researchData = "[Deep research unavailable: Perplexity not connected. Using internal data only.]";
      }
    }

    // Select model based on mode
    const model = mode === "deep" ? "google/gemini-2.5-pro" : "google/gemini-3-flash-preview";

    const systemPrompt = buildSystemPrompt(ctx, mode, researchData);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in workspace settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", status, text);
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("territory-copilot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
