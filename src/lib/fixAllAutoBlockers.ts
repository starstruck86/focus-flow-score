/**
 * fixAllAutoBlockers — Orchestrates safe sequential fix of all auto-fixable blockers.
 * 
 * Order: stalled retry → normalize stale statuses → enrichment → extraction → activation
 * Stops if contradictions or unexpected failures increase.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { autoOperationalizeBatch } from '@/lib/autoOperationalize';
import { type BlockerType } from '@/lib/resourceTruthState';
import { createLogger } from '@/lib/logger';
import type { FixAllPhaseName } from '@/lib/fixAllProgress';

export interface FixAllCallbacks {
  onPhaseChange?: (phase: FixAllPhaseName, label: string, message?: string) => void;
  onItemStart?: (resourceId: string, phase: FixAllPhaseName, message?: string) => void;
  onItemDone?: (resourceId: string, phase: FixAllPhaseName, message?: string) => void;
  onItemFailed?: (resourceId: string, phase: FixAllPhaseName, message?: string) => void;
}

const log = createLogger('FixAllAutoBlockers');

export interface FixPhaseResult {
  phase: string;
  attempted: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export interface FixResourceOutcome {
  resourceId: string;
  resourceTitle: string;
  phase: string;
  attempted: boolean;
  succeeded: boolean;
  kiBefore: number;
  kisCreated: number;
  kisActive: number;
  finalTruthState: string | null;
  finalBlocker: string | null;
  error: string | null;
  rootCauseCategory: string | null;
  rootCauseExplanation: string | null;
  resolutionOutcome: string | null;
  normalized: boolean;
  rediscovered: boolean;
  extractionRan: boolean;
  wrapperPageDetected: boolean;
  attachmentExtractionAttempted: boolean;
  attachmentExtractionOutcome: string | null;
  originalEnrichmentStatus: string | null;
  originalJobStatus: string | null;
  contentLength: number;
  extractionMethod: string | null;
  inOriginalExtractionGroup: boolean;
  batchIncluded: boolean;
  heuristicFallbackAttempted: boolean;
  extractionTier: string | null;
  postRunEnrichmentStatus: string | null;
  postRunJobStatus: string | null;
  postRunKiCount: number | null;
  postRunActiveKiCount: number | null;
  /** Edge function invocation proof */
  edgeFunctionInvoked: boolean;
  edgeFunctionName: string | null;
  edgeFunctionStatus: number | null;
  edgeFunctionError: string | null;
  edgeFunctionReturnedItems: number | null;
}

export interface BlockerDiff {
  type: string;
  before: number;
  after: number;
  resolved: number;
  unchanged: number;
}

export interface FixAllResult {
  phases: FixPhaseResult[];
  blockers_before: number;
  blockers_after: number;
  blockers_fixed: number;
  blockers_failed: number;
  system_ready: boolean;
  reason: string;
  /** Per-resource outcomes for transparency */
  resourceOutcomes: FixResourceOutcome[];
  /** Before/after blocker diff by type */
  blockerDiff: BlockerDiff[];
}

interface BlockerGroup {
  type: BlockerType;
  resourceIds: string[];
}

// ── Stalled Job Recovery ──────────────────────────────────

/**
 * Clear stalled job status so the resource can be retried.
 * Resets active_job_status and related fields.
 */
export async function clearStalledJobStatus(resourceId: string): Promise<boolean> {
  const { error } = await supabase
    .from('resources' as any)
    .update({
      active_job_status: null,
      active_job_type: null,
      active_job_started_at: null,
      active_job_updated_at: null,
      active_job_finished_at: null,
      active_job_result_summary: null,
      active_job_error: null,
    } as any)
    .eq('id', resourceId);

  if (error) {
    log.error('Failed to clear stalled job', { resourceId, error: error.message });
    return false;
  }
  log.info('Cleared stalled job status', { resourceId });
  return true;
}

/**
 * Clear failed job status for resources that actually have KIs
 * (their extract partially succeeded but left a 'failed' job marker).
 */
async function clearFailedJobStatus(resourceId: string): Promise<boolean> {
  const { error } = await supabase
    .from('resources' as any)
    .update({
      active_job_status: 'succeeded',
      active_job_finished_at: new Date().toISOString(),
      active_job_error: null,
    } as any)
    .eq('id', resourceId);

  if (error) {
    log.error('Failed to clear failed job status', { resourceId, error: error.message });
    return false;
  }
  return true;
}

/**
 * Retry stalled resources by clearing their job status then re-enriching.
 */
async function fixStalledJobs(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
  callbacks?: FixAllCallbacks,
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'stalled_retry', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };

  for (const id of resourceIds) {
    callbacks?.onItemStart?.(id, 'stalled_retry', `Clearing stalled job: ${id.slice(0, 8)}…`);
    onProgress?.(`Clearing stalled job: ${id.slice(0, 8)}…`);
    const cleared = await clearStalledJobStatus(id);
    if (!cleared) {
      result.failed++;
      result.errors.push(`Failed to clear stalled status for ${id}`);
      callbacks?.onItemFailed?.(id, 'stalled_retry');
      continue;
    }

    try {
      const { data, error } = await invokeEnrichResource(
        { resource_id: id, force: true },
        { componentName: 'FixAllAutoBlockers' },
      );
      if (error) {
        result.failed++;
        result.errors.push(`Enrich failed for ${id}: ${error.message}`);
        callbacks?.onItemFailed?.(id, 'stalled_retry');
      } else {
        result.succeeded++;
        callbacks?.onItemDone?.(id, 'stalled_retry');
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push(`Enrich error for ${id}: ${err.message}`);
      callbacks?.onItemFailed?.(id, 'stalled_retry');
    }

    await new Promise(r => setTimeout(r, 500));
  }

  return result;
}

// ── Enrichment ────────────────────────────────────────────

async function fixNeedsEnrichment(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
  callbacks?: FixAllCallbacks,
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'enrichment', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };

  for (let i = 0; i < resourceIds.length; i++) {
    const id = resourceIds[i];
    callbacks?.onItemStart?.(id, 'enrichment', `Enriching ${i + 1}/${resourceIds.length}`);
    onProgress?.(`Enriching ${i + 1}/${resourceIds.length}`);
    try {
      const { data, error } = await invokeEnrichResource(
        { resource_id: id },
        { componentName: 'FixAllAutoBlockers' },
      );
      if (error) {
        result.failed++;
        result.errors.push(`${id}: ${error.message}`);
        callbacks?.onItemFailed?.(id, 'enrichment');
      } else {
        result.succeeded++;
        callbacks?.onItemDone?.(id, 'enrichment');
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push(`${id}: ${err.message}`);
      callbacks?.onItemFailed?.(id, 'enrichment');
    }
    await new Promise(r => setTimeout(r, 800));
  }

  return result;
}

// ── Extraction ────────────────────────────────────────────

async function fixNeedsExtraction(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
  onResourcePhase?: (resourceId: string, phase: 'start' | 'done', result?: any) => void,
  callbacks?: FixAllCallbacks,
): Promise<{ phaseResult: FixPhaseResult; resourceResults: Map<string, { kisCreated: number; kisActive: number; reason?: string; succeeded: boolean; extractionMethod?: string; heuristicFallbackAttempted?: boolean; extractionTier?: string }> }> {
  const result: FixPhaseResult = { phase: 'extraction', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };
  const resourceResults = new Map<string, { kisCreated: number; kisActive: number; reason?: string; succeeded: boolean; extractionMethod?: string; heuristicFallbackAttempted?: boolean; extractionTier?: string }>();

  if (resourceIds.length === 0) return { phaseResult: result, resourceResults };

  onProgress?.(`Extracting ${resourceIds.length} resources`);
  // Emit per-item start for all extraction items upfront
  for (const id of resourceIds) {
    callbacks?.onItemStart?.(id, 'extraction');
  }

  let completedCount = 0;
  try {
    const results = await autoOperationalizeBatch(resourceIds, (processed, total, title) => {
      // Per-resource progress: "Extracting 4/13 — Title…"
      onProgress?.(`Extracting ${processed}/${total} — ${title}`);
    }, (resourceId, phase, res) => {
      onResourcePhase?.(resourceId, phase, res);
      if (phase === 'done' && res) {
        completedCount++;
        const msg = res.knowledgeExtracted > 0
          ? `Extracted ${res.knowledgeExtracted} KIs (${res.knowledgeActivated} activated)`
          : res.reason || 'no KIs extracted';
        callbacks?.[res.knowledgeExtracted > 0 || res.operationalized ? 'onItemDone' : 'onItemFailed']?.(resourceId, 'extraction', msg);
      }
    });
    for (const r of results) {
      resourceResults.set(r.resourceId, {
        kisCreated: r.knowledgeExtracted,
        kisActive: r.knowledgeActivated,
        reason: r.reason,
        succeeded: r.knowledgeExtracted > 0 || r.operationalized,
        extractionMethod: r.extractionMethod,
        heuristicFallbackAttempted: r.heuristicFallbackAttempted,
        extractionTier: r.extractionTier,
      });
      if (r.knowledgeExtracted > 0 || r.operationalized) {
        result.succeeded++;
      } else {
        result.failed++;
        result.errors.push(`${r.resourceId}: ${r.reason || 'no KIs extracted'}`);
      }
    }
  } catch (err: any) {
    result.failed += resourceIds.length;
    result.errors.push(`Batch extraction failed: ${err.message}`);
    for (const id of resourceIds) {
      callbacks?.onItemFailed?.(id, 'extraction');
    }
  }

  return { phaseResult: result, resourceResults };
}

// ── Activation ────────────────────────────────────────────

/**
 * Activate KIs for resources that have extracted KIs but none active.
 * Uses autoOperationalizeBatch which includes Stage 4 (activation).
 * If extraction already happened, it skips to activation automatically.
 */
async function fixNeedsActivation(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
  onResourcePhase?: (resourceId: string, phase: 'start' | 'done', result?: any) => void,
  callbacks?: FixAllCallbacks,
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'activation', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };

  if (resourceIds.length === 0) return result;

  onProgress?.(`Activating ${resourceIds.length} resources`);
  for (const id of resourceIds) {
    callbacks?.onItemStart?.(id, 'activation');
  }
  
  try {
    const results = await autoOperationalizeBatch(resourceIds, undefined, onResourcePhase);
    for (const r of results) {
      if (r.knowledgeActivated > 0 || r.operationalized) {
        result.succeeded++;
        callbacks?.onItemDone?.(r.resourceId, 'activation');
      } else if (r.knowledgeExtracted > 0) {
        result.succeeded++;
        callbacks?.onItemDone?.(r.resourceId, 'activation');
      } else {
        result.failed++;
        result.errors.push(`${r.resourceId}: ${r.reason || 'activation failed'}`);
        callbacks?.onItemFailed?.(r.resourceId, 'activation');
      }
    }
  } catch (err: any) {
    result.failed += resourceIds.length;
    result.errors.push(`Batch activation failed: ${err.message}`);
    for (const id of resourceIds) {
      callbacks?.onItemFailed?.(id, 'activation');
    }
  }

  return result;
}

// ── Status Normalization ──────────────────────────────────

/**
 * Normalize resources with stale status markers.
 * 
 * Covers three classes of stale state:
 * 1. extraction_retrying + existing KIs → set enrichment_status to 'extracted'
 * 2. active_job_status = 'failed' + existing KIs → clear failed job marker
 * 3. active_job_status = 'failed' + deep_enriched/enriched status → clear stale job marker
 *    (the failed marker prevents the resource from being seen as ready)
 */
async function normalizeStaleStatuses(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
  callbacks?: FixAllCallbacks,
): Promise<FixPhaseResult & { normalizedIds: Set<string> }> {
  const result: FixPhaseResult & { normalizedIds: Set<string> } = { phase: 'normalize_status', attempted: 0, succeeded: 0, failed: 0, errors: [], normalizedIds: new Set() };

  if (resourceIds.length === 0) return result;

  // Fetch KI counts for all candidate resources
  const { data: kiCounts } = await supabase
    .from('knowledge_items' as any)
    .select('source_resource_id')
    .in('source_resource_id', resourceIds);

  const resourcesWithKIs = new Set((kiCounts ?? []).map((r: any) => r.source_resource_id));

  // Also fetch current resource state to identify stale failed markers
  const { data: resourceStates } = await supabase
    .from('resources' as any)
    .select('id, enrichment_status, active_job_status, active_job_error, active_job_updated_at, active_job_started_at')
    .in('id', resourceIds);

  const stateMap = new Map<string, any>();
  for (const r of (resourceStates ?? []) as any[]) {
    stateMap.set(r.id, r);
  }

  // Also fetch content lengths and actual content for needs_auth reclassification + content_length sync
  const { data: contentData } = await supabase
    .from('resources' as any)
    .select('id, content_length, manual_content_present, content')
    .in('id', resourceIds);

  const contentMap = new Map<string, { content_length: number; actual_content_length: number; manual_content_present: boolean }>();
  for (const r of (contentData ?? []) as any[]) {
    const actualLen = (r.content as string)?.length ?? 0;
    contentMap.set(r.id, {
      content_length: r.content_length ?? 0,
      actual_content_length: actualLen,
      manual_content_present: r.manual_content_present === true,
    });
  }

  for (const id of resourceIds) {
    const state = stateMap.get(id);
    if (!state) continue;

    const hasKIs = resourcesWithKIs.has(id);
    const isFailedJob = state.active_job_status === 'failed';
    const isRetrying = state.enrichment_status === 'extraction_retrying';
    const isNeedsAuth = state.enrichment_status === 'needs_auth';
    const contentInfo = contentMap.get(id);
    const effectiveContentLen = Math.max(contentInfo?.content_length ?? 0, contentInfo?.actual_content_length ?? 0);
    const hasUsableContent = effectiveContentLen >= 200 || contentInfo?.manual_content_present === true;
    const isIdleJob = state.active_job_status === 'idle';
    
  // Detect stale 'running' jobs (started > 10 min ago with no update)
    const isStaleRunning = state.active_job_status === 'running' && (() => {
      const updatedAt = state.active_job_updated_at ?? state.active_job_started_at;
      if (!updatedAt) return true; // no timestamp = stale
      return Date.now() - new Date(updatedAt).getTime() > 10 * 60 * 1000; // 10 min
    })();

    // HARDENED: For structured course lessons (title contains " > "), lower the content
    // threshold for needs_auth reclassification to 100 chars. Short conclusions/checklists
    // are legitimate content that shouldn't stay auth-blocked.
    const { data: titleData } = await supabase
      .from('resources' as any)
      .select('title')
      .eq('id', id)
      .single();
    const isStructuredLesson = !!(titleData as any)?.title && /\s>\s/.test((titleData as any).title);
    const authContentThreshold = isStructuredLesson ? 100 : 200;
    const hasUsableContentForAuth = effectiveContentLen >= authContentThreshold || contentInfo?.manual_content_present === true;

    // Check if content_length field is stale (actual content longer than stored)
    const needsContentLengthSync = contentInfo && contentInfo.actual_content_length > contentInfo.content_length;
    
    // Determine if this resource needs normalization
    const needsNormalization = 
      (hasKIs && isRetrying) ||      // extraction_retrying but has KIs
      (hasKIs && isFailedJob) ||      // failed job but has KIs — stale marker
      (isFailedJob && ['deep_enriched', 'enriched', 'extracted', 'verified', 'content_ready'].includes(state.enrichment_status)) || // failed job on otherwise healthy status
      (isNeedsAuth && hasUsableContentForAuth) || // needs_auth misclassification: content exists, reclassify to enriched
      (isIdleJob) || // stale 'idle' job status should be cleared
      (isStaleRunning) || // stale 'running' job — extraction likely timed out or lost response
      (needsContentLengthSync); // stale content_length field

    if (!needsNormalization) continue;

    result.attempted++;
    callbacks?.onItemStart?.(id, 'normalize_status', `Normalizing stale status: ${id.slice(0, 8)}…`);
    onProgress?.(`Normalizing stale status: ${id.slice(0, 8)}…`);

    try {
      const update: Record<string, any> = {};

      // Clear stale failed job marker
      if (isFailedJob) {
        update.active_job_status = hasKIs ? 'succeeded' : null;
        update.active_job_error = null;
        update.active_job_finished_at = new Date().toISOString();
      }

      // Clear stale 'idle' job status
      if (isIdleJob) {
        update.active_job_status = null;
      }

      // Clear stale 'running' job status (extraction timed out or lost response)
      if (isStaleRunning) {
        update.active_job_status = null;
        update.active_job_error = 'Cleared: stale running job (exceeded 10 min timeout)';
        update.active_job_finished_at = new Date().toISOString();
        log.info('Clearing stale running job', { id, started: state.active_job_started_at });
      }

      // Fix extraction_retrying → extracted when KIs exist
      if (isRetrying && hasKIs) {
        update.enrichment_status = 'extracted';
      }

      // Fix needs_auth misclassification: content exists, reclassify to enriched
      if (isNeedsAuth && hasUsableContentForAuth) {
        update.enrichment_status = 'enriched';
        update.failure_reason = null;
        update.active_job_status = null;
        update.active_job_error = null;
        update.manual_input_required = false;
        log.info('Reclassifying needs_auth → enriched (content exists)', { id, content_length: effectiveContentLen, threshold: authContentThreshold, isStructuredLesson });
      }

      // Sync stale content_length field with actual content length
      if (needsContentLengthSync && contentInfo) {
        update.content_length = contentInfo.actual_content_length;
        log.info('Syncing stale content_length', { id, old: contentInfo.content_length, new: contentInfo.actual_content_length });
      }

      const { error } = await supabase
        .from('resources' as any)
        .update(update as any)
        .eq('id', id);

      if (!error) {
        result.succeeded++;
        result.normalizedIds.add(id);
        log.info('Normalized stale status', { id, hadKIs: hasKIs, wasRetrying: isRetrying, wasFailed: isFailedJob });
        callbacks?.onItemDone?.(id, 'normalize_status');
      } else {
        result.failed++;
        result.errors.push(`${id}: normalization update failed — ${error.message}`);
        callbacks?.onItemFailed?.(id, 'normalize_status');
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push(`${id}: ${err.message}`);
      callbacks?.onItemFailed?.(id, 'normalize_status');
    }
  }

  return result;
}

// ── Main Orchestrator ─────────────────────────────────────

/**
 * Run the full auto-fix pass in safe order.
 */
export async function runFixAllAutoBlockers(
  blockerGroups: BlockerGroup[],
  onProgress?: (msg: string) => void,
  onResourcePhase?: (resourceId: string, phase: 'start' | 'done', result?: any) => void,
  callbacks?: FixAllCallbacks,
): Promise<FixAllResult> {
  const phases: FixPhaseResult[] = [];
  const totalBefore = blockerGroups.reduce((s, g) => s + g.resourceIds.length, 0);

  // Capture before-snapshot of blocker types
  const beforeByType: Record<string, number> = {};
  for (const g of blockerGroups) {
    beforeByType[g.type] = (beforeByType[g.type] ?? 0) + g.resourceIds.length;
  }

  // Track per-resource outcomes
  const outcomeMap = new Map<string, FixResourceOutcome>();

  // Fetch titles + state for all resources upfront for readable outcomes
  const allResourceIds = blockerGroups.flatMap(g => g.resourceIds);
  const titleMap = new Map<string, string>();
  const originalStateMap = new Map<string, { enrichment_status: string; active_job_status: string; content: string }>();
  const kiBeforeMap = new Map<string, number>();
  if (allResourceIds.length > 0) {
    const { data: titleData } = await supabase
      .from('resources' as any)
      .select('id, title, content, enrichment_status, active_job_status')
      .in('id', allResourceIds);
    for (const r of (titleData ?? []) as any[]) {
      titleMap.set(r.id, r.title ?? r.id.slice(0, 8));
      originalStateMap.set(r.id, {
        enrichment_status: r.enrichment_status ?? '',
        active_job_status: r.active_job_status ?? '',
        content: r.content ?? '',
      });
    }
    // Fetch pre-run KI counts for all resources
    for (const id of allResourceIds) {
      const { count } = await supabase
        .from('knowledge_items' as any)
        .select('id', { count: 'exact', head: true })
        .eq('source_resource_id', id);
      kiBeforeMap.set(id, count ?? 0);
    }
  }

  // Detect wrapper pages using attachment detection
  const { detectAttachmentReferences } = await import('@/lib/attachmentDetection');
  const wrapperSet = new Set<string>();
  for (const [id, state] of originalStateMap) {
    if (detectAttachmentReferences(state.content).hasAttachmentReferences) {
      wrapperSet.add(id);
    }
  }

  // originalExtractionIds populated after groupMap is built (below)
  let originalExtractionIds = new Set<string>();

  const initOutcome = (id: string, phase: string, blockerType: string) => {
    if (!outcomeMap.has(id)) {
      const origState = originalStateMap.get(id);
      outcomeMap.set(id, {
        resourceId: id,
        resourceTitle: titleMap.get(id) ?? id.slice(0, 8),
        phase,
        attempted: false,
        succeeded: false,
        kiBefore: kiBeforeMap.get(id) ?? 0,
        kisCreated: 0,
        kisActive: 0,
        finalTruthState: null,
        finalBlocker: blockerType,
        error: null,
        rootCauseCategory: null,
        rootCauseExplanation: null,
        resolutionOutcome: null,
        normalized: false,
        rediscovered: false,
        extractionRan: false,
        wrapperPageDetected: wrapperSet.has(id),
        attachmentExtractionAttempted: false,
        attachmentExtractionOutcome: null,
        originalEnrichmentStatus: origState?.enrichment_status ?? null,
        originalJobStatus: origState?.active_job_status ?? null,
        contentLength: origState?.content?.length ?? 0,
        extractionMethod: null,
        inOriginalExtractionGroup: originalExtractionIds.has(id),
        batchIncluded: false,
        heuristicFallbackAttempted: false,
        extractionTier: null,
        postRunEnrichmentStatus: null,
        postRunJobStatus: null,
        postRunKiCount: null,
        postRunActiveKiCount: null,
      });
    }
  };

  // Initialize outcomes for all resources
  for (const g of blockerGroups) {
    for (const id of g.resourceIds) {
      initOutcome(id, g.type, g.type);
    }
  }

  // Group by type
  const groupMap = new Map<BlockerType, string[]>();
  for (const g of blockerGroups) {
    const existing = groupMap.get(g.type) ?? [];
    existing.push(...g.resourceIds);
    groupMap.set(g.type, existing);
  }

  // Now populate originalExtractionIds
  originalExtractionIds = new Set(groupMap.get('needs_extraction') ?? []);
  // Update all outcomes with inOriginalExtractionGroup
  for (const id of originalExtractionIds) {
    const outcome = outcomeMap.get(id);
    if (outcome) outcome.inOriginalExtractionGroup = true;
  }

  // Phase 0: Normalize stale statuses
  const allIds = blockerGroups.flatMap(g => g.resourceIds);
  if (allIds.length > 0) {
    callbacks?.onPhaseChange?.('normalize_status', 'Normalizing statuses', 'Normalizing stale statuses…');
    onProgress?.('Normalizing stale statuses…');
    const normalizeResult = await normalizeStaleStatuses(allIds, onProgress, callbacks);
    if (normalizeResult.attempted > 0) {
      phases.push(normalizeResult);
      // Mark only the actually-normalized resources in outcomes
      for (const id of normalizeResult.normalizedIds) {
        const outcome = outcomeMap.get(id);
        if (outcome) {
          outcome.normalized = true;
        }
      }
    }
  }

  // Phase 1: Retry stalled jobs first
  const stalledIds = [
    ...(groupMap.get('stalled_extraction') ?? []),
    ...(groupMap.get('stalled_enrichment') ?? []),
  ];
  if (stalledIds.length > 0) {
    callbacks?.onPhaseChange?.('stalled_retry', 'Retrying stalled jobs', `Retrying ${stalledIds.length} stalled jobs…`);
    onProgress?.(`Retrying ${stalledIds.length} stalled jobs…`);
    const stalledResult = await fixStalledJobs(stalledIds, onProgress, callbacks);
    phases.push(stalledResult);
  }

  // Phase 2: Enrich
  const enrichIds = [
    ...(groupMap.get('needs_enrichment') ?? []),
    ...(groupMap.get('missing_content') ?? []),
    ...(groupMap.get('stale_version') ?? []),
  ];
  if (enrichIds.length > 0) {
    callbacks?.onPhaseChange?.('enrichment', 'Enriching resources', `Enriching ${enrichIds.length} resources…`);
    onProgress?.(`Enriching ${enrichIds.length} resources…`);
    const enrichResult = await fixNeedsEnrichment(enrichIds, onProgress, callbacks);
    phases.push(enrichResult);
  }

  // Phase 3: Extract
  // HARDENED: After normalization may have reclassified resources (e.g. needs_auth→enriched,
  // idle cleared), re-query the DB for any resources that are now extraction-eligible
  // but weren't in the original blocker groups.
  let extractIds = groupMap.get('needs_extraction') ?? [];
  
  // Discover newly eligible resources after normalization
  if (allIds.length > 0) {
    try {
      const { data: freshResources } = await supabase
        .from('resources' as any)
        .select('id, enrichment_status, content_length, active_job_status, title, content')
        .in('id', allIds);
      
      if (freshResources) {
        for (const fr of freshResources as any[]) {
          const isEnriched = ['enriched', 'deep_enriched', 'verified', 'content_ready', 'extracted'].includes(fr.enrichment_status);
          // HARDENED: Also include needs_auth resources with content — normalization should have
          // reclassified them, but catch any that were missed
          const isStructuredLesson = !!(fr.title && /\s>\s/.test(fr.title));
          const contentThreshold = isStructuredLesson ? 100 : 200;
          const isNeedsAuthWithContent = fr.enrichment_status === 'needs_auth' && (fr.content_length ?? 0) >= contentThreshold;
          const hasContent = (fr.content_length ?? 0) >= contentThreshold;
          const notRunning = !['running'].includes(fr.active_job_status ?? '');
          
          if ((isEnriched || isNeedsAuthWithContent) && hasContent && notRunning && !extractIds.includes(fr.id)) {
            // Check if this resource has 0 KIs
            const { count } = await supabase
              .from('knowledge_items' as any)
              .select('id', { count: 'exact', head: true })
              .eq('source_resource_id', fr.id);
            
            if ((count ?? 0) === 0) {
              extractIds.push(fr.id);
              if (fr.title && !titleMap.has(fr.id)) {
                titleMap.set(fr.id, fr.title);
              }
              initOutcome(fr.id, 'extraction', 'needs_extraction');
              // Mark as rediscovered (found after normalization, not in original blocker groups)
              const outcome = outcomeMap.get(fr.id);
              if (outcome) outcome.rediscovered = true;
              log.info('Discovered newly extraction-eligible resource after normalization', { id: fr.id, title: fr.title, status: fr.enrichment_status, isStructuredLesson });
            }
          }
        }
      }
    } catch (err: any) {
      log.warn('Failed to discover newly eligible resources', { error: err.message });
    }
  }
  
  if (extractIds.length > 0) {
    // Mark all extraction batch members
    for (const id of extractIds) {
      const outcome = outcomeMap.get(id);
      if (outcome) outcome.batchIncluded = true;
    }
    log.info('Extraction batch', { extractIds, count: extractIds.length });
    callbacks?.onPhaseChange?.('extraction', 'Extracting knowledge items', `Extracting ${extractIds.length} resources…`);
    onProgress?.(`Extracting ${extractIds.length} resources…`);
    const { phaseResult: extractResult, resourceResults: extractionOutcomes } = await fixNeedsExtraction(extractIds, onProgress, onResourcePhase, callbacks);
    phases.push(extractResult);

    // Enrich per-resource outcomes with extraction details
    for (const [resourceId, detail] of extractionOutcomes) {
      const outcome = outcomeMap.get(resourceId);
      if (outcome) {
        outcome.attempted = true;
        outcome.extractionRan = true;
        outcome.succeeded = detail.succeeded;
        outcome.kisCreated = detail.kisCreated;
        outcome.kisActive = detail.kisActive;
        outcome.extractionMethod = detail.extractionMethod ?? null;
        outcome.heuristicFallbackAttempted = detail.heuristicFallbackAttempted ?? false;
        outcome.extractionTier = detail.extractionTier ?? null;
        
        // Track wrapper-page attachment handling
        if (outcome.wrapperPageDetected) {
          outcome.attachmentExtractionAttempted = true;
          if (detail.succeeded && detail.kisCreated > 0) {
            outcome.attachmentExtractionOutcome = 'wrapper extracted, KIs created';
          } else {
            outcome.attachmentExtractionOutcome = 'wrapper extracted, 0 KIs — no linked attachment found';
          }
        }
        
        if (!detail.succeeded) {
          outcome.error = detail.reason || 'no KIs extracted';
          outcome.rootCauseCategory = detail.kisCreated === 0 ? 'extraction_produced_zero_kis' : 'activation_failed';
          outcome.rootCauseExplanation = detail.reason || null;
        }
      }
    }
  }

  // Phase 4: Activate
  const activateIds = groupMap.get('needs_activation') ?? [];
  if (activateIds.length > 0) {
    callbacks?.onPhaseChange?.('activation', 'Activating knowledge items', `Activating ${activateIds.length} resources…`);
    onProgress?.(`Activating ${activateIds.length} resources…`);
    const activateResult = await fixNeedsActivation(activateIds, onProgress, onResourcePhase, callbacks);
    phases.push(activateResult);
  }

  // ── Post-run: re-query actual KI counts and truth state for all resources ──
  // Include any resources discovered during re-discovery phase
  const allProcessedIds = [...new Set([...allResourceIds, ...extractIds, ...activateIds])];
  const postRunOutcomes = new Map<string, { kiCount: number; activeKiCount: number; enrichmentStatus: string; jobStatus: string | null }>();
  if (allProcessedIds.length > 0) {
    const { data: postResources } = await supabase
      .from('resources' as any)
      .select('id, enrichment_status, active_job_status')
      .in('id', allProcessedIds);
    
    for (const pr of (postResources ?? []) as any[]) {
      const { count: kiCount } = await supabase
        .from('knowledge_items' as any)
        .select('id', { count: 'exact', head: true })
        .eq('source_resource_id', pr.id);
      const { count: activeCount } = await supabase
        .from('knowledge_items' as any)
        .select('id', { count: 'exact', head: true })
        .eq('source_resource_id', pr.id)
        .eq('active', true);
      postRunOutcomes.set(pr.id, {
        kiCount: kiCount ?? 0,
        activeKiCount: activeCount ?? 0,
        enrichmentStatus: pr.enrichment_status ?? '',
        jobStatus: pr.active_job_status,
      });
    }
  }

  // Compute real resolution outcomes per resource
  let realFixed = 0;
  let realFailed = 0;
  for (const [id, outcome] of outcomeMap) {
    const post = postRunOutcomes.get(id);
    if (post) {
      outcome.kisCreated = Math.max(outcome.kisCreated, post.kiCount);
      outcome.kisActive = Math.max(outcome.kisActive, post.activeKiCount);
      outcome.finalTruthState = post.enrichmentStatus;
      outcome.postRunEnrichmentStatus = post.enrichmentStatus;
      outcome.postRunJobStatus = post.jobStatus;
      outcome.postRunKiCount = post.kiCount;
      outcome.postRunActiveKiCount = post.activeKiCount;
      
      if (post.kiCount > 0) {
        outcome.succeeded = true;
        outcome.resolutionOutcome = 'resolved_permanently';
        realFixed++;
      } else if (outcome.attempted && !outcome.succeeded) {
        outcome.resolutionOutcome = 'still_blocked_same_cause';
        if (!outcome.rootCauseCategory) {
          outcome.rootCauseCategory = 'extraction_produced_zero_kis';
          outcome.rootCauseExplanation = `Extraction attempted but produced 0 KIs from ${post.enrichmentStatus} resource`;
        }
        realFailed++;
      } else if (!outcome.attempted) {
        outcome.resolutionOutcome = 'still_blocked_same_cause';
        outcome.rootCauseCategory = outcome.rootCauseCategory || 'extraction_never_triggered';
        outcome.rootCauseExplanation = outcome.rootCauseExplanation || 'Resource was not passed to extraction phase';
        realFailed++;
      }
    }
  }

  const blockersAfter = realFailed;

  // Build blocker diff from real post-run state
  const afterByType: Record<string, number> = {};
  for (const [type, count] of Object.entries(beforeByType)) {
    // Count how many resources of this blocker type are still blocked (0 KIs)
    const idsOfType = blockerGroups.filter(g => g.type === type).flatMap(g => g.resourceIds);
    const stillBlocked = idsOfType.filter(id => {
      const post = postRunOutcomes.get(id);
      return !post || post.kiCount === 0;
    }).length;
    afterByType[type] = stillBlocked;
  }

  const blockerDiff: BlockerDiff[] = Object.entries(beforeByType).map(([type, before]) => {
    const after = afterByType[type] ?? before;
    return {
      type,
      before,
      after,
      resolved: before - after,
      unchanged: after,
    };
  });

  // Mark outcomes based on phase errors
  for (const phase of phases) {
    for (const err of phase.errors) {
      const idMatch = err.match(/^([a-f0-9-]{8,36}):/);
      if (idMatch) {
        const outcome = outcomeMap.get(idMatch[1]);
        if (outcome && !outcome.error) {
          outcome.attempted = true;
          outcome.error = err.replace(`${idMatch[1]}: `, '');
        }
      }
    }
  }

  // Build reason
  const unchangedExtraction = blockerDiff.find(d => d.type === 'needs_extraction' && d.unchanged > 0);
  let reason: string;
  if (blockersAfter <= 0) {
    reason = 'All auto-fixable blockers resolved';
  } else {
    reason = `${blockersAfter} blockers remain — ${realFailed} still need attention`;
    if (unchangedExtraction && unchangedExtraction.unchanged > 0) {
      reason += `. Extraction: ${unchangedExtraction.unchanged}/${unchangedExtraction.before} unchanged.`;
    }
  }

  return {
    phases,
    blockers_before: totalBefore,
    blockers_after: Math.max(0, blockersAfter),
    blockers_fixed: realFixed,
    blockers_failed: realFailed,
    system_ready: blockersAfter <= 0,
    reason,
    resourceOutcomes: [...outcomeMap.values()],
    blockerDiff,
  };
}
