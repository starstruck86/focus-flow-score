/**
 * TRAIN v2 — Stage D competency writes.
 * Upserts user_competency and user_band_gate per Plan §D defaults.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  TRAIN_TUNABLES,
  type Band,
  type BandGateAttempt,
  type UserBandGateRow,
  type UserCompetencyRow,
} from '@/types/train';

interface RepInput {
  userId: string;
  spoke: string;
  topic: string;
  band: Band;
  subLevel: string;
  score: number;              // 0..100
  drillCountInSubLevel: number;
}

/**
 * Record one practice rep against a sub-level.
 * progress = min(1, passingReps / requiredPasses)
 * requiredPasses = max(floor, drillCountInSubLevel)
 */
export async function incrementSubLevelRep(input: RepInput): Promise<UserCompetencyRow> {
  const { userId, spoke, topic, band, subLevel, score, drillCountInSubLevel } = input;

  const { data: existing } = await (supabase as any)
    .from('user_competency')
    .select('*')
    .eq('user_id', userId)
    .eq('spoke', spoke)
    .eq('topic', topic)
    .eq('sub_level', subLevel)
    .maybeSingle();

  const prevReps = Number(existing?.reps ?? 0);
  const prevProgress = Number(existing?.progress ?? 0);
  // Required = designed constant (e.g. 3). drillCountInSubLevel is AVAILABLE reps, not REQUIRED.
  const required = TRAIN_TUNABLES.subLevelRequiredPasses;

  const passed = score >= TRAIN_TUNABLES.subLevelPassThreshold ? 1 : 0;
  const passingRepsApprox = Math.round(prevProgress * required) + passed;
  const nextProgress = Math.min(1, passingRepsApprox / required);

  const nextReps = prevReps + 1;
  const alreadyPassed = !!existing?.gate_passed_at;
  const newlyPassed = !alreadyPassed && nextProgress >= 1;

  const payload = {
    user_id: userId,
    spoke,
    topic,
    band,
    sub_level: subLevel,
    progress: nextProgress,
    reps: nextReps,
    gate_passed_at: alreadyPassed
      ? existing!.gate_passed_at
      : newlyPassed
        ? new Date().toISOString()
        : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await (supabase as any)
    .from('user_competency')
    .upsert(payload, { onConflict: 'user_id,spoke,topic,sub_level' })
    .select('*')
    .single();
  if (error) throw error;
  return data as UserCompetencyRow;
}

interface BandGateInput {
  userId: string;
  spoke: string;
  topic: string;
  band: Band;
  attempt: BandGateAttempt;
  passThreshold: number;
  promotesTo: Band | null;
}

/**
 * Retest interval (Plan §D ruling 4 — simplified):
 *   pass (avg ≥ bandGatePassThreshold) → retestPassDays (30d)
 *   fail (avg < bandGatePassThreshold) → 0 (immediate retake)
 * No intermediate tier — a pass is always ≥ threshold by definition.
 */
function retestDays(passed: boolean): number {
  return passed ? TRAIN_TUNABLES.retestPassDays : 0;
}

/**
 * Record a band gate attempt. On pass: write passed_at + next_retest_due,
 * and bump the next band to 'available'.
 */
export async function recordBandGateAttempt(input: BandGateInput): Promise<UserBandGateRow> {
  const { userId, spoke, topic, band, attempt, promotesTo } = input;
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: existing } = await (supabase as any)
    .from('user_band_gate')
    .select('*')
    .eq('user_id', userId)
    .eq('spoke', spoke)
    .eq('topic', topic)
    .eq('band', band)
    .maybeSingle();

  const prevBest = Number(existing?.best_score ?? 0);
  const nextBest = Math.max(prevBest, attempt.avgScore);
  const passed = attempt.passed;
  const days = retestDays(passed);
  const nextRetestDue = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const payload = {
    user_id: userId,
    spoke,
    topic,
    band,
    status: passed ? 'passed' : 'failed',
    attempts: Number(existing?.attempts ?? 0) + 1,
    best_score: nextBest,
    passed_at: passed ? (existing?.passed_at ?? nowIso) : (existing?.passed_at ?? null),
    last_attempt_at: nowIso,
    next_retest_due: nextRetestDue,
    updated_at: nowIso,
  };

  const { data, error } = await (supabase as any)
    .from('user_band_gate')
    .upsert(payload, { onConflict: 'user_id,spoke,topic,band' })
    .select('*')
    .single();
  if (error) throw error;

  // Promote next band → available (idempotent)
  if (passed && promotesTo) {
    await (supabase as any)
      .from('user_band_gate')
      .upsert(
        {
          user_id: userId,
          spoke,
          topic,
          band: promotesTo,
          status: 'available',
          attempts: 0,
          best_score: null,
          passed_at: null,
          last_attempt_at: null,
          next_retest_due: null,
          updated_at: nowIso,
        },
        { onConflict: 'user_id,spoke,topic,band', ignoreDuplicates: true },
      );
  }

  return data as UserBandGateRow;
}

/** Compute aggregate from per-item scores. */
export function summarizeBandGate(itemScores: number[], passThreshold: number): BandGateAttempt {
  const avg =
    itemScores.length === 0
      ? 0
      : Math.round(itemScores.reduce((a, b) => a + b, 0) / itemScores.length);
  return {
    band: 1, // caller overrides
    itemScores,
    avgScore: avg,
    passed: avg >= passThreshold,
  };
}
