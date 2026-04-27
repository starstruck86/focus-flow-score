/**
 * W10 — Drift history aggregator.
 *
 * Pure, read-only summarization of persisted `schema_health` blobs across
 * the most recent N strategy_messages and task_runs. No DB writes,
 * no mutation of inputs, never throws on garbage rows.
 */
import {
  readPersistedSchemaHealth,
  type PersistedSchemaHealth,
} from "./persistedSchemaHealth";
import type { StrategyLayerKey } from "./parseStrategyTelemetry";

export type DriftHistorySource = "chat" | "task";

export interface DriftHistoryRow {
  source: DriftHistorySource;
  /**
   * "ok" | "drift" | "validator_error" | "missing"
   * `missing` indicates the row was inspected but had no persisted
   * schema_health blob — useful for tracking pre-W10 / failed-stamp rows.
   */
  status: PersistedSchemaHealth["status"] | "missing";
  malformedKeys: StrategyLayerKey[];
  unknownFieldKeys: StrategyLayerKey[];
}

export interface DriftHistorySummary {
  source: DriftHistorySource;
  total: number;
  counts: {
    ok: number;
    drift: number;
    validator_error: number;
    missing: number;
  };
  topMalformedKeys: Array<{ key: string; count: number }>;
  topUnknownFieldKeys: Array<{ key: string; count: number }>;
}

const TOP_N = 8;

function classifyRow(meta: unknown, source: DriftHistorySource): DriftHistoryRow {
  const persisted = readPersistedSchemaHealth(meta);
  if (!persisted) {
    return { source, status: "missing", malformedKeys: [], unknownFieldKeys: [] };
  }
  return {
    source,
    status: persisted.status,
    malformedKeys: persisted.malformed_keys,
    unknownFieldKeys: persisted.unknown_field_keys,
  };
}

function topN(keys: string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const k of keys) {
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TOP_N);
}

export function summarizeDriftHistory(
  source: DriftHistorySource,
  metas: unknown[],
): DriftHistorySummary {
  const rows = metas.map((m) => classifyRow(m, source));
  const counts = { ok: 0, drift: 0, validator_error: 0, missing: 0 };
  const malformed: string[] = [];
  const unknownFields: string[] = [];
  for (const r of rows) {
    counts[r.status] += 1;
    for (const k of r.malformedKeys) malformed.push(k);
    for (const k of r.unknownFieldKeys) unknownFields.push(k);
  }
  return {
    source,
    total: rows.length,
    counts,
    topMalformedKeys: topN(malformed),
    topUnknownFieldKeys: topN(unknownFields),
  };
}
