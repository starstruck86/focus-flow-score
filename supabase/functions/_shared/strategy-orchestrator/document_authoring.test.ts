// ════════════════════════════════════════════════════════════════
// Deterministic proof tests for the document_authoring stage.
//
// Strategy: stub global `fetch` so we never hit any provider.
// We control:
//   - Claude responses (success / malformed / hang / error)
//   - Lovable AI synthesis + review responses
//   - Supabase REST writes (in-memory row state)
//
// Goal: prove the row never stays in `pending` under any failure mode.
// ════════════════════════════════════════════════════════════════

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runStrategyTask } from "./runTask.ts";

// Required env (callClaude / callLovableAI throw if absent).
Deno.env.set("ANTHROPIC_API_KEY", "test");
Deno.env.set("LOVABLE_API_KEY", "test");
Deno.env.set("OPENAI_API_KEY", "test");
Deno.env.set("PERPLEXITY_API_KEY", "test");

// ── In-memory supabase mock (only the chains the orchestrator uses) ──
function makeFakeSupabase() {
  const rows: Record<string, any> = {};
  let seq = 0;

  function from(_table: string) {
    const ctx: any = {};
    const exec = async () => {
      if (ctx.insert) {
        const id = `run_${++seq}`;
        rows[id] = { id, ...ctx.insert };
        return { data: { id }, error: null };
      }
      if (ctx.upsert) {
        // Best-effort no-op upsert: succeed without mutating tracked run rows.
        return { data: null, error: null, count: 0 };
      }
      if (ctx.update && ctx.eq) {
        const row = rows[ctx.eq.val];
        if (row) Object.assign(row, ctx.update);
        return { data: row, error: null };
      }
      if (ctx.select && ctx.eq) {
        return { data: rows[ctx.eq.val] ?? null, error: null };
      }
      // bare .select() with no filter — used by libraryRetrieval; return empty.
      if (ctx.select) return { data: [], error: null };
      return { data: null, error: null };
    };
    const b: any = {
      insert(v: any) { ctx.insert = v; return b; },
      update(v: any) { ctx.update = v; return b; },
      upsert(v: any, _opts?: any) { ctx.upsert = v; return b; },
      delete() { ctx.delete = true; return b; },
      select(c?: string) { ctx.select = c || "*"; return b; },
      eq(col: string, val: any) { ctx.eq = { col, val }; return b; },
      neq() { return b; },
      in() { return b; },
      or() { return b; },
      ilike() { return b; },
      overlaps() { return b; },
      contains() { return b; },
      is() { return b; },
      gt() { return b; },
      gte() { return b; },
      lt() { return b; },
      lte() { return b; },
      not() { return b; },
      limit() { return b; },
      range() { return b; },
      order() { return b; },
      single() { return exec(); },
      maybeSingle() { return exec(); },
      then(res: any, rej: any) { return exec().then(res, rej); },
    };
    return b;
  }
  return { from, _rows: rows };
}

// ── fetch stub: route by URL ──────────────────────────────────────
type ClaudeBehavior =
  | { kind: "ok"; text: string }
  | { kind: "hang" }
  | { kind: "error"; status: number; body?: string };

function installFetch(opts: {
  synthesisJson: string;
  reviewJson?: string;
  claude: ClaudeBehavior;
}) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);

    // Anthropic — Claude document author
    if (u.includes("api.anthropic.com")) {
      if (opts.claude.kind === "hang") {
        // Respect AbortSignal so the stage-level timeout still fires.
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      if (opts.claude.kind === "error") {
        return new Response(opts.claude.body ?? "boom", { status: opts.claude.status });
      }
      const body = { content: [{ type: "text", text: opts.claude.text }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Lovable AI Gateway — synthesis (stage 2) and review (stage 4)
    if (u.includes("ai.gateway.lovable.dev")) {
      const isReview = JSON.stringify(init?.body || "").includes("reviewing a prep document");
      const text = isReview ? (opts.reviewJson ?? '{"strengths":[],"redlines":[]}') : opts.synthesisJson;
      const body = { choices: [{ message: { content: text } }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Anything else (perplexity, etc.) — empty success.
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
  }) as any;
  return () => { globalThis.fetch = original; };
}

async function runWith(opts: {
  synthesisJson: string;
  claude: ClaudeBehavior;
  reviewJson?: string;
  compressTimers?: boolean;
}) {
  const restoreFetch = installFetch(opts);

  // Optionally compress long timers (>=1000ms) so the 90s authoring
  // timeout fires immediately. Short timers (Claude retry backoff,
  // microtasks, etc.) keep their real behavior.
  let restoreTimer: (() => void) | null = null;
  if (opts.compressTimers) {
    const realSet = globalThis.setTimeout;
    (globalThis as any).setTimeout = ((fn: any, ms: number, ...rest: any[]) =>
      realSet(fn, ms >= 1000 ? 0 : ms, ...rest)) as any;
    restoreTimer = () => { globalThis.setTimeout = realSet; };
  }

  const supabase = makeFakeSupabase();
  let threw: any = null;
  try {
    await runStrategyTask({
      supabase: supabase as any,
      userId: "user_1",
      // NOTE: account_brief — not discovery_prep — exercises the monolithic
      // Stage 3 Claude authoring path that this file is designed to prove.
      // discovery_prep now hands off to a separate progressive driver in a
      // fresh isolate (see runTask.ts line ~328) and would never reach the
      // assertions below from within this test process.
      taskType: "account_brief",
      inputs: { company_name: "Acme" } as any,
    });
  } catch (e) {
    threw = e;
  }

  restoreFetch();
  restoreTimer?.();

  const finalRow = Object.values(supabase._rows)[0] as any;
  return { finalRow, threw };
}

// ──────────────────────────────────────────────────────────────────
// Test 1 — happy path
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: success → status=completed", async () => {
  const { finalRow, threw } = await runWith({
    synthesisJson: JSON.stringify({ ok: true }),
    claude: { kind: "ok", text: JSON.stringify({ sections: [{ id: "s1", heading: "H", content: "body" }] }) },
  });
  assertEquals(threw, null);
  assertEquals(finalRow.status, "completed");
  assertEquals(finalRow.progress_step, "completed");
  assertEquals(finalRow.draft_output.sections.length, 1);
});

// ──────────────────────────────────────────────────────────────────
// Test 2 — malformed JSON
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: malformed JSON → status=failed with parse error", async () => {
  const { finalRow, threw } = await runWith({
    synthesisJson: JSON.stringify({ ok: true }),
    claude: { kind: "ok", text: "this is plain prose with no json structure at all" },
  });
  assert(threw, "expected throw");
  assertEquals(finalRow.status, "failed");
  assertEquals(finalRow.progress_step, "failed");
  assertStringIncludes(finalRow.error, "[document_authoring]");
  assertStringIncludes(finalRow.error, "invalid JSON");
});

// ──────────────────────────────────────────────────────────────────
// Test 3 — JSON parses but missing sections
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: missing sections array → status=failed", async () => {
  const { finalRow, threw } = await runWith({
    synthesisJson: JSON.stringify({ ok: true }),
    claude: { kind: "ok", text: JSON.stringify({ summary: "no sections key" }) },
  });
  assert(threw);
  assertEquals(finalRow.status, "failed");
  assertStringIncludes(finalRow.error, "missing sections array");
});

// ──────────────────────────────────────────────────────────────────
// Test 4 — provider error (4xx, no retry)
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: Claude 400 → status=failed with provider error", async () => {
  const { finalRow, threw } = await runWith({
    synthesisJson: JSON.stringify({ ok: true }),
    claude: { kind: "error", status: 400, body: "bad request" },
  });
  assert(threw);
  assertEquals(finalRow.status, "failed");
  assertEquals(finalRow.progress_step, "failed");
  assertStringIncludes(finalRow.error, "[document_authoring]");
  assertStringIncludes(finalRow.error, "Claude error: 400");
});

// ──────────────────────────────────────────────────────────────────
// Test 5 — hang. Stage-level 90s timeout must fire.
//   We compress timers so the 90s race timer fires immediately while
//   the fetch stub respects AbortSignal. The retry-backoff timers
//   (3s, 9s) also compress, but the first attempt's AbortController
//   timeout (180s in providers.ts) and the stage race (90s) will
//   both compress; whichever wins, the row must still land at failed.
// ──────────────────────────────────────────────────────────────────
Deno.test({
  name: "document_authoring: hang → stage timeout writes status=failed",
  // The stage-level race resolves quickly, but callClaude's internal retry
  // loop keeps firing in the background. Those timers/sockets are orphaned
  // by design — the row is already marked failed and the worker exits when
  // the edge function shuts down. Disable sanitizers for this test only.
  sanitizeOps: false,
  sanitizeResources: false,
  sanitizeExit: false,
  fn: async () => {
    const { finalRow, threw } = await runWith({
      synthesisJson: JSON.stringify({ ok: true }),
      claude: { kind: "hang" },
      compressTimers: true,
    });
    assert(threw, "expected throw on hang");
    assertEquals(finalRow.status, "failed");
    assertEquals(finalRow.progress_step, "failed");
    assertStringIncludes(finalRow.error, "[document_authoring]");
  },
});

// ──────────────────────────────────────────────────────────────────
// Test 6 — invariant: no failure mode leaves the row in `pending`.
// ──────────────────────────────────────────────────────────────────
Deno.test({
  name: "document_authoring: invariant — row never stuck in pending",
  sanitizeOps: false,
  sanitizeResources: false,
  sanitizeExit: false,
  fn: async () => {
    const cases: { name: string; claude: ClaudeBehavior; compress?: boolean }[] = [
      { name: "malformed", claude: { kind: "ok", text: "garbage" } },
      { name: "wrong-shape", claude: { kind: "ok", text: '{"x":1}' } },
      { name: "provider-400", claude: { kind: "error", status: 400 } },
      { name: "provider-500-then-fail", claude: { kind: "error", status: 500 }, compress: true },
      { name: "hang", claude: { kind: "hang" }, compress: true },
    ];
    for (const c of cases) {
      const { finalRow } = await runWith({
        synthesisJson: JSON.stringify({ ok: true }),
        claude: c.claude,
        compressTimers: c.compress,
      });
      assert(
        finalRow && finalRow.status === "failed" && finalRow.progress_step === "failed",
        `case "${c.name}" left row at status=${finalRow?.status}/${finalRow?.progress_step}`,
      );
      assert(finalRow.completed_at, `case "${c.name}" missing completed_at`);
    }
  },
});
