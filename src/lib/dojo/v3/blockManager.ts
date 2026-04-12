/**
 * V3 Block Manager
 *
 * Manages 8-week training blocks.
 * Weeks advance when all 5 unique weekday anchors are completed, NOT on session count.
 * Phase is derived deterministically from week number.
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────────────

export type BlockPhase = 'benchmark' | 'foundation' | 'build' | 'peak' | 'retest';
export type BlockStage = 'foundation' | 'integration' | 'enterprise';
export type BlockStatus = 'active' | 'completed';

export interface TrainingBlock {
  id: string;
  userId: string;
  blockNumber: number;
  startDate: string;
  currentWeek: number;
  phase: BlockPhase;
  stage: BlockStage;
  status: BlockStatus;
  completedSessionsThisWeek: number;
  benchmarkSnapshot: BlockSnapshot | null;
  retestSnapshot: BlockSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlockSnapshot {
  [anchor: string]: {
    avgScore: number;
    topMistake: string | null;
    focusAppliedRate: number;
  };
}

// ── Phase Derivation ──────────────────────────────────────────────

export function derivePhase(week: number): BlockPhase {
  if (week === 1) return 'benchmark';
  if (week <= 3) return 'foundation';
  if (week <= 5) return 'build';
  if (week <= 7) return 'peak';
  return 'retest'; // week 8
}

// ── Stage Gate Logic ──────────────────────────────────────────────
// Stage gates use: average score + coverage + persistent-mistake reduction
// NOT average score alone.

export interface StageGateInput {
  avgScoreAllAnchors: number;
  anchorsWithReps: number;       // out of 5
  persistentMistakeCount: number; // currently active persistent mistakes
  totalReps: number;
}

export function evaluateStageGate(current: BlockStage, input: StageGateInput): BlockStage {
  if (current === 'enterprise') return 'enterprise';

  if (current === 'foundation') {
    // Foundation → Integration requires:
    // avg ≥ 60, all 5 anchors practiced, ≤ 3 persistent mistakes, ≥ 40 total reps
    if (
      input.avgScoreAllAnchors >= 60 &&
      input.anchorsWithReps >= 5 &&
      input.persistentMistakeCount <= 3 &&
      input.totalReps >= 40
    ) {
      return 'integration';
    }
    return 'foundation';
  }

  if (current === 'integration') {
    // Integration → Enterprise requires:
    // avg ≥ 75, all 5 anchors, ≤ 1 persistent mistake, ≥ 80 total reps
    if (
      input.avgScoreAllAnchors >= 75 &&
      input.anchorsWithReps >= 5 &&
      input.persistentMistakeCount <= 1 &&
      input.totalReps >= 80
    ) {
      return 'enterprise';
    }
    return 'integration';
  }

  return current;
}

// ── Block CRUD ────────────────────────────────────────────────────

/** Get or create the active training block for a user */
export async function getOrCreateActiveBlock(userId: string): Promise<TrainingBlock> {
  // Try to find active block
  const { data: existing } = await supabase
    .from('training_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('block_number', { ascending: false })
    .limit(1)
    .single();

  if (existing) return mapBlock(existing);

  // Find the highest block number for this user
  const { data: lastBlock } = await supabase
    .from('training_blocks')
    .select('block_number')
    .eq('user_id', userId)
    .order('block_number', { ascending: false })
    .limit(1)
    .single();

  const nextNumber = (lastBlock?.block_number ?? 0) + 1;

  // Align start_date to the most recent Monday (or today if Monday)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  const startDate = monday.toISOString().split('T')[0];

  const { data: created, error } = await supabase
    .from('training_blocks')
    .insert({
      user_id: userId,
      block_number: nextNumber,
      start_date: startDate,
      current_week: 1,
      phase: 'benchmark',
      stage: 'foundation',
      status: 'active',
      completed_sessions_this_week: 0,
    })
    .select()
    .single();

  if (error || !created) {
    throw new Error(`Failed to create training block: ${error?.message}`);
  }

  return mapBlock(created);
}

/**
 * Advance the block to the next week.
 * Called by assignmentManager when all 5 unique anchors are completed.
 */
export async function advanceWeek(
  blockId: string,
  stageGateInput?: StageGateInput,
): Promise<TrainingBlock> {
  const { data: block, error: fetchErr } = await supabase
    .from('training_blocks')
    .select('*')
    .eq('id', blockId)
    .single();

  if (fetchErr || !block) throw new Error('Block not found');

  const nextWeek = block.current_week + 1;

  if (nextWeek > 8) {
    // Block complete
    const { data: updated } = await supabase
      .from('training_blocks')
      .update({ status: 'completed' })
      .eq('id', blockId)
      .select()
      .single();
    return mapBlock(updated!);
  }

  const nextPhase = derivePhase(nextWeek);

  // Check stage gate at week boundaries
  let nextStage = block.stage as BlockStage;
  if (stageGateInput) {
    nextStage = evaluateStageGate(nextStage, stageGateInput);
  }

  const { data: updated } = await supabase
    .from('training_blocks')
    .update({
      current_week: nextWeek,
      phase: nextPhase,
      stage: nextStage,
      completed_sessions_this_week: 0, // reset for new week
    })
    .eq('id', blockId)
    .select()
    .single();

  return mapBlock(updated!);
}

/** Save a benchmark or retest snapshot to the block */
export async function saveBlockSnapshot(
  blockId: string,
  snapshotType: 'benchmark' | 'retest',
  snapshot: BlockSnapshot,
): Promise<void> {
  const field = snapshotType === 'benchmark' ? 'benchmark_snapshot' : 'retest_snapshot';
  await supabase
    .from('training_blocks')
    .update({ [field]: snapshot })
    .eq('id', blockId);
}

// ── Mapping ───────────────────────────────────────────────────────

function mapBlock(row: Record<string, unknown>): TrainingBlock {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    blockNumber: row.block_number as number,
    startDate: row.start_date as string,
    currentWeek: row.current_week as number,
    phase: row.phase as BlockPhase,
    stage: row.stage as BlockStage,
    status: row.status as BlockStatus,
    completedSessionsThisWeek: row.completed_sessions_this_week as number,
    benchmarkSnapshot: row.benchmark_snapshot as BlockSnapshot | null,
    retestSnapshot: row.retest_snapshot as BlockSnapshot | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
