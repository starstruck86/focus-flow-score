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

    const [benchmarksRes, quotaRes, oppsRes, renewalsRes, journalRes] = await Promise.all([
      supabase.from("conversion_benchmarks").select("*").maybeSingle(),
      supabase.from("quota_targets").select("*").maybeSingle(),
      supabase.from("opportunities").select("arr, stage, status, close_date, is_new_logo"),
      supabase.from("renewals").select("arr, renewal_stage, renewal_due"),
      supabase.from("daily_journal_entries").select("date, dials, conversations, meetings_set, opportunities_created")
        .gte("date", new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0])
        .order("date", { ascending: false }),
    ]);

    const benchmarks = benchmarksRes.data || {
      dials_to_connect_rate: 0.10,
      connect_to_meeting_rate: 0.25,
      meeting_to_opp_rate: 0.40,
      opp_to_close_rate: 0.25,
      avg_new_logo_arr: 50000,
      avg_renewal_arr: 80000,
      avg_sales_cycle_days: 90,
    };

    const quota = quotaRes.data;
    const newArrQuota = quota ? parseFloat(quota.new_arr_quota) : 500000;
    const renewalArrQuota = quota ? parseFloat(quota.renewal_arr_quota) : 822542;
    const fyEnd = quota ? new Date(quota.fiscal_year_end) : new Date("2026-06-30");

    // Calculate closed ARR — FIX: explicit is_new_logo checks
    const opps = oppsRes.data || [];
    const isClosedWon = (o: any) =>
      o.status === "closed-won" ||
      o.stage?.toLowerCase() === "closed won";

    const closedWonOpps = opps.filter(isClosedWon);

    // FIX: Only count as new logo if explicitly marked true
    const newArrClosed = closedWonOpps
      .filter((o: any) => o.is_new_logo === true)
      .reduce((s: number, o: any) => s + (parseFloat(o.arr) || 0), 0);

    // FIX: Opps with is_new_logo === false or null that are closed won count toward renewal-type
    const oppRenewalArrClosed = closedWonOpps
      .filter((o: any) => o.is_new_logo === false)
      .reduce((s: number, o: any) => s + (parseFloat(o.arr) || 0), 0);

    const renewals = renewalsRes.data || [];
    const renewalTableArrClosed = renewals
      .filter((r: any) => r.renewal_stage?.toLowerCase().includes("closed") || r.renewal_stage?.toLowerCase().includes("renewed"))
      .reduce((s: number, r: any) => s + (parseFloat(r.arr) || 0), 0);

    const renewalArrClosed = renewalTableArrClosed + oppRenewalArrClosed;

    // Gaps
    const newArrGap = Math.max(0, newArrQuota - newArrClosed);
    const renewalArrGap = Math.max(0, renewalArrQuota - renewalArrClosed);
    const totalGap = newArrGap + renewalArrGap;

    // Time remaining
    const daysRemaining = Math.max(1, Math.floor((fyEnd.getTime() - Date.now()) / 86400000));
    const weeksRemaining = Math.max(1, Math.ceil(daysRemaining / 7));
    const workdaysRemaining = Math.max(1, Math.ceil(daysRemaining * 5 / 7));

    // Reverse-engineer funnel from benchmarks
    const b = benchmarks;
    const dialsToConnect = Math.min(1, Math.max(0.01, parseFloat(b.dials_to_connect_rate) || 0.10));
    const connectToMeeting = Math.min(1, Math.max(0.01, parseFloat(b.connect_to_meeting_rate) || 0.25));
    const meetingToOpp = Math.min(1, Math.max(0.01, parseFloat(b.meeting_to_opp_rate) || 0.40));
    const oppToClose = Math.min(1, Math.max(0.01, parseFloat(b.opp_to_close_rate) || 0.25));
    const avgDealSize = Math.max(1, parseFloat(b.avg_new_logo_arr) || 50000);

    // How many deals needed to close the new logo gap
    const dealsNeeded = newArrGap > 0 ? Math.ceil(newArrGap / avgDealSize) : 0;

    // Reverse funnel
    const oppsNeeded = dealsNeeded > 0 ? Math.ceil(dealsNeeded / oppToClose) : 0;
    const meetingsNeeded = oppsNeeded > 0 ? Math.ceil(oppsNeeded / meetingToOpp) : 0;
    const connectsNeeded = meetingsNeeded > 0 ? Math.ceil(meetingsNeeded / connectToMeeting) : 0;
    const dialsNeeded = connectsNeeded > 0 ? Math.ceil(connectsNeeded / dialsToConnect) : 0;

    // Per-week and per-day targets
    const dealsPerWeek = Math.ceil(dealsNeeded / weeksRemaining);
    const oppsPerWeek = Math.ceil(oppsNeeded / weeksRemaining);
    const meetingsPerWeek = Math.ceil(meetingsNeeded / weeksRemaining);
    const connectsPerDay = Math.ceil(connectsNeeded / workdaysRemaining);
    const dialsPerDay = Math.ceil(dialsNeeded / workdaysRemaining);

    // Current activity pace (last 30 days)
    const journal = journalRes.data || [];
    const journalDays = journal.length || 1;
    const actualPace = {
      dialsPerDay: Math.round(journal.reduce((s: number, j: any) => s + (j.dials || 0), 0) / journalDays),
      conversationsPerDay: Math.round(journal.reduce((s: number, j: any) => s + (j.conversations || 0), 0) / journalDays * 10) / 10,
      meetingsPerWeek: Math.round(journal.reduce((s: number, j: any) => s + (j.meetings_set || 0), 0) / journalDays * 5),
      oppsPerWeek: Math.round(journal.reduce((s: number, j: any) => s + (j.opportunities_created || 0), 0) / journalDays * 5 * 10) / 10,
    };

    // Gap analysis
    const dialGap = dialsPerDay - actualPace.dialsPerDay;
    const meetingGap = meetingsPerWeek - actualPace.meetingsPerWeek;
    const onPace = dialGap <= 0 && meetingGap <= 0;

    // FIX: Pipeline coverage — for renewal opps, only count expansion ARR
    const activeOpps = opps.filter((o: any) => o.status === "active");
    const activePipelineArr = activeOpps.reduce((s: number, o: any) => {
      const arr = parseFloat(o.arr) || 0;
      if (o.is_new_logo === true) return s + arr;
      // Renewal opp: only expansion counts
      const priorArr = parseFloat(o.prior_contract_arr) || 0;
      const renewalArr = parseFloat(o.renewal_arr) || arr;
      const expansion = Math.max(0, renewalArr - priorArr);
      // If no expansion, assume 4% of prior spend
      return s + (expansion > 0 ? expansion : priorArr * 0.04);
    }, 0);
    const coverageDenominator = totalGap > 0 ? totalGap : 1;
    const pipelineCoverage = totalGap > 0 ? activePipelineArr / coverageDenominator : (activePipelineArr > 0 ? 999 : 0);

    const result = {
      quota: {
        newArrQuota, renewalArrQuota,
        newArrClosed, renewalArrClosed,
        newArrGap, renewalArrGap, totalGap,
        newArrAttainment: newArrQuota > 0 ? newArrClosed / newArrQuota : 0,
        renewalArrAttainment: renewalArrQuota > 0 ? renewalArrClosed / renewalArrQuota : 0,
      },
      timeline: { daysRemaining, weeksRemaining, workdaysRemaining, fyEnd: fyEnd.toISOString().split("T")[0] },
      funnel: {
        benchmarks: { dialsToConnect, connectToMeeting, meetingToOpp, oppToClose, avgDealSize },
        totalNeeded: { deals: dealsNeeded, opps: oppsNeeded, meetings: meetingsNeeded, connects: connectsNeeded, dials: dialsNeeded },
        weeklyTargets: { deals: dealsPerWeek, opps: oppsPerWeek, meetings: meetingsPerWeek },
        dailyTargets: { dials: dialsPerDay, connects: connectsPerDay },
      },
      pace: {
        actual: actualPace,
        required: { dialsPerDay, connectsPerDay, meetingsPerWeek, oppsPerWeek },
        gaps: { dialGap, meetingGap },
        onPace,
        dataPoints: journalDays,
      },
      pipeline: {
        activePipelineArr,
        pipelineCoverage: Math.round(pipelineCoverage * 100) / 100,
        coverageHealthy: pipelineCoverage >= 3,
        activeDeals: opps.filter((o: any) => o.status === "active").length,
      },
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("conversion-math error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
