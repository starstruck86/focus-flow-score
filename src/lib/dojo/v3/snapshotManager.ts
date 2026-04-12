/**
 * V3 Snapshot Manager
 *
 * Creates and retrieves benchmark (Week 1) and retest (Week 8) snapshots.
 * Snapshots capture per-anchor avg score, top mistake, and focus-applied rate.
 */

import { supabase } from '@/integrations/supabase/client';
import { ANCHORS_IN_ORDER, type DayAnchor } from './dayAnchors';
import type { BlockSnapshot } from './blockManager';

// ── Types ──────────────────────────────────────────────────────────

export interface AnchorSnapshotData {
  avgScore: number;
  topMistake: string | null;
  focusAppliedRate: number;
  sessionCount: number;
}

/** Block-level flow metrics stored alongside anchor data in the snapshot JSON */
export interface SnapshotFlowMetrics {
  flowControlAvg: number | null;
  closingScoreAvg: number | null;
  simulationCount: number;
}

export interface SnapshotRow {
  id: string;
  blockId: string;
  userId: string;
  snapshotType: 'benchmark' | 'retest';
  weekNumber: number;
  stage: string;
  scoresByAnchor: Record<DayAnchor, AnchorSnapshotData>;
  mistakesActive: string[];
  mistakesResolved: string[];
  createdAt: string;
  flowMetrics?: SnapshotFlowMetrics;
}

// ── Create Snapshot ───────────────────────────────────────────────

/**
 * Build a snapshot from completed sessions for a given block + week.
 * Called when all 5 anchors are completed in Week 1 (benchmark) or Week 8 (retest).
 */
export async function createBlockSnapshot(
  userId: string,
  blockId: string,
  weekNumber: number,
  snapshotType: 'benchmark' | 'retest',
  stage: string,
): Promise<SnapshotRow | null> {
  // Dedup guard: check if snapshot already exists for this block + type
  const { data: existing } = await supabase
    .from('block_snapshots')
    .select('id')
    .eq('block_id', blockId)
    .eq('snapshot_type', snapshotType)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`[SnapshotManager] ${snapshotType} snapshot already exists for block ${blockId}, skipping`);
    return null;
  }
  // Fetch all completed sessions for this block + week via assignments
  const { data: assignments } = await supabase
    .from('daily_assignments')
    .select('id, day_anchor, session_ids')
    .eq('block_id', blockId)
    .eq('block_week', weekNumber)
    .eq('completed', true);

  if (!assignments || assignments.length === 0) return null;

  // Collect all session IDs
  const allSessionIds: string[] = assignments.flatMap(
    a => (a.session_ids as string[] | null) ?? []
  );

  if (allSessionIds.length === 0) return null;

  // Fetch session scores and turns
  const { data: sessions } = await supabase
    .from('dojo_sessions')
    .select('id, skill_focus, best_score, latest_score, session_type')
    .in('id', allSessionIds);

  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('session_id, score, top_mistake, turn_index')
    .in('session_id', allSessionIds);

  if (!sessions) return null;

  // Build per-anchor data
  const scoresByAnchor: Record<string, AnchorSnapshotData> = {};
  const allMistakes = new Set<string>();

  for (const anchor of ANCHORS_IN_ORDER) {
    // Find assignments for this anchor
    const anchorAssignments = assignments.filter(a => a.day_anchor === anchor);
    const anchorSessionIds = anchorAssignments.flatMap(
      a => (a.session_ids as string[] | null) ?? []
    );
    const anchorSessions = sessions.filter(s => anchorSessionIds.includes(s.id));
    const anchorTurns = (turns ?? []).filter(t => anchorSessionIds.includes(t.session_id));

    if (anchorSessions.length === 0) {
      scoresByAnchor[anchor] = { avgScore: 0, topMistake: null, focusAppliedRate: 0, sessionCount: 0 };
      continue;
    }

    const scores = anchorSessions.map(s => s.best_score ?? s.latest_score ?? 0);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    // Top mistake: most frequent across turns
    const mistakeCounts: Record<string, number> = {};
    for (const turn of anchorTurns) {
      if (turn.top_mistake) {
        mistakeCounts[turn.top_mistake] = (mistakeCounts[turn.top_mistake] ?? 0) + 1;
        allMistakes.add(turn.top_mistake);
      }
    }
    const topMistake = Object.entries(mistakeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Focus applied rate: % of sessions scoring ≥ 60
    const focusAppliedRate = scores.length > 0
      ? Math.round((scores.filter(s => s >= 60).length / scores.length) * 100)
      : 0;

    scoresByAnchor[anchor] = { avgScore, topMistake, focusAppliedRate, sessionCount: anchorSessions.length };
  }

  // Persist snapshot
  const { data: row, error } = await supabase
    .from('block_snapshots')
    .insert({
      block_id: blockId,
      user_id: userId,
      snapshot_type: snapshotType,
      week_number: weekNumber,
      stage,
      scores_by_anchor: scoresByAnchor as unknown as import('@/integrations/supabase/types').Json,
      mistakes_active: Array.from(allMistakes),
      mistakes_resolved: [],
    } as any)
    .select()
    .single();

  if (error || !row) {
    console.error('[SnapshotManager] Failed to create snapshot:', error);
    return null;
  }

  // Also save to the block's benchmark/retest snapshot field for quick access
  const blockSnapshot: BlockSnapshot = {};
  for (const anchor of ANCHORS_IN_ORDER) {
    const data = scoresByAnchor[anchor];
    if (data) {
      blockSnapshot[anchor] = {
        avgScore: data.avgScore,
        topMistake: data.topMistake,
        focusAppliedRate: data.focusAppliedRate,
      };
    }
  }

  await supabase
    .from('training_blocks')
    .update(
      snapshotType === 'benchmark'
        ? { benchmark_snapshot: blockSnapshot }
        : { retest_snapshot: blockSnapshot }
    )
    .eq('id', blockId);

  return mapSnapshotRow(row);
}

// ── Fetch Snapshots ──────────────────────────────────────────────

export async function getBlockSnapshots(blockId: string): Promise<{
  benchmark: SnapshotRow | null;
  retest: SnapshotRow | null;
}> {
  const { data } = await supabase
    .from('block_snapshots')
    .select('*')
    .eq('block_id', blockId)
    .order('created_at', { ascending: true });

  const benchmark = data?.find(r => r.snapshot_type === 'benchmark') ?? null;
  const retest = data?.find(r => r.snapshot_type === 'retest') ?? null;

  return {
    benchmark: benchmark ? mapSnapshotRow(benchmark) : null,
    retest: retest ? mapSnapshotRow(retest) : null,
  };
}

// ── Compare Snapshots ────────────────────────────────────────────

export interface SnapshotComparison {
  perAnchor: Array<{
    anchor: DayAnchor;
    label: string;
    benchmarkScore: number;
    retestScore: number;
    delta: number;
    benchmarkMistake: string | null;
    retestMistake: string | null;
    mistakeFixed: boolean;
  }>;
  overallDelta: number;
  mistakesFixed: string[];
  mistakesPersisting: string[];
  mistakesNew: string[];
}

export function compareSnapshots(
  benchmark: SnapshotRow,
  retest: SnapshotRow,
): SnapshotComparison {
  const anchorLabels: Record<DayAnchor, string> = {
    opening_cold_call: 'Cold Call',
    discovery_qualification: 'Discovery',
    objection_pricing: 'Objections',
    deal_control_negotiation: 'Deal Control',
    executive_roi_mixed: 'Executive',
  };

  const perAnchor = ANCHORS_IN_ORDER.map(anchor => {
    const bm = benchmark.scoresByAnchor[anchor];
    const rt = retest.scoresByAnchor[anchor];
    return {
      anchor,
      label: anchorLabels[anchor],
      benchmarkScore: bm?.avgScore ?? 0,
      retestScore: rt?.avgScore ?? 0,
      delta: (rt?.avgScore ?? 0) - (bm?.avgScore ?? 0),
      benchmarkMistake: bm?.topMistake ?? null,
      retestMistake: rt?.topMistake ?? null,
      mistakeFixed: !!(bm?.topMistake && bm.topMistake !== rt?.topMistake),
    };
  });

  const overallDelta = Math.round(
    perAnchor.reduce((s, a) => s + a.delta, 0) / perAnchor.length
  );

  const bmMistakes = new Set(benchmark.mistakesActive);
  const rtMistakes = new Set(retest.mistakesActive);

  return {
    perAnchor,
    overallDelta,
    mistakesFixed: Array.from(bmMistakes).filter(m => !rtMistakes.has(m)),
    mistakesPersisting: Array.from(bmMistakes).filter(m => rtMistakes.has(m)),
    mistakesNew: Array.from(rtMistakes).filter(m => !bmMistakes.has(m)),
  };
}

// ── Mapping ──────────────────────────────────────────────────────

function mapSnapshotRow(row: Record<string, unknown>): SnapshotRow {
  return {
    id: row.id as string,
    blockId: row.block_id as string,
    userId: row.user_id as string,
    snapshotType: row.snapshot_type as 'benchmark' | 'retest',
    weekNumber: row.week_number as number,
    stage: row.stage as string,
    scoresByAnchor: (row.scores_by_anchor ?? {}) as Record<DayAnchor, AnchorSnapshotData>,
    mistakesActive: (row.mistakes_active as string[] | null) ?? [],
    mistakesResolved: (row.mistakes_resolved as string[] | null) ?? [],
    createdAt: row.created_at as string,
  };
}
