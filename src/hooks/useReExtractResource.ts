/**
 * Hook to trigger single-resource KI re-extraction via the stabilized edge function.
 * Persists status to the resources table so it survives refresh/navigation.
 */
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAllResources } from '@/hooks/useResources';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
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
}

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 4 * 60_000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Returns a status that accounts for staleness — if resource was updated after re_extract_at, treat succeeded as stale */
export function deriveReExtractStatus(resource: any): { status: ReExtractStatus; stale: boolean; at: string | null } {
  const raw = (resource?.re_extract_status as ReExtractStatus) || 'idle';
  const at = resource?.re_extract_at || null;
  if (raw === 'idle' || raw === 'running') return { status: raw, stale: false, at };
  // Check staleness: if resource updated_at is materially after re_extract_at
  if (at && resource?.updated_at) {
    const reExtractTime = new Date(at).getTime();
    const updatedTime = new Date(resource.updated_at).getTime();
    // 60s grace window to avoid self-triggered update noise
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
  const { data: resources = [] } = useAllResources();
  // Local overrides while a request is in-flight (before DB roundtrip)
  const [localOverrides, setLocalOverrides] = useState<Record<string, ReExtractStatus>>({});
  const [resultMap, setResultMap] = useState<Record<string, ReExtractResult>>({});

  const readDurableState = useCallback(async (resourceId: string): Promise<DurableReExtractState> => {
    const { data, error } = await supabase
      .from(TABLE)
      .select('active_job_status, current_resource_ki_count, extraction_attempt_count, extraction_retry_eligible, last_extraction_run_status, last_extraction_started_at, last_extraction_summary, next_retry_at')
      .eq('id', resourceId)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as DurableReExtractState;
  }, []);

  const pollForTerminalState = useCallback(async (
    resourceId: string,
    baselineAttemptCount: number,
    startedAt: string,
  ): Promise<{ terminal: 'succeeded' | 'failed' | null; latest: DurableReExtractState | null }> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const startedAtMs = new Date(startedAt).getTime() - 1000;
    let latest: DurableReExtractState | null = null;

    while (Date.now() < deadline) {
      latest = await readDurableState(resourceId);

      const hasFreshRun = (latest.extraction_attempt_count ?? 0) > baselineAttemptCount
        || (!!latest.last_extraction_started_at && new Date(latest.last_extraction_started_at).getTime() >= startedAtMs);

      if (!hasFreshRun) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (latest.extraction_retry_eligible) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (latest.active_job_status === 'succeeded' || latest.last_extraction_run_status === 'completed') {
        return { terminal: 'succeeded', latest };
      }

      if (latest.active_job_status === 'failed' || latest.last_extraction_run_status === 'failed') {
        return { terminal: 'failed', latest };
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return { terminal: null, latest };
  }, [readDurableState]);

  const getStatus = useCallback((resourceId: string): ReExtractStatus => {
    // Prefer local in-flight override, then fall back to persisted DB value
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
    const existing = resources.find(r => r.id === resourceId) as any;
    const beforeKiCount = existing?.current_resource_ki_count ?? 0;
    const baselineAttemptCount = existing?.extraction_attempt_count ?? 0;
    const startedAt = new Date().toISOString();

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

      const terminalState = await pollForTerminalState(resourceId, baselineAttemptCount, startedAt);

      if (terminalState.terminal === 'failed') {
        throw new Error(
          terminalState.latest?.last_extraction_summary
            || immediateError
            || payload?.error
            || 'Re-extraction failed'
        );
      }

      if (terminalState.terminal !== 'succeeded') {
        // If DB is still non-terminal (running/retrying), show neutral background state
        const latestStatus = terminalState.latest?.active_job_status;
        if (!terminalState.terminal && latestStatus && !['failed'].includes(latestStatus)) {
          // Still processing in background — don't mark as failed
          setLocalOverrides(prev => ({ ...prev, [resourceId]: 'running' }));
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
      toast.error(`Re-extract failed for "${resourceTitle}": ${err.message}`);
    }
  }, [pollForTerminalState, qc, resources]);

  return { reExtract, getStatus, getResult };
}
