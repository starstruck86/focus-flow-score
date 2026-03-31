/**
 * Batch Run Persistence
 *
 * Stores batch run history and per-resource job records in the database.
 */

import { supabase } from '@/integrations/supabase/client';
import type { BatchProgress, ResourceJobState, BatchAction } from '@/lib/batchQueueProcessor';
import { createLogger } from '@/lib/logger';

const log = createLogger('BatchRunPersistence');

export interface BatchRunRecord {
  id: string;
  action_type: string;
  batch_size: number;
  concurrency: number;
  total_resources: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  started_at: string;
  ended_at: string | null;
}

/**
 * Create a new batch run record when a batch starts.
 */
export async function createBatchRun(
  action: BatchAction,
  totalResources: number,
  batchSize: number,
  concurrency: number,
): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('batch_runs' as any)
    .insert({
      user_id: userId,
      action_type: action,
      batch_size: batchSize,
      concurrency,
      total_resources: totalResources,
      started_at: new Date().toISOString(),
    } as any)
    .select('id')
    .single();

  if (error) {
    log.error('Failed to create batch run', { error: error.message });
    return null;
  }

  return (data as any)?.id ?? null;
}

/**
 * Finalize a batch run with results.
 */
export async function finalizeBatchRun(
  batchRunId: string,
  progress: BatchProgress,
): Promise<void> {
  const { error } = await supabase
    .from('batch_runs' as any)
    .update({
      succeeded: progress.succeeded,
      failed: progress.failed,
      skipped: progress.skipped,
      cancelled: progress.isCancelled,
      ended_at: new Date().toISOString(),
    } as any)
    .eq('id', batchRunId);

  if (error) {
    log.error('Failed to finalize batch run', { error: error.message });
  }
}

/**
 * Persist all job records for a completed batch.
 */
export async function persistJobRecords(
  batchRunId: string,
  jobs: ResourceJobState[],
): Promise<void> {
  const rows = jobs.map(j => {
    // Find the successful attempt (or last attempt)
    const successAttempt = j.attempts.find(a => a.success);
    const lastAttempt = j.attempts[j.attempts.length - 1];
    const methodUsed = successAttempt?.method ?? lastAttempt?.method ?? null;
    const contentLen = successAttempt?.extractedContentLength ?? lastAttempt?.extractedContentLength ?? null;

    return {
      batch_run_id: batchRunId,
      resource_id: j.resourceId,
      resource_title: j.title,
      source_type: j.sourceType ?? 'unknown',
      final_status: j.status,
      failure_reason: j.failureReason ?? null,
      attempts: JSON.stringify(j.attempts),
      method_used: methodUsed,
      content_length_extracted: contentLen,
      quality_passed: j.status === 'complete' ? true : j.status === 'failed' ? false : null,
      started_at: j.attempts[0]?.startedAt ?? null,
      ended_at: j.attempts[j.attempts.length - 1]?.endedAt ?? null,
    };
  });

  // Insert in chunks of 50
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await supabase
      .from('batch_run_jobs' as any)
      .insert(chunk as any);

    if (error) {
      log.error('Failed to persist job records', { error: error.message, chunk: i });
    }
  }
}

/**
 * Check if a resource already has an active/queued job in any running batch.
 */
export async function hasActiveJobInDB(resourceId: string): Promise<boolean> {
  const { data } = await supabase
    .from('batch_run_jobs' as any)
    .select('id')
    .eq('resource_id', resourceId)
    .in('final_status', ['queued', 'extracting', 'extracting_edge_fetch', 'extracting_direct_fetch', 'extracting_source_specific', 'awaiting_transcription', 'enriching'])
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/**
 * Load batch run history for metrics display.
 */
export async function loadBatchRunHistory(limit = 20): Promise<BatchRunRecord[]> {
  const { data, error } = await supabase
    .from('batch_runs' as any)
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    log.error('Failed to load batch history', { error: error.message });
    return [];
  }

  return (data ?? []) as any as BatchRunRecord[];
}

/**
 * Load job records for a specific batch run.
 */
export async function loadBatchRunJobs(batchRunId: string) {
  const { data, error } = await supabase
    .from('batch_run_jobs' as any)
    .select('*')
    .eq('batch_run_id', batchRunId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return data ?? [];
}

/**
 * Compute metrics across recent batch runs.
 */
export async function computeBatchMetrics(runs: BatchRunRecord[]) {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      totalResources: 0,
      overallSuccessRate: 0,
      avgBatchDurationMs: 0,
      topFailureReasons: [] as Array<{ reason: string; count: number }>,
      recoveredByFallback: 0,
    };
  }

  const totalResources = runs.reduce((s, r) => s + r.total_resources, 0);
  const totalSucceeded = runs.reduce((s, r) => s + r.succeeded, 0);
  const overallSuccessRate = totalResources > 0 ? totalSucceeded / totalResources : 0;

  // Avg duration
  const durations = runs
    .filter(r => r.ended_at)
    .map(r => new Date(r.ended_at!).getTime() - new Date(r.started_at).getTime());
  const avgBatchDurationMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Failure reasons from job records
  const runIds = runs.map(r => r.id);
  const { data: failedJobs } = await supabase
    .from('batch_run_jobs' as any)
    .select('failure_reason, attempts')
    .in('batch_run_id', runIds)
    .eq('final_status', 'failed');

  const reasonCounts = new Map<string, number>();
  let recoveredByFallback = 0;

  for (const job of (failedJobs ?? []) as any[]) {
    const reason = job.failure_reason || 'Unknown';
    const shortReason = reason.length > 80 ? reason.slice(0, 80) + '…' : reason;
    reasonCounts.set(shortReason, (reasonCounts.get(shortReason) ?? 0) + 1);

    // Check if any attempt succeeded before final failure (partial recovery)
    const attempts = typeof job.attempts === 'string' ? JSON.parse(job.attempts) : job.attempts;
    if (Array.isArray(attempts) && attempts.some((a: any) => a.success)) {
      recoveredByFallback++;
    }
  }

  // Also count successes that used fallback (not first method)
  const { data: successJobs } = await supabase
    .from('batch_run_jobs' as any)
    .select('attempts')
    .in('batch_run_id', runIds)
    .eq('final_status', 'complete');

  for (const job of (successJobs ?? []) as any[]) {
    const attempts = typeof job.attempts === 'string' ? JSON.parse(job.attempts) : job.attempts;
    if (Array.isArray(attempts) && attempts.length > 1) {
      recoveredByFallback++;
    }
  }

  const topFailureReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalRuns: runs.length,
    totalResources,
    overallSuccessRate,
    avgBatchDurationMs,
    topFailureReasons,
    recoveredByFallback,
  };
}
