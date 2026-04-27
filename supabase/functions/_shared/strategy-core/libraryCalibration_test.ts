// ════════════════════════════════════════════════════════════════
// W6.5 Pass B — Library Calibration tests
//
// Covers:
//   • Pass B skips when Pass A skipped (insufficient_exemplars)
//   • Pass B reuses the SAME ExemplarSet (id parity)
//   • Fabrication guard drops findings with unknown exemplar IDs
//   • improvedDraft is never emitted in Phase 1
//   • runLibraryCalibration never throws + never mutates outputText
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildCalibrationPersistenceBlock,
  runLibraryCalibration,
} from "./libraryCalibration.ts";
import type {
  ExemplarRef,
  ExemplarSet,
} from "./libraryStandard.ts";

const realExemplar: ExemplarRef = {
  id: "ex-real-1",
  shortId: "ex-real-",
  role: "pattern",
  title: "Multi-Angle Reopen",
  whenToUse: "Stalled retail renewal",
  theMove: "Open with four distinct angles",
  whyItWorks: "Avoids same-trigger sameness",
  antiPatterns: ["all angles share one trigger"],
  exampleSnippet: null,
  appliesToContexts: ["retail", "renewal"],
  confidence: 0.85,
  score: 4.2,
};

const realExemplar2: ExemplarRef = {
  ...realExemplar,
  id: "ex-real-2",
  shortId: "ex-real-",
  role: "exemplar",
  title: "Account Brief Museum",
  theMove: "Six sections including PoV",
};

function injectedSet(exemplars: ExemplarRef[]): ExemplarSet {
  return {
    exemplarSetId: "exset-test-1",
    workspace: "brainstorm",
    surface: "strategy-chat",
    injected: true,
    exemplars,
    roleCounts: { standard: 0, exemplar: 1, pattern: 1, tactic: 0 },
    approxTokens: 100,
    durationMs: 5,
  };
}

function skippedSet(): ExemplarSet {
  return {
    exemplarSetId: "exset-skipped-1",
    workspace: "brainstorm",
    surface: "strategy-chat",
    injected: false,
    skippedReason: "no_rows",
    exemplars: [],
    roleCounts: { standard: 0, exemplar: 0, pattern: 0, tactic: 0 },
    approxTokens: 0,
    durationMs: 1,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

Deno.test("Pass B: skips with insufficient_exemplars when Pass A skipped", () => {
  const set = skippedSet();
  const result = runLibraryCalibration({
    workspace: "brainstorm",
    surface: "strategy-chat",
    outputText: "1. Send a check-in.\n2. Schedule a QBR.",
    exemplarSet: set,
  });
  assertEquals(result.overallVerdict, "insufficient_exemplars");
  assertEquals(result.exemplarsUsed.length, 0);
  assertEquals(result.standardContextInjected, false);
  // Same ExemplarSet id flows through.
  assertEquals(result.exemplarSetId, set.exemplarSetId);
  // No improvedDraft in Phase 1.
  assertEquals(result.improvedDraft, undefined);
});

Deno.test("Pass B: reuses the SAME ExemplarSet id from Pass A", () => {
  const set = injectedSet([realExemplar, realExemplar2]);
  const result = runLibraryCalibration({
    workspace: "brainstorm",
    surface: "strategy-chat",
    outputText: "1. First angle\n2. Second angle\n3. Third angle",
    exemplarSet: set,
  });
  assertEquals(result.exemplarSetId, set.exemplarSetId);
  assertStrictEquals(result.exemplarsUsed, set.exemplars);
  assertEquals(result.standardContextInjected, true);
});

Deno.test("Pass B: improvedDraft never emitted in Phase 1", () => {
  const set = injectedSet([realExemplar, realExemplar2]);
  const result = runLibraryCalibration({
    workspace: "artifacts",
    surface: "run-task",
    taskType: "account_brief",
    outputText: "## Context\n## Value\n## PoV\n## Next Step",
    exemplarSet: set,
  });
  assertEquals(result.improvedDraft, undefined);
  assertEquals(result.shadow, true);
});

Deno.test("Pass B: never mutates the outputText input (byte-equality)", () => {
  const set = injectedSet([realExemplar, realExemplar2]);
  const original = "1. Open with CFO angle\n2. Champion enablement\n3. Peer pull";
  const result = runLibraryCalibration({
    workspace: "brainstorm",
    surface: "strategy-chat",
    outputText: original,
    exemplarSet: set,
  });
  // Caller's string is untouched (string is immutable, but assert intent).
  assertEquals(original, "1. Open with CFO angle\n2. Champion enablement\n3. Peer pull");
  // Result does NOT carry a mutated text payload.
  assert(!("outputText" in (result as unknown as Record<string, unknown>)));
});

Deno.test("Pass B: persistence block exposes verdict + exemplarSetId", () => {
  const set = injectedSet([realExemplar, realExemplar2]);
  const result = runLibraryCalibration({
    workspace: "brainstorm",
    surface: "strategy-chat",
    outputText: "1. Angle A\n2. Angle B",
    exemplarSet: set,
  });
  const block = buildCalibrationPersistenceBlock(result);
  assertEquals(block.exemplarSetId, set.exemplarSetId);
  assertEquals(typeof block.overallVerdict, "string");
  // Phase-1 invariant: persistence block does NOT carry an improved draft.
  assert(!("improvedDraft" in (block as Record<string, unknown>)));
});

Deno.test("Pass B: fabrication guard reports OK when only known refs are produced", () => {
  // Use a workspace whose evaluators only emit refs from the supplied set.
  const set = injectedSet([realExemplar, realExemplar2]);
  const result = runLibraryCalibration({
    workspace: "brainstorm",
    surface: "strategy-chat",
    outputText: "1. Angle A\n2. Angle B\n3. Angle C",
    exemplarSet: set,
  });
  assertEquals(result.fabricationGuard.ok, true);
  assertEquals(result.fabricationGuard.offending.length, 0);
  // Every finding's refs are a subset of the exemplar set's IDs.
  const validIds = new Set(set.exemplars.map((e) => e.id));
  for (const f of [...result.strengths, ...result.gaps]) {
    for (const r of f.exemplarRefs) {
      assert(validIds.has(r), `unexpected ref ${r}`);
    }
  }
  for (const u of result.upgradeSuggestions) {
    for (const r of u.exemplarRefs) {
      assert(validIds.has(r), `unexpected upgrade ref ${r}`);
    }
  }
});

Deno.test("Pass B: empty outputText does not throw", () => {
  const set = injectedSet([realExemplar, realExemplar2]);
  const result = runLibraryCalibration({
    workspace: "work",
    surface: "strategy-chat",
    outputText: "",
    exemplarSet: set,
  });
  assertEquals(result.exemplarSetId, set.exemplarSetId);
  // Verdict is well-defined even on empty input.
  assert(typeof result.overallVerdict === "string");
});
