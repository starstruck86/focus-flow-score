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

    const { resource_id } = await req.json();
    if (!resource_id) throw new Error("resource_id required");

    // Fetch the resource
    const { data: resource, error: rErr } = await supabase
      .from("resources")
      .select("*")
      .eq("id", resource_id)
      .single();
    if (rErr || !resource) throw new Error("Resource not found");

    // Auto-enrich if placeholder URL resource
    if (
      resource.file_url?.startsWith("http") &&
      (resource.content?.startsWith("[External Link:") || resource.content?.startsWith("[Enriching"))
    ) {
      const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
      if (FIRECRAWL_API_KEY) {
        const isYT = /youtube\.com|youtu\.be/i.test(resource.file_url);
        const isPod = /spotify\.com|podcasts\.apple\.com/i.test(resource.file_url);
        try {
          const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              url: resource.file_url,
              formats: ["markdown"],
              onlyMainContent: true,
              ...(isYT || isPod ? { waitFor: 5000 } : {}),
            }),
          });
          if (scrapeRes.ok) {
            const scrapeData = await scrapeRes.json();
            const markdown = (scrapeData.data?.markdown || scrapeData.markdown || "").slice(0, 15000);
            if (markdown.length > 50) {
              resource.content = markdown;
              await supabase.from("resources").update({ content: markdown, content_status: "enriched" }).eq("id", resource_id);
              console.log(`Auto-enriched resource ${resource_id}: ${markdown.length} chars`);
            }
          }
        } catch (e) {
          console.error("Inline enrich failed:", e);
        }
      }
    }

    // Compute content hash to skip if unchanged
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(resource.content || ""));
    const contentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Check existing digest
    const { data: existing } = await supabase
      .from("resource_digests")
      .select("content_hash")
      .eq("resource_id", resource_id)
      .single();

    if (existing?.content_hash === contentHash) {
      // Already digested, return existing
      const { data: digest } = await supabase
        .from("resource_digests")
        .select("*")
        .eq("resource_id", resource_id)
        .single();
      return new Response(JSON.stringify({ digest, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are a sales operations intelligence engine. Analyze the provided sales resource and extract actionable intelligence.

The resource type is "${resource.resource_type}" titled "${resource.title}".
${resource.tags?.length ? `Tags: ${resource.tags.join(", ")}` : ""}

Extract:
1. TAKEAWAYS: 5-10 specific, actionable bullets a sales rep can immediately use. Not generic advice — specific techniques, phrases, or frameworks from THIS document.
2. SUMMARY: 2-3 sentence overview of what this resource covers and its primary value.
3. USE_CASES: 3-5 specific scenarios when a rep should reference this resource (e.g., "Before a discovery call with a VP-level prospect", "When facing budget objections in late-stage deals")).
4. GRADING_CRITERIA: If this resource contains a methodology, framework, scorecard, or playbook, extract scoring criteria that can be used to grade sales call transcripts. Each criterion should have a category name, description of what to look for, and a weight (0.0-1.0). If the resource is NOT a framework/methodology, return an empty array.
5. SUGGESTED_TASKS: 1-3 concrete tasks the user should do to put this resource into practice (e.g., "Practice the 3-step objection framework on your next 5 calls", "Create a pre-call checklist using the MEDDICC sections").`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: (resource.content || "").substring(0, 20000) },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_digest",
            description: "Extract structured actionable intelligence from a sales resource",
            parameters: {
              type: "object",
              properties: {
                takeaways: {
                  type: "array",
                  items: { type: "string" },
                  description: "5-10 specific actionable bullets — techniques, phrases, frameworks from THIS document, not generic advice",
                },
                summary: { type: "string", description: "2-3 sentence overview" },
                use_cases: {
                  type: "array",
                  items: { type: "string" },
                  description: "3-5 specific scenarios when to use this resource",
                },
                grading_criteria: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string", description: "Scoring category name" },
                      description: { type: "string", description: "What to look for when grading" },
                      weight: { type: "number", description: "Relative weight 0.0-1.0" },
                    },
                    required: ["category", "description", "weight"],
                    additionalProperties: false,
                  },
                  description: "Grading criteria for transcript scoring. Empty array if not a framework.",
                },
                template_sections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      section_name: { type: "string", description: "Section heading from the methodology" },
                      purpose: { type: "string", description: "What this section accomplishes" },
                      example_content: { type: "string", description: "Example or fill-in-the-blank text" },
                    },
                    required: ["section_name", "purpose"],
                    additionalProperties: false,
                  },
                  description: "Structured methodology steps that can seed a reusable template. Empty array if not a methodology/framework.",
                },
                suggested_tasks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Short task title" },
                      description: { type: "string", description: "What to do" },
                    },
                    required: ["title", "description"],
                    additionalProperties: false,
                  },
                  description: "1-3 practice tasks",
                },
              },
              required: ["takeaways", "summary", "use_cases", "grading_criteria", "template_sections", "suggested_tasks"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_digest" } },
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
    if (!toolCall) throw new Error("No response from AI");

    const extracted = JSON.parse(toolCall.function.arguments);

    // Upsert digest
    const { data: digest, error: upsertErr } = await supabase
      .from("resource_digests")
      .upsert({
        resource_id,
        user_id: user.id,
        takeaways: extracted.takeaways || [],
        summary: extracted.summary || "",
        use_cases: extracted.use_cases || [],
        grading_criteria: extracted.grading_criteria?.length ? extracted.grading_criteria : null,
        content_hash: contentHash,
      }, { onConflict: "resource_id" })
      .select()
      .single();

    if (upsertErr) throw new Error("Failed to save digest");

    return new Response(JSON.stringify({
      digest,
      suggested_tasks: extracted.suggested_tasks || [],
      skipped: false,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("operationalize-resource error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
