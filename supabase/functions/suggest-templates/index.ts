import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    // Fetch recent non-template resources (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentResources } = await supabase
      .from("resources")
      .select("id, title, content, resource_type, tags, description")
      .eq("user_id", user.id)
      .or("is_template.is.null,is_template.eq.false")
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    if (!recentResources?.length) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch existing templates to avoid duplicates
    const { data: existingTemplates } = await supabase
      .from("resources")
      .select("title, template_category")
      .eq("user_id", user.id)
      .eq("is_template", true);

    // Fetch dismissed suggestions
    const { data: dismissedSuggestions } = await supabase
      .from("template_suggestions")
      .select("title")
      .eq("user_id", user.id)
      .eq("status", "dismissed");

    const existingTitles = (existingTemplates || []).map(t => t.title.toLowerCase());
    const dismissedTitles = (dismissedSuggestions || []).map(s => s.title.toLowerCase());

    const resourceSummary = recentResources.map(r =>
      `- "${r.title}" (${r.resource_type}): ${r.description || r.content?.slice(0, 200) || "No content"}`
    ).join("\n");

    const existingTemplateList = existingTitles.length
      ? `\nExisting templates (DO NOT suggest duplicates):\n${existingTitles.join(", ")}`
      : "";

    const prompt = `Analyze these recent sales resources and identify up to 3 template opportunities — actionable, reusable templates the user should create based on what they're learning/collecting.

Recent resources:
${resourceSummary}
${existingTemplateList}

For each suggestion:
- Link it to a specific source resource by title
- Suggest a template_category from: Follow-Up, Cadences, Emails, Meeting Prep, Proposals, Presentations, Discovery, Deal Progression, Re-Engagement
- Provide a brief suggested_content outline with {{variable}} placeholders

Only suggest templates that would be genuinely useful and actionable. Max 3 suggestions.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a sales productivity assistant. Analyze resources and suggest useful template opportunities." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_templates",
            description: "Return template suggestions based on resource analysis",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Template title" },
                      description: { type: "string", description: "Why this template would be useful" },
                      template_category: { type: "string", description: "Category" },
                      source_resource_title: { type: "string", description: "Title of the source resource this is based on" },
                      suggested_content: { type: "string", description: "Template content outline with {{variable}} placeholders" },
                    },
                    required: ["title", "description", "template_category", "source_resource_title", "suggested_content"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_templates" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI suggestion failed");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No suggestions returned");

    const parsed = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

    const suggestions = (parsed.suggestions || [])
      .filter((s: any) =>
        !existingTitles.includes(s.title.toLowerCase()) &&
        !dismissedTitles.includes(s.title.toLowerCase())
      )
      .slice(0, 3);

    // Clear old active suggestions and insert new ones
    await supabase
      .from("template_suggestions")
      .delete()
      .eq("user_id", user.id)
      .eq("status", "active");

    for (const s of suggestions) {
      // Find source resource ID
      const sourceResource = recentResources.find(
        r => r.title.toLowerCase() === s.source_resource_title.toLowerCase()
      );

      await supabase.from("template_suggestions").insert({
        user_id: user.id,
        source_resource_id: sourceResource?.id || null,
        title: s.title,
        description: s.description,
        template_category: s.template_category,
        suggested_content: s.suggested_content,
        status: "active",
      });
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-templates error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Failed to generate suggestions" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
