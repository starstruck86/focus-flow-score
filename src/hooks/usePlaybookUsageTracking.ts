/**
 * Playbook Usage Tracking Hook
 * 
 * Tracks recommendation events, roleplay sessions, post-call feedback,
 * and provides weekly usage summaries for adoption visibility.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { startOfWeek, endOfWeek } from 'date-fns';

export type PlaybookEventType =
  | 'recommendation_shown'
  | 'recommendation_accepted'
  | 'recommendation_dismissed'
  | 'roleplay_started'
  | 'roleplay_completed'
  | 'used_in_call'
  | 'post_call_feedback';

interface TrackEventParams {
  playbookId?: string;
  playbookTitle: string;
  eventType: PlaybookEventType;
  blockType?: string;
  dealStage?: string;
  accountId?: string;
  opportunityId?: string;
  feedbackUsedApproach?: boolean;
  feedbackWhatWorked?: string;
  feedbackWhatDidnt?: string;
  feedbackRating?: number;
  roleplayDurationSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface WeeklyPlaybookSummary {
  recommendationsShown: number;
  recommendationsAccepted: number;
  roleplaysStarted: number;
  roleplaysCompleted: number;
  postCallFeedbackCount: number;
  usedInCalls: number;
  topPlaybooks: { title: string; count: number }[];
  acceptanceRate: number;
}

export function usePlaybookUsageTracking() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const trackEvent = useMutation({
    mutationFn: async (params: TrackEventParams) => {
      if (!user?.id) return;
      const { error } = await supabase
        .from('playbook_usage_events' as any)
        .insert({
          user_id: user.id,
          playbook_id: params.playbookId || null,
          playbook_title: params.playbookTitle,
          event_type: params.eventType,
          context_block_type: params.blockType || null,
          context_deal_stage: params.dealStage || null,
          context_account_id: params.accountId || null,
          context_opportunity_id: params.opportunityId || null,
          feedback_used_approach: params.feedbackUsedApproach ?? null,
          feedback_what_worked: params.feedbackWhatWorked || null,
          feedback_what_didnt: params.feedbackWhatDidnt || null,
          feedback_rating: params.feedbackRating ?? null,
          roleplay_duration_seconds: params.roleplayDurationSeconds ?? null,
          metadata: params.metadata || {},
        } as any);
      if (error) console.error('[PlaybookUsage] track error:', error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playbook-usage-summary'] });
    },
  });

  const track = useCallback((params: TrackEventParams) => {
    trackEvent.mutate(params);
  }, [trackEvent]);

  return { track };
}

export function useWeeklyPlaybookSummary() {
  const { user } = useAuth();
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  return useQuery({
    queryKey: ['playbook-usage-summary', user?.id, weekStart.toISOString()],
    queryFn: async (): Promise<WeeklyPlaybookSummary> => {
      const { data, error } = await supabase
        .from('playbook_usage_events' as any)
        .select('*')
        .gte('created_at', weekStart.toISOString())
        .lte('created_at', weekEnd.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      const events = (data || []) as any[];

      const byType = (t: string) => events.filter(e => e.event_type === t).length;

      // Top playbooks by usage
      const playbookCounts = new Map<string, number>();
      events.forEach(e => {
        if (e.event_type === 'recommendation_accepted' || e.event_type === 'roleplay_completed' || e.event_type === 'used_in_call') {
          playbookCounts.set(e.playbook_title, (playbookCounts.get(e.playbook_title) || 0) + 1);
        }
      });
      const topPlaybooks = [...playbookCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([title, count]) => ({ title, count }));

      const shown = byType('recommendation_shown');
      const accepted = byType('recommendation_accepted');

      return {
        recommendationsShown: shown,
        recommendationsAccepted: accepted,
        roleplaysStarted: byType('roleplay_started'),
        roleplaysCompleted: byType('roleplay_completed'),
        postCallFeedbackCount: byType('post_call_feedback'),
        usedInCalls: byType('used_in_call'),
        topPlaybooks,
        acceptanceRate: shown > 0 ? Math.round((accepted / shown) * 100) : 0,
      };
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}
