// ════════════════════════════════════════════════════════════════
// useStrategyJob — generic polling hook for run-strategy-job
// (account_brief, ninety_day_plan).
//
// Mirrors the polling pattern from useTaskExecution (Discovery Prep)
// but routes to /functions/v1/run-strategy-job and accepts a task_type.
// ════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { buildAccountResearchSopAttachment } from './buildAccountResearchSopAttachment';

export type StrategyJobStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';
export type StrategyTaskType = 'account_brief' | 'ninety_day_plan';
export type StrategyOverride = 'auto' | 'quick' | 'deep';

export interface StrategyJobState {
  runId: string | null;
  taskType: StrategyTaskType | null;
  status: StrategyJobStatus;
  progressStep: string | null;
  result: { draft: unknown; review: unknown } | null;
  error: string | null;
  failedStage: string | null;
  retryHint: string | null;
}

function deriveRetryHint(err?: string | null, stage?: string | null): string {
  if (!err) return 'Try again in a moment.';
  if (/timeout|stalled/i.test(err)) return 'The job stalled. Retry — usually transient.';
  if (/rate.?limit/i.test(err)) return 'Model rate-limited. Wait 30s and retry.';
  if (/cards|library/i.test(err)) return 'Library context unavailable. Retry; falls back to zero-card mode.';
  return `Failed at "${stage ?? 'unknown'}". Retry or report if it repeats.`;
}

const PROGRESS_LABELS: Record<string, string> = {
  queued: 'Queued…',
  library_retrieval: 'Pulling library cards & playbooks…',
  research: 'Researching account & market…',
  synthesis: 'Synthesizing intelligence…',
  document_authoring: 'Authoring document…',
  review: 'Reviewing against playbooks…',
  completed: 'Done',
  failed: 'Failed',
};

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const initialState: StrategyJobState = {
  runId: null,
  taskType: null,
  status: 'idle',
  progressStep: null,
  result: null,
  error: null,
  failedStage: null,
  retryHint: null,
};

async function callRunStrategyJob(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-strategy-job`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('Rate limited — please try again in a moment.');
    if (resp.status === 402) throw new Error('AI credits exhausted.');
    throw new Error((json as { error?: string })?.error || `Error ${resp.status}`);
  }
  return json as Record<string, unknown>;
}

export function useStrategyJob() {
  const [state, setState] = useState<StrategyJobState>(initialState);
  const cancelRef = useRef(false);
  const inFlightRef = useRef(false);
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    cancelRef.current = true;
    activeRunIdRef.current = null;
  }, []);

  const pollUntilDone = useCallback(async (runId: string, taskType: StrategyTaskType) => {
    const startedAt = Date.now();
    const isStillActive = () => activeRunIdRef.current === runId && !cancelRef.current;

    while (isStillActive()) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error('Strategy job is taking longer than expected. Please check back shortly.');
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!isStillActive()) return;

      const status = await callRunStrategyJob({ action: 'status', run_id: runId });
      if (!isStillActive()) return;

      const step = (status.progress_step as string) || (status.status as string) || 'queued';
      const statusValue = (status.status as StrategyJobStatus) || 'pending';
      setState((prev) => ({
        ...prev,
        runId,
        taskType,
        status: statusValue === 'completed' || statusValue === 'failed' ? statusValue : (step === 'queued' ? 'pending' : 'running'),
        progressStep: PROGRESS_LABELS[step] || step,
      }));

      if (status.status === 'failed') {
        const errMsg = (status.error as string) || 'Strategy job failed';
        const failedStage = (status.progress_step as string) || null;
        setState((prev) => ({
          ...prev,
          status: 'failed',
          error: errMsg,
          failedStage,
          retryHint: deriveRetryHint(errMsg, failedStage),
          progressStep: null,
        }));
        throw new Error(errMsg);
      }
      if (status.status === 'completed') {
        setState({
          runId,
          taskType,
          status: 'completed',
          progressStep: PROGRESS_LABELS.completed,
          result: { draft: status.draft, review: status.review },
          error: null,
          failedStage: null,
          retryHint: null,
        });
        return;
      }
    }
  }, []);

  const start = useCallback(async (
    taskType: StrategyTaskType,
    inputs: Record<string, unknown>,
    override: StrategyOverride = 'auto',
  ): Promise<string> => {
    if (inFlightRef.current) throw new Error('A strategy job is already in flight');
    inFlightRef.current = true;
    cancelRef.current = false;
    setState({ runId: null, taskType, status: 'pending', progressStep: PROGRESS_LABELS.queued, result: null, error: null, failedStage: null, retryHint: null });

    try {
      // Phase 3B SOP "SAFE BRIDGE" — Account Research only.
      // When the universal `tasks.account_research` SOP is enabled in
      // Strategy Settings, attach the parsed contract under inputs.__sop
      // so the orchestrator runs shadow input/output validation. The
      // server NEVER injects this into prompt builders — observation only.
      // Discovery Prep is intentionally untouched here (it goes through
      // run-discovery-prep / useTaskExecution, not this hook).
      let sopAttachment: ReturnType<typeof buildAccountResearchSopAttachment> = null;
      if (taskType === 'account_brief') {
        try {
          sopAttachment = buildAccountResearchSopAttachment();
        } catch {
          sopAttachment = null;
        }
      }

      const enrichedInputs: Record<string, unknown> = {
        ...inputs,
        __override: override,
        ...(sopAttachment ? { __sop: sopAttachment } : {}),
      };

      const start = await callRunStrategyJob({
        action: 'generate',
        task_type: taskType,
        inputs: enrichedInputs,
      });
      const runId = start.run_id as string | undefined;
      if (!runId) throw new Error('Failed to start strategy job');
      activeRunIdRef.current = runId;
      setState((prev) => ({ ...prev, runId, status: 'running' }));

      await pollUntilDone(runId, taskType);
      return runId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to run strategy job';
      setState((prev) => ({
        ...prev,
        status: 'failed',
        error: msg,
        failedStage: prev.failedStage ?? null,
        retryHint: prev.retryHint ?? deriveRetryHint(msg, prev.failedStage ?? null),
        progressStep: null,
      }));
      throw e;
    } finally {
      inFlightRef.current = false;
    }
  }, [pollUntilDone]);

  const attach = useCallback((runId: string, taskType: StrategyTaskType) => {
    if (inFlightRef.current || activeRunIdRef.current === runId) {
      console.log('[strategy-ui:dup_prevented]', JSON.stringify({ kind: 'attach', run_id: runId }));
      return;
    }
    inFlightRef.current = true;
    cancelRef.current = false;
    activeRunIdRef.current = runId;
    setState({ runId, taskType, status: 'running', progressStep: PROGRESS_LABELS.queued, result: null, error: null, failedStage: null, retryHint: null });
    pollUntilDone(runId, taskType)
      .catch((e) => {
        const msg = e instanceof Error ? e.message : 'Strategy job failed';
        setState((prev) => ({
          ...prev,
          status: 'failed',
          error: msg,
          failedStage: prev.failedStage ?? null,
          retryHint: prev.retryHint ?? deriveRetryHint(msg, prev.failedStage ?? null),
          progressStep: null,
        }));
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [pollUntilDone]);

  const reset = useCallback(() => {
    cancelRef.current = true;
    activeRunIdRef.current = null;
    inFlightRef.current = false;
    setState(initialState);
  }, []);

  return { state, start, attach, reset };
}
