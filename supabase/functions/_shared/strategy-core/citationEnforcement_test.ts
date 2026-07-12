// ════════════════════════════════════════════════════════════════
// W5 — Citation Behavior Enforcement tests
//
// Verifies that `runCitationCheck` honors the workspace `citationMode`
// from the W1 contract and produces correct shadow telemetry.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCitationCheckLog,
  runCitationCheck,
  type CitationCheckInputs,
} from "./citationEnforcement.ts";
import { resolveServerWorkspaceContract } from "./retrievalEnforcement.ts";
import type { CitationAuditOptions } from "./citationAudit.ts";

const HITS = [
  { id: "aaaaaaaa1111", title: "Q2 Business Case Template" },
  { id: "bbbbbbbb2222", title: "Discovery Question Bank" },
];

function baseInputs(
  overrides: Partial<CitationCheckInputs> = {},
): CitationCheckInputs {
  return {
    assistantText: "Plain assistant output with no citations.",
    libraryHits: [],
    libraryUsed: false,
    workspace: "brainstorm",
    contractVersion: "1.1.0",
    citationMode: "none_unless_library_used",
    ...overrides,
  };
}

// ─── Brainstorm: none_unless_library_used ─────────────────────────

Deno.test("brainstorm: no library hits → audit skipped, no issues", () => {
  const resolved = resolveServerWorkspaceContract("brainstorm");
  assertEquals(resolved.retrievalRules.citationMode, "none_unless_library_used");

  const result = runCitationCheck(
    baseInputs({
      citationMode: resolved.retrievalRules.citationMode,
      assistantText: "Three angles to test:\n[Angle: A]\n[Angle: B]\n[Angle: C]",
    }),
  );

  assertEquals(result.audited, false);
  assertEquals(result.audit, null);
  assertEquals(result.issues.length, 0);
  assertEquals(result.auditedText.includes("[Angle: A]"), true);
});

Deno.test("brainstorm: library used + no citations → library_used_without_attribution issue", () => {
  const result = runCitationCheck(
    baseInputs({
      citationMode: "none_unless_library_used",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: "Three angles, no citations included.",
    }),
  );

  assertEquals(result.audited, true);
  assertExists(result.audit);
  assertEquals(result.citationsFound, 0);
  assertEquals(
    result.issues.some((i) => i.code === "library_used_without_attribution"),
    true,
  );
  // Shadow: text is NOT rewritten.
  assertEquals(result.auditedText, "Three angles, no citations included.");
});

// ─── Refine: none ──────────────────────────────────────────────────

Deno.test("refine: citationMode=none never audits, never raises issues", () => {
  const resolved = resolveServerWorkspaceContract("refine");
  assertEquals(resolved.retrievalRules.citationMode, "none");

  const result = runCitationCheck(
    baseInputs({
      workspace: "refine",
      contractVersion: resolved.contractVersion,
      citationMode: "none",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: "## Improved version\n...\n## Changes\n...",
    }),
  );

  assertEquals(result.audited, false);
  assertEquals(result.issues.length, 0);
  assertEquals(result.auditedText.includes("## Improved version"), true);
});

// ─── Strict: deep_research / library / artifacts ──────────────────

Deno.test("deep_research: strict mode audits in shadow — does NOT mutate auditedText by default", () => {
  const resolved = resolveServerWorkspaceContract("deep_research");
  assertEquals(resolved.retrievalRules.citationMode, "strict");

  const text =
    `Per RESOURCE["Q2 Business Case Template"] we should expand. ` +
    `Also see RESOURCE["Made-Up Doc That Does Not Exist"].`;

  const result = runCitationCheck(
    baseInputs({
      workspace: "deep_research",
      contractVersion: resolved.contractVersion,
      citationMode: "strict",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: text,
    }),
  );

  assertEquals(result.audited, true);
  assertExists(result.audit);
  // Auditor WOULD have rewritten — telemetry still reflects that.
  assertEquals(result.audit!.modified, true);
  assert(result.audit!.text.includes("⚠ UNVERIFIED"));
  // W5 shadow: canonical assistant text is unchanged.
  assertEquals(result.auditedText, text);
  assertEquals(result.auditedText.includes("⚠ UNVERIFIED"), false);
  assertEquals(
    result.issues.some((i) => i.code === "unverified_citation"),
    true,
  );
  assert(result.citationsFound >= 1);
});

Deno.test("strict + enableLegacyCitationRewrite=true publishes audit.text (opt-in, outside W5)", () => {
  const text =
    `Per RESOURCE["Q2 Business Case Template"] we should expand. ` +
    `Also see RESOURCE["Made-Up Doc That Does Not Exist"].`;

  const result = runCitationCheck(
    baseInputs({
      workspace: "deep_research",
      contractVersion: "1.1.0",
      citationMode: "strict",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: text,
      enableLegacyCitationRewrite: true,
    }),
  );

  assertEquals(result.audited, true);
  assertEquals(result.audit!.modified, true);
  // Legacy opt-in: auditedText IS the rewritten text.
  assert(result.auditedText.includes("⚠ UNVERIFIED"));
  assertEquals(result.auditedText, result.audit!.text);
});

Deno.test("library: strict mode runs audit in shadow when nothing to flag", () => {
  const resolved = resolveServerWorkspaceContract("library");
  assertEquals(resolved.retrievalRules.citationMode, "strict");

  const result = runCitationCheck(
    baseInputs({
      workspace: "library",
      contractVersion: resolved.contractVersion,
      citationMode: "strict",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: `Based on RESOURCE["Discovery Question Bank"], ask about X.`,
    }),
  );

  assertEquals(result.audited, true);
  assertEquals(result.audit!.modified, false);
  assertEquals(
    result.issues.some((i) => i.code === "unverified_citation"),
    false,
  );
  assertEquals(result.citationsFound, 1);
});

Deno.test("artifacts: strict mode raises missing_citations when library hits exist but none cited", () => {
  const resolved = resolveServerWorkspaceContract("artifacts");
  assertEquals(resolved.retrievalRules.citationMode, "strict");

  const result = runCitationCheck(
    baseInputs({
      workspace: "artifacts",
      contractVersion: resolved.contractVersion,
      citationMode: "strict",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: "Section 1\n...\nSection 2\n...",
    }),
  );

  assertEquals(result.audited, true);
  assertEquals(
    result.issues.some((i) => i.code === "missing_citations"),
    true,
  );
});

// ─── Light mode (synthetic — no workspace ships `light` today, but
// the contract type permits it; verify behavior holds.) ─────────────

Deno.test("light mode: presence-level check, shadow rewrite", () => {
  const text = `RESOURCE["Q2 Business Case Template"] and ` +
    `RESOURCE["Phantom Doc"].`;
  const result = runCitationCheck(
    baseInputs({
      workspace: "work",
      contractVersion: "1.1.0",
      citationMode: "light",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: text,
    }),
  );

  assertEquals(result.audited, true);
  assertEquals(result.audit!.modified, true);
  // Light is shadow — auditedText is the ORIGINAL, not the rewrite.
  assertEquals(result.auditedText, text);
  assertEquals(
    result.issues.some((i) => i.code === "unverified_citation"),
    true,
  );
});

Deno.test("enforceCitationAuthenticity publishes invalid CARD rewrites in every citation mode", () => {
  const assistantText = `Use CARD["Adjust Comes Up"] for the expansion angle.`;
  const auditOptions: CitationAuditOptions = {
    cardHits: [{
      id: "aaaaaaaa-1111-2222-3333-444444444444",
      title: "Adjust",
    }],
    playbookHits: [{
      id: "bbbbbbbb-1111-2222-3333-444444444444",
      title: "Adjust Comes Up",
    }],
  };

  for (
    const citationMode of [
      "none",
      "none_unless_library_used",
      "light",
      "strict",
    ] as const
  ) {
    const result = runCitationCheck(
      baseInputs({
        workspace: "work",
        citationMode,
        libraryHits: [],
        libraryUsed: true,
        assistantText,
        auditOptions,
        enforceCitationAuthenticity: true,
      }),
    );

    assertEquals(result.audited, true, citationMode);
    assertExists(result.audit);
    assertEquals(result.audit.modified, true, citationMode);
    assertEquals(
      result.issues.some((issue) => issue.code === "unverified_citation"),
      true,
      citationMode,
    );
    assertStringIncludes(
      result.auditedText,
      `⚠ UNVERIFIED-CARD["Adjust Comes Up"]`,
    );
    assertEquals(result.citationsFound, 0, citationMode);
  }
});

Deno.test("competitor capability claims require an authentic CARD citation", () => {
  const auditOptions: CitationAuditOptions = {
    cardHits: [{
      id: "aaaaaaaa-1111-2222-3333-444444444444",
      title: "Adjust",
    }],
    playbookHits: [{
      id: "bbbbbbbb-1111-2222-3333-444444444444",
      title: "Adjust Comes Up",
    }],
  };
  const check = (assistantText: string) =>
    runCitationCheck(
      baseInputs({
        workspace: "work",
        citationMode: "light",
        libraryHits: [],
        libraryUsed: true,
        assistantText,
        auditOptions,
        enforceCitationAuthenticity: true,
      }),
    );

  const untagged = check("Adjust supports attribution measurement.");
  assertEquals(untagged.citationsFound, 0);
  assertEquals(
    untagged.issues.some((issue) => issue.code === "missing_citations"),
    true,
  );
  assertEquals(untagged.auditedText, "Adjust supports attribution measurement.");

  const valid = check(
    `Adjust supports attribution measurement CARD["Adjust"].`,
  );
  assertEquals(valid.citationsFound, 1);
  assertEquals(valid.issues.length, 0);
  assertEquals(valid.auditedText.includes("UNVERIFIED"), false);

  const fabricated = check(
    `Adjust supports attribution measurement CARD["Adjust Comes Up"].`,
  );
  assertEquals(fabricated.citationsFound, 0);
  assertEquals(
    fabricated.issues.some((issue) => issue.code === "missing_citations"),
    true,
  );
  assertEquals(
    fabricated.issues.some((issue) => issue.code === "unverified_citation"),
    true,
  );
  assertStringIncludes(
    fabricated.auditedText,
    `⚠ UNVERIFIED-CARD["Adjust Comes Up"]`,
  );
});

Deno.test("strict requires canonical syntax while light accepts exact informal attribution", () => {
  const informal = `Use the exact structure from "Q2 Business Case Template".`;
  const light = runCitationCheck(
    baseInputs({
      citationMode: "light",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: informal,
    }),
  );
  assertEquals(light.citationsFound, 1);
  assertEquals(
    light.issues.some((issue) => issue.code === "missing_citations"),
    false,
  );

  const strict = runCitationCheck(
    baseInputs({
      citationMode: "strict",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: informal,
    }),
  );
  assertEquals(strict.audit?.verifiedTitles.length, 1);
  assertEquals(strict.citationsFound, 0);
  assertEquals(
    strict.issues.some((issue) => issue.code === "missing_citations"),
    true,
  );

  const canonical = runCitationCheck(
    baseInputs({
      citationMode: "strict",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: `Use RESOURCE["Q2 Business Case Template"].`,
    }),
  );
  assertEquals(canonical.citationsFound, 1);
  assertEquals(canonical.issues.length, 0);
});

Deno.test("strict mode recognizes KI-only, CARD-only, and PLAYBOOK-only citeable evidence", () => {
  const ki = { id: "cccccccc3333", title: "Quantifying Pain" };
  const card = { id: "eeeeeeee5555", title: "Competitive Displacement" };
  const playbook = { id: "dddddddd4444", title: "Champion Went Quiet" };
  const cases: Array<[string, CitationAuditOptions]> = [
      [
        `Use KI["Quantifying Pain"].`,
        { kiHits: [ki] },
      ],
      [
        `Use CARD["Competitive Displacement"].`,
        { cardHits: [card] },
      ],
      [
        `Use PLAYBOOK["Champion Went Quiet"].`,
        { playbookHits: [playbook] },
      ],
  ];
  for (const [assistantText, auditOptions] of cases) {
    const result = runCitationCheck(
      baseInputs({
        citationMode: "strict",
        libraryUsed: true,
        assistantText,
        auditOptions,
      }),
    );
    assertEquals(result.citationsFound, 1);
    assertEquals(result.issues.length, 0);
  }
});

Deno.test("unverified namespace replacements do not count as citations", () => {
  const result = runCitationCheck(
    baseInputs({
      citationMode: "strict",
      libraryUsed: true,
      auditOptions: {
        kiHits: [{ id: "aaaaaaaa1111", title: "Real KI" }],
      },
      assistantText: `KI["Invented KI"]`,
    }),
  );
  assertEquals(result.citationsFound, 0);
  assertEquals(
    result.issues.some((issue) => issue.code === "unverified_citation"),
    true,
  );
});

// ─── Telemetry shape ───────────────────────────────────────────────

Deno.test("buildCitationCheckLog includes workspace + contract + surface", () => {
  const result = runCitationCheck(
    baseInputs({
      citationMode: "none_unless_library_used",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: "no citations here",
    }),
  );

  const log = buildCitationCheckLog({
    result,
    workspace: "brainstorm",
    contractVersion: "1.1.0",
    surface: "strategy-chat",
  });

  assertEquals(log.workspace, "brainstorm");
  assertEquals(log.contractVersion, "1.1.0");
  assertEquals(log.surface, "strategy-chat");
  assertEquals(log.citationMode, "none_unless_library_used");
  assertEquals(log.audited, true);
  assert(Array.isArray(log.issues));
});

Deno.test("buildCitationCheckLog supports run-task surface with taskType + runId", () => {
  const result = runCitationCheck(
    baseInputs({
      citationMode: "strict",
      workspace: "artifacts",
      libraryHits: HITS,
      libraryUsed: true,
      assistantText: `RESOURCE["Q2 Business Case Template"]`,
    }),
  );

  const log = buildCitationCheckLog({
    result,
    workspace: "artifacts",
    contractVersion: "1.1.0",
    surface: "run-task",
    taskType: "discovery_prep",
    runId: "run-123",
  });

  assertEquals(log.surface, "run-task");
  assertEquals(log.taskType, "discovery_prep");
  assertEquals(log.runId, "run-123");
});
