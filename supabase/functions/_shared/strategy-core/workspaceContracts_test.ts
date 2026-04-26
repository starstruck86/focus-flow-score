// ════════════════════════════════════════════════════════════════
// Workspace SOP — Contract Registry tests (Phase W1)
//
// Pure structural validation of the contract registry. No runtime
// behavior is exercised here; later phases will own behavioral tests.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ALL_WORKSPACE_KEYS,
  getWorkspaceContract,
  WORKSPACE_CONTRACTS,
} from "./workspaceContracts.ts";
import type {
  CitationMode,
  ContextMode,
  GateEnforcementType,
  GateSeverity,
  LibraryMode,
  WebMode,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";

const VALID_LIBRARY: ReadonlyArray<LibraryMode> = [
  "off",
  "opportunistic",
  "preferred",
  "required",
];
const VALID_WEB: ReadonlyArray<WebMode> = [
  "off",
  "opportunistic",
  "required_for_current_facts",
];
const VALID_CITATION: ReadonlyArray<CitationMode> = [
  "none",
  "none_unless_library_used",
  "light",
  "strict",
];
const VALID_CONTEXT: ReadonlyArray<ContextMode> = [
  "thread_first",
  "project_first",
  "artifact_first",
  "draft_first",
];
const VALID_ENFORCEMENT: ReadonlyArray<GateEnforcementType> = [
  "deterministic",
  "heuristic",
  "llm_judge",
];
const VALID_SEVERITY: ReadonlyArray<GateSeverity> = [
  "info",
  "warning",
  "blocking",
];

Deno.test("registry contains exactly the 7 canonical workspaces", () => {
  assertEquals(ALL_WORKSPACE_KEYS.length, 7);
  for (const key of ALL_WORKSPACE_KEYS) {
    assert(WORKSPACE_CONTRACTS[key], `missing contract for ${key}`);
    assertStrictEquals(WORKSPACE_CONTRACTS[key].workspace, key);
  }
});

Deno.test("getWorkspaceContract returns the same object as the registry", () => {
  for (const key of ALL_WORKSPACE_KEYS) {
    assertStrictEquals(getWorkspaceContract(key), WORKSPACE_CONTRACTS[key]);
  }
});

Deno.test("every contract has the required core fields populated", () => {
  for (const key of ALL_WORKSPACE_KEYS) {
    const c = WORKSPACE_CONTRACTS[key];
    assert(c.version.length > 0, `${key}: version`);
    assert(c.mission.length > 0, `${key}: mission`);
    assert(c.cognitivePosture.length > 0, `${key}: cognitivePosture`);
    assert(c.useCases.length > 0, `${key}: useCases`);
    assert(c.nonGoals.length > 0, `${key}: nonGoals`);
    assert(c.reasoningPath.length > 0, `${key}: reasoningPath`);
    assert(c.qualityGates.length > 0, `${key}: qualityGates`);
    assert(c.failureModes.length > 0, `${key}: failureModes`);
    assert(c.escalationRules.length > 0, `${key}: escalationRules`);
    assert(
      c.outputFormattingHints.summary.length > 0,
      `${key}: outputFormattingHints.summary`,
    );
    assert(
      c.outputFormattingHints.markers.length > 0,
      `${key}: outputFormattingHints.markers`,
    );
  }
});

Deno.test("retrieval rules use only finalized enum vocabulary", () => {
  for (const key of ALL_WORKSPACE_KEYS) {
    const r = WORKSPACE_CONTRACTS[key].retrievalRules;
    assert(VALID_LIBRARY.includes(r.libraryMode), `${key}: libraryMode`);
    assert(VALID_WEB.includes(r.webMode), `${key}: webMode`);
    assert(VALID_CITATION.includes(r.citationMode), `${key}: citationMode`);
    assert(VALID_CONTEXT.includes(r.contextMode), `${key}: contextMode`);
  }
});

Deno.test("every gate ships in shadow mode (MVP invariant)", () => {
  for (const key of ALL_WORKSPACE_KEYS) {
    for (const g of WORKSPACE_CONTRACTS[key].qualityGates) {
      assertEquals(
        g.shadow,
        true,
        `${key}.${g.id}: gates must ship shadow=true in MVP`,
      );
    }
  }
});

Deno.test("no MVP gate uses the deferred llm_judge enforcement type", () => {
  for (const key of ALL_WORKSPACE_KEYS) {
    for (const g of WORKSPACE_CONTRACTS[key].qualityGates) {
      assert(
        g.enforcementType !== "llm_judge",
        `${key}.${g.id}: llm_judge gates are deferred`,
      );
      assert(
        VALID_ENFORCEMENT.includes(g.enforcementType),
        `${key}.${g.id}: invalid enforcementType`,
      );
      assert(
        VALID_SEVERITY.includes(g.severity),
        `${key}.${g.id}: invalid severity`,
      );
      assert(g.id.length > 0 && g.checkRef.length > 0, `${key}.${g.id}: ids`);
    }
  }
});

Deno.test("gate ids are unique within each workspace", () => {
  for (const key of ALL_WORKSPACE_KEYS) {
    const ids = WORKSPACE_CONTRACTS[key].qualityGates.map((g) => g.id);
    assertEquals(
      new Set(ids).size,
      ids.length,
      `${key}: duplicate gate ids`,
    );
  }
});

Deno.test("escalation rules use only MVP actions (W7 deferred)", () => {
  const allowed = new Set(["recommend_workspace", "log_promotion_suggestion"]);
  const allKeys = new Set<WorkspaceKey>(ALL_WORKSPACE_KEYS);
  for (const key of ALL_WORKSPACE_KEYS) {
    for (const r of WORKSPACE_CONTRACTS[key].escalationRules) {
      assert(allowed.has(r.action), `${key}.${r.id}: bad action ${r.action}`);
      assert(
        allKeys.has(r.targetWorkspace),
        `${key}.${r.id}: unknown targetWorkspace ${r.targetWorkspace}`,
      );
    }
  }
});

Deno.test("Refine config caps variants at 2 with the approved label set", () => {
  const refine = WORKSPACE_CONTRACTS.refine;
  assert(refine.refineConfig, "refine: refineConfig present");
  assertEquals(refine.refineConfig.maxVariants, 2);
  const expected = [
    "Shorter",
    "Sharper",
    "Warmer",
    "More executive",
    "More direct",
  ];
  assertEquals([...refine.refineConfig.allowedVariantLabels], expected);
});

Deno.test("Work config exposes materiality rules with valid targets", () => {
  const work = WORKSPACE_CONTRACTS.work;
  assert(work.workConfig, "work: workConfig present");
  assert(
    work.workConfig.materialityRules.length > 0,
    "work: materialityRules non-empty",
  );
  const allKeys = new Set<WorkspaceKey>(ALL_WORKSPACE_KEYS);
  for (const m of work.workConfig.materialityRules) {
    assert(allKeys.has(m.recommend), `work: bad recommend ${m.recommend}`);
  }
});

Deno.test("Projects config enforces continuity guardrail and inert future flags", () => {
  const projects = WORKSPACE_CONTRACTS.projects;
  assert(projects.projectsConfig, "projects: projectsConfig present");
  assertEquals(projects.projectsConfig.enforceContinuityGuardrail, true);
  assertEquals(projects.projectsConfig.futureCapabilityFlags.length, 0);
});

Deno.test("Artifacts config defers required sections to pill task config", () => {
  const artifacts = WORKSPACE_CONTRACTS.artifacts;
  assert(artifacts.artifactsConfig, "artifacts: artifactsConfig present");
  assertStrictEquals(
    artifacts.artifactsConfig.deferRequiredSectionsToTaskConfig,
    true,
  );
});
