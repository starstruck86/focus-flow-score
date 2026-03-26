import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // Get user from JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch enriched resources with digests
    const { data: resources } = await adminClient
      .from("resources")
      .select("id, title, resource_type, content, tags, enrichment_status")
      .eq("user_id", user.id)
      .eq("enrichment_status", "deep_enriched")
      .limit(50);

    if (!resources?.length) {
      return new Response(
        JSON.stringify({ error: "No enriched resources found. Enrich resources first.", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch digests for these resources
    const resourceIds = resources.map((r) => r.id);
    const { data: digests } = await adminClient
      .from("resource_digests")
      .select("resource_id, summary, takeaways, use_cases")
      .eq("user_id", user.id)
      .in("resource_id", resourceIds);

    const digestMap = new Map((digests || []).map((d) => [d.resource_id, d]));

    // 3. Build context for AI
    const resourceSummaries = resources
      .map((r) => {
        const d = digestMap.get(r.id);
        return `### ${r.title} (${r.resource_type})
Tags: ${(r.tags || []).join(", ") || "none"}
Summary: ${d?.summary || "N/A"}
Takeaways: ${(d?.takeaways || []).join("; ") || "N/A"}
Use cases: ${(d?.use_cases || []).join("; ") || "N/A"}
Content preview: ${(r.content || "").slice(0, 800)}`;
      })
      .join("\n\n---\n\n");

    // 4. Call AI to generate playbooks
    const systemPrompt = `You are an elite sales enablement strategist. Your job is to extract EXECUTION-READY playbooks from sales resources — not summaries.

CRITICAL RULES:
1. DEDUPLICATE aggressively. If multiple resources teach overlapping tactics, MERGE them into ONE stronger playbook. Fewer, stronger playbooks always wins.
2. Organize by COMMERCIAL PROBLEM, not by source document. Examples: "Create Urgency", "Run Discovery", "Handle Pricing Objection", "Multi-Thread an Account", "Recover a Stalled Deal", "Secure Next Step", "Improve Call Opener".
3. Every playbook must be USABLE IN 30-60 SECONDS during a live call. No textbook summaries. No vague advice.
4. Talk tracks must be SPECIFIC phrases a rep can say verbatim, not generic descriptions.
5. Questions must be HIGH-IMPACT discovery/qualifying questions, not obvious ones.
6. Anti-patterns must be CONCRETE mistakes, not generic warnings.

Return a JSON array of playbooks. Each object must have:
- title: string (verb-led, problem-focused, e.g. "Recover a Stalled Deal")
- problem_type: string (the commercial problem this solves — use consistent categories across playbooks)
- when_to_use: string (specific situation trigger, 1-2 sentences max)
- why_it_matters: string (business impact in one sentence)
- stage_fit: string[] (from: Prospecting, Discovery, Demo, Negotiation, Closing, Renewal)
- persona_fit: string[] (buyer personas)
- tactic_steps: string[] (3-6 concrete ordered steps — each actionable and specific)
- talk_tracks: string[] (2-4 verbatim phrases a rep can use)
- key_questions: string[] (3-5 high-impact questions)
- traps: string[] (2-3 specific mistakes to avoid)
- anti_patterns: string[] (2-3 concrete "do NOT do this" items)
- success_criteria: string (what success looks like after executing this playbook)
- confidence_score: number (0-100: 80+ = pattern appears in 3+ resources with clear evidence; 50-79 = appears in 2 resources; below 50 = single source or weak signal)
- source_indices: number[] (0-based indices of source resources used)

Generate 3-6 playbooks MAX. Merge overlapping patterns ruthlessly. Every playbook must solve a DISTINCT commercial problem.
Return ONLY the JSON array, no markdown.`;

    const aiResponse = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: resourceSummaries },
        ],
        temperature: 0.4,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI call failed: ${aiResponse.status} ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "[]";

    // Parse JSON (strip markdown fences if present)
    const jsonStr = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let playbooks: any[];
    try {
      playbooks = JSON.parse(jsonStr);
    } catch {
      throw new Error("Failed to parse AI response as JSON");
    }

    if (!Array.isArray(playbooks) || playbooks.length === 0) {
      return new Response(
        JSON.stringify({ count: 0, message: "AI did not generate any playbooks" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Delete old playbooks for this user and insert new ones
    await adminClient.from("playbooks").delete().eq("user_id", user.id);

    const rows = playbooks.map((p) => ({
      user_id: user.id,
      title: p.title || "Untitled Playbook",
      problem_type: p.problem_type || "",
      when_to_use: p.when_to_use || "",
      why_it_matters: p.why_it_matters || "",
      stage_fit: p.stage_fit || [],
      persona_fit: p.persona_fit || [],
      tactic_steps: p.tactic_steps || [],
      talk_tracks: p.talk_tracks || [],
      key_questions: p.key_questions || [],
      traps: p.traps || [],
      anti_patterns: p.anti_patterns || [],
      success_criteria: p.success_criteria || "",
      confidence_score: Math.max(0, Math.min(100, p.confidence_score ?? 50)),
      source_resource_ids: (p.source_indices || [])
        .filter((i: number) => i >= 0 && i < resources.length)
        .map((i: number) => resources[i].id),
    }));

    const { error: insertError } = await adminClient.from("playbooks").insert(rows);
    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({ count: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
