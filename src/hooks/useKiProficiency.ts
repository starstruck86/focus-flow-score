import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SPOKE_TO_SPIDER_DIMENSION } from '@/lib/train/competencyRead';

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
  { key: 'product_knowledge',      label: 'Product Knowledge',    color: '#0ea5e9' },
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
  trend: 'up' | 'down' | 'flat' | null;
  stagnant: boolean;
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

      // Phase 1: practice proficiency comes from user_competency (the
      // curriculum ladder) — the single source of truth. We aggregate
      // user_competency rows per curriculum spoke and project them onto the
      // spider_dimension axes used by the radar via SPOKE_TO_SPIDER_DIMENSION.
      const { data: compRows } = await (supabase as any)
        .from('user_competency')
        .select('spoke, reps, progress, gate_passed_at, updated_at')
        .eq('user_id', user.id);

      // Real call performance per dimension (from graded transcripts) — unchanged.
      const { data: dimScores } = await (supabase as any)
        .from('dimension_scores')
        .select('spider_dimension, avg_score_100, call_count')
        .eq('user_id', user.id);

      const dimScoreMap: Record<string, number> = {};
      const callCountMap: Record<string, number> = {};
      (dimScores ?? []).forEach((row: any) => {
        if (row?.avg_score_100 != null) {
          dimScoreMap[row.spider_dimension] = Number(row.avg_score_100) || 0;
        }
        callCountMap[row.spider_dimension] = Number(row.call_count) || 0;
      });

      // Phase 1: no trend / decay yet from user_competency. Trends will be
      // computed off updated_at history once the ladder accumulates data.
      const trendMap: Record<string, 'up' | 'down' | 'flat' | null> = {};
      const stagnantMap: Record<string, boolean> = {};
      SPIDER_DIMENSIONS.forEach(dim => {
        trendMap[dim.key] = null;
        stagnantMap[dim.key] = false;
      });

      const masteryMap: Record<string, {
        drilled_count: number;
        total_reps: number;
        scores: number[];
        best_scores: number[];
        decay_risk_count: number;
        last_drilled_at: string | null;
      }> = {};

      for (const row of (compRows as any[]) ?? []) {
        const dim = SPOKE_TO_SPIDER_DIMENSION[row.spoke as string];
        if (!dim) continue;
        if (!masteryMap[dim]) {
          masteryMap[dim] = {
            drilled_count: 0,
            total_reps: 0,
            scores: [],
            best_scores: [],
            decay_risk_count: 0,
            last_drilled_at: null,
          };
        }
        const m = masteryMap[dim];
        const reps = Number(row.reps) || 0;
        const progressPct = Math.round((Number(row.progress) || 0) * 100);
        if (reps > 0) m.drilled_count += 1;
        m.total_reps += reps;
        if (reps > 0) {
          m.scores.push(progressPct);
          m.best_scores.push(progressPct);
        }
        if (row.updated_at && (!m.last_drilled_at || row.updated_at > m.last_drilled_at)) {
          m.last_drilled_at = row.updated_at;
        }
      }

      const dimensions: DimensionProficiency[] = SPIDER_DIMENSIONS.map(({ key, label, color }) => {
        const lib = libMap[key] ?? 0;
        const m = masteryMap[key];
        const call_score = dimScoreMap[key] ?? null;
        const call_count = callCountMap[key] ?? 0;

        if (!m || m.total_reps === 0) {
          return {
            dimension: key, label, color,
            library_count: lib, drilled_count: 0, total_reps: 0,
            avg_score: 0, best_score: 0, proficiency: 0,
            decay_risk_count: 0, last_drilled_at: null,
            call_score, call_count,
            trend: trendMap[key] ?? null,
            stagnant: stagnantMap[key] ?? false,
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
          call_score, call_count,
          trend: trendMap[key] ?? null,
          stagnant: stagnantMap[key] ?? false,
        };
      });

      const drilled = dimensions.filter(d => d.total_reps > 0);
      const total_ki_library = total_ki_library_count ?? 0;
      const total_drilled = dimensions.reduce((a, d) => a + d.drilled_count, 0);
      const total_reps = dimensions.reduce((a, d) => a + d.total_reps, 0);
      const decay_alerts = dimensions.reduce((a, d) => a + d.decay_risk_count, 0);
      const total_call_data = dimensions.some(d => d.call_score != null);

      const sorted = [...drilled].sort((a, b) => a.proficiency - b.proficiency);

      return {
        dimensions,
        total_ki_library,
        total_drilled,
        total_reps,
        weakest: sorted[0] ?? null,
        strongest: sorted[sorted.length - 1] ?? null,
        decay_alerts,
        total_call_data,
      };
    },
    staleTime: 2 * 60 * 1000,
  });
}
