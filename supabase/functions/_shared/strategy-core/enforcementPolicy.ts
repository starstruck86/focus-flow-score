// ════════════════════════════════════════════════════════════════
// Strategy Core — W12 Enforcement Policy Registry + Dry-Run Evaluator
//
// Goal: move from shadow-only telemetry (W3–W11) to a SAFE, OPT-IN
// enforcement-readiness layer — without enforcing anything yet.
//
// Hard rules (do NOT relax in W12):
//
//   • NO output mutation.
//   • NO blocking.
//   • NO retries.
//   • NO UI auto-routing.
//   • Default state for every policy is `dry_run`.
//   • W12 only supports `disabled` and `dry_run`. `advisory` and
//     `enforced` are reserved for later phases — evaluators that
//     receive those states still behave as `dry_run` for safety
//     (would-fire reported, but no enforcement).
//   • Policies READ existing W5/W6/W6.5/W7.5 metadata only. They
//     never call models, never query DB, never inspect secrets.
//   • Persisted block: `enforcement_dry_run` (compact summary).
//   • Telemetry channel: `workspace:enforcement_dry_run`.
//
// W12 is intentionally NON-THROWING. Each evaluator catches its own
// errors and reports as `wouldFire: false, reason: "evaluator_error"`.
// The dispatcher catches anyway as defense-in-depth.
// ════════════════════════════════════════════════════════════════

import type {
  CitationCheckResult,
} from "./citationEnforcement.ts";
import type {
  CalibrationResult,
} from "./libraryCalibration.ts";
import type {
  WorkspaceContract,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";
import type {
  GateRunSummary,
} from "./workspaceGateRunner.ts";
import type {
  EscalationRunSummary,
} from "./workspaceEscalation.ts";
import type {
  SchemaHealthCompact,
} from "./schemaHealth.ts";

// ─── Types ────────────────────────────────────────────────────────

export type EnforcementSurface = "strategy-chat" | "run-task";

/**
 * Policy lifecycle states. W12 ONLY honors `disabled` and `dry_run`.
 * Higher states are placeholders so the registry contract is stable
 * for future phases.
 */
export type PolicyState =
  | "disabled"
  | "dry_run"
  | "advisory"
  | "enforced";

/** Stable policy ids — addressable by config + telemetry. */
export type PolicyId =
  | "gate.failure.high_confidence"
  | "calibration.below_standard.high_confidence"
  | "citation.unverified.strict"
  | "schema.drift.blocker"
  | "escalation.refine.recommended";

/** Layer the policy reads from — for debug grouping. */
export type PolicyLayer =
  | "gate_check"        // W6
  | "calibration"       // W6.5 Pass B
  | "citation_check"    // W5
  | "schema_health"     // W10
  | "escalation_suggestions"; // W7.5

export interface PolicyDefinition {
  id: PolicyId;
  layer: PolicyLayer;
  /** Workspaces this policy applies to. `*` matches any workspace. */
  workspaces: ReadonlyArray<WorkspaceKey | "*">;
  /** Default state. Overridable via registry config (still bounded by W12 rules). */
  defaultState: Exclude<PolicyState, "advisory" | "enforced">;
  /** Human-readable description for the debug panel. */
  description: string;
}

export interface PolicySignal {
  key: string;
  value: string | number | boolean | null;
}

export interface PolicyEvaluation {
  policyId: PolicyId;
  layer: PolicyLayer;
  state: PolicyState;
  /** True when, if enforced, this policy would have fired on the row. */
  wouldFire: boolean;
  /** Short rationale (truncated ~280 chars). */
  reason: string;
  /** Compact, structured signals the policy used. */
  sourceSignals: PolicySignal[];
  /** Always true in W12. */
  shadow: true;
}

export interface EnforcementInputs {
  contract: WorkspaceContract;
  surface: EnforcementSurface;
  workspace: WorkspaceKey;
  contractVersion: string;
  taskType?: string;
  runId?: string;
  threadId?: string;
  messageId?: string;
  // ── Layer signals (all optional — missing layer ⇒ policy silent) ──
  gateSummary?: GateRunSummary | null;
  calibration?: CalibrationResult | null;
  citationCheck?: CitationCheckResult | null;
  escalationSummary?: EscalationRunSummary | null;
  /** W10 compact summary. May be undefined when stamping is deferred. */
  schemaHealth?: SchemaHealthCompact | null;
}

export interface EnforcementRunSummary {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: EnforcementSurface;
  taskType?: string;
  runId?: string;
  evaluations: PolicyEvaluation[];
  totals: {
    evaluated: number;
    wouldFire: number;
    disabled: number;
    /** Errors during evaluation (caught, never propagated). */
    errors: number;
  };
}

/** Compact persistence block written under `enforcement_dry_run`. */
export interface EnforcementPersistenceBlock {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: EnforcementSurface;
  totals: EnforcementRunSummary["totals"];
  evaluations: Array<
    Pick<
      PolicyEvaluation,
      "policyId" | "layer" | "state" | "wouldFire" | "reason"
    > & { sourceSignals?: PolicySignal[] }
  >;
}

// ─── Registry ─────────────────────────────────────────────────────

/**
 * Initial W12 policy registry. Every policy defaults to `dry_run`.
 * Order matters for debug rendering.
 */
export const POLICY_REGISTRY: readonly PolicyDefinition[] = [
  {
    id: "gate.failure.high_confidence",
    layer: "gate_check",
    workspaces: ["*"],
    defaultState: "dry_run",
    description:
      "Fires when W6 reports any failed gate with severity 'warning' or 'blocking'.",
  },
  {
    id: "calibration.below_standard.high_confidence",
    layer: "calibration",
    workspaces: ["*"],
    defaultState: "dry_run",
    description:
      "Fires when W6.5 calibration verdict is 'below_standard' AND confidence is 'high'.",
  },
  {
    id: "citation.unverified.strict",
    layer: "citation_check",
    workspaces: ["*"],
    defaultState: "dry_run",
    description:
      "Fires when W5 citation_check is in 'strict' mode and recorded any unverified citation issue.",
  },
  {
    id: "schema.drift.blocker",
    layer: "schema_health",
    workspaces: ["*"],
    defaultState: "dry_run",
    description:
      "Fires when W10 schema_health reports 'drift' or 'validator_error'.",
  },
  {
    id: "escalation.refine.recommended",
    layer: "escalation_suggestions",
    workspaces: ["*"],
    defaultState: "dry_run",
    description:
      "Fires when W7.5 emitted a Refine suggestion via the calibration overlay.",
  },
] as const;

// ─── State resolver ──────────────────────────────────────────────

/**
 * Optional caller override map. Keys are policy ids; values are the
 * desired state. Unknown ids are ignored. `advisory`/`enforced` are
 * coerced to `dry_run` in W12 — we will not lie about enforcement.
 */
export type PolicyStateOverrides = Partial<Record<PolicyId, PolicyState>>;

function resolveState(
  def: PolicyDefinition,
  overrides: PolicyStateOverrides | undefined,
  workspace: WorkspaceKey,
): PolicyState {
  // Workspace mismatch → policy is effectively disabled for this row.
  const matches = def.workspaces.includes("*") ||
    def.workspaces.includes(workspace);
  if (!matches) return "disabled";

  const desired = overrides?.[def.id];
  if (desired === "disabled") return "disabled";
  // Hard cap: W12 only honors disabled/dry_run. Anything higher
  // collapses to dry_run so the safety contract holds.
  if (desired === "advisory" || desired === "enforced") return "dry_run";
  return desired === "dry_run" ? "dry_run" : def.defaultState;
}

// ─── Helpers ─────────────────────────────────────────────────────

const truncate = (s: string, n = 280) =>
  s && s.length > n ? s.slice(0, n - 1) + "…" : (s ?? "");

function silent(
  def: PolicyDefinition,
  state: PolicyState,
  reason: string,
  signals: PolicySignal[] = [],
): PolicyEvaluation {
  return {
    policyId: def.id,
    layer: def.layer,
    state,
    wouldFire: false,
    reason: truncate(reason),
    sourceSignals: signals,
    shadow: true,
  };
}

function fired(
  def: PolicyDefinition,
  state: PolicyState,
  reason: string,
  signals: PolicySignal[],
): PolicyEvaluation {
  return {
    policyId: def.id,
    layer: def.layer,
    state,
    wouldFire: true,
    reason: truncate(reason),
    sourceSignals: signals,
    shadow: true,
  };
}

// ─── Evaluators (one per policy) ─────────────────────────────────

type Evaluator = (
  def: PolicyDefinition,
  state: PolicyState,
  inp: EnforcementInputs,
) => PolicyEvaluation;

const EVALUATORS: Record<PolicyId, Evaluator> = {
  // W6 gate failures with non-trivial severity.
  "gate.failure.high_confidence": (def, state, inp) => {
    const summary = inp.gateSummary;
    if (!summary || !Array.isArray(summary.results)) {
      return silent(def, state, "no gate_check available");
    }
    const failed = summary.results.filter((r) =>
      r && r.outcome === "fail" &&
      (r.severity === "warning" || r.severity === "blocking")
    );
    if (failed.length === 0) {
      return silent(def, state, "no high-severity gate failures", [
        { key: "totalFailures", value: summary.totals?.fail ?? 0 },
      ]);
    }
    const ids = failed.map((g) => g.id).slice(0, 5).join(",");
    return fired(def, state, `failed gates: ${ids}`, [
      { key: "highSeverityFailures", value: failed.length },
      { key: "totalFailures", value: summary.totals?.fail ?? 0 },
    ]);
  },

  // W6.5 below_standard with high confidence.
  "calibration.below_standard.high_confidence": (def, state, inp) => {
    const cal = inp.calibration;
    if (!cal) return silent(def, state, "no calibration available");
    if (cal.overallVerdict !== "below_standard") {
      return silent(def, state, `verdict=${cal.overallVerdict}`, [
        { key: "verdict", value: cal.overallVerdict },
        { key: "confidence", value: cal.overallConfidence },
      ]);
    }
    if (cal.overallConfidence !== "high") {
      return silent(
        def,
        state,
        `below_standard but confidence=${cal.overallConfidence}`,
        [
          { key: "verdict", value: cal.overallVerdict },
          { key: "confidence", value: cal.overallConfidence },
        ],
      );
    }
    return fired(
      def,
      state,
      `calibration below_standard with high confidence (score=${cal.weightedScore.toFixed?.(2) ?? cal.weightedScore})`,
      [
        { key: "verdict", value: cal.overallVerdict },
        { key: "confidence", value: cal.overallConfidence },
        { key: "weightedScore", value: cal.weightedScore ?? null },
      ],
    );
  },

  // W5 strict mode + unverified.
  "citation.unverified.strict": (def, state, inp) => {
    const cc = inp.citationCheck;
    if (!cc) return silent(def, state, "no citation_check available");
    if (cc.citationMode !== "strict") {
      return silent(def, state, `citationMode=${cc.citationMode}`, [
        { key: "citationMode", value: cc.citationMode },
      ]);
    }
    const unverifiedIssues = (cc.issues ?? []).filter((i) =>
      i?.code === "unverified_citation"
    );
    if (unverifiedIssues.length === 0) {
      return silent(def, state, "strict mode, no unverified citations", [
        { key: "citationMode", value: cc.citationMode },
        { key: "citationsFound", value: cc.citationsFound ?? 0 },
      ]);
    }
    return fired(
      def,
      state,
      `strict mode with ${unverifiedIssues.length} unverified citation issue(s)`,
      [
        { key: "citationMode", value: cc.citationMode },
        { key: "unverifiedIssues", value: unverifiedIssues.length },
        { key: "citationsFound", value: cc.citationsFound ?? 0 },
      ],
    );
  },

  // W10 schema drift / validator error.
  "schema.drift.blocker": (def, state, inp) => {
    const sh = inp.schemaHealth;
    if (!sh) return silent(def, state, "no schema_health available");
    if (sh.status === "drift" || sh.status === "validator_error") {
      const malformed = Array.isArray((sh as any).malformed_keys)
        ? (sh as any).malformed_keys as string[]
        : [];
      return fired(
        def,
        state,
        sh.status === "drift"
          ? `schema_health=drift${malformed.length ? ` (${malformed.slice(0, 3).join(",")})` : ""}`
          : `schema_health=validator_error`,
        [
          { key: "status", value: sh.status },
          { key: "malformed", value: malformed.length },
        ],
      );
    }
    return silent(def, state, `schema_health=${sh.status}`, [
      { key: "status", value: sh.status },
    ]);
  },

  // W7.5 calibration-overlay Refine recommendation.
  "escalation.refine.recommended": (def, state, inp) => {
    const esc = inp.escalationSummary;
    if (!esc || !Array.isArray(esc.suggestions)) {
      return silent(def, state, "no escalation_suggestions available");
    }
    const refineOverlay = esc.suggestions.filter((s) =>
      s && s.targetWorkspace === "refine" && s.source === "calibration_overlay"
    );
    if (refineOverlay.length === 0) {
      return silent(def, state, "no calibration_overlay Refine suggestion", [
        { key: "totalSuggestions", value: esc.suggestions.length },
        {
          key: "overlaySuggestions",
          value: esc.totals?.overlaySuggestionsEmitted ?? 0,
        },
      ]);
    }
    return fired(
      def,
      state,
      `${refineOverlay.length} Refine suggestion(s) via calibration overlay`,
      [
        { key: "refineOverlay", value: refineOverlay.length },
        { key: "totalSuggestions", value: esc.suggestions.length },
      ],
    );
  },
};

// ─── Public API ──────────────────────────────────────────────────

/**
 * Pure, never throws. Every evaluator is wrapped in try/catch and
 * the dispatcher itself is defensive.
 */
export function runEnforcementDryRun(
  inp: EnforcementInputs,
  overrides?: PolicyStateOverrides,
): EnforcementRunSummary {
  const evaluations: PolicyEvaluation[] = [];
  let errors = 0;
  let wouldFire = 0;
  let disabled = 0;

  for (const def of POLICY_REGISTRY) {
    let state: PolicyState = "dry_run";
    try {
      state = resolveState(def, overrides, inp.workspace);
      if (state === "disabled") {
        disabled += 1;
        evaluations.push(silent(def, state, "policy disabled"));
        continue;
      }
      const evaluator = EVALUATORS[def.id];
      if (!evaluator) {
        evaluations.push(
          silent(def, state, "no evaluator registered (registry drift)"),
        );
        continue;
      }
      const result = evaluator(def, state, inp);
      if (result.wouldFire) wouldFire += 1;
      evaluations.push(result);
    } catch (err) {
      errors += 1;
      evaluations.push({
        policyId: def.id,
        layer: def.layer,
        state,
        wouldFire: false,
        reason: truncate(`evaluator_error: ${(err as Error)?.message ?? String(err)}`),
        sourceSignals: [],
        shadow: true,
      });
    }
  }

  return {
    workspace: inp.workspace,
    contractVersion: inp.contractVersion,
    surface: inp.surface,
    taskType: inp.taskType,
    runId: inp.runId,
    evaluations,
    totals: {
      evaluated: evaluations.length,
      wouldFire,
      disabled,
      errors,
    },
  };
}

/**
 * Build a compact persistence block. Source signals are kept for
 * the debug panel — they are tiny (≤ 5 entries per policy).
 */
export function buildEnforcementPersistenceBlock(
  summary: EnforcementRunSummary,
): EnforcementPersistenceBlock {
  return {
    workspace: summary.workspace,
    contractVersion: summary.contractVersion,
    surface: summary.surface,
    totals: summary.totals,
    evaluations: summary.evaluations.map((e) => ({
      policyId: e.policyId,
      layer: e.layer,
      state: e.state,
      wouldFire: e.wouldFire,
      reason: e.reason,
      sourceSignals: e.sourceSignals?.length ? e.sourceSignals : undefined,
    })),
  };
}

/** One structured log line per evaluation. Never throws. */
export function buildEnforcementLogs(
  summary: EnforcementRunSummary,
): Array<Record<string, unknown>> {
  try {
    return summary.evaluations.map((e) => ({
      channel: "workspace:enforcement_dry_run",
      workspace: summary.workspace,
      contractVersion: summary.contractVersion,
      surface: summary.surface,
      taskType: summary.taskType,
      runId: summary.runId,
      policyId: e.policyId,
      layer: e.layer,
      state: e.state,
      wouldFire: e.wouldFire,
      reason: e.reason,
      shadow: true,
    }));
  } catch {
    return [];
  }
}

export function logEnforcementDryRun(summary: EnforcementRunSummary): void {
  try {
    for (const log of buildEnforcementLogs(summary)) {
      console.log(`workspace:enforcement_dry_run ${JSON.stringify(log)}`);
    }
  } catch {
    /* never throw from telemetry */
  }
}
