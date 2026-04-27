// ════════════════════════════════════════════════════════════════
// W12 — Enforcement Policy Registry + Dry-Run Evaluator tests
//
// Verifies:
//   • Each policy fires only when its source signal warrants it.
//   • Each policy stays silent when signals are absent or weak.
//   • Disabled policies never fire (even when signals would warrant it).
//   • `advisory` and `enforced` overrides are coerced to `dry_run`
//     (W12 safety contract).
//   • Missing or malformed inputs never throw and never produce
//     fired evaluations.
//   • Persistence + telemetry blocks are well-shaped.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEnforcementLogs,
  buildEnforcementPersistenceBlock,
  type EnforcementInputs,
  POLICY_REGISTRY,
  runEnforcementDryRun,
} from "./enforcementPolicy.ts";
import { resolveServerWorkspaceContract } from "./retrievalEnforcement.ts";

const RESOLVED = resolveServerWorkspaceContract("strategy");

function baseInputs(over: Partial<EnforcementInputs> = {}): EnforcementInputs {
  return {
    contract: RESOLVED.contract,
    surface: "strategy-chat",
    workspace: RESOLVED.workspace,
    contractVersion: RESOLVED.contractVersion,
    taskType: "chat",
    runId: "test-run",
    threadId: "thr-1",
    messageId: "msg-1",
    gateSummary: null,
    calibration: null,
    citationCheck: null,
    escalationSummary: null,
    schemaHealth: null,
    ...over,
  };
}

// ─── Per-policy: gate.failure.high_confidence ───────────────────

Deno.test("W12 gate.failure: silent when no gate_check", () => {
  const r = runEnforcementDryRun(baseInputs());
  const e = r.evaluations.find((x) => x.policyId === "gate.failure.high_confidence")!;
  assertEquals(e.wouldFire, false);
  assertEquals(e.shadow, true);
});

Deno.test("W12 gate.failure: fires on warning/blocking failure", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      gateSummary: {
        results: [
          { id: "answer_first", outcome: "fail", severity: "blocking" } as any,
          { id: "info_dump", outcome: "fail", severity: "info" } as any,
        ],
        totals: { fail: 2, pass: 0, skip: 0 } as any,
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "gate.failure.high_confidence")!;
  assertEquals(e.wouldFire, true);
  assert(e.reason.includes("answer_first"));
});

Deno.test("W12 gate.failure: silent when only info severity fails", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      gateSummary: {
        results: [
          { id: "info_dump", outcome: "fail", severity: "info" } as any,
        ],
        totals: { fail: 1, pass: 0, skip: 0 } as any,
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "gate.failure.high_confidence")!;
  assertEquals(e.wouldFire, false);
});

// ─── calibration.below_standard.high_confidence ────────────────

Deno.test("W12 calibration: fires when below_standard + high confidence", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      calibration: {
        overallVerdict: "below_standard",
        overallConfidence: "high",
        weightedScore: 0.42,
      } as any,
    }),
  );
  const e = r.evaluations.find((x) =>
    x.policyId === "calibration.below_standard.high_confidence"
  )!;
  assertEquals(e.wouldFire, true);
});

Deno.test("W12 calibration: silent when below_standard but low confidence", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      calibration: {
        overallVerdict: "below_standard",
        overallConfidence: "low",
        weightedScore: 0.42,
      } as any,
    }),
  );
  const e = r.evaluations.find((x) =>
    x.policyId === "calibration.below_standard.high_confidence"
  )!;
  assertEquals(e.wouldFire, false);
});

Deno.test("W12 calibration: silent when on_standard", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      calibration: {
        overallVerdict: "on_standard",
        overallConfidence: "high",
        weightedScore: 0.91,
      } as any,
    }),
  );
  const e = r.evaluations.find((x) =>
    x.policyId === "calibration.below_standard.high_confidence"
  )!;
  assertEquals(e.wouldFire, false);
});

// ─── citation.unverified.strict ────────────────────────────────

Deno.test("W12 citation: fires in strict mode with unverified issues", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      citationCheck: {
        citationMode: "strict",
        citationsFound: 3,
        issues: [{ code: "unverified_citation", severity: "warning" } as any],
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "citation.unverified.strict")!;
  assertEquals(e.wouldFire, true);
});

Deno.test("W12 citation: silent in non-strict mode even with unverified", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      citationCheck: {
        citationMode: "shadow",
        citationsFound: 3,
        issues: [{ code: "unverified_citation", severity: "warning" } as any],
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "citation.unverified.strict")!;
  assertEquals(e.wouldFire, false);
});

// ─── schema.drift.blocker (W10) ────────────────────────────────

Deno.test("W12 schema.drift: fires on drift status", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      schemaHealth: {
        status: "drift",
        validated_at: "2025-01-01T00:00:00Z",
        source: "chat",
        schema_version: "w12.v1",
        totals: { valid: 4, missing: 1, malformed: 1, unknownFieldWarnings: 0 },
        malformed_keys: ["calibration"],
        missing_keys: [],
        unknown_field_keys: [],
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "schema.drift.blocker")!;
  assertEquals(e.wouldFire, true);
  assert(e.reason.includes("drift"));
});

Deno.test("W12 schema.drift: silent on ok status", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      schemaHealth: {
        status: "ok",
        validated_at: "2025-01-01T00:00:00Z",
        source: "chat",
        schema_version: "w12.v1",
        totals: { valid: 6, missing: 0, malformed: 0, unknownFieldWarnings: 0 },
        malformed_keys: [],
        missing_keys: [],
        unknown_field_keys: [],
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "schema.drift.blocker")!;
  assertEquals(e.wouldFire, false);
});

// ─── escalation.refine.recommended (W7.5) ──────────────────────

Deno.test("W12 escalation.refine: fires on calibration_overlay → refine", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      escalationSummary: {
        suggestions: [
          { targetWorkspace: "refine", source: "calibration_overlay" } as any,
        ],
        totals: { overlaySuggestionsEmitted: 1 } as any,
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "escalation.refine.recommended")!;
  assertEquals(e.wouldFire, true);
});

Deno.test("W12 escalation.refine: silent when overlay targets a different workspace", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      escalationSummary: {
        suggestions: [
          { targetWorkspace: "deepResearch", source: "calibration_overlay" } as any,
        ],
        totals: { overlaySuggestionsEmitted: 1 } as any,
      } as any,
    }),
  );
  const e = r.evaluations.find((x) => x.policyId === "escalation.refine.recommended")!;
  assertEquals(e.wouldFire, false);
});

// ─── Disabled / coercion / safety ──────────────────────────────

Deno.test("W12 disabled override: never fires even with strong signals", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      gateSummary: {
        results: [
          { id: "answer_first", outcome: "fail", severity: "blocking" } as any,
        ],
        totals: { fail: 1, pass: 0, skip: 0 } as any,
      } as any,
    }),
    { "gate.failure.high_confidence": "disabled" },
  );
  const e = r.evaluations.find((x) => x.policyId === "gate.failure.high_confidence")!;
  assertEquals(e.state, "disabled");
  assertEquals(e.wouldFire, false);
});

Deno.test("W12 advisory override: coerced to dry_run (still shadow)", () => {
  const r = runEnforcementDryRun(
    baseInputs({
      gateSummary: {
        results: [
          { id: "answer_first", outcome: "fail", severity: "blocking" } as any,
        ],
        totals: { fail: 1, pass: 0, skip: 0 } as any,
      } as any,
    }),
    { "gate.failure.high_confidence": "advisory" },
  );
  const e = r.evaluations.find((x) => x.policyId === "gate.failure.high_confidence")!;
  assertEquals(e.state, "dry_run");
  assertEquals(e.shadow, true);
  assertEquals(e.wouldFire, true);
});

Deno.test("W12 enforced override: coerced to dry_run (no actual enforcement)", () => {
  const r = runEnforcementDryRun(
    baseInputs(),
    { "calibration.below_standard.high_confidence": "enforced" },
  );
  const e = r.evaluations.find((x) =>
    x.policyId === "calibration.below_standard.high_confidence"
  )!;
  assertEquals(e.state, "dry_run");
  assertEquals(e.shadow, true);
});

Deno.test("W12 missing inputs never throw", () => {
  const r = runEnforcementDryRun(baseInputs());
  assertEquals(r.totals.evaluated, POLICY_REGISTRY.length);
  assertEquals(r.totals.wouldFire, 0);
  for (const e of r.evaluations) {
    assertEquals(e.shadow, true);
    assertEquals(typeof e.reason, "string");
  }
});

Deno.test("W12 malformed inputs never throw — gate results not array", () => {
  const r = runEnforcementDryRun(
    baseInputs({ gateSummary: { results: "garbage" as any } as any }),
  );
  const e = r.evaluations.find((x) => x.policyId === "gate.failure.high_confidence")!;
  assertEquals(e.wouldFire, false);
});

// ─── Persistence + telemetry shape ─────────────────────────────

Deno.test("W12 persistence block: required keys present and compact", () => {
  const r = runEnforcementDryRun(baseInputs());
  const block = buildEnforcementPersistenceBlock(r);
  assertExists(block.workspace);
  assertExists(block.contractVersion);
  assertExists(block.surface);
  assertExists(block.totals);
  assert(Array.isArray(block.evaluations));
  assertEquals(block.evaluations.length, POLICY_REGISTRY.length);
  for (const e of block.evaluations) {
    assertExists(e.policyId);
    assertExists(e.layer);
    assertExists(e.state);
    assertEquals(typeof e.wouldFire, "boolean");
    assertEquals(typeof e.reason, "string");
  }
});

Deno.test("W12 telemetry logs: one structured row per evaluation, all shadow=true", () => {
  const r = runEnforcementDryRun(baseInputs());
  const logs = buildEnforcementLogs(r);
  assertEquals(logs.length, r.evaluations.length);
  for (const l of logs) {
    assertEquals(l.channel, "workspace:enforcement_dry_run");
    assertEquals(l.shadow, true);
    assertExists(l.policyId);
  }
});

Deno.test("W12 every policy in registry has an evaluation entry", () => {
  const r = runEnforcementDryRun(baseInputs());
  for (const def of POLICY_REGISTRY) {
    const found = r.evaluations.find((x) => x.policyId === def.id);
    assertExists(found, `missing evaluation for ${def.id}`);
  }
});
