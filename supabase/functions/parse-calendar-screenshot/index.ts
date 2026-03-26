import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { imageBase64, date } = await req.json();
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const targetDate = date || new Date().toISOString().split("T")[0];

    const response = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a calendar event extraction assistant for a sales professional. Extract ALL events visible in the calendar screenshot for the date ${targetDate}.

IMPORTANT RULES:
1. Extract EVERY event visible, including meetings, personal commitments, all-day events
2. Classify each event as "work" or "personal"
3. Personal events include: school drop-off, bus drop-off, child pick-up, after-school activities, doctor appointments, family commitments, lunch breaks, gym, etc.
4. Look for names of children or family members mentioned in events
5. All times should be in 24h HH:MM format in Eastern Time
6. If you see recurring meeting indicators, still extract the specific instance
7. Be thorough — missing a meeting throws off the entire day plan`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract all calendar events for ${targetDate} from this screenshot. Include work meetings AND personal/family commitments. For each event, identify the title, start time, end time, whether it's work or personal, and any notes about children (Quinn, Emmett) or family logistics.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${imageBase64}` },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_calendar_events",
              description: "Extract calendar events from a screenshot",
              parameters: {
                type: "object",
                properties: {
                  events: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Event title as shown" },
                        start_time: { type: "string", description: "HH:MM in 24h EST" },
                        end_time: { type: "string", description: "HH:MM in 24h EST" },
                        category: {
                          type: "string",
                          enum: ["work_meeting", "personal", "all_day"],
                          description: "Event category",
                        },
                        is_personal_block: {
                          type: "boolean",
                          description: "True if this is a personal/family commitment that blocks work time",
                        },
                        family_member: {
                          type: "string",
                          description: "Name of child or family member if relevant (Quinn, Emmett, etc.)",
                        },
                        notes: {
                          type: "string",
                          description: "Any additional context about the event",
                        },
                      },
                      required: ["title", "start_time", "end_time", "category", "is_personal_block"],
                      additionalProperties: false,
                    },
                  },
                  date_detected: {
                    type: "string",
                    description: "The date shown in the calendar screenshot (YYYY-MM-DD)",
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description: "How confident you are in the extraction",
                  },
                },
                required: ["events", "date_detected", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_calendar_events" } },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI Gateway error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `AI processing failed: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ error: "No structured response from AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = JSON.parse(toolCall.function.arguments);
    console.log(`Extracted ${result.events?.length || 0} events, confidence: ${result.confidence}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-calendar-screenshot error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
