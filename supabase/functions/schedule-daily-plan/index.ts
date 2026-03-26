import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Use service role to list users who have daily_plan_preferences (opted in)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Find users who have plan preferences (active users of the Daily Game Plan)
    const { data: prefUsers, error: prefError } = await adminClient
      .from("daily_plan_preferences")
      .select("user_id");

    if (prefError) throw prefError;
    if (!prefUsers?.length) {
      return new Response(JSON.stringify({ message: "No users with plan preferences", generated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get today's date in ET
    const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

    const results: { user_id: string; status: string; error?: string }[] = [];

    for (const { user_id } of prefUsers) {
      // Check if plan already exists for today
      const { data: existing } = await adminClient
        .from("daily_time_blocks")
        .select("id, updated_at")
        .eq("user_id", user_id)
        .eq("plan_date", etDate)
        .maybeSingle();

      // Skip if plan was already generated today (within last 2 hours) to avoid redundant AI calls
      if (existing) {
        const updatedAt = new Date(existing.updated_at).getTime();
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        if (updatedAt > twoHoursAgo) {
          results.push({ user_id, status: "skipped", error: "Plan already fresh" });
          continue;
        }
      }

      // Call generate-time-blocks on behalf of this user using their session
      // We use service role to impersonate — the generate function uses auth header
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/generate-time-blocks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
            "x-supabase-user-id": user_id,
          },
          body: JSON.stringify({ date: etDate }),
        });

        if (response.ok) {
          results.push({ user_id, status: "generated" });
        } else {
          const errBody = await response.text();
          results.push({ user_id, status: "failed", error: errBody.slice(0, 200) });
        }
      } catch (e) {
        results.push({ user_id, status: "failed", error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ date: etDate, results, generated: results.filter(r => r.status === "generated").length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("schedule-daily-plan error:", e);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
