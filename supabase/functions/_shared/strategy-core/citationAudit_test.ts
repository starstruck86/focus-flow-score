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

Deno.test("auditResourceCitations: rejects RESOURCE[id-short] even when the id exists", () => {
  const text = `Use RESOURCE[11111111] for the structure.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "⚠ UNVERIFIED[11111111]");
  assertEquals(out.verifiedTitles.includes("11111111"), false);
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

Deno.test("auditResourceCitations: rejects shortened resource titles", () => {
  const text = `Use RESOURCE["Business Case Template"] as the base.`;
  const out = auditResourceCitations(text, HITS);
  assertEquals(out.modified, true);
  assertEquals(out.verifiedTitles.length, 0);
  assertStringIncludes(out.text, `⚠ UNVERIFIED["Business Case Template"]`);
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

// ── Closed-set mode (user picked a resource via /library) ─────────

const PICKED_HITS = [
  { id: "33333333-aaaa-bbbb-cccc-dddddddddddd", title: "FTD Q2 Business Case" },
];

Deno.test("auditResourceCitations closed-set: flags adjacent variant (Q3 vs picked Q2) without artifact word", () => {
  // Bare quoted title with no "template/playbook/etc." nearby — in
  // closed-set mode it must STILL be flagged because it shares ≥2
  // significant tokens with the picked title.
  const text = `Adapting the approach: see "FTD Q3 Business Case" for the full structure.`;
  const out = auditResourceCitations(text, PICKED_HITS, { closedSet: true });
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "only the picked resource may be cited");
  assert(out.unverifiedCitations.some((c) => c.includes("Q3")));
});

Deno.test("auditResourceCitations closed-set: passes the exact picked title through unchanged", () => {
  const text = `Using "FTD Q2 Business Case" as the base, adapt the structure for the deal.`;
  const out = auditResourceCitations(text, PICKED_HITS, { closedSet: true });
  assertEquals(out.modified, false);
  assertEquals(out.unverifiedCitations.length, 0);
});

Deno.test("auditResourceCitations closed-set: does NOT flag unrelated quoted strings (seller quotes)", () => {
  const text = `The CFO said "we are losing 18 points to churn" on the call.`;
  const out = auditResourceCitations(text, PICKED_HITS, { closedSet: true });
  assertEquals(out.modified, false);
});

Deno.test("auditResourceCitations closed-set: flags sibling variant inside RESOURCE[\"…\"] too", () => {
  const text = `Pull from RESOURCE["FTD Q4 Business Case"] for context.`;
  const out = auditResourceCitations(text, PICKED_HITS, { closedSet: true });
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "⚠ UNVERIFIED");
});

Deno.test("auditResourceCitations closed-set off: bare quoted variant is left alone (no artifact word)", () => {
  // Without closedSet=true the legacy behavior is preserved — bare
  // quoted strings without an artifact word are not annotated. Use a
  // phrase that does NOT contain any artifact words like "business case".
  const text = `Adapting the approach: see "FTD Q3 Initiative" for the full structure.`;
  const out = auditResourceCitations(text, PICKED_HITS);
  assertEquals(out.modified, false);
});

// ── KI/CARD title-form citations (Phase 6) ────────────────────────

const KI_HITS = [
  { id: "aaaaaaaa-1111-2222-3333-444444444444", title: "Command of the Message Framework" },
  { id: "bbbbbbbb-5555-6666-7777-888888888888", title: "Discovery Question Stack" },
];

const CARD_HITS = [
  { id: "cccccccc-9999-0000-1111-222222222222", title: "Discovery - Call Coaching" },
];

Deno.test("KI title citation: accepted when title matches", () => {
  const text = `Lean on KI["Command of the Message Framework"] for the opener.`;
  const out = auditResourceCitations(text, [], { kiHits: KI_HITS });
  assertEquals(out.modified, false);
  assertStringIncludes(out.text, `KI["Command of the Message Framework"]`);
  assertEquals(out.verifiedTitles.includes("KI:Command of the Message Framework"), true);
});

Deno.test("KI id citation: still accepted when id matches", () => {
  const text = `See KI[aaaaaaaa] for the structure.`;
  const out = auditResourceCitations(text, [], { kiHits: KI_HITS });
  assertEquals(out.modified, false);
  assertStringIncludes(out.text, "KI[aaaaaaaa]");
});

Deno.test("CARD title citation: accepted when title matches", () => {
  const text = `Use CARD["Discovery - Call Coaching"] for the prep.`;
  const out = auditResourceCitations(text, [], { cardHits: CARD_HITS });
  assertEquals(out.modified, false);
  assertEquals(
    out.verifiedTitles.includes("CARD:Discovery - Call Coaching"),
    true,
  );
});

Deno.test("CARD fallback accepts exactly eight matching hex characters", () => {
  const text = `Pull from CARD[cccccccc] in your library.`;
  const out = auditResourceCitations(text, [], { cardHits: CARD_HITS });
  assertEquals(out.modified, false);
  assertEquals(out.verifiedTitles.includes("CARD:cccccccc"), true);
  for (const id of ["cccccc", "ccccccccffff"]) {
    const malformed = auditResourceCitations(`CARD[${id}]`, [], {
      cardHits: CARD_HITS,
    });
    assertEquals(malformed.modified, true);
    assertEquals(malformed.verifiedTitles.length, 0);
  }
});

const PLAYBOOK_HITS = [
  {
    id: "dddddddd-9999-0000-1111-222222222222",
    title: "Champion Went Quiet",
  },
];

Deno.test("PLAYBOOK title citation: accepted when title matches", () => {
  const text = `Use PLAYBOOK["Champion Went Quiet"] for the next move.`;
  const out = auditResourceCitations(text, [], {
    playbookHits: PLAYBOOK_HITS,
  });
  assertEquals(out.modified, false);
  assertEquals(
    out.verifiedTitles.includes("PLAYBOOK:Champion Went Quiet"),
    true,
  );
});

Deno.test("PLAYBOOK id citation: rejected because title form is canonical", () => {
  const text = `Use PLAYBOOK[dddddddd] for the next move.`;
  const out = auditResourceCitations(text, [], {
    playbookHits: PLAYBOOK_HITS,
  });
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "⚠ UNVERIFIED-PLAYBOOK[dddddddd]");
});

Deno.test("KI fabricated title: flagged with UNVERIFIED-KI when audit has KI hit set", () => {
  const text = `Borrow from KI["Magical Closing Framework I Made Up"].`;
  const out = auditResourceCitations(text, [], { kiHits: KI_HITS });
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "⚠ UNVERIFIED-KI");
  assertStringIncludes(out.text, "Citation audit:");
});

Deno.test("CARD fabricated title: flagged with UNVERIFIED-CARD", () => {
  const text = `See CARD["Phantom Coaching Card"] for guidance.`;
  const out = auditResourceCitations(text, [], { cardHits: CARD_HITS });
  assertEquals(out.modified, true);
  assertStringIncludes(out.text, "⚠ UNVERIFIED-CARD");
});

Deno.test("KI/CARD scanning is OFF by default (backward compat)", () => {
  // Prior callers pass no kiHits/cardHits — KI[…] must pass through untouched
  // even when it doesn't match anything (we have no hit set to compare against).
  const text = `Reference KI["Anything At All"] and KI[deadbeef] here.`;
  const out = auditResourceCitations(text, []);
  assertEquals(out.modified, false);
  assertStringIncludes(out.text, `KI["Anything At All"]`);
  assertStringIncludes(out.text, "KI[deadbeef]");
});

Deno.test("explicit empty namespace hit sets reject fabricated citations", () => {
  const text = `KI["Invented"] CARD["Invented"] PLAYBOOK["Invented"]`;
  const out = auditResourceCitations(text, [], {
    kiHits: [],
    cardHits: [],
    playbookHits: [],
  });
  assertEquals(out.modified, true);
  assertEquals(out.unverifiedCitations.length, 3);
  assertStringIncludes(out.text, "⚠ UNVERIFIED-KI");
  assertStringIncludes(out.text, "⚠ UNVERIFIED-CARD");
  assertStringIncludes(out.text, "⚠ UNVERIFIED-PLAYBOOK");
});

Deno.test("already-unverified namespace tokens are not audited twice", () => {
  const text = `⚠ UNVERIFIED-KI["Bogus"] ⚠ UNVERIFIED-PLAYBOOK["Nope"]`;
  const out = auditResourceCitations(text, [], {
    kiHits: [],
    playbookHits: [],
  });
  assertEquals(out.modified, false);
  assertEquals(out.text, text);
});

Deno.test("KI shortened or ambiguous titles do not verify", () => {
  const text = `Apply KI["Command of the Message"] now.`;
  const out = auditResourceCitations(text, [], { kiHits: KI_HITS });
  assertEquals(out.modified, true);
  assertEquals(out.verifiedTitles.length, 0);
  for (const fragment of ["a", "Message"]) {
    const ambiguous = auditResourceCitations(`KI["${fragment}"]`, [], {
      kiHits: KI_HITS,
    });
    assertEquals(ambiguous.modified, true);
    assertEquals(ambiguous.verifiedTitles.length, 0);
  }
});

Deno.test("KI fallback accepts exactly 8 hex characters", () => {
  for (const id of ["aaaaaa", "aaaaaaaaffff"]) {
    const out = auditResourceCitations(`KI[${id}]`, [], { kiHits: KI_HITS });
    assertEquals(out.modified, true);
    assertEquals(out.verifiedTitles.length, 0);
  }
  const exact = auditResourceCitations("KI[aaaaaaaa]", [], {
    kiHits: KI_HITS,
  });
  assertEquals(exact.modified, false);
  assertEquals(exact.verifiedTitles.length, 1);
});
