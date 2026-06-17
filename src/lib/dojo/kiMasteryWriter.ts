import { supabase } from '@/integrations/supabase/client';

export async function writeKIMastery({
  userId,
  kiId,
  chapter,
  spiderDimension,
  score,
}: {
  userId: string;
  kiId: string;
  chapter: string;
  spiderDimension: string | null;
  score: number;
}) {
  const { data: existing } = await supabase
    .from('ki_mastery')
    .select('id, times_drilled, avg_score, best_score, last_drilled_at')
    .eq('user_id', userId)
    .eq('ki_id', kiId)
    .maybeSingle();

  const now = new Date().toISOString();
  const times = (existing?.times_drilled ?? 0) + 1;
  const prevAvg = Number(existing?.avg_score ?? score);
  const newAvg = Number(((prevAvg * (times - 1) + score) / times).toFixed(2));
  const bestScore = Math.max(Number(existing?.best_score ?? 0), score);
  const decayRisk = existing?.last_drilled_at
    ? (Date.now() - new Date(existing.last_drilled_at).getTime()) > 14 * 24 * 60 * 60 * 1000
    : false;

  await supabase.from('ki_mastery').upsert(
    {
      user_id: userId,
      ki_id: kiId,
      chapter,
      spider_dimension: spiderDimension,
      times_drilled: times,
      avg_score: newAvg,
      best_score: bestScore,
      last_drilled_at: now,
      first_drilled_at: existing ? undefined : now,
      decay_risk: decayRisk,
      updated_at: now,
    },
    { onConflict: 'user_id,ki_id' },
  );
}
