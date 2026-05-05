/**
 * Phase 3.6 — Learning Loop Tests.
 *
 * Validates:
 * - Failure patterns are recorded correctly
 * - Aggregation works deterministically
 * - Output is consistent across identical inputs
 */
import { describe, it, expect } from "vitest";
import {
  accumulateFailurePatterns,
  emptyFailurePatterns,
  getArtifactFailureSummary,
  type FailurePatterns,
} from "../phase36-telemetry";

describe("Phase 3.6 — Learning Loop", () => {
  describe("Failure Pattern Recording", () => {
    it("empty patterns start at zero", () => {
      const p = emptyFailurePatterns();
      expect(p.template_fidelity).toBe(0);
      expect(p.readability).toBe(0);
      expect(p.section_completeness).toBe(0);
      expect(p.evidence_discipline).toBe(0);
    });

    it("accumulates single failure dimension", () => {
      const p = accumulateFailurePatterns(emptyFailurePatterns(), ["template_fidelity"]);
      expect(p.template_fidelity).toBe(1);
      expect(p.readability).toBe(0);
    });

    it("accumulates multiple failure dimensions at once", () => {
      const p = accumulateFailurePatterns(emptyFailurePatterns(), [
        "template_fidelity",
        "readability",
      ]);
      expect(p.template_fidelity).toBe(1);
      expect(p.readability).toBe(1);
    });

    it("accumulates over time", () => {
      let p = emptyFailurePatterns();
      p = accumulateFailurePatterns(p, ["template_fidelity"]);
      p = accumulateFailurePatterns(p, ["template_fidelity", "readability"]);
      p = accumulateFailurePatterns(p, ["evidence_discipline"]);
      expect(p.template_fidelity).toBe(2);
      expect(p.readability).toBe(1);
      expect(p.evidence_discipline).toBe(1);
      expect(p.section_completeness).toBe(0);
    });

    it("ignores unknown dimensions", () => {
      const p = accumulateFailurePatterns(emptyFailurePatterns(), ["unknown_dim" as any]);
      expect(p.template_fidelity).toBe(0);
      expect(p.readability).toBe(0);
    });

    it("does not mutate input", () => {
      const original = emptyFailurePatterns();
      accumulateFailurePatterns(original, ["template_fidelity"]);
      expect(original.template_fidelity).toBe(0);
    });
  });

  describe("Aggregation", () => {
    it("returns zero for empty runs", () => {
      const summary = getArtifactFailureSummary([]);
      expect(summary.total_runs).toBe(0);
      expect(summary.failed_runs).toBe(0);
      expect(summary.failure_rate).toBe(0);
      expect(summary.most_common_failure).toBeNull();
    });

    it("returns correct counts for all-passing runs", () => {
      const runs = Array.from({ length: 5 }, () => ({
        failed_dimensions: [],
        pass: true,
      }));
      const summary = getArtifactFailureSummary(runs);
      expect(summary.total_runs).toBe(5);
      expect(summary.failed_runs).toBe(0);
      expect(summary.failure_rate).toBe(0);
      expect(summary.most_common_failure).toBeNull();
    });

    it("identifies most common failure dimension", () => {
      const runs = [
        { pass: false, failed_dimensions: ["template_fidelity", "readability"] },
        { pass: false, failed_dimensions: ["template_fidelity"] },
        { pass: false, failed_dimensions: ["readability"] },
        { pass: true, failed_dimensions: [] },
      ];
      const summary = getArtifactFailureSummary(runs);
      expect(summary.total_runs).toBe(4);
      expect(summary.failed_runs).toBe(3);
      expect(summary.failure_rate).toBe(0.75);
      expect(summary.most_common_failure).toBe("template_fidelity");
      expect(summary.patterns.template_fidelity).toBe(2);
      expect(summary.patterns.readability).toBe(2);
    });

    it("respects lastN parameter", () => {
      const runs = [
        { pass: false, failed_dimensions: ["readability"] },
        { pass: false, failed_dimensions: ["readability"] },
        { pass: true, failed_dimensions: [] },
        { pass: true, failed_dimensions: [] },
        { pass: true, failed_dimensions: [] },
      ];
      // lastN=3 → only last 3 runs (all passing)
      const summary = getArtifactFailureSummary(runs, 3);
      expect(summary.total_runs).toBe(3);
      expect(summary.failed_runs).toBe(0);
    });

    it("deterministic output for identical inputs", () => {
      const runs = [
        { pass: false, failed_dimensions: ["section_completeness"] },
        { pass: true, failed_dimensions: [] },
      ];
      const s1 = getArtifactFailureSummary(runs);
      const s2 = getArtifactFailureSummary(runs);
      expect(s1).toEqual(s2);
    });
  });
});
