/**
 * Hook for deep re-extraction queue management.
 * Manages flagging, running, and tracking deep multi-pass re-extraction.
 * Includes second verification layer: net-unique, active, and context KI tracking.
 */
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';

export type ReExtractQueueStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface ReExtractQueueItem {
  resource_id: string;
  title: string;
  content_length: number;
  pre_ki_count: number;
  pre_kis_per_1k: number;
  pre_depth_bucket: string;
  pre_active_count: number;
  pre_context_count: number;
  reason: string;
  status: ReExtractQueueStatus;
  // Post-extraction metrics (from fresh DB query)
  post_ki_count?: number;
  post_kis_per_1k?: number;
  post_active_count?: number;
  post_context_count?: number;
  ki_delta?: number;
  net_new_unique?: number;
  active_delta?: number;
  context_delta?: number;
  passes_run?: string[];
  duplicates_skipped?: number;
  quality_label?: string;
  error?: string;
}

export interface CoverageLiftSummary {
  resourcesProcessed: number;
  resourcesSucceeded: number;
  totalKiDelta: number;
  totalNetNewUnique: number;
  totalNewActive: number;
  totalNewWithContext: number;
  avgKisPer1kBefore: number;
  avgKisPer1kAfter: number;
  depthUpgrades: number;
}

export function useDeepReExtraction() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<ReExtractQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [liftSummary, setLiftSummary] = useState<CoverageLiftSummary | null>(null);

  const flagForReExtraction = useCallback((resources: ResourceAuditRow[], reason: string) => {
    // Guardrails: skip already-strong, reference_only resources
    const eligible = resources.filter(r => {
      if (r.extraction_depth_bucket === 'strong' && r.kis_per_1k_chars >= 1.5) {
        console.log(`[ReExtract] SKIP strong resource: ${r.title} (${r.kis_per_1k_chars} KIs/1k)`);
        return false;
      }
      if (r.resource_type === 'reference_only') {
        console.log(`[ReExtract] SKIP reference_only: ${r.title}`);
        return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      toast.info('No eligible resources to re-extract (all strong or excluded)');
      return;
    }

    const skipped = resources.length - eligible.length;
    const newItems: ReExtractQueueItem[] = eligible.map(r => ({
      resource_id: r.resource_id,
      title: r.title,
      content_length: r.content_length,
      pre_ki_count: r.ki_count_total,
      pre_kis_per_1k: r.kis_per_1k_chars,
      pre_depth_bucket: r.extraction_depth_bucket,
      pre_active_count: r.ki_count_active,
      pre_context_count: r.ki_with_context_count,
      reason,
      status: 'queued' as const,
    }));
    setQueue(prev => {
      const existingIds = new Set(prev.map(i => i.resource_id));
      const unique = newItems.filter(i => !existingIds.has(i.resource_id));
      return [...prev, ...unique];
    });
    const msg = skipped > 0
      ? `${newItems.length} flagged for re-extraction (${skipped} skipped — already strong or excluded)`
      : `${newItems.length} resources flagged for deep re-extraction`;
    toast.success(msg);
  }, []);

  const removeFromQueue = useCallback((resourceId: string) => {
    setQueue(prev => prev.filter(i => i.resource_id !== resourceId));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setLiftSummary(null);
  }, []);

  const runDeepExtraction = useCallback(async () => {
    const queued = queue.filter(i => i.status === 'queued');
    if (queued.length === 0) return;

    setIsRunning(true);
    let succeeded = 0;
    let totalDelta = 0;
    let totalNetNew = 0;
    let totalNewActive = 0;
    let totalNewCtx = 0;
    let depthUpgrades = 0;
    const preKisArr: number[] = [];
    const postKisArr: number[] = [];

    for (const item of queued) {
      setQueue(prev => prev.map(i =>
        i.resource_id === item.resource_id ? { ...i, status: 'running' as const } : i
      ));

      try {
        const { data, error } = await supabase.functions.invoke('extract-tactics', {
          body: {
            resourceId: item.resource_id,
            deepMode: true,
            persist: true,
          },
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        const passesRun = data?.model_metrics?.extraction_passes_run ?? [];
        const dupsSkipped = data?.persistence?.duplicates_skipped ?? 0;
        const status = data?.persistence?.status ?? 'completed';

        // === VERIFICATION LAYER: fresh DB query for all metrics ===
        const { data: postKIs, error: postErr } = await supabase
          .from('knowledge_items' as any)
          .select('id, active, applies_to_contexts')
          .eq('source_resource_id', item.resource_id);

        if (postErr) throw new Error(postErr.message);

        const postTotal = postKIs?.length ?? 0;
        const postActive = postKIs?.filter((k: any) => k.active).length ?? 0;
        const postWithCtx = postKIs?.filter((k: any) =>
          k.active && k.applies_to_contexts && (k.applies_to_contexts as string[]).length > 0
        ).length ?? 0;

        const currentKisPer1k = item.content_length > 0
          ? Math.round((postTotal * 1000 / item.content_length) * 100) / 100
          : 0;

        const kiDelta = postTotal - item.pre_ki_count;
        // Net new unique = raw delta minus duplicates that were skipped
        // (since dupsSkipped were fingerprint matches that didn't create rows)
        const netNewUnique = Math.max(0, kiDelta);
        const activeDelta = postActive - item.pre_active_count;
        const contextDelta = postWithCtx - item.pre_context_count;

        // Quality labels
        let qualityLabel: string | undefined;
        if (kiDelta > 0 && netNewUnique === 0) {
          qualityLabel = 'No true lift — duplicates / overlap only';
        } else if (kiDelta > 0 && activeDelta <= 0) {
          qualityLabel = 'Low operational value — no new active KIs';
        } else if (kiDelta === 0 && dupsSkipped > 0) {
          qualityLabel = 'No true lift — duplicates / overlap only';
        }

        console.log('DELTA CHECK', {
          resourceId: item.resource_id,
          pre: item.pre_ki_count,
          post: postTotal,
          delta: kiDelta,
          netNewUnique,
          activeDelta,
          contextDelta,
          dupsSkipped,
          qualityLabel,
        });

        const isUpgrade = (item.pre_depth_bucket === 'none' || item.pre_depth_bucket === 'shallow') &&
          currentKisPer1k >= 0.75;

        setQueue(prev => prev.map(i =>
          i.resource_id === item.resource_id ? {
            ...i,
            status: status as ReExtractQueueStatus,
            post_ki_count: postTotal,
            post_kis_per_1k: currentKisPer1k,
            post_active_count: postActive,
            post_context_count: postWithCtx,
            ki_delta: kiDelta,
            net_new_unique: netNewUnique,
            active_delta: activeDelta,
            context_delta: contextDelta,
            passes_run: passesRun,
            duplicates_skipped: dupsSkipped,
            quality_label: qualityLabel,
          } : i
        ));

        if (status === 'completed' || status === 'partial') {
          succeeded++;
          totalDelta += kiDelta;
          totalNetNew += netNewUnique;
          totalNewActive += Math.max(0, activeDelta);
          totalNewCtx += Math.max(0, contextDelta);
          if (isUpgrade) depthUpgrades++;
        }
        preKisArr.push(item.pre_kis_per_1k);
        postKisArr.push(currentKisPer1k);
      } catch (err: any) {
        setQueue(prev => prev.map(i =>
          i.resource_id === item.resource_id ? {
            ...i,
            status: 'failed' as const,
            error: err.message,
          } : i
        ));
        preKisArr.push(item.pre_kis_per_1k);
        postKisArr.push(item.pre_kis_per_1k);
      }
    }

    const avgBefore = preKisArr.length > 0 ? preKisArr.reduce((a, b) => a + b, 0) / preKisArr.length : 0;
    const avgAfter = postKisArr.length > 0 ? postKisArr.reduce((a, b) => a + b, 0) / postKisArr.length : 0;

    setLiftSummary({
      resourcesProcessed: queued.length,
      resourcesSucceeded: succeeded,
      totalKiDelta: totalDelta,
      totalNetNewUnique: totalNetNew,
      totalNewActive: totalNewActive,
      totalNewWithContext: totalNewCtx,
      avgKisPer1kBefore: Math.round(avgBefore * 100) / 100,
      avgKisPer1kAfter: Math.round(avgAfter * 100) / 100,
      depthUpgrades,
    });

    setIsRunning(false);
    qc.invalidateQueries({ queryKey: ['knowledge-coverage-audit'] });
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    qc.invalidateQueries({ queryKey: ['resources'] });
    toast.success(`Deep re-extraction complete: ${succeeded}/${queued.length} succeeded, +${totalNetNew} net new KIs`);
  }, [queue, qc]);

  return {
    queue,
    isRunning,
    liftSummary,
    flagForReExtraction,
    removeFromQueue,
    clearQueue,
    runDeepExtraction,
  };
}
