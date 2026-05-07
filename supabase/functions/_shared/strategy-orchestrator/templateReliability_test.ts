// Phase 4G-2 — Tests for sectionCanonicalizer, batchOutputValidator, sectionIntegrityAnalyzer

import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";

// ── sectionCanonicalizer tests ──────────────────────────────────

import { canonicalizeSectionName, canonicalizeDraftSections } from "./sectionCanonicalizer.ts";

Deno.test("canonicalizeSectionName: exact match", () => {
  const result = canonicalizeSectionName("cockpit", "discovery_prep");
  assert(result !== null);
  assertEquals(result!.canonical_id, "cockpit");
  assertEquals(result!.was_remapped, false);
});

Deno.test("canonicalizeSectionName: alias match", () => {
  const result = canonicalizeSectionName("Executive Summary", "discovery_prep");
  assert(result !== null);
  assertEquals(result!.canonical_id, "executive_snapshot");
  assertEquals(result!.was_remapped, true);
});

Deno.test("canonicalizeSectionName: unknown returns null", () => {
  const result = canonicalizeSectionName("totally_unknown_section", "discovery_prep");
  assertEquals(result, null);
});

Deno.test("canonicalizeDraftSections: remaps aliases", () => {
  const sections = [
    { id: "Executive Summary", name: "Executive Summary", content: "text" },
    { id: "cockpit", name: "Page-1 Cockpit", content: "text" },
  ];
  const result = canonicalizeDraftSections(sections, "discovery_prep");
  assertEquals(result.sections[0].id, "executive_snapshot");
  assertEquals(result.sections[1].id, "cockpit");
  assertEquals(result.remapped_count, 1);
});

Deno.test("canonicalizeDraftSections: deduplicates", () => {
  const sections = [
    { id: "cockpit", name: "Cockpit", content: "first" },
    { id: "cockpit", name: "Cockpit", content: "duplicate" },
  ];
  const result = canonicalizeDraftSections(sections, "discovery_prep");
  assertEquals(result.sections.length, 1);
  assertEquals(result.sections[0].content, "first");
});

Deno.test("canonicalizeDraftSections: account_brief sections", () => {
  const sections = [
    { id: "Company Snapshot", name: "Company Snapshot", content: "text" },
  ];
  const result = canonicalizeDraftSections(sections, "account_brief");
  assertEquals(result.sections[0].id, "company_snapshot");
  assertEquals(result.remapped_count, 1);
});

// ── batchOutputValidator tests ──────────────────────────────────

import { validateBatchOutput } from "./batchOutputValidator.ts";

Deno.test("validateBatchOutput: valid output passes", () => {
  const parsed = { sections: [{ id: "cockpit", name: "Cockpit", content: "text content here" }] };
  const result = validateBatchOutput(parsed, ["cockpit"]);
  assertEquals(result.pass, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("validateBatchOutput: missing section fails", () => {
  const parsed = { sections: [] };
  const result = validateBatchOutput(parsed, ["cockpit"]);
  assertEquals(result.pass, false);
  assertEquals(result.retryable, true);
  assert(result.violations.some(v => v.type === "missing_section"));
});

Deno.test("validateBatchOutput: null input fails", () => {
  const result = validateBatchOutput(null, ["cockpit"]);
  assertEquals(result.pass, false);
  assertEquals(result.retryable, true);
});

Deno.test("validateBatchOutput: duplicate section detected", () => {
  const parsed = { sections: [
    { id: "cockpit", name: "Cockpit", content: "first" },
    { id: "cockpit", name: "Cockpit", content: "dupe" },
  ]};
  const result = validateBatchOutput(parsed, ["cockpit"]);
  assert(result.violations.some(v => v.type === "duplicate_section"));
});

Deno.test("validateBatchOutput: empty content detected", () => {
  const parsed = { sections: [{ id: "cockpit", name: "Cockpit", content: "" }] };
  const result = validateBatchOutput(parsed, ["cockpit"]);
  assert(result.violations.some(v => v.type === "empty_content"));
});

// ── sectionIntegrityAnalyzer tests ──────────────────────────────

import { analyzeSectionIntegrity } from "./sectionIntegrityAnalyzer.ts";

Deno.test("analyzeSectionIntegrity: all sections present passes", () => {
  // account_brief has only 4 sections, easier to test
  const draft = {
    sections: [
      { id: "company_snapshot", name: "Company Snapshot", content: "text content" },
      { id: "stakeholders", name: "Stakeholders", content: "text content" },
      { id: "operator_read", name: "Operator Read", content: "text content" },
      { id: "next_moves", name: "Next Moves", content: "text content" },
    ],
  };
  const result = analyzeSectionIntegrity(draft, "account_brief");
  assertEquals(result.integrity_pass, true);
  assertEquals(result.missing_sections.length, 0);
  assertEquals(result.sections_present, 4);
  assertEquals(result.sections_expected, 4);
});

Deno.test("analyzeSectionIntegrity: missing sections detected", () => {
  const draft = {
    sections: [
      { id: "company_snapshot", name: "Company Snapshot", content: "text" },
    ],
  };
  const result = analyzeSectionIntegrity(draft, "account_brief");
  assertEquals(result.integrity_pass, false);
  assertEquals(result.missing_sections.length, 3);
  assert(result.missing_sections.includes("stakeholders"));
});

Deno.test("analyzeSectionIntegrity: empty content detected", () => {
  const draft = {
    sections: [
      { id: "company_snapshot", name: "Company Snapshot", content: "" },
      { id: "stakeholders", name: "Stakeholders", content: "ok" },
      { id: "operator_read", name: "Operator Read", content: "ok" },
      { id: "next_moves", name: "Next Moves", content: "ok" },
    ],
  };
  const result = analyzeSectionIntegrity(draft, "account_brief");
  assertEquals(result.integrity_pass, false);
  assert(result.empty_sections.includes("company_snapshot"));
});

Deno.test("analyzeSectionIntegrity: duplicate sections detected", () => {
  const draft = {
    sections: [
      { id: "company_snapshot", name: "Company Snapshot", content: "a" },
      { id: "company_snapshot", name: "Company Snapshot", content: "b" },
      { id: "stakeholders", name: "Stakeholders", content: "text" },
      { id: "operator_read", name: "Operator Read", content: "text" },
      { id: "next_moves", name: "Next Moves", content: "text" },
    ],
  };
  const result = analyzeSectionIntegrity(draft, "account_brief");
  assert(result.duplicated_sections.includes("company_snapshot"));
});
