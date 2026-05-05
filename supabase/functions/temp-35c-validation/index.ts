/**
 * Temporary Phase 3.5C single-case validation proxy.
 * Pass ?case=conversation-pov (or any skill id) to run one case.
 * DELETE after validation.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CASES: Record<string, any> = {
  "conversation-pov": { id: "conversation-pov", inputs: { account: "Marriott International", persona: "VP Revenue Management", stage: "Discovery", topic: "Guest data consolidation across property brands" } },
  "commercial-insight": { id: "commercial-insight", inputs: { topic: "Sales methodology adoption", industry: "Enterprise SaaS", persona: "CRO" } },
  "discovery-prep": { id: "discovery-prep", inputs: { account: "Hilton Worldwide", persona: "SVP Operations", stage: "Discovery", topic: "Property management system modernization" } },
  "meddicc-review": { id: "meddicc-review", inputs: { account: "Hyatt Hotels", opportunity: "Enterprise PMS Platform", stage: "Evaluation", persona: "VP IT" } },
  "executive-brief": { id: "executive-brief", inputs: { account: "IHG Hotels & Resorts", persona: "CEO", stage: "Decision", topic: "Digital transformation ROI" } },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const caseId = url.searchParams.get("case") || "conversation-pov";
  const c = CASES[caseId];
  if (!c) return new Response(JSON.stringify({ error: `Unknown case: ${caseId}`, available: Object.keys(CASES) }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const started = Date.now();

  const resp = await fetch(`${supabaseUrl}/functions/v1/run-strategy-eval-synthesis`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-validation-key": validationKey || "" },
    body: JSON.stringify({ skill: c }),
  });

  const data = await resp.json();
  const latency = Date.now() - started;

  return new Response(JSON.stringify({
    case: caseId,
    status: resp.status,
    ok: data.ok,
    gate_pass: data.artifact_gate?.pass ?? null,
    failed_dims: data.artifact_gate?.failed_dimensions ?? [],
    regen_triggered: (data.artifact_gate?.regen_attempts ?? 0) > 0,
    regen_success: data.artifact_gate?.regen_success ?? false,
    artifact_gate_failed: data.artifact_gate_failed ?? false,
    final_winner: data.artifact_gate_failed ? "baseline" : (data.ok ? "strategy" : "baseline"),
    adversarial_verdict: data.adversarial?.verdict ?? null,
    gate_details: data.artifact_gate?.gates ?? [],
    latency_ms: latency,
  }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
});
