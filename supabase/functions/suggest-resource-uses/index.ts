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

    // Fetch resources and opportunities in parallel
    const [resourcesRes, oppsRes] = await Promise.all([
      supabase
        .from("resources")
        .select("id, title, resource_type, tags, description")
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase
        .from("opportunities")
        .select("id, name, stage, deal_type, close_date, arr, account_id")
        .in("status", ["open", null])
        .order("close_date", { ascending: true })
        .limit(30),
    ]);

    const resources = resourcesRes.data || [];
    const opportunities = oppsRes.data || [];

    if (resources.length === 0) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const resourceSummary = resources.map(r =>
      `- [${r.id}] "${r.title}" (${r.resource_type})${r.tags?.length ? ` tags:${r.tags.join(",")}` : ""}${r.description ? ` — ${r.description.substring(0, 100)}` : ""}`
    ).join("\n");

    const stageGroups: Record<string, number> = {};
    opportunities.forEach(o => {
      const stage = o.stage || "Unknown";
      stageGroups[stage] = (stageGroups[stage] || 0) + 1;
    });

    const dealContext = opportunities.length > 0
      ? `Active deals (${opportunities.length}):\n${Object.entries(stageGroups).map(([s, c]) => `- ${c} in "${s}"`).join("\n")}\n\nTop deals:\n${opportunities.slice(0, 10).map(o => `- ${o.name}: ${o.stage || "—"} $${Math.round((o.arr || 0) / 1000)}k close:${o.close_date || "TBD"}`).join("\n")}`
      : "No active deals.";

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
            content: `You are a sales operations advisor. Given a user's resource library and active deal pipeline, suggest 1-3 high-impact ways to transform or combine their existing resources into new operational tools. Focus on actionable transformations that directly support their current deal stages.

Types of suggestions:
- "transform": Convert a resource into a different format (e.g., playbook → scorecard, framework → checklist)
- "combine": Merge multiple resources into a unified guide
- "templatize": Turn a one-off document into a reusable template

Be specific about WHICH resources to use (by ID) and what the output would be. Reference deal context when relevant.`,
          },
          {
            role: "user",
            content: `RESOURCES:\n${resourceSummary}\n\n${dealContext}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "provide_suggestions",
            description: "Return structured resource transformation suggestions",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      description: { type: "string", description: "What to create and why" },
                      action_type: { type: "string", enum: ["transform", "combine", "templatize"] },
                      source_resource_ids: {
                        type: "array",
                        items: { type: "string" },
                        description: "Resource IDs to use as source",
                      },
                      target_type: {
                        type: "string",
                        enum: ["scorecard", "checklist", "cadence", "training_guide", "one_pager", "template", "document"],
                      },
                      deal_context: { type: "string", description: "Which deals/stages make this relevant, if any" },
                    },
                    required: ["description", "action_type", "source_resource_ids", "target_type"],
                    additionalProperties: false,
                  },
                  maxItems: 3,
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "provide_suggestions" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limited — try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted — add funds in Settings > Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    const result = toolCall ? JSON.parse(toolCall.function.arguments) : { suggestions: [] };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-resource-uses error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
