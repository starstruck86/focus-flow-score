import { supabase } from '@/integrations/supabase/client';
import type { NextKIResult } from './selectNextKI';

/**
 * Selects the next Branch.io-specific KI for a given spider dimension.
 * Filters to chapter = 'branch_io' (tagged KIs from Branch.io library documents).
 * Prioritizes: least recently drilled → undrilled → random.
 */
export async function selectNextBranchKI(
  userId: string,
  spiderDimension: string,
  excludeKiId?: string | null,
): Promise<NextKIResult | null> {
  // Get recently drilled Branch KI IDs from ki_mastery (last 20)
  const { data: recentlyDrilled } = await supabase
    .from('ki_mastery')
    .select('ki_id')
    .eq('user_id', userId)
    .order('last_drilled_at', { ascending: false })
    .limit(20);

  const excludeIds = new Set<string>(
    (recentlyDrilled ?? []).map((r: any) => r.ki_id as string)
  );
  if (excludeKiId) excludeIds.add(excludeKiId);

  // Query Branch KIs for this dimension, excluding recently drilled
  const { data: candidates } = await supabase
    .from('knowledge_items')
    .select('id, title, chapter, sub_chapter, spider_dimension, tactic_summary, when_to_use, when_not_to_use, example_usage, why_it_matters, framework, confidence_score, active')
    .eq('user_id', userId)
    .eq('chapter', 'branch_io')
    .eq('spider_dimension', spiderDimension)
    .eq('active', true)
    .limit(50);

  if (!candidates?.length) {
    // Fallback: any active Branch KI in any dimension
    const { data: fallback } = await supabase
      .from('knowledge_items')
      .select('id, title, chapter, sub_chapter, spider_dimension, tactic_summary, when_to_use, when_not_to_use, example_usage, why_it_matters, framework, confidence_score, active')
      .eq('user_id', userId)
      .eq('chapter', 'branch_io')
      .eq('active', true)
      .limit(20);
    if (!fallback?.length) return null;
    const pick = fallback[Math.floor(Math.random() * fallback.length)] as any;
    return toResult(pick);
  }

  // Prefer undrilled, then least recently drilled
  const undrilled = candidates.filter((k: any) => !excludeIds.has(k.id as string));
  const pool = undrilled.length > 0 ? undrilled : candidates;
  const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 10))] as any;
  return toResult(pick);
}

function toResult(row: any): NextKIResult {
  return {
    id: row.id,
    title: row.title ?? '',
    chapter: row.chapter ?? 'branch_io',
    sub_chapter: row.sub_chapter ?? null,
    spider_dimension: row.spider_dimension ?? null,
    tactic_summary: row.tactic_summary ?? '',
    when_to_use: row.when_to_use ?? null,
    when_not_to_use: row.when_not_to_use ?? null,
    example_usage: row.example_usage ?? null,
    why_it_matters: row.why_it_matters ?? null,
    framework: row.framework ?? null,
    confidence_score: row.confidence_score ?? null,
    active: row.active ?? true,
    macro_situation: null,
    micro_strategy: null,
    how_to_execute: null,
    what_this_unlocks: null,
    who: null,
  };
}
