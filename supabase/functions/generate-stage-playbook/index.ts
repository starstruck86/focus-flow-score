import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

const STAGE_LABELS: Record<string, string> = {
  outbound: "Account Snapshot",
  discovery: "Discovery Prep",
  demo: "Demo Prep",
  pricing: "Pricing & ROI",
  champion: "Champion / Alignment",
  procurement: "Procurement",
  closing: "Closing",
  post_sale: "Post-Sale / Expansion",
  call_plan: "Call Plan",
  deal_strategy: "Deal Strategy",
  follow_up: "Follow-Up / Recap",
};

const STAGE_FRAMEWORKS: Record<string, { framework: string; who: string; role: string; sections: string[] }[]> = {
  outbound: [
    { framework: "Challenger", who: "Dixon", role: "Hypothesis-driven outreach", sections: ["Business Overview", "Digital / Lifecycle Signals", "Challenger Hypothesis"] },
    { framework: "GAP Selling", who: "Keenan", role: "Problem-centric messaging", sections: ["Problem Hypotheses", "Impact Hooks"] },
    { framework: "Command of the Message", who: "Force Management", role: "Value messaging structure", sections: ["Value Pillars for Outreach"] },
  ],
  discovery: [
    { framework: "GAP Selling", who: "Keenan", role: "Current state > future state > gap > impact", sections: ["Current State", "Desired State", "Problems / Gaps", "Impact"] },
    { framework: "Challenger", who: "Dixon", role: "Blind spots & reframes", sections: ["Blind Spots", "Reframe Ideas", "Insight Hooks"] },
    { framework: "Command of the Message", who: "Force Management", role: "Conversation structure & pillars", sections: ["Three Conversation Pillars"] },
    { framework: "MEDDPICC", who: "McMahon", role: "Early qualification signals", sections: ["Metrics to Uncover", "Economic Buyer Signals", "Champion Indicators"] },
  ],
  call_plan: [
    { framework: "Command of the Message", who: "Force Management", role: "Conversation structure", sections: ["Opening", "Agenda", "Flow"] },
    { framework: "GAP Selling", who: "Keenan", role: "Key discovery questions", sections: ["Key Discovery Questions"] },
    { framework: "Challenger", who: "Dixon", role: "Where to introduce insights", sections: ["Insight Introduction Points"] },
  ],
  demo: [
    { framework: "Challenger", who: "Dixon", role: "Teaching moments & insight delivery", sections: ["Teaching Moments", "Reframe"] },
    { framework: "Command of the Message", who: "Force Management", role: "Narrative flow & structure", sections: ["Demo Narrative", "Demo Flow"] },
    { framework: "GAP Selling", who: "Keenan", role: "Tie to customer problems", sections: ["Problem-to-Feature Mapping"] },
  ],
  deal_strategy: [
    { framework: "MEDDPICC", who: "McMahon", role: "Full deal qualification & progression", sections: ["Metrics", "Economic Buyer", "Decision Criteria", "Decision Process", "Paper Process", "Competition", "Champion"] },
    { framework: "GAP Selling", who: "Keenan", role: "Urgency & cost of inaction", sections: ["Urgency"] },
    { framework: "Challenger", who: "Dixon", role: "Risk framing", sections: ["Risk Framing"] },
  ],
  pricing: [
    { framework: "Command of the Message", who: "Force Management", role: "Value justification", sections: ["Value Framework Recap", "ROI Narrative"] },
    { framework: "GAP Selling", who: "Keenan", role: "Cost of inaction", sections: ["Current State Cost", "Impact of Delay"] },
    { framework: "MEDDPICC", who: "McMahon", role: "Decision process navigation", sections: ["Decision Criteria Alignment", "Paper Process Steps"] },
  ],
  champion: [
    { framework: "MEDDPICC", who: "McMahon", role: "Champion development & testing", sections: ["Champion Identification", "Champion Testing", "Champion Coaching"] },
    { framework: "Challenger", who: "Dixon", role: "Equipping with insights", sections: ["Internal Selling Insights", "Executive Talking Points"] },
    { framework: "Command of the Message", who: "Force Management", role: "Arming with value narrative", sections: ["Champion Value Story"] },
  ],
  procurement: [
    { framework: "MEDDPICC", who: "McMahon", role: "Paper process & decision navigation", sections: ["Decision Process Map", "Risk Identification"] },
    { framework: "Command of the Message", who: "Force Management", role: "Maintaining value through procurement", sections: ["Value Recap", "Concession Strategy"] },
  ],
  closing: [
    { framework: "MEDDPICC", who: "McMahon", role: "Final qualification & risk check", sections: ["MEDDPICC Scorecard", "Risk Signals"] },
    { framework: "GAP Selling", who: "Keenan", role: "Urgency reinforcement", sections: ["Cost of Inaction"] },
    { framework: "Command of the Message", who: "Force Management", role: "Final value alignment", sections: ["Executive Value Summary"] },
  ],
  post_sale: [
    { framework: "GAP Selling", who: "Keenan", role: "New gaps for expansion", sections: ["Expansion Gaps", "New Future State"] },
    { framework: "MEDDPICC", who: "McMahon", role: "Expansion qualification", sections: ["New Metrics & Success", "Expansion Champion"] },
    { framework: "Challenger", who: "Dixon", role: "Ongoing insight delivery", sections: ["Strategic Insights", "Proactive Teaching"] },
  ],
  follow_up: [
    { framework: "Command of the Message", who: "Force Management", role: "Recap structure & value reinforcement", sections: ["Recap Email Structure", "Executive Summary", "Value Recap"] },
    { framework: "MEDDPICC", who: "McMahon", role: "Mutual action plan & next steps", sections: ["Mutual Action Plan", "Next Steps & Commitments", "Decision Process Update"] },
    { framework: "GAP Selling", who: "Keenan", role: "Gap confirmation & impact reinforcement", sections: ["Confirmed Gaps", "Impact Reinforcement"] },
    { framework: "Challenger", who: "Dixon", role: "Follow-up insights & urgency", sections: ["Follow-Up Insight", "Internal Champion Talking Points"] },
  ],
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
    const stageFrameworks = STAGE_FRAMEWORKS[stage_id] || STAGE_FRAMEWORKS.discovery;

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
        .select("id, title, knowledge_type, chapter, tactic_summary, why_it_matters, when_to_use, when_not_to_use, example_usage, confidence_score, source_resource_id, tags, who, framework, macro_situation, micro_strategy, how_to_execute, what_this_unlocks")
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
      .select("id, title, knowledge_type, chapter, tactic_summary, why_it_matters, when_to_use, when_not_to_use, example_usage, confidence_score, source_resource_id, tags, who, framework, macro_situation, micro_strategy, how_to_execute, what_this_unlocks")
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

    const resourceMap = new Map(resources.map(r => [r.id, r]));
    const keystoneIdSet = new Set(keystone_resource_ids || []);

    // Build context
    const keystoneContext = (keystone_resource_ids || [])
      .map((id: string) => {
        const r = resourceMap.get(id);
        if (!r) return null;
        const linkedKIs = allKIs.filter(ki => ki.source_resource_id === id);
        return `### [KEYSTONE RESOURCE] ${r.title} (${r.resource_type})\nTags: ${(r.tags || []).join(", ") || "none"}\nContent preview: ${(r.content || "").slice(0, 600)}\nLinked KIs (${linkedKIs.length}):\n${linkedKIs.map(ki => `- ${ki.title}${ki.framework ? ` [${ki.framework} — ${ki.who || ''}]` : ''}: ${ki.tactic_summary || "N/A"}`).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n");

    const supportingContext = (resource_ids || [])
      .filter((id: string) => !keystoneIdSet.has(id))
      .map((id: string) => {
        const r = resourceMap.get(id);
        if (!r) return null;
        const linkedKIs = allKIs.filter(ki => ki.source_resource_id === id);
        return `### [SUPPORTING RESOURCE] ${r.title} (${r.resource_type})\nContent preview: ${(r.content || "").slice(0, 400)}\nLinked KIs (${linkedKIs.length}):\n${linkedKIs.map(ki => `- ${ki.title}${ki.framework ? ` [${ki.framework} — ${ki.who || ''}]` : ''}: ${ki.tactic_summary || "N/A"}`).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n");

    const kiContext = allKIs
      .map(ki => {
        const source = resourceMap.get(ki.source_resource_id);
        const sourceType = keystoneIdSet.has(ki.source_resource_id) ? "Keystone" : "Supporting";
        const attribution = [ki.framework, ki.who].filter(Boolean).join(" — ");
        const parts = [
          `- [KI:${ki.id.slice(0, 8)}] ${ki.title}${attribution ? ` [${attribution}]` : ""} (from ${sourceType}: ${source?.title || "Unknown"})`,
          ki.macro_situation ? `  Situation: ${ki.macro_situation}` : null,
          ki.micro_strategy ? `  Strategy: ${ki.micro_strategy}` : null,
          `  Summary: ${ki.tactic_summary || "N/A"}`,
          ki.how_to_execute ? `  How: ${ki.how_to_execute}` : null,
          `  Why: ${ki.why_it_matters || "N/A"}`,
          `  When: ${ki.when_to_use || "N/A"}`,
          ki.what_this_unlocks ? `  Unlocks: ${ki.what_this_unlocks}` : null,
          `  Example: ${ki.example_usage || "N/A"}`,
        ].filter(Boolean);
        return parts.join("\n");
      })
      .join("\n");

    const resourceIndex = resources.map((r, i) => {
      const type = keystoneIdSet.has(r.id) ? "KEYSTONE" : "SUPPORTING";
      return `[R${i + 1}:${type}] ${r.title}`;
    }).join("\n");

    const frameworkSpec = stageFrameworks
      .map(f => `### ${f.framework} — ${f.who} (Role: ${f.role})\nGenerate these sections:\n${f.sections.map(s => `  - "${f.framework}: ${s}"`).join("\n")}`)
      .join("\n\n");

    const systemPrompt = `You are an elite sales execution strategist building a TACTICAL PLAYBOOK for the "${stageLabel}" stage.

This playbook integrates FOUR sales frameworks as a single Sales Operating System:
- GAP Selling (Keenan) = Discovery — current state, future state, gaps, impact
- Challenger (Dixon) = Insight, reframe & teaching
- MEDDPICC (McMahon) = Deal qualification & progression
- Command of the Message (Force Management) = Structure & narrative

CRITICAL: Produce ONE unified playbook. Each section MUST be a TACTICAL EXECUTION BLOCK, not a summary.

FRAMEWORK-DRIVEN SECTIONS FOR THIS STAGE:
${frameworkSpec}

SECTION OUTPUT STRUCTURE — MANDATORY FOR EVERY SECTION:
Each section must contain ALL of these fields:
1. "objective" — one sentence stating what the rep must accomplish in this section
2. "questions" — 3-5 specific questions to ask the prospect (verbatim, ready to use)
3. "talk_tracks" — 2-3 exact phrases/sentences the rep can say (natural speech, not consultant language)
4. "hypotheses" — 1-3 beliefs about this prospect/situation that need to be validated
5. "signals" — 2-4 signal interpretations: what good vs bad answers mean (format: "If they say X → it means Y → do Z")
6. "next_steps" — 1-3 concrete actions to take after this section (specific, not generic)

FRAMEWORK-SPECIFIC CONTENT RULES:
- GAP Selling KIs → prioritize populating questions and hypotheses
- Challenger KIs → prioritize populating talk_tracks and hypotheses
- MEDDPICC KIs → prioritize populating signals and next_steps
- Command of the Message KIs → prioritize populating talk_tracks and questions

OUTPUT QUALITY GUARDRAILS — MANDATORY:
1. ZERO high-level summaries — no "consider exploring" or "it would be beneficial"
2. Every question must be a real question a human would ask in conversation
3. Every talk track must sound like a real person speaking — contractions, natural phrasing
4. Every signal must have a clear "If X → then Y" structure
5. Every next step must be a specific verb-led action (e.g., "Send the ROI calc to Sarah by Friday")
6. NO repeated content across sections
7. Prefer account/industry-specific language over generic advice

CITATION RULES:
- Each item in questions, talk_tracks, hypotheses, signals, next_steps can have an optional "citations" array
- Citations format: "[Keystone: Title]", "[Supporting: Title]", or "[KI: Title]"
- Prioritize Keystone insights as foundational

Return a JSON object:
{
  "title": "string — playbook title",
  "summary": "string — 1-2 sentence overview",
  "sections": [
    {
      "title": "string — e.g. 'GAP Selling: Current State'",
      "framework": "string — the framework name",
      "objective": "string — what the rep must accomplish",
      "questions": [{ "content": "string", "citations": ["string"] }],
      "talk_tracks": [{ "content": "string", "citations": ["string"] }],
      "hypotheses": [{ "content": "string", "citations": ["string"] }],
      "signals": [{ "content": "string", "citations": ["string"] }],
      "next_steps": [{ "content": "string", "citations": ["string"] }]
    }
  ]
}

Return ONLY valid JSON, no markdown fences.`;

    const userPrompt = `RESOURCE INDEX:\n${resourceIndex}\n\nKEYSTONE RESOURCES:\n${keystoneContext || "None selected"}\n\nSUPPORTING RESOURCES:\n${supportingContext || "None"}\n\nALL KNOWLEDGE ITEMS (${allKIs.length}):\n${kiContext || "None extracted"}\n\nGenerate the tactical ${stageLabel} stage playbook now. Every section needs real questions, real talk tracks, real signals. Zero filler.`;

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
        temperature: 0.25,
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
