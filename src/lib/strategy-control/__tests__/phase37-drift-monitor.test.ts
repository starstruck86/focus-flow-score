/**
 * Phase 3.7 — Drift Monitor Tests.
 *
 * Validates computeDriftSignals produces correct deterministic outputs.
 */

import { describe, it, expect } from "vitest";
import {
  computeDriftSignals,
  DRIFT_THRESHOLDS,
  type RunTelemetryInput,
} from "../driftMonitor";

function makeHealthyRun(): RunTelemetryInput {
  return {
    status: "completed",
    meta: {
      planner: { plan_hash: "abc", term_seeds_count: 5 },
      artifact_gate: { pass: true, regen_attempts: 0, failed_dimensions: [] },
      performance: { total_latency_ms: 6000 },
      anomaly_flags: {},
    },
  };
}

describe("Phase 3.7 — Drift Monitor", () => {
  it("healthy runs → no drift", () => {
    const runs = Array.from({ length: 10 }, makeHealthyRun);
    const signals = computeDriftSignals(runs);
    expect(signals.drift_detected).toBe(false);
    expect(signals.gate_failure_rate).toBe(0);
    expect(signals.regen_rate).toBe(0);
    expect(signals.weak_retrieval_rate).toBe(0);
    expect(signals.dominant_failure_pattern).toBeNull();
  });

  it("empty runs → no drift", () => {
    const signals = computeDriftSignals([]);
    expect(signals.drift_detected).toBe(false);
    expect(signals.latency_p95).toBe(0);
  });

  it("regen spike → drift detected", () => {
    const runs: RunTelemetryInput[] = Array.from({ length: 10 }, (_, i) => ({
      status: "completed",
      meta: {
        planner: { plan_hash: `h${i}`, term_seeds_count: 3 },
        artifact_gate: { pass: true, regen_attempts: i < 5 ? 2 : 0, failed_dimensions: [] },
        performance: { total_latency_ms: 5000 },
        anomaly_flags: { regen_triggered: i < 5 },
      },
    }));
    const signals = computeDriftSignals(runs);
    expect(signals.regen_rate).toBe(0.5);
    expect(signals.drift_detected).toBe(true);
  });

  it("gate failure spike → drift detected", () => {
    const runs: RunTelemetryInput[] = Array.from({ length: 10 }, (_, i) => ({
      status: i < 4 ? "failed" : "completed",
      meta: {
        planner: { plan_hash: `h${i}`, term_seeds_count: 3 },
        artifact_gate: {
          pass: i >= 4,
          regen_attempts: 0,
          failed_dimensions: i < 4 ? ["structure"] : [],
        },
        performance: { total_latency_ms: 5000 },
        anomaly_flags: { artifact_failure: i < 4 },
      },
    }));
    const signals = computeDriftSignals(runs);
    expect(signals.gate_failure_rate).toBe(0.4);
    expect(signals.drift_detected).toBe(true);
    expect(signals.dominant_failure_pattern).toBe("structure");
  });

  it("latency spike → drift detected", () => {
    const runs: RunTelemetryInput[] = Array.from({ length: 20 }, (_, i) => ({
      status: "completed",
      meta: {
        planner: { plan_hash: `h${i}`, term_seeds_count: 3 },
        artifact_gate: { pass: true, regen_attempts: 0, failed_dimensions: [] },
        performance: { total_latency_ms: i >= 18 ? 20000 : 5000 },
        anomaly_flags: {},
      },
    }));
    const signals = computeDriftSignals(runs);
    expect(signals.latency_p95).toBe(20000);
    expect(signals.drift_detected).toBe(true);
  });

  it("weak retrieval spike → drift detected", () => {
    const runs: RunTelemetryInput[] = Array.from({ length: 10 }, (_, i) => ({
      status: "completed",
      meta: {
        planner: { plan_hash: `h${i}`, term_seeds_count: 3 },
        artifact_gate: { pass: true, regen_attempts: 0, failed_dimensions: [] },
        performance: { total_latency_ms: 5000 },
        anomaly_flags: { weak_retrieval: i < 4 },
      },
    }));
    const signals = computeDriftSignals(runs);
    expect(signals.weak_retrieval_rate).toBe(0.4);
    expect(signals.drift_detected).toBe(true);
  });

  it("deterministic: same input → same output", () => {
    const runs = Array.from({ length: 5 }, makeHealthyRun);
    const a = computeDriftSignals(runs);
    const b = computeDriftSignals(runs);
    expect(a).toEqual(b);
  });

  it("reports dominant failure pattern correctly", () => {
    const runs: RunTelemetryInput[] = [
      { status: "failed", meta: { artifact_gate: { pass: false, regen_attempts: 0, failed_dimensions: ["biz_impact", "structure"] } } },
      { status: "failed", meta: { artifact_gate: { pass: false, regen_attempts: 0, failed_dimensions: ["biz_impact"] } } },
      { status: "failed", meta: { artifact_gate: { pass: false, regen_attempts: 0, failed_dimensions: ["structure"] } } },
    ];
    const signals = computeDriftSignals(runs);
    expect(signals.dominant_failure_pattern).toBe("biz_impact");
  });
});
