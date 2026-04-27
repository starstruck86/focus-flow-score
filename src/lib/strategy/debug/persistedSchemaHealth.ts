/**
 * W10 — Persisted schema health types (frontend mirror).
 *
 * The runtime stamps `schema_health` onto:
 *   - strategy_messages.content_json.schema_health
 *   - task_runs.meta.schema_health
 *
 * This file mirrors the compact shape persisted by
 * `supabase/functions/_shared/strategy-core/schemaHealth.ts` so the
 * debug UI can read it without depending on edge code.
 */
import type { StrategyLayerKey } from "./parseStrategyTelemetry";

export const STRATEGY_SCHEMA_VERSION_FRONTEND = "w10.v1";

export interface PersistedSchemaHealth {
  status: "ok" | "drift" | "validator_error";
  validated_at: string;
  source: "chat" | "task";
  schema_version: string;
  totals: {
    valid: number;
    missing: number;
    malformed: number;
    unknownFieldWarnings: number;
  };
  malformed_keys: StrategyLayerKey[];
  missing_keys: StrategyLayerKey[];
  unknown_field_keys: StrategyLayerKey[];
  error?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Safely extract `schema_health` from a persisted meta blob.
 * Returns null if absent or unrecognizable. Never throws.
 */
export function readPersistedSchemaHealth(
  meta: unknown,
): PersistedSchemaHealth | null {
  if (!isObject(meta)) return null;
  const sh = meta["schema_health"];
  if (!isObject(sh)) return null;
  const totals = isObject(sh["totals"]) ? sh["totals"] : {};
  const status = sh["status"];
  if (status !== "ok" && status !== "drift" && status !== "validator_error") {
    return null;
  }
  const source = sh["source"] === "task" ? "task" : "chat";
  return {
    status,
    validated_at: typeof sh["validated_at"] === "string" ? sh["validated_at"] : "",
    source,
    schema_version: typeof sh["schema_version"] === "string" ? sh["schema_version"] : "?",
    totals: {
      valid: typeof totals["valid"] === "number" ? totals["valid"] : 0,
      missing: typeof totals["missing"] === "number" ? totals["missing"] : 0,
      malformed: typeof totals["malformed"] === "number" ? totals["malformed"] : 0,
      unknownFieldWarnings:
        typeof totals["unknownFieldWarnings"] === "number"
          ? totals["unknownFieldWarnings"]
          : 0,
    },
    malformed_keys: asStringArray(sh["malformed_keys"]) as StrategyLayerKey[],
    missing_keys: asStringArray(sh["missing_keys"]) as StrategyLayerKey[],
    unknown_field_keys: asStringArray(sh["unknown_field_keys"]) as StrategyLayerKey[],
    error: typeof sh["error"] === "string" ? sh["error"] : undefined,
  };
}

export interface SchemaHealthDrift {
  /** True when persisted totals or malformed keys differ from live ones. */
  drifted: boolean;
  reasons: string[];
}

/**
 * Compare persisted vs live (W9) totals + malformed keys to detect drift.
 * Pure, never throws.
 */
export function compareSchemaHealth(
  persisted: PersistedSchemaHealth | null,
  liveTotals: {
    valid: number;
    missing: number;
    malformed: number;
    unknownFieldWarnings: number;
  },
  liveMalformedKeys: StrategyLayerKey[],
): SchemaHealthDrift {
  if (!persisted) return { drifted: false, reasons: [] };
  const reasons: string[] = [];
  if (persisted.totals.malformed !== liveTotals.malformed) {
    reasons.push(
      `malformed: persisted=${persisted.totals.malformed} live=${liveTotals.malformed}`,
    );
  }
  if (persisted.totals.missing !== liveTotals.missing) {
    reasons.push(
      `missing: persisted=${persisted.totals.missing} live=${liveTotals.missing}`,
    );
  }
  if (persisted.totals.valid !== liveTotals.valid) {
    reasons.push(
      `valid: persisted=${persisted.totals.valid} live=${liveTotals.valid}`,
    );
  }
  const persistedSet = new Set(persisted.malformed_keys);
  const liveSet = new Set(liveMalformedKeys);
  const onlyPersisted = [...persistedSet].filter((k) => !liveSet.has(k));
  const onlyLive = [...liveSet].filter((k) => !persistedSet.has(k));
  if (onlyPersisted.length || onlyLive.length) {
    reasons.push(
      `malformed_keys differ: only-persisted=[${onlyPersisted.join(",")}] only-live=[${onlyLive.join(",")}]`,
    );
  }
  return { drifted: reasons.length > 0, reasons };
}
