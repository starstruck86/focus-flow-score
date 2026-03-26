import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reflection } = await req.json();

    if (!reflection || reflection.trim().length < 5) {
      return new Response(
        JSON.stringify({ sentiment_score: null, sentiment_label: "neutral" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            {
              role: "system",
              content: `You are a sentiment analysis tool for a sales professional's daily reflection. Analyze the text and return structured output using the provided tool.`,
            },
            {
              role: "user",
              content: reflection,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "analyze_sentiment",
                description:
                  "Analyze the sentiment of a sales professional's daily reflection.",
                parameters: {
                  type: "object",
                  properties: {
                    sentiment_score: {
                      type: "number",
                      description:
                        "Sentiment score from -1.0 (very negative/frustrated/burned out) to 1.0 (very positive/energized/confident). 0 is neutral.",
                    },
                    sentiment_label: {
                      type: "string",
                      enum: [
                        "very_negative",
                        "negative",
                        "neutral",
                        "positive",
                        "very_positive",
                      ],
                      description: "Categorical sentiment label.",
                    },
                  },
                  required: ["sentiment_score", "sentiment_label"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "analyze_sentiment" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited, please try again later." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      // Return neutral on AI failure rather than breaking the flow
      return new Response(
        JSON.stringify({ sentiment_score: 0, sentiment_label: "neutral" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const args = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(args), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ sentiment_score: 0, sentiment_label: "neutral" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("analyze-sentiment error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
