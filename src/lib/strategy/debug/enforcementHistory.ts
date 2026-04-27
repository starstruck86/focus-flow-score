/**
 * W12 — Enforcement Dry-Run History Aggregator (frontend, read-only)
 *
 * Pure summarization over the most recent N strategy_messages
 * (`content_json`) and task_runs (`meta`) blobs. No DB writes,
 * no mutation of inputs, never throws on garbage rows.
 *
 * Source-of-truth for the persisted block is the edge module
 * `supabase/functions/_shared/strategy-core/enforcementPolicy.ts`.
 * This file mirrors only what the debug UI needs to render.
 */

export type EnforcementHistorySource = "chat" | "task";

export interface EnforcementPersistedBlock {
  workspace?: string;
  contractVersion?: string;
  surface?: string;
  totals?: {
    evaluated?: number;
    wouldFire?: number;
    disabled?: number;
    errors?: number;
  };
  evaluations?: Array<{
    policyId?: string;
    layer?: string;
    state?: string;
    wouldFire?: boolean;
    reason?: string;
  }>;
}

export interface EnforcementHistoryRow {
  source: EnforcementHistorySource;
  /** Whether the row had a persisted block at all. */
  hasBlock: boolean;
  /** Number of policies that would have fired on this row. */
  wouldFireCount: number;
  /** Per-row policy ids that would have fired. */
  firedPolicyIds: string[];
}

export interface EnforcementHistorySummary {
  source: EnforcementHistorySource;
  total: number;
  /** Rows with a persisted enforcement_dry_run block. */
  withBlock: number;
  /** Rows missing the block entirely (pre-W12 / failed stamp). */
  missingBlock: number;
  /** Sum of `wouldFire` counts across rows. */
  totalWouldFire: number;
  /** Top firing policies (descending by frequency). */
  topFiringPolicies: Array<{ policyId: string; count: number }>;
  /** Histogram per policy state observed (dry_run/disabled/etc.). */
  stateCounts: Record<string, number>;
}

const TOP_N = 8;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readPersistedEnforcement(
  meta: unknown,
): EnforcementPersistedBlock | null {
  if (!isObject(meta)) return null;
  const block = meta["enforcement_dry_run"];
  if (!isObject(block)) return null;
  return block as EnforcementPersistedBlock;
}

function classifyRow(
  meta: unknown,
  source: EnforcementHistorySource,
): EnforcementHistoryRow {
  const block = readPersistedEnforcement(meta);
  if (!block) {
    return {
      source,
      hasBlock: false,
      wouldFireCount: 0,
      firedPolicyIds: [],
    };
  }
  const evals = Array.isArray(block.evaluations) ? block.evaluations : [];
  const firedPolicyIds = evals
    .filter((e) => e?.wouldFire === true && typeof e?.policyId === "string")
    .map((e) => e.policyId as string);
  const wouldFireCount = typeof block.totals?.wouldFire === "number"
    ? block.totals.wouldFire
    : firedPolicyIds.length;
  return {
    source,
    hasBlock: true,
    wouldFireCount,
    firedPolicyIds,
  };
}

function topN(
  ids: string[],
): Array<{ policyId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([policyId, count]) => ({ policyId, count }))
    .sort((a, b) =>
      b.count - a.count || a.policyId.localeCompare(b.policyId)
    )
    .slice(0, TOP_N);
}

export function summarizeEnforcementHistory(
  source: EnforcementHistorySource,
  metas: unknown[],
): EnforcementHistorySummary {
  const rows = metas.map((m) => classifyRow(m, source));
  const fired: string[] = [];
  const stateCounts: Record<string, number> = {};
  let withBlock = 0;
  let missingBlock = 0;
  let totalWouldFire = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.hasBlock) withBlock += 1;
    else missingBlock += 1;
    totalWouldFire += r.wouldFireCount;
    for (const id of r.firedPolicyIds) fired.push(id);

    // tally state counts from the original block (best-effort)
    const block = readPersistedEnforcement(metas[i]);
    if (block && Array.isArray(block.evaluations)) {
      for (const ev of block.evaluations) {
        const state = typeof ev?.state === "string" ? ev.state : "unknown";
        stateCounts[state] = (stateCounts[state] ?? 0) + 1;
      }
    }
  }

  return {
    source,
    total: rows.length,
    withBlock,
    missingBlock,
    totalWouldFire,
    topFiringPolicies: topN(fired),
    stateCounts,
  };
}
