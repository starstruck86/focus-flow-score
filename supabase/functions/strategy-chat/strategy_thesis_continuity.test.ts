// ════════════════════════════════════════════════════════════════
// Strategy Core — Thesis Continuity Tests
//
// We have already proven (in the memory + validation suites) that:
//   • state persists
//   • unsupported claims get downgraded
//
// This file proves the thing that actually matters to the seller:
// STRATEGIC CONTINUITY. Specifically, that a saved thesis changes
// future behavior the way a sharp human strategist would —
// continuing a line of reasoning instead of restarting it.
//
// The standard we're enforcing:
//   "If the seller disproves the model on Tuesday, Strategy must not
//    quietly act like it never happened on Friday."
//
// These tests are deterministic and pure. They exercise the merge
// rules, the prompt block renderer, the gating heuristic, and the
// chat system prompt composer — the four seams through which saved
// state actually influences a future answer. We deliberately do NOT
// spin up the edge function; the brittle parts live in transport,
// not behavior.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStrategyChatSystemPrompt,
  emptyWorkingThesisState,
  mergeWorkingThesisState,
  renderWorkingThesisStateBlock,
  shouldUseStrategyCorePrompt,
  validateWorkingThesisState,
  type WorkingThesisState,
} from "../_shared/strategy-core/index.ts";

const ACCOUNT_ID = "lima-one-continuity";

// ──────────────────────────────────────────────────────────────────
// GOLDEN FIXTURE — the Lima One line of reasoning.
//
// This is the canonical before/after we want Strategy to preserve
// across turns and across sessions. Tests below reference it by name
// so that a future regression (e.g. the broker hypothesis silently
// reappearing) is loud and obvious in test output.
//
//   Turn 1 — initial thesis (HYPO):
//     "Broker channel is the primary growth lever."
//
//   Turn 2 — seller correction:
//     "Brokers are flat; direct-to-borrower is the real growth."
//     → Broker thesis is DEAD. New thesis: direct-to-borrower CAC is
//       the leak.
//
//   Turn 3 — updated thesis stated back to seller.
//
//   Turn 4 — seller returns from the call with fresh data:
//     "CAC is flat. Repeat-borrower rate is 18%."
//     → CAC-leak thesis is DEAD. New thesis: retention economics.
//
//   Turn 5+ / next session — the model MUST:
//     • treat retention thesis as the starting point
//     • name "broker channel" and "rising CAC" as dead hypotheses
//     • not re-propose them as fresh ideas
// ──────────────────────────────────────────────────────────────────

function limaOneAfterTurn2(): WorkingThesisState {
  // After Turn 2: seller killed the broker thesis.
  const t0 = emptyWorkingThesisState(ACCOUNT_ID);
  t0.current_thesis = "Broker channel is the primary growth lever.";
  t0.current_leakage = "Weak broker enablement.";
  t0.confidence = "HYPO";
  t0.open_questions = ["What is the broker-to-direct revenue mix?"];
  return mergeWorkingThesisState(t0, {
    current_thesis:
      "Direct-to-borrower acquisition is the real growth engine; broker channel is flat.",
    current_leakage: "Rising CAC on the direct channel.",
    confidence: "INFER",
    add_evidence: [
      "Seller stated on Turn 2: brokers are flat and direct is where growth is.",
    ],
    thesis_change_reason:
      "Seller directly contradicted broker-channel thesis with field observation.",
    resolve_open_questions: ["What is the broker-to-direct revenue mix?"],
    add_open_questions: ["What is the CAC trend on the direct channel?"],
  });
}

function limaOneAfterTurn4(): WorkingThesisState {
  // After Turn 4: seller killed the CAC-leak thesis with "CAC is flat,
  // but repeat-borrower rate is 18%".
  const s2 = limaOneAfterTurn2();
  return mergeWorkingThesisState(s2, {
    current_thesis:
      "Lima One has solved acquisition economics but not retention — 18% repeat-borrower rate is the constraint on growth.",
    current_leakage: "Repeat-borrower drop-off (18% repeat rate).",
    confidence: "INFER",
    add_evidence: [
      "Seller reported after the VP call: CAC is flat, repeat-borrower rate is 18%.",
    ],
    thesis_change_reason:
      "New seller evidence: CAC is flat (kills CAC-leak thesis); 18% repeat rate is the real leak.",
    resolve_open_questions: [
      "What is the CAC trend on the direct channel?",
    ],
    add_open_questions: [
      "Why are borrowers not coming back for a second loan?",
    ],
  });
}

// ──────────────────────────────────────────────────────────────────
// A1. A prior thesis is explicitly superseded when seller evidence
//     contradicts it — it becomes a killed hypothesis, not a ghost.
// ──────────────────────────────────────────────────────────────────
Deno.test("continuity: seller contradiction supersedes prior thesis into the dead list", () => {
  const s = limaOneAfterTurn2();
  assertEquals(s.killed_hypotheses.length, 1);
  assertStringIncludes(
    s.killed_hypotheses[0].hypothesis,
    "Broker channel is the primary growth lever",
  );
  assertStringIncludes(
    s.killed_hypotheses[0].killed_by.toLowerCase(),
    "seller",
  );
  // Current thesis is the new one, not silently overwritten.
  assertStringIncludes(s.current_thesis, "Direct-to-borrower");
  // The open question the seller answered is gone; a new one is open.
  assert(
    !s.open_questions.includes("What is the broker-to-direct revenue mix?"),
  );
  assertEquals(
    s.open_questions.includes("What is the CAC trend on the direct channel?"),
    true,
  );
});

// ──────────────────────────────────────────────────────────────────
// A2. A dead hypothesis is referenced as dead in the next turn, not
//     silently forgotten. The prompt block is how this gets enforced
//     for the model — so we test the block, which is the injection
//     seam into the next answer.
// ──────────────────────────────────────────────────────────────────
Deno.test("continuity: next-turn prompt block names dead hypotheses explicitly", () => {
  const s = limaOneAfterTurn2();
  const block = renderWorkingThesisStateBlock(s);
  assertStringIncludes(block, "CURRENT WORKING THESIS STATE");
  assertStringIncludes(block, "DEAD HYPOTHESES");
  assertStringIncludes(
    block,
    "Broker channel is the primary growth lever",
  );
  // The block MUST instruct the model not to silently restart.
  assertStringIncludes(block, "Do NOT silently restart");
  assertStringIncludes(block, "CONFIRMS, WEAKENS, or KILLS");
});

// ──────────────────────────────────────────────────────────────────
// A3. A new session on the same account rehydrates the prior thesis
//     AND the dead hypotheses — we simulate the round-trip through
//     JSON (this is exactly what load/saveWorkingThesisState do).
// ──────────────────────────────────────────────────────────────────
Deno.test("continuity: new session rehydrates prior thesis + dead hypotheses", () => {
  const live = limaOneAfterTurn4();
  // Simulate persist → reopen on a later day.
  const roundTripped: WorkingThesisState = JSON.parse(JSON.stringify(live));
  assertEquals(roundTripped.account_id, ACCOUNT_ID);
  assertStringIncludes(roundTripped.current_thesis, "retention");
  // Both prior theses live on as dead hypotheses.
  const deadText = roundTripped.killed_hypotheses
    .map((k) => k.hypothesis)
    .join(" | ")
    .toLowerCase();
  assertStringIncludes(deadText, "broker channel");
  assertStringIncludes(deadText, "direct-to-borrower"); // the CAC-leak thesis
  // Prompt block rendered from the rehydrated state still carries
  // the full line of reasoning forward.
  const block = renderWorkingThesisStateBlock(roundTripped);
  assertStringIncludes(block, "retention");
  assertStringIncludes(block, "Broker channel");
  assertStringIncludes(block, "DEAD HYPOTHESES");
});

// ──────────────────────────────────────────────────────────────────
// A4. A future answer uses the saved thesis as the STARTING POINT —
//     the composed system prompt must actually include it, and the
//     gating heuristic must route account-linked threads through the
//     Strategy Core prompt (never fall back to generic).
// ──────────────────────────────────────────────────────────────────
Deno.test("continuity: composed system prompt makes saved thesis the starting point", () => {
  const live = limaOneAfterTurn4();
  const block = renderWorkingThesisStateBlock(live);
  const sys = buildStrategyChatSystemPrompt({
    depth: "Standard",
    accountContext: "Account: Lima One\nIndustry: Private Lending",
    libraryContext: "",
    workingThesisBlock: block,
  });
  // The thesis block is inside the system prompt — not a side-car.
  assertStringIncludes(sys, "CURRENT WORKING THESIS STATE");
  assertStringIncludes(sys, "retention");
  assertStringIncludes(sys, "DEAD HYPOTHESES");
  assertStringIncludes(sys, "Broker channel");
  // Gating: account-linked → Strategy Core prompt ALWAYS.
  assertEquals(shouldUseStrategyCorePrompt({ hasAccount: true }), true);
});

// ──────────────────────────────────────────────────────────────────
// A5. Seller evidence outweighs model pattern-matching when they
//     conflict. Operationally this is enforced by the validator:
//     a model-only patch cannot self-promote confidence to VALID;
//     a seller-confirmed patch can.
// ──────────────────────────────────────────────────────────────────
Deno.test("continuity: seller evidence beats model pattern-match on confidence", () => {
  const prior = limaOneAfterTurn4();

  // Model alone tries to upgrade confidence to VALID with no evidence.
  const modelOnly = validateWorkingThesisState(prior, {
    confidence: "VALID",
    current_thesis: prior.current_thesis, // unchanged — pure upgrade
  });
  assertEquals(modelOnly.patch.confidence, "INFER");
  assert(
    modelOnly.downgrades.some((d) => d.includes("VALID downgraded")),
    "model-only VALID upgrade must be downgraded",
  );

  // Same move, but this time grounded in a seller-confirmed fact —
  // survives the validator (numeric rule still applies, so we pass
  // numeric evidence too).
  const sellerGrounded = validateWorkingThesisState(prior, {
    confidence: "VALID",
    seller_confirmed: true,
    add_evidence: [
      "VP Originations confirmed on call: repeat-borrower rate is 18%.",
    ],
  });
  assertEquals(sellerGrounded.patch.confidence, "VALID");
});

// ──────────────────────────────────────────────────────────────────
// B. Prompt-behavior test — the composed system prompt carries
//    enough instruction to force the four behaviors the product
//    spec requires when prior state exists.
// ──────────────────────────────────────────────────────────────────
Deno.test("prompt-behavior: composed prompt forces CONFIRMS/WEAKENS/KILLS framing and blocks zombie revival", () => {
  // Build a state with all four fixture ingredients:
  //   • prior thesis
  //   • one killed hypothesis
  //   • one open question
  //   • one seller-confirmed fact (supporting_evidence)
  const state: WorkingThesisState = {
    account_id: ACCOUNT_ID,
    thread_id: null,
    current_thesis:
      "Retention economics is the constraint on Lima One's growth.",
    current_leakage: "Repeat-borrower rate of 18%.",
    confidence: "INFER",
    supporting_evidence: [
      "VP Originations confirmed on call: repeat-borrower rate is 18%.",
    ],
    killed_hypotheses: [
      {
        hypothesis: "Broker channel is the primary growth lever.",
        killed_by: "Seller said brokers are flat; direct is the growth.",
        killed_at: new Date().toISOString(),
      },
    ],
    open_questions: [
      "Why are borrowers not coming back for a second loan?",
    ],
    last_updated_at: new Date().toISOString(),
  };

  const block = renderWorkingThesisStateBlock(state);
  const sys = buildStrategyChatSystemPrompt({
    depth: "Standard",
    accountContext: "Account: Lima One",
    workingThesisBlock: block,
  });

  // Instruction surface: the model is told to label the new fact's
  // effect on the thesis, not drop it in silently.
  assertStringIncludes(sys, "CONFIRMS, WEAKENS, or KILLS");
  // It is told explicitly NOT to restart.
  assertStringIncludes(sys, "Do NOT silently restart");
  // Dead hypotheses header is present so the model names them.
  assertStringIncludes(sys, "DEAD HYPOTHESES");
  assertStringIncludes(sys, "do not revive without new evidence");
  // All four fixture ingredients are visible in the composed prompt.
  assertStringIncludes(sys, "Retention economics");
  assertStringIncludes(sys, "Broker channel is the primary growth lever");
  assertStringIncludes(sys, "Why are borrowers not coming back");
  assertStringIncludes(sys, "VP Originations confirmed");

  // Zombie revival is structurally blocked by the validator — the
  // model cannot silently resurrect "Broker channel" without both a
  // revive reason AND seller confirmation.
  const zombie = validateWorkingThesisState(state, {
    current_thesis: "Broker channel is the primary growth lever.",
    thesis_change_reason: "Reconsidering the broker angle.",
  });
  // current_thesis is dropped; revival refused.
  assertEquals(zombie.patch.current_thesis, undefined);
  assert(
    zombie.downgrades.some((d) => d.includes("Refused to revive")),
    "killed hypothesis must not be revivable without explicit reason + seller_confirmed",
  );

  // With both signals, the revival is allowed through the validator
  // (merge itself then treats it as a normal thesis change, with the
  // prior thesis going back onto the dead list — which is the point:
  // revival is not free, it costs the current thesis).
  const revived = validateWorkingThesisState(state, {
    current_thesis: "Broker channel is the primary growth lever.",
    thesis_change_reason: "Seller re-engaged broker channel Q4.",
    revive_hypothesis_reason:
      "Seller confirmed broker volume tripled after new comp plan.",
    seller_confirmed: true,
  });
  assertEquals(
    revived.patch.current_thesis,
    "Broker channel is the primary growth lever.",
  );
});

// ──────────────────────────────────────────────────────────────────
// C. End-to-end continuity — the golden Lima One arc.
//
// This is the single test that, if it fails, tells you Strategy has
// regressed from "continuous line of reasoning" back to "smart tool
// that answers questions". It runs the full Turn 1 → Turn 4 arc
// through the merge pipeline, round-trips through JSON (simulating
// reopening the account on a later day), and asserts that the
// composed system prompt a new session would see carries the full
// history forward.
// ──────────────────────────────────────────────────────────────────
Deno.test("continuity: golden Lima One arc survives merge + session reopen", () => {
  // Live conversation reaches end of Turn 4.
  const end = limaOneAfterTurn4();

  // Current thesis is the retention thesis.
  assertStringIncludes(end.current_thesis.toLowerCase(), "retention");
  assertStringIncludes(end.current_leakage, "18%");

  // Two hypotheses are dead, in the order they were killed.
  assertEquals(end.killed_hypotheses.length, 2);
  assertStringIncludes(
    end.killed_hypotheses[0].hypothesis.toLowerCase(),
    "broker channel",
  );
  assertStringIncludes(
    end.killed_hypotheses[1].hypothesis.toLowerCase(),
    "direct-to-borrower",
  );

  // Answered open questions are resolved; a fresh one is open.
  assertEquals(
    end.open_questions,
    ["Why are borrowers not coming back for a second loan?"],
  );

  // Simulate persist + reopen on a later day.
  const reopened: WorkingThesisState = JSON.parse(JSON.stringify(end));

  // A NEW session composes its system prompt from the rehydrated
  // state. The new-session prompt MUST carry the whole arc forward.
  const block = renderWorkingThesisStateBlock(reopened);
  const sys = buildStrategyChatSystemPrompt({
    depth: "Standard",
    accountContext: "Account: Lima One\nIndustry: Private Lending",
    workingThesisBlock: block,
  });

  // The new-session prompt starts from the retention thesis.
  assertStringIncludes(sys, "retention");
  // Both prior hypotheses are named as dead — they cannot be
  // silently reintroduced as fresh ideas on the next turn.
  assertStringIncludes(sys, "Broker channel is the primary growth lever");
  assertStringIncludes(
    sys,
    "Direct-to-borrower acquisition is the real growth engine",
  );
  // The instruction to CONFIRM/WEAKEN/KILL against the running
  // thesis is present in the system prompt, not just the block.
  assertStringIncludes(sys, "CONFIRMS, WEAKENS, or KILLS");
  // And the gating says: yes, use Strategy Core here.
  assertEquals(shouldUseStrategyCorePrompt({ hasAccount: true }), true);
});
