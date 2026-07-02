import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-digest-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const COREY_USER_ID = "9f11e308-4028-4527-b7ba-5ea365dc1441";
const FOCUS_SPOKES = ["product", "expansion", "deal_control"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = Deno.env.get("TRAINING_DIGEST_SECRET");
  if (!secret) {
    return json({ error: "TRAINING_DIGEST_SECRET not configured on server" }, 503);
  }
  const provided = req.headers.get("x-digest-token");
  if (!provided || provided !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userId = COREY_USER_ID;
    const now = new Date().toISOString();

    // Flash due
    const { data: dueRows } = await supabase
      .from("flashcard_state")
      .select("card_id, due_at")
      .eq("user_id", userId)
      .lte("due_at", now)
      .order("due_at", { ascending: true })
      .limit(200);
    const flashDueCount = (dueRows || []).length;
    const next3Ids = (dueRows || []).slice(0, 3).map(r => r.card_id);
    let next3Fronts: string[] = [];
    if (next3Ids.length) {
      const { data: cards } = await supabase
        .from("flashcards")
        .select("id, front")
        .in("id", next3Ids);
      const map = new Map((cards || []).map(c => [c.id, c.front]));
      next3Fronts = next3Ids.map(id => map.get(id) || "").filter(Boolean);
    }

    // Drill-ready concepts (join to spoke via curriculum_concepts)
    const { data: drillReady } = await supabase
      .from("ki_curriculum")
      .select("concept_id, ki_id")
      .eq("drill_ready", true);
    const conceptIds = Array.from(new Set((drillReady || []).map(r => r.concept_id)));
    const { data: concepts } = await supabase
      .from("curriculum_concepts")
      .select("concept_id, spoke, topic")
      .in("concept_id", conceptIds.length ? conceptIds : ["__none__"]);
    const conceptSpoke = new Map((concepts || []).map(c => [c.concept_id, { spoke: c.spoke, topic: c.topic }]));

    // Mastery per KI
    const { data: mastery } = await supabase
      .from("ki_mastery")
      .select("ki_id, times_drilled, best_score")
      .eq("user_id", userId);
    const masteryMap = new Map((mastery || []).map(m => [m.ki_id, m]));

    let refresherEligible = 0;
    const neverAttemptedBySpoke: Record<string, number> = {};
    for (const s of FOCUS_SPOKES) neverAttemptedBySpoke[s] = 0;

    for (const row of drillReady || []) {
      const cs = conceptSpoke.get(row.concept_id);
      const m = masteryMap.get(row.ki_id);
      if (m && m.times_drilled >= 1 && (m.best_score ?? 0) >= 85) refresherEligible++;
      if (!m || m.times_drilled === 0) {
        if (cs && FOCUS_SPOKES.includes(cs.spoke)) {
          neverAttemptedBySpoke[cs.spoke]++;
        }
      }
    }

    // Suggested topic: topic with highest drill_ready count where no KI has best_score >= 85 (§7.33)
    const topicCounts = new Map<string, { spoke: string; topic: string; total: number; passed: number }>();
    for (const row of drillReady || []) {
      const cs = conceptSpoke.get(row.concept_id);
      if (!cs) continue;
      const key = `${cs.spoke}::${cs.topic}`;
      const entry = topicCounts.get(key) || { spoke: cs.spoke, topic: cs.topic, total: 0, passed: 0 };
      entry.total++;
      const m = masteryMap.get(row.ki_id);
      if (m && (m.best_score ?? 0) >= 85) entry.passed++;
      topicCounts.set(key, entry);
    }
    const suggested = [...topicCounts.values()]
      .filter(t => t.passed === 0)
      .sort((a, b) => b.total - a.total)[0] || null;

    // Gates QA'd
    const { count: gatesAvailable } = await supabase
      .from("curriculum_gates")
      .select("*", { count: "exact", head: true })
      .not("gate_content_status", "is", null);

    return json({
      user_id: userId,
      generated_at: now,
      flash_due: { count: flashDueCount, next_3_fronts: next3Fronts },
      drills_never_attempted: neverAttemptedBySpoke,
      refresher_eligible: refresherEligible,
      suggested_topic: suggested ? { spoke: suggested.spoke, topic: suggested.topic, drill_ready_count: suggested.total } : null,
      gates_available: gatesAvailable ?? 0,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
