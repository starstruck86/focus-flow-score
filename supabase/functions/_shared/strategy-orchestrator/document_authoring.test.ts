// ════════════════════════════════════════════════════════════════
// Deterministic proof tests for the document_authoring stage.
//
// We do NOT call Claude, OpenAI, Perplexity, or Lovable AI here.
// Every external call is mocked. The goal is to prove that the
// stage cannot leave a row stuck in `pending` under any failure
// mode (timeout, malformed JSON, provider error, missing shape).
//
// Run with: deno test --allow-env --allow-net supabase/functions/_shared/strategy-orchestrator/document_authoring.test.ts
// ════════════════════════════════════════════════════════════════

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as providers from "./providers.ts";
import { runStrategyTask } from "./runTask.ts";
import * as registry from "./registry.ts";
import * as libRet from "./libraryRetrieval.ts";

// ── Tiny in-memory stand-in for the supabase client ──────────────
function makeFakeSupabase() {
  const rows: Record<string, any> = {};
  let seq = 0;

  // Returns a chainable query builder used by the orchestrator.
  function from(table: string) {
    let pendingFilter: { col: string; val: any } | null = null;
    let pendingSelect: string | null = null;
    let pendingUpdate: any = null;
    let pendingInsert: any = null;

    const exec = async () => {
      if (pendingInsert) {
        const id = `run_${++seq}`;
        const row = { id, ...pendingInsert };
        rows[id] = row;
        return { data: { id }, error: null };
      }
      if (pendingUpdate && pendingFilter) {
        const row = rows[pendingFilter.val];
        if (row) Object.assign(row, pendingUpdate);
        return { data: row, error: null };
      }
      if (pendingSelect && pendingFilter) {
        return { data: rows[pendingFilter.val], error: null };
      }
      return { data: null, error: null };
    };

    const builder: any = {
      insert(values: any) { pendingInsert = values; return builder; },
      update(values: any) { pendingUpdate = values; return builder; },
      select(_cols?: string) { pendingSelect = _cols || "*"; return builder; },
      eq(col: string, val: any) { pendingFilter = { col, val }; return builder; },
      single() { return exec(); },
      then(resolve: any, reject: any) { return exec().then(resolve, reject); },
    };
    return builder;
  }

  return { from, _rows: rows };
}

const stubHandler = {
  libraryScopes: () => [],
  buildResearchQueries: () => [], // skip Stage 1 entirely
  buildSynthesisPrompt: () => "synth",
  buildDocumentSystemPrompt: () => "sys",
  buildDocumentUserPrompt: () => "user",
  buildReviewPrompt: () => "review",
};

// Monkeypatch getHandler to always return our stub.
(registry as any).getHandler = (_t: string) => stubHandler;

// Stub library retrieval so it doesn't hit DB.
(libRet as any).retrieveLibraryContext = async () => ({
  kis: [], playbooks: [], counts: { kis: 0, playbooks: 0 },
});

// ── Helper: run with mocked providers and return final row state. ─
async function runWith({
  synthesis, claude, claudeDelayMs = 0,
}: {
  synthesis: string;
  claude: () => Promise<string>;
  claudeDelayMs?: number;
}) {
  const originalLovable = providers.callLovableAI;
  const originalClaude = providers.callClaude;

  (providers as any).callLovableAI = async (_msgs: any, _opts: any) => synthesis;
  (providers as any).callClaude = async () => {
    if (claudeDelayMs > 0) await new Promise((r) => setTimeout(r, claudeDelayMs));
    return claude();
  };

  const supabase = makeFakeSupabase();
  let threw: any = null;
  try {
    await runStrategyTask({
      supabase: supabase as any,
      userId: "user_1",
      taskType: "discovery_prep",
      inputs: { company_name: "Acme" } as any,
    });
  } catch (e) {
    threw = e;
  }

  (providers as any).callLovableAI = originalLovable;
  (providers as any).callClaude = originalClaude;

  const finalRow = Object.values(supabase._rows)[0] as any;
  return { finalRow, threw };
}

// ──────────────────────────────────────────────────────────────────
// Test 1: happy path — Claude returns valid JSON quickly.
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: success writes status=completed", async () => {
  const { finalRow, threw } = await runWith({
    synthesis: JSON.stringify({ ok: true }),
    claude: async () => JSON.stringify({ sections: [{ id: "s1", content: "hello" }] }),
  });
  assertEquals(threw, null, "no throw on happy path");
  assertEquals(finalRow.status, "completed");
  assertEquals(finalRow.progress_step, "completed");
  assert(finalRow.draft_output?.sections?.length === 1);
});

// ──────────────────────────────────────────────────────────────────
// Test 2: malformed JSON — must fail with explicit parse error.
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: malformed JSON fails with parse error", async () => {
  const { finalRow, threw } = await runWith({
    synthesis: JSON.stringify({ ok: true }),
    claude: async () => "not json at all, just prose with no braces",
  });
  assert(threw, "should throw");
  assertEquals(finalRow.status, "failed");
  assertEquals(finalRow.progress_step, "failed");
  assertStringIncludes(finalRow.error, "[document_authoring]");
  assertStringIncludes(finalRow.error, "invalid JSON");
});

// ──────────────────────────────────────────────────────────────────
// Test 3: wrong shape — JSON parses but missing sections array.
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: wrong shape fails with missing-sections error", async () => {
  const { finalRow, threw } = await runWith({
    synthesis: JSON.stringify({ ok: true }),
    claude: async () => JSON.stringify({ summary: "no sections key" }),
  });
  assert(threw);
  assertEquals(finalRow.status, "failed");
  assertStringIncludes(finalRow.error, "missing sections array");
});

// ──────────────────────────────────────────────────────────────────
// Test 4: provider error — Claude throws (e.g. 5xx after retries).
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: provider error surfaces and writes failed", async () => {
  const { finalRow, threw } = await runWith({
    synthesis: JSON.stringify({ ok: true }),
    claude: async () => { throw new Error("Claude error: 503 (after retries)"); },
  });
  assert(threw);
  assertEquals(finalRow.status, "failed");
  assertEquals(finalRow.progress_step, "failed");
  assertStringIncludes(finalRow.error, "Claude error: 503");
});

// ──────────────────────────────────────────────────────────────────
// Test 5: hang — Claude never resolves. Stage timeout must fire.
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: hang triggers 90s timeout (compressed via setTimeout stub)", async () => {
  const realSetTimeout = globalThis.setTimeout;
  // Fire any timer >=1000ms instantly. Short timers (DB writes, etc.) keep real behavior.
  (globalThis as any).setTimeout = ((fn: any, ms: number, ...rest: any[]) => {
    if (ms >= 1000) return realSetTimeout(fn, 0, ...rest);
    return realSetTimeout(fn, ms, ...rest);
  }) as any;

  try {
    const { finalRow, threw } = await runWith({
      synthesis: JSON.stringify({ ok: true }),
      // never resolves
      claude: () => new Promise<string>(() => {}),
    });
    assert(threw, "should throw on timeout");
    assertEquals(finalRow.status, "failed");
    assertEquals(finalRow.progress_step, "failed");
    assertStringIncludes(finalRow.error, "[document_authoring]");
    assertStringIncludes(finalRow.error, "timed out");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

// ──────────────────────────────────────────────────────────────────
// Test 6: invariant — under EVERY failure mode the row leaves
// pending and lands at status='failed' with progress_step='failed'.
// ──────────────────────────────────────────────────────────────────
Deno.test("document_authoring: no failure mode leaves row in pending", async () => {
  const failureModes = [
    { name: "malformed", claude: async () => "garbage" },
    { name: "wrong-shape", claude: async () => JSON.stringify({ x: 1 }) },
    { name: "provider-error", claude: async () => { throw new Error("503"); } },
  ];
  for (const mode of failureModes) {
    const { finalRow } = await runWith({
      synthesis: JSON.stringify({ ok: true }),
      claude: mode.claude,
    });
    assert(
      finalRow.status === "failed" && finalRow.progress_step === "failed",
      `mode "${mode.name}" left row in status=${finalRow.status}/${finalRow.progress_step}`,
    );
  }
});
