/**
 * Hook for persistent pipeline diagnoses and run-until-clean orchestration.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
}

/** Fetch the latest persisted diagnoses for the user */
export function usePipelineDiagnoses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pipeline-diagnoses', user?.id],
    queryFn: async () => {
      // Get latest run_id
      const { data: latest } = await supabase
        .from('pipeline_diagnoses')
        .select('run_id')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!latest || latest.length === 0) return { diagnoses: [], runId: null };

      const runId = (latest[0] as any).run_id;
      const { data } = await supabase
        .from('pipeline_diagnoses')
        .select('*')
        .eq('run_id', runId)
        .order('priority', { ascending: true });

      return {
        runId,
        diagnoses: (data || []).map((d: any) => ({
          resource_id: d.resource_id,
          title: d.resource_id, // Will be enriched client-side
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

/** Run pipeline with run-until-clean orchestration */
export function useRunPipeline() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PipelineRunResult | null>(null);
  const abortRef = useRef(false);

  const run = useCallback(async (mode: 'standard' | 'full_backlog' | 'run_until_clean' = 'standard') => {
    if (!user || running) return;
    setRunning(true);
    abortRef.current = false;
    setResult(null);

    try {
      if (mode === 'run_until_clean') {
        // Client-side loop: call batch-actionize repeatedly until converged or aborted
        let runId: string | null = null;
        let totalResult: PipelineRunResult | null = null;
        let iteration = 0;
        const maxIterations = 20;

        while (iteration < maxIterations && !abortRef.current) {
          iteration++;
          const { data, error } = await supabase.functions.invoke('batch-actionize', {
            body: { batchSize: 25, mode: 'full_backlog', run_id: runId },
          });
          if (error) throw error;

          runId = data.run_id;

          if (!totalResult) {
            totalResult = { ...data };
          } else {
            // Accumulate results
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
            // Merge breakdowns
            for (const [k, v] of Object.entries(data.failure_breakdown)) {
              totalResult.failure_breakdown[k] = (totalResult.failure_breakdown[k] || 0) + (v as number);
            }
            for (const [k, v] of Object.entries(data.trust_failure_breakdown)) {
              totalResult.trust_failure_breakdown[k] = (totalResult.trust_failure_breakdown[k] || 0) + (v as number);
            }
          }

          setResult({ ...totalResult! });

          if (data.remaining === 0 || data.total_processed === 0) {
            totalResult!.converged = true;
            break;
          }

          // Brief pause between batches
          await new Promise(r => setTimeout(r, 500));
        }

        if (totalResult) {
          setResult(totalResult);
          const pct = totalResult.total_resources > 0
            ? Math.round(((totalResult.operationalized + totalResult.operationalized_partial + totalResult.already_operationalized) / totalResult.total_resources) * 100)
            : 0;
          toast.success(`Pipeline ${totalResult.converged ? 'converged' : 'paused'}: ${pct}% operational after ${iteration} iterations`);
        }
      } else {
        // Single-shot run
        const { data, error } = await supabase.functions.invoke('batch-actionize', {
          body: { batchSize: mode === 'full_backlog' ? 50 : 15, mode },
        });
        if (error) throw error;
        setResult(data);
        toast.success(`Pipeline: ${data.operationalized} operationalized · ${data.needs_review} need review`);
      }

      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['pipeline-diagnoses'] });
    } catch (err) {
      console.error('Pipeline failed:', err);
      toast.error('Pipeline failed');
    } finally {
      setRunning(false);
    }
  }, [user, running, qc]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { run, abort, running, result };
}
