import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, filename, url, existingTitle, existingTags } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const contentHint = text?.slice(0, 3000) || "";
    const prompt = `Classify this sales resource.
${filename ? `Filename: ${filename}` : ""}
${url ? `URL: ${url}` : ""}
${existingTitle ? `Current title: ${existingTitle}` : ""}
${existingTags?.length ? `Current tags: ${existingTags.join(", ")}` : ""}

Content preview:
${contentHint}

Analyze the content and classify it appropriately. Suggest a clear, professional title, a short description, the best resource type, relevant tags, and the most logical folder name.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: "You are a sales resource classifier. Analyze content and return structured classification using the provided tool.",
          },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_resource",
              description: "Return structured classification for a sales resource",
              parameters: {
                type: "object",
                properties: {
                  title: {
                    type: "string",
                    description: "Clean, professional title. E.g. 'MEDDICC Framework - Deal Qualification Guide'",
                  },
                  description: {
                    type: "string",
                    description: "1-2 sentence summary of the resource content",
                  },
                  resource_type: {
                    type: "string",
                    enum: ["document", "playbook", "framework", "battlecard", "template", "training", "transcript", "presentation", "email"],
                    description: "Best matching resource type",
                  },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-8 relevant tags, lowercase, e.g. ['meddicc', 'deal-qualification', 'enterprise']",
                  },
                  suggested_folder: {
                    type: "string",
                    description: "Logical folder name, e.g. 'Frameworks', 'Training Courses', 'Battlecards', 'Templates'",
                  },
                },
                required: ["title", "description", "resource_type", "tags", "suggested_folder"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_resource" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      throw new Error("AI classification failed");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("No classification returned");
    }

    const classification = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

    return new Response(JSON.stringify(classification), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-resource error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Classification failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
