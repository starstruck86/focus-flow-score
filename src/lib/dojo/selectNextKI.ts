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
  // Legacy fields no longer returned by the RPC — kept for compatibility
  // with downstream consumers (e.g. KnowledgeItemForDrill).
  macro_situation: string | null;
  micro_strategy: string | null;
  how_to_execute: string | null;
  what_this_unlocks: string | null;
  who: string | null;
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

  const rows = ((data as unknown) as Array<Record<string, unknown>>) ?? [];
  const filtered = excludeKiId ? rows.filter(r => r.id !== excludeKiId) : rows;
  const row = filtered[0];
  if (!row) return null;

  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    chapter: (row.chapter as string) ?? '',
    sub_chapter: (row.sub_chapter as string | null) ?? null,
    spider_dimension: (row.spider_dimension as string | null) ?? null,
    tactic_summary: (row.tactic_summary as string) ?? '',
    when_to_use: (row.when_to_use as string | null) ?? null,
    when_not_to_use: (row.when_not_to_use as string | null) ?? null,
    example_usage: (row.example_usage as string | null) ?? null,
    why_it_matters: (row.why_it_matters as string | null) ?? null,
    framework: (row.framework as string | null) ?? null,
    confidence_score: (row.confidence_score as number | null) ?? null,
    active: (row.active as boolean) ?? true,
    macro_situation: null,
    micro_strategy: null,
    how_to_execute: null,
    what_this_unlocks: null,
    who: null,
  };
}

