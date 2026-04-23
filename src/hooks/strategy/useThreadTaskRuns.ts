/**
 * useThreadTaskRuns — read-only projection of task_runs for a single thread.
 *
 * NEVER triggers, restarts, or mutates the task pipeline. It only reads.
 * Used by the artifact workspace + progress panel + sidebar artifact dot.
 *
 * - latestCompleted: most recent terminal run (status='completed') with renderable draft
 * - active: most recent in-flight run (status NOT IN completed/failed/cancelled)
 * - all: full list (for history dropdowns later)
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { sanitizeTaskRunResult, type TaskRunResult } from '@/hooks/strategy/useTaskExecution';

export interface ThreadTaskRunRow {
  id: string;
  task_type: string;
  status: string;
  progress_step: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  meta: Record<string, unknown> | null;
  draft_output: unknown;
  review_output: unknown;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled']);

export function useThreadTaskRuns(threadId: string | null) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ThreadTaskRunRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    if (!threadId || !user) { setRows([]); return; }
    setIsLoading(true);
    const { data } = await supabase
      .from('task_runs')
      .select('id, task_type, status, progress_step, error, created_at, updated_at, completed_at, meta, draft_output, review_output')
      .eq('user_id', user.id)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(20);
    setRows((data ?? []) as ThreadTaskRunRow[]);
    setIsLoading(false);
  }, [threadId, user]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // Lightweight polling — only when there's an in-flight run on this thread.
  useEffect(() => {
    const hasActive = rows.some(r => !TERMINAL_STATUSES.has(r.status));
    if (!hasActive) return;
    const t = setInterval(fetchRuns, 4000);
    return () => clearInterval(t);
  }, [rows, fetchRuns]);

  const active = rows.find(r => !TERMINAL_STATUSES.has(r.status)) ?? null;

  // Latest completed run that has actual draft content
  const latestCompleted = (() => {
    const candidate = rows.find(r => r.status === 'completed' && !!r.draft_output);
    if (!candidate) return null;
    const safe = sanitizeTaskRunResult({
      run_id: candidate.id,
      draft: candidate.draft_output,
      review: candidate.review_output,
    });
    if (!safe || safe.draft.sections.length === 0) return null;
    return { row: candidate, result: safe as TaskRunResult };
  })();

  return { rows, active, latestCompleted, isLoading, refetch: fetchRuns };
}
