// Tests for W7.5 — Calibration-Aware Escalation overlay (shadow-only).
//
// Doctrine: W6.5 calibration is an additive signal on top of the
// existing W7 contract triggers. The overlay never replaces existing
// rules; it (a) recommends Refine when output is below standard with
// high confidence, (b) flags the library when exemplars are missing,
// and (c) suppresses noise by downgrading existing suggestions when
// output is already on standard. Every emitted suggestion remains
// shadow:true.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEscalationSuggestionLogs,
  evaluateEscalationRules,
} from "./workspaceEscalation.ts";
import { getWorkspaceContract } from "./workspaceContracts.ts";
import type {
  CalibrationResult,
  CalibrationVerdict,
} from "./libraryCalibration.ts";
import type { WorkspaceKey } from "./workspaceContractTypes.ts";

function makeCalibration(
  workspace: WorkspaceKey,
  verdict: CalibrationVerdict,
  confidence: "low" | "medium" | "high" = "high",
): CalibrationResult {
  return {
    id: "cal_test_1",
    workspace,
    surface: "strategy-chat",
    shadow: true,
    exemplarSetId: "es_test_1",
    standardContextInjected: true,
    exemplarsUsed: [],
    dimensions: [],
    strengths: [],
    gaps: [],
    upgradeSuggestions: [],
    weightedScore: verdict === "on_standard" ? 4.2 : 2.1,
    overallVerdict: verdict,
    overallConfidence: confidence,
    reason: `synthetic ${verdict}`,
    fabricationGuard: { ok: true, offending: [] },
    ranAt: new Date().toISOString(),
    durationMs: 1,
  } as CalibrationResult;
}

function find(summary: ReturnType<typeof evaluateEscalationRules>, id: string) {
  return summary.suggestions.find((s) => s.id === id);
}

// ─── (A) below_standard + high → Refine suggestion fires ─────────

Deno.test("W7.5: below_standard + high confidence → recommend refine (overlay)", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      userPrompt: "draft an account brief",
      calibration: makeCalibration("artifacts", "below_standard", "high"),
    },
    surface: "strategy-chat",
  });
  const s = find(summary, "artifacts.escalate.refine.calibration");
  assert(s, "expected calibration overlay refine suggestion");
  assertEquals(s!.targetWorkspace, "refine");
  assertEquals(s!.action, "recommend_workspace");
  assertEquals(s!.confidence, "high");
  assertEquals(s!.shadow, true);
  assertEquals(s!.source, "calibration_overlay");
  assertEquals(summary.totals.overlaySuggestionsEmitted, 1);
});

Deno.test("W7.5: below_standard but only medium confidence → does NOT fire", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      calibration: makeCalibration("artifacts", "below_standard", "medium"),
    },
    surface: "strategy-chat",
  });
  assertEquals(find(summary, "artifacts.escalate.refine.calibration"), undefined);
  assertEquals(summary.totals.overlaySuggestionsEmitted, 0);
});

Deno.test("W7.5: below_standard from refine workspace → does NOT self-recommend", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("refine"),
      assistantText: "Refined draft.",
      calibration: makeCalibration("refine", "below_standard", "high"),
    },
    surface: "strategy-chat",
  });
  // Should not self-route to refine.
  assertEquals(find(summary, "refine.escalate.refine.calibration"), undefined);
});

// ─── (B) insufficient_exemplars → library suggestion fires ───────

Deno.test("W7.5: insufficient_exemplars → log library promotion suggestion", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("brainstorm"),
      assistantText: "[Angle: A]...",
      calibration: makeCalibration("brainstorm", "insufficient_exemplars"),
    },
    surface: "strategy-chat",
  });
  const s = find(summary, "brainstorm.escalate.library.calibration");
  assert(s);
  assertEquals(s!.targetWorkspace, "library");
  assertEquals(s!.action, "log_promotion_suggestion");
  assertEquals(s!.confidence, "medium");
  assertEquals(s!.shadow, true);
  assertEquals(s!.source, "calibration_overlay");
});

Deno.test("W7.5: insufficient_exemplars from library workspace → does NOT self-recommend", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("library"),
      assistantText: "Library synthesis.",
      calibration: makeCalibration("library", "insufficient_exemplars"),
    },
    surface: "strategy-chat",
  });
  assertEquals(find(summary, "library.escalate.library.calibration"), undefined);
});

// ─── (C) on_standard → suppress noise ────────────────────────────

Deno.test("W7.5: on_standard → no new overlay suggestions added", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      userPrompt: "draft an account brief",
      taskType: "account_brief",
      calibration: makeCalibration("artifacts", "on_standard"),
    },
    surface: "run-task",
    taskType: "account_brief",
  });
  // No new overlay refine/library suggestion.
  assertEquals(find(summary, "artifacts.escalate.refine.calibration"), undefined);
  assertEquals(find(summary, "artifacts.escalate.library.calibration"), undefined);
  assertEquals(summary.totals.overlaySuggestionsEmitted, 0);
});

Deno.test("W7.5: on_standard → downgrades existing rule-driven suggestions to low", () => {
  // First a baseline: artifacts/account_brief fires a rule-driven
  // 'artifacts.escalate.projects' suggestion at high confidence.
  const baseline = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      userPrompt: "draft an account brief",
      taskType: "account_brief",
    },
    surface: "run-task",
    taskType: "account_brief",
  });
  const baseHit = find(baseline, "artifacts.escalate.projects");
  assert(baseHit, "baseline rule should fire");
  assertEquals(baseHit!.confidence, "high");
  assertEquals(baseHit!.source, "rule");

  // Now with on_standard calibration applied: same rule fires, but
  // overlay downgrades its confidence to "low".
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      userPrompt: "draft an account brief",
      taskType: "account_brief",
      calibration: makeCalibration("artifacts", "on_standard"),
    },
    surface: "run-task",
    taskType: "account_brief",
  });
  const downgraded = find(summary, "artifacts.escalate.projects");
  assert(downgraded);
  assertEquals(downgraded!.confidence, "low");
  assertEquals(downgraded!.source, "rule");
  assert(summary.totals.overlayDowngrades >= 1);
});

// ─── Existing rules still fire correctly ─────────────────────────

Deno.test("W7.5: existing rule-driven suggestions still fire when calibration is below_standard", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("brainstorm"),
      assistantText: "[Angle: A] ...\n[Angle: B] ...",
      userPrompt: "let's develop option 2 further",
      calibration: makeCalibration("brainstorm", "below_standard", "high"),
    },
    surface: "strategy-chat",
  });
  // Pre-existing rule still emits.
  const rule = find(summary, "brainstorm.escalate.refine");
  assert(rule, "pre-existing trigger rule must still fire");
  assertEquals(rule!.source, "rule");
  // And overlay also emits (different id, distinct entry).
  const overlay = find(summary, "brainstorm.escalate.refine.calibration");
  assert(overlay, "overlay also emits");
  assertEquals(overlay!.source, "calibration_overlay");
});

Deno.test("W7.5: missing calibration → behaves exactly like W7 (no overlay fields)", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("brainstorm"),
      assistantText: "[Angle: A] ...\n[Angle: B] ...",
      userPrompt: "develop option 1",
    },
    surface: "strategy-chat",
  });
  assertEquals(summary.calibrationVerdict, undefined);
  assertEquals(summary.calibrationConfidence, undefined);
  assertEquals(summary.totals.overlaySuggestionsEmitted, 0);
  assertEquals(summary.totals.overlayDowngrades, 0);
  // Pre-existing rule still fires.
  assert(find(summary, "brainstorm.escalate.refine"));
});

// ─── Shadow invariant ────────────────────────────────────────────

Deno.test("W7.5: every overlay suggestion is shadow-only", () => {
  const verdicts: CalibrationVerdict[] = [
    "below_standard",
    "insufficient_exemplars",
    "on_standard",
    "near_standard",
  ];
  for (const v of verdicts) {
    const summary = evaluateEscalationRules({
      inputs: {
        contract: getWorkspaceContract("brainstorm"),
        assistantText: "[Angle: A] ...",
        userPrompt: "develop option 1",
        calibration: makeCalibration("brainstorm", v, "high"),
      },
      surface: "strategy-chat",
    });
    for (const s of summary.suggestions) {
      assertEquals(s.shadow, true, `${v}/${s.id} must remain shadow`);
    }
  }
});

// ─── Telemetry attaches calibration fields ───────────────────────

Deno.test("W7.5: telemetry log lines include calibrationVerdict + calibrationConfidence", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      userPrompt: "draft an account brief",
      calibration: makeCalibration("artifacts", "below_standard", "high"),
    },
    surface: "strategy-chat",
  });
  const logs = buildEscalationSuggestionLogs(summary);
  assert(logs.length >= 1);
  for (const log of logs) {
    assertEquals(log.calibrationVerdict, "below_standard");
    assertEquals(log.calibrationConfidence, "high");
    assertEquals(log.shadow, true);
  }
  // Overlay-emitted log carries source.
  const overlayLog = logs.find((l) => l.suggestionId === "artifacts.escalate.refine.calibration");
  assert(overlayLog);
  assertEquals(overlayLog!.source, "calibration_overlay");
});

Deno.test("W7.5: overlay never throws — defensive evaluator handles malformed calibration", () => {
  const bad = { overallVerdict: "below_standard" } as unknown as CalibrationResult;
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      calibration: bad,
    },
    surface: "strategy-chat",
  });
  // Without confidence === "high", refine overlay should NOT fire.
  assertEquals(find(summary, "artifacts.escalate.refine.calibration"), undefined);
  // And the call returns normally (no throw).
  assertEquals(summary.workspace, "artifacts");
});
