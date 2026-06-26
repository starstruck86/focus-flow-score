/**
 * TRAIN v2 — Phase 1 read aggregator.
 *
 * Reads user_competency and groups it into the curriculum spokes / spider
 * dimensions used by the Skills radar and Progress page. NO writes. NO joins
 * against ki_mastery — the curriculum ladder is the single source of truth
 * for practice proficiency in Phase 1.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { SpiderDimensionKey } from '@/hooks/useKiProficiency';

/** Curriculum spoke → spider_dimension key used by Skills radar. */
export const SPOKE_TO_SPIDER_DIMENSION: Record<string, SpiderDimensionKey> = {
  product: 'product_knowledge',
  discovery: 'discovery',
  qualification: 'qualification',
  deal_control: 'deal_control',
  objection_handling: 'objection_handling',
  competitive: 'competitive',
  expansion: 'expansion_strategy',
  stakeholder_navigation: 'stakeholder_navigation',
  messaging: 'messaging',
  c_suite: 'c_suite_engagement',
};

export interface CompetencyRowLite {
  spoke: string;
  topic: string;
  band: number;
  sub_level: string;
  progress: number;          // 0..1
  reps: number;
  gate_passed_at: string | null;
  updated_at: string;
}

export interface CompetencyAggregateByDimension {
  /** spider_dimension key (radar axis) */
  dimension: SpiderDimensionKey;
  /** Number of sub-levels with at least one rep. */
  sub_levels_with_reps: number;
  /** Total reps across sub-levels for this dimension. */
  total_reps: number;
  /** 0..100 — average progress * 100. */
  avg_progress: number;
  /** 0..100 — max progress * 100. */
  best_progress: number;
  /** Number of sub-levels with gate_passed_at set. */
  gates_passed: number;
}

export interface CompetencySummary {
  rows: CompetencyRowLite[];
  totalReps: number;
  totalSubLevels: number;
  totalGatesPassed: number;
  byDimension: Record<SpiderDimensionKey, CompetencyAggregateByDimension>;
}

export async function fetchUserCompetencySummary(): Promise<CompetencySummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      rows: [],
      totalReps: 0,
      totalSubLevels: 0,
      totalGatesPassed: 0,
      byDimension: {} as Record<SpiderDimensionKey, CompetencyAggregateByDimension>,
    };
  }

  const { data, error } = await (supabase as any)
    .from('user_competency')
    .select('spoke, topic, band, sub_level, progress, reps, gate_passed_at, updated_at')
    .eq('user_id', user.id);
  if (error) throw error;

  const rows: CompetencyRowLite[] = (data ?? []) as CompetencyRowLite[];

  const buckets: Record<string, {
    progresses: number[];
    reps: number;
    sub_levels_with_reps: number;
    gates_passed: number;
  }> = {};

  for (const r of rows) {
    const dim = SPOKE_TO_SPIDER_DIMENSION[r.spoke];
    if (!dim) continue;
    if (!buckets[dim]) {
      buckets[dim] = { progresses: [], reps: 0, sub_levels_with_reps: 0, gates_passed: 0 };
    }
    const b = buckets[dim];
    b.progresses.push(Number(r.progress) || 0);
    b.reps += Number(r.reps) || 0;
    if ((Number(r.reps) || 0) > 0) b.sub_levels_with_reps += 1;
    if (r.gate_passed_at) b.gates_passed += 1;
  }

  const byDimension = {} as Record<SpiderDimensionKey, CompetencyAggregateByDimension>;
  for (const [dim, b] of Object.entries(buckets)) {
    const avg = b.progresses.length
      ? b.progresses.reduce((a, c) => a + c, 0) / b.progresses.length
      : 0;
    const best = b.progresses.length ? Math.max(...b.progresses) : 0;
    byDimension[dim as SpiderDimensionKey] = {
      dimension: dim as SpiderDimensionKey,
      sub_levels_with_reps: b.sub_levels_with_reps,
      total_reps: b.reps,
      avg_progress: Math.round(avg * 100),
      best_progress: Math.round(best * 100),
      gates_passed: b.gates_passed,
    };
  }

  return {
    rows,
    totalReps: rows.reduce((acc, r) => acc + (Number(r.reps) || 0), 0),
    totalSubLevels: rows.length,
    totalGatesPassed: rows.filter((r) => !!r.gate_passed_at).length,
    byDimension,
  };
}

export function useUserCompetencySummary() {
  return useQuery({
    queryKey: ['train', 'user-competency-summary'],
    queryFn: fetchUserCompetencySummary,
    staleTime: 60 * 1000,
  });
}
