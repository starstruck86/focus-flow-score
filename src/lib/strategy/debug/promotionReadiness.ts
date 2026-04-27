/**
 * W11 — Promotion Readiness Helper
 *
 * Read-only classifier that combines persisted W10 schema_health with
 * live W3–W7.5 telemetry signals (gates, citations, calibration,
 * escalation) into a single promotion-readiness verdict per row.
 *
 * Doctrine:
 *   - NEVER mutates input.
 *   - NEVER throws — every signal is read defensively.
 *   - NEVER triggers writes, retries, or generation.
 *   - Output is metadata-only. NO enforcement, NO routing change.
 *
 * Verdict ladder:
 *   - blocked_by_drift     → persisted schema_health is `drift` or
 *                            `validator_error`. Cannot trust signals
 *                            until schema is repaired.
 *   - not_ready            → critical evidence missing (no gates run,
 *                            no calibration, or hard citation issues
 *                            today). Needs more telemetry / fixes
 *                            before it could ever graduate.
 *   - observe_more         → signals present but mixed — gate failures,
 *                            calibration below_standard, or escalation
 *                            suggestions firing. Keep in shadow.
 *   - promotion_candidate  → schema healthy, all gates passed, no
 *                            citation issues, calibration on_standard
 *                            with confidence, and zero escalation
 *                            suggestions in the most recent run.
 */
import {
  parseChatMessageTelemetry,
  parseTaskRunTelemetry,
  type StrategyTelemetrySummary,
} from "./parseStrategyTelemetry";
import {
  readPersistedSchemaHealth,
  type PersistedSchemaHealth,
} from "./persistedSchemaHealth";

export type PromotionReadiness =
  | "not_ready"
  | "observe_more"
  | "promotion_candidate"
  | "blocked_by_drift";

export type PromotionSource = "chat" | "task";

export interface PromotionReadinessReport {
  source: PromotionSource;
  readiness: PromotionReadiness;
  /** Short, human-readable rationales for the verdict. */
  reasons: string[];
  /** Compact signal snapshot used for the verdict. */
  signals: {
    schemaHealth: PersistedSchemaHealth["status"] | "missing";
    gateFailures: number;
    citationIssues: number;
    calibrationVerdict: string | null;
    calibrationConfidence: string | null;
    escalationCount: number;
    standardContextInjected: boolean | null;
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readCalibration(meta: unknown): {
  verdict: string | null;
  confidence: string | null;
} {
  if (!isObject(meta)) return { verdict: null, confidence: null };
  const calib = meta["calibration"];
  if (!isObject(calib)) return { verdict: null, confidence: null };
  const verdict = typeof calib["overallVerdict"] === "string"
    ? (calib["overallVerdict"] as string)
    : null;
  const confidence = typeof calib["overallConfidence"] === "string"
    ? (calib["overallConfidence"] as string)
    : null;
  return { verdict, confidence };
}

function classify(
  source: PromotionSource,
  summary: StrategyTelemetrySummary,
  persisted: PersistedSchemaHealth | null,
  meta: unknown,
): PromotionReadinessReport {
  const reasons: string[] = [];
  const { verdict: calibrationVerdict, confidence: calibrationConfidence } =
    readCalibration(meta);
  const signals = {
    schemaHealth: (persisted?.status ?? "missing") as
      | PersistedSchemaHealth["status"]
      | "missing",
    gateFailures: summary.badges.gateFailures,
    citationIssues: summary.badges.citationIssues,
    calibrationVerdict,
    calibrationConfidence,
    escalationCount: summary.badges.escalationCount,
    standardContextInjected: summary.badges.standardContextInjected,
  };

  // Hard block: schema is drifting or validator failed at write-time.
  if (
    persisted &&
    (persisted.status === "drift" || persisted.status === "validator_error")
  ) {
    reasons.push(
      persisted.status === "drift"
        ? "persisted schema_health = drift"
        : `persisted schema_health = validator_error${
          persisted.error ? ` (${persisted.error})` : ""
        }`,
    );
    return {
      source,
      readiness: "blocked_by_drift",
      reasons,
      signals,
    };
  }

  // Not ready — telemetry too thin to even reason about graduation.
  const gateLayer = summary.layers.find((l) => l.key === "gate_check");
  const calibrationLayer = summary.layers.find((l) => l.key === "calibration");
  const citationLayer = summary.layers.find((l) => l.key === "citation_check");

  const gateMissing = !gateLayer || gateLayer.status === "missing" ||
    gateLayer.status === "failed";
  const calibrationMissing = !calibrationLayer ||
    calibrationLayer.status === "missing" ||
    calibrationLayer.status === "failed";
  const citationMissing = !citationLayer ||
    citationLayer.status === "missing" ||
    citationLayer.status === "failed";

  const notReadyReasons: string[] = [];
  if (gateMissing) notReadyReasons.push("gate_check missing/failed");
  if (calibrationMissing) {
    notReadyReasons.push("calibration missing/failed");
  }
  if (citationMissing) notReadyReasons.push("citation_check missing/failed");
  if (!persisted) notReadyReasons.push("no persisted schema_health (pre-W10)");

  if (notReadyReasons.length >= 2) {
    return {
      source,
      readiness: "not_ready",
      reasons: notReadyReasons,
      signals,
    };
  }

  // Observe more — signals present but at least one is yellow.
  const observeReasons: string[] = [];
  if (signals.gateFailures > 0) {
    observeReasons.push(`gateFailures=${signals.gateFailures}`);
  }
  if (signals.citationIssues > 0) {
    observeReasons.push(`citationIssues=${signals.citationIssues}`);
  }
  if (
    signals.calibrationVerdict === "below_standard" ||
    signals.calibrationVerdict === "insufficient_exemplars"
  ) {
    observeReasons.push(`calibration=${signals.calibrationVerdict}`);
  }
  if (signals.calibrationConfidence === "low") {
    observeReasons.push("calibrationConfidence=low");
  }
  if (signals.escalationCount > 0) {
    observeReasons.push(`escalations=${signals.escalationCount}`);
  }
  if (notReadyReasons.length === 1) {
    // Borderline — a single missing signal degrades to observe_more.
    observeReasons.push(notReadyReasons[0]);
  }

  if (observeReasons.length > 0) {
    return {
      source,
      readiness: "observe_more",
      reasons: observeReasons,
      signals,
    };
  }

  // Promotion candidate — every signal is green.
  reasons.push("schema_health=ok");
  reasons.push(`gates=${gateLayer?.status} (0 failures)`);
  reasons.push(`citation_check=${citationLayer?.status} (0 issues)`);
  reasons.push(
    `calibration=${signals.calibrationVerdict ?? "?"}/${
      signals.calibrationConfidence ?? "?"
    }`,
  );
  reasons.push("0 escalation suggestions");
  return {
    source,
    readiness: "promotion_candidate",
    reasons,
    signals,
  };
}

/** Classify a single strategy_messages.content_json blob. */
export function classifyChatPromotionReadiness(
  contentJson: unknown,
): PromotionReadinessReport {
  const summary = parseChatMessageTelemetry(contentJson);
  const persisted = readPersistedSchemaHealth(contentJson);
  return classify("chat", summary, persisted, contentJson);
}

/** Classify a single task_runs.meta blob. */
export function classifyTaskPromotionReadiness(
  meta: unknown,
): PromotionReadinessReport {
  const summary = parseTaskRunTelemetry(meta);
  const persisted = readPersistedSchemaHealth(meta);
  return classify("task", summary, persisted, meta);
}

export interface PromotionReadinessAggregate {
  source: PromotionSource;
  total: number;
  counts: Record<PromotionReadiness, number>;
  /** Most-common reasons across the window (top 5). */
  topReasons: Array<{ reason: string; count: number }>;
}

/**
 * Aggregate readiness over a window of recent rows.
 * Pure, never throws.
 */
export function aggregatePromotionReadiness(
  source: PromotionSource,
  metas: unknown[],
): PromotionReadinessAggregate {
  const counts: Record<PromotionReadiness, number> = {
    not_ready: 0,
    observe_more: 0,
    promotion_candidate: 0,
    blocked_by_drift: 0,
  };
  const reasonCounts = new Map<string, number>();
  for (const m of metas) {
    const report = source === "chat"
      ? classifyChatPromotionReadiness(m)
      : classifyTaskPromotionReadiness(m);
    counts[report.readiness] += 1;
    for (const r of report.reasons) {
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    }
  }
  const topReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 5);
  return {
    source,
    total: metas.length,
    counts,
    topReasons,
  };
}
