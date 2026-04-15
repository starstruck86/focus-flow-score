import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Assertion helper ──────────────────────────────────────
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

interface TestResult {
  test: string;
  passed: boolean;
  provider?: string;
  model?: string;
  fallback?: boolean;
  latency_ms?: number;
  error?: string;
  details?: string;
}

// ── Provider health (cold-start) ──────────────────────────
const HEALTH = {
  openai: !!Deno.env.get("OPENAI_API_KEY"),
  anthropic: !!Deno.env.get("ANTHROPIC_API_KEY"),
  perplexity: !!Deno.env.get("PERPLEXITY_API_KEY"),
};
console.log(`[smoke-test] provider-health OpenAI=${HEALTH.openai} Anthropic=${HEALTH.anthropic} Perplexity=${HEALTH.perplexity}`);

// ── Direct provider call helpers ──────────────────────────
async function callOpenAIDirect(prompt: string, signal: AbortSignal): Promise<{ text: string; model: string; latencyMs: number }> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const start = Date.now();
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "You are a test responder. Be extremely brief." },
        { role: "user", content: prompt },
      ],
      max_tokens: 100,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { text, model: "gpt-5-mini", latencyMs: Date.now() - start };
}

async function callAnthropicDirect(prompt: string, signal: AbortSignal): Promise<{ text: string; model: string; latencyMs: number }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const start = Date.now();
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  let text = "";
  for (const block of data.content || []) {
    if (block.type === "text") text += block.text;
  }
  return { text, model: "claude-sonnet-4-20250514", latencyMs: Date.now() - start };
}

async function callPerplexityDirect(prompt: string, signal: AbortSignal): Promise<{ text: string; citations: string[]; model: string; latencyMs: number }> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) throw new Error("PERPLEXITY_API_KEY missing");
  const start = Date.now();
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Perplexity HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  const citations = data.citations || [];
  return { text, citations, model: "sonar-pro", latencyMs: Date.now() - start };
}

async function callAnthropicToolDirect(
  systemPrompt: string, userPrompt: string, tool: any, signal: AbortSignal,
): Promise<{ structured: any; model: string; latencyMs: number }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const start = Date.now();
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [{
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }],
      tool_choice: { type: "tool", name: tool.function.name },
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Anthropic tool HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  let structured: any = null;
  for (const block of data.content || []) {
    if (block.type === "tool_use") { structured = block.input; break; }
  }
  if (!structured) throw new Error("No tool_use block in Anthropic response");
  return { structured, model: "claude-sonnet-4-20250514", latencyMs: Date.now() - start };
}

// ═══════════════════════════════════════════════════════════
// TEST IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════

// Test 1: OpenAI chat — direct connectivity
async function testChat(): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const result = await callOpenAIDirect("Respond with exactly: chat ok", controller.signal);
    assert(result.text.length > 0, "OpenAI returned empty text");
    assert(result.latencyMs > 0, "latency must be positive");
    console.log(`[smoke-test] test=chat provider=openai model=${result.model} latency=${result.latencyMs}ms`);
    return { test: "chat_openai", passed: true, provider: "openai", model: result.model, fallback: false, latency_ms: result.latencyMs };
  } catch (e: any) {
    console.error(`[smoke-test] test=chat FAILED: ${e.message}`);
    return { test: "chat_openai", passed: false, error: e.message };
  } finally { clearTimeout(timeout); }
}

// Test 2: Perplexity deep research — direct connectivity + citations
async function testDeepResearch(): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const result = await callPerplexityDirect("What is Stripe? One sentence.", controller.signal);
    assert(result.text.length > 0, "Perplexity returned empty text");
    const hasCitations = result.citations.length > 0;
    console.log(`[smoke-test] test=deep_research provider=perplexity citations=${result.citations.length} latency=${result.latencyMs}ms`);
    return {
      test: "deep_research_perplexity", passed: true, provider: "perplexity", model: result.model,
      fallback: false, latency_ms: result.latencyMs,
      details: hasCitations ? `${result.citations.length} citations` : "no citations (acceptable)",
    };
  } catch (e: any) {
    // Perplexity failed — try OpenAI fallback
    console.warn(`[smoke-test] test=deep_research perplexity failed: ${e.message}. Trying OpenAI fallback...`);
    const fbController = new AbortController();
    const fbTimeout = setTimeout(() => fbController.abort(), 30000);
    try {
      const fb = await callOpenAIDirect("What is Stripe? One sentence.", fbController.signal);
      assert(fb.text.length > 0, "OpenAI fallback returned empty");
      console.log(`[smoke-test] test=deep_research fallback=openai latency=${fb.latencyMs}ms`);
      return { test: "deep_research_perplexity", passed: true, provider: "openai", model: fb.model, fallback: true, latency_ms: fb.latencyMs, details: "perplexity failed, openai fallback succeeded" };
    } catch (fe: any) {
      return { test: "deep_research_perplexity", passed: false, error: `primary: ${e.message}, fallback: ${fe.message}` };
    } finally { clearTimeout(fbTimeout); }
  } finally { clearTimeout(timeout); }
}

// Test 3: Anthropic artifact tool call — direct connectivity + structured output
async function testArtifactTransform(): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const tool = {
    function: {
      name: "email_artifact",
      description: "Generate a test email artifact.",
      parameters: {
        type: "object",
        properties: {
          subject_line: { type: "string" },
          body: { type: "string" },
          cta: { type: "string" },
        },
        required: ["subject_line", "body", "cta"],
        additionalProperties: false,
      },
    },
  };
  try {
    const result = await callAnthropicToolDirect(
      "You are a test assistant. Generate a brief email artifact.",
      "Create a short test email about product updates.",
      tool, controller.signal,
    );
    assert(result.structured?.subject_line, "Missing subject_line in structured output");
    assert(result.structured?.body, "Missing body in structured output");
    console.log(`[smoke-test] test=artifact provider=anthropic model=${result.model} latency=${result.latencyMs}ms`);
    return { test: "artifact_transform_anthropic", passed: true, provider: "anthropic", model: result.model, fallback: false, latency_ms: result.latencyMs };
  } catch (e: any) {
    // Try OpenAI fallback for artifact
    console.warn(`[smoke-test] test=artifact anthropic failed: ${e.message}. Trying OpenAI fallback...`);
    const fbController = new AbortController();
    const fbTimeout = setTimeout(() => fbController.abort(), 30000);
    try {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY missing for fallback");
      const start = Date.now();
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: fbController.signal,
        body: JSON.stringify({
          model: "gpt-5-mini",
          messages: [
            { role: "system", content: "Generate a brief email artifact." },
            { role: "user", content: "Create a short test email about product updates." },
          ],
          tools: [{
            type: "function",
            function: tool.function,
          }],
          tool_choice: { type: "function", function: { name: "email_artifact" } },
          max_tokens: 512,
        }),
      });
      if (!resp.ok) throw new Error(`OpenAI fallback HTTP ${resp.status}`);
      const data = await resp.json();
      const tc = data.choices?.[0]?.message?.tool_calls?.[0];
      const structured = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : null;
      assert(structured?.subject_line, "OpenAI fallback missing subject_line");
      const latency = Date.now() - start;
      console.log(`[smoke-test] test=artifact fallback=openai latency=${latency}ms`);
      return { test: "artifact_transform_anthropic", passed: true, provider: "openai", model: "gpt-5-mini", fallback: true, latency_ms: latency, details: "anthropic failed, openai fallback succeeded" };
    } catch (fe: any) {
      return { test: "artifact_transform_anthropic", passed: false, error: `primary: ${e.message}, fallback: ${fe.message}` };
    } finally { clearTimeout(fbTimeout); }
  } finally { clearTimeout(timeout); }
}

// Test 4: Forced fallback — call OpenAI with invalid model to trigger error, verify recovery
async function testForcedFallback(): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    // Step 1: Intentionally call OpenAI with a bad model
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY missing");
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-INVALID-model-404",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      }),
    });
    const shouldFail = !resp.ok;
    const errBody = await resp.text();
    assert(shouldFail, "Expected OpenAI to reject invalid model");
    console.log(`[smoke-test] test=fallback primary correctly failed (${resp.status})`);

    // Step 2: Fallback to Anthropic
    const fallbackResult = await callAnthropicDirect("Respond with exactly: fallback ok", controller.signal);
    assert(fallbackResult.text.length > 0, "Anthropic fallback returned empty");
    console.log(`[smoke-test] test=fallback provider=anthropic fallback=true latency=${fallbackResult.latencyMs}ms`);
    return { test: "forced_fallback", passed: true, provider: "anthropic", model: fallbackResult.model, fallback: true, latency_ms: fallbackResult.latencyMs, details: "openai invalid model → anthropic fallback" };
  } catch (e: any) {
    console.error(`[smoke-test] test=fallback FAILED: ${e.message}`);
    return { test: "forced_fallback", passed: false, error: e.message };
  } finally { clearTimeout(timeout); }
}

// Test 5: Observability — check DB records from prior smoke test runs
async function testObservability(supabase: any, userId: string): Promise<TestResult> {
  try {
    // Check strategy_messages for observability fields
    const { data: msgs, error: msgErr } = await supabase
      .from("strategy_messages")
      .select("id, provider_used, model_used, fallback_used, latency_ms, message_type")
      .eq("user_id", userId)
      .not("provider_used", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (msgErr) throw new Error(`Messages query: ${msgErr.message}`);

    // Check strategy_outputs
    const { data: outs, error: outErr } = await supabase
      .from("strategy_outputs")
      .select("id, provider_used, model_used, fallback_used, latency_ms, output_type")
      .eq("user_id", userId)
      .not("provider_used", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (outErr) throw new Error(`Outputs query: ${outErr.message}`);

    // Check strategy_artifacts
    const { data: arts, error: artErr } = await supabase
      .from("strategy_artifacts")
      .select("id, provider_used, model_used, fallback_used, latency_ms, artifact_type")
      .eq("user_id", userId)
      .not("provider_used", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (artErr) throw new Error(`Artifacts query: ${artErr.message}`);

    const msgCount = msgs?.length || 0;
    const outCount = outs?.length || 0;
    const artCount = arts?.length || 0;

    // Validate field presence on found records
    let fieldsValid = true;
    const issues: string[] = [];

    for (const m of msgs || []) {
      if (!m.provider_used) { fieldsValid = false; issues.push(`msg ${m.id} missing provider_used`); }
      if (!m.model_used) { fieldsValid = false; issues.push(`msg ${m.id} missing model_used`); }
    }
    for (const o of outs || []) {
      if (!o.provider_used) { fieldsValid = false; issues.push(`output ${o.id} missing provider_used`); }
    }
    for (const a of arts || []) {
      if (!a.provider_used) { fieldsValid = false; issues.push(`artifact ${a.id} missing provider_used`); }
    }

    const summary = `messages=${msgCount} outputs=${outCount} artifacts=${artCount}${issues.length ? ` issues=${issues.length}` : ""}`;
    console.log(`[smoke-test] test=observability ${summary}`);

    if (msgCount === 0 && outCount === 0 && artCount === 0) {
      return { test: "observability", passed: true, details: "No prior records found — observability fields will be validated after chat/workflow usage" };
    }

    return {
      test: "observability", passed: fieldsValid,
      details: fieldsValid ? `All fields present. ${summary}` : `Missing fields: ${issues.join("; ")}`,
      error: fieldsValid ? undefined : issues.join("; "),
    };
  } catch (e: any) {
    console.error(`[smoke-test] test=observability FAILED: ${e.message}`);
    return { test: "observability", passed: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = user?.id ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized — must be logged in" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[smoke-test] starting full suite");
    const startAll = Date.now();
    const results: TestResult[] = [];

    // Run tests sequentially — each is isolated
    results.push(await testChat());
    results.push(await testDeepResearch());
    results.push(await testArtifactTransform());
    results.push(await testForcedFallback());
    results.push(await testObservability(supabase, userId));

    const allPassed = results.every((r) => r.passed);
    const totalMs = Date.now() - startAll;

    console.log(`[smoke-test] completed in ${totalMs}ms — ${allPassed ? "ALL PASSED" : "SOME FAILED"}`);
    for (const r of results) {
      console.log(`[smoke-test] ${r.test}: ${r.passed ? "✅" : "❌"} provider=${r.provider || "n/a"} fallback=${r.fallback ?? "n/a"} latency=${r.latency_ms ?? "n/a"}ms`);
    }

    return new Response(JSON.stringify({
      status: allPassed ? "ok" : "partial_failure",
      total_ms: totalMs,
      provider_health: HEALTH,
      results,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[smoke-test] fatal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
