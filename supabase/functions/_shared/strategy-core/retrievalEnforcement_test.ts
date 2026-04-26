// ════════════════════════════════════════════════════════════════
// Retrieval Enforcement (W3) — behavioral tests
//
// Pure unit tests against the gating + ordering helpers. We do NOT
// hit the database here — the contract is that callers use these
// decisions to skip / order downstream calls.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildRetrievalDecisionLog,
  decideLibraryQuery,
  decideWebQuery,
  evaluateLibraryCoverage,
  orderContextBlocks,
  resolveServerWorkspaceContract,
  type OrderableContextBlock,
} from "./retrievalEnforcement.ts";
import { getWorkspaceContract } from "./workspaceContracts.ts";

// ─── resolveServerWorkspaceContract ──────────────────────────────

Deno.test("W3 resolver: canonical key resolves to its contract", () => {
  const r = resolveServerWorkspaceContract("deep_research");
  assertEquals(r.workspace, "deep_research");
  assertEquals(r.contract, getWorkspaceContract("deep_research"));
  assertEquals(r.normalization.fellBack, false);
});

Deno.test("W3 resolver: alias 'research' maps to deep_research", () => {
  const r = resolveServerWorkspaceContract("research");
  assertEquals(r.workspace, "deep_research");
  assertEquals(r.normalization.fellBack, true);
  assertEquals(r.normalization.note?.code, "workspace_key_alias");
});

Deno.test("W3 resolver: unknown key falls back to work", () => {
  const r = resolveServerWorkspaceContract("not_a_workspace");
  assertEquals(r.workspace, "work");
  assertEquals(r.normalization.fellBack, true);
  assertEquals(r.normalization.note?.code, "workspace_key_fallback");
});

Deno.test("W3 resolver: null/undefined fall back to work", () => {
  assertEquals(resolveServerWorkspaceContract(null).workspace, "work");
  assertEquals(resolveServerWorkspaceContract(undefined).workspace, "work");
});

// ─── decideLibraryQuery ──────────────────────────────────────────

Deno.test("libraryMode: off → never queries", () => {
  const rules = getWorkspaceContract("refine").retrievalRules; // off
  const d = decideLibraryQuery(rules, {
    userContent: "tighten this email",
    derivedScopes: ["cold-email"],
    legacyWouldQuery: true,
  });
  assertEquals(d.shouldQuery, false);
  assertEquals(d.reason, "library_mode_off");
});

Deno.test("libraryMode: preferred → queries when scopes exist", () => {
  const rules = getWorkspaceContract("deep_research").retrievalRules;
  const d = decideLibraryQuery(rules, {
    userContent: "investigate Acme",
    derivedScopes: ["enterprise-saas"],
    legacyWouldQuery: false,
  });
  assertEquals(d.shouldQuery, true);
  assertEquals(d.reason, "preferred_with_query");
});

Deno.test("libraryMode: preferred → skips when no scopes and no content", () => {
  const rules = getWorkspaceContract("deep_research").retrievalRules;
  const d = decideLibraryQuery(rules, {
    userContent: "",
    derivedScopes: [],
    legacyWouldQuery: false,
  });
  assertEquals(d.shouldQuery, false);
});

Deno.test("libraryMode: required → always queries (Library workspace)", () => {
  const rules = getWorkspaceContract("library").retrievalRules;
  const d = decideLibraryQuery(rules, {
    userContent: "",
    derivedScopes: [],
    legacyWouldQuery: false,
  });
  assertEquals(d.shouldQuery, true);
  assertEquals(d.reason, "required");
});

Deno.test("libraryMode: opportunistic preserves legacy behavior", () => {
  const rules = getWorkspaceContract("brainstorm").retrievalRules;
  const queriedWhenLegacyWould = decideLibraryQuery(rules, {
    userContent: "ideas for outbound",
    derivedScopes: ["outbound"],
    legacyWouldQuery: true,
  });
  assertEquals(queriedWhenLegacyWould.shouldQuery, true);

  const skippedWhenLegacyWouldNot = decideLibraryQuery(rules, {
    userContent: "ideas for outbound",
    derivedScopes: [],
    legacyWouldQuery: false,
  });
  assertEquals(skippedWhenLegacyWouldNot.shouldQuery, false);
});

// ─── evaluateLibraryCoverage ─────────────────────────────────────

Deno.test("coverage: required + 0 hits → gap", () => {
  const rules = getWorkspaceContract("library").retrievalRules;
  const gap = evaluateLibraryCoverage({
    rules,
    libraryHitCount: 0,
    libraryQueried: true,
  });
  assertEquals(gap.hasGap, true);
  assertEquals(gap.reason, "library_required_no_hits");
});

Deno.test("coverage: preferred + 0 hits → no gap", () => {
  const rules = getWorkspaceContract("deep_research").retrievalRules;
  const gap = evaluateLibraryCoverage({
    rules,
    libraryHitCount: 0,
    libraryQueried: true,
  });
  assertEquals(gap.hasGap, false);
});

// ─── decideWebQuery ──────────────────────────────────────────────

Deno.test("webMode: off → never queries", () => {
  const rules = getWorkspaceContract("brainstorm").retrievalRules;
  const d = decideWebQuery(rules, {
    webCapabilityAvailable: true,
    legacyWouldQuery: true,
  });
  assertEquals(d.shouldQuery, false);
  assertEquals(d.reason, "web_mode_off");
});

Deno.test("webMode: required_for_current_facts but no capability → skip honestly", () => {
  const rules = getWorkspaceContract("deep_research").retrievalRules;
  const d = decideWebQuery(rules, {
    webCapabilityAvailable: false,
    legacyWouldQuery: false,
  });
  assertEquals(d.shouldQuery, false);
  assertEquals(d.reason, "no_web_capability_wired");
});

// ─── orderContextBlocks ──────────────────────────────────────────

Deno.test("contextMode: thread_first puts thread before account", () => {
  const blocks: OrderableContextBlock[] = [
    { kind: "account", text: "ACCOUNT" },
    { kind: "thread", text: "THREAD" },
  ];
  const rules = getWorkspaceContract("brainstorm").retrievalRules; // thread_first
  const out = orderContextBlocks(blocks, rules);
  assertEquals(out.map((b) => b.kind), ["thread", "account"]);
});

Deno.test("contextMode: draft_first puts draft before thread", () => {
  const blocks: OrderableContextBlock[] = [
    { kind: "thread", text: "T" },
    { kind: "draft", text: "D" },
    { kind: "account", text: "A" },
  ];
  const rules = getWorkspaceContract("refine").retrievalRules; // draft_first
  const out = orderContextBlocks(blocks, rules);
  assertEquals(out.map((b) => b.kind), ["draft", "thread", "account"]);
});

Deno.test("contextMode: artifact_first puts artifact before thread/account", () => {
  const blocks: OrderableContextBlock[] = [
    { kind: "account", text: "A" },
    { kind: "thread", text: "T" },
    { kind: "artifact", text: "AR" },
  ];
  const rules = getWorkspaceContract("artifacts").retrievalRules;
  const out = orderContextBlocks(blocks, rules);
  assertEquals(out[0].kind, "artifact");
});

Deno.test("ordering is stable for blocks of the same kind", () => {
  const blocks: OrderableContextBlock[] = [
    { kind: "account", text: "A1", label: "first" },
    { kind: "account", text: "A2", label: "second" },
  ];
  const rules = getWorkspaceContract("work").retrievalRules;
  const out = orderContextBlocks(blocks, rules);
  assertEquals(out.map((b) => b.label), ["first", "second"]);
});

// ─── buildRetrievalDecisionLog ───────────────────────────────────

Deno.test("buildRetrievalDecisionLog produces a complete telemetry payload", () => {
  const resolved = resolveServerWorkspaceContract("library");
  const libraryDecision = decideLibraryQuery(resolved.retrievalRules, {
    userContent: "find my saved playbooks",
    derivedScopes: [],
    legacyWouldQuery: false,
  });
  const webDecision = decideWebQuery(resolved.retrievalRules, {
    webCapabilityAvailable: false,
    legacyWouldQuery: false,
  });
  const gap = evaluateLibraryCoverage({
    rules: resolved.retrievalRules,
    libraryHitCount: 0,
    libraryQueried: libraryDecision.shouldQuery,
  });
  const log = buildRetrievalDecisionLog({
    resolved,
    libraryDecision,
    libraryHitCount: 0,
    libraryGap: gap,
    webDecision,
    webHitCount: 0,
    surface: "test",
  });
  assertEquals(log.workspace, "library");
  assertEquals(log.libraryMode, "required");
  assertEquals(log.libraryQueried, true);
  assertEquals(log.libraryCoverageGap, "library_required_no_hits");
  assertEquals(log.surface, "test");
  assert(log.contractVersion.length > 0);
});
