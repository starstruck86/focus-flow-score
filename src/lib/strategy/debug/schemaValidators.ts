/**
 * W9 — Strategy Metadata Schema Validators
 *
 * Read-only schema health checks for every metadata block produced
 * by W3–W7.5 (and SOP for task runs).
 *
 * Doctrine:
 *   - NEVER mutate input.
 *   - NEVER throw — every validator returns a structured report.
 *   - NEVER perform DB writes or generation.
 *   - Unknown fields → warning (allowed, surfaced).
 *   - Missing required fields → "malformed".
 *   - Wrong top-level shape → "malformed".
 *   - Block absent → "missing".
 *
 * The schema definitions below are intentionally conservative — they
 * encode the contract today's pipeline emits and act as drift
 * detectors. Loosen them only when the runtime contract genuinely
 * widens.
 */
import type { StrategyLayerKey } from "./parseStrategyTelemetry";

// ─── Types ────────────────────────────────────────────────────────

export type SchemaStatus = "valid" | "missing" | "malformed";

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

export interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
  /** Allowed string values when applicable. */
  enum?: readonly string[];
}

export interface BlockSchema {
  /** Stable layer key — used to align with the parser. */
  key: StrategyLayerKey;
  /** Human label for the UI. */
  label: string;
  /** Wave prefix (W3..W7.5 / SOP). */
  wave: string;
  /** Source key on `content_json` / `meta`. Aliases supported. */
  blockKeys: readonly string[];
  fields: readonly FieldSpec[];
}

export interface SchemaReport {
  key: StrategyLayerKey;
  label: string;
  wave: string;
  status: SchemaStatus;
  /** Fields that were declared required but are missing. */
  missingFields: string[];
  /** Fields whose runtime type does not match the spec. */
  invalidFields: string[];
  /** Top-level keys present that are NOT in the schema (warning only). */
  unknownFields: string[];
  /** Free-form notes for the UI (e.g. "block is not an object"). */
  notes: string[];
}

export interface SchemaHealthSummary {
  source: "chat" | "task";
  reports: SchemaReport[];
  totals: {
    valid: number;
    missing: number;
    malformed: number;
    unknownFieldWarnings: number;
  };
}

// ─── Schemas (conservative; widen deliberately) ───────────────────

/**
 * Required field policy:
 *   - We mark a field "required" when the runtime ALWAYS emits it for
 *     a *populated* block. Optional/contextual fields stay required:false
 *     so that valid-but-narrow blocks (e.g. skipped Pass A) still pass.
 */
export const STRATEGY_BLOCK_SCHEMAS: readonly BlockSchema[] = [
  {
    key: "retrieval",
    label: "Retrieval",
    wave: "W3",
    blockKeys: ["retrieval_meta"],
    fields: [
      { name: "resourceHits", type: "number", required: false },
      { name: "kiHits", type: "number", required: false },
      { name: "resource_hits", type: "number", required: false },
      { name: "ki_hits", type: "number", required: false },
      { name: "sourceCount", type: "number", required: false },
      { name: "queryStrategy", type: "string", required: false },
      { name: "matchedTitles", type: "array", required: false },
    ],
  },
  {
    key: "standard_context",
    label: "Standard Context (Pass A)",
    wave: "W6.5",
    blockKeys: ["standard_context"],
    fields: [
      { name: "injected", type: "boolean", required: true },
      { name: "exemplarSetId", type: "string", required: false },
      { name: "exemplars", type: "array", required: false },
      { name: "skippedReason", type: "string", required: false },
      { name: "skipped_reason", type: "string", required: false },
      { name: "approxTokens", type: "number", required: false },
      { name: "surface", type: "string", required: false },
    ],
  },
  {
    key: "prompt_composition",
    label: "Prompt Composition",
    wave: "W4",
    blockKeys: ["prompt_composition", "routing_decision"],
    fields: [
      { name: "mode", type: "string", required: false },
      { name: "actual_provider", type: "string", required: false },
      { name: "actual_model", type: "string", required: false },
      { name: "provider", type: "string", required: false },
      { name: "model", type: "string", required: false },
      { name: "system_prompt_tokens", type: "number", required: false },
      { name: "fallbackUsed", type: "boolean", required: false },
    ],
  },
  {
    key: "citation_check",
    label: "Citation Check",
    wave: "W5",
    blockKeys: ["citation_check", "citation_audit"],
    fields: [
      { name: "modified", type: "boolean", required: false },
      { name: "unverified", type: "array", required: false },
      { name: "verified", type: "array", required: false },
      { name: "citations_found", type: "number", required: false },
      { name: "citationsFound", type: "number", required: false },
    ],
  },
  {
    key: "gate_check",
    label: "Gate Check",
    wave: "W6",
    blockKeys: ["gate_check"],
    fields: [
      { name: "gates", type: "array", required: true },
      { name: "passed_all", type: "boolean", required: false },
      { name: "passedAll", type: "boolean", required: false },
    ],
  },
  {
    key: "calibration",
    label: "Calibration (Pass B)",
    wave: "W6.5",
    blockKeys: ["calibration"],
    fields: [
      {
        name: "overallVerdict",
        type: "string",
        required: true,
        enum: [
          "on_standard",
          "below_standard",
          "above_standard",
          "insufficient_exemplars",
        ],
      },
      {
        name: "overallConfidence",
        type: "string",
        required: false,
        enum: ["low", "medium", "high"],
      },
      { name: "weightedScore", type: "number", required: false },
      { name: "exemplarSetId", type: "string", required: false },
      { name: "dimensions", type: "array", required: false },
    ],
  },
  {
    key: "escalation_suggestions",
    label: "Escalation",
    wave: "W7/W7.5",
    blockKeys: ["escalation_suggestions"],
    fields: [
      { name: "suggestions", type: "array", required: true },
      { name: "calibrationVerdict", type: "string", required: false },
      { name: "calibrationConfidence", type: "string", required: false },
    ],
  },
  // SOP is included; absent on chat — the validator emits "missing"
  // for chat sources and the UI hides it when source === "chat".
  {
    key: "sop",
    label: "SOP",
    wave: "SOP",
    blockKeys: ["sop"],
    fields: [
      { name: "enabled", type: "boolean", required: true },
      { name: "inputCheck", type: "object", required: false },
      { name: "outputCheck", type: "object", required: false },
    ],
  },
];

// ─── Utilities ────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getBlock(meta: unknown, keys: readonly string[]): unknown {
  if (!isObject(meta)) return undefined;
  for (const k of keys) {
    if (k in meta && meta[k] !== undefined) return meta[k];
  }
  return undefined;
}

function typeOf(v: unknown): FieldType {
  if (Array.isArray(v)) return "array";
  if (v === null) return "any";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return t;
  if (t === "object") return "object";
  return "any";
}

function typeMatches(v: unknown, expected: FieldType): boolean {
  if (expected === "any") return true;
  return typeOf(v) === expected;
}

// ─── Core validator ──────────────────────────────────────────────

export function validateBlock(
  meta: unknown,
  schema: BlockSchema,
): SchemaReport {
  const base: SchemaReport = {
    key: schema.key,
    label: schema.label,
    wave: schema.wave,
    status: "missing",
    missingFields: [],
    invalidFields: [],
    unknownFields: [],
    notes: [],
  };

  const block = getBlock(meta, schema.blockKeys);

  if (block === undefined || block === null) {
    return base;
  }

  if (!isObject(block)) {
    return {
      ...base,
      status: "malformed",
      notes: [`block is not an object (got ${typeOf(block)})`],
    };
  }

  const allowedNames = new Set(schema.fields.map((f) => f.name));
  const presentKeys = Object.keys(block);
  const unknownFields = presentKeys.filter((k) => !allowedNames.has(k));

  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  for (const field of schema.fields) {
    const present = field.name in block;
    const value = block[field.name];
    if (!present || value === undefined) {
      if (field.required) missingFields.push(field.name);
      continue;
    }
    if (!typeMatches(value, field.type)) {
      invalidFields.push(`${field.name}:expected ${field.type}`);
      continue;
    }
    if (
      field.enum &&
      typeof value === "string" &&
      !field.enum.includes(value)
    ) {
      invalidFields.push(`${field.name}:not in enum`);
    }
  }

  const status: SchemaStatus =
    missingFields.length > 0 || invalidFields.length > 0
      ? "malformed"
      : "valid";

  return {
    ...base,
    status,
    missingFields,
    invalidFields,
    unknownFields,
  };
}

// ─── Public API ──────────────────────────────────────────────────

function runValidators(
  meta: unknown,
  source: "chat" | "task",
): SchemaHealthSummary {
  const reports: SchemaReport[] = [];
  for (const schema of STRATEGY_BLOCK_SCHEMAS) {
    // Hide SOP from chat health — it doesn't belong there.
    if (schema.key === "sop" && source === "chat") continue;
    try {
      reports.push(validateBlock(meta, schema));
    } catch {
      // Defensive: validators are written to never throw, but if a
      // future change regresses, we still return a safe report.
      reports.push({
        key: schema.key,
        label: schema.label,
        wave: schema.wave,
        status: "malformed",
        missingFields: [],
        invalidFields: [],
        unknownFields: [],
        notes: ["validator threw"],
      });
    }
  }

  const totals = {
    valid: reports.filter((r) => r.status === "valid").length,
    missing: reports.filter((r) => r.status === "missing").length,
    malformed: reports.filter((r) => r.status === "malformed").length,
    unknownFieldWarnings: reports.reduce(
      (acc, r) => acc + r.unknownFields.length,
      0,
    ),
  };

  return { source, reports, totals };
}

/** Validate a strategy_messages.content_json record. */
export function validateChatMessageSchema(
  contentJson: unknown,
): SchemaHealthSummary {
  return runValidators(contentJson, "chat");
}

/** Validate a task_runs.meta record. */
export function validateTaskRunSchema(meta: unknown): SchemaHealthSummary {
  return runValidators(meta, "task");
}
