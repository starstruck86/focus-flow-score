/**
 * Temporary Phase 3.5C validation proxy.
 * Runs 5 live cases through run-strategy-eval-synthesis with STRATEGY_VALIDATION_KEY.
 * DELETE after validation.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CASES = [
  { id: "conversation-pov", inputs: { account: "Marriott International", persona: "VP Revenue Management", stage: "Discovery", topic: "Guest data consolidation across property brands" } },
  { id: "commercial-insight", inputs: { topic: "Sales methodology adoption", industry: "Enterprise SaaS", persona: "CRO" } },
  { id: "discovery-prep", inputs: { account: "Hilton Worldwide", persona: "SVP Operations", stage: "Discovery", topic: "Property management system modernization" } },
  { id: "meddicc-review", inputs: { account: "Hyatt Hotels", opportunity: "Enterprise PMS Platform", stage: "Evaluation", persona: "VP IT" } },
  { id: "executive-brief", inputs: { account: "IHG Hotels & Resorts", persona: "CEO", stage: "Decision", topic: "Digital transformation ROI" } },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const results: any[] = [];

  for (const c of CASES) {
    const started = Date.now();
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/run-strategy-eval-synthesis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-validation-key": validationKey || "",
        },
        body: JSON.stringify({ skill: c }),
      });

      const data = await resp.json();
      const latency = Date.now() - started;

      results.push({
        case: c.id,
        status: resp.status,
        scorer_ok: data.ok ?? false,
        gate_pass: data.artifact_gate?.pass ?? null,
        failed_dims: data.artifact_gate?.failed_dimensions ?? [],
        regen_triggered: (data.artifact_gate?.regen_attempts ?? 0) > 0,
        regen_success: data.artifact_gate?.regen_success ?? false,
        artifact_gate_failed: data.artifact_gate_failed ?? false,
        final_winner: data.artifact_gate_failed ? "baseline" : (data.ok ? "strategy" : "baseline"),
        latency_ms: latency,
        adversarial_verdict: data.adversarial?.verdict ?? null,
        gate_details: data.artifact_gate?.gates?.filter((g: any) => !g.pass) ?? [],
      });
    } catch (e) {
      results.push({
        case: c.id,
        status: "error",
        error: String(e).slice(0, 300),
        latency_ms: Date.now() - started,
      });
    }
  }

  const summary = {
    total: results.length,
    strategy_wins: results.filter(r => r.final_winner === "strategy").length,
    gate_passes: results.filter(r => r.gate_pass === true).length,
    gate_failures: results.filter(r => r.gate_pass === false).length,
    regen_triggered: results.filter(r => r.regen_triggered).length,
    regen_successes: results.filter(r => r.regen_success).length,
    errors: results.filter(r => r.status === "error").length,
  };

  return new Response(JSON.stringify({ summary, results }, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
