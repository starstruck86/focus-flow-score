import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Compact account summary to reduce tokens
function compactAccount(a: any): string {
  const parts = [a.name];
  if (a.tier) parts.push(`T:${a.tier}`);
  if (a.account_status) parts.push(`S:${a.account_status}`);
  if (a.motion) parts.push(`M:${a.motion}`);
  if (a.icp_fit_score != null) parts.push(`Fit:${a.icp_fit_score}`);
  if (a.timing_score != null) parts.push(`Tim:${a.timing_score}`);
  if (a.priority_score != null) parts.push(`Pri:${a.priority_score}`);
  if (a.lifecycle_tier) parts.push(`LC:${a.lifecycle_tier}`);
  if (a.last_touch_date) parts.push(`LT:${a.last_touch_date}`);
  if (a.outreach_status) parts.push(`OS:${a.outreach_status}`);
  if (a.next_step) parts.push(`NS:${a.next_step.slice(0, 60)}`);
  if (a.tags?.length) parts.push(`Tags:${a.tags.join(',')}`);
  if (a.tech_stack?.length) parts.push(`Tech:${a.tech_stack.join(',')}`);
  if (a.enrichment_source_summary) parts.push(`Enrich:${a.enrichment_source_summary.slice(0, 80)}`);
  if (a.notes) parts.push(`Notes:${a.notes.slice(0, 100)}`);
  if (a.high_probability_buyer) parts.push('HPB');
  if (a.triggered_account) parts.push('TRIG');
  return parts.join(' | ');
}

function compactOpp(o: any, accounts: any[]): string {
  const acct = accounts.find((a: any) => a.id === o.account_id);
  const parts = [o.name];
  if (acct) parts.push(`Acct:${acct.name}`);
  parts.push(`St:${o.status || '?'}`);
  if (o.stage) parts.push(`Stg:${o.stage}`);
  if (o.arr) parts.push(`ARR:$${o.arr}`);
  if (o.close_date) parts.push(`Close:${o.close_date}`);
  if (o.next_step) parts.push(`NS:${o.next_step.slice(0, 50)}`);
  if (o.last_touch_date) parts.push(`LT:${o.last_touch_date}`);
  if (o.deal_type) parts.push(`DT:${o.deal_type}`);
  if (o.is_new_logo) parts.push('NL');
  if (o.churn_risk) parts.push(`Risk:${o.churn_risk}`);
  return parts.join(' | ');
}

function compactRenewal(r: any): string {
  const parts = [r.account_name];
  parts.push(`ARR:$${r.arr}`);
  parts.push(`Due:${r.renewal_due}`);
  if (r.churn_risk) parts.push(`Risk:${r.churn_risk}`);
  if (r.health_status) parts.push(`HP:${r.health_status}`);
  if (r.renewal_stage) parts.push(`Stg:${r.renewal_stage}`);
  if (r.next_step) parts.push(`NS:${r.next_step.slice(0, 50)}`);
  if (r.auto_renew) parts.push('AR');
  if (r.risk_reason) parts.push(`RR:${r.risk_reason.slice(0, 40)}`);
  return parts.join(' | ');
}

function buildSystemPrompt(ctx: any): string {
  const today = new Date().toISOString().split("T")[0];
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return `You are Territory Intelligence — a chief of staff for a B2B Account Executive using Quota Compass.
Today: ${dayOfWeek}, ${today}

RULES:
- Answer ONLY from data below. Never fabricate.
- Be specific: name accounts, cite $ values, reference dates.
- Explain WHY (cite signals, scores, staleness, risk).
- Bullet points. Concise. Actionable.
- Currency as $Xk/$XXXk. Dates as "Mar 15" style.
- Key legend: T=Tier, S=Status, M=Motion, Fit=ICP Fit Score, Tim=Timing Score, Pri=Priority Score, LC=Lifecycle, LT=Last Touch, OS=Outreach Status, NS=Next Step, HPB=High Probability Buyer, TRIG=Triggered Account, St=Status, Stg=Stage, DT=Deal Type, NL=New Logo, HP=Health, AR=Auto Renew, RR=Risk Reason

## Accounts (${ctx.accounts?.length || 0})
${ctx.accounts?.map(compactAccount).join('\n') || 'None'}

## Opportunities (${ctx.opportunities?.length || 0})
${ctx.opportunities?.map((o: any) => compactOpp(o, ctx.accounts || [])).join('\n') || 'None'}

## Renewals (${ctx.renewals?.length || 0})
${ctx.renewals?.map(compactRenewal).join('\n') || 'None'}

## Today's Calendar
${ctx.events?.map((e: any) => `${e.start_time?.slice(11,16) || '?'} ${e.title}${e.location ? ' @ ' + e.location : ''}`).join('\n') || 'No events'}

## Quota
${ctx.quota ? `New ARR: $${ctx.quota.new_arr_quota} | Renewal ARR: $${ctx.quota.renewal_arr_quota} | FY: ${ctx.quota.fiscal_year_start}→${ctx.quota.fiscal_year_end}` : 'Not configured'}

## Last Check-in
${ctx.journal ? `${ctx.journal.date} | Dials:${ctx.journal.dials} Conv:${ctx.journal.conversations} MtgSet:${ctx.journal.meetings_set} Score:${ctx.journal.daily_score || '?'} Focus:${ctx.journal.focus_mode}` : 'None'}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gather context in parallel
    const today = new Date().toISOString().split("T")[0];
    const [accountsRes, oppsRes, renewalsRes, eventsRes, journalRes, quotaRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", user.id).limit(200),
      supabase.from("opportunities").select("*").eq("user_id", user.id).limit(200),
      supabase.from("renewals").select("*").eq("user_id", user.id).limit(200),
      supabase.from("calendar_events").select("*").eq("user_id", user.id)
        .gte("start_time", `${today}T00:00:00`).lte("start_time", `${today}T23:59:59`)
        .order("start_time"),
      supabase.from("daily_journal_entries").select("*").eq("user_id", user.id)
        .order("date", { ascending: false }).limit(1),
      supabase.from("quota_targets").select("*").eq("user_id", user.id).limit(1),
    ]);

    const ctx = {
      accounts: accountsRes.data || [],
      opportunities: oppsRes.data || [],
      renewals: renewalsRes.data || [],
      events: eventsRes.data || [],
      journal: journalRes.data?.[0] || null,
      quota: quotaRes.data?.[0] || null,
    };

    const systemPrompt = buildSystemPrompt(ctx);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
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
