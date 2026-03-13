import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get last 14 days of journal entries for pattern analysis
    const { data: entries } = await supabase
      .from("daily_journal_entries")
      .select(
        "date, dials, conversations, prospects_added, meetings_set, customer_meetings_held, opportunities_created, prospecting_block_minutes, account_deep_work_minutes, daily_score, goal_met, pipeline_moved, biggest_blocker, sentiment_score, sentiment_label, accounts_researched, contacts_prepped, what_worked_today, daily_reflection, check_in_timestamp"
      )
      .eq("user_id", user.id)
      .eq("checked_in", true)
      .order("date", { ascending: false })
      .limit(14);

    if (!entries || entries.length < 5) {
      return new Response(
        JSON.stringify({ insights: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get WHOOP data for correlation
    const dates = entries.map(e => e.date);
    const { data: whoopData } = await supabase
      .from("whoop_daily_metrics")
      .select("date, recovery_score, sleep_score, strain_score")
      .eq("user_id", user.id)
      .in("date", dates);

    // Build correlation map
    const whoopByDate: Record<string, any> = {};
    (whoopData || []).forEach(w => { whoopByDate[w.date] = w; });

    // Get targets
    const { data: targets } = await supabase
      .from("quota_targets")
      .select("target_dials_per_day, target_connects_per_day, target_meetings_set_per_week")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    // Compute patterns locally (no AI needed for basic patterns)
    const insights: string[] = [];
    const n = entries.length;

    // 1. Day-of-week performance
    const dayPerf: Record<number, { goals: number; total: number; dials: number }> = {};
    entries.forEach(e => {
      const dow = new Date(e.date + 'T12:00:00').getDay();
      if (!dayPerf[dow]) dayPerf[dow] = { goals: 0, total: 0, dials: 0 };
      dayPerf[dow].total++;
      if (e.goal_met) dayPerf[dow].goals++;
      dayPerf[dow].dials += e.dials || 0;
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const bestDay = Object.entries(dayPerf)
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => (b[1].goals / b[1].total) - (a[1].goals / a[1].total))[0];
    const worstDay = Object.entries(dayPerf)
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => (a[1].goals / a[1].total) - (b[1].goals / b[1].total))[0];

    if (bestDay && worstDay && bestDay[0] !== worstDay[0]) {
      const bestRate = Math.round((bestDay[1].goals / bestDay[1].total) * 100);
      const worstRate = Math.round((worstDay[1].goals / worstDay[1].total) * 100);
      if (bestRate - worstRate >= 30) {
        insights.push(
          `${dayNames[+bestDay[0]]}s are your strongest day (${bestRate}% goal rate) vs ${dayNames[+worstDay[0]]}s (${worstRate}%). Plan high-impact activities accordingly.`
        );
      }
    }

    // 2. Prospecting block → conversation correlation
    const withBlock = entries.filter(e => (e.prospecting_block_minutes || 0) >= 30);
    const withoutBlock = entries.filter(e => (e.prospecting_block_minutes || 0) < 30);
    if (withBlock.length >= 3 && withoutBlock.length >= 3) {
      const avgConvWith = withBlock.reduce((s, e) => s + (e.conversations || 0), 0) / withBlock.length;
      const avgConvWithout = withoutBlock.reduce((s, e) => s + (e.conversations || 0), 0) / withoutBlock.length;
      if (avgConvWith > avgConvWithout * 1.3) {
        const pctMore = Math.round(((avgConvWith - avgConvWithout) / avgConvWithout) * 100);
        insights.push(
          `Days with 30+ min prospecting blocks average ${pctMore}% more conversations (${avgConvWith.toFixed(1)} vs ${avgConvWithout.toFixed(1)}). Block time is working.`
        );
      }
    }

    // 3. WHOOP recovery → performance correlation
    if (Object.keys(whoopByDate).length >= 5) {
      const entriesWithWhoop = entries
        .filter(e => whoopByDate[e.date]?.recovery_score != null)
        .map(e => ({
          ...e,
          recovery: Number(whoopByDate[e.date].recovery_score),
        }));

      if (entriesWithWhoop.length >= 5) {
        const highRecovery = entriesWithWhoop.filter(e => e.recovery >= 60);
        const lowRecovery = entriesWithWhoop.filter(e => e.recovery < 50);

        if (highRecovery.length >= 2 && lowRecovery.length >= 2) {
          const highGoalRate = highRecovery.filter(e => e.goal_met).length / highRecovery.length;
          const lowGoalRate = lowRecovery.filter(e => e.goal_met).length / lowRecovery.length;

          if (highGoalRate > lowGoalRate + 0.2) {
            insights.push(
              `When WHOOP recovery is 60%+, your goal-met rate is ${Math.round(highGoalRate * 100)}% vs ${Math.round(lowGoalRate * 100)}% on low recovery days. Sleep quality directly impacts your output.`
            );
          }
        }
      }
    }

    // 4. Conversion rate trend
    const recentHalf = entries.slice(0, Math.floor(n / 2));
    const olderHalf = entries.slice(Math.floor(n / 2));
    const recentConvRate = recentHalf.reduce((s, e) => s + (e.conversations || 0), 0) / 
      Math.max(1, recentHalf.reduce((s, e) => s + (e.dials || 0), 0));
    const olderConvRate = olderHalf.reduce((s, e) => s + (e.conversations || 0), 0) / 
      Math.max(1, olderHalf.reduce((s, e) => s + (e.dials || 0), 0));

    if (Math.abs(recentConvRate - olderConvRate) > 0.02) {
      const direction = recentConvRate > olderConvRate ? 'improving' : 'declining';
      const pctChange = Math.abs(Math.round((recentConvRate - olderConvRate) * 100));
      insights.push(
        `Dial-to-conversation rate is ${direction} (${Math.round(recentConvRate * 100)}% recent vs ${Math.round(olderConvRate * 100)}% prior). ${direction === 'improving' ? 'Your opener improvements are paying off.' : 'Review your approach and messaging.'}`
      );
    }

    // 5. Sentiment correlation with performance
    const withSentiment = entries.filter(e => e.sentiment_score != null);
    if (withSentiment.length >= 5) {
      const positive = withSentiment.filter(e => Number(e.sentiment_score) > 0.3);
      const negative = withSentiment.filter(e => Number(e.sentiment_score) < -0.3);
      if (positive.length >= 2 && negative.length >= 2) {
        const posGoalRate = positive.filter(e => e.goal_met).length / positive.length;
        const negGoalRate = negative.filter(e => e.goal_met).length / negative.length;
        if (posGoalRate > negGoalRate + 0.2) {
          insights.push(
            `Positive mindset days correlate with ${Math.round(posGoalRate * 100)}% goal-met rate vs ${Math.round(negGoalRate * 100)}% on negative days. Mindset directly impacts output.`
          );
        }
      }
    }

    // Cap at 3 most impactful insights
    return new Response(
      JSON.stringify({ insights: insights.slice(0, 3) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("weekly-patterns error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
