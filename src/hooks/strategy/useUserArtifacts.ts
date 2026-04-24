/**
 * useUserArtifacts — read-only projection of recent task_run artifacts
 * across all of the current user's threads. Powers the Artifacts section
 * in the new Strategy sidebar.
 *
 * NEVER triggers, restarts, or mutates the task pipeline. UI-only.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface UserArtifact {
  id: string;
  thread_id: string | null;
  task_type: string;
  title: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  discovery_prep: 'Discovery Prep',
  deal_review: 'Deal Review',
  outreach_plan: 'Outreach Plan',
  account_brief: 'Account Brief',
  call_recap: 'Call Recap',
};

const TASK_TYPE_GROUP: Record<string, string> = {
  discovery_prep: 'Discovery Preps',
  deal_review: 'Deal Reviews',
  outreach_plan: 'Outreach Plans',
  account_brief: 'Account Briefs',
  call_recap: 'Call Recaps',
};

export function labelForTaskType(t: string): string {
  return TASK_TYPE_LABELS[t]
    ?? t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function groupForTaskType(t: string): string {
  return TASK_TYPE_GROUP[t] ?? 'Custom Outputs';
}

export function useUserArtifacts(limit = 20) {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserArtifact[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!user) { setRows([]); return; }
    setIsLoading(true);
    const { data } = await supabase
      .from('task_runs')
      .select('id, thread_id, task_type, status, created_at, completed_at, meta')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    const mapped: UserArtifact[] = ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      thread_id: r.thread_id ?? null,
      task_type: r.task_type ?? 'custom',
      title: (r.meta && typeof r.meta === 'object' && (r.meta.title || r.meta.account_name))
        ? String(r.meta.title || r.meta.account_name)
        : labelForTaskType(r.task_type ?? 'custom'),
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
    }));
    setRows(mapped);
    setIsLoading(false);
  }, [user, limit]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  return { rows, isLoading, refetch: fetchRows };
}
