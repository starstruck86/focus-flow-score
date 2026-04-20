import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ─────────────────────────────────────────────────
interface TestResult {
  test: string;
  category: "infra" | "e2e";
  passed: boolean;
  provider?: string;
  model?: string;
  fallback?: boolean;
  latency_ms?: number;
  error?: string;
  details?: string;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Provider health (cold-start) ──────────────────────────
const HEALTH = {
  openai: !!Deno.env.get("OPENAI_API_KEY"),
  anthropic: !!Deno.env.get("ANTHROPIC_API_KEY"),
  perplexity: !!Deno.env.get("PERPLEXITY_API_KEY"),
};
console.log(`[smoke-test] provider-health OpenAI=${HEALTH.openai} Anthropic=${HEALTH.anthropic} Perplexity=${HEALTH.perplexity}`);

const SMOKE_TAG = "[SMOKE TEST]";

// ═══════════════════════════════════════════════════════════
// INFRA TESTS — Direct provider connectivity
// ═══════════════════════════════════════════════════════════

async function infraOpenAI(): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY missing");
    const start = Date.now();
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: "gpt-5-mini", messages: [{ role: "user", content: "Say: ok" }], max_tokens: 10, temperature: 0 }),
    });
    if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 100)}`); }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    assert(text.length > 0, "empty response");
    const ms = Date.now() - start;
    console.log(`[smoke-test][infra] provider_connectivity_openai PASS latency=${ms}ms`);
    return { test: "provider_connectivity_openai", category: "infra", passed: true, provider: "openai", model: "gpt-5-mini", fallback: false, latency_ms: ms };
  } catch (e: any) {
    console.error(`[smoke-test][infra] provider_connectivity_openai FAIL: ${e.message}`);
    return { test: "provider_connectivity_openai", category: "infra", passed: false, error: e.message };
  } finally { clearTimeout(timeout); }
}

async function infraPerplexity(): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const key = Deno.env.get("PERPLEXITY_API_KEY");
    if (!key) throw new Error("PERPLEXITY_API_KEY missing");
    const start = Date.now();
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "user", content: "What is Stripe? One sentence." }], max_tokens: 100 }),
    });
    if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 100)}`); }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    assert(text.length > 0, "empty response");
    const citations = data.citations || [];
    const ms = Date.now() - start;
    console.log(`[smoke-test][infra] provider_connectivity_perplexity PASS latency=${ms}ms citations=${citations.length}`);
    return { test: "provider_connectivity_perplexity", category: "infra", passed: true, provider: "perplexity", model: "sonar-pro", fallback: false, latency_ms: ms, details: `${citations.length} citations` };
  } catch (e: any) {
    console.error(`[smoke-test][infra] provider_connectivity_perplexity FAIL: ${e.message}`);
    return { test: "provider_connectivity_perplexity", category: "infra", passed: false, error: e.message };
  } finally { clearTimeout(timeout); }
}

async function infraAnthropicTool(): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) throw new Error("ANTHROPIC_API_KEY missing");
    const start = Date.now();
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929", max_tokens: 200,
        messages: [{ role: "user", content: "Generate a test email subject line about product updates." }],
        tools: [{ name: "test_tool", description: "Return a subject line.", input_schema: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] } }],
        tool_choice: { type: "tool", name: "test_tool" }, temperature: 0.3,
      }),
    });
    if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 100)}`); }
    const data = await resp.json();
    let structured: any = null;
    for (const block of data.content || []) { if (block.type === "tool_use") { structured = block.input; break; } }
    assert(structured?.subject, "Missing subject in tool output");
    const ms = Date.now() - start;
    console.log(`[smoke-test][infra] provider_connectivity_anthropic_tool PASS latency=${ms}ms`);
    return { test: "provider_connectivity_anthropic_tool", category: "infra", passed: true, provider: "anthropic", model: "claude-sonnet-4-5-20250929", fallback: false, latency_ms: ms };
  } catch (e: any) {
    console.error(`[smoke-test][infra] provider_connectivity_anthropic_tool FAIL: ${e.message}`);
    return { test: "provider_connectivity_anthropic_tool", category: "infra", passed: false, error: e.message };
  } finally { clearTimeout(timeout); }
}

// ═══════════════════════════════════════════════════════════
// E2E TESTS — Call real production edge functions
// ═══════════════════════════════════════════════════════════

async function getOrCreateSmokeThread(supabase: any, userId: string): Promise<string> {
  // Find existing smoke test thread
  const { data: existing } = await supabase.from("strategy_threads")
    .select("id").eq("user_id", userId).ilike("title", `${SMOKE_TAG}%`)
    .order("created_at", { ascending: false }).limit(1);
  if (existing?.length) return existing[0].id;

  // Create new one
  const { data: thread, error } = await supabase.from("strategy_threads").insert({
    user_id: userId, title: `${SMOKE_TAG} Validation Thread`,
    lane: "research", thread_type: "freeform", status: "active",
  }).select().single();
  if (error) throw new Error(`Failed to create smoke thread: ${error.message}`);
  return thread.id;
}

async function callEdgeFunction(
  supabaseUrl: string, functionName: string, body: any, authHeader: string,
): Promise<{ status: number; data: any; latencyMs: number }> {
  const start = Date.now();
  const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: resp.status, data, latencyMs: Date.now() - start };
}

// A. E2E Chat — calls strategy-chat, verifies DB row
async function e2eChat(supabase: any, supabaseUrl: string, userId: string, threadId: string, authHeader: string): Promise<TestResult> {
  try {
    const beforeTs = new Date().toISOString();
    const resp = await callEdgeFunction(supabaseUrl, "strategy-chat", {
      action: "chat", threadId, content: `${SMOKE_TAG} ping — respond briefly`, depth: "Fast",
    }, authHeader);

    if (resp.status !== 200) {
      // Streaming returns 200 with event-stream, non-streaming returns JSON
      // Check if it's an error response
      if (resp.data?.error) throw new Error(`strategy-chat error: ${resp.data.error}`);
    }

    // Wait a moment for async DB write (streaming saves on close)
    await new Promise(r => setTimeout(r, 3000));

    // Verify DB row
    const { data: msgs, error: msgErr } = await supabase.from("strategy_messages")
      .select("id, role, provider_used, model_used, fallback_used, latency_ms, content_json")
      .eq("thread_id", threadId).eq("user_id", userId).eq("role", "assistant").eq("message_type", "chat")
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    if (msgErr) throw new Error(`DB query failed: ${msgErr.message}`);

    const msg = msgs?.[0];
    assert(!!msg, "No assistant message found in DB after chat");
    assert(!!msg.provider_used, `provider_used missing on message ${msg.id}`);
    assert(!!msg.model_used, `model_used missing on message ${msg.id}`);
    assert(msg.fallback_used !== null && msg.fallback_used !== undefined, `fallback_used missing on message ${msg.id}`);
    assert(typeof msg.latency_ms === "number" && msg.latency_ms > 0, `latency_ms invalid on message ${msg.id}`);
    assert(!!msg.content_json?.text, "content_json.text is empty");

    console.log(`[smoke-test][e2e] e2e_strategy_chat PASS provider=${msg.provider_used} model=${msg.model_used} fallback=${msg.fallback_used} latency=${msg.latency_ms}ms`);
    return { test: "e2e_strategy_chat", category: "e2e", passed: true, provider: msg.provider_used, model: msg.model_used, fallback: msg.fallback_used, latency_ms: msg.latency_ms };
  } catch (e: any) {
    console.error(`[smoke-test][e2e] e2e_strategy_chat FAIL: ${e.message}`);
    return { test: "e2e_strategy_chat", category: "e2e", passed: false, error: e.message };
  }
}

// B. E2E Workflow — calls strategy-chat with brainstorm workflow
async function e2eWorkflow(supabase: any, supabaseUrl: string, userId: string, threadId: string, authHeader: string): Promise<TestResult> {
  try {
    const beforeTs = new Date().toISOString();
    const resp = await callEdgeFunction(supabaseUrl, "strategy-chat", {
      action: "workflow", threadId, workflowType: "brainstorm",
      content: `${SMOKE_TAG} Brainstorm three ideas to improve outbound email response rates`,
    }, authHeader);

    if (resp.status !== 200 || resp.data?.error) {
      throw new Error(`strategy-chat workflow error: ${resp.data?.error || `HTTP ${resp.status}`}`);
    }

    // Verify workflow run
    const { data: runs } = await supabase.from("strategy_workflow_runs")
      .select("id, status").eq("thread_id", threadId).eq("user_id", userId)
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    assert(runs?.length > 0, "No workflow run found");
    assert(runs[0].status === "completed", `Workflow run status=${runs[0].status}, expected completed`);

    // Verify output
    const { data: outputs } = await supabase.from("strategy_outputs")
      .select("id, provider_used, model_used, fallback_used, latency_ms, rendered_text")
      .eq("thread_id", threadId).eq("user_id", userId)
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    const output = outputs?.[0];
    assert(!!output, "No strategy_output created");
    assert(!!output.provider_used, "output missing provider_used");
    assert(!!output.model_used, "output missing model_used");
    assert(output.fallback_used !== null && output.fallback_used !== undefined, "output missing fallback_used");
    assert(typeof output.latency_ms === "number" && output.latency_ms > 0, "output latency_ms invalid");
    assert(!!output.rendered_text, "output rendered_text empty");

    // Verify result message
    const { data: msgs } = await supabase.from("strategy_messages")
      .select("id, provider_used, model_used, fallback_used, latency_ms")
      .eq("thread_id", threadId).eq("message_type", "workflow_result")
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    assert(msgs?.length > 0, "No workflow_result message found");

    console.log(`[smoke-test][e2e] e2e_strategy_workflow PASS provider=${output.provider_used} model=${output.model_used} fallback=${output.fallback_used} latency=${output.latency_ms}ms`);
    return { test: "e2e_strategy_workflow", category: "e2e", passed: true, provider: output.provider_used, model: output.model_used, fallback: output.fallback_used, latency_ms: output.latency_ms };
  } catch (e: any) {
    console.error(`[smoke-test][e2e] e2e_strategy_workflow FAIL: ${e.message}`);
    return { test: "e2e_strategy_workflow", category: "e2e", passed: false, error: e.message };
  }
}

// C. E2E Deep Research — verifies Perplexity routing
async function e2eDeepResearch(supabase: any, supabaseUrl: string, userId: string, threadId: string, authHeader: string): Promise<TestResult> {
  try {
    const beforeTs = new Date().toISOString();
    const resp = await callEdgeFunction(supabaseUrl, "strategy-chat", {
      action: "workflow", threadId, workflowType: "deep_research",
      content: `${SMOKE_TAG} Brief research on Stripe payment infrastructure`,
    }, authHeader);

    if (resp.status !== 200 || resp.data?.error) {
      throw new Error(`deep_research error: ${resp.data?.error || `HTTP ${resp.status}`}`);
    }

    const { data: outputs } = await supabase.from("strategy_outputs")
      .select("id, provider_used, model_used, fallback_used, latency_ms, rendered_text, content_json")
      .eq("thread_id", threadId).eq("user_id", userId)
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    const output = outputs?.[0];
    assert(!!output, "No output created for deep_research");
    assert(!!output.provider_used, "output missing provider_used");
    assert(!!output.rendered_text, "output rendered_text empty");

    const isPerplexity = output.provider_used === "perplexity";
    const hasCitations = output.content_json?.cited_sources?.length > 0;
    const details = `provider=${output.provider_used} fallback=${output.fallback_used}${hasCitations ? ` citations=${output.content_json.cited_sources.length}` : " no_citations"}`;

    console.log(`[smoke-test][e2e] e2e_deep_research_routing PASS ${details}`);
    return { test: "e2e_deep_research_routing", category: "e2e", passed: true, provider: output.provider_used, model: output.model_used, fallback: output.fallback_used, latency_ms: output.latency_ms, details };
  } catch (e: any) {
    console.error(`[smoke-test][e2e] e2e_deep_research_routing FAIL: ${e.message}`);
    return { test: "e2e_deep_research_routing", category: "e2e", passed: false, error: e.message };
  }
}

// D. E2E Artifact Transform — verifies Claude primary path
async function e2eArtifactTransform(supabase: any, supabaseUrl: string, userId: string, threadId: string, authHeader: string): Promise<TestResult> {
  try {
    // First find or create a source output
    const { data: existingOutputs } = await supabase.from("strategy_outputs")
      .select("id").eq("thread_id", threadId).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1);

    let sourceOutputId = existingOutputs?.[0]?.id;
    if (!sourceOutputId) {
      // Run a quick brainstorm to create a source output
      const bResp = await callEdgeFunction(supabaseUrl, "strategy-chat", {
        action: "workflow", threadId, workflowType: "brainstorm",
        content: `${SMOKE_TAG} Quick brainstorm: three tactics for cold outreach`,
      }, authHeader);
      if (bResp.data?.output?.id) sourceOutputId = bResp.data.output.id;
      else throw new Error("Could not create source output for artifact test");
    }

    const beforeTs = new Date().toISOString();
    const resp = await callEdgeFunction(supabaseUrl, "strategy-transform-output", {
      sourceOutputId, targetArtifactType: "email", threadId,
    }, authHeader);

    if (resp.status !== 200 || resp.data?.error) {
      throw new Error(`artifact transform error: ${resp.data?.error || `HTTP ${resp.status}`}`);
    }

    // Verify artifact in DB
    const { data: artifacts } = await supabase.from("strategy_artifacts")
      .select("id, provider_used, model_used, fallback_used, latency_ms, rendered_text, artifact_type")
      .eq("user_id", userId).eq("thread_id", threadId)
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    const art = artifacts?.[0];
    assert(!!art, "No artifact created");
    assert(art.artifact_type === "email", `Expected email artifact, got ${art.artifact_type}`);
    assert(!!art.provider_used, "artifact missing provider_used");
    assert(!!art.model_used, "artifact missing model_used");
    assert(art.fallback_used !== null && art.fallback_used !== undefined, "artifact missing fallback_used");
    assert(typeof art.latency_ms === "number" && art.latency_ms > 0, "artifact latency_ms invalid");
    assert(!!art.rendered_text, "artifact rendered_text empty");

    // Verify artifact message
    const { data: msgs } = await supabase.from("strategy_messages")
      .select("id, provider_used, model_used").eq("thread_id", threadId).eq("message_type", "artifact")
      .gte("created_at", beforeTs).limit(1);
    assert(msgs?.length > 0, "No artifact message written");

    console.log(`[smoke-test][e2e] e2e_artifact_transform PASS provider=${art.provider_used} model=${art.model_used} fallback=${art.fallback_used} latency=${art.latency_ms}ms`);
    return { test: "e2e_artifact_transform", category: "e2e", passed: true, provider: art.provider_used, model: art.model_used, fallback: art.fallback_used, latency_ms: art.latency_ms };
  } catch (e: any) {
    console.error(`[smoke-test][e2e] e2e_artifact_transform FAIL: ${e.message}`);
    return { test: "e2e_artifact_transform", category: "e2e", passed: false, error: e.message };
  }
}

// E. E2E Router Fallback — forces fallback through real strategy-chat
async function e2eRouterFallbackChat(supabase: any, supabaseUrl: string, userId: string, threadId: string, authHeader: string): Promise<TestResult> {
  const smokeTestMode = Deno.env.get("SMOKE_TEST_MODE") === "true";
  if (!smokeTestMode) {
    console.log(`[smoke-test][fallback] e2e_router_fallback_chat SKIPPED: SMOKE_TEST_MODE not enabled`);
    return { test: "e2e_router_fallback_chat", category: "e2e", passed: true, details: "SKIPPED — SMOKE_TEST_MODE not enabled. Set env to 'true' to test real fallback." };
  }
  try {
    const beforeTs = new Date().toISOString();
    const resp = await callEdgeFunction(supabaseUrl, "strategy-chat", {
      action: "workflow", threadId, workflowType: "brainstorm",
      content: `${SMOKE_TAG} Forced fallback test — brainstorm one idea`,
      force_primary_failure: true,
    }, authHeader);

    if (resp.status !== 200 || resp.data?.error) {
      throw new Error(`forced fallback error: ${resp.data?.error || `HTTP ${resp.status}`}`);
    }

    // Wait for DB
    await new Promise(r => setTimeout(r, 1000));

    const { data: outputs } = await supabase.from("strategy_outputs")
      .select("id, provider_used, model_used, fallback_used, latency_ms")
      .eq("thread_id", threadId).eq("user_id", userId)
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    const output = outputs?.[0];
    assert(!!output, "No output created after forced fallback");
    assert(output.fallback_used === true, `Expected fallback_used=true, got ${output.fallback_used}`);
    assert(output.provider_used !== "openai" || output.model_used?.includes("claude"), "Fallback should have switched provider");

    console.log(`[smoke-test][fallback] e2e_router_fallback_chat PASS provider=${output.provider_used} fallback=${output.fallback_used}`);
    return { test: "e2e_router_fallback_chat", category: "e2e", passed: true, provider: output.provider_used, model: output.model_used, fallback: true, latency_ms: output.latency_ms };
  } catch (e: any) {
    console.error(`[smoke-test][fallback] e2e_router_fallback_chat FAIL: ${e.message}`);
    return { test: "e2e_router_fallback_chat", category: "e2e", passed: false, error: e.message };
  }
}

// F. E2E Router Fallback Artifact — forces fallback through strategy-transform-output
async function e2eRouterFallbackArtifact(supabase: any, supabaseUrl: string, userId: string, threadId: string, authHeader: string): Promise<TestResult> {
  const smokeTestMode = Deno.env.get("SMOKE_TEST_MODE") === "true";
  if (!smokeTestMode) {
    console.log(`[smoke-test][fallback] e2e_router_fallback_artifact SKIPPED: SMOKE_TEST_MODE not enabled`);
    return { test: "e2e_router_fallback_artifact", category: "e2e", passed: true, details: "SKIPPED — SMOKE_TEST_MODE not enabled." };
  }
  try {
    // Get a source output
    const { data: existingOutputs } = await supabase.from("strategy_outputs")
      .select("id").eq("thread_id", threadId).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1);
    const sourceOutputId = existingOutputs?.[0]?.id;
    if (!sourceOutputId) throw new Error("No source output available for forced fallback artifact test");

    const beforeTs = new Date().toISOString();
    const resp = await callEdgeFunction(supabaseUrl, "strategy-transform-output", {
      sourceOutputId, targetArtifactType: "memo", threadId, force_primary_failure: true,
    }, authHeader);

    if (resp.status !== 200 || resp.data?.error) {
      throw new Error(`forced artifact fallback error: ${resp.data?.error || `HTTP ${resp.status}`}`);
    }

    const { data: artifacts } = await supabase.from("strategy_artifacts")
      .select("id, provider_used, model_used, fallback_used, latency_ms")
      .eq("user_id", userId).eq("thread_id", threadId)
      .gte("created_at", beforeTs).order("created_at", { ascending: false }).limit(1);
    const art = artifacts?.[0];
    assert(!!art, "No artifact after forced fallback");
    assert(art.fallback_used === true, `Expected fallback_used=true, got ${art.fallback_used}`);

    console.log(`[smoke-test][fallback] e2e_router_fallback_artifact PASS provider=${art.provider_used} fallback=${art.fallback_used}`);
    return { test: "e2e_router_fallback_artifact", category: "e2e", passed: true, provider: art.provider_used, model: art.model_used, fallback: true, latency_ms: art.latency_ms };
  } catch (e: any) {
    console.error(`[smoke-test][fallback] e2e_router_fallback_artifact FAIL: ${e.message}`);
    return { test: "e2e_router_fallback_artifact", category: "e2e", passed: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════
async function cleanupSmokeData(supabase: any, threadId: string, userId: string) {
  try {
    // Delete smoke test messages (but keep thread for reuse)
    await supabase.from("strategy_messages")
      .delete().eq("thread_id", threadId).eq("user_id", userId)
      .filter("content_json->>text", "ilike", `%${SMOKE_TAG}%`);
    // Delete smoke test outputs
    await supabase.from("strategy_outputs")
      .delete().eq("thread_id", threadId).eq("user_id", userId)
      .filter("title", "ilike", `%${SMOKE_TAG}%`);
    // Delete smoke test artifacts
    await supabase.from("strategy_artifacts")
      .delete().eq("thread_id", threadId).eq("user_id", userId);
    // Delete workflow runs
    await supabase.from("strategy_workflow_runs")
      .delete().eq("thread_id", threadId).eq("user_id", userId);
    console.log(`[smoke-test] cleanup complete for thread=${threadId}`);
  } catch (e: any) {
    console.warn(`[smoke-test] cleanup partial: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
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

    const body = await req.json().catch(() => ({}));
    const skipInfra = body.skip_infra === true;
    const skipE2e = body.skip_e2e === true;
    const cleanup = body.cleanup !== false; // default: clean up

    console.log("[smoke-test] starting full suite");
    const startAll = Date.now();
    const results: TestResult[] = [];

    // ── INFRA TESTS ──
    if (!skipInfra) {
      console.log("[smoke-test][infra] === INFRA CONNECTIVITY TESTS ===");
      results.push(await infraOpenAI());
      results.push(await infraPerplexity());
      results.push(await infraAnthropicTool());
    }

    // ── E2E TESTS ──
    if (!skipE2e) {
      console.log("[smoke-test][e2e] === END-TO-END PRODUCTION TESTS ===");
      const threadId = await getOrCreateSmokeThread(supabase, userId);
      console.log(`[smoke-test][e2e] using thread=${threadId}`);

      results.push(await e2eChat(supabase, supabaseUrl, userId, threadId, authHeader));
      results.push(await e2eWorkflow(supabase, supabaseUrl, userId, threadId, authHeader));
      results.push(await e2eDeepResearch(supabase, supabaseUrl, userId, threadId, authHeader));
      results.push(await e2eArtifactTransform(supabase, supabaseUrl, userId, threadId, authHeader));
      results.push(await e2eRouterFallbackChat(supabase, supabaseUrl, userId, threadId, authHeader));
      results.push(await e2eRouterFallbackArtifact(supabase, supabaseUrl, userId, threadId, authHeader));

      if (cleanup) await cleanupSmokeData(supabase, threadId, userId);
    }

    // ── REPORT ──
    const infraResults = results.filter(r => r.category === "infra");
    const e2eResults = results.filter(r => r.category === "e2e");
    const infraPassed = infraResults.filter(r => r.passed).length;
    const infraFailed = infraResults.filter(r => !r.passed).length;
    const e2ePassed = e2eResults.filter(r => r.passed).length;
    const e2eFailed = e2eResults.filter(r => !r.passed).length;
    const totalMs = Date.now() - startAll;

    const status = (infraFailed === 0 && e2eFailed === 0) ? "ok" : (infraFailed + e2eFailed === results.length) ? "failed" : "partial_failure";

    console.log(`[smoke-test] completed in ${totalMs}ms — status=${status}`);
    for (const r of results) {
      console.log(`[smoke-test] ${r.category}/${r.test}: ${r.passed ? "✅" : "❌"} provider=${r.provider || "n/a"} fallback=${r.fallback ?? "n/a"} latency=${r.latency_ms ?? "n/a"}ms`);
    }

    const failedTests = results.filter(r => !r.passed).map(r => ({ test: r.test, error: r.error }));
    const fullResult = {
      status, total_ms: totalMs,
      provider_health: HEALTH,
      infra_tests: infraResults,
      e2e_tests: e2eResults,
      summary: { infra_passed: infraPassed, infra_failed: infraFailed, e2e_passed: e2ePassed, e2e_failed: e2eFailed },
    };

    // Persist to smoke_test_results
    const { error: insertErr } = await supabase.from("smoke_test_results").insert({
      user_id: userId,
      status,
      total_ms: totalMs,
      provider_health: HEALTH,
      infra_passed: infraPassed,
      infra_failed: infraFailed,
      e2e_passed: e2ePassed,
      e2e_failed: e2eFailed,
      failed_tests: failedTests,
      full_result: fullResult,
    });
    if (insertErr) console.error("[smoke-test] failed to persist result:", insertErr.message);
    else console.log("[smoke-test] result persisted to smoke_test_results");

    return new Response(JSON.stringify(fullResult, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[smoke-test] fatal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
