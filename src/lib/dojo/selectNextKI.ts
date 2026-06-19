import { supabase } from '@/integrations/supabase/client';

export interface NextKIResult {
  id: string;
  title: string;
  chapter: string;
  sub_chapter: string | null;
  spider_dimension: string | null;
  tactic_summary: string;
  when_to_use: string | null;
  when_not_to_use: string | null;
  example_usage: string | null;
  why_it_matters: string | null;
  framework: string | null;
  confidence_score: number | null;
  active: boolean;
  // Legacy fields no longer returned by the RPC — kept optional so callers compile
  macro_situation?: string | null;
  micro_strategy?: string | null;
  how_to_execute?: string | null;
  what_this_unlocks?: string | null;
  who?: string | null;
}

/**
 * Fetches the next KI to drill for a given spider dimension.
 * Server-side adaptive difficulty: filters confidence_score band based on
 * rolling 10-rep avg for the dimension (advanced >70, foundational <50).
 * Then prioritizes: decaying → undrilled → lowest score.
 */
export async function selectNextKI(
  userId: string,
  spiderDimension: string,
  excludeKiId?: string | null,
): Promise<NextKIResult | null> {
  const { data, error } = await supabase.rpc('get_next_ki_for_dimension', {
    p_user_id: userId,
    p_spider_dimension: spiderDimension,
    p_limit: excludeKiId ? 5 : 1,
  });

  if (error) {
    console.error('[selectNextKI] RPC error:', error);
    return null;
  }

  const rows = (data as unknown as NextKIResult[]) ?? [];
  const filtered = excludeKiId ? rows.filter(r => r.id !== excludeKiId) : rows;
  return filtered[0] ?? null;
}
