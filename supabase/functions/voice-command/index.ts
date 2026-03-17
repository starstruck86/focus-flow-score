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

    const { transcript } = await req.json();
    if (!transcript) {
      return new Response(JSON.stringify({ error: "No transcript provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch context: upcoming meetings, recent accounts
    const now = new Date().toISOString();
    const fourHoursLater = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    const [calendarRes, accountsRes] = await Promise.all([
      supabase.from("calendar_events")
        .select("title, start_time, end_time, description")
        .eq("user_id", user.id)
        .gte("start_time", now)
        .lte("start_time", fourHoursLater)
        .order("start_time")
        .limit(5),
      supabase.from("accounts")
        .select("id, name, tier, industry, next_step")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(20),
    ]);

    const systemPrompt = `You are a voice-activated sales assistant embedded in a CRM/coaching app. The user just gave you a voice command. Interpret their intent and return a structured JSON response.

## AVAILABLE ACTIONS
You can return ONE of these action types:

1. "open_copilot" — User wants to ask the AI copilot a question or get analysis
   { "action": "open_copilot", "question": "<the question to ask>", "mode": "quick|deep|meeting|deal-strategy|recap-email" }

2. "create_task" — User wants to create a task
   { "action": "create_task", "title": "<task title>", "priority": "p0|p1|p2|p3", "accountName": "<optional account name>" }

3. "meeting_prep" — User wants to prep for a meeting
   { "action": "open_copilot", "question": "Prep me for my meeting with <account/person>", "mode": "meeting" }

4. "navigate" — User wants to go somewhere in the app
   { "action": "navigate", "path": "/dashboard|/tasks|/quota|/coach|/trends|/settings|/renewals|/weekly-outreach" }

5. "log_activity" — User wants to log dials, emails, meetings etc
   { "action": "log_activity", "type": "quick_log" }

6. "unknown" — Can't determine intent
   { "action": "unknown", "suggestion": "<helpful suggestion>" }

## CONTEXT
Upcoming meetings: ${JSON.stringify(calendarRes.data || [])}
Recent accounts: ${JSON.stringify((accountsRes.data || []).map(a => ({ name: a.name, tier: a.tier })))}
Current time: ${new Date().toLocaleString()}

## RULES
- Match account names fuzzy (e.g. "acme" matches "Acme Corp")
- For meeting prep, detect which meeting they mean from context
- For tasks, infer a reasonable priority (default p2)
- Return ONLY valid JSON, no explanation`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
        tools: [{
          type: "function",
          function: {
            name: "execute_command",
            description: "Execute the interpreted voice command",
            parameters: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["open_copilot", "create_task", "navigate", "log_activity", "unknown"] },
                question: { type: "string", description: "Question for copilot" },
                mode: { type: "string", enum: ["quick", "deep", "meeting", "deal-strategy", "recap-email"] },
                title: { type: "string", description: "Task title" },
                priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
                accountName: { type: "string", description: "Account name if relevant" },
                path: { type: "string", description: "Navigation path" },
                type: { type: "string", description: "Activity type" },
                suggestion: { type: "string", description: "Suggestion for unknown commands" },
              },
              required: ["action"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "execute_command" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI command interpretation failed");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const command = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(command), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ action: "unknown", suggestion: "I didn't understand that command." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("voice-command error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
