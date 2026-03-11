import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all users who have journal entries (active users)
    const lastMonday = new Date();
    lastMonday.setDate(lastMonday.getDate() - 7);
    const lastMondayStr = lastMonday.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    // Fetch last week's journal entries grouped by user
    const { data: entries, error: entriesError } = await supabase
      .from("daily_journal_entries")
      .select("user_id, dials, conversations, meetings_set, opportunities_created, daily_score, goal_met")
      .gte("date", lastMondayStr)
      .lt("date", todayStr);

    if (entriesError) throw entriesError;

    // Group by user
    const userStats = new Map<string, {
      totalDials: number;
      totalConversations: number;
      totalMeetingsSet: number;
      totalOppsCreated: number;
      avgScore: number;
      goalMetDays: number;
      workDays: number;
    }>();

    for (const entry of entries || []) {
      if (!entry.user_id) continue;
      const existing = userStats.get(entry.user_id) || {
        totalDials: 0, totalConversations: 0, totalMeetingsSet: 0,
        totalOppsCreated: 0, avgScore: 0, goalMetDays: 0, workDays: 0,
      };
      existing.totalDials += entry.dials || 0;
      existing.totalConversations += entry.conversations || 0;
      existing.totalMeetingsSet += entry.meetings_set || 0;
      existing.totalOppsCreated += entry.opportunities_created || 0;
      existing.avgScore += entry.daily_score || 0;
      existing.goalMetDays += entry.goal_met ? 1 : 0;
      existing.workDays += 1;
      userStats.set(entry.user_id, existing);
    }

    // Get upcoming renewals for each user
    const nextFriday = new Date();
    nextFriday.setDate(nextFriday.getDate() + 12); // ~2 weeks out
    const nextFridayStr = nextFriday.toISOString().slice(0, 10);

    const { data: renewals } = await supabase
      .from("renewals")
      .select("user_id, account_name, arr, renewal_due, churn_risk")
      .gte("renewal_due", todayStr)
      .lte("renewal_due", nextFridayStr)
      .order("renewal_due", { ascending: true });

    const userRenewals = new Map<string, typeof renewals>();
    for (const r of renewals || []) {
      const existing = userRenewals.get(r.user_id) || [];
      existing.push(r);
      userRenewals.set(r.user_id, existing);
    }

    // Generate digest data per user (could be emailed or stored)
    const digests = [];
    for (const [userId, stats] of userStats) {
      const avgScore = stats.workDays > 0 ? (stats.avgScore / stats.workDays).toFixed(1) : '0';
      const upcomingRenewals = userRenewals.get(userId) || [];

      digests.push({
        userId,
        weekOf: lastMondayStr,
        summary: {
          workDays: stats.workDays,
          totalDials: stats.totalDials,
          totalConversations: stats.totalConversations,
          totalMeetingsSet: stats.totalMeetingsSet,
          totalOppsCreated: stats.totalOppsCreated,
          avgDailyScore: avgScore,
          goalMetDays: stats.goalMetDays,
        },
        upcomingRenewals: upcomingRenewals.map(r => ({
          account: r.account_name,
          arr: r.arr,
          dueDate: r.renewal_due,
          risk: r.churn_risk,
        })),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        digestCount: digests.length,
        digests,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
