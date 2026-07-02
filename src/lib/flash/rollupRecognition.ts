import { supabase } from '@/integrations/supabase/client';

/**
 * Flash → ki_mastery recognition/awareness rollup.
 *
 * This writer is deliberately SEPARATE from src/lib/dojo/kiMasteryWriter.ts.
 * It ONLY updates recognition_score and awareness_score (and updated_at).
 *
 * HARD RULE: never touch next_review_at, decay_risk, times_drilled,
 * avg_score, best_score, or execution_score from this path — those belong
 * exclusively to the drill writer (kiMasteryWriter). Flash card scheduling
 * lives on flashcard_state.due_at, not ki_mastery.
 */
export async function rollupRecognition({
  userId,
  kiId,
  confidence,
}: {
  userId: string;
  kiId: string;
  confidence: 1 | 2 | 3 | 4 | 5;
}): Promise<void> {
  const signal = confidence * 20; // 20..100

  // Row-resolution pattern mirrors kiMasteryWriter: lookup by (user_id, ki_id).
  const { data: existing } = await supabase
    .from('ki_mastery')
    .select('id, recognition_score, awareness_score')
    .eq('user_id', userId)
    .eq('ki_id', kiId)
    .maybeSingle();

  const prevRec = existing?.recognition_score ?? null;
  const nextRec = prevRec == null ? signal : Math.round(0.6 * Number(prevRec) + 0.4 * signal);
  const prevAware = existing?.awareness_score ?? 0;
  const nextAware = Math.max(Number(prevAware ?? 0), signal);
  const now = new Date().toISOString();

  await supabase.from('ki_mastery').upsert(
    {
      user_id: userId,
      ki_id: kiId,
      recognition_score: nextRec,
      awareness_score: nextAware,
      updated_at: now,
    },
    { onConflict: 'user_id,ki_id' },
  );
}
