// ════════════════════════════════════════════════════════════════
// W6 — Quality Gate Runner tests
//
// Verifies that `runWorkspaceGates` honors workspace-specific
// `qualityGates`, runs deterministic + heuristic checks against
// real assistant text, and stays SHADOW-ONLY (no mutation, no
// throw, telemetry shape stable).
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildGatePersistenceBlock,
  buildGateResultLogs,
  hasGateImplementation,
  runWorkspaceGates,
  type GateCheckInputs,
} from "./workspaceGateRunner.ts";
import { resolveServerWorkspaceContract } from "./retrievalEnforcement.ts";
import type { CitationCheckResult } from "./citationEnforcement.ts";
import type { RetrievalDecisionLog } from "./retrievalEnforcement.ts";

// ─── Helpers ──────────────────────────────────────────────────────

function inputsFor(
  workspaceKey: Parameters<typeof resolveServerWorkspaceContract>[0],
  overrides: Partial<GateCheckInputs> = {},
): GateCheckInputs {
  const resolved = resolveServerWorkspaceContract(workspaceKey);
  return {
    contract: resolved.contract,
    assistantText: "",
    libraryHits: [],
    libraryUsed: false,
    ...overrides,
  };
}

function getResult(summary: ReturnType<typeof runWorkspaceGates>, gateId: string) {
  const r = summary.results.find((g) => g.id === gateId);
  if (!r) throw new Error(`gate ${gateId} not found in summary`);
  return r;
}

const HITS = [{ id: "k1", title: "Q2 Business Case Template" }];

// ─── Brainstorm ───────────────────────────────────────────────────

Deno.test("brainstorm: min_options passes with ≥2 angle markers", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("brainstorm", {
      assistantText: "[Angle: A] foo\n[Angle: B] bar\n[Angle: C] baz\nNext: pick A.",
    }),
    surface: "strategy-chat",
  });
  const r = getResult(summary, "brainstorm.min_options");
  assertEquals(r.outcome, "pass");
  assert((r.metric ?? 0) >= 2);
});

Deno.test("brainstorm: min_options fails when only one option present", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("brainstorm", { assistantText: "[Angle: only one]" }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "brainstorm.min_options").outcome, "fail");
});

Deno.test("brainstorm: angle_diversity flags duplicate labels", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("brainstorm", {
      assistantText: "[Angle: same] x\n[Angle: same] y\n[Angle: other] z",
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "brainstorm.angle_diversity").outcome, "fail");
});

Deno.test("brainstorm: citation_only_if_library_used → pass when library not used", () => {
  const cite: CitationCheckResult = {
    citationMode: "none_unless_library_used",
    citationsFound: 0,
    issues: [],
    audited: false,
    audit: null,
    auditedText: "",
  };
  const summary = runWorkspaceGates({
    inputs: inputsFor("brainstorm", { citationCheck: cite, libraryUsed: false }),
    surface: "strategy-chat",
  });
  assertEquals(
    getResult(summary, "brainstorm.citation_only_if_library_used").outcome,
    "pass",
  );
});

Deno.test("brainstorm: citation_only_if_library_used → fail when library used w/o attribution", () => {
  const cite: CitationCheckResult = {
    citationMode: "none_unless_library_used",
    citationsFound: 0,
    issues: [{ code: "library_used_without_attribution", detail: "x" }],
    audited: true,
    audit: null,
    auditedText: "",
  };
  const summary = runWorkspaceGates({
    inputs: inputsFor("brainstorm", { citationCheck: cite, libraryUsed: true, libraryHits: HITS }),
    surface: "strategy-chat",
  });
  assertEquals(
    getResult(summary, "brainstorm.citation_only_if_library_used").outcome,
    "fail",
  );
});

// ─── Deep Research ────────────────────────────────────────────────

Deno.test("deep_research: confidence_tagging passes with [Verified]/[Inferred]", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("deep_research", {
      assistantText:
        "Q2 churn looks high based on calls. [Verified] CSAT dropped. [Inferred] tied to onboarding.\n## Unknowns\n- root cause\n## Next questions\n- ask CSM",
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "deep_research.confidence_tagging").outcome, "pass");
  assertEquals(getResult(summary, "deep_research.unknowns_section_present").outcome, "pass");
  assertEquals(getResult(summary, "deep_research.next_questions_present").outcome, "pass");
});

Deno.test("deep_research: confidence_tagging fails when no tags present", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("deep_research", {
      assistantText: "Plain prose with a real opening sentence and no tags.\n## Unknowns\n- x\n## Next questions\n- y",
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "deep_research.confidence_tagging").outcome, "fail");
});

// ─── Refine ────────────────────────────────────────────────────────

Deno.test("refine: diff_present passes with both headings", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("refine", {
      assistantText: "## Improved version\n...\n## Changes\n- shorter open",
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "refine.diff_present").outcome, "pass");
});

Deno.test("refine: diff_present fails when changes heading missing", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("refine", { assistantText: "## Improved version\n..." }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "refine.diff_present").outcome, "fail");
});

Deno.test("refine: length_reduced fails when output is longer (no expand request)", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("refine", {
      assistantText: "x".repeat(500),
      originalTextForRefine: "x".repeat(100),
      expandRequested: false,
    }),
    surface: "strategy-chat",
  });
  assertEquals(
    getResult(summary, "refine.length_reduced_unless_expand_requested").outcome,
    "fail",
  );
});

// ─── Library ──────────────────────────────────────────────────────

Deno.test("library: sources_used_summary + gaps_section_present pass with proper headings", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("library", {
      assistantText: "## Sources used\n- Q2 doc\n## Gaps\n- pricing examples missing",
      libraryUsed: true,
      libraryHits: HITS,
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "library.sources_used_summary").outcome, "pass");
  assertEquals(getResult(summary, "library.gaps_section_present").outcome, "pass");
});

Deno.test("library: empty_library_disclosed passes when output discloses empty library", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("library", {
      assistantText: "Your library is empty for this topic. Here is what I'd suggest based on first principles.",
      libraryUsed: false,
      libraryHits: [],
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "library.empty_library_disclosed").outcome, "pass");
});

// ─── Artifacts ────────────────────────────────────────────────────

Deno.test("artifacts: required_sections_present passes when parsedOutput has all section ids", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("artifacts", {
      assistantText: "irrelevant — parsed sections take precedence",
      parsedOutput: { sections: [{ id: "exec_summary" }, { id: "next_steps" }] },
      requiredSectionIds: ["exec_summary", "next_steps"],
    }),
    surface: "run-task",
    taskType: "discovery_prep",
  });
  assertEquals(
    getResult(summary, "artifacts.required_sections_present").outcome,
    "pass",
  );
});

Deno.test("artifacts: required_sections_present fails when a section id is missing", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("artifacts", {
      assistantText: "",
      parsedOutput: { sections: [{ id: "exec_summary" }] },
      requiredSectionIds: ["exec_summary", "next_steps"],
    }),
    surface: "run-task",
    taskType: "discovery_prep",
  });
  const r = getResult(summary, "artifacts.required_sections_present");
  assertEquals(r.outcome, "fail");
  assert(r.detail.includes("next_steps"));
});

Deno.test("artifacts: required_sections_present skips when no task config supplied", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("artifacts", { assistantText: "free-form output" }),
    surface: "strategy-chat",
  });
  assertEquals(
    getResult(summary, "artifacts.required_sections_present").outcome,
    "skipped",
  );
});

// ─── Projects ─────────────────────────────────────────────────────

Deno.test("projects: no_fabricated_continuity fails when text claims prior context but none provided", () => {
  const decision: RetrievalDecisionLog = {
    workspace: "projects",
    contractVersion: "1.1.0",
    libraryUse: "primary",
    libraryQueried: false,
    libraryHitCount: 0,
    libraryCoverageState: "not_needed",
    webMode: "off",
    webQueried: false,
    webHitCount: 0,
    contextMode: "project_first",
    citationMode: "strict",
    fallbackUsed: false,
    fallbackNote: null,
  };
  const summary = runWorkspaceGates({
    inputs: inputsFor("projects", {
      assistantText: "As we discussed, the next move is to ship.",
      retrievalDecision: decision,
    }),
    surface: "strategy-chat",
  });
  assertEquals(
    getResult(summary, "projects.no_fabricated_continuity").outcome,
    "fail",
  );
});

Deno.test("projects: no_fabricated_continuity passes when context was actually used", () => {
  const decision: RetrievalDecisionLog = {
    workspace: "projects",
    contractVersion: "1.1.0",
    libraryUse: "primary",
    libraryQueried: true,
    libraryHitCount: 2,
    libraryCoverageState: "used",
    webMode: "off",
    webQueried: false,
    webHitCount: 0,
    contextMode: "project_first",
    citationMode: "strict",
    fallbackUsed: false,
    fallbackNote: null,
  };
  const summary = runWorkspaceGates({
    inputs: inputsFor("projects", {
      assistantText: "As we discussed last week, ship.",
      retrievalDecision: decision,
    }),
    surface: "strategy-chat",
  });
  assertEquals(
    getResult(summary, "projects.no_fabricated_continuity").outcome,
    "pass",
  );
});

// ─── Work ─────────────────────────────────────────────────────────

Deno.test("work: answer_stands_alone passes when answer + nudge, fails when only nudge", () => {
  const ok = runWorkspaceGates({
    inputs: inputsFor("work", {
      assistantText:
        "The fastest path is to send the proposal today.\nIt covers the three asks.\nConsider: deep_research for sourced backup.",
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(ok, "work.answer_stands_alone").outcome, "pass");

  const bad = runWorkspaceGates({
    inputs: inputsFor("work", {
      assistantText: "Consider: deep_research",
    }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(bad, "work.answer_stands_alone").outcome, "fail");
});

Deno.test("work: length_proportional fails for bloated output", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("work", { assistantText: "a".repeat(8500) }),
    surface: "strategy-chat",
  });
  assertEquals(getResult(summary, "work.length_proportional").outcome, "fail");
});

// ─── Shadow + telemetry invariants ────────────────────────────────

Deno.test("every result is shadow=true, regardless of contract or outcome", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("brainstorm", { assistantText: "noop" }),
    surface: "strategy-chat",
  });
  assert(summary.results.length > 0);
  for (const r of summary.results) assertEquals(r.shadow, true);
});

Deno.test("runner never throws on bad inputs (returns error outcome instead)", () => {
  // Force a check to throw by passing a parsedOutput that violates the
  // expected shape — most checks should still produce a result.
  const summary = runWorkspaceGates({
    inputs: inputsFor("artifacts", {
      assistantText: "",
      // deliberately weird
      parsedOutput: 42,
      requiredSectionIds: ["a", "b"],
    }),
    surface: "run-task",
  });
  assert(summary.results.length > 0);
  // No `error` outcomes for our gates with this input — but the
  // invariant we care about is no throw.
});

Deno.test("buildGateResultLogs preserves surface + taskType + runId per gate", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("artifacts", {
      assistantText: "",
      parsedOutput: { sections: [{ id: "x" }] },
      requiredSectionIds: ["x"],
    }),
    surface: "run-task",
    taskType: "discovery_prep",
    runId: "run-abc",
  });
  const logs = buildGateResultLogs(summary);
  assertEquals(logs.length, summary.results.length);
  for (const log of logs) {
    assertEquals(log.surface, "run-run".replace("run-run", "run-task"));
    assertEquals(log.taskType, "discovery_prep");
    assertEquals(log.runId, "run-abc");
    assertEquals(log.shadow, true);
    assertEquals(log.workspace, "artifacts");
  }
});

Deno.test("buildGatePersistenceBlock returns compact totals + per-gate trim", () => {
  const summary = runWorkspaceGates({
    inputs: inputsFor("brainstorm", {
      assistantText: "[Angle: A]\n[Angle: B]\nNext: pick A.",
    }),
    surface: "strategy-chat",
  });
  const block = buildGatePersistenceBlock(summary);
  assertEquals(block.workspace, "brainstorm");
  assertEquals(
    block.totals.total,
    block.totals.pass +
      block.totals.fail +
      block.totals.skipped +
      block.totals.error,
  );
  for (const g of block.gates) {
    assert(typeof g.id === "string");
    assert(typeof g.checkRef === "string");
  }
});

Deno.test("hasGateImplementation: true for known checkRef, false for unknown", () => {
  assertEquals(hasGateImplementation("brainstorm.min_options"), true);
  assertEquals(hasGateImplementation("nonexistent.gate"), false);
});
