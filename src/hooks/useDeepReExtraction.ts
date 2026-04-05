/**
 * Hook for deep re-extraction queue management.
 * Manages flagging, running, and tracking deep multi-pass re-extraction.
 * Includes lift_status classification, no_lift_reason diagnosis, and verification layer.
 */
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';

export type ReExtractQueueStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export type LiftStatus = 'meaningful_lift' | 'minor_lift' | 'no_lift' | 'regression';

export type NoLiftReason =
  | 'already_dense'
  | 'duplicate_heavy'
  | 'extractor_returned_no_new_items'
  | 'extractor_weak_output'
  | 'items_generated_but_filtered_out'
  | 'items_generated_but_deduped'
  | 'validation_too_strict'
  | 'resource_not_suitable'
  | 'unknown';

export type DominantBottleneck =
  | 'extractor_weak_output'
  | 'validation_too_strict'
  | 'dedup_too_aggressive'
  | 'already_mined'
  | 'unsuitable_content'
  | 'none'
  | 'unknown';

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
  // New: lift classification
  lift_status?: LiftStatus;
  no_lift_reason?: NoLiftReason;
  // Edge function raw metrics for diagnosis
  ef_returned_count?: number;
  ef_validated_count?: number;
  ef_saved_count?: number;
  ef_dedup_details?: Record<string, number>;
  ef_validation_rejections?: Record<string, number>;
  // Bottleneck classification
  dominant_bottleneck?: DominantBottleneck;
  // Exclusion flag
  excluded_from_future?: boolean;
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
  noLiftCount: number;
  topNoLiftReason: NoLiftReason | null;
  successRate: number;
}

function classifyLift(kiDelta: number, preKisPer1k: number, postKisPer1k: number): LiftStatus {
  if (kiDelta < 0) return 'regression';
  if (kiDelta === 0) return 'no_lift';
  if (kiDelta >= 3 || (postKisPer1k - preKisPer1k) >= 0.25) return 'meaningful_lift';
  return 'minor_lift'; // delta 1-2
}

function diagnoseNoLift(
  kiDelta: number,
  preKisPer1k: number,
  dupsSkipped: number,
  efReturned: number,
  efValidated: number,
  efSaved: number,
  contentLength: number,
): NoLiftReason | undefined {
  if (kiDelta > 0) return undefined; // has lift, no diagnosis needed

  if (preKisPer1k >= 1.5) return 'already_dense';
  if (efReturned === 0) return 'extractor_returned_no_new_items';
  if (efReturned > 0 && efValidated === 0) return 'items_generated_but_filtered_out';
  if (efValidated > 0 && efSaved === 0 && dupsSkipped > 0) return 'items_generated_but_deduped';
  if (dupsSkipped > 0 && efSaved === 0) return 'duplicate_heavy';
  if (contentLength < 1500) return 'resource_not_suitable';
  return 'unknown';
}

export function useDeepReExtraction() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<ReExtractQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [liftSummary, setLiftSummary] = useState<CoverageLiftSummary | null>(null);
  const [excludedResourceIds, setExcludedResourceIds] = useState<Set<string>>(new Set());

  const flagForReExtraction = useCallback((resources: ResourceAuditRow[], reason: string) => {
    const eligible = resources.filter(r => {
      if (r.extraction_depth_bucket === 'strong' && r.kis_per_1k_chars >= 1.5) {
        console.log(`[ReExtract] SKIP strong resource: ${r.title} (${r.kis_per_1k_chars} KIs/1k)`);
        return false;
      }
      if (r.resource_type === 'reference_only') {
        console.log(`[ReExtract] SKIP reference_only: ${r.title}`);
        return false;
      }
      if (r.content_length < 1500) {
        console.log(`[ReExtract] SKIP thin content (<1500): ${r.title} (${r.content_length} chars)`);
        return false;
      }
      if (excludedResourceIds.has(r.resource_id)) {
        console.log(`[ReExtract] SKIP excluded: ${r.title}`);
        return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      toast.info('No eligible resources to re-extract (all strong, excluded, or too thin)');
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
      ? `${newItems.length} flagged for re-extraction (${skipped} skipped — already strong, excluded, or too thin)`
      : `${newItems.length} resources flagged for deep re-extraction`;
    toast.success(msg);
  }, [excludedResourceIds]);

  const removeFromQueue = useCallback((resourceId: string) => {
    setQueue(prev => prev.filter(i => i.resource_id !== resourceId));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setLiftSummary(null);
  }, []);

  const markExcluded = useCallback((resourceId: string) => {
    setExcludedResourceIds(prev => new Set([...prev, resourceId]));
    setQueue(prev => prev.map(i =>
      i.resource_id === resourceId ? { ...i, excluded_from_future: true } : i
    ));
    toast.success('Resource excluded from future re-extraction queues');
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
    let noLiftCount = 0;
    const noLiftReasons: NoLiftReason[] = [];
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
        const efReturned = data?.model_metrics?.raw_count ?? 0;
        const efValidated = data?.model_metrics?.validated_count ?? 0;
        const efSaved = data?.persistence?.saved_count ?? 0;

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

        const postKisPer1k = item.content_length > 0
          ? Math.round((postTotal * 1000 / item.content_length) * 100) / 100
          : 0;

        const kiDelta = postTotal - item.pre_ki_count;
        const netNewUnique = Math.max(0, kiDelta);
        const activeDelta = postActive - item.pre_active_count;
        const contextDelta = postWithCtx - item.pre_context_count;

        // Lift classification
        const liftStatus = classifyLift(kiDelta, item.pre_kis_per_1k, postKisPer1k);
        const noLiftReason = diagnoseNoLift(
          kiDelta, item.pre_kis_per_1k, dupsSkipped,
          efReturned, efValidated, efSaved, item.content_length
        );

        // Quality label (human-readable)
        let qualityLabel: string | undefined;
        if (liftStatus === 'no_lift' && noLiftReason) {
          const reasonLabels: Record<NoLiftReason, string> = {
            already_dense: 'Already dense — resource well-mined',
            duplicate_heavy: 'No true lift — duplicates / overlap only',
            extractor_returned_no_new_items: 'Extractor returned no new items',
            extractor_weak_output: 'Extractor produced too few candidates',
            items_generated_but_filtered_out: 'Items generated but failed validation',
            items_generated_but_deduped: 'Items generated but all were duplicates',
            validation_too_strict: 'Validation rejected most candidates',
            resource_not_suitable: 'Resource not suitable for extraction',
            unknown: 'No lift — cause unknown',
          };
          qualityLabel = reasonLabels[noLiftReason];
        } else if (liftStatus === 'regression') {
          qualityLabel = 'Regression — KI count decreased';
        } else if (kiDelta > 0 && activeDelta <= 0) {
          qualityLabel = 'Low operational value — no new active KIs';
        }

        console.log('REEXTRACT DELTA CHECK', {
          resourceId: item.resource_id,
          title: item.title,
          preTotal: item.pre_ki_count,
          postTotal,
          rawDelta: kiDelta,
          netNewUnique,
          preKisPer1k: item.pre_kis_per_1k,
          postKisPer1k: postKisPer1k,
          liftStatus,
          noLiftReason,
          efReturned,
          efValidated,
          efSaved,
          dupsSkipped,
        });

        const isUpgrade = (item.pre_depth_bucket === 'none' || item.pre_depth_bucket === 'shallow') &&
          postKisPer1k >= 0.75;

        setQueue(prev => prev.map(i =>
          i.resource_id === item.resource_id ? {
            ...i,
            status: status as ReExtractQueueStatus,
            post_ki_count: postTotal,
            post_kis_per_1k: postKisPer1k,
            post_active_count: postActive,
            post_context_count: postWithCtx,
            ki_delta: kiDelta,
            net_new_unique: netNewUnique,
            active_delta: activeDelta,
            context_delta: contextDelta,
            passes_run: passesRun,
            duplicates_skipped: dupsSkipped,
            quality_label: qualityLabel,
            lift_status: liftStatus,
            no_lift_reason: noLiftReason,
            ef_returned_count: efReturned,
            ef_validated_count: efValidated,
            ef_saved_count: efSaved,
          } : i
        ));

        if (status === 'completed' || status === 'partial') {
          succeeded++;
          totalDelta += kiDelta;
          totalNetNew += netNewUnique;
          totalNewActive += Math.max(0, activeDelta);
          totalNewCtx += Math.max(0, contextDelta);
          if (isUpgrade) depthUpgrades++;
          if (liftStatus === 'no_lift') {
            noLiftCount++;
            if (noLiftReason) noLiftReasons.push(noLiftReason);
          }
        }
        preKisArr.push(item.pre_kis_per_1k);
        postKisArr.push(postKisPer1k);
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

    // Find top no-lift reason
    const reasonCounts = new Map<NoLiftReason, number>();
    for (const r of noLiftReasons) {
      reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
    }
    let topNoLiftReason: NoLiftReason | null = null;
    let topCount = 0;
    for (const [reason, count] of reasonCounts) {
      if (count > topCount) { topNoLiftReason = reason; topCount = count; }
    }

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
      noLiftCount,
      topNoLiftReason,
      successRate: queued.length > 0 ? Math.round((succeeded / queued.length) * 100) : 0,
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
    excludedResourceIds,
    flagForReExtraction,
    removeFromQueue,
    clearQueue,
    runDeepExtraction,
    markExcluded,
  };
}
