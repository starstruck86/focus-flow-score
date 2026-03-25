/**
 * Canonical eligibility selectors for Deep Enrich and Re-enrich.
 *
 * RULE: Every count, batch selection, and remaining calculation MUST flow
 * through these functions. No other file may duplicate this logic.
 */
import type { Resource } from '@/hooks/useResources';
import { createLogger } from '@/lib/logger';

const log = createLogger('ResourceEligibility');

export type EnrichMode = 'deep' | 'reenrich';

/** A resource is eligible for Deep Enrich if it has an HTTP URL and has NOT been enriched yet. */
export function isDeepEnrichEligible(r: Resource): boolean {
  if (!r.file_url || !r.file_url.startsWith('http')) return false;
  const status = r.content_status;
  // Eligible only if never enriched: placeholder, file, or missing status
  return !status || status === 'placeholder' || status === 'file';
}

/** A resource is eligible for Re-enrich if it has an HTTP URL and IS already enriched. */
export function isReenrichEligible(r: Resource): boolean {
  if (!r.file_url || !r.file_url.startsWith('http')) return false;
  const status = r.content_status;
  return status === 'enriched';
}

/** Return the canonical eligibility predicate for a given mode. */
export function getEligibilityPredicate(mode: EnrichMode): (r: Resource) => boolean {
  return mode === 'deep' ? isDeepEnrichEligible : isReenrichEligible;
}

/** Compute the eligible pool for a given mode from a resource list. */
export function getEligiblePool(resources: Resource[], mode: EnrichMode): Resource[] {
  const predicate = getEligibilityPredicate(mode);
  return resources.filter(predicate);
}

/** Select next batch from pool. Returns exactly `batchSize` or fewer items. */
export function selectBatch(pool: Resource[], batchSize: number): Resource[] {
  return pool.slice(0, batchSize);
}

/** Convert eligible pool to source items for BulkIngestionPanel. */
export function toSourceItems(pool: Resource[]): Array<{ url: string; title: string }> {
  return pool.map(r => ({
    url: r.file_url as string,
    title: r.title,
  }));
}

/**
 * Pre-batch assertion: every item in the batch must satisfy the eligibility predicate.
 * Throws with detailed diagnostics if any item fails.
 */
export function assertBatchEligibility(
  batch: Resource[],
  mode: EnrichMode,
  allResources: Resource[],
): void {
  const predicate = getEligibilityPredicate(mode);
  const violations: Array<{ id: string; title: string; content_status: string | undefined; reason: string }> = [];

  for (const r of batch) {
    if (!predicate(r)) {
      violations.push({
        id: r.id,
        title: r.title,
        content_status: r.content_status,
        reason: mode === 'deep'
          ? `content_status="${r.content_status}" is not eligible for deep enrich`
          : `content_status="${r.content_status}" is not eligible for re-enrich`,
      });
    }
  }

  if (violations.length > 0) {
    const msg = `Batch eligibility assertion failed: ${violations.length} of ${batch.length} items ineligible`;
    log.error(msg, { mode, violations });
    throw new Error(`${msg}. IDs: ${violations.map(v => v.id).join(', ')}`);
  }

  log.debug('Batch eligibility assertion passed', {
    mode,
    batchSize: batch.length,
    batchIds: batch.map(r => r.id),
    eligiblePoolSize: getEligiblePool(allResources, mode).length,
  });
}

/**
 * Debug snapshot: log the current eligibility state for diagnostics.
 */
export function logEligibilitySnapshot(resources: Resource[], mode: EnrichMode, context: string): void {
  const pool = getEligiblePool(resources, mode);
  log.info(`[${context}] Eligibility snapshot`, {
    mode,
    totalResources: resources.length,
    eligibleCount: pool.length,
    eligibleIds: pool.slice(0, 20).map(r => ({ id: r.id, title: r.title, status: r.content_status })),
  });
}
