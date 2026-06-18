import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const SPIDER_DIMENSIONS = [
  { key: 'discovery',              label: 'Discovery',            color: '#3b82f6' },
  { key: 'internal_prospecting',   label: 'Internal Prospecting', color: '#8b5cf6' },
  { key: 'stakeholder_navigation', label: 'Stakeholder Nav',      color: '#06b6d4' },
  { key: 'messaging',              label: 'Messaging',            color: '#10b981' },
  { key: 'deal_control',           label: 'Deal Control',         color: '#f59e0b' },
  { key: 'objection_handling',     label: 'Objection Handling',   color: '#ef4444' },
  { key: 'expansion_strategy',     label: 'Expansion',            color: '#84cc16' },
  { key: 'c_suite_engagement',     label: 'C-Suite',              color: '#f97316' },
  { key: 'competitive',            label: 'Competitive',          color: '#ec4899' },
  { key: 'qualification',          label: 'Qualification',        color: '#6366f1' },
] as const;

export type SpiderDimensionKey = typeof SPIDER_DIMENSIONS[number]['key'];
export type SpiderDimension = SpiderDimensionKey;

export interface DimensionProficiency {
  dimension: SpiderDimensionKey;
  label: string;
  color: string;
  library_count: number;
  drilled_count: number;
  total_reps: number;
  avg_score: number;
  best_score: number;
  proficiency: number;
  decay_risk_count: number;
  last_drilled_at: string | null;
  call_score: number | null;   // real call performance (0-100)
  call_count: number;          // graded calls in this dimension
}

export interface KiProficiencyData {
  dimensions: DimensionProficiency[];
  total_ki_library: number;
  total_drilled: number;
  total_reps: number;
  weakest: DimensionProficiency | null;
  strongest: DimensionProficiency | null;
  decay_alerts: number;
  total_call_data: boolean;
}

export function useKiProficiency() {
  return useQuery({
    queryKey: ['ki-proficiency'],
    queryFn: async (): Promise<KiProficiencyData> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { count: total_ki_library_count } = await supabase
        .from('knowledge_items')
        .select('*', { count: 'exact', head: true })
        .eq('is_core_ae', true)
        .eq('active', true)
        .not('spider_dimension', 'is', null);

      const libQueries = SPIDER_DIMENSIONS.map(({ key }) =>
        supabase
          .from('knowledge_items')
          .select('*', { count: 'exact', head: true })
          .eq('is_core_ae', true)
          .eq('active', true)
          .eq('spider_dimension', key)
          .then(({ count }) => ({ key, count: count ?? 0 }))
      );

      const libResults = await Promise.all(libQueries);
      const libMap: Record<string, number> = {};
      for (const { key, count } of libResults) {
        libMap[key] = count;
      }

      const { data: masteryRows } = await supabase
        .from('ki_mastery')
        .select('spider_dimension, times_drilled, avg_score, best_score, decay_risk, last_drilled_at')
        .eq('user_id', user.id)
        .not('spider_dimension', 'is', null);

      const masteryMap: Record<string, {
        drilled_count: number;
        total_reps: number;
        scores: number[];
        best_scores: number[];
        decay_risk_count: number;
        last_drilled_at: string | null;
      }> = {};

      for (const row of masteryRows ?? []) {
        const dim = row.spider_dimension as string;
        if (!masteryMap[dim]) {
          masteryMap[dim] = { drilled_count: 0, total_reps: 0, scores: [], best_scores: [], decay_risk_count: 0, last_drilled_at: null };
        }
        const m = masteryMap[dim];
        m.drilled_count += 1;
        m.total_reps += row.times_drilled ?? 0;
        if (row.avg_score != null) m.scores.push(Number(row.avg_score));
        if (row.best_score != null) m.best_scores.push(Number(row.best_score));
        if (row.decay_risk) m.decay_risk_count += 1;
        if (row.last_drilled_at && (!m.last_drilled_at || row.last_drilled_at > m.last_drilled_at)) {
          m.last_drilled_at = row.last_drilled_at;
        }
      }

      const dimensions: DimensionProficiency[] = SPIDER_DIMENSIONS.map(({ key, label, color }) => {
        const lib = libMap[key] ?? 0;
        const m = masteryMap[key];

        if (!m || m.total_reps === 0) {
          return {
            dimension: key, label, color,
            library_count: lib, drilled_count: 0, total_reps: 0,
            avg_score: 0, best_score: 0, proficiency: 0,
            decay_risk_count: 0, last_drilled_at: null,
          };
        }

        const avg_score = m.scores.length > 0
          ? Math.round(m.scores.reduce((a, b) => a + b, 0) / m.scores.length)
          : 0;
        const best_score = m.best_scores.length > 0 ? Math.max(...m.best_scores) : 0;

        const breadth = Math.min(m.total_reps / 50, 1) * 100;
        const proficiency = Math.round(avg_score * 0.7 + breadth * 0.3);

        return {
          dimension: key, label, color,
          library_count: lib, drilled_count: m.drilled_count, total_reps: m.total_reps,
          avg_score, best_score, proficiency,
          decay_risk_count: m.decay_risk_count,
          last_drilled_at: m.last_drilled_at,
        };
      });

      const drilled = dimensions.filter(d => d.total_reps > 0);
      const total_ki_library = total_ki_library_count ?? 0;
      const total_drilled = dimensions.reduce((a, d) => a + d.drilled_count, 0);
      const total_reps = dimensions.reduce((a, d) => a + d.total_reps, 0);
      const decay_alerts = dimensions.reduce((a, d) => a + d.decay_risk_count, 0);

      const sorted = [...drilled].sort((a, b) => a.proficiency - b.proficiency);

      return {
        dimensions,
        total_ki_library,
        total_drilled,
        total_reps,
        weakest: sorted[0] ?? null,
        strongest: sorted[sorted.length - 1] ?? null,
        decay_alerts,
      };
    },
    staleTime: 2 * 60 * 1000,
  });
}
