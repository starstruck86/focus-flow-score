import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { opportunity_id, outcome } = await req.json();

    // Fetch all deal context
    const [oppRes, methRes, transcriptRes, gradesRes] = await Promise.all([
      supabase.from("opportunities").select("*, accounts(name, industry, tier)").eq("id", opportunity_id).eq("user_id", user.id).single(),
      supabase.from("opportunity_methodology").select("*").eq("opportunity_id", opportunity_id).eq("user_id", user.id).maybeSingle(),
      supabase.from("call_transcripts").select("title, call_date, summary, call_type").eq("opportunity_id", opportunity_id).eq("user_id", user.id).order("call_date", { ascending: true }).limit(15),
      supabase.from("transcript_grades").select("overall_score, coaching_issue, strengths, improvements").eq("user_id", user.id).limit(10),
    ]);

    const opp = oppRes.data;
    if (!opp) return new Response(JSON.stringify({ error: "Opportunity not found" }), { status: 404, headers: corsHeaders });

    const methodology = methRes.data;
    const transcripts = transcriptRes.data || [];

    const contextSummary = `
Deal: ${opp.name} (${opp.accounts?.name || "Unknown"})
Outcome: ${outcome}
ARR: $${opp.arr || 0}
Stage reached: ${opp.stage || "Unknown"}
Deal type: ${opp.deal_type || "Unknown"}
Days in pipeline: ${opp.created_at ? Math.floor((Date.now() - new Date(opp.created_at).getTime()) / 86400000) : "Unknown"}
Transcripts: ${transcripts.length} calls recorded
${transcripts.map(t => `- ${t.call_date}: ${t.title} (${t.call_type}) — ${t.summary || "no summary"}`).join("\n")}
MEDDICC: ${methodology ? `Champion: ${methodology.champion_confirmed ? "Yes" : "No"}, EB: ${methodology.economic_buyer_confirmed ? "Yes" : "No"}, Pain: ${methodology.identify_pain_confirmed ? "Yes" : "No"}` : "Not tracked"}
Notes: ${opp.notes || "None"}
`.trim().slice(0, 8000);

    if (!LOVABLE_API_KEY) {
      // Fallback: deterministic analysis without AI
      const patterns: string[] = [];
      if (!methodology?.champion_confirmed) patterns.push("No champion identified");
      if (transcripts.length < 3) patterns.push("Low engagement (fewer than 3 calls)");
      if (!methodology?.economic_buyer_confirmed) patterns.push("Never accessed economic buyer");

      const { error: insertErr } = await supabase.from("deal_patterns").insert({
        user_id: user.id,
        opportunity_id,
        outcome,
        analysis: { context: contextSummary, ai_generated: false },
        patterns_identified: patterns,
      });

      return new Response(JSON.stringify({ patterns, analysis: "Deterministic analysis (no AI key configured)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI-powered analysis
    const aiRes = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a sales deal analyst. Analyze this ${outcome} deal and identify patterns, root causes, and learnings. Return JSON: { "patterns": ["pattern1", ...], "root_cause": "brief explanation", "what_worked": ["item1", ...], "what_failed": ["item1", ...], "lesson": "one key takeaway for future deals" }`,
          },
          { role: "user", content: contextSummary },
        ],
        temperature: 0.3,
      }),
    });

    let analysis: any = {};
    let patterns: string[] = [];

    if (aiRes.ok) {
      const aiData = await aiRes.json();
      const raw = aiData.choices?.[0]?.message?.content || "";
      try {
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        analysis = JSON.parse(cleaned);
        patterns = analysis.patterns || [];
      } catch {
        analysis = { raw_response: raw };
        patterns = ["AI analysis completed but could not be parsed"];
      }
    }

    await supabase.from("deal_patterns").insert({
      user_id: user.id,
      opportunity_id,
      outcome,
      analysis,
      patterns_identified: patterns,
    });

    return new Response(JSON.stringify({ patterns, analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
