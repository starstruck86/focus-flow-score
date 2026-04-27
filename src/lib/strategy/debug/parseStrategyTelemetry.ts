/**
 * W8 — Strategy Telemetry Parser
 *
 * Read-only parser that extracts the W3–W7.5 reasoning layers from
 * a strategy_messages row (`content_json`) or a task_runs row (`meta`).
 *
 * Doctrine:
 *   - This module NEVER mutates input.
 *   - This module NEVER throws — every extractor returns a safe default
 *     when the underlying block is missing or malformed.
 *   - This module performs ZERO calls to generation pipelines.
 *
 * Layer ordering (matches the runtime pipeline):
 *   W3  retrieval         — facts pulled from library/web
 *   W6.5 standard_context — Pass A "what good looks like" injection
 *   W4  prompt_composition — system prompt assembly snapshot
 *   W5  citation_check    — post-gen citation audit
 *   W6  gate_check        — workspace gate evaluation
 *   W6.5 calibration      — Pass B grading vs exemplars
 *   W7/W7.5 escalation    — workspace recommendations (shadow)
 *   SOP                   — task_runs only
 */

// ─── Types ────────────────────────────────────────────────────────

export type LayerStatus = "ran" | "skipped" | "failed" | "missing";

export interface LayerSummary<T = unknown> {
  /** Stable layer key — used by the UI for lookup + tests. */
  key: StrategyLayerKey;
  /** Short, human label for the timeline row. */
  label: string;
  /** Wave number prefix (W3..W7.5) for the timeline. */
  wave: string;
  /** Lifecycle outcome for the layer. */
  status: LayerStatus;
  /** One-line summary suitable for a timeline row. */
  summary: string;
  /** Raw payload (untouched) for the JSON expander. */
  raw: T | null;
}

export type StrategyLayerKey =
  | "retrieval"
  | "standard_context"
  | "prompt_composition"
  | "citation_check"
  | "gate_check"
  | "calibration"
  | "escalation_suggestions"
  | "enforcement_dry_run"
  | "sop";

export interface StrategyTelemetrySummary {
  /** Source surface — "chat" for strategy_messages, "task" for task_runs. */
  source: "chat" | "task";
  layers: LayerSummary[];
  badges: {
    standardContextInjected: boolean | null;
    calibrationVerdict: string | null;
    gateFailures: number;
    citationIssues: number;
    escalationCount: number;
    /** W12 — total `wouldFire` policies in the dry-run summary. */
    enforcementWouldFire: number;
    /** W12 — total policies evaluated. null when block missing. */
    enforcementEvaluated: number | null;
  };
}

// ─── Utilities ────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getBlock(meta: unknown, key: string): unknown {
  if (!isObject(meta)) return undefined;
  return meta[key];
}

function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function arrayLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

// ─── Layer extractors (each NEVER throws, returns LayerSummary) ───

function extractRetrieval(meta: unknown): LayerSummary {
  const block = getBlock(meta, "retrieval_meta");
  if (block === undefined) {
    return {
      key: "retrieval",
      label: "Retrieval",
      wave: "W3",
      status: "missing",
      summary: "no retrieval metadata recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "retrieval",
      label: "Retrieval",
      wave: "W3",
      status: "failed",
      summary: "retrieval_meta is not an object",
      raw: block as unknown,
    };
  }
  const sourceCount = safeNumber(
    (getBlock(meta, "sources_used") as number) ?? block["sourceCount"],
  );
  const kiHits = safeNumber(block["kiHits"] ?? block["ki_hits"]);
  const resourceHits = safeNumber(
    block["resourceHits"] ?? block["resource_hits"],
  );
  return {
    key: "retrieval",
    label: "Retrieval",
    wave: "W3",
    status: "ran",
    summary:
      `sources=${sourceCount} · resources=${resourceHits} · kis=${kiHits}`,
    raw: block,
  };
}

function extractStandardContext(meta: unknown): LayerSummary {
  const block = getBlock(meta, "standard_context");
  if (block === undefined || block === null) {
    return {
      key: "standard_context",
      label: "Standard Context (Pass A)",
      wave: "W6.5",
      status: "missing",
      summary: "no standard_context block recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "standard_context",
      label: "Standard Context (Pass A)",
      wave: "W6.5",
      status: "failed",
      summary: "standard_context is not an object",
      raw: block,
    };
  }
  const injected = block["injected"] === true;
  const exemplarCount = arrayLen(block["exemplars"]);
  const skippedReason = safeString(block["skippedReason"]) ??
    safeString(block["skipped_reason"]);
  return {
    key: "standard_context",
    label: "Standard Context (Pass A)",
    wave: "W6.5",
    status: injected ? "ran" : "skipped",
    summary: injected
      ? `injected · exemplars=${exemplarCount}`
      : `skipped (${skippedReason ?? "unknown"})`,
    raw: block,
  };
}

function extractPromptComposition(meta: unknown): LayerSummary {
  // Prompt composition is logged via telemetry rather than persisted on
  // every message in current code; surface as "missing" when absent so
  // the UI degrades gracefully.
  const block = getBlock(meta, "prompt_composition") ??
    getBlock(meta, "routing_decision");
  if (block === undefined) {
    return {
      key: "prompt_composition",
      label: "Prompt Composition",
      wave: "W4",
      status: "missing",
      summary: "no prompt_composition block recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "prompt_composition",
      label: "Prompt Composition",
      wave: "W4",
      status: "failed",
      summary: "prompt_composition is not an object",
      raw: block,
    };
  }
  const model = safeString(block["actual_model"]) ??
    safeString(block["model"]);
  const provider = safeString(block["actual_provider"]) ??
    safeString(block["provider"]);
  return {
    key: "prompt_composition",
    label: "Prompt Composition",
    wave: "W4",
    status: "ran",
    summary: `${provider ?? "?"} · ${model ?? "?"}`,
    raw: block,
  };
}

function extractCitationCheck(meta: unknown): LayerSummary {
  const block = getBlock(meta, "citation_check") ??
    getBlock(meta, "citation_audit");
  if (block === undefined) {
    return {
      key: "citation_check",
      label: "Citation Check",
      wave: "W5",
      status: "missing",
      summary: "no citation_check block recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "citation_check",
      label: "Citation Check",
      wave: "W5",
      status: "failed",
      summary: "citation_check is not an object",
      raw: block,
    };
  }
  const found = safeNumber(block["citations_found"] ?? block["citationsFound"]);
  const unverified = arrayLen(block["unverified"]);
  const issues = unverified +
    (block["modified"] === true ? 1 : 0);
  return {
    key: "citation_check",
    label: "Citation Check",
    wave: "W5",
    status: "ran",
    summary: `found=${found} · issues=${issues}`,
    raw: block,
  };
}

function extractGateCheck(meta: unknown): LayerSummary {
  const block = getBlock(meta, "gate_check");
  if (block === undefined) {
    return {
      key: "gate_check",
      label: "Gate Check",
      wave: "W6",
      status: "missing",
      summary: "no gate_check block recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "gate_check",
      label: "Gate Check",
      wave: "W6",
      status: "failed",
      summary: "gate_check is not an object",
      raw: block,
    };
  }
  const gates = Array.isArray(block["gates"])
    ? (block["gates"] as Array<Record<string, unknown>>)
    : [];
  const failed = gates.filter((g) => isObject(g) && g["passed"] === false)
    .length;
  return {
    key: "gate_check",
    label: "Gate Check",
    wave: "W6",
    status: "ran",
    summary: `gates=${gates.length} · failed=${failed}`,
    raw: block,
  };
}

function extractCalibration(meta: unknown): LayerSummary {
  const block = getBlock(meta, "calibration");
  if (block === undefined || block === null) {
    return {
      key: "calibration",
      label: "Calibration (Pass B)",
      wave: "W6.5",
      status: "missing",
      summary: "no calibration block recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "calibration",
      label: "Calibration (Pass B)",
      wave: "W6.5",
      status: "failed",
      summary: "calibration is not an object",
      raw: block,
    };
  }
  const verdict = safeString(block["overallVerdict"]) ?? "unknown";
  const score = block["weightedScore"];
  const scoreStr = typeof score === "number"
    ? ` · score=${score.toFixed(2)}`
    : "";
  const status: LayerStatus = verdict === "insufficient_exemplars"
    ? "skipped"
    : "ran";
  return {
    key: "calibration",
    label: "Calibration (Pass B)",
    wave: "W6.5",
    status,
    summary: `verdict=${verdict}${scoreStr}`,
    raw: block,
  };
}

function extractEscalation(meta: unknown): LayerSummary {
  const block = getBlock(meta, "escalation_suggestions");
  if (block === undefined || block === null) {
    return {
      key: "escalation_suggestions",
      label: "Escalation",
      wave: "W7/W7.5",
      status: "missing",
      summary: "no escalation_suggestions block recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "escalation_suggestions",
      label: "Escalation",
      wave: "W7/W7.5",
      status: "failed",
      summary: "escalation_suggestions is not an object",
      raw: block,
    };
  }
  const suggestions = Array.isArray(block["suggestions"])
    ? (block["suggestions"] as unknown[])
    : [];
  return {
    key: "escalation_suggestions",
    label: "Escalation",
    wave: "W7/W7.5",
    status: suggestions.length > 0 ? "ran" : "skipped",
    summary: `suggestions=${suggestions.length}`,
    raw: block,
  };
}

function extractEnforcementDryRun(meta: unknown): LayerSummary {
  const block = getBlock(meta, "enforcement_dry_run");
  if (block === undefined || block === null) {
    return {
      key: "enforcement_dry_run",
      label: "Enforcement Dry Run",
      wave: "W12",
      status: "missing",
      summary: "no enforcement_dry_run block recorded",
      raw: null,
    };
  }
  if (!isObject(block)) {
    return {
      key: "enforcement_dry_run",
      label: "Enforcement Dry Run",
      wave: "W12",
      status: "failed",
      summary: "enforcement_dry_run is not an object",
      raw: block,
    };
  }
  const totals = isObject(block["totals"])
    ? (block["totals"] as Record<string, unknown>)
    : null;
  const evaluated = safeNumber(totals?.["evaluated"]);
  const wouldFire = safeNumber(totals?.["wouldFire"]);
  const disabled = safeNumber(totals?.["disabled"]);
  const errors = safeNumber(totals?.["errors"]);
  // Block exists → "ran" even if no policy fired (dry-run still ran).
  const status: LayerStatus = evaluated === 0 ? "skipped" : "ran";
  return {
    key: "enforcement_dry_run",
    label: "Enforcement Dry Run",
    wave: "W12",
    status,
    summary:
      `evaluated=${evaluated} · wouldFire=${wouldFire} · disabled=${disabled}${
        errors > 0 ? ` · errors=${errors}` : ""
      }`,
    raw: block,
  };
}

function extractSop(meta: unknown): LayerSummary | null {
  const block = getBlock(meta, "sop");
  if (block === undefined) return null;
  if (!isObject(block)) {
    return {
      key: "sop",
      label: "SOP",
      wave: "SOP",
      status: "failed",
      summary: "sop is not an object",
      raw: block,
    };
  }
  const enabled = block["enabled"] === true;
  return {
    key: "sop",
    label: "SOP",
    wave: "SOP",
    status: enabled ? "ran" : "skipped",
    summary: enabled ? "SOP validated" : "SOP not enabled",
    raw: block,
  };
}

// ─── Public API ──────────────────────────────────────────────────

const ORDERED_EXTRACTORS: ReadonlyArray<
  (meta: unknown) => LayerSummary | null
> = [
  extractRetrieval,
  extractStandardContext,
  extractPromptComposition,
  extractCitationCheck,
  extractGateCheck,
  extractCalibration,
  extractEscalation,
  extractEnforcementDryRun,
];

function summarize(
  layers: LayerSummary[],
  source: "chat" | "task",
): StrategyTelemetrySummary {
  const standardContext = layers.find((l) => l.key === "standard_context");
  const calibration = layers.find((l) => l.key === "calibration");
  const gate = layers.find((l) => l.key === "gate_check");
  const citation = layers.find((l) => l.key === "citation_check");
  const escalation = layers.find((l) => l.key === "escalation_suggestions");

  const calibRaw = isObject(calibration?.raw)
    ? (calibration!.raw as Record<string, unknown>)
    : null;
  const gateRaw = isObject(gate?.raw)
    ? (gate!.raw as Record<string, unknown>)
    : null;
  const citationRaw = isObject(citation?.raw)
    ? (citation!.raw as Record<string, unknown>)
    : null;
  const escalationRaw = isObject(escalation?.raw)
    ? (escalation!.raw as Record<string, unknown>)
    : null;
  const stdRaw = isObject(standardContext?.raw)
    ? (standardContext!.raw as Record<string, unknown>)
    : null;

  const gateFailures = Array.isArray(gateRaw?.["gates"])
    ? (gateRaw!["gates"] as Array<Record<string, unknown>>).filter(
      (g) => isObject(g) && g["passed"] === false,
    ).length
    : 0;

  const citationIssues = (citationRaw
    ? arrayLen(citationRaw["unverified"])
    : 0) + (citationRaw?.["modified"] === true ? 1 : 0);

  const escalationCount = Array.isArray(escalationRaw?.["suggestions"])
    ? (escalationRaw!["suggestions"] as unknown[]).length
    : 0;

  const standardContextInjected = stdRaw
    ? stdRaw["injected"] === true
    : null;

  const calibrationVerdict = calibRaw
    ? safeString(calibRaw["overallVerdict"])
    : null;

  return {
    source,
    layers,
    badges: {
      standardContextInjected,
      calibrationVerdict,
      gateFailures,
      citationIssues,
      escalationCount,
    },
  };
}

/** Parse a strategy_messages.content_json record. */
export function parseChatMessageTelemetry(
  contentJson: unknown,
): StrategyTelemetrySummary {
  const layers: LayerSummary[] = [];
  for (const fn of ORDERED_EXTRACTORS) {
    try {
      const layer = fn(contentJson);
      if (layer) layers.push(layer);
    } catch (_err) {
      // Defensive: extractors are written to never throw, but if a
      // future change regresses we still return a safe summary.
      layers.push({
        key: "retrieval",
        label: "Parse error",
        wave: "?",
        status: "failed",
        summary: "extractor threw",
        raw: null,
      });
    }
  }
  return summarize(layers, "chat");
}

/** Parse a task_runs.meta record. */
export function parseTaskRunTelemetry(
  meta: unknown,
): StrategyTelemetrySummary {
  const layers: LayerSummary[] = [];
  for (const fn of ORDERED_EXTRACTORS) {
    try {
      const layer = fn(meta);
      if (layer) layers.push(layer);
    } catch (_err) {
      layers.push({
        key: "retrieval",
        label: "Parse error",
        wave: "?",
        status: "failed",
        summary: "extractor threw",
        raw: null,
      });
    }
  }
  // SOP is task-only.
  const sop = extractSop(meta);
  if (sop) layers.push(sop);
  return summarize(layers, "task");
}
