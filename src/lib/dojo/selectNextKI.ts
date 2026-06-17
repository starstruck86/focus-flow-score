import { supabase } from '@/integrations/supabase/client';

export interface NextKIResult {
  id: string;
  chapter: string;
  spider_dimension: string | null;
  tactic_summary: string;
  macro_situation: string | null;
  micro_strategy: string | null;
  when_to_use: string | null;
  when_not_to_use: string | null;
  how_to_execute: string | null;
  example_usage: string | null;
  why_it_matters: string | null;
  what_this_unlocks: string | null;
  framework: string | null;
  who: string | null;
}

/**
 * Fetches the next KI to drill for a given spider dimension.
 * Server-side priority: decaying → undrilled → lowest score.
 * No large IN-clause string building.
 */
export async function selectNextKI(
  userId: string,
  spiderDimension: string,
  excludeKiId?: string | null,
): Promise<NextKIResult | null> {
  const { data, error } = await supabase.rpc('get_next_ki_for_dimension', {
    p_user_id: userId,
    p_spider_dimension: spiderDimension,
    p_exclude_ki_id: excludeKiId ?? null,
  });

  if (error) {
    console.error('[selectNextKI] RPC error:', error);
    return null;
  }

  const rows = data as NextKIResult[] | null;
  return rows?.[0] ?? null;
}
