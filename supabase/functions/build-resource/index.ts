import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type, prompt, outputType, resourceIds, accountContext, content, documentType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch resource content if IDs provided
    let resourceContext = "";
    if (resourceIds?.length) {
      const { data: resources } = await supabase
        .from("resources")
        .select("title, content, resource_type")
        .in("id", resourceIds);
      if (resources?.length) {
        resourceContext = resources
          .map((r: any) => `--- ${r.title} (${r.resource_type}) ---\n${r.content || "(empty)"}`)
          .join("\n\n");
      }
    }

    // Build account context string
    let accountStr = "";
    if (accountContext) {
      accountStr = `\nAccount Context:\n- Name: ${accountContext.name || "N/A"}\n- Industry: ${accountContext.industry || "N/A"}\n- Contacts: ${accountContext.contacts || "N/A"}\n- Deal Stage: ${accountContext.dealStage || "N/A"}\n`;
    }

    // Build system prompt based on type
    let systemPrompt = "";
    let userPrompt = "";

    if (type === "generate") {
      const typeInstructions: Record<string, string> = {
        document: "Create a professional, well-structured document with clear headings, bullet points, and actionable content.",
        email: "Write a professional sales email that is concise, personalized, and has a clear CTA.",
        presentation: "Create a presentation outline with clear slide titles (H1), section headers (H2), bullet points, and speaker notes.",
        prep: "Create a thorough meeting prep brief with research, talking points, objectives, and potential objections.",
        battlecard: "Create a competitive battlecard with positioning, objection handling, win themes, and landmines.",
      };
      systemPrompt = `You are an elite sales content creator. ${typeInstructions[outputType] || typeInstructions.document}\n\nOutput in clean Markdown format. Be specific and actionable — no filler.`;
      userPrompt = prompt;
      if (resourceContext) userPrompt += `\n\nReference Materials:\n${resourceContext}`;
      if (accountStr) userPrompt += accountStr;
    } else if (type === "inline") {
      const commands: Record<string, string> = {
        expand: "Expand this text with more detail, examples, and supporting points. Keep the same tone.",
        summarize: "Summarize this text into a concise, scannable format with key takeaways.",
        rewrite: "Rewrite this text to be more professional, clear, and impactful.",
        bullet: "Convert this text into clean, actionable bullet points.",
        email: "Transform this text into a professional email format with subject line, greeting, body, and CTA.",
        objection: "Rewrite this as an objection handling response with acknowledge, reframe, and redirect.",
      };
      const cmd = prompt?.split(" ")[0]?.replace("/", "") || "rewrite";
      systemPrompt = `You are a sales writing assistant. ${commands[cmd] || commands.rewrite}\n\nReturn ONLY the improved text in Markdown. No preamble.`;
      userPrompt = content || prompt;
    } else if (type === "merge") {
      systemPrompt = "You are a document architect. Merge the following resources into a single, cohesive document. Deduplicate content, organize logically with clear headings, and ensure a consistent tone. Output clean Markdown.";
      userPrompt = resourceContext || "No resources provided.";
      if (accountStr) userPrompt += accountStr;
    } else if (type === "suggest") {
      // Use tool calling for structured output
      const body = {
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a sales document analyst. Analyze the provided ${documentType || "document"} and suggest improvements. Consider: missing sections, weak points, opportunities to add data/specifics, better structure, stronger CTAs.`,
          },
          { role: "user", content: content || "No content provided." },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_suggestions",
              description: "Return structured suggestions for improving the document.",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Short suggestion title" },
                        description: { type: "string", description: "Detailed explanation of the suggestion" },
                        category: { type: "string", enum: ["missing_section", "improvement", "structure", "cta", "data"] },
                        priority: { type: "string", enum: ["high", "medium", "low"] },
                        example_text: { type: "string", description: "Optional example text to add" },
                      },
                      required: ["title", "description", "category", "priority"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["suggestions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "provide_suggestions" } },
      };

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!aiResp.ok) {
        const status = aiResp.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited — try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted — add funds in Settings > Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI gateway error: ${status}`);
      }

      const result = await aiResp.json();
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      const suggestions = toolCall ? JSON.parse(toolCall.function.arguments) : { suggestions: [] };

      return new Response(JSON.stringify(suggestions), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Streaming response for generate/inline/merge
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limited — try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted — add funds in Settings > Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      throw new Error(`AI gateway error: ${status}`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("build-resource error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
