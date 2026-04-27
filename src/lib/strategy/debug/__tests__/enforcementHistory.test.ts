// @vitest-environment node
/**
 * Tests for W12 Enforcement Dry-Run history aggregator.
 *
 * Coverage:
 *   - Counts rows with vs without persisted enforcement_dry_run blocks.
 *   - Sums totals.wouldFire across rows.
 *   - Ranks top firing policy ids.
 *   - Buckets observed policy states.
 *   - Never throws on null / undefined / garbage / wrong-shape inputs.
 *   - Never mutates input.
 */
import { describe, expect, it } from "vitest";
import {
  readPersistedEnforcement,
  summarizeEnforcementHistory,
} from "../enforcementHistory";

const fullBlock = (
  fired: string[],
  states: string[] = [],
) => ({
  enforcement_dry_run: {
    workspace: "strategy",
    contractVersion: "v1",
    surface: "strategy-chat",
    totals: {
      evaluated: 5,
      wouldFire: fired.length,
      disabled: 0,
      errors: 0,
    },
    evaluations: [
      ...fired.map((id) => ({
        policyId: id,
        layer: "gate_check",
        state: "dry_run",
        wouldFire: true,
        reason: "fired",
      })),
      ...states.map((s) => ({
        policyId: `silent.${s}`,
        layer: "gate_check",
        state: s,
        wouldFire: false,
        reason: "silent",
      })),
    ],
  },
});

describe("readPersistedEnforcement", () => {
  it("returns null for non-objects", () => {
    expect(readPersistedEnforcement(null)).toBeNull();
    expect(readPersistedEnforcement(undefined)).toBeNull();
    expect(readPersistedEnforcement("oops")).toBeNull();
    expect(readPersistedEnforcement(42)).toBeNull();
  });

  it("returns null when block missing", () => {
    expect(readPersistedEnforcement({})).toBeNull();
  });

  it("returns null when block is not an object", () => {
    expect(readPersistedEnforcement({ enforcement_dry_run: "broken" })).toBeNull();
  });

  it("returns the block when present", () => {
    const r = readPersistedEnforcement(fullBlock(["gate.failure.high_confidence"]));
    expect(r).not.toBeNull();
    expect(r?.totals?.wouldFire).toBe(1);
  });
});

describe("summarizeEnforcementHistory — counts", () => {
  it("counts rows with and without blocks", () => {
    const r = summarizeEnforcementHistory("chat", [
      fullBlock([]),
      fullBlock(["gate.failure.high_confidence"]),
      null,
      {},
      { enforcement_dry_run: "garbage" },
    ]);
    expect(r.total).toBe(5);
    expect(r.withBlock).toBe(2);
    expect(r.missingBlock).toBe(3);
    expect(r.totalWouldFire).toBe(1);
  });

  it("ranks top firing policies by frequency", () => {
    const r = summarizeEnforcementHistory("task", [
      fullBlock(["gate.failure.high_confidence"]),
      fullBlock(["gate.failure.high_confidence", "calibration.below_standard.high_confidence"]),
      fullBlock(["gate.failure.high_confidence"]),
      fullBlock(["citation.unverified.strict"]),
    ]);
    expect(r.topFiringPolicies[0]).toEqual({
      policyId: "gate.failure.high_confidence",
      count: 3,
    });
    expect(r.topFiringPolicies.find((p) => p.policyId === "citation.unverified.strict")?.count)
      .toBe(1);
  });

  it("aggregates state counts across rows", () => {
    const r = summarizeEnforcementHistory("chat", [
      fullBlock([], ["disabled", "dry_run"]),
      fullBlock([], ["dry_run"]),
    ]);
    expect(r.stateCounts.disabled).toBe(1);
    expect(r.stateCounts.dry_run).toBe(3);
  });
});

describe("summarizeEnforcementHistory — invariants", () => {
  it("never throws on garbage input", () => {
    expect(() => summarizeEnforcementHistory("chat", [null, undefined, "oops" as any, 42 as any]))
      .not.toThrow();
  });

  it("does not mutate input", () => {
    const input = [fullBlock(["gate.failure.high_confidence"])];
    const snapshot = JSON.stringify(input);
    summarizeEnforcementHistory("task", input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("returns a stable empty summary for empty input", () => {
    const r = summarizeEnforcementHistory("chat", []);
    expect(r.total).toBe(0);
    expect(r.withBlock).toBe(0);
    expect(r.missingBlock).toBe(0);
    expect(r.totalWouldFire).toBe(0);
    expect(r.topFiringPolicies).toEqual([]);
    expect(r.stateCounts).toEqual({});
  });

  it("source label propagates", () => {
    expect(summarizeEnforcementHistory("chat", []).source).toBe("chat");
    expect(summarizeEnforcementHistory("task", []).source).toBe("task");
  });
});
