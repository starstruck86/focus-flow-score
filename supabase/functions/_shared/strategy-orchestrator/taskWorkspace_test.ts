// ════════════════════════════════════════════════════════════════
// taskWorkspace_test — Phase W3 task → workspace resolver
//
// Verifies that every Strategy task_type maps to a canonical W3
// WorkspaceKey with the correct universal-library posture, and that
// telemetry built from the resolved contract uses `libraryUse` /
// `libraryCoverageState` (not the legacy mode/gap fields).
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { resolveTaskWorkspace } from "./taskWorkspace.ts";
import {
  buildRetrievalDecisionLog,
  decideLibraryQuery,
  decideWebQuery,
  evaluateLibraryCoverage,
  resolveServerWorkspaceContract,
} from "../strategy-core/retrievalEnforcement.ts";

Deno.test("discovery_prep maps to artifacts (libraryUse: primary)", () => {
  const r = resolveTaskWorkspace("discovery_prep");
  assertEquals(r.workspace, "artifacts");
  assertEquals(r.taskFellBack, false);
  const contract = resolveServerWorkspaceContract(r.workspace);
  assertEquals(contract.retrievalRules.libraryUse, "primary");
});

Deno.test("account_brief maps to deep_research (libraryUse: primary)", () => {
  const r = resolveTaskWorkspace("account_brief");
  assertEquals(r.workspace, "deep_research");
  assertEquals(r.taskFellBack, false);
  const contract = resolveServerWorkspaceContract(r.workspace);
  assertEquals(contract.retrievalRules.libraryUse, "primary");
});

Deno.test("account_research_* prefix maps to deep_research", () => {
  const r = resolveTaskWorkspace("account_research_v2");
  assertEquals(r.workspace, "deep_research");
  assertEquals(r.taskFellBack, false);
});

Deno.test("ninety_day_plan maps to projects (libraryUse: primary)", () => {
  const r = resolveTaskWorkspace("ninety_day_plan");
  assertEquals(r.workspace, "projects");
  assertEquals(r.taskFellBack, false);
  const contract = resolveServerWorkspaceContract(r.workspace);
  assertEquals(contract.retrievalRules.libraryUse, "primary");
});

Deno.test("unknown task_type falls back to work (libraryUse: relevant)", () => {
  const r = resolveTaskWorkspace("totally_unknown_task");
  assertEquals(r.workspace, "work");
  assertEquals(r.taskFellBack, true);
  const contract = resolveServerWorkspaceContract(r.workspace);
  assertEquals(contract.retrievalRules.libraryUse, "relevant");
});

Deno.test("empty / null task_type falls back to work", () => {
  assertEquals(resolveTaskWorkspace("").workspace, "work");
  assertEquals(resolveTaskWorkspace(null).workspace, "work");
  assertEquals(resolveTaskWorkspace(undefined).workspace, "work");
  assertEquals(resolveTaskWorkspace("   ").workspace, "work");
});

Deno.test("telemetry payload uses libraryUse + libraryCoverageState", () => {
  const r = resolveTaskWorkspace("discovery_prep");
  const resolved = resolveServerWorkspaceContract(r.workspace);

  const libraryDecision = decideLibraryQuery(resolved.retrievalRules, {
    userContent: "Acme renewal prep",
    derivedScopes: ["renewal", "discovery"],
    legacyWouldQuery: true,
    userExplicitlyRequestedLibrary: false,
  });
  assertEquals(libraryDecision.shouldQuery, true);

  const coverage = evaluateLibraryCoverage({
    rules: resolved.retrievalRules,
    libraryQueried: libraryDecision.shouldQuery,
    libraryHitCount: 3,
  });
  assertEquals(coverage, "used");

  const webDecision = decideWebQuery(resolved.retrievalRules, {
    webCapabilityAvailable: false,
    legacyWouldQuery: false,
  });

  const log = buildRetrievalDecisionLog({
    resolved,
    libraryDecision,
    libraryHitCount: 3,
    libraryCoverageState: coverage,
    webDecision,
    webHitCount: 0,
    surface: "run-task",
  });

  assertEquals(log.workspace, "artifacts");
  assertEquals(log.libraryUse, "primary");
  assertEquals(log.libraryQueried, true);
  assertEquals(log.libraryHitCount, 3);
  assertEquals(log.libraryCoverageState, "used");
  assertEquals(log.surface, "run-task");
  assert(typeof log.contractVersion === "string" && log.contractVersion.length > 0);
  // Legacy field names must not appear.
  assertEquals((log as Record<string, unknown>).libraryMode, undefined);
  assertEquals((log as Record<string, unknown>).libraryCoverageGap, undefined);
});

Deno.test("primary task with zero library hits → no_relevant_hits (non-fatal)", () => {
  const r = resolveTaskWorkspace("discovery_prep");
  const resolved = resolveServerWorkspaceContract(r.workspace);
  const decision = decideLibraryQuery(resolved.retrievalRules, {
    userContent: "anything",
    derivedScopes: ["x"],
    legacyWouldQuery: true,
  });
  const coverage = evaluateLibraryCoverage({
    rules: resolved.retrievalRules,
    libraryQueried: decision.shouldQuery,
    libraryHitCount: 0,
  });
  assertEquals(coverage, "no_relevant_hits");
});
