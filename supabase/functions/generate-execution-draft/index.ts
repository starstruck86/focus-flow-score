import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      outputType,
      accountName,
      stage,
      persona,
      competitor,
      tone,
      templateBody,
      customInstructions,
    } = body;

    const outputLabel = (outputType || "custom").replace(/_/g, " ");

    // Build the prompt
    const parts: string[] = [
      `You are a senior sales execution assistant. Generate a high-quality ${outputLabel}.`,
    ];

    if (accountName) parts.push(`Account: ${accountName}`);
    if (stage) parts.push(`Deal stage: ${stage}`);
    if (persona) parts.push(`Target persona: ${persona}`);
    if (competitor) parts.push(`Competitor context: ${competitor}`);
    if (tone) parts.push(`Tone: ${tone}`);

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

    const prompt = parts.join("\n");

    // Call Lovable AI
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "Missing API key" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResp = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI API error:", errText);
      return new Response(
        JSON.stringify({ error: "AI generation failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    if (templateBody) sources.push("User template");
    sources.push("AI generation (Gemini Flash)");

    return new Response(
      JSON.stringify({ content, subject_line: subjectLine, sources }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
