import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      // New command-center fields
      actionId,
      actionLabel,
      actionPrompt,
      contextText,
      resourceContext,
      // Legacy / shared fields
      outputType,
      accountName,
      stage,
      persona,
      competitor,
      tone,
      templateBody,
      customInstructions,
    } = body;

    // Build system prompt
    const systemParts: string[] = [
      "You are a senior sales execution assistant embedded in a deal preparation system.",
      "Your job is to produce high-quality, immediately usable sales deliverables.",
      "Be specific, actionable, and professional. Avoid generic filler.",
    ];

    // Build user prompt
    const parts: string[] = [];

    if (actionPrompt) {
      // New command-center path
      parts.push(actionPrompt);
    } else {
      // Legacy path
      const outputLabel = (outputType || "custom").replace(/_/g, " ");
      parts.push(`Generate a high-quality ${outputLabel}.`);
    }

    if (accountName) parts.push(`\nAccount: ${accountName}`);
    if (stage) parts.push(`Deal stage: ${stage}`);
    if (persona) parts.push(`Target persona: ${persona}`);
    if (competitor) parts.push(`Competitor context: ${competitor}`);
    if (tone) parts.push(`Tone: ${tone}`);

    if (contextText) {
      parts.push(
        `\n--- USER-PROVIDED CONTEXT ---\n${contextText}\n--- END CONTEXT ---`
      );
    }

    if (resourceContext) {
      parts.push(
        `\n--- RELEVANT RESOURCES FROM USER'S LIBRARY ---\n${resourceContext}\n--- END RESOURCES ---\nUse these resources to ground your output in the user's actual methodology and language.`
      );
    }

    if (templateBody) {
      parts.push(
        `\nUse this template as the structural base — follow its format, sections, and style:\n---\n${templateBody}\n---`
      );
    }

    if (customInstructions) {
      parts.push(`\nAdditional instructions: ${customInstructions}`);
    }

    parts.push(
      `\nReturn ONLY the generated content. If it's an email, start with "Subject: <subject line>" on the first line, then a blank line, then the body.`
    );

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "Missing API key" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemParts.join(" ") },
            { role: "user", content: parts.join("\n") },
          ],
          temperature: 0.7,
          max_tokens: 3000,
        }),
      }
    );

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI API error:", aiResp.status, errText);

      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "AI generation failed" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // Parse subject line if present
    let subjectLine = "";
    let content = rawContent;
    const subjectMatch = rawContent.match(/^Subject:\s*(.+)\n/i);
    if (subjectMatch) {
      subjectLine = subjectMatch[1].trim();
      content = rawContent.slice(subjectMatch[0].length).trim();
    }

    const sources: string[] = [];
    if (resourceContext) sources.push("Your resources & knowledge");
    if (contextText) sources.push("Your uploaded context");
    if (templateBody) sources.push("Template base");
    sources.push("AI generation");

    return new Response(
      JSON.stringify({ content, subject_line: subjectLine, sources }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
