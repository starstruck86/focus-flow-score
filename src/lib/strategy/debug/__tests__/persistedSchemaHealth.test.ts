// @vitest-environment node
/**
 * W10 — persisted schema health helpers + drift comparator.
 */
import { describe, expect, it } from "vitest";
import {
  compareSchemaHealth,
  readPersistedSchemaHealth,
  type PersistedSchemaHealth,
} from "../persistedSchemaHealth";

describe("readPersistedSchemaHealth", () => {
  it("returns null on null/non-object input", () => {
    expect(readPersistedSchemaHealth(null)).toBeNull();
    expect(readPersistedSchemaHealth(undefined)).toBeNull();
    expect(readPersistedSchemaHealth("oops")).toBeNull();
    expect(readPersistedSchemaHealth({})).toBeNull();
  });

  it("returns null when status enum is invalid", () => {
    expect(
      readPersistedSchemaHealth({ schema_health: { status: "weird" } }),
    ).toBeNull();
  });

  it("parses an ok health blob", () => {
    const result = readPersistedSchemaHealth({
      schema_health: {
        status: "ok",
        validated_at: "2025-01-01T00:00:00Z",
        source: "chat",
        schema_version: "w10.v1",
        totals: { valid: 7, missing: 0, malformed: 0, unknownFieldWarnings: 0 },
        malformed_keys: [],
        missing_keys: [],
        unknown_field_keys: [],
      },
    });
    expect(result?.status).toBe("ok");
    expect(result?.totals.valid).toBe(7);
    expect(result?.source).toBe("chat");
  });

  it("parses a drift blob and surfaces malformed keys", () => {
    const result = readPersistedSchemaHealth({
      schema_health: {
        status: "drift",
        validated_at: "2025-01-01T00:00:00Z",
        source: "task",
        schema_version: "w10.v1",
        totals: { valid: 5, missing: 1, malformed: 2, unknownFieldWarnings: 1 },
        malformed_keys: ["calibration", "gate_check"],
        missing_keys: ["sop"],
        unknown_field_keys: ["standard_context"],
      },
    });
    expect(result?.status).toBe("drift");
    expect(result?.malformed_keys).toEqual(["calibration", "gate_check"]);
  });
});

describe("compareSchemaHealth", () => {
  const persisted: PersistedSchemaHealth = {
    status: "ok",
    validated_at: "now",
    source: "chat",
    schema_version: "w10.v1",
    totals: { valid: 7, missing: 0, malformed: 0, unknownFieldWarnings: 0 },
    malformed_keys: [],
    missing_keys: [],
    unknown_field_keys: [],
  };

  it("returns no drift when persisted is null", () => {
    expect(
      compareSchemaHealth(null, persisted.totals, []).drifted,
    ).toBe(false);
  });

  it("returns no drift when totals + keys match", () => {
    expect(
      compareSchemaHealth(persisted, persisted.totals, []).drifted,
    ).toBe(false);
  });

  it("flags drift on malformed totals delta", () => {
    const r = compareSchemaHealth(
      persisted,
      { valid: 6, missing: 0, malformed: 1, unknownFieldWarnings: 0 },
      ["calibration"],
    );
    expect(r.drifted).toBe(true);
    expect(r.reasons.some((x) => x.includes("malformed"))).toBe(true);
  });

  it("flags drift on differing malformed keys", () => {
    const r = compareSchemaHealth(
      { ...persisted, malformed_keys: ["calibration"] },
      { valid: 6, missing: 0, malformed: 1, unknownFieldWarnings: 0 },
      ["gate_check"],
    );
    expect(r.drifted).toBe(true);
    expect(r.reasons.some((x) => x.includes("only-persisted"))).toBe(true);
  });
});
