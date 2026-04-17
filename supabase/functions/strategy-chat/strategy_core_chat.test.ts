// ════════════════════════════════════════════════════════════════
// PR #2 chat-prompt test — proves Strategy chat now composes from the
// shared Strategy Core primitives (the same ones Discovery Prep uses).
//
// These tests are pure — they exercise the prompt composer directly
// rather than spinning up the edge function. The composer is the
// single seam between chat and Strategy Core, so testing it locks the
// contract without coupling to provider transport, streaming, or DB.
// ════════════════════════════════════════════════════════════════

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACCOUNT_SPECIFICITY_RULE,
  ECONOMIC_FRAMING_RULES,
  FACT_DISCIPLINE_RULES,
  STRATEGY_CORE_THINKING_ORDER,
  buildStrategyChatSystemPrompt,
  shouldUseStrategyCorePrompt,
} from "../_shared/strategy-core/index.ts";

// ──────────────────────────────────────────────────────────────────
// 1. Composed chat prompt contains every Strategy Core primitive.
// ──────────────────────────────────────────────────────────────────
Deno.test("chat prompt: includes every Strategy Core primitive", () => {
  const sys = buildStrategyChatSystemPrompt({
    depth: "Standard",
    contextSection: "",
    accountContext: "Account: Acme\nIndustry: Retail",
    libraryContext: "",
  });
  assertStringIncludes(sys, STRATEGY_CORE_THINKING_ORDER);
  assertStringIncludes(sys, FACT_DISCIPLINE_RULES);
  assertStringIncludes(sys, ACCOUNT_SPECIFICITY_RULE);
  assertStringIncludes(sys, ECONOMIC_FRAMING_RULES);
  // Output contract markers we promised the user the model will follow.
  assertStringIncludes(sys, "ACCOUNT THESIS");
  assertStringIncludes(sys, "VALUE LEAKAGE");
  assertStringIncludes(sys, "ECONOMIC CONSEQUENCE");
  assertStringIncludes(sys, "NEXT BEST DISCOVERY ACTION");
});

// ──────────────────────────────────────────────────────────────────
// 2. Library context is injected when present.
// ──────────────────────────────────────────────────────────────────
Deno.test("chat prompt: injects library context when available", () => {
  const sys = buildStrategyChatSystemPrompt({
    depth: "Deep",
    contextSection: "",
    accountContext: "Account: Acme",
    libraryContext: "KI[abc12345] Discovery Question Stack\n  Tactic: lead with consequence",
  });
  assertStringIncludes(sys, "INTERNAL LIBRARY");
  assertStringIncludes(sys, "KI[abc12345]");
  assertStringIncludes(sys, "Discovery Question Stack");
});

// ──────────────────────────────────────────────────────────────────
// 3. Empty library degrades safely — no INTERNAL LIBRARY header.
// ──────────────────────────────────────────────────────────────────
Deno.test("chat prompt: empty library degrades safely", () => {
  const sys = buildStrategyChatSystemPrompt({
    depth: "Standard",
    contextSection: "Some thread context",
    accountContext: "Account: Acme",
    libraryContext: "",
  });
  // No header without payload — we don't want a dangling section.
  assert(!sys.includes("INTERNAL LIBRARY"));
  // Account context still flows through.
  assertStringIncludes(sys, "ACCOUNT CONTEXT");
  assertStringIncludes(sys, "Account: Acme");
  // Existing thread contextSection is preserved.
  assertStringIncludes(sys, "Some thread context");
});

// ──────────────────────────────────────────────────────────────────
// 4. Depth modifier flips between Fast / Standard / Deep.
// ──────────────────────────────────────────────────────────────────
Deno.test("chat prompt: depth modifier switches per mode", () => {
  const fast = buildStrategyChatSystemPrompt({ depth: "Fast", accountContext: "Account: A" });
  const std = buildStrategyChatSystemPrompt({ depth: "Standard", accountContext: "Account: A" });
  const deep = buildStrategyChatSystemPrompt({ depth: "Deep", accountContext: "Account: A" });
  assertStringIncludes(fast, "Depth: Fast");
  assertStringIncludes(std, "Depth: Standard");
  assertStringIncludes(deep, "Depth: Deep");
  // Unknown depth falls back to Standard (no crash, no missing block).
  const weird = buildStrategyChatSystemPrompt({ depth: "Banana" as any, accountContext: "Account: A" });
  assertStringIncludes(weird, "Depth: Standard");
});

// ──────────────────────────────────────────────────────────────────
// 5. shouldUseStrategyCorePrompt — gating heuristic.
// ──────────────────────────────────────────────────────────────────
Deno.test("chat gating: account-linked threads always use Strategy Core", () => {
  assertEquals(shouldUseStrategyCorePrompt({ hasAccount: true }), true);
});

Deno.test("chat gating: no account + no library + no context → fall back", () => {
  assertEquals(
    shouldUseStrategyCorePrompt({
      hasAccount: false,
      libraryCounts: { kis: 0, playbooks: 0 },
      contextSectionLength: 0,
    }),
    false,
  );
});

Deno.test("chat gating: no account but meaningful library hits → use Core", () => {
  assertEquals(
    shouldUseStrategyCorePrompt({
      hasAccount: false,
      libraryCounts: { kis: 2, playbooks: 0 },
      contextSectionLength: 0,
    }),
    true,
  );
});

Deno.test("chat gating: heavy thread context without account → use Core", () => {
  assertEquals(
    shouldUseStrategyCorePrompt({
      hasAccount: false,
      libraryCounts: { kis: 0, playbooks: 0 },
      contextSectionLength: 5000,
    }),
    true,
  );
});
