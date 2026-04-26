// ════════════════════════════════════════════════════════════════
// Retrieval Enforcement (W3) — behavioral tests (corrected for
// the universal-library `libraryUse` model).
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

Deno.test("W3 resolver: unknown key falls back to work (libraryUse=relevant)", () => {
  const r = resolveServerWorkspaceContract("not_a_workspace");
  assertEquals(r.workspace, "work");
  assertEquals(r.retrievalRules.libraryUse, "relevant");
  assertEquals(r.normalization.fellBack, true);
  assertEquals(r.normalization.note?.code, "workspace_key_fallback");
});

Deno.test("W3 resolver: null/undefined fall back to work", () => {
  assertEquals(resolveServerWorkspaceContract(null).workspace, "work");
  assertEquals(resolveServerWorkspaceContract(undefined).workspace, "work");
});

// ─── decideLibraryQuery: background ──────────────────────────────

Deno.test("libraryUse: background → does NOT auto-query without explicit request", () => {
  const rules = getWorkspaceContract("refine").retrievalRules; // background
  const d = decideLibraryQuery(rules, {
    userContent: "tighten this email",
    derivedScopes: ["cold-email"],
    legacyWouldQuery: true,
  });
  assertEquals(d.shouldQuery, false);
  assertEquals(d.reason, "background_no_explicit_request");
});

Deno.test("libraryUse: background → queries when user explicitly requests library", () => {
  const rules = getWorkspaceContract("refine").retrievalRules;
  const d = decideLibraryQuery(rules, {
    userContent: "rewrite this using my saved playbooks",
    derivedScopes: [],
    legacyWouldQuery: false,
    userExplicitlyRequestedLibrary: true,
  });
  assertEquals(d.shouldQuery, true);
  assertEquals(d.reason, "background_explicit_request");
});

// ─── decideLibraryQuery: relevant ────────────────────────────────

Deno.test("libraryUse: relevant → queries when scopes/signals exist", () => {
  const rules = getWorkspaceContract("brainstorm").retrievalRules;
  const d = decideLibraryQuery(rules, {
    userContent: "ideas for outbound to enterprise SaaS",
    derivedScopes: ["enterprise-saas"],
    legacyWouldQuery: true,
  });
  assertEquals(d.shouldQuery, true);
  assertEquals(d.reason, "relevant_with_signal");
});

Deno.test("libraryUse: relevant → skips when no signal AND no content", () => {
  const rules = getWorkspaceContract("work").retrievalRules;
  const d = decideLibraryQuery(rules, {
    userContent: "",
    derivedScopes: [],
    legacyWouldQuery: false,
  });
  assertEquals(d.shouldQuery, false);
  assertEquals(d.reason, "relevant_no_signal");
});

// ─── decideLibraryQuery: primary ─────────────────────────────────

Deno.test("libraryUse: primary → always queries when a meaningful query exists", () => {
  const rules = getWorkspaceContract("deep_research").retrievalRules; // primary
  const d = decideLibraryQuery(rules, {
    userContent: "investigate Acme",
    derivedScopes: [],
    legacyWouldQuery: false,
  });
  assertEquals(d.shouldQuery, true);
  assertEquals(d.reason, "primary_default");
});

// ─── decideLibraryQuery: required ────────────────────────────────

Deno.test("libraryUse: required → always queries (Library workspace)", () => {
  const rules = getWorkspaceContract("library").retrievalRules;
  const d = decideLibraryQuery(rules, {
    userContent: "",
    derivedScopes: [],
    legacyWouldQuery: false,
  });
  assertEquals(d.shouldQuery, true);
  assertEquals(d.reason, "required");
});

// ─── evaluateLibraryCoverage ─────────────────────────────────────

Deno.test("coverage: not queried → not_needed", () => {
  const rules = getWorkspaceContract("refine").retrievalRules;
  const state = evaluateLibraryCoverage({
    rules,
    libraryHitCount: 0,
    libraryQueried: false,
  });
  assertEquals(state, "not_needed");
});

Deno.test("coverage: queried with hits → used", () => {
  const rules = getWorkspaceContract("deep_research").retrievalRules;
  const state = evaluateLibraryCoverage({
    rules,
    libraryHitCount: 3,
    libraryQueried: true,
  });
  assertEquals(state, "used");
});

Deno.test("coverage: primary + 0 hits → no_relevant_hits (non-fatal)", () => {
  const rules = getWorkspaceContract("artifacts").retrievalRules; // primary
  const state = evaluateLibraryCoverage({
    rules,
    libraryHitCount: 0,
    libraryQueried: true,
  });
  assertEquals(state, "no_relevant_hits");
});

Deno.test("coverage: required + 0 hits → required_missing", () => {
  const rules = getWorkspaceContract("library").retrievalRules;
  const state = evaluateLibraryCoverage({
    rules,
    libraryHitCount: 0,
    libraryQueried: true,
  });
  assertEquals(state, "required_missing");
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
  const coverage = evaluateLibraryCoverage({
    rules: resolved.retrievalRules,
    libraryHitCount: 0,
    libraryQueried: libraryDecision.shouldQuery,
  });
  const log = buildRetrievalDecisionLog({
    resolved,
    libraryDecision,
    libraryHitCount: 0,
    libraryCoverageState: coverage,
    webDecision,
    webHitCount: 0,
    surface: "test",
  });
  assertEquals(log.workspace, "library");
  assertEquals(log.libraryUse, "required");
  assertEquals(log.libraryQueried, true);
  assertEquals(log.libraryCoverageState, "required_missing");
  assertEquals(log.surface, "test");
  assert(log.contractVersion.length > 0);
  assertEquals(log.contractVersion, "1.1.0");
});

Deno.test("buildRetrievalDecisionLog: primary + 0 hits logs no_relevant_hits, not failure", () => {
  const resolved = resolveServerWorkspaceContract("artifacts"); // primary
  const libraryDecision = decideLibraryQuery(resolved.retrievalRules, {
    userContent: "build the brief",
    derivedScopes: ["acme"],
    legacyWouldQuery: true,
  });
  const coverage = evaluateLibraryCoverage({
    rules: resolved.retrievalRules,
    libraryHitCount: 0,
    libraryQueried: libraryDecision.shouldQuery,
  });
  const log = buildRetrievalDecisionLog({
    resolved,
    libraryDecision,
    libraryHitCount: 0,
    libraryCoverageState: coverage,
    webDecision: { shouldQuery: false, reason: "no_web_capability_wired" },
    webHitCount: 0,
  });
  assertEquals(log.libraryUse, "primary");
  assertEquals(log.libraryQueried, true);
  assertEquals(log.libraryCoverageState, "no_relevant_hits");
});
