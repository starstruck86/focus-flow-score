import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch accounts
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, name, tier, account_status, motion, icp_fit_score, timing_score, priority_score, last_touch_date, outreach_status, next_step, tags, trigger_events, high_probability_buyer, triggered_account, lifecycle_tier")
      .eq("user_id", user.id)
      .not("account_status", "eq", "disqualified")
      .limit(100);

    // Fetch open opps
    const { data: opps } = await supabase
      .from("opportunities")
      .select("id, name, account_id, stage, arr, close_date, next_step, last_touch_date, status, deal_type")
      .eq("user_id", user.id)
      .in("status", ["active", "stalled"])
      .limit(100);

    // Fetch upcoming renewals (next 90 days)
    const { data: renewals } = await supabase
      .from("renewals")
      .select("id, account_name, account_id, arr, renewal_due, churn_risk, health_status, next_step, renewal_stage")
      .eq("user_id", user.id)
      .gte("renewal_due", new Date().toISOString().slice(0, 10))
      .limit(50);

    // Fetch today's calendar
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 2);
    const { data: events } = await supabase
      .from("calendar_events")
      .select("title, start_time")
      .eq("user_id", user.id)
      .gte("start_time", today.toISOString())
      .lte("start_time", tomorrow.toISOString());

    const contextLines: string[] = [];
    (accounts || []).forEach((a: any) => {
      const parts = [a.name];
      if (a.tier) parts.push(`Tier:${a.tier}`);
      if (a.account_status) parts.push(`Status:${a.account_status}`);
      if (a.last_touch_date) parts.push(`LastTouch:${a.last_touch_date}`);
      if (a.icp_fit_score) parts.push(`ICP:${a.icp_fit_score}`);
      if (a.timing_score) parts.push(`Timing:${a.timing_score}`);
      if (a.triggered_account) parts.push("TRIGGERED");
      if (a.high_probability_buyer) parts.push("HPB");
      if (a.trigger_events?.length) parts.push(`Triggers:${a.trigger_events.length}`);
      contextLines.push(parts.join(" | "));
    });

    const oppLines = (opps || []).map((o: any) => 
      `${o.name} | Acct:${(accounts || []).find((a: any) => a.id === o.account_id)?.name || '?'} | Stage:${o.stage || '?'} | ARR:$${o.arr || 0} | Close:${o.close_date || '?'} | Status:${o.status} | LastTouch:${o.last_touch_date || 'never'}`
    );

    const renewalLines = (renewals || []).map((r: any) =>
      `${r.account_name} | ARR:$${r.arr} | Due:${r.renewal_due} | Risk:${r.churn_risk || 'low'} | Health:${r.health_status || '?'}`
    );

    const meetingLines = (events || []).map((e: any) => `${e.title} at ${e.start_time}`);

    const todayStr = today.toISOString().slice(0, 10);
    const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a strategic sales prioritization AI. Today is ${dayOfWeek}, ${todayStr}. Analyze the user's territory data and recommend the top 5 accounts to focus on TODAY. Consider: upcoming meetings, deal momentum, staleness, trigger events, ICP fit, renewal urgency, and pipeline gaps. Use the recommend_focus function.`
          },
          {
            role: "user",
            content: `Here's my territory data:

ACCOUNTS (${contextLines.length}):
${contextLines.join("\n")}

OPEN OPPORTUNITIES (${oppLines.length}):
${oppLines.join("\n")}

UPCOMING RENEWALS (${renewalLines.length}):
${renewalLines.join("\n")}

TODAY'S MEETINGS:
${meetingLines.length > 0 ? meetingLines.join("\n") : "None scheduled"}

Which 5 accounts should I focus on today and why? What specific action should I take for each?`
          }
        ],
        tools: [{
          type: "function",
          function: {
            name: "recommend_focus",
            description: "Recommend top 5 accounts to focus on today",
            parameters: {
              type: "object",
              properties: {
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      account_id: { type: "string" },
                      account_name: { type: "string" },
                      reason: { type: "string", description: "One sentence why this account is priority today" },
                      action: { type: "string", description: "Specific action to take right now" },
                      urgency: { type: "string", enum: ["critical", "high", "medium"] },
                      arr_context: { type: "string", description: "Brief ARR or pipeline context" }
                    },
                    required: ["account_name", "reason", "action", "urgency"],
                    additionalProperties: false
                  }
                },
                morning_insight: { type: "string", description: "One-sentence strategic insight for the day" }
              },
              required: ["recommendations", "morning_insight"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "recommend_focus" } }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      return new Response(JSON.stringify({ recommendations: [], morning_insight: "No data available" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("prioritize-accounts error:", error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
