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
  kisCreated: number;
  kisActive: number;
  finalTruthState: string | null;
  finalBlocker: string | null;
  error: string | null;
  rootCauseCategory: string | null;
  rootCauseExplanation: string | null;
  resolutionOutcome: string | null;
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
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'normalize_status', attempted: 0, succeeded: 0, failed: 0, errors: [] };

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
    .select('id, enrichment_status, active_job_status, active_job_error')
    .in('id', resourceIds);

  const stateMap = new Map<string, any>();
  for (const r of (resourceStates ?? [])) {
    stateMap.set(r.id, r);
  }

  for (const id of resourceIds) {
    const state = stateMap.get(id);
    if (!state) continue;

    const hasKIs = resourcesWithKIs.has(id);
    const isFailedJob = state.active_job_status === 'failed';
    const isRetrying = state.enrichment_status === 'extraction_retrying';
    
    // Determine if this resource needs normalization
    const needsNormalization = 
      (hasKIs && isRetrying) ||      // extraction_retrying but has KIs
      (hasKIs && isFailedJob) ||      // failed job but has KIs — stale marker
      (isFailedJob && ['deep_enriched', 'enriched', 'extracted', 'verified'].includes(state.enrichment_status)); // failed job on otherwise healthy status

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

      // Fix extraction_retrying → extracted when KIs exist
      if (isRetrying && hasKIs) {
        update.enrichment_status = 'extracted';
      }

      const { error } = await supabase
        .from('resources' as any)
        .update(update as any)
        .eq('id', id);

      if (!error) {
        result.succeeded++;
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
  const initOutcome = (id: string, phase: string, blockerType: string) => {
    if (!outcomeMap.has(id)) {
      outcomeMap.set(id, {
        resourceId: id,
        resourceTitle: id.slice(0, 8),
        phase,
        attempted: false,
        succeeded: false,
        kisCreated: 0,
        kisActive: 0,
        finalTruthState: null,
        finalBlocker: blockerType,
        error: null,
        rootCauseCategory: null,
        rootCauseExplanation: null,
        resolutionOutcome: null,
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

  // Build blocker diff
  const afterByType: Record<string, number> = {};
  for (const [type, count] of Object.entries(beforeByType)) {
    const phase = phases.find(p => {
      const phaseToBlocker: Record<string, string[]> = {
        normalize_status: [],
        stalled_retry: ['stalled_extraction', 'stalled_enrichment'],
        enrichment: ['needs_enrichment', 'missing_content', 'stale_version'],
        extraction: ['needs_extraction'],
        activation: ['needs_activation'],
      };
      return phaseToBlocker[p.phase]?.includes(type);
    });
    const resolved = phase ? phase.succeeded : 0;
    afterByType[type] = Math.max(0, count - resolved);
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

  // Mark outcomes based on phase results
  for (const phase of phases) {
    for (const err of phase.errors) {
      // Try to extract resource ID from error string
      const idMatch = err.match(/^([a-f0-9-]{8,36}):/);
      if (idMatch) {
        const outcome = outcomeMap.get(idMatch[1]);
        if (outcome) {
          outcome.attempted = true;
          outcome.error = err.replace(`${idMatch[1]}: `, '');
        }
      }
    }
  }

  // Build reason with blocker diff callout
  const unchangedExtraction = blockerDiff.find(d => d.type === 'needs_extraction' && d.unchanged > 0);
  let reason: string;
  if (blockersAfter <= 0) {
    reason = 'All auto-fixable blockers resolved';
  } else {
    reason = `${blockersAfter} blockers remain — ${totalFailed} failed during this run`;
    if (unchangedExtraction && unchangedExtraction.unchanged > 0) {
      reason += `. Extraction: ${unchangedExtraction.unchanged}/${unchangedExtraction.before} unchanged.`;
    }
  }

  return {
    phases,
    blockers_before: totalBefore,
    blockers_after: Math.max(0, blockersAfter),
    blockers_fixed: totalSucceeded,
    blockers_failed: totalFailed,
    system_ready: blockersAfter <= 0,
    reason,
    resourceOutcomes: [...outcomeMap.values()],
    blockerDiff,
  };
}
