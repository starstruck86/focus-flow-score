// ════════════════════════════════════════════════════════════════
// Working Thesis Memory tests — proves cross-session continuity.
//
// Pure tests against the merge helper + an in-memory fake supabase
// for load/save round-trips. No edge function spin-up, no streaming,
// no provider transport — the contract under test is the state
// machine itself, which is the seam that prevents amnesia.
// ════════════════════════════════════════════════════════════════

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emptyWorkingThesisState,
  loadWorkingThesisState,
  mergeWorkingThesisState,
  renderWorkingThesisStateBlock,
  saveWorkingThesisState,
  type WorkingThesisState,
} from "../_shared/strategy-core/thesisMemory.ts";

// ──────────────────────────────────────────────────────────────────
// Tiny in-memory fake of the supabase chain we use.
// ──────────────────────────────────────────────────────────────────
function makeFakeSupabase() {
  const rows: any[] = [];
  let idCounter = 1;

  function from(table: string) {
    if (table !== "account_strategy_memory") {
      throw new Error("unexpected table: " + table);
    }
    return chain();
  }

  function chain() {
    const filters: Record<string, any> = {};
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let mode: "select" | "insert" | "update" | null = null;
    let updatePayload: any = null;
    let insertPayload: any = null;

    const api: any = {
      select() { mode = "select"; return api; },
      insert(p: any) { mode = "insert"; insertPayload = p; return api; },
      update(p: any) { mode = "update"; updatePayload = p; return api; },
      eq(col: string, val: any) { filters[col] = val; return api; },
      order(col: string, opts: any) {
        orderBy = { col, asc: opts?.ascending !== false };
        return api;
      },
      limit(n: number) { limitN = n; return api; },
      async maybeSingle() { return runSelect(true); },
      async single() { return runSelect(true); },
      then(resolve: any, reject: any) {
        // Allow `await api` to terminate insert/update.
        return runTerminal().then(resolve, reject);
      },
    };

    async function runTerminal() {
      if (mode === "insert") {
        const row = { id: String(idCounter++), updated_at: new Date().toISOString(), ...insertPayload };
        rows.push(row);
        return { data: row, error: null };
      }
      if (mode === "update") {
        const matches = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        for (const m of matches) Object.assign(m, updatePayload, { updated_at: new Date().toISOString() });
        return { data: matches, error: null };
      }
      if (mode === "select") return runSelect(false);
      return { data: null, error: null };
    }

    function runSelect(single: boolean) {
      let matches = rows.filter((r) =>
        Object.entries(filters).every(([k, v]) => r[k] === v),
      );
      if (orderBy) {
        matches = [...matches].sort((a, b) => {
          const av = a[orderBy!.col];
          const bv = b[orderBy!.col];
          return orderBy!.asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
      if (limitN) matches = matches.slice(0, limitN);
      if (single) return Promise.resolve({ data: matches[0] ?? null, error: null });
      return Promise.resolve({ data: matches, error: null });
    }

    return api;
  }

  return { from, _rows: rows };
}

const ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-0000000000aa";

// ──────────────────────────────────────────────────────────────────
// 1. Seller correction kills the prior hypothesis.
// ──────────────────────────────────────────────────────────────────
Deno.test("merge: seller correction kills the prior thesis as a dead hypothesis", () => {
  const prior = emptyWorkingThesisState(ACCOUNT_ID);
  prior.current_thesis = "Broker channel is the primary growth lever.";
  prior.confidence = "INFER";

  const next = mergeWorkingThesisState(prior, {
    current_thesis: "Direct-to-borrower is the growth channel; brokers are flat.",
    confidence: "VALID",
    thesis_change_reason: "Seller: VP Originations confirmed brokers flat, direct fastest-growing.",
  });

  assertEquals(next.current_thesis, "Direct-to-borrower is the growth channel; brokers are flat.");
  assertEquals(next.confidence, "VALID");
  assertEquals(next.killed_hypotheses.length, 1);
  assertEquals(next.killed_hypotheses[0].hypothesis, "Broker channel is the primary growth lever.");
  assertStringIncludes(next.killed_hypotheses[0].killed_by, "VP Originations");
});

// ──────────────────────────────────────────────────────────────────
// 2. New fact updates the SAME thesis instead of generating a fresh
//    unrelated one — i.e. evidence appended, thesis preserved when not
//    contradicted, leakage and confidence updated in place.
// ──────────────────────────────────────────────────────────────────
Deno.test("merge: new fact updates current thesis in place rather than replacing it", () => {
  const prior = emptyWorkingThesisState(ACCOUNT_ID);
  prior.current_thesis = "Direct-to-borrower is the growth channel; brokers are flat.";
  prior.current_leakage = "Hypothesis: rising direct-channel CAC.";
  prior.confidence = "HYPO";
  prior.supporting_evidence = ["VP confirmed brokers flat."];

  const next = mergeWorkingThesisState(prior, {
    // No new current_thesis — the seller's fact REFINES, not replaces.
    current_leakage: "Repeat-borrower retention at 18% (vs ~35% industry floor).",
    confidence: "VALID",
    add_evidence: ["VP confirmed CAC is flat.", "VP confirmed repeat-borrower rate is 18%."],
    kill_hypotheses: [{
      hypothesis: "Direct-channel CAC is rising and is the leak.",
      killed_by: "VP confirmed CAC is flat.",
    }],
    resolve_open_questions: ["Is direct-channel CAC rising?"],
  });

  // Same thesis — preserved.
  assertEquals(next.current_thesis, "Direct-to-borrower is the growth channel; brokers are flat.");
  // Leakage updated in place.
  assertStringIncludes(next.current_leakage, "18%");
  assertEquals(next.confidence, "VALID");
  // Evidence appended (and dedup'd).
  assertEquals(next.supporting_evidence.length, 3);
  assert(next.supporting_evidence.includes("VP confirmed CAC is flat."));
  // CAC hypothesis explicitly killed.
  assertEquals(next.killed_hypotheses.length, 1);
  assertEquals(
    next.killed_hypotheses[0].hypothesis,
    "Direct-channel CAC is rising and is the leak.",
  );
});

// ──────────────────────────────────────────────────────────────────
// 3. A reopened conversation rehydrates prior state from storage.
// ──────────────────────────────────────────────────────────────────
Deno.test("rehydration: load returns the saved state on a later session", async () => {
  const sb = makeFakeSupabase();
  const state: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID, "thread-1"),
    current_thesis: "Lima One has solved acquisition but not retention.",
    current_leakage: "18% repeat-borrower rate vs ~35% industry floor.",
    confidence: "VALID",
    supporting_evidence: ["VP confirmed 18% repeat rate.", "CAC is flat."],
    killed_hypotheses: [
      { hypothesis: "Broker channel is the lever.", killed_by: "VP: brokers flat.", killed_at: new Date().toISOString() },
      { hypothesis: "Direct CAC is rising.", killed_by: "VP: CAC flat.", killed_at: new Date().toISOString() },
    ],
    open_questions: ["Why is repeat rate so low?"],
  };
  await saveWorkingThesisState(sb as any, { userId: USER_ID, state });

  // Simulate a brand new session (different "thread" — same account).
  const reloaded = await loadWorkingThesisState(sb as any, {
    userId: USER_ID,
    accountId: ACCOUNT_ID,
  });
  assert(reloaded, "expected rehydrated state, got null");
  assertEquals(reloaded!.current_thesis, state.current_thesis);
  assertEquals(reloaded!.killed_hypotheses.length, 2);
  assertEquals(reloaded!.confidence, "VALID");
  assertStringIncludes(reloaded!.current_leakage, "18%");
});

// ──────────────────────────────────────────────────────────────────
// 4. Save then save again — one row per (user, account). No history
//    bloat, no orphan rows. Last write wins.
// ──────────────────────────────────────────────────────────────────
Deno.test("save: upserts a single row per (user, account)", async () => {
  const sb = makeFakeSupabase();
  const v1: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Thesis v1",
    confidence: "HYPO",
  };
  await saveWorkingThesisState(sb as any, { userId: USER_ID, state: v1 });

  const v2: WorkingThesisState = { ...v1, current_thesis: "Thesis v2", confidence: "VALID" };
  await saveWorkingThesisState(sb as any, { userId: USER_ID, state: v2 });

  const rows = (sb as any)._rows.filter((r: any) => r.memory_type === "working_thesis");
  assertEquals(rows.length, 1, "should keep exactly one working_thesis row per account");
  const parsed = JSON.parse(rows[0].content);
  assertEquals(parsed.current_thesis, "Thesis v2");
  assertEquals(parsed.confidence, "VALID");
});

// ──────────────────────────────────────────────────────────────────
// 5. Dead hypotheses stay dead unless explicitly revived.
//    Re-merging an unchanged thesis cannot resurrect a killed one.
// ──────────────────────────────────────────────────────────────────
Deno.test("merge: dead hypotheses persist across merges and cannot be silently revived", () => {
  let state = emptyWorkingThesisState(ACCOUNT_ID);
  state.current_thesis = "Direct-to-borrower is the growth channel.";
  state = mergeWorkingThesisState(state, {
    kill_hypotheses: [{
      hypothesis: "Broker channel is the lever.",
      killed_by: "VP: brokers are flat.",
    }],
  });
  assertEquals(state.killed_hypotheses.length, 1);

  // A bunch of unrelated merges over multiple turns — dead must remain dead.
  state = mergeWorkingThesisState(state, { add_evidence: ["CAC is flat."] });
  state = mergeWorkingThesisState(state, { confidence: "VALID" });
  state = mergeWorkingThesisState(state, {
    current_leakage: "Repeat-borrower rate at 18%.",
    add_open_questions: ["Why is repeat rate low?"],
  });

  assertEquals(state.killed_hypotheses.length, 1);
  assertEquals(state.killed_hypotheses[0].hypothesis, "Broker channel is the lever.");

  // Duplicate kill is a no-op (dedup) — no double-kill rows.
  state = mergeWorkingThesisState(state, {
    kill_hypotheses: [{
      hypothesis: "Broker channel is the lever.",
      killed_by: "Re-stated.",
    }],
  });
  assertEquals(state.killed_hypotheses.length, 1, "dedup by hypothesis text");
});

// ──────────────────────────────────────────────────────────────────
// 6. The rendered prompt block exposes thesis, dead hypotheses, and
//    open questions to the model — i.e. account-linked chat with
//    saved state cannot ignore that state.
// ──────────────────────────────────────────────────────────────────
Deno.test("render: prompt block surfaces thesis, dead hypotheses, and open questions", () => {
  const state: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Lima One solved acquisition but not retention.",
    current_leakage: "18% repeat-borrower rate.",
    confidence: "VALID",
    supporting_evidence: ["VP confirmed 18%."],
    killed_hypotheses: [{
      hypothesis: "Broker channel is the lever.",
      killed_by: "VP: brokers flat.",
      killed_at: new Date().toISOString(),
    }],
    open_questions: ["Why is repeat rate so low?"],
  };
  const block = renderWorkingThesisStateBlock(state);
  assertStringIncludes(block, "=== CURRENT WORKING THESIS STATE ===");
  assertStringIncludes(block, "CURRENT THESIS (VALID)");
  assertStringIncludes(block, "Lima One solved acquisition but not retention.");
  assertStringIncludes(block, "DEAD HYPOTHESES");
  assertStringIncludes(block, "Broker channel is the lever.");
  assertStringIncludes(block, "OPEN QUESTIONS");
  assertStringIncludes(block, "Why is repeat rate so low?");
  assertStringIncludes(block, "do not revive");
});

// Empty state → empty block (no theatrical header on a brand-new account).
Deno.test("render: empty state produces empty block (no dangling header)", () => {
  const block = renderWorkingThesisStateBlock(emptyWorkingThesisState(ACCOUNT_ID));
  assertEquals(block, "");
});
