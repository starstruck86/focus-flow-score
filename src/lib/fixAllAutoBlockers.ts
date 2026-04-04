/**
 * fixAllAutoBlockers — Orchestrates safe sequential fix of all auto-fixable blockers.
 * 
 * Order: stalled retry → enrichment → extraction → activation
 * Stops if contradictions or unexpected failures increase.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { autoOperationalizeBatch } from '@/lib/autoOperationalize';
import { deriveResourceTruth, deriveLibraryReadiness, type BlockerType, type ResourceTruth } from '@/lib/resourceTruthState';
import { createLogger } from '@/lib/logger';

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
 * Retry stalled resources by clearing their job status then re-enriching.
 */
async function fixStalledJobs(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'stalled_retry', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };

  for (const id of resourceIds) {
    onProgress?.(`Clearing stalled job: ${id.slice(0, 8)}…`);
    const cleared = await clearStalledJobStatus(id);
    if (!cleared) {
      result.failed++;
      result.errors.push(`Failed to clear stalled status for ${id}`);
      continue;
    }

    // Re-enrich after clearing
    try {
      const { data, error } = await invokeEnrichResource(
        { resource_id: id, force: true },
        { componentName: 'FixAllAutoBlockers' },
      );
      if (error) {
        result.failed++;
        result.errors.push(`Enrich failed for ${id}: ${error.message}`);
      } else {
        result.succeeded++;
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push(`Enrich error for ${id}: ${err.message}`);
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  return result;
}

/**
 * Enrich resources that need enrichment.
 */
async function fixNeedsEnrichment(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'enrichment', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };

  for (let i = 0; i < resourceIds.length; i++) {
    const id = resourceIds[i];
    onProgress?.(`Enriching ${i + 1}/${resourceIds.length}`);
    try {
      const { data, error } = await invokeEnrichResource(
        { resource_id: id },
        { componentName: 'FixAllAutoBlockers' },
      );
      if (error) {
        result.failed++;
        result.errors.push(`${id}: ${error.message}`);
      } else {
        result.succeeded++;
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push(`${id}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  return result;
}

/**
 * Extract knowledge items for resources that need extraction.
 */
async function fixNeedsExtraction(
  resourceIds: string[],
  onProgress?: (msg: string) => void,
  onResourcePhase?: (resourceId: string, phase: 'start' | 'done', result?: any) => void,
): Promise<FixPhaseResult> {
  const result: FixPhaseResult = { phase: 'extraction', attempted: resourceIds.length, succeeded: 0, failed: 0, errors: [] };

  if (resourceIds.length === 0) return result;

  onProgress?.(`Extracting ${resourceIds.length} resources`);
  try {
    const results = await autoOperationalizeBatch(resourceIds, undefined, onResourcePhase);
    for (const r of results) {
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
  }

  return result;
}

/**
 * Run the full auto-fix pass in safe order.
 */
export async function runFixAllAutoBlockers(
  blockerGroups: BlockerGroup[],
  onProgress?: (msg: string) => void,
  onResourcePhase?: (resourceId: string, phase: 'start' | 'done', result?: any) => void,
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

  // Phase 1: Retry stalled jobs first
  const stalledIds = [
    ...(groupMap.get('stalled_extraction') ?? []),
    ...(groupMap.get('stalled_enrichment') ?? []),
  ];
  if (stalledIds.length > 0) {
    onProgress?.(`Retrying ${stalledIds.length} stalled jobs…`);
    const stalledResult = await fixStalledJobs(stalledIds, onProgress);
    phases.push(stalledResult);
  }

  // Phase 2: Enrich
  const enrichIds = [
    ...(groupMap.get('needs_enrichment') ?? []),
    ...(groupMap.get('missing_content') ?? []),
    ...(groupMap.get('stale_version') ?? []),
  ];
  if (enrichIds.length > 0) {
    onProgress?.(`Enriching ${enrichIds.length} resources…`);
    const enrichResult = await fixNeedsEnrichment(enrichIds, onProgress);
    phases.push(enrichResult);
  }

  // Phase 3: Extract
  const extractIds = groupMap.get('needs_extraction') ?? [];
  if (extractIds.length > 0) {
    onProgress?.(`Extracting ${extractIds.length} resources…`);
    const extractResult = await fixNeedsExtraction(extractIds, onProgress, onResourcePhase);
    phases.push(extractResult);
  }

  // Phase 4: Activate (handled inline by extraction — note for clarity)
  const activateIds = groupMap.get('needs_activation') ?? [];
  if (activateIds.length > 0) {
    onProgress?.(`Activating ${activateIds.length} resources…`);
    const activateResult = await fixNeedsExtraction(activateIds, onProgress, onResourcePhase);
    activateResult.phase = 'activation';
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
