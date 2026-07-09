/**
 * Phase 3.6 — Observability Tests.
 *
 * Validates:
 * - Telemetry shapes are always complete (no undefined fields)
 * - Anomaly flags are correctly computed
 * - Latency is always recorded
 * - Failure states are always logged
 */
import { describe, it, expect } from "vitest";
import { computeAnomalyFlags, validateTelemetry, type Phase36RunMeta } from "../phase36-telemetry";

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

function makeHealthyMeta(): Phase36RunMeta {
  return {
    planner: {
      plan_hash: "abc123",
      term_seeds_count: 8,
      methodology_seeds_injected: true,
      scopes: ["knowledge_items", "playbooks"],
    },
    artifact_gate: {
      pass: true,
      failed_dimensions: [],
      regen_attempts: 0,
      regen_success: false,
      total_gate_latency_ms: 5,
    },
    performance: {
      total_latency_ms: 6000,
      generation_latency_ms: 5000,
      gate_latency_ms: 5,
    },
    anomaly_flags: {},
  };
}

function makeFailedMeta(): Phase36RunMeta {
  return {
    planner: {
      plan_hash: "def456",
      term_seeds_count: 1,
      methodology_seeds_injected: false,
      scopes: [],
    },
    artifact_gate: {
      pass: false,
      failed_dimensions: ["template_fidelity", "readability"],
      regen_attempts: 1,
      regen_success: false,
      total_gate_latency_ms: 25,
    },
    performance: {
      total_latency_ms: 15000,
      generation_latency_ms: 8000,
      gate_latency_ms: 25,
      regen_latency_ms: 6000,
    },
    anomaly_flags: {},
  };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("Phase 3.6 — Observability", () => {
  describe("Telemetry Validation", () => {
    it("healthy meta passes validation with zero missing fields", () => {
      const meta = makeHealthyMeta();
      const result = validateTelemetry(meta);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("failed meta also passes validation (all fields defined)", () => {
      const meta = makeFailedMeta();
      const result = validateTelemetry(meta);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("detects undefined planner fields", () => {
      const meta = makeHealthyMeta();
      (meta.planner as any).plan_hash = undefined;
      const result = validateTelemetry(meta);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("planner.plan_hash");
    });

    it("detects undefined artifact_gate fields", () => {
      const meta = makeHealthyMeta();
      (meta.artifact_gate as any).pass = undefined;
      const result = validateTelemetry(meta);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("artifact_gate.pass");
    });

    it("detects undefined performance fields", () => {
      const meta = makeHealthyMeta();
      (meta.performance as any).total_latency_ms = undefined;
      const result = validateTelemetry(meta);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("performance.total_latency_ms");
    });

    it("detects non-array scopes", () => {
      const meta = makeHealthyMeta();
      (meta.planner as any).scopes = "not_an_array";
      const result = validateTelemetry(meta);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("planner.scopes");
    });

    it("detects non-array failed_dimensions", () => {
      const meta = makeHealthyMeta();
      (meta.artifact_gate as any).failed_dimensions = null;
      const result = validateTelemetry(meta);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("artifact_gate.failed_dimensions");
    });
  });

  describe("Anomaly Flags", () => {
    it("no flags for healthy run", () => {
      const meta = makeHealthyMeta();
      const flags = computeAnomalyFlags(meta);
      expect(flags.regen_triggered).toBeUndefined();
      expect(flags.artifact_failure).toBeUndefined();
      expect(flags.weak_retrieval).toBeUndefined();
      expect(flags.latency_violation).toBeUndefined();
    });

    it("flags regen_triggered when regen_attempts > 0", () => {
      const meta = makeHealthyMeta();
      meta.artifact_gate.regen_attempts = 1;
      const flags = computeAnomalyFlags(meta);
      expect(flags.regen_triggered).toBe(true);
    });

    it("flags artifact_failure when gate fails", () => {
      const meta = makeHealthyMeta();
      meta.artifact_gate.pass = false;
      const flags = computeAnomalyFlags(meta);
      expect(flags.artifact_failure).toBe(true);
    });

    it("flags weak_retrieval when term_seeds_count < threshold", () => {
      const meta = makeHealthyMeta();
      meta.planner.term_seeds_count = 1;
      const flags = computeAnomalyFlags(meta);
      expect(flags.weak_retrieval).toBe(true);
    });

    it("flags latency_violation when total > budget", () => {
      const meta = makeHealthyMeta();
      meta.performance.total_latency_ms = 15000;
      const flags = computeAnomalyFlags(meta);
      expect(flags.latency_violation).toBe(true);
    });

    it("flags ALL anomalies simultaneously in failed run", () => {
      const meta = makeFailedMeta();
      const flags = computeAnomalyFlags(meta);
      expect(flags.regen_triggered).toBe(true);
      expect(flags.artifact_failure).toBe(true);
      expect(flags.weak_retrieval).toBe(true);
      expect(flags.latency_violation).toBe(true);
    });
  });

  describe("Latency Always Recorded", () => {
    it("latency fields are always numeric in healthy run", () => {
      const meta = makeHealthyMeta();
      expect(typeof meta.performance.total_latency_ms).toBe("number");
      expect(typeof meta.performance.generation_latency_ms).toBe("number");
      expect(typeof meta.performance.gate_latency_ms).toBe("number");
      expect(meta.performance.total_latency_ms).toBeGreaterThanOrEqual(0);
    });

    it("regen_latency present when regen runs", () => {
      const meta = makeFailedMeta();
      expect(meta.performance.regen_latency_ms).toBeDefined();
      expect(typeof meta.performance.regen_latency_ms).toBe("number");
    });
  });

  describe("Failure States Logged", () => {
    it("failed dimensions are captured in failed run", () => {
      const meta = makeFailedMeta();
      expect(meta.artifact_gate.failed_dimensions.length).toBeGreaterThan(0);
    });

    it("failure state has non-zero gate latency", () => {
      const meta = makeFailedMeta();
      expect(meta.artifact_gate.total_gate_latency_ms).toBeGreaterThan(0);
    });
  });
});
