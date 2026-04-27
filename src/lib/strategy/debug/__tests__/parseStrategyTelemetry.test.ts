// @vitest-environment node
/**
 * Tests for W8 Strategy Telemetry parser.
 *
 * Coverage:
 *   - Parses fully-populated chat metadata across all layers.
 *   - Parses task_runs metadata including SOP block.
 *   - Handles missing blocks → status: "missing", raw: null.
 *   - Handles malformed (non-object) blocks → status: "failed".
 *   - Computes summary badges from raw blocks.
 *   - Never throws on null/undefined/garbage input.
 *   - Never mutates input.
 */
import { describe, expect, it } from "vitest";
import {
  parseChatMessageTelemetry,
  parseTaskRunTelemetry,
} from "../parseStrategyTelemetry";

const fullChatContent = {
  text: "answer",
  sources_used: 4,
  retrieval_meta: { resourceHits: 3, kiHits: 12 },
  routing_decision: {
    mode: "long_form",
    actual_provider: "anthropic",
    actual_model: "claude-3.7",
  },
  citation_audit: {
    modified: true,
    unverified: ["foo", "bar"],
    verified: ["baz"],
  },
  gate_check: {
    gates: [
      { id: "answer_first", passed: true },
      { id: "no_invented_facts", passed: false },
    ],
  },
  standard_context: {
    exemplarSetId: "exset-1",
    injected: true,
    exemplars: [{ id: "ex-1" }, { id: "ex-2" }],
  },
  calibration: {
    exemplarSetId: "exset-1",
    overallVerdict: "below_standard",
    weightedScore: 0.62,
  },
  escalation_suggestions: {
    suggestions: [
      { targetWorkspace: "refine", source: "calibration_overlay" },
    ],
  },
};

const fullTaskMeta = {
  ...fullChatContent,
  sop: { enabled: true, inputCheck: { ok: true }, outputCheck: { ok: true } },
};

describe("parseChatMessageTelemetry — happy path", () => {
  const result = parseChatMessageTelemetry(fullChatContent);

  it("returns chat source", () => {
    expect(result.source).toBe("chat");
  });

  it("emits all 7 layers in canonical order", () => {
    expect(result.layers.map((l) => l.key)).toEqual([
      "retrieval",
      "standard_context",
      "prompt_composition",
      "citation_check",
      "gate_check",
      "calibration",
      "escalation_suggestions",
    ]);
  });

  it("sets status=ran on populated layers", () => {
    expect(result.layers.find((l) => l.key === "retrieval")?.status).toBe(
      "ran",
    );
    expect(
      result.layers.find((l) => l.key === "standard_context")?.status,
    ).toBe("ran");
  });

  it("computes badges correctly", () => {
    expect(result.badges.standardContextInjected).toBe(true);
    expect(result.badges.calibrationVerdict).toBe("below_standard");
    expect(result.badges.gateFailures).toBe(1);
    // 2 unverified + modified=true → 3
    expect(result.badges.citationIssues).toBe(3);
    expect(result.badges.escalationCount).toBe(1);
  });
});

describe("parseChatMessageTelemetry — missing blocks", () => {
  it("handles fully-empty content_json without throwing", () => {
    const result = parseChatMessageTelemetry({});
    expect(result.layers.length).toBe(7);
    for (const layer of result.layers) {
      expect(layer.status).toBe("missing");
      expect(layer.raw).toBeNull();
    }
  });

  it("handles null without throwing", () => {
    const result = parseChatMessageTelemetry(null);
    expect(result.source).toBe("chat");
    expect(result.layers.length).toBe(7);
    expect(result.badges.standardContextInjected).toBeNull();
    expect(result.badges.calibrationVerdict).toBeNull();
    expect(result.badges.gateFailures).toBe(0);
    expect(result.badges.citationIssues).toBe(0);
    expect(result.badges.escalationCount).toBe(0);
  });

  it("handles undefined without throwing", () => {
    expect(() => parseChatMessageTelemetry(undefined)).not.toThrow();
  });

  it("handles partial data — only standard_context present", () => {
    const result = parseChatMessageTelemetry({
      standard_context: { injected: false, skippedReason: "no_rows" },
    });
    const std = result.layers.find((l) => l.key === "standard_context")!;
    expect(std.status).toBe("skipped");
    expect(std.summary).toContain("no_rows");
    expect(result.badges.standardContextInjected).toBe(false);
  });
});

describe("parseChatMessageTelemetry — malformed blocks", () => {
  it("flags non-object retrieval_meta as failed", () => {
    const result = parseChatMessageTelemetry({ retrieval_meta: "oops" });
    const r = result.layers.find((l) => l.key === "retrieval")!;
    expect(r.status).toBe("failed");
  });

  it("flags non-object calibration as failed", () => {
    const result = parseChatMessageTelemetry({ calibration: 42 });
    const c = result.layers.find((l) => l.key === "calibration")!;
    expect(c.status).toBe("failed");
    expect(result.badges.calibrationVerdict).toBeNull();
  });

  it("handles garbage input (string)", () => {
    expect(() => parseChatMessageTelemetry("not an object")).not.toThrow();
    const result = parseChatMessageTelemetry("not an object");
    expect(result.layers.every((l) => l.status === "missing")).toBe(true);
  });
});

describe("parseChatMessageTelemetry — calibration verdicts", () => {
  it("on_standard verdict produces ran status", () => {
    const result = parseChatMessageTelemetry({
      calibration: { overallVerdict: "on_standard", weightedScore: 0.91 },
    });
    expect(
      result.layers.find((l) => l.key === "calibration")?.status,
    ).toBe("ran");
    expect(result.badges.calibrationVerdict).toBe("on_standard");
  });

  it("insufficient_exemplars verdict produces skipped status", () => {
    const result = parseChatMessageTelemetry({
      calibration: { overallVerdict: "insufficient_exemplars" },
    });
    expect(
      result.layers.find((l) => l.key === "calibration")?.status,
    ).toBe("skipped");
  });
});

describe("parseTaskRunTelemetry", () => {
  it("includes SOP layer when present", () => {
    const result = parseTaskRunTelemetry(fullTaskMeta);
    expect(result.source).toBe("task");
    const sop = result.layers.find((l) => l.key === "sop");
    expect(sop).toBeDefined();
    expect(sop?.status).toBe("ran");
    expect(sop?.summary).toContain("validated");
  });

  it("omits SOP layer when absent", () => {
    const result = parseTaskRunTelemetry({
      retrieval_meta: { resourceHits: 0 },
    });
    expect(result.layers.find((l) => l.key === "sop")).toBeUndefined();
  });

  it("flags malformed sop block as failed", () => {
    const result = parseTaskRunTelemetry({ sop: "broken" });
    expect(result.layers.find((l) => l.key === "sop")?.status).toBe("failed");
  });

  it("handles fully-empty meta", () => {
    const result = parseTaskRunTelemetry({});
    expect(result.layers.length).toBe(7); // SOP omitted when missing
    for (const layer of result.layers) {
      expect(layer.status).toBe("missing");
    }
  });
});

describe("invariants", () => {
  it("never mutates input (chat)", () => {
    const input = JSON.parse(JSON.stringify(fullChatContent));
    const snapshot = JSON.stringify(input);
    parseChatMessageTelemetry(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("never mutates input (task)", () => {
    const input = JSON.parse(JSON.stringify(fullTaskMeta));
    const snapshot = JSON.stringify(input);
    parseTaskRunTelemetry(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("returns raw block verbatim by reference", () => {
    const block = { injected: true, exemplars: [] };
    const result = parseChatMessageTelemetry({ standard_context: block });
    const std = result.layers.find((l) => l.key === "standard_context")!;
    expect(std.raw).toBe(block);
  });

  it("each layer has a label, wave, summary, and key", () => {
    const result = parseChatMessageTelemetry(fullChatContent);
    for (const layer of result.layers) {
      expect(layer.key).toBeTruthy();
      expect(layer.label).toBeTruthy();
      expect(layer.wave).toBeTruthy();
      expect(typeof layer.summary).toBe("string");
    }
  });
});
