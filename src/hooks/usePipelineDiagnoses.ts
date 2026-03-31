/**
 * Hook for persistent pipeline diagnoses, run-until-clean orchestration,
 * stall detection, and single-resource retry (standard vs strict).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useCallback, useRef, useState } from 'react';
import type { ResourceDiagnosis, TerminalState } from '@/components/knowledge/ResourceFailureQueue';

export interface PipelineRunResult {
  run_id: string;
  total_resources: number;
  total_processed: number;
  already_operationalized: number;
  remaining: number;
  iterations_run: number;
  converged: boolean;

  operationalized: number;
  operationalized_partial: number;
  needs_review: number;
  reference_supporting: number;
  reference_needs_judgment: number;
  reference_low_leverage: number;
  content_missing: number;

  knowledge_created: number;
  knowledge_activated: number;
  templates_created: number;
  examples_created: number;
  duplicates_suppressed: number;
  trust_rejected: number;

  failure_breakdown: Record<string, number>;
  trust_failure_breakdown: Record<string, number>;
  diagnoses: ResourceDiagnosis[];

  // Stall detection
  stall_detected: boolean;
  stall_reason: string | null;
  no_progress_iterations: number;
  repeated_failure_resources: number;
  stalled_resources: number;
}

/** Fetch the latest persisted diagnoses for the user, reconciling with pipeline_runs */
export function usePipelineDiagnoses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pipeline-diagnoses', user?.id],
    queryFn: async () => {
      // Get latest pipeline_run
      const { data: latestRun } = await supabase
        .from('pipeline_runs' as any)
        .select('id, status, stall_reason, no_progress_iterations, stalled_resources, repeated_failure_resources, total_resources, total_processed, converged, summary_json')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!latestRun || latestRun.length === 0) return { diagnoses: [], runId: null, stallInfo: null, reconciledSummary: null };

      const run = latestRun[0] as any;
      const runId = run.id;

      // Fetch unresolved diagnoses for this run
      const { data: unresolvedDiags } = await supabase
        .from('pipeline_diagnoses')
        .select('*')
        .eq('run_id', runId)
        .eq('resolution_status', 'unresolved')
        .order('priority', { ascending: true });

      // Fetch ALL diagnoses for this run (for reconciled counts)
      const { data: allDiags } = await supabase
        .from('pipeline_diagnoses')
        .select('terminal_state, resolution_status')
        .eq('run_id', runId);

      // Reconcile counts from actual persisted diagnoses
      const reconciledSummary = {
        operationalized: 0,
        operationalized_partial: 0,
        needs_review: 0,
        reference_supporting: 0,
        reference_needs_judgment: 0,
        reference_low_leverage: 0,
        content_missing: 0,
        resolved: 0,
        total: (allDiags || []).length,
      };
      for (const d of (allDiags || []) as any[]) {
        if (d.resolution_status === 'resolved') {
          reconciledSummary.resolved++;
          continue;
        }
        const key = d.terminal_state as keyof typeof reconciledSummary;
        if (key in reconciledSummary && typeof reconciledSummary[key] === 'number') {
          (reconciledSummary as any)[key]++;
        }
      }

      return {
        runId,
        stallInfo: {
          stall_reason: run.stall_reason,
          no_progress_iterations: run.no_progress_iterations || 0,
          stalled_resources: run.stalled_resources || 0,
          repeated_failure_resources: run.repeated_failure_resources || 0,
        },
        reconciledSummary,
        runMeta: {
          status: run.status,
          total_resources: run.total_resources,
          total_processed: run.total_processed,
          converged: run.converged,
          summary_json: run.summary_json,
        },
        diagnoses: (unresolvedDiags || []).map((d: any) => ({
          resource_id: d.resource_id,
          title: d.resource_id, // enriched client-side
          route: d.route || '',
          terminal_state: d.terminal_state as TerminalState,
          failure_reasons: d.failure_reasons || [],
          retryable: d.retryable || false,
          recommended_fix: d.recommended_fix || '',
          priority: d.priority as 'high' | 'medium' | 'low',
          human_review_required: d.human_review_required || false,
          assets_created: d.assets_created || { knowledge_items: 0, knowledge_activated: 0, templates: 0, examples: 0 },
          trust_failures: d.trust_failures || [],
          most_similar_existing: d.most_similar_existing,
        })),
      };
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

/** Run pipeline with run-until-clean orchestration + stall detection */
export function useRunPipeline() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PipelineRunResult | null>(null);
  const abortRef = useRef(false);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    qc.invalidateQueries({ queryKey: ['resources'] });
    qc.invalidateQueries({ queryKey: ['pipeline-diagnoses'] });
  }, [qc]);

  /** Retry a single resource (standard mode) */
  const rerunResource = useCallback(async (resourceId: string) => {
    if (!user) return;
    try {
      toast.info('Retrying extraction…');
      const { data, error } = await supabase.functions.invoke('batch-actionize', {
        body: { batchSize: 1, mode: 'standard', resource_id: resourceId, strict: false },
      });
      if (error) throw error;
      const diag = data?.diagnoses?.[0];
      if (diag?.terminal_state === 'operationalized' || diag?.terminal_state === 'operationalized_partial') {
        toast.success(`Retry succeeded: ${diag.terminal_state}`);
      } else {
        toast.warning(`Retry completed: ${diag?.terminal_state || 'unknown'} — ${(diag?.failure_reasons || []).join(', ')}`);
      }
      invalidateAll();
    } catch (err) {
      console.error('Retry failed:', err);
      toast.error('Retry failed');
    }
  }, [user, invalidateAll]);

  /** Retry a single resource with strict extraction */
  const rerunStrict = useCallback(async (resourceId: string) => {
    if (!user) return;
    try {
      toast.info('Strict retry: different prompt, chunking, and model…');
      const { data, error } = await supabase.functions.invoke('batch-actionize', {
        body: { batchSize: 1, mode: 'standard', resource_id: resourceId, strict: true },
      });
      if (error) throw error;
      const diag = data?.diagnoses?.[0];
      if (diag?.terminal_state === 'operationalized' || diag?.terminal_state === 'operationalized_partial') {
        toast.success(`Strict retry succeeded: ${diag.terminal_state}`);
      } else {
        toast.warning(`Strict retry completed: ${diag?.terminal_state || 'unknown'} — ${(diag?.failure_reasons || []).join(', ')}`);
      }
      invalidateAll();
    } catch (err) {
      console.error('Strict retry failed:', err);
      toast.error('Strict retry failed');
    }
  }, [user, invalidateAll]);

  const run = useCallback(async (mode: 'standard' | 'full_backlog' | 'run_until_clean' = 'standard') => {
    if (!user || running) return;
    setRunning(true);
    abortRef.current = false;
    setResult(null);

    try {
      if (mode === 'run_until_clean') {
        let runId: string | null = null;
        let totalResult: PipelineRunResult | null = null;
        let iteration = 0;
        const maxIterations = 20;

        // Stall detection state
        let noProgressCount = 0;
        let prevRemaining = Infinity;
        const failureSignatures = new Map<string, number>();

        while (iteration < maxIterations && !abortRef.current) {
          iteration++;
          const { data, error } = await supabase.functions.invoke('batch-actionize', {
            body: { batchSize: 25, mode: 'full_backlog', run_id: runId },
          });
          if (error) throw error;

          runId = data.run_id;

          if (!totalResult) {
            totalResult = {
              ...data,
              stall_detected: false,
              stall_reason: null,
              no_progress_iterations: 0,
              repeated_failure_resources: 0,
              stalled_resources: 0,
            };
          } else {
            totalResult.total_processed += data.total_processed;
            totalResult.operationalized += data.operationalized;
            totalResult.operationalized_partial += data.operationalized_partial;
            totalResult.needs_review += data.needs_review;
            totalResult.reference_supporting += data.reference_supporting;
            totalResult.reference_needs_judgment += data.reference_needs_judgment;
            totalResult.reference_low_leverage += data.reference_low_leverage;
            totalResult.content_missing += data.content_missing;
            totalResult.knowledge_created += data.knowledge_created;
            totalResult.knowledge_activated += data.knowledge_activated;
            totalResult.templates_created += data.templates_created;
            totalResult.examples_created += data.examples_created;
            totalResult.duplicates_suppressed += data.duplicates_suppressed;
            totalResult.trust_rejected += data.trust_rejected;
            totalResult.remaining = data.remaining;
            totalResult.converged = data.converged;
            totalResult.iterations_run = iteration;
            totalResult.diagnoses = [...totalResult.diagnoses, ...data.diagnoses];
            for (const [k, v] of Object.entries(data.failure_breakdown)) {
              totalResult.failure_breakdown[k] = (totalResult.failure_breakdown[k] || 0) + (v as number);
            }
            for (const [k, v] of Object.entries(data.trust_failure_breakdown)) {
              totalResult.trust_failure_breakdown[k] = (totalResult.trust_failure_breakdown[k] || 0) + (v as number);
            }
          }

          // ── Stall detection ──────────────────────────
          const currentRemaining = data.remaining ?? 0;

          if (currentRemaining >= prevRemaining && data.total_processed > 0) {
            noProgressCount++;
          } else {
            noProgressCount = 0;
          }
          prevRemaining = currentRemaining;

          for (const diag of (data.diagnoses || [])) {
            const sig = `${diag.resource_id}:${(diag.failure_reasons || []).sort().join(',')}`;
            failureSignatures.set(sig, (failureSignatures.get(sig) || 0) + 1);
          }
          const repeatedFailures = [...failureSignatures.values()].filter(c => c >= 2).length;

          totalResult!.no_progress_iterations = noProgressCount;
          totalResult!.repeated_failure_resources = repeatedFailures;
          totalResult!.stalled_resources = currentRemaining;

          let stallReason: string | null = null;
          if (noProgressCount >= 3) {
            stallReason = `No progress for ${noProgressCount} consecutive iterations — remaining resources may require manual intervention.`;
          } else if (repeatedFailures > 10) {
            stallReason = `${repeatedFailures} resources failing repeatedly with same reasons — pipeline has plateaued.`;
          } else if (data.total_processed === 0 && currentRemaining > 0) {
            stallReason = 'No resources processed this iteration despite remaining backlog — all may be resolved or blocked.';
          }

          if (stallReason) {
            totalResult!.stall_detected = true;
            totalResult!.stall_reason = stallReason;
            totalResult!.converged = false;

            await supabase.from('pipeline_runs' as any).update({
              stall_reason: stallReason,
              no_progress_iterations: noProgressCount,
              stalled_resources: currentRemaining,
              repeated_failure_resources: repeatedFailures,
              status: 'stalled',
            } as any).eq('id', runId);

            setResult({ ...totalResult! });
            toast.warning(`Pipeline stalled: ${stallReason}`);
            break;
          }

          setResult({ ...totalResult! });

          if (data.remaining === 0 || data.total_processed === 0) {
            totalResult!.converged = true;
            await supabase.from('pipeline_runs' as any).update({
              status: 'completed',
              completed_at: new Date().toISOString(),
            } as any).eq('id', runId);
            break;
          }

          await new Promise(r => setTimeout(r, 500));
        }

        if (totalResult) {
          setResult(totalResult);
          const pct = totalResult.total_resources > 0
            ? Math.round(((totalResult.operationalized + totalResult.operationalized_partial + totalResult.already_operationalized) / totalResult.total_resources) * 100)
            : 0;
          if (!totalResult.stall_detected) {
            toast.success(`Pipeline ${totalResult.converged ? 'converged' : 'paused'}: ${pct}% operational after ${iteration} iterations`);
          }
        }
      } else {
        // Single-shot run
        const { data, error } = await supabase.functions.invoke('batch-actionize', {
          body: { batchSize: mode === 'full_backlog' ? 50 : 15, mode },
        });
        if (error) throw error;
        setResult({
          ...data,
          stall_detected: false,
          stall_reason: null,
          no_progress_iterations: 0,
          repeated_failure_resources: 0,
          stalled_resources: 0,
        });
        toast.success(`Pipeline: ${data.operationalized} operationalized · ${data.needs_review} need review`);
      }

      invalidateAll();
    } catch (err) {
      console.error('Pipeline failed:', err);
      toast.error('Pipeline failed');
    } finally {
      setRunning(false);
    }
  }, [user, running, invalidateAll]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { run, abort, running, result, rerunResource, rerunStrict };
}
