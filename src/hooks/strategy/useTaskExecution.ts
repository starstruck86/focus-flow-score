import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  normalizeTaskRunResultPayload,
  hasRenderableDiscoveryContent,
} from '@/lib/strategy/discoveryTaskResult';
import { getStrategyConfig } from '@/lib/strategy/strategyConfig';
import type {
  DiscoverySection,
  LibraryCoverageEntry,
  Redline,
  RubricCheck,
  SourceEntry,
  TaskInputs,
  TaskRunResult,
} from '@/types/strategy/discoveryTask';

// Re-export shared types so existing import sites
// (`@/hooks/strategy/useTaskExecution`) keep working.
export type {
  DiscoverySection,
  LibraryCoverageEntry,
  Redline,
  RubricCheck,
  SourceEntry,
  TaskInputs,
  TaskRunResult,
};

const PROGRESS_LABELS: Record<string, string> = {
  queued: 'Queued…',
  library_retrieval: 'Pulling internal playbooks & KIs…',
  research: 'Researching company & market…',
  synthesis: 'Synthesizing strategic intelligence…',
  document_authoring: 'Authoring prep document…',
  review: 'Reviewing against playbooks…',
  completed: 'Done',
  failed: 'Failed',
};

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes hard cap

/**
 * Single-source-of-truth sanitizer used by both the hook AND every render
 * boundary. Always returns either a fully normalized TaskRunResult shape or
 * null — never a partial object that can crash the viewer.
 */
export function sanitizeTaskRunResult(
  raw?: Partial<TaskRunResult> | { run_id?: string; draft?: unknown; review?: unknown } | null,
): TaskRunResult | null {
  if (!raw) return null;
  const runId = typeof raw.run_id === 'string' && raw.run_id.trim()
    ? raw.run_id
    : 'pending-run';
  return normalizeTaskRunResultPayload(runId, {
    draft: (raw as { draft?: unknown }).draft,
    review: (raw as { review?: unknown }).review,
  });
}

export { hasRenderableDiscoveryContent };

async function callDiscoveryPrep(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-discovery-prep`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('Rate limited — please try again in a moment.');
    if (resp.status === 402) throw new Error('AI credits exhausted.');
    throw new Error(json?.error || `Error ${resp.status}`);
  }
  return json;
}

export function useTaskExecution() {
  const { user } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [result, setResult] = useState<TaskRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);
  /**
   * Hard guard against duplicate generations from a single click,
   * rapid double-clicks, or Strict-Mode double-renders. Each new run must
   * wait for the previous one to fully resolve.
   */
  const inFlightRef = useRef(false);
  /**
   * Tracks the run_id of the currently-active generation. Used to reject
   * `setResult` writes from a stale/superseded run that resolves AFTER a
   * reset or a newer run has started. Without this, an old completed
   * payload can clobber the new run's state.
   */
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    cancelRef.current = true;
    activeRunIdRef.current = null;
  }, []);

  const runDiscoveryPrep = useCallback(async (inputs: TaskInputs) => {
    if (!user) { toast.error('Please sign in'); return null; }
    if (inFlightRef.current) {
      // Silent reject — never spend credits on an accidental second click.
      return null;
    }
    inFlightRef.current = true;
    setIsRunning(true);
    setError(null);
    setResult(null);
    setProgressLabel(PROGRESS_LABELS.queued);
    cancelRef.current = false;

    try {
      // Phase 3A SOP "SAFE BRIDGE" — when the user has enabled the
      // Discovery Prep SOP in Strategy Settings, attach the parsed
      // contract under inputs.__sop so the orchestrator can run shadow
      // input/output validation. The server NEVER injects this into
      // prompt builders in Phase 3A — it is observation only.
      let sopAttachment: Record<string, unknown> | null = null;
      try {
        const cfg = getStrategyConfig();
        if (cfg.enabled && cfg.sopContracts.discoveryPrepFullMode.enabled) {
          const sop = cfg.sopContracts.discoveryPrepFullMode;
          sopAttachment = {
            nonNegotiables: sop.nonNegotiables,
            requiredInputs: sop.requiredInputs,
            requiredOutputs: sop.requiredOutputs,
            researchWorkflow: sop.researchWorkflow,
            mandatoryChecks: sop.mandatoryChecks,
            metricsProtocol: sop.metricsProtocol,
            pageOneCockpitRules: sop.pageOneCockpitRules,
            formattingRules: sop.formattingRules,
            buildOrder: sop.buildOrder,
            qaChecklist: sop.qaChecklist,
          };
        }
      } catch {
        // Reading localStorage must never break a run.
        sopAttachment = null;
      }
      const enrichedInputs = sopAttachment
        ? { ...inputs, __sop: sopAttachment }
        : inputs;

      // 1) Kick off the background job (returns immediately).
      const start = await callDiscoveryPrep({ action: 'generate', inputs: enrichedInputs });
      const runId: string | undefined = start?.run_id;
      if (!runId) throw new Error('Failed to start Discovery Prep job');
      activeRunIdRef.current = runId;

      // 2) Poll until completed/failed. Guard every state write with the
      //    activeRunIdRef so a superseded run (post-reset / new run /
      //    unmount) cannot overwrite fresh state with stale data.
      const isStillActive = () => activeRunIdRef.current === runId && !cancelRef.current;
      const startedAt = Date.now();
      while (isStillActive()) {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error('Discovery Prep is taking longer than expected. Please check back shortly.');
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!isStillActive()) return null;
        const status = await callDiscoveryPrep({ action: 'status', run_id: runId });
        if (!isStillActive()) return null;
        const step: string = status?.progress_step || status?.status || 'queued';
        setProgressLabel(PROGRESS_LABELS[step] || step);

        if (status?.status === 'failed') {
          throw new Error(status?.error || 'Discovery Prep generation failed');
        }
        if (status?.status === 'completed') {
          const data = sanitizeTaskRunResult({
            run_id: runId,
            draft: status?.draft,
            review: status?.review,
          });
          if (!data) throw new Error('Discovery Prep completed without a usable result');
          if (!isStillActive()) return null;
          setResult(data);
          toast.success('Discovery Prep document generated');
          return data;
        }
      }
      return null;
    } catch (e: any) {
      const msg = e.message || 'Failed to generate prep doc';
      setError(msg);
      toast.error(msg);
      return null;
    } finally {
      setIsRunning(false);
      setProgressLabel(null);
      inFlightRef.current = false;
    }
  }, [user]);

  const applyRedline = useCallback(async (runId: string, sectionId: string, proposedText: string) => {
    if (!user) return;
    try {
      const data = await callDiscoveryPrep({
        action: 'apply_redline',
        run_id: runId,
        section_id: sectionId,
        proposed_text: proposedText,
      });
      if (result) {
        const nextResult = sanitizeTaskRunResult({
          run_id: runId,
          draft: data?.draft_output ?? result.draft,
          review: data?.review_output ?? result.review,
        });
        if (!nextResult) throw new Error('Updated result is unavailable');
        setResult({
          ...nextResult,
          review: {
            ...nextResult.review,
            redlines: nextResult.review.redlines.map(r =>
              r.section_id === sectionId ? { ...r, status: 'accepted' as const } : r,
            ),
          },
        });
      }
      toast.success('Edit applied');
    } catch (e: any) {
      toast.error(e.message || 'Failed to apply');
    }
  }, [user, result]);

  const rejectRedline = useCallback((redlineId: string) => {
    if (!result) return;
    setResult({
      ...result,
      review: {
        ...result.review,
        redlines: result.review.redlines.map(r =>
          r.id === redlineId ? { ...r, status: 'rejected' as const } : r,
        ),
      },
    });
  }, [result]);

  const reset = useCallback(() => {
    // Cancel any in-flight poll AND invalidate the active run id so a
    // late-arriving completion cannot overwrite the cleared state.
    cancelRef.current = true;
    activeRunIdRef.current = null;
    inFlightRef.current = false;
    setResult(null);
    setError(null);
    setProgressLabel(null);
  }, []);

  return { isRunning, progressLabel, result, error, runDiscoveryPrep, applyRedline, rejectRedline, reset };
}
