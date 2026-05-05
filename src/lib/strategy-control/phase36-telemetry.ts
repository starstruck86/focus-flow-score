/**
 * Phase 3.6 — Structured Run Telemetry Types & Helpers.
 *
 * Defines the canonical telemetry shapes persisted to task_runs.meta.
 * Pure types + deterministic helpers. No IO, no side effects.
 *
 * DOES NOT modify: scorer, artifact gate logic, synthesis prompts, methodologySeeds logic.
 */

// ═══════════════════════════════════════════════════════════════════
// Canonical telemetry shapes for task_runs.meta
// ═══════════════════════════════════════════════════════════════════

export interface PlannerTelemetry {
  plan_hash: string;
  term_seeds_count: number;
  methodology_seeds_injected: boolean;
  scopes: string[];
}

export interface ArtifactGateTelemetryV2 {
  pass: boolean;
  failed_dimensions: string[];
  regen_attempts: number;
  regen_success: boolean;
  total_gate_latency_ms: number;
}

export interface PerformanceTelemetry {
  total_latency_ms: number;
  generation_latency_ms: number;
  gate_latency_ms: number;
  regen_latency_ms?: number;
}

export interface AnomalyFlags {
  regen_triggered?: boolean;
  artifact_failure?: boolean;
  weak_retrieval?: boolean;
  latency_violation?: boolean;
  db_retry_needed?: boolean;
}

export interface Phase36RunMeta {
  planner: PlannerTelemetry;
  artifact_gate: ArtifactGateTelemetryV2;
  performance: PerformanceTelemetry;
  anomaly_flags: AnomalyFlags;
}

// ═══════════════════════════════════════════════════════════════════
// Anomaly flag computation — deterministic, pure
// ═══════════════════════════════════════════════════════════════════

const WEAK_RETRIEVAL_THRESHOLD = 3;
const LATENCY_BUDGET_MS = 12_000;

export function computeAnomalyFlags(meta: {
  artifact_gate: ArtifactGateTelemetryV2;
  planner: PlannerTelemetry;
  performance: PerformanceTelemetry;
}): AnomalyFlags {
  const flags: AnomalyFlags = {};

  if (meta.artifact_gate.regen_attempts > 0) {
    flags.regen_triggered = true;
  }
  if (!meta.artifact_gate.pass) {
    flags.artifact_failure = true;
  }
  if (meta.planner.term_seeds_count < WEAK_RETRIEVAL_THRESHOLD) {
    flags.weak_retrieval = true;
  }
  if (meta.performance.total_latency_ms > LATENCY_BUDGET_MS) {
    flags.latency_violation = true;
  }

  return flags;
}

// ═══════════════════════════════════════════════════════════════════
// Telemetry validation — ensures no field is undefined
// ═══════════════════════════════════════════════════════════════════

export function validateTelemetry(meta: Phase36RunMeta): {
  valid: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  // Planner
  if (meta.planner.plan_hash === undefined) missing.push("planner.plan_hash");
  if (meta.planner.term_seeds_count === undefined) missing.push("planner.term_seeds_count");
  if (meta.planner.methodology_seeds_injected === undefined) missing.push("planner.methodology_seeds_injected");
  if (!Array.isArray(meta.planner.scopes)) missing.push("planner.scopes");

  // Artifact gate
  if (meta.artifact_gate.pass === undefined) missing.push("artifact_gate.pass");
  if (!Array.isArray(meta.artifact_gate.failed_dimensions)) missing.push("artifact_gate.failed_dimensions");
  if (meta.artifact_gate.regen_attempts === undefined) missing.push("artifact_gate.regen_attempts");
  if (meta.artifact_gate.regen_success === undefined) missing.push("artifact_gate.regen_success");
  if (meta.artifact_gate.total_gate_latency_ms === undefined) missing.push("artifact_gate.total_gate_latency_ms");

  // Performance
  if (meta.performance.total_latency_ms === undefined) missing.push("performance.total_latency_ms");
  if (meta.performance.generation_latency_ms === undefined) missing.push("performance.generation_latency_ms");
  if (meta.performance.gate_latency_ms === undefined) missing.push("performance.gate_latency_ms");

  return { valid: missing.length === 0, missing };
}

// ═══════════════════════════════════════════════════════════════════
// Latency budgets
// ═══════════════════════════════════════════════════════════════════

export const LATENCY_BUDGETS = {
  planner: 50,        // ms
  generation: 8_000,  // ms
  artifact_gate: 50,  // ms
  regen: 8_000,       // ms
  total: 12_000,      // ms
} as const;

export function checkLatencyBudgets(perf: PerformanceTelemetry): {
  violations: string[];
  within_budget: boolean;
} {
  const violations: string[] = [];
  if (perf.gate_latency_ms > LATENCY_BUDGETS.artifact_gate) {
    violations.push(`gate: ${perf.gate_latency_ms}ms > ${LATENCY_BUDGETS.artifact_gate}ms`);
  }
  if (perf.total_latency_ms > LATENCY_BUDGETS.total) {
    violations.push(`total: ${perf.total_latency_ms}ms > ${LATENCY_BUDGETS.total}ms`);
  }
  if (perf.regen_latency_ms !== undefined && perf.regen_latency_ms > LATENCY_BUDGETS.regen) {
    violations.push(`regen: ${perf.regen_latency_ms}ms > ${LATENCY_BUDGETS.regen}ms`);
  }
  return { violations, within_budget: violations.length === 0 };
}

// ═══════════════════════════════════════════════════════════════════
// Failure pattern tracking (learning loop)
// ═══════════════════════════════════════════════════════════════════

export interface FailurePatterns {
  template_fidelity: number;
  readability: number;
  section_completeness: number;
  evidence_discipline: number;
}

export function accumulateFailurePatterns(
  existing: FailurePatterns,
  failedDimensions: string[],
): FailurePatterns {
  const updated = { ...existing };
  for (const dim of failedDimensions) {
    if (dim in updated) {
      updated[dim as keyof FailurePatterns] += 1;
    }
  }
  return updated;
}

export function emptyFailurePatterns(): FailurePatterns {
  return {
    template_fidelity: 0,
    readability: 0,
    section_completeness: 0,
    evidence_discipline: 0,
  };
}

/**
 * Aggregation helper — returns summary from a list of run failure records.
 */
export function getArtifactFailureSummary(
  runs: Array<{ failed_dimensions: string[]; pass: boolean }>,
  lastN = 100,
): {
  total_runs: number;
  failed_runs: number;
  failure_rate: number;
  most_common_failure: string | null;
  patterns: FailurePatterns;
} {
  const slice = runs.slice(-lastN);
  const patterns = emptyFailurePatterns();
  let failedRuns = 0;

  for (const run of slice) {
    if (!run.pass) {
      failedRuns++;
      for (const dim of run.failed_dimensions) {
        if (dim in patterns) {
          patterns[dim as keyof FailurePatterns] += 1;
        }
      }
    }
  }

  const entries = Object.entries(patterns) as [string, number][];
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const mostCommon = sorted[0]?.[1] > 0 ? sorted[0][0] : null;

  return {
    total_runs: slice.length,
    failed_runs: failedRuns,
    failure_rate: slice.length > 0 ? failedRuns / slice.length : 0,
    most_common_failure: mostCommon,
    patterns,
  };
}

/**
 * Regen rate monitoring.
 * Flag if > 20% of runs required regen.
 */
export function computeRegenRate(
  runs: Array<{ regen_attempts: number }>,
): { rate: number; flagged: boolean } {
  if (runs.length === 0) return { rate: 0, flagged: false };
  const withRegen = runs.filter(r => r.regen_attempts > 0).length;
  const rate = withRegen / runs.length;
  return { rate, flagged: rate > 0.2 };
}
