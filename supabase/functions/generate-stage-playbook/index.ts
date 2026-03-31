import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

const STAGE_LABELS: Record<string, string> = {
  outbound: "Outbound Prospecting",
  discovery: "Discovery",
  demo: "Demo / Presentation",
  pricing: "Pricing & Negotiation",
  champion: "Champion Building",
  procurement: "Procurement",
  closing: "Closing",
  post_sale: "Post-Sale / Expansion",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { stage_id, resource_ids, keystone_resource_ids } = await req.json();
    if (!stage_id) {
      return new Response(JSON.stringify({ error: "stage_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, supabaseKey);
    const stageLabel = STAGE_LABELS[stage_id] || stage_id;

    // Fetch resources
    const allResourceIds = [...new Set([...(keystone_resource_ids || []), ...(resource_ids || [])])];
    let resources: any[] = [];
    if (allResourceIds.length > 0) {
      const { data } = await admin.from("resources").select("id, title, resource_type, content, tags").in("id", allResourceIds);
      resources = data || [];
    }

    // Fetch KIs linked to these resources
    let knowledgeItems: any[] = [];
    if (allResourceIds.length > 0) {
      const { data } = await admin
        .from("knowledge_items")
        .select("id, title, knowledge_type, chapter, tactic_summary, why_it_matters, when_to_use, when_not_to_use, example_usage, confidence_score, source_resource_id, tags")
        .eq("user_id", user.id)
        .eq("active", true)
        .in("source_resource_id", allResourceIds)
        .order("confidence_score", { ascending: false })
        .limit(60);
      knowledgeItems = data || [];
    }

    // Also fetch KIs that match stage context
    const { data: stageKIs } = await admin
      .from("knowledge_items")
      .select("id, title, knowledge_type, chapter, tactic_summary, why_it_matters, when_to_use, when_not_to_use, example_usage, confidence_score, source_resource_id, tags")
      .eq("user_id", user.id)
      .eq("active", true)
      .contains("applies_to_contexts", [stage_id])
      .order("confidence_score", { ascending: false })
      .limit(30);

    // Merge and deduplicate KIs
    const kiMap = new Map<string, any>();
    for (const ki of [...knowledgeItems, ...(stageKIs || [])]) {
      kiMap.set(ki.id, ki);
    }
    const allKIs = Array.from(kiMap.values());

    if (resources.length === 0 && allKIs.length === 0) {
      return new Response(JSON.stringify({
        error: "No resources or knowledge items found. Add resources to this stage first.",
        sections: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build resource map for citations
    const resourceMap = new Map(resources.map(r => [r.id, r]));

    // Build context for AI
    const keystoneContext = (keystone_resource_ids || [])
      .map((id: string) => {
        const r = resourceMap.get(id);
        if (!r) return null;
        const linkedKIs = allKIs.filter(ki => ki.source_resource_id === id);
        return `### [KEYSTONE] ${r.title} (${r.resource_type})
Tags: ${(r.tags || []).join(", ") || "none"}
Content preview: ${(r.content || "").slice(0, 600)}
Linked Knowledge Items (${linkedKIs.length}):
${linkedKIs.map(ki => `- ${ki.title}: ${ki.tactic_summary || "N/A"}`).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n");

    const supportingContext = (resource_ids || [])
      .filter((id: string) => !(keystone_resource_ids || []).includes(id))
      .map((id: string) => {
        const r = resourceMap.get(id);
        if (!r) return null;
        const linkedKIs = allKIs.filter(ki => ki.source_resource_id === id);
        return `### [SUPPORTING] ${r.title} (${r.resource_type})
Content preview: ${(r.content || "").slice(0, 400)}
Linked KIs (${linkedKIs.length}):
${linkedKIs.map(ki => `- ${ki.title}: ${ki.tactic_summary || "N/A"}`).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n");

    const kiContext = allKIs
      .map(ki => {
        const source = resourceMap.get(ki.source_resource_id);
        return `- [KI:${ki.id.slice(0, 8)}] ${ki.title} (from: ${source?.title || "Unknown"})
  Summary: ${ki.tactic_summary || "N/A"}
  Why: ${ki.why_it_matters || "N/A"}
  When: ${ki.when_to_use || "N/A"}
  Example: ${ki.example_usage || "N/A"}`;
      })
      .join("\n");

    // Build resource index for citations
    const resourceIndex = resources.map((r, i) => `[R${i + 1}] ${r.title}`).join("\n");

    const systemPrompt = `You are an elite sales execution strategist building a STAGE-SPECIFIC PLAYBOOK for the "${stageLabel}" stage.

You have access to the user's Keystone Resources (foundational frameworks), Supporting Resources (tactical enhancements), and extracted Knowledge Items (KIs).

CRITICAL RULES:
1. Synthesize all inputs into a STRUCTURED, ACTIONABLE playbook
2. EVERY major insight MUST include a citation: [Resource: Name] or [KI: title]
3. Prioritize Keystone Resource insights — they define the foundational approach
4. Supporting Resources add tactical depth
5. KIs provide specific, tested tactics — cite them by title
6. Organize into clear sections appropriate for the "${stageLabel}" stage
7. Be SPECIFIC and ACTIONABLE — not generic advice
8. Include verbatim talk tracks and questions where available

Return a JSON object with:
{
  "title": "string — playbook title",
  "summary": "string — 1-2 sentence overview",
  "sections": [
    {
      "title": "string — section name",
      "items": [
        {
          "content": "string — the insight, tactic, or guidance",
          "citations": ["string — source references like 'Resource: Name' or 'KI: title'"],
          "type": "tactic" | "question" | "talk_track" | "framework" | "warning" | "tip"
        }
      ]
    }
  ]
}

Generate 4-8 sections. Typical sections for ${stageLabel} might include:
- Objectives & Success Criteria
- Key Questions / Discovery Framework
- Talk Tracks & Phrasing
- Tactical Steps / Process
- Common Pitfalls & Anti-Patterns
- Competitive Positioning (if relevant)
- Qualification Checkpoints
- Transition to Next Stage

Return ONLY valid JSON, no markdown fences.`;

    const userPrompt = `RESOURCE INDEX:
${resourceIndex}

KEYSTONE RESOURCES:
${keystoneContext || "None selected"}

SUPPORTING RESOURCES:
${supportingContext || "None"}

ALL KNOWLEDGE ITEMS (${allKIs.length}):
${kiContext || "None extracted"}

Generate the ${stageLabel} stage playbook now.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — try again shortly" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      throw new Error(`AI call failed: ${aiResponse.status} ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";
    const jsonStr = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let playbook: any;
    try {
      playbook = JSON.parse(jsonStr);
    } catch {
      throw new Error("Failed to parse AI playbook response");
    }

    // Upsert to stage_playbooks
    const { error: upsertError } = await admin
      .from("stage_playbooks")
      .upsert({
        user_id: user.id,
        stage_id,
        content: playbook,
        resource_ids: allResourceIds,
        keystone_resource_ids: keystone_resource_ids || [],
        knowledge_item_count: allKIs.length,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,stage_id" });

    if (upsertError) {
      console.error("Upsert error:", upsertError);
    }

    return new Response(JSON.stringify({
      playbook,
      knowledge_item_count: allKIs.length,
      resource_count: resources.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("generate-stage-playbook error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
