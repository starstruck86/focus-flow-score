/**
 * TRAIN v2 — Phase 1 shared competency writer.
 *
 * Single entry point for any surface that needs to advance the curriculum
 * ladder (user_competency). Wraps incrementSubLevelRep so the progress /
 * reps / gate_passed_at math is IDENTICAL to the TRAIN v2 atom flow — this
 * module ONLY centralises *where* the write happens.
 *
 * Phase 1 caller: src/lib/train/engine.ts (runPracticeRep).
 * Other surfaces will be repointed in later phases.
 */

import { supabase } from '@/integrations/supabase/client';
import { incrementSubLevelRep } from './competency';
import type { Band, UserCompetencyRow } from '@/types/train';

export interface RecordCompetencyRepInput {
  spoke: string;
  topic: string;
  band: Band;
  subLevel: string;
  score: number;          // 0..100, per-rep score
  /** When true, force gate_passed_at on this upsert even if progress < 1.
   *  TRAIN v2 atom path leaves this undefined and relies on progress→1. */
  passedGate?: boolean;
  /** Explicit user override (server contexts). Falls back to auth session. */
  userId?: string;
}

export async function recordCompetencyRep(
  input: RecordCompetencyRepInput,
): Promise<UserCompetencyRow> {
  let userId = input.userId;
  if (!userId) {
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id;
  }
  if (!userId) {
    throw new Error('recordCompetencyRep: no authenticated user');
  }

  const row = await incrementSubLevelRep({
    userId,
    spoke: input.spoke,
    topic: input.topic,
    band: input.band,
    subLevel: input.subLevel,
    score: input.score,
    // No longer used — required passes are a fixed constant in competency.ts.
    drillCountInSubLevel: 0,
  });

  // Optional forced gate stamp — used by callers that already know a gate
  // was cleared (e.g. a future band-gate-completion bridge). Idempotent.
  if (input.passedGate && !row.gate_passed_at) {
    const nowIso = new Date().toISOString();
    const { data, error } = await (supabase as any)
      .from('user_competency')
      .upsert(
        {
          user_id: userId,
          spoke: input.spoke,
          topic: input.topic,
          band: input.band,
          sub_level: input.subLevel,
          progress: 1,
          reps: row.reps,
          gate_passed_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'user_id,spoke,topic,sub_level' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as UserCompetencyRow;
  }

  return row;
}
