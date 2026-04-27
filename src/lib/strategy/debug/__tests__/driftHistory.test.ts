import { describe, it, expect } from "vitest";
import { summarizeDriftHistory } from "../driftHistory";

const ok = (malformed: string[] = [], unknown: string[] = []) => ({
  schema_health: {
    status: "ok",
    validated_at: "2026-04-27T00:00:00Z",
    source: "chat",
    schema_version: "w10.v1",
    totals: { valid: 1, missing: 0, malformed: malformed.length, unknownFieldWarnings: unknown.length },
    malformed_keys: malformed,
    missing_keys: [],
    unknown_field_keys: unknown,
  },
});

const drift = (malformed: string[] = []) => ({
  schema_health: {
    status: "drift",
    validated_at: "2026-04-27T00:00:00Z",
    source: "chat",
    schema_version: "w10.v1",
    totals: { valid: 0, missing: 0, malformed: malformed.length, unknownFieldWarnings: 0 },
    malformed_keys: malformed,
    missing_keys: [],
    unknown_field_keys: [],
  },
});

const validatorErr = () => ({
  schema_health: {
    status: "validator_error",
    validated_at: "2026-04-27T00:00:00Z",
    source: "chat",
    schema_version: "w10.v1",
    totals: { valid: 0, missing: 0, malformed: 0, unknownFieldWarnings: 0 },
    malformed_keys: [],
    missing_keys: [],
    unknown_field_keys: [],
    error: "boom",
  },
});

describe("summarizeDriftHistory", () => {
  it("returns zeros for empty input", () => {
    const r = summarizeDriftHistory("chat", []);
    expect(r.total).toBe(0);
    expect(r.counts).toEqual({ ok: 0, drift: 0, validator_error: 0, missing: 0 });
    expect(r.topMalformedKeys).toEqual([]);
    expect(r.topUnknownFieldKeys).toEqual([]);
  });

  it("counts statuses across rows", () => {
    const r = summarizeDriftHistory("chat", [
      ok(),
      drift(["calibration"]),
      drift(["calibration", "gate_check"]),
      validatorErr(),
      null,
      {},
      { schema_health: "garbage" },
    ]);
    expect(r.total).toBe(7);
    expect(r.counts.ok).toBe(1);
    expect(r.counts.drift).toBe(2);
    expect(r.counts.validator_error).toBe(1);
    expect(r.counts.missing).toBe(3);
  });

  it("ranks top malformed keys", () => {
    const r = summarizeDriftHistory("task", [
      drift(["calibration"]),
      drift(["calibration", "gate_check"]),
      drift(["calibration"]),
      drift(["citation_check"]),
    ]);
    expect(r.topMalformedKeys[0]).toEqual({ key: "calibration", count: 3 });
    expect(r.topMalformedKeys.find((x) => x.key === "gate_check")?.count).toBe(1);
    expect(r.topMalformedKeys.find((x) => x.key === "citation_check")?.count).toBe(1);
  });

  it("ranks top unknown-field keys", () => {
    const r = summarizeDriftHistory("chat", [
      ok([], ["standard_context"]),
      ok([], ["standard_context", "calibration"]),
      ok([], ["standard_context"]),
    ]);
    expect(r.topUnknownFieldKeys[0]).toEqual({ key: "standard_context", count: 3 });
  });

  it("never throws on garbage", () => {
    expect(() =>
      summarizeDriftHistory("chat", [undefined, 123, "x", [], { schema_health: 7 }]),
    ).not.toThrow();
  });
});
