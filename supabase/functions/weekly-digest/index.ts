import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trace-id",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate the requesting user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = claimsData.claims.sub as string;

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
      .eq("user_id", userId)
      .gte("date", lastMondayStr)
      .lt("date", todayStr);

    if (entriesError) throw entriesError;

    // Compute stats for the authenticated user
    const stats = {
      totalDials: 0, totalConversations: 0, totalMeetingsSet: 0,
      totalOppsCreated: 0, avgScore: 0, goalMetDays: 0, workDays: 0,
    };

    for (const entry of entries || []) {
      stats.totalDials += entry.dials || 0;
      stats.totalConversations += entry.conversations || 0;
      stats.totalMeetingsSet += entry.meetings_set || 0;
      stats.totalOppsCreated += entry.opportunities_created || 0;
      stats.avgScore += entry.daily_score || 0;
      stats.goalMetDays += entry.goal_met ? 1 : 0;
      stats.workDays += 1;
    }

    // Get upcoming renewals for the authenticated user
    const nextFriday = new Date();
    nextFriday.setDate(nextFriday.getDate() + 12);
    const nextFridayStr = nextFriday.toISOString().slice(0, 10);

    const { data: renewals } = await supabase
      .from("renewals")
      .select("account_name, arr, renewal_due, churn_risk")
      .eq("user_id", userId)
      .gte("renewal_due", todayStr)
      .lte("renewal_due", nextFridayStr)
      .order("renewal_due", { ascending: true });

    const avgScore = stats.workDays > 0 ? (stats.avgScore / stats.workDays).toFixed(1) : '0';

    return new Response(
      JSON.stringify({
        success: true,
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
        upcomingRenewals: (renewals || []).map(r => ({
          account: r.account_name,
          arr: r.arr,
          dueDate: r.renewal_due,
          risk: r.churn_risk,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
