// Deterministic tests for citationAudit.ts.
// No network, no model calls. Pure string in / string out.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { auditResourceCitations } from "./citationAudit.ts";

const HITS = [
  { id: "11111111-aaaa-bbbb-cccc-dddddddddddd", title: "AE Operating System - Business Case Template" },
  { id: "22222222-eeee-ffff-0000-111111111111", title: "Mid-Market Discovery Prep Doc Template" },
];

Deno.test("auditResourceCitations: no-op when text has no citations and hits are irrelevant", () => {
  const out = auditResourceCitations("Just a normal answer with no resource references.", HITS);
  assertEquals(out.modified, false);
  assertEquals(out.unverifiedCitations.length, 0);
});

Deno.test("auditResourceCitations: passes a verified RESOURCE[\"title\"] citation through unchanged", () => {
  const text = `Use RESOURCE["AE Operating System - Business Case Template"] to scaffold the doc.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, false);
  assertEquals(out.unverifiedCitations.length, 0);
  assertEquals(out.verifiedTitles.length, 1);
});

Deno.test("auditResourceCitations: passes a verified RESOURCE[id-short] through unchanged", () => {
  const text = `Use RESOURCE[11111111] for the structure.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, false);
  assertEquals(out.verifiedTitles.includes("11111111"), true);
});

Deno.test("auditResourceCitations: rewrites a fabricated RESOURCE[\"title\"] to UNVERIFIED and appends banner", () => {
  const text = `I recommend RESOURCE["Force Management Value Pyramid Template"] for this account.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, `⚠ UNVERIFIED["Force Management Value Pyramid Template"]`);
  assertStringIncludes(out.text, "Citation audit:");
  assertEquals(out.unverifiedCitations.length, 1);
});

Deno.test("auditResourceCitations: rewrites a fabricated RESOURCE[id-short] to UNVERIFIED", () => {
  const text = `Use RESOURCE[deadbeef] as the base.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "⚠ UNVERIFIED[deadbeef]");
});

Deno.test("auditResourceCitations: flags informal '\"X\" template' style references not in library", () => {
  const text = `Let's build it off the "Kevin Dorsey ROI Calculator" template. It's the standard.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, `[⚠ not in your library]`);
  assertEquals(out.unverifiedCitations.length, 1);
});

Deno.test("auditResourceCitations: does NOT flag a verified informal reference next to artifact word", () => {
  const text = `The "AE Operating System - Business Case Template" template covers this.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, false);
});

Deno.test("auditResourceCitations: does NOT touch quoted seller statements (no artifact word nearby)", () => {
  const text = `The CFO said "we are losing 18 points to repeat-borrower churn" on the call.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, false);
});

Deno.test("auditResourceCitations: tolerates substring title matches (model trimming)", () => {
  // Model writes a shortened version of the real title.
  const text = `Use RESOURCE["Business Case Template"] as the base.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, false, `expected substring tolerance, got: ${out.text}`);
  assertEquals(out.verifiedTitles.length, 1);
});

Deno.test("auditResourceCitations: handles multiple citations — mixed verified and fabricated", () => {
  const text = `Start with RESOURCE["AE Operating System - Business Case Template"], then layer in RESOURCE["MEDDPICC Pro Calculator"].`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, `RESOURCE["AE Operating System - Business Case Template"]`);
  assertStringIncludes(out.text, `⚠ UNVERIFIED["MEDDPICC Pro Calculator"]`);
  assertEquals(out.verifiedTitles.length, 1);
  assertEquals(out.unverifiedCitations.length, 1);
});

Deno.test("auditResourceCitations: empty text → no-op", () => {
  const out = auditResourceCitations("", HITS);
  assertEquals(out.modified, false);
  assertEquals(out.text, "");
});

Deno.test("auditResourceCitations: no hits + fabricated citation → still flagged", () => {
  const text = `Use RESOURCE["Anything I Made Up"] for this.`;
  const out = auditResourceCitations(text, []);
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "⚠ UNVERIFIED");
});
