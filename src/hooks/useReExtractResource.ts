/**
 * Hook to trigger single-resource KI re-extraction via the stabilized edge function.
 * Persists status to the resources table so it survives refresh/navigation.
 * Feeds progress into the global BackgroundJobs store for real-time UI.
 */
import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAllResources } from '@/hooks/useResources';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { useBackgroundJobs } from '@/store/useBackgroundJobs';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type ReExtractStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface ReExtractResult {
  kis: number;
  preservedUserEdited: number;
  error?: string;
}

interface DurableReExtractState {
  active_job_status: string | null;
  current_resource_ki_count: number | null;
  extraction_attempt_count: number | null;
  extraction_retry_eligible: boolean | null;
  last_extraction_run_status: string | null;
  last_extraction_started_at: string | null;
  last_extraction_summary: string | null;
  next_retry_at: string | null;
  extraction_batches_completed?: number | null;
  extraction_batch_total?: number | null;
}

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 4 * 60_000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Returns a status that accounts for staleness */
export function deriveReExtractStatus(resource: any): { status: ReExtractStatus; stale: boolean; at: string | null } {
  const raw = (resource?.re_extract_status as ReExtractStatus) || 'idle';
  const at = resource?.re_extract_at || null;
  if (raw === 'idle' || raw === 'running') return { status: raw, stale: false, at };
  if (at && resource?.updated_at) {
    const reExtractTime = new Date(at).getTime();
    const updatedTime = new Date(resource.updated_at).getTime();
    if (updatedTime > reExtractTime + 60_000) {
      return { status: raw, stale: true, at };
    }
  }
  return { status: raw, stale: false, at };
}

/** Human-readable relative time */
export function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const TABLE = 'resources' as any;

export function useReExtractResource() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: resources = [] } = useAllResources();
  const [localOverrides, setLocalOverrides] = useState<Record<string, ReExtractStatus>>({});
  const [resultMap, setResultMap] = useState<Record<string, ReExtractResult>>({});
  const activePolls = useRef(new Set<string>());

  // Background jobs store
  const addJob = useBackgroundJobs((s) => s.addJob);
  const updateJob = useBackgroundJobs((s) => s.updateJob);

  const readDurableState = useCallback(async (resourceId: string): Promise<DurableReExtractState> => {
    const { data, error } = await supabase
      .from(TABLE)
      .select('active_job_status, current_resource_ki_count, extraction_attempt_count, extraction_retry_eligible, last_extraction_run_status, last_extraction_started_at, last_extraction_summary, next_retry_at, extraction_batches_completed, extraction_batch_total')
      .eq('id', resourceId)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as DurableReExtractState;
  }, []);

  const pollForTerminalState = useCallback(async (
    resourceId: string,
    baselineAttemptCount: number,
    startedAt: string,
    jobId: string,
  ): Promise<{ terminal: 'succeeded' | 'failed' | null; latest: DurableReExtractState | null }> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const startedAtMs = new Date(startedAt).getTime() - 1000;
    let latest: DurableReExtractState | null = null;
    let pollCount = 0;

    console.info(`[RE-EXTRACT JOB] poll started for "${jobId}"`);

    while (Date.now() < deadline) {
      if (!activePolls.current.has(jobId)) {
        console.info(`[RE-EXTRACT JOB] poll cancelled for "${jobId}"`);
        return { terminal: null, latest };
      }

      latest = await readDurableState(resourceId);
      pollCount++;

      // Update background job with durable progress
      const batchTotal = latest.extraction_batch_total ?? 0;
      const batchDone = latest.extraction_batches_completed ?? 0;
      const isBatched = batchTotal > 1;

      if (isBatched && batchTotal > 0) {
        updateJob(jobId, {
          progressMode: 'determinate',
          progress: { current: batchDone, total: batchTotal },
          progressPercent: Math.round((batchDone / batchTotal) * 100),
          stepLabel: `Batch ${batchDone} of ${batchTotal}`,
          substatus: 'extracting',
        });
      } else {
        const durableStatus = latest.active_job_status || latest.last_extraction_run_status;
        const stepLabel = durableStatus === 'running' ? 'Running extraction…'
          : latest.extraction_retry_eligible ? 'Waiting for retry…'
          : `Polling durable state (${pollCount})…`;
        updateJob(jobId, {
          progressMode: 'indeterminate',
          stepLabel,
          substatus: durableStatus === 'running' ? 'extracting' : 'polling',
        });
      }

      const hasFreshRun = (latest.extraction_attempt_count ?? 0) > baselineAttemptCount
        || (!!latest.last_extraction_started_at && new Date(latest.last_extraction_started_at).getTime() >= startedAtMs);

      if (!hasFreshRun) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (latest.extraction_retry_eligible) {
        updateJob(jobId, { stepLabel: 'Waiting for continuation…', substatus: 'waiting_continuation' });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (latest.active_job_status === 'succeeded' || latest.last_extraction_run_status === 'completed') {
        console.info(`[RE-EXTRACT JOB] poll resolved: succeeded for "${jobId}" after ${pollCount} polls`);
        return { terminal: 'succeeded', latest };
      }

      if (latest.active_job_status === 'failed' || latest.last_extraction_run_status === 'failed') {
        console.info(`[RE-EXTRACT JOB] poll resolved: failed for "${jobId}" after ${pollCount} polls`);
        return { terminal: 'failed', latest };
      }

      await sleep(POLL_INTERVAL_MS);
    }

    console.warn(`[RE-EXTRACT JOB] poll timed out for "${jobId}" after ${pollCount} polls`);
    return { terminal: null, latest };
  }, [readDurableState, updateJob]);

  const getStatus = useCallback((resourceId: string): ReExtractStatus => {
    if (localOverrides[resourceId]) return localOverrides[resourceId];
    const res = resources.find(r => r.id === resourceId);
    return ((res as any)?.re_extract_status as ReExtractStatus) || 'idle';
  }, [localOverrides, resources]);

  const getResult = useCallback((resourceId: string): ReExtractResult | undefined => {
    return resultMap[resourceId];
  }, [resultMap]);

  const persistStatus = async (resourceId: string, status: ReExtractStatus) => {
    await supabase
      .from(TABLE)
      .update({
        re_extract_status: status,
        re_extract_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', resourceId);
  };

  const reExtract = useCallback(async (resourceId: string, resourceTitle: string) => {
    const jobId = crypto.randomUUID();

    // Guard: don't start a duplicate extraction for the same resource
    if (activePolls.current.has(jobId)) {
      console.warn(`[RE-EXTRACT JOB] duplicate blocked for "${jobId}"`);
      toast.info(`Re-extraction already in progress for "${resourceTitle}"`);
      return;
    }

    const existing = resources.find(r => r.id === resourceId) as any;
    const beforeKiCount = existing?.current_resource_ki_count ?? 0;
    const baselineAttemptCount = existing?.extraction_attempt_count ?? 0;
    const startedAt = new Date().toISOString();

    // Register in global background jobs
    console.info(`[RE-EXTRACT JOB] starting for "${resourceTitle}" (${resourceId})`);
    addJob({
      id: jobId,
      type: 're_extraction',
      title: `Re-extract: ${resourceTitle}`,
      status: 'running',
      progressMode: 'indeterminate',
      stepLabel: 'Starting extraction…',
      substatus: 'extracting',
      entityId: resourceId,
      userId: user?.id,
    });

    activePolls.current.add(jobId);
    setLocalOverrides(prev => ({ ...prev, [resourceId]: 'running' }));
    await persistStatus(resourceId, 'running');

    try {
      let payload: any = null;
      let immediateError: string | null = null;

      try {
        const response = await authenticatedFetch({
          functionName: 'batch-extract-kis',
          body: { resourceId },
          componentName: 'useReExtractResource',
          timeoutMs: 180_000,
          retry: false,
        });

        payload = await response.json().catch(() => null);

        if (!response.ok && response.status < 500 && !payload?.retryEligible) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
      } catch (err: any) {
        immediateError = err.message || 'Edge function error';
      }

      updateJob(jobId, { stepLabel: 'Polling for completion…', substatus: 'polling' });

      const terminalState = await pollForTerminalState(resourceId, baselineAttemptCount, startedAt, jobId);

      if (terminalState.terminal === 'failed') {
        const errMsg = terminalState.latest?.last_extraction_summary || immediateError || payload?.error || 'Re-extraction failed';
        throw new Error(errMsg);
      }

      if (terminalState.terminal !== 'succeeded') {
        const latestStatus = terminalState.latest?.active_job_status;
        if (!terminalState.terminal && latestStatus && !['failed'].includes(latestStatus)) {
          setLocalOverrides(prev => ({ ...prev, [resourceId]: 'running' }));
          updateJob(jobId, {
            stepLabel: 'Still processing in background…',
            substatus: 'waiting_continuation',
          });
          toast.info(`"${resourceTitle}" is still processing in the background`, {
            description: 'Check back shortly — progress will update automatically.',
            duration: 6000,
          });
          qc.invalidateQueries({ queryKey: ['resources'] });
          return;
        }
        throw new Error(immediateError || payload?.error || 'Timed out waiting for re-extraction to finish');
      }

      const afterKiCount = terminalState.latest?.current_resource_ki_count ?? beforeKiCount;
      const result: ReExtractResult = {
        kis: Math.max(0, afterKiCount - beforeKiCount),
        preservedUserEdited: payload?.preservedUserEdited ?? 0,
        error: payload?.error,
      };

      setResultMap(prev => ({ ...prev, [resourceId]: result }));
      setLocalOverrides(prev => ({ ...prev, [resourceId]: 'succeeded' }));
      await persistStatus(resourceId, 'succeeded');

      updateJob(jobId, {
        status: 'completed',
        progressMode: 'determinate',
        progressPercent: 100,
        stepLabel: result.kis > 0 ? `${result.kis} new KIs extracted` : 'Completed — no new KIs',
        substatus: undefined,
      });

      if (result.kis > 0) {
        toast.success(`Re-extracted "${resourceTitle}": ${result.kis} KIs`);
      } else {
        toast.success(`Re-extraction completed for "${resourceTitle}"`);
      }

      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
    } catch (err: any) {
      const result: ReExtractResult = { kis: 0, preservedUserEdited: 0, error: err.message };
      setResultMap(prev => ({ ...prev, [resourceId]: result }));
      setLocalOverrides(prev => ({ ...prev, [resourceId]: 'failed' }));
      await persistStatus(resourceId, 'failed');

      console.error(`[RE-EXTRACT JOB] failed for "${resourceTitle}":`, err.message);
      updateJob(jobId, {
        status: 'failed',
        error: err.message,
        stepLabel: 'Failed',
        substatus: undefined,
      });

      toast.error(`Re-extract failed for "${resourceTitle}": ${err.message}`);
    } finally {
      activePolls.current.delete(jobId);
    }
  }, [addJob, updateJob, pollForTerminalState, qc, resources]);

  return { reExtract, getStatus, getResult };
}
