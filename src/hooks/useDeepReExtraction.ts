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
  status: 'completed' | 'failed' | 'skipped_resume' | 'pending' | 'running';
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ReExtractQueueItem {
  resource_id: string;
  title: string;
  resource_type?: string;
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

// ── POLLING INTERVAL for jobMode progress ──
const JOB_POLL_INTERVAL_MS = 3_000;

function isStaleTimestamp(timestamp?: string | null): boolean {
  if (!timestamp) return false;
  return Date.now() - new Date(timestamp).getTime() > STALE_THRESHOLD_MS;
}

function computeDepthBucket(kiCount: number, contentLength: number): 'none' | 'shallow' | 'moderate' | 'strong' {
  if (kiCount === 0) return 'none';
  const kisPer1k = contentLength > 0 ? (kiCount * 1000) / contentLength : 0;
  if (kisPer1k < 0.75) return 'shallow';
  if (kisPer1k < 1.5) return 'moderate';
  return 'strong';
}

function computeUnderExtracted(kiCount: number, contentLength: number, resourceType?: string): boolean {
  if (contentLength < 500) return false;
  if (contentLength >= 10000 && kiCount <= 6) return true;
  if (contentLength >= 5000 && kiCount <= 4) return true;
  if (contentLength >= 3000 && kiCount <= 3) return true;
  if (contentLength >= 1500 && kiCount <= 2) return true;
  const kisPer1k = contentLength > 0 ? (kiCount * 1000) / contentLength : 0;
  const isTranscript = ['transcript', 'podcast', 'audio', 'podcast_episode'].includes((resourceType || '').toLowerCase());
  return kiCount > 0 && kisPer1k < (isTranscript ? 0.5 : 0.75);
}

function summarizeBatchLedger(ledger: BatchLedgerEntry[], fallbackTotal = 0) {
  const deduped = new Map<number, BatchLedgerEntry>();
  for (const entry of ledger) {
    const existing = deduped.get(entry.batchIndex);
    if (!existing) {
      deduped.set(entry.batchIndex, entry);
      continue;
    }
    const rank = { completed: 5, running: 4, failed: 3, skipped_resume: 2, pending: 1 } as const;
    if (rank[entry.status] >= rank[existing.status]) deduped.set(entry.batchIndex, entry);
  }

  const entries = Array.from(deduped.values()).sort((a, b) => a.batchIndex - b.batchIndex);
  const inferredTotal = entries.reduce((max, entry) => Math.max(max, entry.batchIndex + 1), 0);
  const batchTotal = entries.reduce((max, entry) => Math.max(max, entry.batchIndex + 1, fallbackTotal), inferredTotal);
  const completed = entries.filter(entry => entry.status === 'completed');
  const running = entries.filter(entry => entry.status === 'running');
  const staleRunning = running.filter(entry => isStaleTimestamp(entry.startedAt));
  const activeRunning = running.filter(entry => !isStaleTimestamp(entry.startedAt));

  let nextBatchIndex: number | null = null;
  for (let index = 0; index < batchTotal; index++) {
    if (!completed.some(entry => entry.batchIndex === index)) {
      nextBatchIndex = index;
      break;
    }
  }

  const hasIncompleteBatches = batchTotal > 0 && completed.length < batchTotal;
  const state: 'not_started' | 'active' | 'stale' | 'resumable' | 'completed' = !batchTotal
    ? 'not_started'
    : !hasIncompleteBatches
      ? 'completed'
      : activeRunning.length > 0
        ? 'active'
        : staleRunning.length > 0
          ? 'stale'
          : 'resumable';

  return {
    entries,
    batchTotal,
    completedCount: completed.length,
    completedIndices: completed.map(entry => entry.batchIndex),
    nextBatchIndex,
    hasIncompleteBatches,
    state,
    activeRunning,
    staleRunning,
  };
}

function formatResumeBatchStatus(
  summary: ReturnType<typeof summarizeBatchLedger>,
): string | undefined {
  if (!summary.batchTotal) return undefined;
  if (!summary.hasIncompleteBatches) return 'completed';
  if (summary.nextBatchIndex == null) return undefined;
  if (summary.state === 'active') return `running_batch_${summary.nextBatchIndex + 1}_of_${summary.batchTotal}`;
  if (summary.state === 'stale') return `stale_resume_from_batch_${summary.nextBatchIndex + 1}_of_${summary.batchTotal}`;
  return `resume_from_batch_${summary.nextBatchIndex + 1}_of_${summary.batchTotal}`;
}

async function reconcileResourceSnapshot(resourceId: string, item: ReExtractQueueItem, totals?: { postTotal?: number; postKisPer1k?: number }) {
  const [resumeInfo, latestRunResult, runCountResult] = await Promise.all([
    getResumeInfo(resourceId),
    supabase
      .from('extraction_runs' as any)
      .select('status, started_at')
      .eq('resource_id', resourceId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('extraction_runs' as any)
      .select('*', { count: 'exact', head: true })
      .eq('resource_id', resourceId),
  ]);

  const latestRun = latestRunResult.data as any;
  const postTotal = totals?.postTotal ?? resumeInfo.ledger.reduce((max, entry) => Math.max(max, entry.cumulativeKiTotal || 0), 0);
  const postKisPer1k = totals?.postKisPer1k ?? (item.content_length > 0 ? Math.round((postTotal * 1000 / item.content_length) * 100) / 100 : 0);
  const derivedStatus = resumeInfo.hasIncompleteBatches
    ? 'partial_complete_resumable'
    : latestRun?.status || 'completed';

  await supabase.from('resources' as any).update({
    extraction_attempt_count: runCountResult.count ?? 0,
    extraction_batches_completed: resumeInfo.completedCount,
    extraction_batch_total: resumeInfo.batchTotal,
    extraction_is_resumable: resumeInfo.hasIncompleteBatches,
    extraction_batch_status: formatResumeBatchStatus(summarizeBatchLedger(resumeInfo.ledger, resumeInfo.batchTotal)) ?? (resumeInfo.hasIncompleteBatches ? 'partial_complete_resumable' : 'completed'),
    last_extraction_run_status: derivedStatus,
    current_resource_ki_count: postTotal,
    current_resource_kis_per_1k: postKisPer1k,
    kis_per_1k_chars: postKisPer1k,
    extraction_depth_bucket: computeDepthBucket(postTotal, item.content_length),
    under_extracted_flag: computeUnderExtracted(postTotal, item.content_length, item.resource_type),
    active_job_status: resumeInfo.hasIncompleteBatches ? 'partial' : latestRun?.status === 'failed' ? 'failed' : 'succeeded',
  } as any).eq('id', resourceId);

  return resumeInfo;
}

/** Query the DB batch ledger for resume state */
async function getResumeInfo(resourceId: string): Promise<{
  completedBatches: number[];
  batchTotal: number;
  isResumable: boolean;
  isStale: boolean;
  ledger: BatchLedgerEntry[];
  completedCount: number;
  hasIncompleteBatches: boolean;
  nextBatchIndex: number | null;
  state: 'not_started' | 'active' | 'stale' | 'resumable' | 'completed';
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
      status: b.status === 'completed'
        ? 'completed'
        : b.status === 'failed'
          ? 'failed'
          : b.status === 'running'
            ? 'running'
            : 'pending',
      error: b.error,
      startedAt: b.started_at,
      completedAt: b.completed_at,
    });
  }

  const summary = summarizeBatchLedger(ledger, batchTotal);
  const completedBatches = summary.completedIndices;

  return {
    completedBatches,
    batchTotal: summary.batchTotal,
    isResumable: summary.hasIncompleteBatches || isResumable || completedBatches.length > 0,
    isStale: summary.state === 'stale' || (isRunning && isStale),
    ledger: summary.entries,
    completedCount: summary.completedCount,
    hasIncompleteBatches: summary.hasIncompleteBatches,
    nextBatchIndex: summary.nextBatchIndex,
    state: summary.state,
  };
}

export function useDeepReExtraction() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<ReExtractQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [liftSummary, setLiftSummary] = useState<CoverageLiftSummary | null>(null);
  const [excludedResourceIds, setExcludedResourceIds] = useState<Set<string>>(new Set());

  const flagForReExtraction = useCallback(async (resources: ResourceAuditRow[], reason: string) => {
    console.log('[QUEUE PATH] flagForReExtraction called', {
      count: resources.length,
      reason,
      titles: resources.map(r => r.title).slice(0, 3),
    });

    // Safeguard: warn if resumable resources are hitting the queue-only path
    const resumableInBatch = resources.filter(r =>
      r.extraction_is_resumable ||
      ((r.extraction_batch_total ?? 0) > 0 && (r.extraction_batches_completed ?? 0) < (r.extraction_batch_total ?? 0))
    );
    if (resumableInBatch.length > 0) {
      console.warn('[BUG] resumable resource was routed to queue-only path', {
        resumableCount: resumableInBatch.length,
        titles: resumableInBatch.map(r => r.title),
      });
    }

    const eligible = resources.filter(r => {
      const hasIncompleteBatches = !!r.extraction_is_resumable || ((r.extraction_batch_total ?? 0) > 0 && (r.extraction_batches_completed ?? 0) < (r.extraction_batch_total ?? 0));
      if (!hasIncompleteBatches && r.extraction_depth_bucket === 'strong' && r.kis_per_1k_chars >= 1.5) return false;
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
    const newItems: ReExtractQueueItem[] = await Promise.all(eligible.map(async (r) => {
      const base: ReExtractQueueItem = {
        resource_id: r.resource_id,
        title: r.title,
        resource_type: r.resource_type,
        content_length: r.content_length,
        pre_ki_count: r.ki_count_total,
        pre_kis_per_1k: r.kis_per_1k_chars,
        pre_depth_bucket: r.extraction_depth_bucket,
        pre_active_count: r.ki_count_active,
        pre_context_count: r.ki_with_context_count,
        reason,
        status: 'queued',
      };

      if (r.content_length <= LARGE_DOC_THRESHOLD) return base;

      const resumeInfo = await getResumeInfo(r.resource_id);
      if (!resumeInfo.hasIncompleteBatches) {
        return {
          ...base,
          is_batched: resumeInfo.batchTotal > 0,
          batch_total: resumeInfo.batchTotal || undefined,
          batches_completed: resumeInfo.completedCount || undefined,
          batch_ledger: resumeInfo.ledger.length > 0 ? resumeInfo.ledger : undefined,
        };
      }

      return {
        ...base,
        status: 'partial_complete_resumable',
        is_batched: true,
        batch_total: resumeInfo.batchTotal,
        batches_completed: resumeInfo.completedCount,
        batch_status: formatResumeBatchStatus(summarizeBatchLedger(resumeInfo.ledger, resumeInfo.batchTotal)),
        batch_ledger: resumeInfo.ledger,
      };
    }));

    setQueue(prev => {
      const merged = new Map(prev.map(item => [item.resource_id, item]));
      for (const item of newItems) {
        const existing = merged.get(item.resource_id);
        merged.set(item.resource_id, { ...existing, ...item });
      }
      return Array.from(merged.values());
    });
    const msg = skipped > 0
      ? `${newItems.length} flagged for re-extraction (${skipped} skipped)`
      : `${newItems.length} resources flagged for deep re-extraction`;
    console.log('[QUEUE PATH] showing flagged toast', { msg });
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
    // ALL re-extractions now use jobMode for durability — small resources were
    // timing out on the synchronous 150s fetch path because multi-pass deep
    // extraction (core+hidden+framework) can exceed that budget.
    const isBatched = true;

    // For batched: fetch content for semantic slicing, then get resume info
    let slices: SemanticSlice[] = [{ start: 0, end: item.content_length, semanticStartMarker: '(start)', semanticEndMarker: '(end)' }];
    let resumeFrom = 0;
    let existingLedger: BatchLedgerEntry[] = [];

    if (isBatched) {
      // Get resume info from DB batch ledger FIRST
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

      // RESUME RULE: If a persisted batch ledger exists, it IS the source of truth.
      // Never recompute semantic slices — use the persisted char boundaries exactly.
      if (resumeInfo.ledger.length > 0) {
        slices = resumeInfo.ledger
          .sort((a, b) => a.batchIndex - b.batchIndex)
          .map(b => ({
            start: b.charStart,
            end: b.charEnd,
            semanticStartMarker: b.semanticStartMarker ?? `(batch ${b.batchIndex + 1} start)`,
            semanticEndMarker: b.semanticEndMarker ?? `(batch ${b.batchIndex + 1} end)`,
          }));

        // If ledger has fewer entries than batchTotal (pending batches not yet in DB),
        // we need to fill remaining slices from content
        const ledgerBatchTotal = resumeInfo.batchTotal || slices.length;
        if (slices.length < ledgerBatchTotal) {
          // Fetch content to compute remaining slices only
          const { data: resourceData } = await supabase
            .from('resources' as any)
            .select('content')
            .eq('id', item.resource_id)
            .single();
          const content = (resourceData as any)?.content || '';
          const fullSlices = computeSemanticSlices(item.content_length, content);
          // Append any slices beyond what the ledger covers
          for (let i = slices.length; i < fullSlices.length; i++) {
            slices.push(fullSlices[i]);
          }
        }

        resumeFrom = resumeInfo.nextBatchIndex ?? 0;
        if (resumeFrom >= slices.length) {
          console.log(`[ReExtract] All ${slices.length} batches already completed for "${item.title}"`);
        }
      } else {
        // No existing ledger — fresh extraction, compute semantic slices
        const { data: resourceData } = await supabase
          .from('resources' as any)
          .select('content')
          .eq('id', item.resource_id)
          .single();
        const content = (resourceData as any)?.content || '';
        slices = computeSemanticSlices(item.content_length, content);
        resumeFrom = 0;
      }

      console.log('[ReExtract] RESUME DECISION', {
        resourceId: item.resource_id,
        hasLedger: resumeInfo.ledger.length > 0,
        batchTotal: slices.length,
        completedBatches: resumeInfo.completedBatches,
        nextBatchIndex: resumeFrom,
        sourceOfTruth: resumeInfo.ledger.length > 0 ? 'ledger' : 'fresh_semantic_plan',
      });
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
          batch_status: `processing_all_batches`,
          batch_ledger: existingLedger.length > 0 ? existingLedger : [],
        } : i
      ));
      console.log(`[ReExtract] JOB MODE: "${item.title}" | ${item.content_length} chars → ${batchTotal} batches${resumeFrom > 0 ? ` (resuming from batch ${resumeFrom + 1})` : ''}`);
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

    if (isBatched) {
      // ── JOB MODE: single server call processes all remaining batches ──
      console.log('[JOB MODE CLIENT] Sending single jobMode request', {
        resourceId: item.resource_id,
        batchTotal,
        completedBefore: resumeFrom,
      });

      try {
        const response = await authenticatedFetch({
          functionName: 'extract-tactics',
          body: {
            resourceId: item.resource_id,
            deepMode: true,
            persist: true,
            jobMode: true,
          },
          componentName: 'useDeepReExtraction-jobMode',
          timeoutMs: 300_000, // 5 minute timeout for full job
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }

        totalEfSaved = data?.totalSaved ?? 0;
        batchesCompleted = data?.completedBatches ?? batchesCompleted;
        lastError = data?.error ?? null;

        console.log('[JOB MODE CLIENT] Response', {
          resourceId: item.resource_id,
          allComplete: data?.allComplete,
          batchesProcessedThisRun: data?.batchesProcessedThisRun,
          completedBatches: data?.completedBatches,
          totalBatches: data?.totalBatches,
          totalSaved: data?.totalSaved,
          stoppedByWatchdog: data?.stoppedByWatchdog,
        });

        // If watchdog stopped, the server self-invokes continuation.
        // Poll for completion.
        if (data?.stoppedByWatchdog && !data?.allComplete) {
          console.log('[JOB MODE CLIENT] Server continuing via self-invoke, polling for completion...');
          setQueue(prev => prev.map(i =>
            i.resource_id === item.resource_id ? {
              ...i,
              batch_status: `server_processing_${data.completedBatches}_of_${data.totalBatches}_done`,
            } : i
          ));

          // Poll resource status until complete
          const pollStart = Date.now();
          const MAX_POLL_TIME = 10 * 60 * 1000; // 10 min max poll
          let consecutivePartialPolls = 0;
          let lastSeenBatches = data.completedBatches ?? 0;
          const PARTIAL_GRACE_POLLS = 5; // allow 5 polls (~15s) for continuation to flip back to 'running'

          while (Date.now() - pollStart < MAX_POLL_TIME) {
            await new Promise(r => setTimeout(r, JOB_POLL_INTERVAL_MS));
            const { data: resource } = await supabase
              .from('resources' as any)
              .select('active_job_status, extraction_batches_completed, extraction_batch_total, extraction_is_resumable, current_resource_ki_count, current_resource_kis_per_1k, extraction_batch_status')
              .eq('id', item.resource_id)
              .single();

            const rData = resource as any;
            if (!rData) continue;

            batchesCompleted = rData.extraction_batches_completed ?? batchesCompleted;

            setQueue(prev => prev.map(i =>
              i.resource_id === item.resource_id ? {
                ...i,
                batches_completed: batchesCompleted,
                batch_status: rData.extraction_batch_status || `processing`,
              } : i
            ));

            // Check for terminal state
            if (rData.active_job_status === 'succeeded' || rData.extraction_batch_status === 'completed') {
              console.log('[JOB MODE CLIENT] Server completed all batches');
              totalEfSaved = rData.current_resource_ki_count - item.pre_ki_count;
              batchesCompleted = rData.extraction_batch_total ?? batchesCompleted;
              break;
            }
            if (rData.active_job_status === 'failed') {
              lastError = 'Server-side job failed';
              break;
            }
            // If resource is partial (continuation failed) or no longer resumable, treat as terminal
            if (rData.active_job_status === 'partial' && !rData.extraction_is_resumable) {
              console.log('[JOB MODE CLIENT] Server set partial (non-resumable) — treating as terminal');
              break;
            }

            // RACE CONDITION FIX: Between continuation watchdog and self-invoke dispatch,
            // status briefly flips to 'partial + resumable'. Don't exit immediately —
            // wait PARTIAL_GRACE_POLLS cycles to see if it returns to 'running'.
            if (rData.active_job_status === 'partial' && rData.extraction_is_resumable) {
              // If batches advanced since we last saw 'partial', reset grace counter
              if (batchesCompleted > lastSeenBatches) {
                consecutivePartialPolls = 0;
                lastSeenBatches = batchesCompleted;
                console.log(`[JOB MODE CLIENT] Batches advanced to ${batchesCompleted} — resetting grace window`);
              } else {
                consecutivePartialPolls++;
                console.log(`[JOB MODE CLIENT] partial+resumable poll ${consecutivePartialPolls}/${PARTIAL_GRACE_POLLS} — waiting for continuation to resume`);
              }
              if (consecutivePartialPolls >= PARTIAL_GRACE_POLLS) {
                console.log('[JOB MODE CLIENT] Continuation did not resume after grace period — stopping poll');
                break;
              }
              continue; // Don't fall through to the running check
            }

            // Reset grace counter if status is 'running' (continuation picked up)
            if (rData.active_job_status === 'running') {
              if (consecutivePartialPolls > 0) {
                console.log('[JOB MODE CLIENT] Continuation resumed (status back to running)');
              }
              consecutivePartialPolls = 0;
              lastSeenBatches = batchesCompleted;
              continue;
            }

            // Unknown non-running status — exit
            break;
          }
        }

        // Update batch total from server response
        if (data?.totalBatches) {
          setQueue(prev => prev.map(i =>
            i.resource_id === item.resource_id ? {
              ...i,
              batch_total: data.totalBatches,
              batches_completed: data.completedBatches ?? batchesCompleted,
              batch_status: data.allComplete ? 'all_batches_done' : `${data.completedBatches}/${data.totalBatches} done`,
            } : i
          ));
        }
      } catch (err: any) {
        lastError = err.message;
        console.error('[JOB MODE CLIENT] Error:', err.message);
      }

      // Show toast
      if (batchesCompleted >= batchTotal && !lastError) {
        toast.success(`All ${batchTotal} batches complete for "${item.title}".`);
      } else if (lastError) {
        toast.warning(`Processing stopped for "${item.title}": ${lastError}. ${batchesCompleted}/${batchTotal} batches done.`);
      } else {
        toast.info(`Processed ${batchesCompleted}/${batchTotal} batches for "${item.title}". Server may still be processing.`);
      }
    } else {
      // Dead path — all re-extractions now route through jobMode above.
      // Kept as safety fallback in case isBatched is ever dynamically false.
      try {
        const response = await authenticatedFetch({
          functionName: 'extract-tactics',
          body: {
            resourceId: item.resource_id,
            deepMode: true,
            persist: true,
            jobMode: true, // Always use jobMode for durability
          },
          componentName: 'useDeepReExtraction-fallback',
          timeoutMs: 300_000,
        });
        const data = await response.json();
        const error = !response.ok ? (data?.error || `HTTP ${response.status}`) : null;
        if (error) throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
        if (data?.error) throw new Error(data.error);

        totalEfReturned = data?.model_metrics?.raw_count ?? 0;
        totalEfValidated = data?.model_metrics?.validated_count ?? 0;
        totalEfSaved = data?.persistence?.saved_count ?? data?.totalSaved ?? 0;
        totalDupsSkipped = data?.persistence?.duplicates_skipped ?? 0;
        allPassesRun = data?.model_metrics?.extraction_passes_run ?? [];
      } catch (err: any) {
        lastError = err.message;
        throw err;
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

    // Determine final status: if stopped by safety limits (not error), stay resumable
    // For non-batched runs, batchesCompleted stays 0 — use lastError + kiDelta to determine outcome
    const finalStatus: ReExtractQueueStatus =
      isBatched && batchesCompleted === 0 && lastError ? 'failed'
      : !isBatched && lastError ? 'failed'
      : isBatched && batchesCompleted < batchTotal ? 'partial_complete_resumable'
      : lastError && batchesCompleted > 0 && batchesCompleted < batchTotal ? 'partial_complete_resumable'
      : lastError && batchesCompleted > 0 ? 'partial'
      : 'completed';

    try {
      await reconcileResourceSnapshot(item.resource_id, item, { postTotal, postKisPer1k });
    } catch (e) {
      console.error('[ReExtract] Snapshot reconciliation failed:', e);
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

  /**
   * Resume and immediately run extraction for a single resource.
   * This is the "Resume" CTA handler — flags + runs in one action.
   * NEVER calls flagForReExtraction. NEVER shows "flagged" toast.
   */
  const resumeAndRunSingle = useCallback(async (resource: ResourceAuditRow) => {
    console.log('[RESUME CTA BUTTON] clicked', {
      resourceId: resource.resource_id,
      title: resource.title,
      batchProgress: `${resource.extraction_batches_completed ?? '?'}/${resource.extraction_batch_total ?? '?'}`,
    });

    // Guard: already running
    const existing = queue.find(q => q.resource_id === resource.resource_id);
    if (existing?.status === 'running' || existing?.status === 'running_batched') {
      toast.info('Extraction already in progress for this resource');
      console.log('[RESUME CTA BUTTON] blocked — already running');
      return;
    }

    console.log('[RESUME PATH] calling resumeAndRunSingle', {
      resourceId: resource.resource_id,
      title: resource.title,
    });

    // Hydrate durable resume state
    const resumeInfo = await getResumeInfo(resource.resource_id);
    console.log('[RESUME CTA] hydrated durable state', {
      nextBatchIndex: resumeInfo.nextBatchIndex,
      completedCount: resumeInfo.completedCount,
      batchTotal: resumeInfo.batchTotal,
      hasIncompleteBatches: resumeInfo.hasIncompleteBatches,
    });

    // Build the queue item with resume info baked in
    const isBatched = true; // All re-extractions use jobMode
    const item: ReExtractQueueItem = {
      resource_id: resource.resource_id,
      title: resource.title,
      resource_type: resource.resource_type,
      content_length: resource.content_length,
      pre_ki_count: resource.ki_count_total,
      pre_kis_per_1k: resource.kis_per_1k_chars,
      pre_depth_bucket: resource.extraction_depth_bucket,
      pre_active_count: resource.ki_count_active,
      pre_context_count: resource.ki_with_context_count,
      reason: 'Resume — direct CTA',
      status: isBatched ? 'running_batched' : 'running',
      is_batched: isBatched,
      batch_total: resumeInfo.batchTotal || undefined,
      batches_completed: resumeInfo.completedCount || undefined,
      batch_status: resumeInfo.hasIncompleteBatches
        ? formatResumeBatchStatus(summarizeBatchLedger(resumeInfo.ledger, resumeInfo.batchTotal))
        : undefined,
      batch_ledger: resumeInfo.ledger.length > 0 ? resumeInfo.ledger : undefined,
    };

    // Add to queue in running state immediately
    setQueue(prev => {
      const merged = new Map(prev.map(q => [q.resource_id, q]));
      merged.set(item.resource_id, item);
      return Array.from(merged.values());
    });

    const nextBatch = (resumeInfo.nextBatchIndex ?? 0) + 1;
    const total = resumeInfo.batchTotal || '?';
    toast.info(`Resuming "${resource.title}" from batch ${nextBatch} of ${total}…`);

    console.log('[RESUME CTA] starting resource', {
      resourceId: resource.resource_id,
      nextBatchIndex: resumeInfo.nextBatchIndex,
      completed: resumeInfo.completedCount,
      total: resumeInfo.batchTotal,
    });

    setIsRunning(true);

    try {
      console.log('[RUNNER] runSingleExtraction invoked', {
        resourceId: item.resource_id,
        title: item.title,
        sourceCTA: 'resumeAndRunSingle',
      });
      const result = await runSingleExtraction(item);

      setQueue(prev => prev.map(i =>
        i.resource_id === item.resource_id ? {
          ...i,
          status: result.finalStatus,
          post_ki_count: item.pre_ki_count + result.kiDelta,
          post_kis_per_1k: result.postKisPer1k,
          ki_delta: result.kiDelta,
          net_new_unique: result.netNewUnique,
          lift_status: result.liftStatus,
          no_lift_reason: result.noLiftReason,
          dominant_bottleneck: result.dominantBottleneck,
        } : i
      ));

      if (result.netNewUnique > 0) {
        toast.success(`Extraction complete for "${resource.title}": +${result.netNewUnique} net new KIs`);
      } else {
        toast.info(`Extraction complete for "${resource.title}": no new KIs found`);
      }
    } catch (err: any) {
      setQueue(prev => prev.map(i =>
        i.resource_id === item.resource_id ? { ...i, status: 'failed', error: err.message } : i
      ));
      toast.error(`Extraction failed for "${resource.title}": ${err.message}`);
    }

    setIsRunning(false);
    qc.invalidateQueries({ queryKey: ['knowledge-coverage-audit'] });
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    qc.invalidateQueries({ queryKey: ['resources'] });
  }, [queue, qc]);

  return {
    queue, isRunning, liftSummary, excludedResourceIds,
    flagForReExtraction, removeFromQueue, clearQueue, runDeepExtraction, markExcluded,
    resumeAndRunSingle,
  };
}
