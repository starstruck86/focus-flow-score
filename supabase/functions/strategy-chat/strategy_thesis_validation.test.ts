// ════════════════════════════════════════════════════════════════
// Working Thesis Memory — VALIDATION (trust boundary) tests.
//
// Saved thesis state must be MORE disciplined than the model. These
// tests prove that the validator catches the five failure modes that
// would otherwise let a confident bad guess get persisted as truth.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emptyWorkingThesisState,
  mergeWorkingThesisState,
  validateWorkingThesisState,
  type WorkingThesisState,
} from "../_shared/strategy-core/thesisMemory.ts";

const ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

// ──────────────────────────────────────────────────────────────────
// 1. Model-only pattern match cannot self-promote to VALID.
//    No seller_confirmed, no add_evidence, no carried evidence ⇒
//    VALID is downgraded to INFER.
// ──────────────────────────────────────────────────────────────────
Deno.test("validator: model pattern-match cannot self-promote to VALID", () => {
  const prior = emptyWorkingThesisState(ACCOUNT_ID); // no supporting_evidence
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    current_thesis: "Broker channel is the lever.",
    confidence: "VALID",
  });
  assertEquals(patch.confidence, "INFER", "VALID should be downgraded");
  assert(downgrades.some((d) => d.includes("VALID downgraded")));

  // And the merged state reflects the downgrade — not VALID.
  const merged = mergeWorkingThesisState(prior, patch);
  assertEquals(merged.confidence, "INFER");
});

// ──────────────────────────────────────────────────────────────────
// 2. Unsupported numeric claim is downgraded.
//    Thesis or leakage carries a number, no numeric evidence,
//    no seller_confirmed ⇒ confidence capped at INFER.
// ──────────────────────────────────────────────────────────────────
Deno.test("validator: unsupported numeric claim caps confidence at INFER", () => {
  const prior = emptyWorkingThesisState(ACCOUNT_ID);
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    current_thesis: "Lima One is leaving 22 points of LTV on the table per cohort.",
    confidence: "VALID",
    seller_confirmed: false,
    add_evidence: ["VP mentioned retention is a concern."], // no number
  });
  assertEquals(patch.confidence, "INFER");
  assert(
    downgrades.some((d) => d.toLowerCase().includes("numeric")),
    "expected a numeric-claim downgrade message",
  );
});

Deno.test("validator: numeric leakage stays VALID when seller_confirmed + numeric evidence", () => {
  const prior = emptyWorkingThesisState(ACCOUNT_ID);
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    current_leakage: "Repeat-borrower rate is 18% vs ~35% industry floor.",
    confidence: "VALID",
    seller_confirmed: true,
    add_evidence: ["VP confirmed repeat-borrower rate is 18%."],
  });
  assertEquals(patch.confidence, "VALID");
  assertEquals(downgrades.length, 0);
});

// ──────────────────────────────────────────────────────────────────
// 3. Seller-confirmed fact CAN promote thesis confidence.
// ──────────────────────────────────────────────────────────────────
Deno.test("validator: seller-confirmed evidence can promote to VALID", () => {
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Direct-to-borrower is the growth channel.",
    confidence: "INFER",
  };
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    confidence: "VALID",
    seller_confirmed: true,
    add_evidence: ["VP Originations: brokers flat, direct fastest-growing."],
  });
  assertEquals(patch.confidence, "VALID");
  assertEquals(downgrades.length, 0);
});

// ──────────────────────────────────────────────────────────────────
// 4. Killed hypothesis cannot silently become current thesis again.
// ──────────────────────────────────────────────────────────────────
Deno.test("validator: killed hypothesis cannot zombie-revive without explicit reason", () => {
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Direct-to-borrower retention is the leak.",
    killed_hypotheses: [{
      hypothesis: "Broker channel is the lever.",
      killed_by: "VP: brokers flat.",
      killed_at: new Date().toISOString(),
    }],
  };

  // Attempt to silently revive — no revive_hypothesis_reason.
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    current_thesis: "Broker channel is the lever.",
    thesis_change_reason: "rethinking",
  });
  assertEquals(patch.current_thesis, undefined, "thesis change must be dropped");
  assertEquals(patch.thesis_change_reason, undefined);
  assert(downgrades.some((d) => d.toLowerCase().includes("revive")));

  // Merged state must keep the prior thesis intact.
  const merged = mergeWorkingThesisState(prior, patch);
  assertEquals(merged.current_thesis, "Direct-to-borrower retention is the leak.");
  assertEquals(merged.killed_hypotheses.length, 1);
});

Deno.test("validator: explicit revive_hypothesis_reason + seller_confirmed allows revival", () => {
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Direct-to-borrower retention is the leak.",
    killed_hypotheses: [{
      hypothesis: "Broker channel is the lever.",
      killed_by: "VP: brokers flat.",
      killed_at: new Date().toISOString(),
    }],
  };
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    current_thesis: "Broker channel is the lever.",
    thesis_change_reason: "Seller now reports broker volume up 40% MoM.",
    revive_hypothesis_reason: "New seller data: broker volume up 40% MoM since the 18% retention conversation.",
    seller_confirmed: true,
    add_evidence: ["Broker volume up 40% MoM (seller, this call)."],
    confidence: "INFER",
  });
  assertEquals(patch.current_thesis, "Broker channel is the lever.");
  assert(!downgrades.some((d) => d.toLowerCase().includes("revive")));
});

// ──────────────────────────────────────────────────────────────────
// 5. Empty / garbage patch cannot overwrite a good prior thesis.
// ──────────────────────────────────────────────────────────────────
Deno.test("validator: empty current_thesis cannot overwrite a non-empty prior thesis", () => {
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Lima One has solved acquisition but not retention.",
    confidence: "VALID",
    supporting_evidence: ["VP confirmed 18% repeat rate."],
  };
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    current_thesis: "   ",
    thesis_change_reason: "rethinking",
  });
  assertEquals(patch.current_thesis, undefined);
  assertEquals(patch.thesis_change_reason, undefined);
  assert(downgrades.some((d) => d.toLowerCase().includes("empty")));

  const merged = mergeWorkingThesisState(prior, patch);
  assertEquals(merged.current_thesis, "Lima One has solved acquisition but not retention.");
});

// ──────────────────────────────────────────────────────────────────
// 6. Carried supporting_evidence is enough to KEEP a VALID claim
//    on a follow-up turn that doesn't add new evidence — i.e. we're
//    not so paranoid we destroy already-grounded state.
// ──────────────────────────────────────────────────────────────────
Deno.test("validator: VALID survives when prior state already has supporting evidence", () => {
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Lima One has solved acquisition but not retention.",
    supporting_evidence: ["VP confirmed 18% repeat rate.", "CAC is flat."],
    confidence: "VALID",
  };
  const { patch, downgrades } = validateWorkingThesisState(prior, {
    add_open_questions: ["What does their retention team look like today?"],
    confidence: "VALID",
  });
  assertEquals(patch.confidence, "VALID");
  assertEquals(downgrades.length, 0);
});

// ──────────────────────────────────────────────────────────────────
// 7. End-to-end: model emits a confident-but-ungrounded patch with a
//    fabricated economic number; after validation + merge, the saved
//    state is INFER, not VALID, and contains no zombie revival.
// ──────────────────────────────────────────────────────────────────
Deno.test("end-to-end: ungrounded confident patch is sanitized before persistence", () => {
  const prior: WorkingThesisState = {
    ...emptyWorkingThesisState(ACCOUNT_ID),
    current_thesis: "Direct-to-borrower retention is the leak.",
    confidence: "INFER",
    killed_hypotheses: [{
      hypothesis: "Direct-channel CAC is rising and is the leak.",
      killed_by: "VP confirmed CAC is flat.",
      killed_at: new Date().toISOString(),
    }],
  };

  // Model tries to: (a) revive a killed hypothesis, (b) promote to
  // VALID with no evidence, (c) inject a fake $3M number.
  const dirtyPatch = {
    current_thesis: "Direct-channel CAC is rising and is the leak.",
    current_leakage: "Estimated $3M of NIM exposure from CAC inflation.",
    confidence: "VALID" as const,
    thesis_change_reason: "on reflection this seems likely",
  };

  const { patch, downgrades } = validateWorkingThesisState(prior, dirtyPatch);
  const merged = mergeWorkingThesisState(prior, patch);

  // (a) Zombie revival blocked.
  assertEquals(
    merged.current_thesis,
    "Direct-to-borrower retention is the leak.",
  );
  assertEquals(merged.killed_hypotheses.length, 1);
  // (b) VALID downgraded.
  assert(merged.confidence !== "VALID", `expected ≠ VALID, got ${merged.confidence}`);
  // Should be downgraded for at least the zombie + the unsupported VALID.
  assert(downgrades.length >= 2, `expected multiple downgrades, got ${downgrades.length}`);
  assertStringIncludes(downgrades.join(" | ").toLowerCase(), "revive");
});
