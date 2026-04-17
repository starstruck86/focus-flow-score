// ════════════════════════════════════════════════════════════════
// Strategy Thesis — Fallback Extractor Tests
//
// Proves the surgical reliability patch: thesis memory still updates
// when the model forgets to emit the fenced ```thesis_update block.
//
// Contract under test:
//   • Fenced block (when present) wins. Fallback never runs.
//   • Fallback runs ONLY when the fenced block is missing/unparsable.
//   • Fallback returns null on ambiguous prose (saves nothing).
//   • Fallback output flows through validateWorkingThesisState — so
//     it cannot revive killed hypotheses or self-promote to VALID.
//
// Golden before/after example (see "useful update saved without
// fenced block" test below).
// ════════════════════════════════════════════════════════════════

import {
  assertEquals,
  assert,
  assertExists,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  emptyWorkingThesisState,
  extractThesisPatchFromProse,
  mergeWorkingThesisState,
  validateWorkingThesisState,
  type WorkingThesisState,
} from "../_shared/strategy-core/thesisMemory.ts";

const ACCOUNT = "acct_lima_one";
const THREAD = "thr_lima_one";

// Mirrors how strategy-chat/index.ts decides which patch to use.
function pickEffectivePatch(
  fencedPatch: any | null,
  visibleText: string,
): { patch: any | null; source: "fenced" | "fallback" | "none" } {
  if (fencedPatch) return { patch: fencedPatch, source: "fenced" };
  const inferred = extractThesisPatchFromProse(visibleText);
  if (inferred) return { patch: inferred, source: "fallback" };
  return { patch: null, source: "none" };
}

// ──────────────────────────────────────────────────────────────────
// 1. Fenced block wins — fallback does not run when fenced is present.
// ──────────────────────────────────────────────────────────────────
Deno.test("fenced thesis_update block wins over prose fallback", () => {
  const fenced = {
    current_thesis: "Repeat-borrower retention is the real wedge.",
    thesis_change_reason: "VP confirmed 18% repeat rate.",
    seller_confirmed: true,
    add_evidence: ["VP confirmed 18% repeat-borrower rate"],
  };
  const prose =
    "Throw out the broker thesis. The real thesis is fix-and-flip volume. Seller said deal flow is down.";

  const { patch, source } = pickEffectivePatch(fenced, prose);
  assertEquals(source, "fenced");
  assertEquals(
    patch.current_thesis,
    "Repeat-borrower retention is the real wedge.",
  );
});

// ──────────────────────────────────────────────────────────────────
// 2. Fallback runs when fenced block is missing.
// ──────────────────────────────────────────────────────────────────
Deno.test("fallback extractor runs when fenced block missing", () => {
  const prose = `We should throw out the broker thesis. The real thesis is repeat-borrower retention.
The VP confirmed only 18% of borrowers come back for a second loan.
Open question: what is the average repeat lag time?`;

  const { patch, source } = pickEffectivePatch(null, prose);
  assertEquals(source, "fallback");
  assertExists(patch);
  // Thesis was inferred.
  assert(
    /repeat-borrower retention/i.test(patch.current_thesis ?? ""),
    `expected thesis to mention repeat-borrower retention, got: ${patch.current_thesis}`,
  );
  // Killed hypothesis captured.
  assert(
    (patch.kill_hypotheses ?? []).some((k: any) =>
      /broker/i.test(k.hypothesis)
    ),
    "expected broker hypothesis to be killed",
  );
  // Seller evidence captured + seller_confirmed set.
  assertEquals(patch.seller_confirmed, true);
  assert((patch.add_evidence ?? []).length >= 1, "expected seller evidence");
  // Open question captured.
  assert(
    (patch.add_open_questions ?? []).some((q: string) =>
      /repeat lag/i.test(q)
    ),
    "expected open question about repeat lag",
  );
});

// ──────────────────────────────────────────────────────────────────
// 3. Ambiguous prose → fallback returns null → nothing is saved.
// ──────────────────────────────────────────────────────────────────
Deno.test("fallback returns null on ambiguous prose", () => {
  const ambiguous =
    "Lima One is an interesting account. There are some opportunities here we should think about more carefully before the next call.";
  const { patch, source } = pickEffectivePatch(null, ambiguous);
  assertEquals(source, "none");
  assertEquals(patch, null);
});

Deno.test("fallback returns null on tiny / empty prose", () => {
  assertEquals(extractThesisPatchFromProse(""), null);
  assertEquals(extractThesisPatchFromProse("   "), null);
  assertEquals(extractThesisPatchFromProse("Sounds good."), null);
});

// ──────────────────────────────────────────────────────────────────
// 4. Fallback output is still constrained by the validator —
//    cannot self-promote to VALID without grounding.
// ──────────────────────────────────────────────────────────────────
Deno.test("fallback patch flows through validator (no self-promotion to VALID)", () => {
  // Prose that names a thesis but provides NO seller evidence and NO
  // numeric grounding. Even if we pretend it set confidence=VALID, the
  // validator must downgrade.
  const prose = `Current thesis: pricing pressure is the dominant headwind.
Confidence: VALID.`;
  const inferred = extractThesisPatchFromProse(prose);
  assertExists(inferred);
  assertEquals(inferred!.confidence, "VALID");

  const prior = emptyWorkingThesisState(ACCOUNT, THREAD);
  const { patch: safe, downgrades } = validateWorkingThesisState(prior, inferred!);
  // No seller_confirmed, no add_evidence → must be downgraded.
  assertEquals(safe.confidence, "INFER");
  assert(
    downgrades.some((d) => /VALID/.test(d)),
    "expected a VALID-downgrade message",
  );
});

// ──────────────────────────────────────────────────────────────────
// 5. A bad fallback cannot revive killed hypotheses.
// ──────────────────────────────────────────────────────────────────
Deno.test("fallback cannot revive a killed hypothesis silently", () => {
  // Prior: broker thesis is already dead.
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT, THREAD),
    current_thesis: "Repeat-borrower retention is the wedge.",
    confidence: "INFER",
    killed_hypotheses: [
      {
        hypothesis: "Broker channel is the wedge",
        killed_by: "VP said brokers are flat",
        killed_at: new Date().toISOString(),
      },
    ],
  };

  // Assistant prose tries to declare the dead thesis as current again,
  // with no revive_hypothesis_reason and no seller_confirmed.
  const prose =
    "Current thesis: Broker channel is the wedge. We should refocus there.";
  const inferred = extractThesisPatchFromProse(prose);
  assertExists(inferred);

  const { patch: safe, downgrades } = validateWorkingThesisState(prior, inferred!);
  // Validator must drop the zombie revival.
  assertEquals(
    safe.current_thesis,
    undefined,
    "zombie current_thesis must be dropped",
  );
  assert(
    downgrades.some((d) => /revive/i.test(d)),
    "expected a revive-refused downgrade message",
  );

  // After merge, the prior thesis is preserved unchanged.
  const next = mergeWorkingThesisState(prior, safe);
  assertEquals(
    next.current_thesis,
    "Repeat-borrower retention is the wedge.",
  );
  // And the broker hypothesis stays dead.
  assertEquals(next.killed_hypotheses.length, 1);
});

// ──────────────────────────────────────────────────────────────────
// 6. GOLDEN before/after — useful update saved without fenced block.
//
// BEFORE this patch:
//   Model emits the prose below WITHOUT the fenced thesis_update block
//   → strategy-chat sees patch=null → nothing is persisted →
//   next session has amnesia about the broker kill.
//
// AFTER this patch:
//   Same prose → fallback infers a structured patch → validator passes
//   it (seller-confirmed grounding) → mergeWorkingThesisState updates
//   state → next session rehydrates with broker dead and the new
//   thesis live.
// ──────────────────────────────────────────────────────────────────
Deno.test("GOLDEN: useful update saved without fenced block", () => {
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT, THREAD),
    current_thesis: "Broker channel is the wedge",
    confidence: "HYPO",
  };

  // This is the exact kind of answer the spec called out:
  // "We should throw out the broker thesis. The real issue is
  //  repeat-borrower retention. The VP confirmed 18%."
  const prose = `We should throw out the broker thesis. The real thesis is repeat-borrower retention.
The VP confirmed that only 18% of borrowers come back for a second loan.`;

  // Simulate the chat handler decision.
  const { patch, source } = pickEffectivePatch(null, prose);
  assertEquals(source, "fallback");
  assertExists(patch);

  const { patch: safe } = validateWorkingThesisState(prior, {
    ...patch,
    thread_id: THREAD,
  });
  const next = mergeWorkingThesisState(prior, safe);

  // Thesis evolved.
  assert(
    /repeat-borrower retention/i.test(next.current_thesis),
    `new thesis should mention repeat-borrower retention, got: ${next.current_thesis}`,
  );
  // Prior thesis was killed (not silently replaced).
  assert(
    next.killed_hypotheses.some((k) => /broker/i.test(k.hypothesis)),
    "prior broker thesis should now be in killed_hypotheses",
  );
  // Seller evidence is captured.
  assert(
    next.supporting_evidence.some((e) => /18/.test(e) && /borrower/i.test(e)),
    "seller-confirmed 18% evidence should be persisted",
  );
});

// ──────────────────────────────────────────────────────────────────
// 7. Unparsable fenced block → fallback still kicks in.
//    (The chat handler treats an unparsable block as "no patch".)
// ──────────────────────────────────────────────────────────────────
Deno.test("unparsable fenced block path still gets fallback coverage", () => {
  // chat handler returns patch=null when JSON.parse fails — simulate
  // that by passing null here, and confirm the fallback runs.
  const prose =
    "Throw out the broker thesis. The VP confirmed 18% repeat-borrower rate is the real issue.";
  const { patch, source } = pickEffectivePatch(null, prose);
  assertEquals(source, "fallback");
  assertExists(patch);
  assertEquals(patch.seller_confirmed, true);
});
