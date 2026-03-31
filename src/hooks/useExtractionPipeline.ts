/**
 * useExtractionPipeline — hook for automated batch extraction pipeline.
 */
import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  runBatchExtraction,
  scoreAllResources,
  getPipelineStats,
  type BatchJobResult,
  type PipelineStats,
  type JobScope,
} from '@/lib/extractionPipeline';

export function useExtractionPipeline() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [lastResult, setLastResult] = useState<BatchJobResult | null>(null);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    qc.invalidateQueries({ queryKey: ['resources'] });
  }, [qc]);

  const loadStats = useCallback(async () => {
    if (!user) return;
    setIsLoadingStats(true);
    try {
      const s = await getPipelineStats(user.id);
      setStats(s);
    } finally {
      setIsLoadingStats(false);
    }
  }, [user]);

  const runBatch = useCallback(async (
    scope: JobScope,
    options?: { source?: string; tag?: string; max?: number },
  ): Promise<BatchJobResult | null> => {
    if (!user || isRunning) return null;
    setIsRunning(true);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runBatchExtraction({
        scope,
        userId: user.id,
        filterSource: options?.source,
        filterTag: options?.tag,
        maxResources: options?.max ?? 100,
        signal: controller.signal,
        onProgress: (current, total, title) => setProgress({ current, total, title }),
      });

      setLastResult(result);
      invalidate();

      if (result.succeeded > 0) {
        toast.success(`Extracted ${result.succeeded} of ${result.total} resources`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} resource(s) failed extraction`);
      }

      return result;
    } catch (err: any) {
      toast.error(`Pipeline error: ${err.message}`);
      return null;
    } finally {
      setIsRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [user, isRunning, invalidate]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    toast.info('Pipeline cancelled');
  }, []);

  const scoreAll = useCallback(async () => {
    if (!user) return;
    setIsRunning(true);
    try {
      const { scored } = await scoreAllResources(user.id);
      toast.success(`Scored ${scored} resources`);
      invalidate();
      await loadStats();
    } finally {
      setIsRunning(false);
    }
  }, [user, invalidate, loadStats]);

  return {
    runBatch,
    cancel,
    scoreAll,
    loadStats,
    isRunning,
    progress,
    lastResult,
    stats,
    isLoadingStats,
  };
}
