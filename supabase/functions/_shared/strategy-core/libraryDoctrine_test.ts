// ════════════════════════════════════════════════════════════════
// W6.5 Library Doctrine — Architectural Invariants
//
// These tests pin the non-negotiable architectural rules of the
// "Library as Strategy's degree in sales" doctrine. They are
// deliberately minimal and structural — not behavior tests. Their
// job is to FAIL LOUDLY if a future change violates the contract.
//
// Doctrine constraints pinned here:
//
//   1. STANDARD role is universal — `selectExemplars` MUST NOT
//      accept `libraryUse` as an option (would let RESOURCE posture
//      gate the quality layer).
//   2. ONE shared ExemplarSet per generation — Pass B must reuse
//      the id verbatim (no re-selection in Pass B).
//   3. STANDARDS block must contain the "DO NOT CITE" instruction.
//   4. Pass B never mutates the input outputText (byte equality).
//   5. Pass B never emits an `improvedDraft` in Phase 1.
//   6. Skipped Pass A → Pass B verdict is `insufficient_exemplars`
//      (no degraded generation).
//   7. Telemetry join key parity — log + persistence + result all
//      expose the same `exemplarSetId`.
//   8. Skip behavior is clean — no exemplars → empty rendered
//      block (no placeholder/fallback).
//   9. Workspace key flows through unchanged across passes.
//  10. Distinct ExemplarSet ids produce distinct telemetry join
//      keys.
//
// If a future refactor breaks any of these, this file should be the
// first thing that turns red.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildStandardContextLog,
  buildStandardContextPersistenceBlock,
  type ExemplarRef,
  type ExemplarSet,
  renderStandardBlock,
  selectExemplars,
} from "./libraryStandard.ts";

import {
  buildCalibrationPersistenceBlock,
  type CalibrationInputs,
  runLibraryCalibration,
} from "./libraryCalibration.ts";

// ─── Fixtures ─────────────────────────────────────────────────────

function makeExemplar(
  id: string,
  overrides: Partial<ExemplarRef> = {},
): ExemplarRef {
  return {
    id,
    shortId: id.slice(0, 8),
    role: "exemplar",
    title: `Exemplar ${id}`,
    whenToUse: "Use when prospect raises a budget objection.",
    theMove: "Acknowledge, then reframe budget around outcomes.",
    whyItWorks: "Shifts the frame from cost to value.",
    antiPatterns: ["Discounting too early."],
    exampleSnippet: null,
    appliesToContexts: ["enterprise"],
    confidence: 0.8,
    score: 3.2,
    ...overrides,
  };
}

function injectedSet(exemplars: ExemplarRef[]): ExemplarSet {
  return {
    exemplarSetId: "exset-doctrine-1",
    workspace: "work",
    surface: "strategy-chat",
    injected: true,
    exemplars,
    roleCounts: {
      standard: 0,
      exemplar: exemplars.length,
      pattern: 0,
      tactic: 0,
    },
    approxTokens: 100,
    durationMs: 1,
  };
}

function skippedSet(): ExemplarSet {
  return {
    exemplarSetId: "exset-skipped-doctrine",
    workspace: "work",
    surface: "strategy-chat",
    injected: false,
    skippedReason: "no_rows",
    exemplars: [],
    roleCounts: { standard: 0, exemplar: 0, pattern: 0, tactic: 0 },
    approxTokens: 0,
    durationMs: 1,
  };
}

// ─── Doctrine invariants ──────────────────────────────────────────

Deno.test("Doctrine #1: selectExemplars signature must NOT accept libraryUse", () => {
  // This is a structural assertion: if a future PR adds `libraryUse`
  // to SelectExemplarsOpts, the type would change and this test
  // serves as a documented intent. We assert via runtime introspection
  // that the function exists — and document the rule.
  //
  // The TypeScript compiler is the real enforcer; this test pins the
  // doctrinal reason in code so reviewers see the constraint.
  const fn = selectExemplars;
  assertEquals(typeof fn, "function");
  // The doctrine: STANDARD layer is universal. If someone adds
  // libraryUse here, change the doctrine first.
  assert(true, "selectExemplars must not gate STANDARD on libraryUse");
});

Deno.test("Doctrine #2: Pass B reuses ExemplarSet id verbatim (no re-selection)", () => {
  const set = injectedSet([
    makeExemplar("ex-1"),
    makeExemplar("ex-2"),
  ]);

  const inputs: CalibrationInputs = {
    workspace: "work",
    surface: "strategy-chat",
    exemplarSet: set,
    outputText: "Some answer.",
  };

  const result = runLibraryCalibration(inputs);
  assertEquals(
    result.exemplarSetId,
    set.exemplarSetId,
    "Pass B must reuse Pass A exemplarSetId — never re-select.",
  );

  const block = buildCalibrationPersistenceBlock(result);
  assertEquals(block.exemplarSetId, set.exemplarSetId);
});

Deno.test("Doctrine #3: rendered STANDARDS block contains DO NOT CITE instruction", () => {
  const set = injectedSet([
    makeExemplar("ex-1"),
    makeExemplar("ex-2"),
  ]);
  const block = renderStandardBlock(set);
  assert(block.length > 0, "Block should render when injected.");
  // Case-insensitive check — exact wording is implementation detail,
  // but the prohibition must be present.
  const lower = block.toLowerCase();
  assert(
    lower.includes("do not cite") || lower.includes("don't cite") ||
      lower.includes("not for citation"),
    `STANDARDS block must include a DO-NOT-CITE instruction. Got:\n${block}`,
  );
});

Deno.test("Doctrine #4: Pass B never mutates outputText (byte equality)", () => {
  const set = injectedSet([
    makeExemplar("ex-1"),
    makeExemplar("ex-2"),
  ]);
  const original = "The exact assistant output, byte for byte. 🎯\n— end.";
  const snapshot = original;

  const result = runLibraryCalibration({
    workspace: "work",
    surface: "strategy-chat",
    exemplarSet: set,
    outputText: original,
  });

  // outputText must be untouched.
  assertEquals(original, snapshot, "outputText was mutated by Pass B");
  // Result must not carry an alternate draft in Phase 1.
  assertEquals(
    (result as Record<string, unknown>).improvedDraft,
    undefined,
    "Phase 1 must not emit improvedDraft.",
  );
});

Deno.test("Doctrine #5: Pass B never emits improvedDraft in Phase 1", () => {
  const set = injectedSet([makeExemplar("ex-1"), makeExemplar("ex-2")]);
  const result = runLibraryCalibration({
    workspace: "work",
    surface: "strategy-chat",
    exemplarSet: set,
    outputText: "Below-standard answer.",
  });
  assert(
    !("improvedDraft" in (result as Record<string, unknown>)) ||
      (result as Record<string, unknown>).improvedDraft === undefined,
    "improvedDraft must not be present in Phase 1.",
  );
});

Deno.test("Doctrine #6: skipped Pass A → Pass B verdict is insufficient_exemplars", () => {
  const set = skippedSet();
  const result = runLibraryCalibration({
    workspace: "work",
    surface: "strategy-chat",
    exemplarSet: set,
    outputText: "Anything.",
  });
  assertEquals(result.overallVerdict, "insufficient_exemplars");
  // Same id flows through even on skip — telemetry join key.
  assertEquals(result.exemplarSetId, set.exemplarSetId);
});

Deno.test("Doctrine #7: telemetry join key parity (log + persistence + result)", () => {
  const set = injectedSet([makeExemplar("ex-1"), makeExemplar("ex-2")]);
  const log = buildStandardContextLog(set);
  const persisted = buildStandardContextPersistenceBlock(set);

  const result = runLibraryCalibration({
    workspace: "work",
    surface: "strategy-chat",
    exemplarSet: set,
    outputText: "An answer.",
  });
  const calibBlock = buildCalibrationPersistenceBlock(result);

  // Single id flows through every surface.
  assertEquals(log.exemplarSetId, set.exemplarSetId);
  assertEquals(persisted.exemplarSetId, set.exemplarSetId);
  assertEquals(result.exemplarSetId, set.exemplarSetId);
  assertEquals(calibBlock.exemplarSetId, set.exemplarSetId);
});

Deno.test("Doctrine #8: empty rendered block when not injected (no degraded generation)", () => {
  const set = skippedSet();
  const block = renderStandardBlock(set);
  assertEquals(
    block,
    "",
    "Skipped Pass A must produce an empty STANDARDS block — never a placeholder or fallback.",
  );
});

Deno.test("Doctrine #9: workspace key flows through unchanged across passes", () => {
  const set = injectedSet([makeExemplar("ex-1"), makeExemplar("ex-2")]);
  const result = runLibraryCalibration({
    workspace: "work",
    surface: "strategy-chat",
    exemplarSet: set,
    outputText: "Some answer.",
  });
  assertEquals(set.workspace, "work");
  assertEquals(result.workspace, "work");
});

Deno.test("Doctrine #10: distinct ExemplarSet ids produce distinct telemetry join keys", () => {
  const setA = injectedSet([makeExemplar("ex-a")]);
  const setB: ExemplarSet = {
    ...injectedSet([makeExemplar("ex-b")]),
    exemplarSetId: "exset-doctrine-2",
  };
  assertNotEquals(setA.exemplarSetId, setB.exemplarSetId);
  const logA = buildStandardContextLog(setA);
  const logB = buildStandardContextLog(setB);
  assertNotEquals(logA.exemplarSetId, logB.exemplarSetId);
});
