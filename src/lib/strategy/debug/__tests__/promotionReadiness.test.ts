// @vitest-environment node
/**
 * W11 — Promotion readiness classifier + aggregator.
 *
 * Verifies the four-tier classification (not_ready / observe_more /
 * promotion_candidate / blocked_by_drift), no-mutation guarantees, and
 * graceful handling of missing / malformed metadata.
 */
import { describe, expect, it } from "vitest";
import {
  aggregatePromotionReadiness,
  classifyChatPromotionReadiness,
  classifyTaskPromotionReadiness,
} from "../promotionReadiness";
import {
  PERSISTED_CHAT_MESSAGE_DRIFT,
  PERSISTED_CHAT_MESSAGE_FULL,
  PERSISTED_CHAT_MESSAGE_PRE_W10,
  PERSISTED_TASK_RUN_FULL,
  PERSISTED_TASK_RUN_VALIDATOR_ERROR,
} from "../__fixtures__/persistedSnapshots";

describe("classifyChatPromotionReadiness", () => {
  it("classifies a fully-green chat row as promotion_candidate", () => {
    const r = classifyChatPromotionReadiness(PERSISTED_CHAT_MESSAGE_FULL);
    expect(r.readiness).toBe("promotion_candidate");
    expect(r.signals.schemaHealth).toBe("ok");
    expect(r.signals.gateFailures).toBe(0);
    expect(r.signals.citationIssues).toBe(0);
    expect(r.signals.escalationCount).toBe(0);
  });

  it("classifies a drift row as blocked_by_drift", () => {
    const r = classifyChatPromotionReadiness(PERSISTED_CHAT_MESSAGE_DRIFT);
    expect(r.readiness).toBe("blocked_by_drift");
    expect(r.reasons[0]).toMatch(/drift/);
  });

  it("classifies a pre-W10 row (missing schema_health) as observe_more", () => {
    // pre-W10 rows still have all reasoning blocks; they only lose the
    // persisted health envelope. That counts as a single missing signal,
    // so the verdict downgrades to observe_more, not not_ready.
    const r = classifyChatPromotionReadiness(PERSISTED_CHAT_MESSAGE_PRE_W10);
    expect(r.readiness).toBe("observe_more");
    expect(r.signals.schemaHealth).toBe("missing");
    expect(r.reasons.some((x) => /no persisted/.test(x))).toBe(true);
  });

  it("classifies an empty/garbage row as not_ready", () => {
    const r1 = classifyChatPromotionReadiness({});
    expect(r1.readiness).toBe("not_ready");
    const r2 = classifyChatPromotionReadiness(null);
    expect(r2.readiness).toBe("not_ready");
    const r3 = classifyChatPromotionReadiness("oops");
    expect(r3.readiness).toBe("not_ready");
  });

  it("downgrades to observe_more when calibration is below_standard", () => {
    const meta = {
      ...PERSISTED_CHAT_MESSAGE_FULL,
      calibration: {
        ...PERSISTED_CHAT_MESSAGE_FULL.calibration,
        overallVerdict: "below_standard",
        overallConfidence: "high",
      },
    };
    const r = classifyChatPromotionReadiness(meta);
    expect(r.readiness).toBe("observe_more");
    expect(r.reasons.some((x) => /below_standard/.test(x))).toBe(true);
  });

  it("downgrades when escalation suggestions exist", () => {
    const meta = {
      ...PERSISTED_CHAT_MESSAGE_FULL,
      escalation_suggestions: {
        ...PERSISTED_CHAT_MESSAGE_FULL.escalation_suggestions,
        suggestions: [{ kind: "refine", shadow: true }],
      },
    };
    const r = classifyChatPromotionReadiness(meta);
    expect(r.readiness).toBe("observe_more");
  });

  it("downgrades when gate failures exist", () => {
    const meta = {
      ...PERSISTED_CHAT_MESSAGE_FULL,
      gate_check: {
        gates: [
          { id: "answer_first", passed: false },
          { id: "no_invented_facts", passed: true },
        ],
        passed_all: false,
      },
    };
    const r = classifyChatPromotionReadiness(meta);
    expect(r.readiness).toBe("observe_more");
    expect(r.signals.gateFailures).toBe(1);
  });
});

describe("classifyTaskPromotionReadiness", () => {
  it("classifies a fully-green task row as promotion_candidate", () => {
    const r = classifyTaskPromotionReadiness(PERSISTED_TASK_RUN_FULL);
    expect(r.readiness).toBe("promotion_candidate");
    expect(r.source).toBe("task");
  });

  it("classifies validator_error as blocked_by_drift", () => {
    const r = classifyTaskPromotionReadiness(
      PERSISTED_TASK_RUN_VALIDATOR_ERROR,
    );
    expect(r.readiness).toBe("blocked_by_drift");
    expect(r.signals.schemaHealth).toBe("validator_error");
  });
});

describe("no mutation invariants", () => {
  it("does not mutate chat input", () => {
    const before = JSON.stringify(PERSISTED_CHAT_MESSAGE_FULL);
    classifyChatPromotionReadiness(PERSISTED_CHAT_MESSAGE_FULL);
    expect(JSON.stringify(PERSISTED_CHAT_MESSAGE_FULL)).toBe(before);
  });

  it("does not mutate task input", () => {
    const before = JSON.stringify(PERSISTED_TASK_RUN_FULL);
    classifyTaskPromotionReadiness(PERSISTED_TASK_RUN_FULL);
    expect(JSON.stringify(PERSISTED_TASK_RUN_FULL)).toBe(before);
  });
});

describe("aggregatePromotionReadiness", () => {
  it("counts each verdict across a window", () => {
    const agg = aggregatePromotionReadiness("chat", [
      PERSISTED_CHAT_MESSAGE_FULL,
      PERSISTED_CHAT_MESSAGE_FULL,
      PERSISTED_CHAT_MESSAGE_DRIFT,
      PERSISTED_CHAT_MESSAGE_PRE_W10,
      {},
    ]);
    expect(agg.total).toBe(5);
    expect(agg.counts.promotion_candidate).toBe(2);
    expect(agg.counts.blocked_by_drift).toBe(1);
    expect(agg.counts.observe_more).toBe(1);
    expect(agg.counts.not_ready).toBe(1);
  });

  it("returns zero counts on empty input", () => {
    const agg = aggregatePromotionReadiness("task", []);
    expect(agg.total).toBe(0);
    expect(agg.counts.promotion_candidate).toBe(0);
    expect(agg.topReasons).toEqual([]);
  });

  it("ranks top reasons by frequency", () => {
    const agg = aggregatePromotionReadiness("chat", [
      PERSISTED_CHAT_MESSAGE_DRIFT,
      PERSISTED_CHAT_MESSAGE_DRIFT,
      PERSISTED_CHAT_MESSAGE_DRIFT,
    ]);
    expect(agg.topReasons[0].count).toBe(3);
    expect(agg.topReasons[0].reason).toMatch(/drift/);
  });
});

describe("snapshot regression — persisted shapes", () => {
  it("PERSISTED_CHAT_MESSAGE_FULL retains schema_health.status=ok", () => {
    expect(PERSISTED_CHAT_MESSAGE_FULL.schema_health.status).toBe("ok");
    expect(PERSISTED_CHAT_MESSAGE_FULL.standard_context.injected).toBe(true);
    expect(PERSISTED_CHAT_MESSAGE_FULL.calibration.overallVerdict).toBe(
      "on_standard",
    );
    expect(PERSISTED_CHAT_MESSAGE_FULL.gate_check.passed_all).toBe(true);
    expect(PERSISTED_CHAT_MESSAGE_FULL.citation_audit.modified).toBe(false);
    expect(
      PERSISTED_CHAT_MESSAGE_FULL.escalation_suggestions.suggestions.length,
    ).toBe(0);
  });

  it("PERSISTED_TASK_RUN_FULL retains SOP block alongside schema_health", () => {
    expect(PERSISTED_TASK_RUN_FULL.schema_health.source).toBe("task");
    expect(PERSISTED_TASK_RUN_FULL.sop.enabled).toBe(true);
  });
});
