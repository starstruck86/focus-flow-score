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
    const { type, prompt, outputType, resourceIds, accountContext, content, documentType, sourceResourceId, targetType, contentType } = await req.json();
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

    if (type === "transform") {
      // Transform a source resource into a new format
      // sourceResourceId and targetType already destructured from initial req.json()
      let sourceContent = "";
      if (sourceResourceId) {
        const { data: src } = await supabase
          .from("resources")
          .select("title, content, resource_type, tags")
          .eq("id", sourceResourceId)
          .single();
        if (src) sourceContent = `SOURCE: "${src.title}" (${src.resource_type})\n${src.content || "(empty)"}`;
      } else if (resourceIds?.length) {
        const { data: srcs } = await supabase
          .from("resources")
          .select("title, content, resource_type")
          .in("id", resourceIds);
        if (srcs?.length) {
          sourceContent = srcs.map((r: any) => `--- ${r.title} (${r.resource_type}) ---\n${r.content || "(empty)"}`).join("\n\n");
        }
      }

      const transformPrompts: Record<string, string> = {
        scorecard: "Transform this resource into a detailed scoring rubric/scorecard. Extract the SPECIFIC criteria, categories, and evaluation methods from THIS content. Create score levels (1-5) based on the actual framework described. Include what 'good' and 'bad' looks like for each criterion using examples from the source material. Format as a structured scorecard in Markdown with tables.",
        checklist: "Transform this resource into a practical pre-call or execution checklist. Extract the SPECIFIC steps, techniques, and frameworks from THIS content — not generic sales advice. Each item should reference a concept from the source material. Group by phase/stage. Include checkboxes (- [ ]) format.",
        cadence: "Transform this resource into a structured outreach cadence. Extract specific messaging themes, talk tracks, and techniques from THIS content. Define touchpoints by day, channel, and message theme using the actual frameworks described. Include suggested talk tracks or email snippets drawn from the source material.",
        training_guide: "Transform this resource into a training guide with exercises. Extract the KEY concepts, frameworks, and techniques from THIS content. Create practice scenarios that apply these specific concepts. Include self-assessment questions that test understanding of the actual material. Structure for a 30-60 minute self-study session.",
        one_pager: "Distill this resource into a crisp one-page reference sheet. Extract the MOST important frameworks, stats, and decision points from THIS content. Use dense formatting: key stats, decision trees, quick-reference tables. Optimize for printing or quick mobile reference.",
        template: "Extract the methodology, framework, or process from this content and create a reusable Markdown template. Include section headings from the source framework, {{placeholder}} variables for deal-specific data (e.g., {{company}}, {{pain_points}}, {{ROI_metrics}}, {{executive_sponsor}}), guidance notes explaining what to fill in each section, and example content drawn from the actual methodology. This should be a fill-in-the-blank document a rep can use immediately.",
      };

      systemPrompt = `You are a sales enablement architect. ${transformPrompts[targetType] || transformPrompts.checklist}\n\nIMPORTANT: Extract specific techniques, frameworks, and phrases from THIS content — not generic advice. Every bullet, criterion, or section should trace back to something in the source material.\n\nOutput clean Markdown. Be specific and actionable — no filler.`;
      userPrompt = sourceContent || prompt || "No source content provided.";
      if (prompt) userPrompt += `\n\nAdditional instructions: ${prompt}`;
      if (accountStr) userPrompt += accountStr;
    } else if (type === "generate") {
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
    } else if (type === "build-content") {
      // Full context content generation
      const contentTypePrompts: Record<string, string> = {
        business_case: "Create a compelling business case document. Include executive summary, current state challenges, proposed solution, ROI analysis, implementation timeline, and recommendation. Use specific data from the context provided.",
        roi_analysis: "Create a detailed ROI analysis. Include cost analysis, expected returns, payback period, TCO comparison, and risk-adjusted projections. Ground all numbers in the context provided.",
        executive_email: "Write a concise, high-impact executive email. Open with a strategic insight, connect to their business priorities, present a clear value proposition, and close with a specific CTA. Keep it under 200 words.",
        follow_up: "Write a professional follow-up email that references the previous conversation, summarizes key discussion points, confirms agreed next steps, and provides any promised resources. Keep tone warm but professional.",
        qbr: "Create a comprehensive QBR presentation outline. Include: performance metrics review, ROI delivered, adoption trends, success stories, strategic roadmap alignment, expansion opportunities, and recommended next steps.",
        proposal: "Create a professional proposal document. Include executive summary, understanding of requirements, proposed solution, pricing/packaging options, implementation plan, team/support, and terms.",
        custom: "Create professional content based on the instructions provided. Be specific, actionable, and grounded in the context data.",
      };
      systemPrompt = `You are an elite B2B sales content strategist. ${contentTypePrompts[contentType] || contentTypePrompts.custom}\n\nUse ALL context provided — account data, deal stage, MEDDICC insights, transcript summaries, and stakeholder map. Output clean, professional Markdown. Be specific, not generic.`;
      userPrompt = prompt || "Generate content based on the provided context.";
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
