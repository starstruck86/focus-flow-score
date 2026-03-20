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
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { opportunity_id } = await req.json();

    // Fetch opportunity + methodology + transcripts + activity
    const [oppRes, methRes, transcriptRes, gradesRes] = await Promise.all([
      supabase.from("opportunities").select("*, accounts(name, tier, icp_fit_score)").eq("id", opportunity_id).eq("user_id", user.id).single(),
      supabase.from("opportunity_methodology").select("*").eq("opportunity_id", opportunity_id).eq("user_id", user.id).maybeSingle(),
      supabase.from("call_transcripts").select("id, title, call_date, summary, call_type").eq("opportunity_id", opportunity_id).eq("user_id", user.id).order("call_date", { ascending: false }).limit(10),
      supabase.from("transcript_grades").select("overall_score, overall_grade, coaching_issue, progression_evidence, likelihood_impact").eq("user_id", user.id).limit(20),
    ]);

    const opp = oppRes.data;
    if (!opp) return new Response(JSON.stringify({ error: "Opportunity not found" }), { status: 404, headers: corsHeaders });

    const methodology = methRes.data;
    const transcripts = transcriptRes.data || [];

    // Compute risk factors deterministically
    const risks: { factor: string; severity: "high" | "medium" | "low"; detail: string }[] = [];

    // 1. MEDDICC gaps
    if (methodology) {
      const meddiccFields = [
        { key: "metrics_confirmed", label: "Metrics" },
        { key: "economic_buyer_confirmed", label: "Economic Buyer" },
        { key: "decision_criteria_confirmed", label: "Decision Criteria" },
        { key: "decision_process_confirmed", label: "Decision Process" },
        { key: "identify_pain_confirmed", label: "Identify Pain" },
        { key: "champion_confirmed", label: "Champion" },
        { key: "competition_confirmed", label: "Competition" },
      ];
      const unconfirmed = meddiccFields.filter(f => !(methodology as any)[f.key]);
      if (unconfirmed.length >= 4) {
        risks.push({ factor: "MEDDICC Coverage", severity: "high", detail: `${unconfirmed.length}/7 elements unconfirmed: ${unconfirmed.map(u => u.label).join(", ")}` });
      } else if (unconfirmed.length >= 2) {
        risks.push({ factor: "MEDDICC Gaps", severity: "medium", detail: `${unconfirmed.length} unconfirmed: ${unconfirmed.map(u => u.label).join(", ")}` });
      }
      if (!methodology.champion_confirmed) {
        risks.push({ factor: "No Champion", severity: "high", detail: "Champion not yet identified or confirmed" });
      }
      if (!methodology.economic_buyer_confirmed) {
        risks.push({ factor: "No Economic Buyer", severity: "high", detail: "Economic buyer access not confirmed" });
      }
    } else {
      risks.push({ factor: "No Methodology Tracking", severity: "medium", detail: "MEDDICC not started for this opportunity" });
    }

    // 2. Activity staleness
    const lastTouch = opp.last_touch_date ? new Date(opp.last_touch_date) : null;
    const daysSinceTouch = lastTouch ? Math.floor((Date.now() - lastTouch.getTime()) / 86400000) : 999;
    if (daysSinceTouch > 21) {
      risks.push({ factor: "Stale Deal", severity: "high", detail: `No activity in ${daysSinceTouch} days` });
    } else if (daysSinceTouch > 10) {
      risks.push({ factor: "Cooling Activity", severity: "medium", detail: `Last touch ${daysSinceTouch} days ago` });
    }

    // 3. Missing next steps
    if (!opp.next_step || opp.next_step.trim().length < 5) {
      risks.push({ factor: "No Next Step", severity: "high", detail: "No concrete next step defined" });
    }

    // 4. Close date proximity
    if (opp.close_date) {
      const daysToClose = Math.floor((new Date(opp.close_date).getTime() - Date.now()) / 86400000);
      if (daysToClose < 0) {
        risks.push({ factor: "Past Due", severity: "high", detail: `Close date was ${Math.abs(daysToClose)} days ago` });
      } else if (daysToClose < 14 && opp.stage !== "Negotiate" && opp.stage !== "Closed Won") {
        risks.push({ factor: "Close Date Risk", severity: "medium", detail: `${daysToClose} days to close but still in ${opp.stage || "early"} stage` });
      }
    }

    // 5. Low transcript engagement
    if (transcripts.length === 0 && opp.stage && ["Demo", "Proposal", "Negotiate"].includes(opp.stage)) {
      risks.push({ factor: "No Call Records", severity: "medium", detail: `In ${opp.stage} stage with no recorded calls` });
    }

    // Calculate overall risk score
    const severityWeights = { high: 30, medium: 15, low: 5 };
    const totalRiskScore = Math.min(100, risks.reduce((sum, r) => sum + severityWeights[r.severity], 0));
    const riskLevel = totalRiskScore >= 60 ? "critical" : totalRiskScore >= 30 ? "at-risk" : "healthy";

    // Generate recommendations
    const recommendations: string[] = [];
    if (risks.some(r => r.factor === "No Champion")) recommendations.push("Identify and validate a champion before advancing stage");
    if (risks.some(r => r.factor === "Stale Deal")) recommendations.push("Schedule a touchpoint within 48 hours to re-engage");
    if (risks.some(r => r.factor === "No Next Step")) recommendations.push("Define a concrete, time-bound next step with the prospect");
    if (risks.some(r => r.factor === "Past Due")) recommendations.push("Update close date or move to Closed Lost if deal is dead");
    if (risks.some(r => r.factor.includes("MEDDICC"))) recommendations.push("Plan discovery questions to fill methodology gaps");
    if (recommendations.length === 0) recommendations.push("Deal is on track — maintain momentum and prepare for next stage gate");

    return new Response(JSON.stringify({
      opportunity_id,
      opportunity_name: opp.name,
      account_name: opp.accounts?.name || "Unknown",
      stage: opp.stage,
      arr: opp.arr,
      risk_score: totalRiskScore,
      risk_level: riskLevel,
      risks,
      recommendations,
      transcript_count: transcripts.length,
      days_since_last_touch: daysSinceTouch === 999 ? null : daysSinceTouch,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
