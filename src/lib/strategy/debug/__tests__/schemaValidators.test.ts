// @vitest-environment node
/**
 * W9 — Schema validator tests.
 *
 * Coverage:
 *   - Valid full chat + task fixtures → all blocks valid.
 *   - Missing block → status: "missing".
 *   - Malformed block (non-object) → status: "malformed" with note.
 *   - Missing required field → status: "malformed".
 *   - Wrong-typed field → status: "malformed".
 *   - Enum violation → status: "malformed".
 *   - Unknown fields → warning (does NOT mark malformed).
 *   - Validators never throw and never mutate input.
 *   - Snapshot fixtures stay in sync with schema.
 */
import { describe, expect, it } from "vitest";
import {
  validateBlock,
  validateChatMessageSchema,
  validateTaskRunSchema,
  STRATEGY_BLOCK_SCHEMAS,
} from "../schemaValidators";
import {
  CHAT_MESSAGE_FULL_META,
  TASK_RUN_FULL_META,
} from "../__fixtures__/snapshots";

describe("validateChatMessageSchema — full fixture", () => {
  const result = validateChatMessageSchema(CHAT_MESSAGE_FULL_META);

  it("hides SOP for chat source", () => {
    expect(result.source).toBe("chat");
    expect(result.reports.find((r) => r.key === "sop")).toBeUndefined();
  });

  it("marks every block valid", () => {
    for (const r of result.reports) {
      expect({ key: r.key, status: r.status }).toEqual({
        key: r.key,
        status: "valid",
      });
    }
  });

  it("emits zero unknown-field warnings", () => {
    expect(result.totals.unknownFieldWarnings).toBe(0);
  });

  it("totals add up", () => {
    expect(result.totals.valid).toBe(result.reports.length);
    expect(result.totals.missing).toBe(0);
    expect(result.totals.malformed).toBe(0);
  });
});

describe("validateTaskRunSchema — full fixture", () => {
  const result = validateTaskRunSchema(TASK_RUN_FULL_META);

  it("includes SOP for task source", () => {
    const sop = result.reports.find((r) => r.key === "sop");
    expect(sop).toBeDefined();
    expect(sop?.status).toBe("valid");
  });

  it("marks every block valid", () => {
    for (const r of result.reports) {
      expect({ key: r.key, status: r.status }).toEqual({
        key: r.key,
        status: "valid",
      });
    }
  });
});

describe("missing blocks", () => {
  it("marks blocks missing when meta is empty", () => {
    const result = validateChatMessageSchema({});
    for (const r of result.reports) {
      expect(r.status).toBe("missing");
    }
    expect(result.totals.missing).toBe(result.reports.length);
  });

  it("handles null without throwing", () => {
    expect(() => validateChatMessageSchema(null)).not.toThrow();
    const result = validateChatMessageSchema(null);
    expect(result.totals.missing).toBe(result.reports.length);
  });

  it("handles garbage input without throwing", () => {
    expect(() => validateChatMessageSchema("oops")).not.toThrow();
    expect(() => validateTaskRunSchema(42)).not.toThrow();
  });
});

describe("malformed blocks", () => {
  it("flags non-object retrieval_meta as malformed", () => {
    const result = validateChatMessageSchema({ retrieval_meta: "broken" });
    const r = result.reports.find((x) => x.key === "retrieval")!;
    expect(r.status).toBe("malformed");
    expect(r.notes[0]).toContain("not an object");
  });

  it("flags missing required field (calibration.overallVerdict)", () => {
    const result = validateChatMessageSchema({
      calibration: { weightedScore: 0.5 },
    });
    const r = result.reports.find((x) => x.key === "calibration")!;
    expect(r.status).toBe("malformed");
    expect(r.missingFields).toContain("overallVerdict");
  });

  it("flags wrong-typed field (gate_check.gates as object)", () => {
    const result = validateChatMessageSchema({
      gate_check: { gates: { not: "an array" } },
    });
    const r = result.reports.find((x) => x.key === "gate_check")!;
    expect(r.status).toBe("malformed");
    expect(r.invalidFields.some((f) => f.startsWith("gates"))).toBe(true);
  });

  it("flags enum violation (calibration.overallVerdict)", () => {
    const result = validateChatMessageSchema({
      calibration: { overallVerdict: "vibes_only" },
    });
    const r = result.reports.find((x) => x.key === "calibration")!;
    expect(r.status).toBe("malformed");
    expect(
      r.invalidFields.some((f) => f.includes("overallVerdict")),
    ).toBe(true);
  });

  it("flags missing required suggestions array on escalation", () => {
    const result = validateChatMessageSchema({ escalation_suggestions: {} });
    const r = result.reports.find(
      (x) => x.key === "escalation_suggestions",
    )!;
    expect(r.status).toBe("malformed");
    expect(r.missingFields).toContain("suggestions");
  });
});

describe("unknown fields → warning only", () => {
  it("does NOT mark a block malformed when it has extra keys", () => {
    const result = validateChatMessageSchema({
      standard_context: {
        injected: true,
        exemplars: [],
        // Unknown future field:
        novel_signal: "future-feature",
      },
    });
    const r = result.reports.find((x) => x.key === "standard_context")!;
    expect(r.status).toBe("valid");
    expect(r.unknownFields).toContain("novel_signal");
    expect(result.totals.unknownFieldWarnings).toBeGreaterThan(0);
  });

  it("counts unknown fields across blocks in totals", () => {
    const result = validateChatMessageSchema({
      retrieval_meta: { resourceHits: 1, foo: "bar", baz: 1 },
      gate_check: { gates: [], extra: true },
    });
    expect(result.totals.unknownFieldWarnings).toBe(3);
  });
});

describe("invariants", () => {
  it("never mutates input (chat)", () => {
    const input = JSON.parse(JSON.stringify(CHAT_MESSAGE_FULL_META));
    const snapshot = JSON.stringify(input);
    validateChatMessageSchema(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("never mutates input (task)", () => {
    const input = JSON.parse(JSON.stringify(TASK_RUN_FULL_META));
    const snapshot = JSON.stringify(input);
    validateTaskRunSchema(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("validateBlock returns missing for absent block on every schema", () => {
    for (const schema of STRATEGY_BLOCK_SCHEMAS) {
      const r = validateBlock({}, schema);
      expect(r.status).toBe("missing");
      expect(r.missingFields).toEqual([]);
      expect(r.unknownFields).toEqual([]);
    }
  });
});

describe("snapshot — full chat fixture", () => {
  it("matches schema health snapshot", () => {
    const result = validateChatMessageSchema(CHAT_MESSAGE_FULL_META);
    expect({
      source: result.source,
      totals: result.totals,
      reports: result.reports.map((r) => ({
        key: r.key,
        status: r.status,
        missingFields: r.missingFields,
        invalidFields: r.invalidFields,
        unknownFields: r.unknownFields,
      })),
    }).toMatchInlineSnapshot(`
      {
        "reports": [
          {
            "invalidFields": [],
            "key": "retrieval",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
          {
            "invalidFields": [],
            "key": "standard_context",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
          {
            "invalidFields": [],
            "key": "prompt_composition",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
          {
            "invalidFields": [],
            "key": "citation_check",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
          {
            "invalidFields": [],
            "key": "gate_check",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
          {
            "invalidFields": [],
            "key": "calibration",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
          {
            "invalidFields": [],
            "key": "escalation_suggestions",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
          {
            "invalidFields": [],
            "key": "enforcement_dry_run",
            "missingFields": [],
            "status": "valid",
            "unknownFields": [],
          },
        ],
        "source": "chat",
        "totals": {
          "malformed": 0,
          "missing": 0,
          "unknownFieldWarnings": 0,
          "valid": 8,
        },
      }
    `);
  });
});

describe("snapshot — full task fixture", () => {
  it("matches schema health snapshot including SOP", () => {
    const result = validateTaskRunSchema(TASK_RUN_FULL_META);
    const sop = result.reports.find((r) => r.key === "sop");
    expect(sop?.status).toBe("valid");
    expect(result.totals).toEqual({
      valid: 8,
      missing: 0,
      malformed: 0,
      unknownFieldWarnings: 0,
    });
  });
});
