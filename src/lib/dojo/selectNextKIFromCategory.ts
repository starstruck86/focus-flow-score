import { supabase } from '@/integrations/supabase/client';
import type { NextKIResult } from './selectNextKI';

/**
 * Selects the next KI to drill from any chapter(s).
 * Used when drilling from non-Branch intelligence categories.
 * Respects recently drilled (via ki_mastery) and sorts by confidence_score DESC.
 */
export async function selectNextKIFromCategory(
  userId: string,
  chapters: string[],
  options?: {
    spiderDimension?: string | null;
    excludeKiId?: string | null;
    intelligenceType?: string | null;
  }
): Promise<NextKIResult | null> {
  if (!chapters.length) return null;

  const { data: recentlyDrilled } = await supabase
    .from('ki_mastery')
    .select('ki_id')
    .eq('user_id', userId)
    .order('last_drilled_at', { ascending: false })
    .limit(30);

  const excludeIds = new Set<string>(
    (recentlyDrilled ?? []).map((r: any) => r.ki_id as string)
  );
  if (options?.excludeKiId) excludeIds.add(options.excludeKiId);

  let q = supabase
    .from('knowledge_items')
    .select('id, title, chapter, sub_chapter, spider_dimension, intelligence_type, tactic_summary, when_to_use, when_not_to_use, example_usage, why_it_matters, framework, confidence_score, active')
    .eq('user_id', userId)
    .in('chapter', chapters)
    .eq('active', true)
    .order('confidence_score', { ascending: false })
    .limit(50);

  if (options?.spiderDimension) q = q.eq('spider_dimension', options.spiderDimension);
  if (options?.intelligenceType) q = q.eq('intelligence_type', options.intelligenceType);

  const { data: candidates } = await q;

  if (!candidates?.length) return null;

  const undrilled = candidates.filter((k: any) => !excludeIds.has(k.id as string));
  const pool = undrilled.length > 0 ? undrilled : candidates;
  const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 10))] as any;

  return {
    id: pick.id,
    title: pick.title ?? '',
    chapter: pick.chapter ?? '',
    sub_chapter: pick.sub_chapter ?? null,
    spider_dimension: pick.spider_dimension ?? null,
    tactic_summary: pick.tactic_summary ?? '',
    when_to_use: pick.when_to_use ?? null,
    when_not_to_use: pick.when_not_to_use ?? null,
    example_usage: pick.example_usage ?? null,
    why_it_matters: pick.why_it_matters ?? null,
    framework: pick.framework ?? null,
    confidence_score: pick.confidence_score ?? null,
    active: pick.active ?? true,
    macro_situation: null,
    micro_strategy: null,
    how_to_execute: null,
    what_this_unlocks: null,
    who: null,
  };
}
