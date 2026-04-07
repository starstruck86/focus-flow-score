/**
 * durableJobs — CRUD operations against the `background_jobs` table.
 * This is the single source of truth for job state.
 * The Zustand store is a UI cache layer on top of this.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BackgroundJob, JobStatus, ProgressMode } from '@/store/useBackgroundJobs';

const TABLE = 'background_jobs' as any;

export interface DurableJobRow {
  id: string;
  user_id: string;
  type: string;
  entity_id: string | null;
  title: string;
  status: string;
  substatus: string | null;
  progress_mode: string | null;
  progress_current: number | null;
  progress_total: number | null;
  progress_percent: number | null;
  step_label: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
}

/** Convert a DB row to the in-memory BackgroundJob shape */
export function rowToJob(row: DurableJobRow): BackgroundJob {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status as JobStatus,
    substatus: row.substatus ?? undefined,
    progressMode: (row.progress_mode ?? 'indeterminate') as ProgressMode,
    progress: row.progress_total && row.progress_total > 0
      ? { current: row.progress_current ?? 0, total: row.progress_total }
      : undefined,
    progressPercent: row.progress_percent ?? undefined,
    stepLabel: row.step_label ?? undefined,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    entityId: row.entity_id ?? undefined,
    meta: row.metadata ?? undefined,
  };
}

/** Create a new durable job row. Returns the row ID. */
export async function createDurableJob(params: {
  id?: string;
  userId: string;
  type: string;
  title: string;
  status?: JobStatus;
  entityId?: string;
  progressMode?: ProgressMode;
  stepLabel?: string;
  substatus?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const id = params.id ?? crypto.randomUUID();
  console.info(`[DURABLE JOBS] creating row "${id}" type=${params.type} title="${params.title}"`);

  const { error } = await supabase.from(TABLE).upsert({
    id,
    user_id: params.userId,
    type: params.type,
    title: params.title,
    status: params.status ?? 'running',
    entity_id: params.entityId ?? null,
    progress_mode: params.progressMode ?? 'indeterminate',
    step_label: params.stepLabel ?? null,
    substatus: params.substatus ?? null,
    metadata: params.metadata ?? {},
    started_at: new Date().toISOString(),
  });

  if (error) {
    console.error(`[DURABLE JOBS] create failed for "${id}":`, error.message);
    throw error;
  }
  return id;
}

/** Update an existing durable job row (partial). */
export async function updateDurableJob(
  jobId: string,
  patch: Partial<{
    status: JobStatus;
    substatus: string | null;
    progress_mode: ProgressMode;
    progress_current: number;
    progress_total: number;
    progress_percent: number;
    step_label: string | null;
    error: string | null;
    metadata: Record<string, unknown>;
    completed_at: string | null;
  }>,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq('id', jobId);

  if (error) {
    console.error(`[DURABLE JOBS] update failed for "${jobId}":`, error.message);
  }
}

/** Mark a job as terminal (completed/failed/cancelled) with timestamp. */
export async function finalizeDurableJob(
  jobId: string,
  status: 'completed' | 'failed' | 'cancelled',
  opts?: { error?: string; stepLabel?: string; progressPercent?: number },
): Promise<void> {
  console.info(`[DURABLE JOBS] finalizing "${jobId}" → ${status}`);
  await updateDurableJob(jobId, {
    status,
    completed_at: new Date().toISOString(),
    error: opts?.error ?? null,
    step_label: opts?.stepLabel ?? null,
    progress_percent: opts?.progressPercent,
  });
}

/** Load all non-terminal + recently-completed jobs for a user. */
export async function loadActiveJobs(userId: string): Promise<BackgroundJob[]> {
  console.info(`[DURABLE JOBS] rehydrating jobs for user`);

  // Active jobs (queued, running, awaiting_review)
  const { data: activeRows, error: activeErr } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .in('status', ['queued', 'running', 'awaiting_review'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (activeErr) {
    console.error(`[DURABLE JOBS] rehydration failed:`, activeErr.message);
    return [];
  }

  // Also load recent terminal jobs (last 30 min) for context
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: recentRows } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed', 'cancelled'])
    .gte('completed_at', thirtyMinAgo)
    .order('completed_at', { ascending: false })
    .limit(20);

  const allRows = [...(activeRows || []), ...(recentRows || [])] as DurableJobRow[];
  const jobs = allRows.map(rowToJob);

  console.info(`[DURABLE JOBS] rehydrated ${jobs.length} jobs (${activeRows?.length ?? 0} active, ${recentRows?.length ?? 0} recent terminal)`);
  return jobs;
}

/** Subscribe to realtime changes on background_jobs for a user. */
export function subscribeToDurableJobs(
  userId: string,
  onUpdate: (job: BackgroundJob) => void,
  onDelete: (jobId: string) => void,
) {
  console.info(`[DURABLE JOBS] subscribing to realtime updates`);

  const channel = supabase
    .channel('durable-jobs')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'background_jobs',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          onDelete((payload.old as any).id);
        } else {
          const row = payload.new as DurableJobRow;
          onUpdate(rowToJob(row));
        }
      },
    )
    .subscribe();

  return () => {
    console.info(`[DURABLE JOBS] unsubscribing from realtime`);
    supabase.removeChannel(channel);
  };
}
