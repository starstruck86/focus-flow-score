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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get last 7 journal entries
    const { data: entries } = await supabase
      .from("daily_journal_entries")
      .select(
        "date, dials, conversations, prospects_added, meetings_set, customer_meetings_held, opportunities_created, prospecting_block_minutes, account_deep_work_minutes, daily_score, goal_met, pipeline_moved, biggest_blocker, sentiment_label"
      )
      .eq("user_id", user.id)
      .eq("checked_in", true)
      .order("date", { ascending: false })
      .limit(7);

    // Get quota targets
    const { data: targets } = await supabase
      .from("quota_targets")
      .select(
        "target_dials_per_day, target_connects_per_day, target_meetings_set_per_week, target_opps_created_per_week, target_customer_meetings_per_week"
      )
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!entries || entries.length === 0) {
      return new Response(
        JSON.stringify({
          nudge: "Welcome! Complete your first daily scorecard to start getting personalized insights.",
          type: "welcome",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dailyTargets = {
      dials: parseFloat(targets?.target_dials_per_day ?? "60"),
      conversations: parseFloat(targets?.target_connects_per_day ?? "6"),
      meetingsSetPerDay:
        parseFloat(targets?.target_meetings_set_per_week ?? "3") / 5,
      oppsCreatedPerDay:
        parseFloat(targets?.target_opps_created_per_week ?? "1") / 5,
      customerMeetingsPerDay:
        parseFloat(targets?.target_customer_meetings_per_week ?? "8") / 5,
    };

    // Calculate averages and find gaps
    const n = entries.length;
    const avgs = {
      dials: entries.reduce((s, e) => s + (e.dials || 0), 0) / n,
      conversations:
        entries.reduce((s, e) => s + (e.conversations || 0), 0) / n,
      meetingsSet:
        entries.reduce((s, e) => s + (e.meetings_set || 0), 0) / n,
      oppsCreated:
        entries.reduce((s, e) => s + (e.opportunities_created || 0), 0) / n,
      customerMeetings:
        entries.reduce((s, e) => s + (e.customer_meetings_held || 0), 0) / n,
      prospectingMin:
        entries.reduce(
          (s, e) => s + (e.prospecting_block_minutes || 0),
          0
        ) / n,
    };

    // Find the biggest gap (% below target)
    const gaps = [
      {
        metric: "dials",
        label: "Dials",
        avg: avgs.dials,
        target: dailyTargets.dials,
        gap: (dailyTargets.dials - avgs.dials) / dailyTargets.dials,
      },
      {
        metric: "conversations",
        label: "Conversations",
        avg: avgs.conversations,
        target: dailyTargets.conversations,
        gap:
          (dailyTargets.conversations - avgs.conversations) /
          dailyTargets.conversations,
      },
      {
        metric: "meetingsSet",
        label: "Meetings Set",
        avg: avgs.meetingsSet,
        target: dailyTargets.meetingsSetPerDay,
        gap:
          dailyTargets.meetingsSetPerDay > 0
            ? (dailyTargets.meetingsSetPerDay - avgs.meetingsSet) /
              dailyTargets.meetingsSetPerDay
            : 0,
      },
      {
        metric: "customerMeetings",
        label: "Customer Meetings",
        avg: avgs.customerMeetings,
        target: dailyTargets.customerMeetingsPerDay,
        gap:
          dailyTargets.customerMeetingsPerDay > 0
            ? (dailyTargets.customerMeetingsPerDay - avgs.customerMeetings) /
              dailyTargets.customerMeetingsPerDay
            : 0,
      },
    ];

    // Sort by gap descending
    gaps.sort((a, b) => b.gap - a.gap);

    // Check streaks
    const goalMetCount = entries.filter((e) => e.goal_met).length;
    const consecutiveGoalsMet = entries.findIndex((e) => !e.goal_met);
    const streak =
      consecutiveGoalsMet === -1 ? entries.length : consecutiveGoalsMet;

    // Check blocker patterns
    const blockerCounts: Record<string, number> = {};
    entries.forEach((e) => {
      if (e.biggest_blocker) {
        blockerCounts[e.biggest_blocker] =
          (blockerCounts[e.biggest_blocker] || 0) + 1;
      }
    });
    const topBlocker = Object.entries(blockerCounts).sort(
      (a, b) => b[1] - a[1]
    )[0];

    // Check prospecting block pattern
    const daysWithProspecting = entries.filter(
      (e) => (e.prospecting_block_minutes || 0) > 0
    ).length;

    // Check sentiment trend
    const sentiments = entries
      .filter((e) => e.sentiment_label)
      .map((e) => e.sentiment_label);
    const negativeCount = sentiments.filter(
      (s) => s === "negative" || s === "very_negative"
    ).length;

    // Generate nudge based on priority
    let nudge = "";
    let type = "insight";

    if (streak >= 5) {
      // Positive reinforcement
      nudge = `🔥 ${streak}-day streak of hitting your goals! You're averaging ${Math.round(avgs.dials)} dials/day. Keep this momentum.`;
      type = "streak";
    } else if (gaps[0] && gaps[0].gap > 0.25) {
      // Biggest gap
      const g = gaps[0];
      const needed = Math.ceil(g.target);
      const avgRounded = Math.round(g.avg * 10) / 10;
      const daysBelow = entries.filter((e: any) => {
        const val =
          g.metric === "dials"
            ? e.dials
            : g.metric === "conversations"
            ? e.conversations
            : g.metric === "meetingsSet"
            ? e.meetings_set
            : e.customer_meetings_held;
        return (val || 0) < g.target;
      }).length;
      nudge = `${g.label} are ${Math.round(g.gap * 100)}% below target (avg ${avgRounded} vs ${needed}/day). You missed this target ${daysBelow} of the last ${n} days. Make this your #1 focus today.`;
      type = "gap";
    } else if (
      daysWithProspecting < Math.ceil(n * 0.5) &&
      avgs.prospectingMin < 30
    ) {
      nudge = `You only ran a prospecting block ${daysWithProspecting} of the last ${n} days (avg ${Math.round(avgs.prospectingMin)}min). Block 60min today — reps with prospecting blocks average 40% more conversations.`;
      type = "behavior";
    } else if (topBlocker && topBlocker[1] >= 3) {
      const blockerLabel = topBlocker[0].replace(/_/g, " ");
      nudge = `"${blockerLabel}" has been your top blocker ${topBlocker[1]} of the last ${n} days. Time to address the root cause — consider a different approach.`;
      type = "blocker";
    } else if (negativeCount >= Math.ceil(n * 0.5)) {
      nudge = `Your reflections have been trending negative (${negativeCount}/${sentiments.length} days). Check what's changed and consider adjusting your approach or talking to your manager.`;
      type = "sentiment";
    } else if (goalMetCount >= Math.ceil(n * 0.7)) {
      nudge = `Strong week — you hit your goal ${goalMetCount}/${n} days. Your conversation rate is ${avgs.conversations > 0 && avgs.dials > 0 ? Math.round((avgs.conversations / avgs.dials) * 100) : 0}%. Keep pushing.`;
      type = "positive";
    } else {
      // Conversion insight
      const convRate =
        avgs.dials > 0
          ? Math.round((avgs.conversations / avgs.dials) * 100)
          : 0;
      nudge = `Your dial-to-conversation rate is ${convRate}%. ${convRate < 10 ? "Focus on opener quality — even a 2% improvement at your volume means 1+ extra conversation/day." : "Solid conversion. Focus on increasing volume to hit targets."}`;
      type = "conversion";
    }

    // Get yesterday's commitment if any
    const { data: yesterdayEntry } = await supabase
      .from("daily_journal_entries")
      .select("tomorrow_priority, date")
      .eq("user_id", user.id)
      .eq("checked_in", true)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        nudge,
        type,
        yesterdayCommitment: yesterdayEntry?.tomorrow_priority || null,
        yesterdayDate: yesterdayEntry?.date || null,
        stats: {
          streak,
          goalMetRate: Math.round((goalMetCount / n) * 100),
          topGap: gaps[0]?.metric || null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("journal-nudge error:", e);
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred. Please try again.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
