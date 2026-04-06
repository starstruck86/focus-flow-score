/**
 * Hook for deep re-extraction queue management.
 * Manages flagging, running, and tracking deep multi-pass re-extraction.
 * Includes lift_status classification, no_lift_reason diagnosis, and verification layer.
 * Supports resumable batched extraction for large documents with server-side batch ledger.
 */
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { toast } from 'sonner';
import { computeSemanticSlices, LARGE_DOC_THRESHOLD, type SemanticSlice } from '@/lib/semanticChunking';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';

export type ReExtractQueueStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  | 'running_batched' | 'partial_complete_resumable';

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

export interface BatchLedgerEntry {
  batchIndex: number;
  charStart: number;
  charEnd: number;
  semanticStartMarker?: string;
  semanticEndMarker?: string;
  raw: number;
  validated: number;
  saved: number;
  dupsSkipped: number;
  cumulativeKiTotal: number;
  status: 'completed' | 'failed' | 'skipped_resume' | 'pending';
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

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
  lift_status?: LiftStatus;
  no_lift_reason?: NoLiftReason;
  ef_returned_count?: number;
  ef_validated_count?: number;
  ef_saved_count?: number;
  ef_dedup_details?: Record<string, number>;
  ef_validation_rejections?: Record<string, number>;
  dominant_bottleneck?: DominantBottleneck;
  excluded_from_future?: boolean;
  batch_total?: number;
  batches_completed?: number;
  batch_status?: string;
  is_batched?: boolean;
  batch_ledger?: BatchLedgerEntry[];
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
  topBottleneck: DominantBottleneck | null;
  successRate: number;
}

function classifyLift(kiDelta: number, preKisPer1k: number, postKisPer1k: number): LiftStatus {
  if (kiDelta < 0) return 'regression';
  if (kiDelta === 0) return 'no_lift';
  if (kiDelta >= 3 || (postKisPer1k - preKisPer1k) >= 0.25) return 'meaningful_lift';
  return 'minor_lift';
}

function diagnoseNoLift(
  kiDelta: number, preKisPer1k: number, dupsSkipped: number,
  efReturned: number, efValidated: number, efSaved: number, contentLength: number,
): NoLiftReason | undefined {
  if (kiDelta > 0) return undefined;
  if (preKisPer1k >= 1.5) return 'already_dense';
  if (efReturned === 0) return 'extractor_returned_no_new_items';
  if (efReturned > 0 && efReturned < 3) return 'extractor_weak_output';
  if (efReturned > 0 && efValidated === 0) return 'validation_too_strict';
  if (efReturned > 0 && efValidated > 0 && efValidated < efReturned * 0.3) return 'validation_too_strict';
  if (efValidated > 0 && efSaved === 0 && dupsSkipped > 0) return 'items_generated_but_deduped';
  if (dupsSkipped > 0 && efSaved === 0) return 'duplicate_heavy';
  if (efReturned > 0 && efValidated === 0) return 'items_generated_but_filtered_out';
  if (contentLength < 1500) return 'resource_not_suitable';
  return 'unknown';
}

function classifyBottleneck(
  efReturned: number, efValidated: number, efSaved: number,
  dupsSkipped: number, preKisPer1k: number, kiDelta: number,
): DominantBottleneck {
  if (kiDelta > 0) return 'none';
  if (preKisPer1k >= 1.5) return 'already_mined';
  if (efReturned === 0) return 'extractor_weak_output';
  if (efReturned > 0 && efValidated < efReturned * 0.3) return 'validation_too_strict';
  if (efValidated > 0 && efSaved === 0 && dupsSkipped > 0) return 'dedup_too_aggressive';
  if (efReturned < 3) return 'extractor_weak_output';
  return 'unknown';
}

// ── STALE JOB DETECTION ──
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** Query the DB batch ledger for resume state */
async function getResumeInfo(resourceId: string): Promise<{
  completedBatches: number[];
  batchTotal: number;
  isResumable: boolean;
  isStale: boolean;
  ledger: BatchLedgerEntry[];
}> {
  // Check resource-level state
  const { data: resource } = await supabase
    .from('resources' as any)
    .select('extraction_batches_completed, extraction_batch_total, extraction_is_resumable, extraction_batch_status, active_job_status, updated_at')
    .eq('id', resourceId)
    .single();

  const rData = resource as any;
  const batchTotal = rData?.extraction_batch_total ?? 0;
  const isResumable = rData?.extraction_is_resumable ?? false;

  // Check for stale running state
  const isRunning = rData?.active_job_status === 'running' || (rData?.extraction_batch_status || '').startsWith('running');
  const lastUpdate = rData?.updated_at ? new Date(rData.updated_at).getTime() : 0;
  const isStale = isRunning && (Date.now() - lastUpdate > STALE_THRESHOLD_MS);

  // Query actual batch ledger from DB
  const { data: batches } = await supabase
    .from('extraction_batches' as any)
    .select('*')
    .eq('resource_id', resourceId)
    .order('batch_index', { ascending: true });

  const completedBatches: number[] = [];
  const ledger: BatchLedgerEntry[] = [];

  for (const b of (batches || []) as any[]) {
    ledger.push({
      batchIndex: b.batch_index,
      charStart: b.char_start,
      charEnd: b.char_end,
      semanticStartMarker: b.semantic_start_marker,
      semanticEndMarker: b.semantic_end_marker,
      raw: b.raw_count ?? 0,
      validated: b.validated_count ?? 0,
      saved: b.saved_count ?? 0,
      dupsSkipped: b.duplicates_skipped ?? 0,
      cumulativeKiTotal: b.cumulative_resource_ki_count ?? 0,
      status: b.status === 'completed' ? 'completed' : b.status === 'failed' ? 'failed' : 'pending',
      error: b.error,
      startedAt: b.started_at,
      completedAt: b.completed_at,
    });
    if (b.status === 'completed') completedBatches.push(b.batch_index);
  }

  return { completedBatches, batchTotal, isResumable: isResumable || completedBatches.length > 0, isStale, ledger };
}

export function useDeepReExtraction() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<ReExtractQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [liftSummary, setLiftSummary] = useState<CoverageLiftSummary | null>(null);
  const [excludedResourceIds, setExcludedResourceIds] = useState<Set<string>>(new Set());

  const flagForReExtraction = useCallback((resources: ResourceAuditRow[], reason: string) => {
    const eligible = resources.filter(r => {
      if (r.extraction_depth_bucket === 'strong' && r.kis_per_1k_chars >= 1.5) return false;
      if (r.resource_type === 'reference_only') return false;
      if (r.content_length < 1500) return false;
      if (excludedResourceIds.has(r.resource_id)) return false;
      return true;
    });

    if (eligible.length === 0) {
      toast.info('No eligible resources to re-extract');
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
      ? `${newItems.length} flagged for re-extraction (${skipped} skipped)`
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

  const runSingleExtraction = async (item: ReExtractQueueItem): Promise<{
    kiDelta: number; netNewUnique: number; activeDelta: number; contextDelta: number;
    postKisPer1k: number; liftStatus: LiftStatus; noLiftReason?: NoLiftReason;
    dominantBottleneck: DominantBottleneck; finalStatus: ReExtractQueueStatus;
  }> => {
    const isBatched = item.content_length > LARGE_DOC_THRESHOLD;

    // For batched: fetch content for semantic slicing, then get resume info
    let slices: SemanticSlice[] = [{ start: 0, end: item.content_length, semanticStartMarker: '(start)', semanticEndMarker: '(end)' }];
    let resumeFrom = 0;
    let existingLedger: BatchLedgerEntry[] = [];

    if (isBatched) {
      // Fetch resource content for semantic boundary detection
      const { data: resourceData } = await supabase
        .from('resources' as any)
        .select('content')
        .eq('id', item.resource_id)
        .single();
      const content = (resourceData as any)?.content || '';
      slices = computeSemanticSlices(item.content_length, content);

      // Get resume info from DB batch ledger
      const resumeInfo = await getResumeInfo(item.resource_id);
      existingLedger = resumeInfo.ledger;

      // If stale, clear the stale lock first
      if (resumeInfo.isStale) {
        console.log(`[ReExtract] Clearing stale lock for "${item.title}"`);
        await supabase.from('resources' as any).update({
          active_job_status: 'stale_cleared',
          extraction_batch_status: 'stale_cleared',
        } as any).eq('id', item.resource_id);
      }

      // Determine which batches to skip (already completed in DB)
      // Only skip if the batch config matches (same total)
      if (resumeInfo.batchTotal === slices.length && resumeInfo.completedBatches.length > 0) {
        resumeFrom = Math.max(...resumeInfo.completedBatches) + 1;
        if (resumeFrom >= slices.length) {
          // All batches already done — nothing to do
          console.log(`[ReExtract] All ${slices.length} batches already completed for "${item.title}"`);
          // Still run verification
        }
      }
    }

    const batchTotal = slices.length;

    if (isBatched) {
      setQueue(prev => prev.map(i =>
        i.resource_id === item.resource_id ? {
          ...i,
          status: 'running_batched' as const,
          is_batched: true,
          batch_total: batchTotal,
          batches_completed: resumeFrom,
          batch_status: resumeFrom > 0
            ? `resuming_from_batch_${resumeFrom + 1}_of_${batchTotal}`
            : `running_batch_1_of_${batchTotal}`,
          batch_ledger: existingLedger.length > 0 ? existingLedger : [],
        } : i
      ));
      console.log(`[ReExtract] BATCHED: "${item.title}" | ${item.content_length} chars → ${batchTotal} semantic batches${resumeFrom > 0 ? ` (resuming from batch ${resumeFrom + 1})` : ''}`);
    } else {
      setQueue(prev => prev.map(i =>
        i.resource_id === item.resource_id ? { ...i, status: 'running' as const } : i
      ));
    }

    let totalEfReturned = 0;
    let totalEfValidated = 0;
    let totalEfSaved = 0;
    let totalDupsSkipped = 0;
    let allPassesRun: string[] = [];
    let lastError: string | null = null;
    let batchesCompleted = resumeFrom;
    const batchLedger: BatchLedgerEntry[] = [...existingLedger];

    // Add skipped-resume entries for batches already in DB
    for (let i = existingLedger.length; i < resumeFrom; i++) {
      batchLedger.push({
        batchIndex: i,
        charStart: slices[i]?.start ?? 0,
        charEnd: slices[i]?.end ?? 0,
        raw: 0, validated: 0, saved: 0, dupsSkipped: 0,
        cumulativeKiTotal: 0,
        status: 'skipped_resume',
      });
    }

    for (let batchIdx = resumeFrom; batchIdx < slices.length; batchIdx++) {
      const slice = slices[batchIdx];

      if (isBatched) {
        setQueue(prev => prev.map(i =>
          i.resource_id === item.resource_id ? {
            ...i,
            batches_completed: batchIdx,
            batch_status: `running_batch_${batchIdx + 1}_of_${batchTotal}`,
          } : i
        ));
      }

      try {
        const bodyPayload: Record<string, any> = {
          resourceId: item.resource_id,
          deepMode: true,
          persist: true,
        };

        if (isBatched) {
          bodyPayload.contentSliceStart = slice.start;
          bodyPayload.contentSliceEnd = slice.end;
          bodyPayload.batchIndex = batchIdx;
          bodyPayload.batchTotal = batchTotal;
          bodyPayload.semanticStartMarker = slice.semanticStartMarker;
          bodyPayload.semanticEndMarker = slice.semanticEndMarker;
        }

        const response = await authenticatedFetch({
          functionName: 'extract-tactics',
          body: bodyPayload,
          componentName: 'useDeepReExtraction',
          timeoutMs: 150_000,
        });
        const data = await response.json();
        const error = !response.ok ? (data?.error || `HTTP ${response.status}`) : null;

        if (error) throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
        if (data?.error) throw new Error(data.error);

        const efReturned = data?.model_metrics?.raw_count ?? 0;
        const efValidated = data?.model_metrics?.validated_count ?? 0;
        const efSaved = data?.persistence?.saved_count ?? 0;
        const dupsSkipped = data?.persistence?.duplicates_skipped ?? 0;
        const passesRun = data?.model_metrics?.extraction_passes_run ?? [];
        const cumulativeTotal = data?.persistence?.current_resource_ki_count ?? 0;

        totalEfReturned += efReturned;
        totalEfValidated += efValidated;
        totalEfSaved += efSaved;
        totalDupsSkipped += dupsSkipped;
        allPassesRun = [...new Set([...allPassesRun, ...passesRun])];
        batchesCompleted++;

        const entry: BatchLedgerEntry = {
          batchIndex: batchIdx,
          charStart: slice.start,
          charEnd: slice.end,
          semanticStartMarker: slice.semanticStartMarker,
          semanticEndMarker: slice.semanticEndMarker,
          raw: efReturned,
          validated: efValidated,
          saved: efSaved,
          dupsSkipped,
          cumulativeKiTotal: cumulativeTotal,
          status: 'completed',
          completedAt: new Date().toISOString(),
        };

        // Replace or add ledger entry
        const existingIdx = batchLedger.findIndex(e => e.batchIndex === batchIdx);
        if (existingIdx >= 0) batchLedger[existingIdx] = entry;
        else batchLedger.push(entry);

        console.log(`[ReExtract] Batch ${batchIdx + 1}/${batchTotal} complete: ${efReturned} raw → ${efValidated} valid → ${efSaved} saved | cumulative: ${cumulativeTotal} KIs`);

        if (isBatched) {
          setQueue(prev => prev.map(i =>
            i.resource_id === item.resource_id ? {
              ...i,
              batches_completed: batchIdx + 1,
              batch_ledger: [...batchLedger],
              batch_status: (batchIdx + 1) >= batchTotal
                ? 'all_batches_done'
                : `running_batch_${batchIdx + 2}_of_${batchTotal}`,
            } : i
          ));
        }

        // Delay between batches
        if (batchIdx < slices.length - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (err: any) {
        lastError = err.message;
        console.error(`[ReExtract] Batch ${batchIdx + 1}/${batchTotal} failed:`, err.message);

        const errorEntry: BatchLedgerEntry = {
          batchIndex: batchIdx,
          charStart: slice.start,
          charEnd: slice.end,
          raw: 0, validated: 0, saved: 0, dupsSkipped: 0,
          cumulativeKiTotal: 0,
          status: 'failed',
          error: err.message,
        };

        const existingIdx = batchLedger.findIndex(e => e.batchIndex === batchIdx);
        if (existingIdx >= 0) batchLedger[existingIdx] = errorEntry;
        else batchLedger.push(errorEntry);

        // For batched: continue to next batch, don't abort entirely
        if (!isBatched) throw err;
      }
    }

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

    const liftStatus = classifyLift(kiDelta, item.pre_kis_per_1k, postKisPer1k);
    const noLiftReason = diagnoseNoLift(
      kiDelta, item.pre_kis_per_1k, totalDupsSkipped,
      totalEfReturned, totalEfValidated, totalEfSaved, item.content_length
    );
    const dominantBottleneck = classifyBottleneck(
      totalEfReturned, totalEfValidated, totalEfSaved, totalDupsSkipped, item.pre_kis_per_1k, kiDelta
    );

    const finalStatus: ReExtractQueueStatus =
      batchesCompleted === 0 ? 'failed'
      : isBatched && batchesCompleted < batchTotal && batchesCompleted > 0 ? 'partial_complete_resumable'
      : lastError && batchesCompleted > 0 ? 'partial'
      : 'completed';

    // Reconcile resource snapshot from actual run history
    if (isBatched) {
      try {
        const { count: runCount } = await supabase
          .from('extraction_runs' as any)
          .select('*', { count: 'exact', head: true })
          .eq('resource_id', item.resource_id);

        await supabase.from('resources' as any).update({
          extraction_attempt_count: runCount ?? 0,
          current_resource_ki_count: postTotal,
          current_resource_kis_per_1k: postKisPer1k,
          extraction_is_resumable: batchesCompleted < batchTotal,
          extraction_batches_completed: batchesCompleted,
          extraction_batch_total: batchTotal,
          active_job_status: finalStatus === 'completed' ? 'succeeded' : finalStatus === 'partial_complete_resumable' ? 'partial' : 'failed',
        } as any).eq('id', item.resource_id);
      } catch (e) {
        console.error('[ReExtract] Snapshot reconciliation failed:', e);
      }
    }

    console.log('REEXTRACT DELTA CHECK', {
      resourceId: item.resource_id, title: item.title,
      batched: isBatched, batchesCompleted, batchTotal, resumedFrom: resumeFrom,
      preTotal: item.pre_ki_count, postTotal,
      rawDelta: kiDelta, netNewUnique,
      totalEfReturned, totalEfValidated, totalEfSaved, totalDupsSkipped,
      liftStatus, dominantBottleneck,
    });

    setQueue(prev => prev.map(i =>
      i.resource_id === item.resource_id ? {
        ...i,
        status: finalStatus,
        post_ki_count: postTotal,
        post_kis_per_1k: postKisPer1k,
        post_active_count: postActive,
        post_context_count: postWithCtx,
        ki_delta: kiDelta,
        net_new_unique: netNewUnique,
        active_delta: activeDelta,
        context_delta: contextDelta,
        passes_run: allPassesRun,
        duplicates_skipped: totalDupsSkipped,
        lift_status: liftStatus,
        no_lift_reason: noLiftReason,
        ef_returned_count: totalEfReturned,
        ef_validated_count: totalEfValidated,
        ef_saved_count: totalEfSaved,
        dominant_bottleneck: dominantBottleneck,
        batch_total: isBatched ? batchTotal : undefined,
        batches_completed: isBatched ? batchesCompleted : undefined,
        batch_status: isBatched ? (batchesCompleted >= batchTotal ? 'completed' : 'partial') : undefined,
        is_batched: isBatched,
        batch_ledger: batchLedger.length > 0 ? batchLedger : undefined,
        error: lastError || undefined,
      } : i
    ));

    return { kiDelta, netNewUnique, activeDelta, contextDelta, postKisPer1k, liftStatus, noLiftReason, dominantBottleneck, finalStatus };
  };

  const runDeepExtraction = useCallback(async () => {
    const queued = queue.filter(i => i.status === 'queued' || i.status === 'partial_complete_resumable');
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
    const bottlenecks: DominantBottleneck[] = [];
    const preKisArr: number[] = [];
    const postKisArr: number[] = [];

    for (const item of queued) {
      try {
        const result = await runSingleExtraction(item) as any;

        if (result.finalStatus === 'completed' || result.finalStatus === 'partial' || result.finalStatus === 'partial_complete_resumable') {
          succeeded++;
          totalDelta += result.kiDelta;
          totalNetNew += result.netNewUnique;
          totalNewActive += Math.max(0, result.activeDelta);
          totalNewCtx += Math.max(0, result.contextDelta);
          const isUpgrade = (item.pre_depth_bucket === 'none' || item.pre_depth_bucket === 'shallow') &&
            result.postKisPer1k >= 0.75;
          if (isUpgrade) depthUpgrades++;
          if (result.liftStatus === 'no_lift') {
            noLiftCount++;
            if (result.noLiftReason) noLiftReasons.push(result.noLiftReason);
            if (result.dominantBottleneck && result.dominantBottleneck !== 'none') bottlenecks.push(result.dominantBottleneck);
          }
        }
        preKisArr.push(item.pre_kis_per_1k);
        postKisArr.push(result.postKisPer1k);
      } catch (err: any) {
        setQueue(prev => prev.map(i =>
          i.resource_id === item.resource_id ? { ...i, status: 'failed' as const, error: err.message } : i
        ));
        preKisArr.push(item.pre_kis_per_1k);
        postKisArr.push(item.pre_kis_per_1k);
      }
    }

    const avgBefore = preKisArr.length > 0 ? preKisArr.reduce((a, b) => a + b, 0) / preKisArr.length : 0;
    const avgAfter = postKisArr.length > 0 ? postKisArr.reduce((a, b) => a + b, 0) / postKisArr.length : 0;

    const reasonCounts = new Map<NoLiftReason, number>();
    for (const r of noLiftReasons) reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
    let topNoLiftReason: NoLiftReason | null = null;
    let topCount = 0;
    for (const [reason, count] of reasonCounts) {
      if (count > topCount) { topNoLiftReason = reason; topCount = count; }
    }

    const bnCounts = new Map<DominantBottleneck, number>();
    for (const b of bottlenecks) bnCounts.set(b, (bnCounts.get(b) || 0) + 1);
    let topBottleneck: DominantBottleneck | null = null;
    let topBnCount = 0;
    for (const [bn, count] of bnCounts) {
      if (count > topBnCount) { topBottleneck = bn; topBnCount = count; }
    }

    setLiftSummary({
      resourcesProcessed: queued.length, resourcesSucceeded: succeeded,
      totalKiDelta: totalDelta, totalNetNewUnique: totalNetNew,
      totalNewActive: totalNewActive, totalNewWithContext: totalNewCtx,
      avgKisPer1kBefore: Math.round(avgBefore * 100) / 100,
      avgKisPer1kAfter: Math.round(avgAfter * 100) / 100,
      depthUpgrades, noLiftCount, topNoLiftReason, topBottleneck,
      successRate: queued.length > 0 ? Math.round((succeeded / queued.length) * 100) : 0,
    });

    setIsRunning(false);
    qc.invalidateQueries({ queryKey: ['knowledge-coverage-audit'] });
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    qc.invalidateQueries({ queryKey: ['resources'] });
    if (totalNetNew > 0) {
      toast.success(`Deep re-extraction complete: ${succeeded}/${queued.length} succeeded, +${totalNetNew} net new KIs`);
    } else if (noLiftCount === succeeded && succeeded > 0) {
      toast.warning(`${succeeded}/${queued.length} runs completed, but produced no measurable coverage lift`);
    } else {
      toast.info(`Deep re-extraction complete: ${succeeded}/${queued.length} succeeded, +${totalNetNew} net new KIs`);
    }
  }, [queue, qc]);

  return {
    queue, isRunning, liftSummary, excludedResourceIds,
    flagForReExtraction, removeFromQueue, clearQueue, runDeepExtraction, markExcluded,
  };
}
