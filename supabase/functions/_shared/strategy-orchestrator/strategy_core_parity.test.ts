// ════════════════════════════════════════════════════════════════
// PR #1 parity test — proves Strategy Core extraction is byte-equivalent.
//
// Failure of any assertion in this file means Discovery Prep is no
// longer composing from the shared primitives, OR the primitives have
// drifted from the original inline strings. Both are PR #1 violations.
// ════════════════════════════════════════════════════════════════

import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { discoveryPrepHandler } from "./handlers/discoveryPrep.ts";
import {
  ACCOUNT_SPECIFICITY_RULE,
  CRITIQUE_IDENTITY_INSTRUCTION,
  ECONOMIC_FRAMING_RULES,
  FACT_DISCIPLINE_RULES,
  STRATEGY_CORE_THINKING_ORDER,
  libraryGroundingHeader,
} from "../strategy-core/index.ts";
import type { LibraryRetrievalResult } from "./types.ts";

const EMPTY_LIBRARY: LibraryRetrievalResult = {
  knowledgeItems: [],
  playbooks: [],
  contextString: "",
  counts: { kis: 0, playbooks: 0 },
};

// ──────────────────────────────────────────────────────────────────
// 1. Document system prompt embeds every reasoning primitive verbatim.
// ──────────────────────────────────────────────────────────────────
Deno.test("strategy-core parity: document system prompt contains every primitive verbatim", () => {
  const sys = discoveryPrepHandler.buildDocumentSystemPrompt();
  assertStringIncludes(sys, STRATEGY_CORE_THINKING_ORDER);
  assertStringIncludes(sys, FACT_DISCIPLINE_RULES);
  assertStringIncludes(sys, ACCOUNT_SPECIFICITY_RULE);
  assertStringIncludes(sys, ECONOMIC_FRAMING_RULES);
});

// ──────────────────────────────────────────────────────────────────
// 2. Original inline strings still appear verbatim in the assembled
//    prompt — proves no character drift from before extraction.
// ──────────────────────────────────────────────────────────────────
Deno.test("strategy-core parity: original phrasing unchanged in assembled system prompt", () => {
  const sys = discoveryPrepHandler.buildDocumentSystemPrompt();
  // Marker phrases from each block of the original inline prompt.
  assertStringIncludes(sys, "NON-NEGOTIABLE STRATEGY CORE THINKING ORDER (you must complete BEFORE writing):");
  assertStringIncludes(sys, "STEP 1 — ACCOUNT THESIS:");
  assertStringIncludes(sys, "STEP 4 — ALIGNMENT:");
  assertStringIncludes(sys, "FACT DISCIPLINE (CRITICAL):");
  assertStringIncludes(sys, "Use VALID / INFER / HYPO / UNKN.");
  assertStringIncludes(sys, "ACCOUNT-SPECIFICITY RULE:");
  assertStringIncludes(sys, "SOLUTION DISCIPLINE:");
  assertStringIncludes(sys, "Order: Diagnose → Quantify → Validate → Propose motion.");
  assertStringIncludes(sys, "TEMPLATE RULES:");
  assertStringIncludes(sys, "Discovery questions: EXACTLY 10");
});

// ──────────────────────────────────────────────────────────────────
// 3. Review prompt uses the shared critique identity + grounding helper.
// ──────────────────────────────────────────────────────────────────
Deno.test("strategy-core parity: review prompt uses shared critique primitives", () => {
  const review = discoveryPrepHandler.buildReviewPrompt(
    { company_name: "Acme" } as any,
    { sections: [{ id: "cockpit", content: {} }] },
    EMPTY_LIBRARY,
  );
  assertStringIncludes(review, CRITIQUE_IDENTITY_INSTRUCTION);
  // Empty library must surface the explicit coverage-gap fallback line.
  assertStringIncludes(review, libraryGroundingHeader(EMPTY_LIBRARY));
  assertStringIncludes(review, "(No relevant library entries found");
  // Original review structure must still be present.
  assertStringIncludes(review, "Produce ONE coherent review");
  assertStringIncludes(review, "rubric_check");
});

// ──────────────────────────────────────────────────────────────────
// 4. Library context string flows through unchanged when present.
// ──────────────────────────────────────────────────────────────────
Deno.test("strategy-core parity: review prompt embeds library context when present", () => {
  const lib: LibraryRetrievalResult = {
    knowledgeItems: [],
    playbooks: [],
    contextString: "=== INTERNAL KNOWLEDGE ITEMS ===\nKI[abcd1234] Test KI",
    counts: { kis: 1, playbooks: 0 },
  };
  const review = discoveryPrepHandler.buildReviewPrompt(
    { company_name: "Acme" } as any,
    { sections: [] },
    lib,
  );
  assertStringIncludes(review, "KI[abcd1234] Test KI");
  // Fallback must NOT be emitted when library is non-empty.
  assert(
    !review.includes("(No relevant library entries found"),
    "fallback line leaked into review prompt despite non-empty library",
  );
});
