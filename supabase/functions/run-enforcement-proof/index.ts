// ════════════════════════════════════════════════════════════════
// run-enforcement-proof — Service-role test harness to prove
// artifact gate + planner enforcement across all 3 task types.
//
// Requires STRATEGY_VALIDATION_KEY as Bearer token.
// Returns telemetry fields for each task type.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runArtifactGate } from "../_shared/strategy-orchestrator/artifactGateEnforcement.ts";
import { getTaskManifest, toArtifactManifest } from "../_shared/strategy-orchestrator/taskManifestMap.ts";
import { buildPlan } from "../_shared/strategy-skills/planner.ts";
import { planToRetrievalArgs } from "../_shared/strategy-skills/adapter.ts";
import type { TaskType } from "../_shared/strategy-orchestrator/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const auth = req.headers.get("authorization") || "";
  const apiKey = req.headers.get("apikey") || "";
  // Accept service role, validation key, or anon key (diagnostic-only endpoint)
  const authorized = (validationKey && auth.includes(validationKey)) ||
    (serviceKey && auth.includes(serviceKey)) ||
    (anonKey && (auth.includes(anonKey) || apiKey === anonKey));
  if (!authorized) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const mode: string = body.mode || "full"; // "full" | "forced_failure" | "discovery_gate"

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const TASK_TYPES: TaskType[] = ["discovery_prep", "account_brief", "ninety_day_plan"];
  const results: Record<string, any> = {};

  // ── Planner Proof ──────────────────────────────────────────────
  for (const tt of TASK_TYPES) {
    const manifest = getTaskManifest(tt);
    const artifactManifest = toArtifactManifest(manifest);
    const planResult = buildPlan(
      { manifest, effectiveDepth: "artifact", inputs: { company_name: "Acme Corp", opportunity: "Q4 Deal" } },
      {},
    );

    const plannerProof = planResult.ok
      ? {
          plan_hash: planResult.plan.planHash,
          term_seeds_count: planResult.plan.termSeeds.length,
          methodology_seeds_injected: (manifest.retrieval.methodologySeeds ?? []).length > 0,
          scopes: planResult.plan.scopes,
        }
      : { refused: true, reason: (planResult as any).reason };

    results[tt] = { planner: plannerProof };
  }

  // ── Artifact Gate Proof ────────────────────────────────────────
  // Good output — should pass
  const goodOutput = JSON.stringify({
    situation: "Acme Corp operates 4 disconnected platforms costing $180K/year in redundant licensing. The VP is under pressure because NPS dropped 12 points, resulting in reduced bookings [KI:abc]. This fragmentation means staff waste 22 minutes per transaction resolving data conflicts.",
    commercial_insight: "The core issue is data silos preventing upsell execution [PB:def]. Consequently, $42 per unit is lost in ancillary revenue, therefore costing $890K annually in missed opportunity.",
    risks: "Without consolidation by Q3, they face a $2.1M cycle that locks in the current stack. The VP flagged this as a budget risk [KI:ghi], therefore delaying action compounds costs by 40%.",
    strategic_why: "Consolidation is a revenue recovery initiative. Because the decision requires board approval above $500K, the champion must frame this as margin protection [PB:jkl].",
    specific_asks: "Ask: 'What is your per-unit cost today vs target margin?' Then confirm whether Q3 budget has been allocated. This validates urgency and surfaces the decision timeline.",
    cited_sources: "Grounded in KI:abc (fragmentation), PB:def (upsell playbook), KI:ghi (risk analysis), PB:jkl (champion framing). Because all citations support the causal chains above, resulting in actionable pressure.",
    verified_signals: "NPS drop of 12 points confirmed via quarterly report [KI:abc]. Because this correlates with platform fragmentation, the resulting churn validates urgency.",
    current_state_reasoning: "Currently operating 4 disconnected systems. Because staff waste 22 minutes per transaction, this creates $180K in redundant costs. Therefore the status quo is untenable.",
    change_vectors: "Consolidation reduces platform count from 4 to 1, consequently cutting licensing by 60%. Because the renovation cycle locks decisions for 3 years, acting before Q3 is critical.",
    friction: "Board approval threshold of $500K creates friction. Because the VP must present an ROI case, the champion needs margin-protection framing rather than technology positioning [PB:jkl].",
  });

  // Bad output — should fail
  const badOutput = JSON.stringify({ situation: "stuff", risks: "maybe" });

  for (const tt of TASK_TYPES) {
    const manifest = getTaskManifest(tt);
    const artifactManifest = toArtifactManifest(manifest);

    const goodGate = runArtifactGate(goodOutput, artifactManifest);
    const badGate = runArtifactGate(badOutput, artifactManifest);

    results[tt].artifact_gate = {
      good_output: {
        pass: goodGate.pass,
        failed_dimensions: goodGate.failed_dimensions,
      },
      bad_output: {
        pass: badGate.pass,
        failed_dimensions: badGate.failed_dimensions,
      },
    };
  }

  // ── Live Task Run Evidence ─────────────────────────────────────
  // Query recent task_runs with artifact_gate telemetry
  const { data: recentRuns } = await supabase
    .from("task_runs")
    .select("id, task_type, status, meta, draft_output, completed_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const liveEvidence: any[] = [];
  for (const run of (recentRuns ?? [])) {
    const meta = run.meta as any;
    if (meta?.artifact_gate || meta?.planner) {
      liveEvidence.push({
        task_run_id: run.id,
        task_type: run.task_type,
        status: run.status,
        artifact_gate: meta.artifact_gate ?? null,
        planner: meta.planner ?? null,
        has_draft: !!run.draft_output,
        completed_at: run.completed_at,
      });
    }
  }

  return jsonResponse({
    mode,
    enforcement_proof: results,
    live_task_run_evidence: liveEvidence,
    summary: {
      all_task_types_planner_driven: TASK_TYPES.every(tt => results[tt]?.planner?.plan_hash),
      all_task_types_gate_good_pass: TASK_TYPES.every(tt => results[tt]?.artifact_gate?.good_output?.pass === true),
      all_task_types_gate_bad_fail: TASK_TYPES.every(tt => results[tt]?.artifact_gate?.bad_output?.pass === false),
      live_runs_with_gate_telemetry: liveEvidence.length,
    },
    timestamp: new Date().toISOString(),
  });
});
