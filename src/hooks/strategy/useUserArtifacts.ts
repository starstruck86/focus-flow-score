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
  /** Display title, enriched with account/opportunity context when available */
  title: string;
  /** The bare task-type label (e.g. "Discovery Prep"), without context prefix */
  type_label: string;
  /** Context prefix (e.g. "Sephora") or null when none could be derived */
  context: string | null;
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

/** Format a timestamp as a short relative or "Mon DD" date for sidebar use. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'yesterday';
  if (diffD < 7) return `${diffD}d ago`;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return `${diffD}d ago`;
  }
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

    const raw = (data ?? []) as any[];

    // Pull thread context (title + linked account) so we can enrich titles
    // with "Sephora — Discovery Prep" instead of 4 identical "Discovery Prep" rows.
    const threadIds = Array.from(new Set(raw.map(r => r.thread_id).filter(Boolean)));
    const threadCtx = new Map<string, { title: string | null; accountId: string | null }>();
    if (threadIds.length > 0) {
      const { data: threads } = await supabase
        .from('strategy_threads')
        .select('id, title, linked_account_id')
        .in('id', threadIds);
      for (const t of (threads ?? []) as any[]) {
        threadCtx.set(t.id, { title: t.title ?? null, accountId: t.linked_account_id ?? null });
      }
    }

    const accountIds = Array.from(new Set(
      Array.from(threadCtx.values()).map(v => v.accountId).filter(Boolean) as string[]
    ));
    const accountNames = new Map<string, string>();
    if (accountIds.length > 0) {
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name')
        .in('id', accountIds);
      for (const a of (accounts ?? []) as any[]) {
        accountNames.set(a.id, a.name);
      }
    }

    const mapped: UserArtifact[] = raw.map((r) => {
      const taskType = r.task_type ?? 'custom';
      const typeLabel = labelForTaskType(taskType);
      const ctx = r.thread_id ? threadCtx.get(r.thread_id) : undefined;
      const metaTitle = (r.meta && typeof r.meta === 'object' && (r.meta.title || r.meta.account_name))
        ? String(r.meta.title || r.meta.account_name) : null;

      // Resolve a "context" prefix: account name > meta.account_name >
      // thread title (only if it isn't a generic placeholder).
      const accountName = ctx?.accountId ? accountNames.get(ctx.accountId) ?? null : null;
      const threadTitle = ctx?.title ?? null;
      const isGenericThread = !threadTitle
        || /^untitled/i.test(threadTitle)
        || /^\[benchmark\]/i.test(threadTitle);
      const context: string | null = accountName
        || metaTitle
        || (!isGenericThread ? threadTitle : null);

      const title = context ? `${context} — ${typeLabel}` : typeLabel;

      return {
        id: r.id,
        thread_id: r.thread_id ?? null,
        task_type: taskType,
        title,
        type_label: typeLabel,
        context,
        status: r.status,
        created_at: r.created_at,
        completed_at: r.completed_at,
      };
    });
    setRows(mapped);
    setIsLoading(false);
  }, [user, limit]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  return { rows, isLoading, refetch: fetchRows };
}
