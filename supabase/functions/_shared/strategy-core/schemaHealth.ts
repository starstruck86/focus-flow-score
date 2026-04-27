/**
 * W10 — Edge-side Strategy Schema Validator (compact)
 *
 * Mirror of `src/lib/strategy/debug/schemaValidators.ts` but trimmed
 * down to produce ONLY the compact summary that gets persisted to:
 *   - strategy_messages.content_json.schema_health
 *   - task_runs.meta.schema_health
 *
 * Doctrine:
 *   - NEVER throws (callers wrap in try/catch as a defense-in-depth).
 *   - NEVER mutates input.
 *   - NEVER calls external services / DB.
 *   - Persisted payload is COMPACT (totals + per-block status keys),
 *     not full reports — keep ~200–500 bytes.
 *
 * The frontend `schemaValidators.ts` remains the source of truth for
 * the verbose UI report. This module exists so the runtime can stamp
 * a tamper-resistant point-in-time summary that the debug panel can
 * later compare against a fresh live validation.
 */

export type SchemaStatus = "valid" | "missing" | "malformed";
export type LayerKey =
  | "retrieval"
  | "standard_context"
  | "prompt_composition"
  | "citation_check"
  | "gate_check"
  | "calibration"
  | "escalation_suggestions"
  | "enforcement_dry_run"
  | "sop";

type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
  enum?: readonly string[];
}

interface BlockSchema {
  key: LayerKey;
  blockKeys: readonly string[];
  fields: readonly FieldSpec[];
}

const SCHEMAS: readonly BlockSchema[] = [
  {
    key: "retrieval",
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
    blockKeys: ["gate_check"],
    fields: [
      { name: "gates", type: "array", required: true },
      { name: "passed_all", type: "boolean", required: false },
      { name: "passedAll", type: "boolean", required: false },
    ],
  },
  {
    key: "calibration",
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
    blockKeys: ["escalation_suggestions"],
    fields: [
      { name: "suggestions", type: "array", required: true },
      { name: "calibrationVerdict", type: "string", required: false },
      { name: "calibrationConfidence", type: "string", required: false },
    ],
  },
  {
    key: "sop",
    blockKeys: ["sop"],
    fields: [
      { name: "enabled", type: "boolean", required: true },
      { name: "inputCheck", type: "object", required: false },
      { name: "outputCheck", type: "object", required: false },
    ],
  },
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getBlock(meta: unknown, keys: readonly string[]): unknown {
  if (!isObject(meta)) return undefined;
  for (const k of keys) {
    if (k in meta && (meta as Record<string, unknown>)[k] !== undefined) {
      return (meta as Record<string, unknown>)[k];
    }
  }
  return undefined;
}

function typeMatches(v: unknown, expected: FieldType): boolean {
  if (expected === "any") return true;
  if (expected === "array") return Array.isArray(v);
  if (expected === "object") return isObject(v);
  return typeof v === expected;
}

interface BlockReport {
  key: LayerKey;
  status: SchemaStatus;
  missingFields: string[];
  invalidFields: string[];
  unknownFields: string[];
}

function validateBlock(meta: unknown, schema: BlockSchema): BlockReport {
  const block = getBlock(meta, schema.blockKeys);
  const out: BlockReport = {
    key: schema.key,
    status: "missing",
    missingFields: [],
    invalidFields: [],
    unknownFields: [],
  };
  if (block === undefined || block === null) return out;
  if (!isObject(block)) {
    out.status = "malformed";
    return out;
  }
  const allowed = new Set(schema.fields.map((f) => f.name));
  out.unknownFields = Object.keys(block).filter((k) => !allowed.has(k));
  for (const f of schema.fields) {
    const present = f.name in block;
    const value = (block as Record<string, unknown>)[f.name];
    if (!present || value === undefined) {
      if (f.required) out.missingFields.push(f.name);
      continue;
    }
    if (!typeMatches(value, f.type)) {
      out.invalidFields.push(f.name);
      continue;
    }
    if (f.enum && typeof value === "string" && !f.enum.includes(value)) {
      out.invalidFields.push(f.name);
    }
  }
  if (out.missingFields.length > 0 || out.invalidFields.length > 0) {
    out.status = "malformed";
  } else {
    out.status = "valid";
  }
  return out;
}

/** Compact persistable schema-health summary. */
export interface SchemaHealthCompact {
  /**
   * Top-level outcome:
   *   - "ok"               — every block is valid or cleanly missing
   *   - "drift"            — at least one block malformed
   *   - "validator_error"  — validator threw (defensive fallback)
   */
  status: "ok" | "drift" | "validator_error";
  validated_at: string;
  source: "chat" | "task";
  /** schema/validator version — bump when schemas change. */
  schema_version: string;
  totals: {
    valid: number;
    missing: number;
    malformed: number;
    unknownFieldWarnings: number;
  };
  /** Layer keys with status === "malformed". */
  malformed_keys: LayerKey[];
  /** Layer keys with status === "missing". */
  missing_keys: LayerKey[];
  /** Layer keys that have unknown (warning) fields. */
  unknown_field_keys: LayerKey[];
  /** Optional error string when status === "validator_error". */
  error?: string;
}

export const STRATEGY_SCHEMA_VERSION = "w10.v1";

export function computeSchemaHealth(
  meta: unknown,
  source: "chat" | "task",
): SchemaHealthCompact {
  try {
    const reports: BlockReport[] = [];
    for (const schema of SCHEMAS) {
      if (schema.key === "sop" && source === "chat") continue;
      reports.push(validateBlock(meta, schema));
    }

    const totals = {
      valid: reports.filter((r) => r.status === "valid").length,
      missing: reports.filter((r) => r.status === "missing").length,
      malformed: reports.filter((r) => r.status === "malformed").length,
      unknownFieldWarnings: reports.reduce(
        (a, r) => a + r.unknownFields.length,
        0,
      ),
    };

    return {
      status: totals.malformed > 0 ? "drift" : "ok",
      validated_at: new Date().toISOString(),
      source,
      schema_version: STRATEGY_SCHEMA_VERSION,
      totals,
      malformed_keys: reports
        .filter((r) => r.status === "malformed")
        .map((r) => r.key),
      missing_keys: reports
        .filter((r) => r.status === "missing")
        .map((r) => r.key),
      unknown_field_keys: reports
        .filter((r) => r.unknownFields.length > 0)
        .map((r) => r.key),
    };
  } catch (e) {
    return {
      status: "validator_error",
      validated_at: new Date().toISOString(),
      source,
      schema_version: STRATEGY_SCHEMA_VERSION,
      totals: {
        valid: 0,
        missing: 0,
        malformed: 0,
        unknownFieldWarnings: 0,
      },
      malformed_keys: [],
      missing_keys: [],
      unknown_field_keys: [],
      error: String((e as Error)?.message ?? e).slice(0, 200),
    };
  }
}
