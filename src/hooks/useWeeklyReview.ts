import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { startOfWeek, endOfWeek, format } from 'date-fns';

export interface WeeklyReview {
  id: string;
  userId: string;
  weekStart: string;
  weekEnd: string;
  totalDials: number;
  totalConversations: number;
  totalMeetingsSet: number;
  totalMeetingsHeld: number;
  totalOppsCreated: number;
  totalProspectsAdded: number;
  totalPipelineMoved: number;
  daysLogged: number;
  daysGoalMet: number;
  avgDailyScore: number;
  avgSentiment: number | null;
  biggestWin: string;
  biggestFailure: string;
  failureChangePlan: string;
  commitmentForWeek: string;
  keyGoals: string[];
  keyClientMeetings: string;
  skillDevelopment: string;
  northStarGoals: string[];
  completed: boolean;
  completedAt: string | null;
}

function mapRow(row: any): WeeklyReview {
  return {
    id: row.id,
    userId: row.user_id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    totalDials: row.total_dials || 0,
    totalConversations: row.total_conversations || 0,
    totalMeetingsSet: row.total_meetings_set || 0,
    totalMeetingsHeld: row.total_meetings_held || 0,
    totalOppsCreated: row.total_opps_created || 0,
    totalProspectsAdded: row.total_prospects_added || 0,
    totalPipelineMoved: Number(row.total_pipeline_moved) || 0,
    daysLogged: row.days_logged || 0,
    daysGoalMet: row.days_goal_met || 0,
    avgDailyScore: Number(row.avg_daily_score) || 0,
    avgSentiment: row.avg_sentiment != null ? Number(row.avg_sentiment) : null,
    biggestWin: row.biggest_win || '',
    biggestFailure: row.biggest_failure || '',
    failureChangePlan: row.failure_change_plan || '',
    commitmentForWeek: row.commitment_for_week || '',
    keyGoals: Array.isArray(row.key_goals) ? row.key_goals : [],
    keyClientMeetings: row.key_client_meetings || '',
    skillDevelopment: row.skill_development || '',
    northStarGoals: Array.isArray(row.north_star_goals) ? row.north_star_goals : [],
    completed: row.completed,
    completedAt: row.completed_at,
  };
}

export function getCurrentWeekRange() {
  const now = new Date();
  const ws = startOfWeek(now, { weekStartsOn: 1 });
  const we = endOfWeek(now, { weekStartsOn: 1 });
  return { weekStart: format(ws, 'yyyy-MM-dd'), weekEnd: format(we, 'yyyy-MM-dd') };
}

export function useCurrentWeekReview() {
  const { user } = useAuth();
  const { weekStart } = getCurrentWeekRange();

  return useQuery({
    queryKey: ['weekly-review', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_reviews')
        .select('*')
        .eq('week_start', weekStart)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data) : null;
    },
    enabled: !!user,
  });
}

export function usePreviousWeekReview() {
  const { user } = useAuth();
  const { weekStart } = getCurrentWeekRange();
  const prevWeekStart = format(new Date(new Date(weekStart).getTime() - 7 * 86400000), 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['weekly-review', prevWeekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_reviews')
        .select('*')
        .eq('week_start', prevWeekStart)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data) : null;
    },
    enabled: !!user,
  });
}

  const { user } = useAuth();
  const { weekStart, weekEnd } = getCurrentWeekRange();

  return useQuery({
    queryKey: ['weekly-metrics-agg', weekStart],
    queryFn: async () => {
      // Get last week's journal entries
      const lastWeekStart = format(new Date(new Date(weekStart).getTime() - 7 * 86400000), 'yyyy-MM-dd');
      const lastWeekEnd = format(new Date(new Date(weekStart).getTime() - 86400000), 'yyyy-MM-dd');

      const { data: entries } = await supabase
        .from('daily_journal_entries')
        .select('dials, conversations, meetings_set, customer_meetings_held, opportunities_created, prospects_added, pipeline_moved, daily_score, goal_met, sentiment_score')
        .gte('date', lastWeekStart)
        .lte('date', lastWeekEnd);

      const rows = entries || [];
      return {
        totalDials: rows.reduce((s, r) => s + (r.dials || 0), 0),
        totalConversations: rows.reduce((s, r) => s + (r.conversations || 0), 0),
        totalMeetingsSet: rows.reduce((s, r) => s + (r.meetings_set || 0), 0),
        totalMeetingsHeld: rows.reduce((s, r) => s + (r.customer_meetings_held || 0), 0),
        totalOppsCreated: rows.reduce((s, r) => s + (r.opportunities_created || 0), 0),
        totalProspectsAdded: rows.reduce((s, r) => s + (r.prospects_added || 0), 0),
        totalPipelineMoved: rows.reduce((s, r) => s + (Number(r.pipeline_moved) || 0), 0),
        daysLogged: rows.length,
        daysGoalMet: rows.filter(r => r.goal_met).length,
        avgDailyScore: rows.length > 0 ? rows.reduce((s, r) => s + (r.daily_score || 0), 0) / rows.length : 0,
        avgSentiment: rows.filter(r => r.sentiment_score != null).length > 0
          ? rows.filter(r => r.sentiment_score != null).reduce((s, r) => s + Number(r.sentiment_score), 0) / rows.filter(r => r.sentiment_score != null).length
          : null,
      };
    },
    enabled: !!user,
  });
}

export function usePipelineForReview() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['pipeline-for-review'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, name, arr, stage, next_step, status')
        .eq('status', 'active')
        .order('stage', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}

export function useRenewalsForReview() {
  const { user } = useAuth();
  const now = new Date();
  // Current fiscal quarter (Jan-based): Q1=Jan-Mar, Q2=Apr-Jun, etc.
  const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
  const qStart = format(new Date(now.getFullYear(), quarterMonth, 1), 'yyyy-MM-dd');
  const qEnd = format(new Date(now.getFullYear(), quarterMonth + 3, 0), 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['renewals-for-review', qStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('renewals')
        .select('id, account_name, arr, csm, renewal_due, churn_risk, renewal_stage')
        .gte('renewal_due', qStart)
        .lte('renewal_due', qEnd)
        .order('renewal_due', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

}

export function useSaveWeeklyReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      weekStart: string;
      weekEnd: string;
      totalDials: number;
      totalConversations: number;
      totalMeetingsSet: number;
      totalMeetingsHeld: number;
      totalOppsCreated: number;
      totalProspectsAdded: number;
      totalPipelineMoved: number;
      daysLogged: number;
      daysGoalMet: number;
      avgDailyScore: number;
      avgSentiment: number | null;
      biggestWin: string;
      biggestFailure: string;
      failureChangePlan: string;
      commitmentForWeek: string;
      keyGoals: string[];
      keyClientMeetings: string;
      skillDevelopment: string;
      northStarGoals: string[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('weekly_reviews')
        .upsert({
          user_id: user.id,
          week_start: payload.weekStart,
          week_end: payload.weekEnd,
          total_dials: payload.totalDials,
          total_conversations: payload.totalConversations,
          total_meetings_set: payload.totalMeetingsSet,
          total_meetings_held: payload.totalMeetingsHeld,
          total_opps_created: payload.totalOppsCreated,
          total_prospects_added: payload.totalProspectsAdded,
          total_pipeline_moved: payload.totalPipelineMoved,
          days_logged: payload.daysLogged,
          days_goal_met: payload.daysGoalMet,
          avg_daily_score: payload.avgDailyScore,
          avg_sentiment: payload.avgSentiment,
          biggest_win: payload.biggestWin,
          biggest_failure: payload.biggestFailure,
          failure_change_plan: payload.failureChangePlan,
          commitment_for_week: payload.commitmentForWeek,
          key_goals: payload.keyGoals,
          key_client_meetings: payload.keyClientMeetings,
          skill_development: payload.skillDevelopment,
          north_star_goals: payload.northStarGoals,
          completed: true,
          completed_at: new Date().toISOString(),
        }, { onConflict: 'user_id,week_start' });

      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['weekly-review', vars.weekStart] });
    },
  });
}

// Hook for dismissed action plan items
export function useDismissedItems() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['dismissed-action-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dismissed_action_items')
        .select('record_id');
      if (error) throw error;
      return new Set((data || []).map(r => r.record_id));
    },
    enabled: !!user,
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ recordId, recordType }: { recordId: string; recordType: string }) => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('dismissed_action_items')
        .upsert({ user_id: u.id, record_id: recordId, record_type: recordType }, { onConflict: 'user_id,record_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dismissed-action-items'] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase
        .from('dismissed_action_items')
        .delete()
        .eq('record_id', recordId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dismissed-action-items'] });
    },
  });

  return {
    dismissedIds: query.data || new Set<string>(),
    isLoading: query.isLoading,
    dismiss: dismissMutation.mutate,
    restore: restoreMutation.mutate,
  };
}
