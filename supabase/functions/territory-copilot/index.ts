import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildSystemPrompt(context: any): string {
  const today = new Date().toISOString().split("T")[0];
  
  return `You are the Territory Intelligence Copilot for Quota Compass — a personal sales operating system.
You act as a chief of staff / sales operator for an Account Executive.

Today's date: ${today}

RULES:
- Answer based ONLY on the data provided below. Never make up accounts, opportunities, or numbers.
- Be specific: name accounts, cite ARR values, reference dates.
- When recommending actions, explain WHY (cite signals, scores, staleness, risk).
- Keep answers concise and actionable — bullet points preferred.
- If asked about scoring, explain the exact signals that drive it.
- Format currency as $XXk or $XXXk.
- When comparing accounts, use a structured format.

TERRITORY DATA:

## Accounts (${context.accounts?.length || 0} total)
${context.accounts?.map((a: any) => 
  `- ${a.name} | Tier: ${a.tier || '?'} | Status: ${a.account_status || '?'} | Motion: ${a.motion || '?'} | ICP Fit: ${a.icp_fit_score ?? '?'}/100 | Timing: ${a.timing_score ?? '?'}/100 | Priority: ${a.priority_score ?? '?'}/100 | Lifecycle: ${a.lifecycle_tier || '?'} | Last Touch: ${a.last_touch_date || 'never'} | Outreach: ${a.outreach_status || '?'} | Tags: ${(a.tags || []).join(', ') || 'none'} | Tech: ${(a.tech_stack || []).join(', ') || 'unknown'} | Signals: ${a.enrichment_source_summary || 'none'} | Notes: ${(a.notes || '').slice(0, 200)}`
).join('\n') || 'No accounts found.'}

## Opportunities (${context.opportunities?.length || 0} total)
${context.opportunities?.map((o: any) => {
  const acct = context.accounts?.find((a: any) => a.id === o.account_id);
  return `- ${o.name} | Account: ${acct?.name || '?'} | Status: ${o.status} | Stage: ${o.stage || '?'} | ARR: $${o.arr || 0} | Close: ${o.close_date || '?'} | Next Step: ${o.next_step || 'none'} | Last Touch: ${o.last_touch_date || 'never'} | Deal Type: ${o.deal_type || '?'} | New Logo: ${o.is_new_logo ? 'Yes' : 'No'}`;
}).join('\n') || 'No opportunities found.'}

## Renewals (${context.renewals?.length || 0} total)
${context.renewals?.map((r: any) => 
  `- ${r.account_name} | ARR: $${r.arr} | Due: ${r.renewal_due} | Risk: ${r.churn_risk || 'low'} | Health: ${r.health_status || '?'} | Stage: ${r.renewal_stage || '?'} | Next Step: ${r.next_step || 'none'} | Auto-Renew: ${r.auto_renew ? 'Yes' : 'No'} | Risk Reason: ${r.risk_reason || 'none'}`
).join('\n') || 'No renewals found.'}

## Today's Calendar (${context.events?.length || 0} events)
${context.events?.map((e: any) => 
  `- ${e.title} | ${e.start_time} - ${e.end_time || 'TBD'} | ${e.location || ''}`
).join('\n') || 'No events today.'}

## Active Tasks (${context.tasks?.length || 0} tasks)  
${context.tasks?.map((t: any) => {
  const acct = context.accounts?.find((a: any) => a.id === t.linked_account_id);
  return `- [${t.priority || 'P2'}] ${t.title} | Status: ${t.status} | Due: ${t.due_date || '?'} | Account: ${acct?.name || t.linked_account_id || 'none'} | Workstream: ${t.workstream || '?'}`;
}).join('\n') || 'No active tasks.'}

## Quota Context
${context.quota ? `New ARR Quota: $${context.quota.new_arr_quota} | Renewal ARR Quota: $${context.quota.renewal_arr_quota} | FY: ${context.quota.fiscal_year_start} to ${context.quota.fiscal_year_end}` : 'No quota configured.'}

## Recent Journal (last check-in)
${context.journal ? `Date: ${context.journal.date} | Dials: ${context.journal.dials} | Conversations: ${context.journal.conversations} | Meetings Set: ${context.journal.meetings_set} | Score: ${context.journal.daily_score || '?'} | Focus: ${context.journal.focus_mode}` : 'No recent check-in.'}`;
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

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gather all territory context in parallel
    const today = new Date().toISOString().split("T")[0];
    const todayStart = `${today}T00:00:00`;
    const todayEnd = `${today}T23:59:59`;

    const [accountsRes, oppsRes, renewalsRes, eventsRes, journalRes, quotaRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", user.id).limit(200),
      supabase.from("opportunities").select("*").eq("user_id", user.id).limit(200),
      supabase.from("renewals").select("*").eq("user_id", user.id).limit(200),
      supabase.from("calendar_events").select("*").eq("user_id", user.id).gte("start_time", todayStart).lte("start_time", todayEnd).order("start_time"),
      supabase.from("daily_journal_entries").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(1),
      supabase.from("quota_targets").select("*").eq("user_id", user.id).limit(1),
    ]);

    const context = {
      accounts: accountsRes.data || [],
      opportunities: oppsRes.data || [],
      renewals: renewalsRes.data || [],
      events: eventsRes.data || [],
      journal: journalRes.data?.[0] || null,
      quota: quotaRes.data?.[0] || null,
    };

    const systemPrompt = buildSystemPrompt(context);

    // Stream from Lovable AI
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
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in workspace settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", status, text);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("territory-copilot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
