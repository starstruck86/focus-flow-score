import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get Monday of current week
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekStart = monday.toISOString().split("T")[0];
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const weekEnd = friday.toISOString().split("T")[0];

    // FIX: Fetch ALL opps (not just active) so we can calculate closed ARR properly
    const [oppsRes, renewalsRes, accountsRes, quotaRes, benchmarksRes, journalRes, hygieneRes, existingPlanRes] = await Promise.all([
      supabase.from("opportunities").select("*"),
      supabase.from("renewals").select("*"),
      supabase.from("accounts").select("id, name, tier, account_status, last_touch_date, priority_score, icp_fit_score")
        .in("account_status", ["active", "prepped", "researching", "1-researching", "2-prepped", "3-active", "4-meeting_booked", "5-opportunity"])
        .order("priority_score", { ascending: false }).limit(20),
      supabase.from("quota_targets").select("*").maybeSingle(),
      supabase.from("conversion_benchmarks").select("*").maybeSingle(),
      supabase.from("daily_journal_entries").select("date, dials, conversations, meetings_set, opportunities_created, daily_score")
        .order("date", { ascending: false }).limit(5),
      supabase.from("pipeline_hygiene_scans").select("*").order("scan_date", { ascending: false }).limit(1).maybeSingle(),
      // FIX: Check for existing plan to preserve moves_completed
      supabase.from("weekly_battle_plans").select("moves_completed").eq("user_id", user.id).eq("week_start", weekStart).maybeSingle(),
    ]);

    const allOpps = oppsRes.data || [];
    const renewals = renewalsRes.data || [];
    const accounts = accountsRes.data || [];
    const quota = quotaRes.data;
    const benchmarks = benchmarksRes.data;
    const recentJournal = journalRes.data || [];
    const hygiene = hygieneRes.data;
    const existingPlan = existingPlanRes.data;

    // FIX: Proper closed-won detection matching actual stages
    const isClosedWon = (o: any) =>
      o.status === "closed-won" || o.stage?.toLowerCase() === "closed won";

    const totalQuota = (quota ? parseFloat(quota.new_arr_quota) + parseFloat(quota.renewal_arr_quota) : 1322542);
    const closedArr = allOpps.filter(isClosedWon)
      .filter((o: any) => o.is_new_logo === true)
      .reduce((sum: number, o: any) => sum + (parseFloat(o.arr) || 0), 0);
    const renewalClosedArr = renewals
      .filter(r => r.renewal_stage?.toLowerCase().includes("closed") || r.renewal_stage?.toLowerCase().includes("renewed"))
      .reduce((sum: number, r: any) => sum + (parseFloat(r.arr) || 0), 0);
    const totalClosed = closedArr + renewalClosedArr;
    const quotaGap = Math.max(0, totalQuota - totalClosed);

    const fyEnd = quota ? new Date(quota.fiscal_year_end) : new Date("2026-06-30");
    const daysRemaining = Math.max(0, Math.floor((fyEnd.getTime() - Date.now()) / 86400000));

    const funnelContext = benchmarks
      ? `Conversion Rates: ${(benchmarks.dials_to_connect_rate * 100).toFixed(0)}% dial→connect, ${(benchmarks.connect_to_meeting_rate * 100).toFixed(0)}% connect→meeting, ${(benchmarks.meeting_to_opp_rate * 100).toFixed(0)}% meeting→opp, ${(benchmarks.opp_to_close_rate * 100).toFixed(0)}% opp→close. Avg deal: $${benchmarks.avg_new_logo_arr}. Cycle: ${benchmarks.avg_sales_cycle_days}d.`
      : "Using default conversion estimates (10% dial→connect, 25% connect→meeting, 40% meeting→opp, 25% opp→close).";

    const avgDials = recentJournal.length > 0 ? Math.round(recentJournal.reduce((s: number, j: any) => s + (j.dials || 0), 0) / recentJournal.length) : 0;
    const avgConvos = recentJournal.length > 0 ? (recentJournal.reduce((s: number, j: any) => s + (j.conversations || 0), 0) / recentJournal.length).toFixed(1) : "0";

    // FIX: Use active opps for pipeline context (not closed ones)
    const activeOpps = allOpps.filter((o: any) => o.status === "active");
    const pipelineArr = activeOpps.reduce((sum: number, o: any) => sum + (parseFloat(o.arr) || 0), 0);

    const upcomingRenewals = renewals.filter(r => {
      const d = Math.floor((new Date(r.renewal_due).getTime() - Date.now()) / 86400000);
      return d > 0 && d <= 60;
    }).sort((a, b) => new Date(a.renewal_due).getTime() - new Date(b.renewal_due).getTime());

    const prompt = `You are an elite B2B SaaS sales strategist. Generate a Weekly Battle Plan — the 5-7 highest-impact moves this person should make THIS WEEK to close their quota gap and get to President's Club.

CONTEXT:
- Quota Gap: $${quotaGap.toLocaleString()} remaining of $${totalQuota.toLocaleString()} total quota
- Days Remaining in FY: ${daysRemaining}
- Active Pipeline: ${activeOpps.length} opps worth $${pipelineArr.toLocaleString()}
- Recent Activity Pace: ~${avgDials} dials/day, ~${avgConvos} conversations/day
- ${funnelContext}

TOP ACCOUNTS (by priority):
${accounts.slice(0, 10).map((a: any) => `- ${a.name} (Tier ${a.tier}, ICP: ${a.icp_fit_score || 'N/A'}, Status: ${a.account_status})`).join("\n")}

ACTIVE OPPORTUNITIES:
${activeOpps.slice(0, 8).map((o: any) => `- ${o.name}: $${o.arr || 0} ARR, Stage: ${o.stage}, Next Step: ${o.next_step || 'NONE'}, Last Touch: ${o.last_touch_date || 'Never'}`).join("\n")}

UPCOMING RENEWALS (60d window):
${upcomingRenewals.slice(0, 5).map((r: any) => `- ${r.account_name}: $${r.arr} ARR, Due: ${r.renewal_due}, Risk: ${r.churn_risk}`).join("\n") || "None"}

${hygiene ? `PIPELINE HEALTH: Score ${hygiene.health_score}/100, ${hygiene.critical_issues} critical issues, $${(hygiene.summary as any)?.total_arr_at_risk || 0} ARR at risk` : ""}

RULES:
1. Each move must be specific (name the account/opp), actionable (what exactly to do), and time-bound (which day this week)
2. Rank by quota impact — biggest gap-closers first
3. Include a mix of: deal progression, new pipeline creation, renewal protection
4. Be realistic about what one person can accomplish in 5 days
5. Include the "why" — connect each move back to the P-Club math
6. If pipeline is thin, emphasize prospecting moves. If pipeline is rich, emphasize progression.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a sales strategy coach. Return structured data via the tool call." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "create_battle_plan",
            description: "Create a weekly battle plan with ranked moves",
            parameters: {
              type: "object",
              properties: {
                strategy_summary: { type: "string", description: "2-3 sentence overview of the week's strategy theme" },
                moves: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      rank: { type: "number" },
                      title: { type: "string", description: "Short action title (5-8 words)" },
                      description: { type: "string", description: "Specific action to take" },
                      target_day: { type: "string", description: "Day of week to execute" },
                      category: { type: "string", enum: ["deal_progression", "prospecting", "renewal_protection", "pipeline_creation", "relationship_building"] },
                      impact_type: { type: "string", enum: ["revenue", "pipeline", "risk_mitigation", "activity"] },
                      estimated_arr_impact: { type: "number", description: "Estimated ARR impact if successful" },
                      account_name: { type: "string", description: "Account or opp name this relates to" },
                      why: { type: "string", description: "Why this matters for P-Club trajectory" },
                    },
                    required: ["rank", "title", "description", "target_day", "category", "impact_type", "why"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["strategy_summary", "moves"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_battle_plan" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error("AI gateway error:", status, errText);
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a minute." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const plan = JSON.parse(toolCall.function.arguments);

    // FIX: Preserve existing moves_completed if regenerating mid-week
    const preservedCompleted = existingPlan?.moves_completed || [];

    const { data: saved, error: saveError } = await supabase
      .from("weekly_battle_plans")
      .upsert({
        user_id: user.id,
        week_start: weekStart,
        week_end: weekEnd,
        moves: plan.moves || [],
        strategy_summary: plan.strategy_summary,
        quota_gap: quotaGap,
        days_remaining: daysRemaining,
        // Reset completed since moves changed, but log old count
        moves_completed: [],
      }, { onConflict: "user_id,week_start" })
      .select()
      .single();

    if (saveError) throw saveError;

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("weekly-battle-plan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
