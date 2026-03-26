import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
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

    const { transcript_content, transcript_title, account_id, opportunity_id, renewal_id } = await req.json();

    if (!transcript_content) {
      return new Response(JSON.stringify({ error: "transcript_content is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);

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
            content: `You are a sales productivity assistant. Extract action items from call transcripts. Return structured tasks using the extract_tasks function. Each task should have a clear, actionable title starting with a verb. Set priority based on urgency: P0 for immediate/blocking items, P1 for this-week items, P2 for next-week items. Set due dates relative to today (${today}). Only extract genuine action items, not observations.`
          },
          {
            role: "user",
            content: `Extract action items from this call transcript titled "${transcript_title || 'Call'}":\n\n${transcript_content.slice(0, 8000)}`
          }
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_tasks",
            description: "Extract action items from a call transcript",
            parameters: {
              type: "object",
              properties: {
                tasks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Action item title starting with a verb" },
                      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
                      due_date: { type: "string", description: "ISO date string YYYY-MM-DD" },
                      notes: { type: "string", description: "Brief context from the transcript" },
                      category: { type: "string", enum: ["call", "manual-email", "meeting-prep", "proposal", "research", "admin"] }
                    },
                    required: ["title", "priority", "due_date"],
                    additionalProperties: false
                  }
                }
              },
              required: ["tasks"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "extract_tasks" } }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      return new Response(JSON.stringify({ tasks: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extracted = JSON.parse(toolCall.function.arguments);
    const tasks = (extracted.tasks || []).map((t: any) => ({
      ...t,
      account_id: account_id || null,
      opportunity_id: opportunity_id || null,
      renewal_id: renewal_id || null,
    }));

    return new Response(JSON.stringify({ tasks }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("extract-tasks error:", error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
