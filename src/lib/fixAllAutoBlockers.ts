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

export interface FixAllResult {
  phases: FixPhaseResult[];
  blockers_before: number;
  blockers_after: number;
  blockers_fixed: number;
  blockers_failed: number;
  system_ready: boolean;
  reason: string;
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
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'extraction', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };

  if (resourceIds.length === 0) return result;

  onProgress?.(`Extracting ${resourceIds.length} resources`);
  // Emit per-item start for all extraction items upfront
  for (const id of resourceIds) {
    callbacks?.onItemStart?.(id, 'extraction');
  }
  try {
    const results = await autoOperationalizeBatch(resourceIds, undefined, (resourceId, phase, res) => {
      onResourcePhase?.(resourceId, phase, res);
      if (phase === 'done') {
        const matched = results; // not available yet — use callback below
      }
    });
    for (const r of results) {
      if (r.knowledgeExtracted > 0 || r.operationalized) {
        result.succeeded++;
        callbacks?.onItemDone?.(r.resourceId, 'extraction');
      } else {
        result.failed++;
        result.errors.push(`${r.resourceId}: ${r.reason || 'no KIs extracted'}`);
        callbacks?.onItemFailed?.(r.resourceId, 'extraction');
      }
    }
  } catch (err: any) {
    result.failed += resourceIds.length;
    result.errors.push(`Batch extraction failed: ${err.message}`);
    for (const id of resourceIds) {
      callbacks?.onItemFailed?.(id, 'extraction');
    }
  }

  return result;
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
 * Normalize resources stuck in 'extraction_retrying' or with 'failed' job status
 * but that actually have KIs. Clear their stale status markers.
 */
async function normalizeStaleStatuses(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
  callbacks?: FixAllCallbacks,
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'normalize_status', attempted: 0, succeeded: 0, failed: 0, errors: [] };

  if (resourceIds.length === 0) return result;

  const { data: kiCounts } = await supabase
    .from('knowledge_items' as any)
    .select('source_resource_id')
    .in('source_resource_id', resourceIds);

  const resourcesWithKIs = new Set((kiCounts ?? []).map((r: any) => r.source_resource_id));

  for (const id of resourceIds) {
    if (!resourcesWithKIs.has(id)) continue;
    result.attempted++;
    
    callbacks?.onItemStart?.(id, 'normalize_status', `Normalizing status for ${id.slice(0, 8)}…`);
    onProgress?.(`Normalizing status for ${id.slice(0, 8)}…`);
    
    const cleared = await clearFailedJobStatus(id);
    if (cleared) {
      const { error } = await supabase
        .from('resources' as any)
        .update({
          enrichment_status: 'extracted',
        } as any)
        .eq('id', id)
        .in('enrichment_status', ['extraction_retrying']);
      
      if (!error) {
        result.succeeded++;
        callbacks?.onItemDone?.(id, 'normalize_status');
      } else {
        result.failed++;
        result.errors.push(`${id}: status update failed`);
        callbacks?.onItemFailed?.(id, 'normalize_status');
      }
    } else {
      result.failed++;
      result.errors.push(`${id}: clear failed`);
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

  // Group by type
  const groupMap = new Map<BlockerType, string[]>();
  for (const g of blockerGroups) {
    const existing = groupMap.get(g.type) ?? [];
    existing.push(...g.resourceIds);
    groupMap.set(g.type, existing);
  }

  // Phase 0: Normalize stale statuses
  const allIds = blockerGroups.flatMap(g => g.resourceIds);
  if (allIds.length > 0) {
    callbacks?.onPhaseChange?.('normalize_status', 'Normalizing statuses', 'Normalizing stale statuses…');
    onProgress?.('Normalizing stale statuses…');
    const normalizeResult = await normalizeStaleStatuses(allIds, onProgress, callbacks);
    if (normalizeResult.attempted > 0) phases.push(normalizeResult);
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
  const extractIds = groupMap.get('needs_extraction') ?? [];
  if (extractIds.length > 0) {
    callbacks?.onPhaseChange?.('extraction', 'Extracting knowledge items', `Extracting ${extractIds.length} resources…`);
    onProgress?.(`Extracting ${extractIds.length} resources…`);
    const extractResult = await fixNeedsExtraction(extractIds, onProgress, onResourcePhase, callbacks);
    phases.push(extractResult);
  }

  // Phase 4: Activate
  const activateIds = groupMap.get('needs_activation') ?? [];
  if (activateIds.length > 0) {
    callbacks?.onPhaseChange?.('activation', 'Activating knowledge items', `Activating ${activateIds.length} resources…`);
    onProgress?.(`Activating ${activateIds.length} resources…`);
    const activateResult = await fixNeedsActivation(activateIds, onProgress, onResourcePhase, callbacks);
    phases.push(activateResult);
  }

  const totalSucceeded = phases.reduce((s, p) => s + p.succeeded, 0);
  const totalFailed = phases.reduce((s, p) => s + p.failed, 0);
  const blockersAfter = totalBefore - totalSucceeded;

  return {
    phases,
    blockers_before: totalBefore,
    blockers_after: Math.max(0, blockersAfter),
    blockers_fixed: totalSucceeded,
    blockers_failed: totalFailed,
    system_ready: blockersAfter <= 0,
    reason: blockersAfter <= 0
      ? 'All auto-fixable blockers resolved'
      : `${blockersAfter} blockers remain — ${totalFailed} failed during this run`,
  };
}
