import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // Fetch benchmarks, quota, and current closed deals in parallel
    const [benchmarksRes, quotaRes, oppsRes, renewalsRes, journalRes] = await Promise.all([
      supabase.from("conversion_benchmarks").select("*").maybeSingle(),
      supabase.from("quota_targets").select("*").maybeSingle(),
      supabase.from("opportunities").select("arr, stage, status, close_date, is_new_logo"),
      supabase.from("renewals").select("arr, renewal_stage, renewal_due"),
      // Last 30 days of journal for actual pace
      supabase.from("daily_journal_entries").select("date, dials, conversations, meetings_set, opportunities_created")
        .gte("date", new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0])
        .order("date", { ascending: false }),
    ]);

    // Defaults
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

    // Calculate closed ARR
    const opps = oppsRes.data || [];
    const closedWonOpps = opps.filter((o: any) => 
      o.status === "closed-won" || o.stage?.toLowerCase().includes("closed won") || o.stage?.includes("7-")
    );
    const newArrClosed = closedWonOpps
      .filter((o: any) => o.is_new_logo !== false)
      .reduce((s: number, o: any) => s + (parseFloat(o.arr) || 0), 0);
    
    const renewals = renewalsRes.data || [];
    const renewalArrClosed = renewals
      .filter((r: any) => r.renewal_stage?.toLowerCase().includes("closed") || r.renewal_stage?.includes("renewed"))
      .reduce((s: number, r: any) => s + (parseFloat(r.arr) || 0), 0);

    // Gaps
    const newArrGap = Math.max(0, newArrQuota - newArrClosed);
    const renewalArrGap = Math.max(0, renewalArrQuota - renewalArrClosed);
    const totalGap = newArrGap + renewalArrGap;

    // Time remaining
    const daysRemaining = Math.max(1, Math.floor((fyEnd.getTime() - Date.now()) / 86400000));
    const weeksRemaining = Math.ceil(daysRemaining / 7);
    const workdaysRemaining = Math.ceil(daysRemaining * 5 / 7);

    // Reverse-engineer funnel from benchmarks
    const b = benchmarks;
    const dialsToConnect = parseFloat(b.dials_to_connect_rate) || 0.10;
    const connectToMeeting = parseFloat(b.connect_to_meeting_rate) || 0.25;
    const meetingToOpp = parseFloat(b.meeting_to_opp_rate) || 0.40;
    const oppToClose = parseFloat(b.opp_to_close_rate) || 0.25;
    const avgDealSize = parseFloat(b.avg_new_logo_arr) || 50000;

    // How many deals needed to close the gap
    const dealsNeeded = Math.ceil(newArrGap / avgDealSize);
    
    // Reverse funnel
    const oppsNeeded = Math.ceil(dealsNeeded / oppToClose);
    const meetingsNeeded = Math.ceil(oppsNeeded / meetingToOpp);
    const connectsNeeded = Math.ceil(meetingsNeeded / connectToMeeting);
    const dialsNeeded = Math.ceil(connectsNeeded / dialsToConnect);

    // Per-week and per-day targets
    const dealsPerWeek = Math.ceil(dealsNeeded / Math.max(1, weeksRemaining));
    const oppsPerWeek = Math.ceil(oppsNeeded / Math.max(1, weeksRemaining));
    const meetingsPerWeek = Math.ceil(meetingsNeeded / Math.max(1, weeksRemaining));
    const connectsPerDay = Math.ceil(connectsNeeded / Math.max(1, workdaysRemaining));
    const dialsPerDay = Math.ceil(dialsNeeded / Math.max(1, workdaysRemaining));

    // Current activity pace (last 30 days)
    const journal = journalRes.data || [];
    const journalDays = journal.length || 1;
    const actualPace = {
      dialsPerDay: Math.round(journal.reduce((s: number, j: any) => s + (j.dials || 0), 0) / journalDays),
      conversationsPerDay: Math.round(journal.reduce((s: number, j: any) => s + (j.conversations || 0), 0) / journalDays * 10) / 10,
      meetingsPerWeek: Math.round(journal.reduce((s: number, j: any) => s + (j.meetings_set || 0), 0) / journalDays * 5),
      oppsPerWeek: Math.round(journal.reduce((s: number, j: any) => s + (j.opportunities_created || 0), 0) / journalDays * 5 * 10) / 10,
    };

    // Gap analysis — are you on pace?
    const dialGap = dialsPerDay - actualPace.dialsPerDay;
    const meetingGap = meetingsPerWeek - actualPace.meetingsPerWeek;
    const onPace = dialGap <= 0 && meetingGap <= 0;

    // Active pipeline coverage
    const activePipelineArr = opps
      .filter((o: any) => o.status === "active")
      .reduce((s: number, o: any) => s + (parseFloat(o.arr) || 0), 0);
    const pipelineCoverage = newArrGap > 0 ? activePipelineArr / newArrGap : 999;

    const result = {
      // Quota status
      quota: {
        newArrQuota, renewalArrQuota,
        newArrClosed, renewalArrClosed: renewalArrClosed,
        newArrGap, renewalArrGap, totalGap,
        newArrAttainment: newArrQuota > 0 ? newArrClosed / newArrQuota : 0,
        renewalArrAttainment: renewalArrQuota > 0 ? renewalArrClosed / renewalArrQuota : 0,
      },
      // Time
      timeline: { daysRemaining, weeksRemaining, workdaysRemaining, fyEnd: fyEnd.toISOString().split("T")[0] },
      // Funnel math
      funnel: {
        benchmarks: { dialsToConnect, connectToMeeting, meetingToOpp, oppToClose, avgDealSize },
        totalNeeded: { deals: dealsNeeded, opps: oppsNeeded, meetings: meetingsNeeded, connects: connectsNeeded, dials: dialsNeeded },
        weeklyTargets: { deals: dealsPerWeek, opps: oppsPerWeek, meetings: meetingsPerWeek },
        dailyTargets: { dials: dialsPerDay, connects: connectsPerDay },
      },
      // Current pace vs required
      pace: {
        actual: actualPace,
        required: { dialsPerDay, connectsPerDay, meetingsPerWeek, oppsPerWeek },
        gaps: { dialGap, meetingGap },
        onPace,
        dataPoints: journalDays,
      },
      // Pipeline health
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
