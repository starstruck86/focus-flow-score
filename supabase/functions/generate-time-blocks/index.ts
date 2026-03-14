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

    const { date } = await req.json();
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Gather context in parallel
    const [
      calendarRes,
      journalRes,
      workQueueRes,
      feedbackRes,
      quotaRes,
    ] = await Promise.all([
      supabase.from("calendar_events").select("*")
        .gte("start_time", `${targetDate}T00:00:00`)
        .lte("start_time", `${targetDate}T23:59:59`)
        .order("start_time"),
      supabase.from("daily_journal_entries").select("*")
        .eq("date", targetDate).maybeSingle(),
      // Get top accounts/opps/renewals for work items
      supabase.from("accounts").select("id, name, tier, account_status, last_touch_date, cadence_name, contact_status")
        .in("account_status", ["active", "prepped", "researching"])
        .order("priority_score", { ascending: false }).limit(15),
      // Last 7 days of time block feedback
      supabase.from("ai_feedback").select("*")
        .eq("feature", "time_blocks")
        .order("created_at", { ascending: false }).limit(10),
      supabase.from("quota_targets").select("*").maybeSingle(),
    ]);

    const events = calendarRes.data || [];
    const recentFeedback = feedbackRes.data || [];
    const topAccounts = workQueueRes.data || [];

    // Calculate meeting load
    const meetings = events.filter((e: any) => !e.all_day && e.end_time);
    const meetingMinutes = meetings.reduce((sum: number, e: any) => {
      const start = new Date(e.start_time).getTime();
      const end = new Date(e.end_time).getTime();
      return sum + Math.max(0, (end - start) / 60000);
    }, 0);
    const meetingHours = Math.round(meetingMinutes / 60 * 10) / 10;
    const focusHoursAvailable = Math.max(0, 8 - meetingHours);

    // Build feedback context
    const feedbackContext = recentFeedback.length > 0
      ? `\n\nRECENT USER FEEDBACK ON TIME BLOCKS (learn from this):\n${recentFeedback.map((f: any) =>
          `- Date: ${f.context_date}, Rating: ${f.rating}/5, Feedback: "${f.feedback_text}", Plan was: "${f.ai_suggestion_summary}"`
        ).join("\n")}`
      : "";

    // Build calendar context
    const calendarContext = meetings.length > 0
      ? meetings.map((e: any) => {
          const start = new Date(e.start_time);
          const end = e.end_time ? new Date(e.end_time) : null;
          const dur = end ? Math.round((end.getTime() - start.getTime()) / 60000) : 30;
          return `- ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}–${end?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) || "?"} (${dur}min): ${e.title}`;
        }).join("\n")
      : "No meetings scheduled today.";

    // Quota targets context
    const targets = quotaRes.data;
    const quotaContext = targets
      ? `Daily targets: ${targets.target_dials_per_day} dials, ${targets.target_connects_per_day} connects, ${targets.target_accounts_researched_per_day} accounts researched, ${targets.target_contacts_prepped_per_day} contacts prepped. Weekly: ${targets.target_meetings_set_per_week} meetings set, ${targets.target_opps_created_per_week} opps created, ${targets.target_customer_meetings_per_week} customer meetings.`
      : "Default targets: 60 dials/day, 6 connects/day, 3 accounts researched/day.";

    const prompt = `You are an elite sales time management coach for a B2B SaaS account executive. Your job is to create a realistic, high-impact daily schedule that maximizes their path to President's Club.

CRITICAL RULES:
1. NO time blocks shorter than 25 minutes. Minimum block is 25 min.
2. Group similar activities together to minimize context switching (e.g., all calls in one block, all research in another)
3. Goals must be REALISTIC and specific - not aspirational fantasies. If someone has 2 hours of meetings, don't expect 60 dials.
4. Account for energy patterns: deep work and prospecting in the morning, admin and lighter tasks in the afternoon
5. Include buffer time around meetings (5-10 min) for prep/debrief - don't create separate blocks for this, build it into meeting blocks
6. Every block needs a concrete, achievable goal that a human would read and think "yeah, I can do that"
7. If feedback says past suggestions were unrealistic, SIGNIFICANTLY dial back goals
8. Leave 30 min for daily journal/EOD wrap-up
9. Never schedule prospecting calls during lunch (12-1pm)
10. Build in at least one 15-min break mid-morning and mid-afternoon (these are breaks, not work blocks)

TODAY'S CALENDAR (EST):
${calendarContext}

MEETING LOAD: ${meetingHours}h of meetings, ${focusHoursAvailable}h available for focused work

${quotaContext}

TOP ACCOUNTS TO CONSIDER:
${topAccounts.slice(0, 8).map((a: any) => `- ${a.name} (Tier ${a.tier}, ${a.account_status})`).join("\n")}

${journalRes.data ? `TODAY'S JOURNAL SO FAR: ${journalRes.data.dials || 0} dials, ${journalRes.data.conversations || 0} conversations, ${journalRes.data.meetings_set || 0} meetings set` : "No journal entry yet today."}

${feedbackContext}

Generate a daily time-blocked schedule. For each block provide:
- start_time (HH:MM in 24h EST)
- end_time (HH:MM in 24h EST)
- label (short title, 3-5 words)
- type: one of "prospecting", "meeting", "research", "admin", "break", "pipeline", "prep"
- goals: array of 1-3 specific, realistic goals for that block
- reasoning: one sentence on why this block matters for P-Club

Also provide an overall "day_strategy" (2-3 sentences on the day's theme/approach) and "key_metric_targets" object with realistic targets for today given the meeting load.`;

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
          { role: "system", content: "You are a sales productivity coach. Return structured data via the tool call." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "create_daily_plan",
            description: "Create a daily time-blocked plan",
            parameters: {
              type: "object",
              properties: {
                day_strategy: { type: "string", description: "2-3 sentence overview of the day's approach" },
                blocks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      start_time: { type: "string", description: "HH:MM in 24h format" },
                      end_time: { type: "string", description: "HH:MM in 24h format" },
                      label: { type: "string" },
                      type: { type: "string", enum: ["prospecting", "meeting", "research", "admin", "break", "pipeline", "prep"] },
                      goals: { type: "array", items: { type: "string" } },
                      reasoning: { type: "string" },
                    },
                    required: ["start_time", "end_time", "label", "type", "goals", "reasoning"],
                    additionalProperties: false,
                  },
                },
                key_metric_targets: {
                  type: "object",
                  properties: {
                    dials: { type: "number" },
                    conversations: { type: "number" },
                    accounts_researched: { type: "number" },
                    contacts_prepped: { type: "number" },
                  },
                  additionalProperties: false,
                },
              },
              required: ["day_strategy", "blocks", "key_metric_targets"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_daily_plan" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const plan = JSON.parse(toolCall.function.arguments);

    // Upsert the plan with all data persisted
    const { data: saved, error: saveError } = await supabase
      .from("daily_time_blocks")
      .upsert({
        user_id: user.id,
        plan_date: targetDate,
        blocks: plan.blocks,
        meeting_load_hours: meetingHours,
        focus_hours_available: focusHoursAvailable,
        ai_reasoning: plan.day_strategy,
        key_metric_targets: plan.key_metric_targets || {},
        completed_goals: [],
        block_feedback: [],
      }, { onConflict: "user_id,plan_date" })
      .select()
      .single();

    if (saveError) throw saveError;

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-time-blocks error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
