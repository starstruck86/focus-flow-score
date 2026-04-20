// ════════════════════════════════════════════════════════════════
// strategy-stress-test
//
// Repeatable hostile-validation harness for Strategy.
//
// POST { thread_id, label, prompts: string[], picked_resource_ids?: string[][], notes? }
//   → runs each prompt through the REAL strategy-chat path (same routing,
//     guards, retrieval), then reads back the persisted assistant message
//     to capture ground-truth routing metadata.
//
// GET  ?run_id=...  → returns the run + all turns
// GET  (no run_id)  → lists this user's most recent runs
//
// All evidence is persisted to strategy_stress_runs / strategy_stress_turns.
// ════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface RunBody {
  thread_id: string;
  label: string;
  prompts: string[];
  picked_resource_ids?: Array<string[] | undefined>;
  depth?: string;
  notes?: string;
}

// ── Helpers ─────────────────────────────────────────────────────

function detectIntent(prompt: string): string {
  const t = prompt.toLowerCase();
  if (/\b(grade|evaluate|review|critique|score)\b/.test(t)) return "evaluation";
  if (/\b(synthesi[sz]e|derive|build a (framework|rubric|scoring|system))\b/.test(t)) return "synthesis";
  if (/\b(write|draft|create|build|turn .* into|compose)\b/.test(t)) return "creation";
  if (/\b(thesis|analy[sz]e|what's the|what is the)\b/.test(t)) return "analysis";
  return "freeform";
}

function parseAppendix(text: string): {
  present: boolean;
  audience?: string;
  situation?: string;
  industry?: string;
} {
  // Look for an "Application" / "Adaptation" appendix block with declared
  // Audience: / Situation: / Industry: lines (matches the guard's parser).
  const lower = text.toLowerCase();
  const hasAppendix =
    /application[:\s]/i.test(text) ||
    /adapt(ation|ed)?\s*(for|to)/i.test(text) ||
    (/audience\s*:/i.test(text) && /situation\s*:/i.test(text));

  const audience = text.match(/audience\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const situation = text.match(/situation\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const industry = text.match(/industry\s*:\s*([^\n]+)/i)?.[1]?.trim();

  return {
    present: hasAppendix || !!(audience && situation),
    audience,
    situation,
    industry,
  };
}

async function drainStream(resp: Response): Promise<{
  text: string;
  status: number;
}> {
  if (!resp.body) return { text: "", status: resp.status };
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const j = line.slice(6).trim();
      if (j === "[DONE]") continue;
      try {
        const p = JSON.parse(j);
        const delta = p.choices?.[0]?.delta?.content;
        if (delta) out += delta;
      } catch {
        buf = line + "\n" + buf;
        break;
      }
    }
  }
  // Flush leftover
  if (buf.trim()) {
    for (let raw of buf.split("\n")) {
      if (!raw.startsWith("data: ")) continue;
      const j = raw.slice(6).trim();
      if (j === "[DONE]") continue;
      try {
        const p = JSON.parse(j);
        const delta = p.choices?.[0]?.delta?.content;
        if (delta) out += delta;
      } catch { /* ignore */ }
    }
  }

  return { text: out, status: resp.status };
}

// ── Main ────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: require a real user JWT (RLS enforces ownership)
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "missing auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userJwt = authHeader.slice(7);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userResult, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResult?.user) {
    return new Response(JSON.stringify({ error: "invalid auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const user = userResult.user;

  // ── GET: list runs or fetch one ───────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const runId = url.searchParams.get("run_id");
    if (runId) {
      const { data: run } = await admin
        .from("strategy_stress_runs")
        .select("*")
        .eq("id", runId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!run) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: turns } = await admin
        .from("strategy_stress_turns")
        .select("*")
        .eq("run_id", runId)
        .order("turn_index", { ascending: true });
      return new Response(JSON.stringify({ run, turns: turns ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: runs } = await admin
      .from("strategy_stress_runs")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(25);
    return new Response(JSON.stringify({ runs: runs ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── POST: kick off a stress run ───────────────────────────────
  let body: RunBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body?.thread_id || !Array.isArray(body?.prompts) || body.prompts.length === 0 || !body?.label) {
    return new Response(JSON.stringify({
      error: "thread_id, label, and non-empty prompts[] required",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (body.prompts.length > 30) {
    return new Response(JSON.stringify({ error: "max 30 prompts per run" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify the thread belongs to this user
  const { data: thread } = await admin
    .from("strategy_threads")
    .select("id,user_id")
    .eq("id", body.thread_id)
    .maybeSingle();
  if (!thread || thread.user_id !== user.id) {
    return new Response(JSON.stringify({ error: "thread not owned by user" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create the run row
  const { data: runRow, error: runErr } = await admin
    .from("strategy_stress_runs")
    .insert({
      user_id: user.id,
      thread_id: body.thread_id,
      label: body.label,
      notes: body.notes ?? null,
      total_prompts: body.prompts.length,
      status: "running",
    })
    .select()
    .single();
  if (runErr || !runRow) {
    return new Response(JSON.stringify({ error: runErr?.message ?? "insert failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const runId = runRow.id;
  const chatUrl = `${SUPABASE_URL}/functions/v1/strategy-chat`;

  // Run prompts SEQUENTIALLY in background (preserves thread order;
  // strategy-chat is stateful per thread, so parallel would corrupt context).
  const work = (async () => {
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < body.prompts.length; i++) {
      const prompt = body.prompts[i];
      const pickedIds = body.picked_resource_ids?.[i];
      const intent = detectIntent(prompt);
      const startedAt = new Date().toISOString();
      const t0 = Date.now();

      // Insert turn placeholder
      const { data: turnRow } = await admin
        .from("strategy_stress_turns")
        .insert({
          run_id: runId,
          user_id: user.id,
          thread_id: body.thread_id,
          turn_index: i,
          prompt,
          intent,
          started_at: startedAt,
        })
        .select()
        .single();

      try {
        const resp = await fetch(chatUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userJwt}`,
            apikey: ANON_KEY,
          },
          body: JSON.stringify({
            action: "chat",
            threadId: body.thread_id,
            content: prompt,
            depth: body.depth,
            pickedResourceIds: pickedIds && pickedIds.length > 0 ? pickedIds : undefined,
          }),
        });

        const { text: streamedText, status } = await drainStream(resp);
        const elapsed = Date.now() - t0;

        // Read back the persisted assistant message for *real* routing truth
        const { data: persisted } = await admin
          .from("strategy_messages")
          .select("id, provider_used, model_used, fallback_used, latency_ms, content_json, citations_json, created_at")
          .eq("thread_id", body.thread_id)
          .eq("role", "assistant")
          .gte("created_at", startedAt)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const finalText: string = persisted?.content_json?.text ?? streamedText ?? "";
        const routingDecision = persisted?.content_json?.routing_decision ?? null;
        const retrievalDebug = routingDecision?.retrieval_debug ?? null;
        const appendix = parseAppendix(finalText);
        const violations: string[] = [];
        // Lightweight post-hoc violation tagging (the real guards run
        // server-side; here we just record what we can observe in output).
        if (!appendix.present && (intent === "synthesis" || intent === "creation" || intent === "evaluation")) {
          violations.push("application_missing_appendix");
        }
        if (finalText.trim().length < 200) {
          violations.push("body_too_short");
        }

        await admin
          .from("strategy_stress_turns")
          .update({
            output: finalText.slice(0, 8000),
            output_chars: finalText.length,
            actual_provider: persisted?.provider_used ?? null,
            actual_model: persisted?.model_used ?? null,
            fallback_used: persisted?.fallback_used ?? null,
            latency_ms: persisted?.latency_ms ?? elapsed,
            status_code: status,
            violations,
            appendix_present: appendix.present,
            appendix_audience: appendix.audience ?? null,
            appendix_situation: appendix.situation ?? null,
            appendix_industry: appendix.industry ?? null,
            citation_audit: persisted?.citations_json ?? null,
            assistant_message_id: persisted?.id ?? null,
            finished_at: new Date().toISOString(),
          })
          .eq("id", turnRow!.id);

        if (status >= 200 && status < 300) succeeded++; else failed++;
      } catch (e: any) {
        failed++;
        await admin
          .from("strategy_stress_turns")
          .update({
            error: e?.message ?? String(e),
            finished_at: new Date().toISOString(),
          })
          .eq("id", turnRow!.id);
      }

      // Update run progress
      await admin
        .from("strategy_stress_runs")
        .update({ succeeded, failed })
        .eq("id", runId);
    }

    await admin
      .from("strategy_stress_runs")
      .update({
        status: "completed",
        succeeded,
        failed,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  })();

  // @ts-ignore — Deno edge runtime
  EdgeRuntime.waitUntil(work);

  return new Response(JSON.stringify({
    run_id: runId,
    thread_id: body.thread_id,
    queued: body.prompts.length,
    poll: `GET /functions/v1/strategy-stress-test?run_id=${runId}`,
  }), {
    status: 202,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
