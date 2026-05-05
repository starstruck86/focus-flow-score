/**
 * Phase 3.7 — Drift Monitor.
 *
 * Pure aggregation logic over task_runs telemetry.
 * NO DB calls. NO persistence. NO side effects.
 *
 * DOES NOT modify: scorer, artifact gate, synthesis, methodologySeeds.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface RunTelemetryInput {
  status: string;
  meta: {
    planner?: { plan_hash?: string; term_seeds_count?: number };
    artifact_gate?: {
      pass?: boolean;
      regen_attempts?: number;
      failed_dimensions?: string[];
    };
    performance?: { total_latency_ms?: number };
    anomaly_flags?: {
      weak_retrieval?: boolean;
      regen_triggered?: boolean;
      artifact_failure?: boolean;
      latency_violation?: boolean;
    };
  } | null;
}

export interface DriftSignals {
  drift_detected: boolean;
  dominant_failure_pattern: string | null;
  gate_failure_rate: number;
  regen_rate: number;
  latency_p95: number;
  weak_retrieval_rate: number;
}

// ═══════════════════════════════════════════════════════════════════
// Thresholds
// ═══════════════════════════════════════════════════════════════════

export const DRIFT_THRESHOLDS = {
  gate_failure_rate: 0.3,    // >30% gate failures = drift
  regen_rate: 0.4,           // >40% regen triggered = drift
  latency_p95_ms: 15000,     // p95 > 15s = drift
  weak_retrieval_rate: 0.35, // >35% weak retrieval = drift
} as const;

// ═══════════════════════════════════════════════════════════════════
// Core aggregation
// ═══════════════════════════════════════════════════════════════════

export function computeDriftSignals(runs: RunTelemetryInput[]): DriftSignals {
  if (runs.length === 0) {
    return {
      drift_detected: false,
      dominant_failure_pattern: null,
      gate_failure_rate: 0,
      regen_rate: 0,
      latency_p95: 0,
      weak_retrieval_rate: 0,
    };
  }

  const total = runs.length;

  // Gate failure rate
  let gateFailures = 0;
  for (const r of runs) {
    if (r.meta?.artifact_gate?.pass === false) gateFailures++;
  }
  const gateFailureRate = gateFailures / total;

  // Regen rate
  let regenCount = 0;
  for (const r of runs) {
    const attempts = r.meta?.artifact_gate?.regen_attempts ?? 0;
    if (attempts > 0) regenCount++;
  }
  const regenRate = regenCount / total;

  // Latency p95
  const latencies = runs
    .map(r => r.meta?.performance?.total_latency_ms)
    .filter((l): l is number => typeof l === "number")
    .sort((a, b) => a - b);
  const latencyP95 = latencies.length > 0
    ? latencies[Math.floor(latencies.length * 0.95)]
    : 0;

  // Weak retrieval rate
  let weakCount = 0;
  for (const r of runs) {
    if (r.meta?.anomaly_flags?.weak_retrieval) weakCount++;
  }
  const weakRetrievalRate = weakCount / total;

  // Dominant failure pattern
  const failureDimCounts = new Map<string, number>();
  for (const r of runs) {
    const dims = r.meta?.artifact_gate?.failed_dimensions ?? [];
    for (const d of dims) {
      failureDimCounts.set(d, (failureDimCounts.get(d) ?? 0) + 1);
    }
  }
  let dominantPattern: string | null = null;
  let maxCount = 0;
  for (const [dim, count] of failureDimCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantPattern = dim;
    }
  }

  // Drift detection
  const driftDetected =
    gateFailureRate > DRIFT_THRESHOLDS.gate_failure_rate ||
    regenRate > DRIFT_THRESHOLDS.regen_rate ||
    latencyP95 > DRIFT_THRESHOLDS.latency_p95_ms ||
    weakRetrievalRate > DRIFT_THRESHOLDS.weak_retrieval_rate;

  return {
    drift_detected: driftDetected,
    dominant_failure_pattern: dominantPattern,
    gate_failure_rate: Math.round(gateFailureRate * 1000) / 1000,
    regen_rate: Math.round(regenRate * 1000) / 1000,
    latency_p95: latencyP95,
    weak_retrieval_rate: Math.round(weakRetrievalRate * 1000) / 1000,
  };
}
