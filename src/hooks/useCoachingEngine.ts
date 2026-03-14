// Hooks for AI Coaching Engine: Conversion Math, Pipeline Hygiene, Battle Plans
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// --- Conversion Benchmarks ---
export function useConversionBenchmarks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['conversion-benchmarks', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversion_benchmarks')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useUpsertBenchmarks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (benchmarks: {
      dials_to_connect_rate: number;
      connect_to_meeting_rate: number;
      meeting_to_opp_rate: number;
      opp_to_close_rate: number;
      avg_new_logo_arr: number;
      avg_renewal_arr: number;
      avg_sales_cycle_days: number;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('conversion_benchmarks')
        .upsert({ user_id: user.id, ...benchmarks, source: 'manual' }, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversion-benchmarks'] });
      qc.invalidateQueries({ queryKey: ['conversion-math'] });
      toast.success('Conversion benchmarks saved');
    },
  });
}

// --- Conversion Math Engine ---
export function useConversionMath() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['conversion-math', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('conversion-math');
      if (error) throw error;
      return data as {
        quota: { newArrQuota: number; renewalArrQuota: number; newArrClosed: number; renewalArrClosed: number; newArrGap: number; renewalArrGap: number; totalGap: number; newArrAttainment: number; renewalArrAttainment: number };
        timeline: { daysRemaining: number; weeksRemaining: number; workdaysRemaining: number; fyEnd: string };
        funnel: {
          benchmarks: { dialsToConnect: number; connectToMeeting: number; meetingToOpp: number; oppToClose: number; avgDealSize: number };
          totalNeeded: { deals: number; opps: number; meetings: number; connects: number; dials: number };
          weeklyTargets: { deals: number; opps: number; meetings: number };
          dailyTargets: { dials: number; connects: number };
        };
        pace: {
          actual: { dialsPerDay: number; conversationsPerDay: number; meetingsPerWeek: number; oppsPerWeek: number };
          required: { dialsPerDay: number; connectsPerDay: number; meetingsPerWeek: number; oppsPerWeek: number };
          gaps: { dialGap: number; meetingGap: number };
          onPace: boolean;
          dataPoints: number;
        };
        pipeline: { activePipelineArr: number; pipelineCoverage: number; coverageHealthy: boolean; activeDeals: number };
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });
}

// --- Pipeline Hygiene ---
export function usePipelineHygiene() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pipeline-hygiene', user?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      // Try cached scan first
      const { data: cached } = await supabase
        .from('pipeline_hygiene_scans')
        .select('*')
        .eq('scan_date', today)
        .maybeSingle();
      if (cached) return cached;
      // Run fresh scan
      const { data, error } = await supabase.functions.invoke('pipeline-hygiene');
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRunHygieneScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('pipeline-hygiene');
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-hygiene'] });
      toast.success('Pipeline scan complete');
    },
    onError: (err: Error) => {
      toast.error('Pipeline scan failed', { description: err.message });
    },
  });
}

// --- Weekly Battle Plan ---
export function useWeeklyBattlePlan() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['weekly-battle-plan', user?.id],
    queryFn: async () => {
      // Get current week's Monday
      const now = new Date();
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      const weekStart = monday.toISOString().split('T')[0];

      const { data: cached } = await supabase
        .from('weekly_battle_plans')
        .select('*')
        .eq('week_start', weekStart)
        .maybeSingle();
      if (cached) return cached;
      return null;
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });
}

export function useGenerateBattlePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('weekly-battle-plan');
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-battle-plan'] });
      toast.success('Battle plan generated');
    },
    onError: (err: Error) => {
      toast.error('Failed to generate battle plan', { description: err.message });
    },
  });
}

export function useCompleteBattleMove() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, moveIndex }: { planId: string; moveIndex: number }) => {
      // Get current plan
      const { data: plan } = await supabase
        .from('weekly_battle_plans')
        .select('moves_completed')
        .eq('id', planId)
        .single();
      if (!plan) throw new Error('Plan not found');
      const completed = (plan.moves_completed as number[]) || [];
      const updated = completed.includes(moveIndex)
        ? completed.filter((i: number) => i !== moveIndex)
        : [...completed, moveIndex];
      const { error } = await supabase
        .from('weekly_battle_plans')
        .update({ moves_completed: updated })
        .eq('id', planId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-battle-plan'] }),
  });
}
