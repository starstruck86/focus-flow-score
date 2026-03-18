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

    const { transcript, conversationHistory, sessionId } = await req.json();
    if (!transcript) {
      return new Response(JSON.stringify({ error: "No transcript provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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

    // Build conversation context section
    const conversationSection = conversationHistory
      ? `\n## CONVERSATION HISTORY (multi-turn session ${sessionId || 'unknown'})\nThe user has been speaking with you. Here is the recent conversation:\n${conversationHistory}\n\nUse this context to understand follow-up questions, resolve pronouns ("it", "that", "them"), and maintain continuity. If the user says something like "do that" or "yes" or "the first one", refer to the previous exchange.\n`
      : '';

    const systemPrompt = `You are Dave — a concise, directive, context-aware voice AI operator embedded in a sales execution platform. You are NOT verbose. You are NOT an assistant. You are an operator.

The user just gave you a voice command. Interpret their intent and return a structured JSON response.

## CRITICAL BEHAVIOR: ASK BEFORE ACTING
When ambiguous, incomplete, or could be interpreted multiple ways, use the "clarify" action. Keep clarifying questions to ONE short sentence.
${conversationSection}
## AVAILABLE ACTIONS

1. "open_copilot" — AI question or analysis
   { "action": "open_copilot", "question": "<question>", "mode": "quick|deep|meeting|deal-strategy|recap-email", "dave_response": "<brief spoken confirmation>" }

2. "create_task" — Create a task (only when specifics are clear)
   { "action": "create_task", "title": "<title>", "priority": "p0|p1|p2|p3", "accountName": "<optional>", "dave_response": "<brief confirmation>" }

3. "navigate" — Go somewhere in the app
   { "action": "navigate", "path": "/|/tasks|/quota|/coach|/trends|/settings|/renewals|/outreach|/prep", "dave_response": "<brief confirmation>" }

4. "log_activity" — Log dials, emails, meetings
   { "action": "log_activity", "type": "quick_log", "dave_response": "<brief confirmation>" }

5. "start_roleplay" — Launch the sales roleplay simulator
   { "action": "start_roleplay", "call_type": "discovery|demo|negotiation|cold_call", "difficulty": 1-4, "industry": "<optional>", "dave_response": "<brief confirmation>" }

6. "start_drill" — Launch objection handling drills
   { "action": "start_drill", "dave_response": "<brief confirmation>" }

7. "prep_meeting" — Prepare for an upcoming meeting (auto-detects next meeting if unspecified)
   { "action": "prep_meeting", "accountName": "<optional>", "meetingTitle": "<optional>", "dave_response": "<brief confirmation>" }

8. "update_account" — Update an account field
   { "action": "update_account", "accountName": "<name>", "field": "next_step|notes|tier|priority|outreach_status", "value": "<new value>", "dave_response": "<brief confirmation>" }

9. "grade_call" — Trigger analysis of the latest ungraded transcript
   { "action": "grade_call", "dave_response": "<brief confirmation>" }

10. "show_methodology" — Open MEDDICC/CotM tracker for an opportunity
    { "action": "show_methodology", "accountName": "<optional>", "opportunityName": "<optional>", "dave_response": "<brief confirmation>" }

11. "daily_briefing" — Walk through today's plan, priorities, and risks
    { "action": "daily_briefing", "dave_response": "<brief confirmation>" }

12. "clarify" — Need more info (MUST include dave_response for TTS)
    { "action": "clarify", "question": "<your question>", "original_intent": "<what you think they meant>", "dave_response": "<the clarifying question to speak>" }

13. "unknown" — Can't determine intent
    { "action": "unknown", "suggestion": "<helpful suggestion>", "dave_response": "<spoken suggestion>" }

## CONTEXT
Upcoming meetings: ${JSON.stringify(calendarRes.data || [])}
Recent accounts: ${JSON.stringify((accountsRes.data || []).map(a => ({ name: a.name, tier: a.tier })))}
Current time: ${new Date().toLocaleString()}

## RULES
- Match account names fuzzy (e.g. "acme" matches "Acme Corp")
- For meeting prep, detect which meeting from context
- For tasks, infer reasonable priority (default p2)
- PREFER "clarify" over guessing when vague
- Keep clarifying questions SHORT (1 sentence)
- Always include "dave_response" — a brief spoken confirmation (max 15 words)
- For multi-turn: resolve "it", "that", "yes" from conversation history
- Return ONLY valid JSON`;

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
                action: { type: "string", enum: ["open_copilot", "create_task", "navigate", "log_activity", "start_roleplay", "start_drill", "prep_meeting", "update_account", "grade_call", "show_methodology", "daily_briefing", "clarify", "unknown"] },
                question: { type: "string", description: "Question for copilot OR clarifying question" },
                original_intent: { type: "string", description: "What the user likely meant (for clarify action)" },
                mode: { type: "string", enum: ["quick", "deep", "meeting", "deal-strategy", "recap-email"] },
                title: { type: "string", description: "Task title" },
                priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
                accountName: { type: "string", description: "Account name if relevant" },
                opportunityName: { type: "string", description: "Opportunity name if relevant" },
                meetingTitle: { type: "string", description: "Meeting title if relevant" },
                path: { type: "string", description: "Navigation path" },
                type: { type: "string", description: "Activity type" },
                suggestion: { type: "string", description: "Suggestion for unknown commands" },
                call_type: { type: "string", enum: ["discovery", "demo", "negotiation", "cold_call"] },
                difficulty: { type: "number", description: "Roleplay difficulty 1-4" },
                industry: { type: "string", description: "Industry for roleplay" },
                field: { type: "string", description: "Account field to update" },
                value: { type: "string", description: "New value for the field" },
                dave_response: { type: "string", description: "Brief spoken confirmation for TTS (max 15 words)" },
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

    return new Response(JSON.stringify({ action: "unknown", suggestion: "I didn't understand that command.", dave_response: "Sorry, I didn't catch that." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("voice-command error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
