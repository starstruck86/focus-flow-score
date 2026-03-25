/**
 * Canonical eligibility selectors for Deep Enrich and Re-enrich.
 *
 * RULE: eligible count, next batch selection, remaining count, assertions,
 * and debug logging MUST all flow through this file.
 */
import type { Resource } from '@/hooks/useResources';
import { createLogger } from '@/lib/logger';

const log = createLogger('ResourceEligibility');

export type EnrichMode = 'deep_enrich' | 're_enrich';
export type EnrichModeInput = EnrichMode | 'deep' | 'reenrich';

export interface EligibleResourceItem {
  resourceId: string;
  url: string;
  title: string;
  enrichMode: EnrichMode;
}

interface EligibilityEvaluation {
  eligible: boolean;
  reason: string;
  normalizedMode: EnrichMode;
}

function normalizeMode(mode: EnrichModeInput): EnrichMode {
  if (mode === 'deep') return 'deep_enrich';
  if (mode === 'reenrich') return 're_enrich';
  return mode;
}

function getEligibilityKey(resource: Resource): string {
  return (resource.file_url ?? '').trim().toLowerCase();
}

export function evaluateResourceEligibility(resource: Resource, mode: EnrichModeInput): EligibilityEvaluation {
  const normalizedMode = normalizeMode(mode);
  const status = resource.content_status;

  if (!resource.file_url) {
    return { eligible: false, reason: 'missing file_url', normalizedMode };
  }

  if (!resource.file_url.startsWith('http')) {
    return { eligible: false, reason: 'non-http file_url', normalizedMode };
  }

  if (normalizedMode === 'deep_enrich') {
    if (!status || status === 'placeholder' || status === 'file') {
      return {
        eligible: true,
        reason: `deep eligible: content_status="${status ?? 'missing'}" with http source`,
        normalizedMode,
      };
    }

    return {
      eligible: false,
      reason: `already processed for deep enrich: content_status="${status}"`,
      normalizedMode,
    };
  }

  if (status === 'enriched') {
    return {
      eligible: true,
      reason: 're-enrich eligible: content_status="enriched" with http source',
      normalizedMode,
    };
  }

  return {
    eligible: false,
    reason: `not re-enrichable: content_status="${status ?? 'missing'}"`,
    normalizedMode,
  };
}

export function isDeepEnrichEligible(resource: Resource): boolean {
  return evaluateResourceEligibility(resource, 'deep_enrich').eligible;
}

export function isReenrichEligible(resource: Resource): boolean {
  return evaluateResourceEligibility(resource, 're_enrich').eligible;
}

/**
 * ONE canonical selector.
 * Returns only valid items, deduped by canonical source key.
 */
export function getEligibleResources(resources: Resource[], mode: EnrichModeInput): Resource[] {
  const seenKeys = new Set<string>();
  const eligible: Resource[] = [];

  for (const resource of resources) {
    const evaluation = evaluateResourceEligibility(resource, mode);
    if (!evaluation.eligible) continue;

    const key = getEligibilityKey(resource);
    if (!key) continue;
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    eligible.push(resource);
  }

  return eligible;
}

export function getEligibleCount(resources: Resource[], mode: EnrichModeInput): number {
  return getEligibleResources(resources, mode).length;
}

/** Backward-compatible alias for older callers/tests. */
export function getEligiblePool(resources: Resource[], mode: EnrichModeInput): Resource[] {
  return getEligibleResources(resources, mode);
}

/** Backward-compatible alias for older callers/tests. */
export function selectBatch(pool: Resource[], batchSize: number): Resource[] {
  return pool.slice(0, batchSize);
}

export function selectEligibleBatch(resources: Resource[], mode: EnrichModeInput, batchSize: number): Resource[] {
  return getEligibleResources(resources, mode).slice(0, batchSize);
}

export function toEligibleResourceItems(resources: Resource[], mode: EnrichModeInput): EligibleResourceItem[] {
  const normalizedMode = normalizeMode(mode);
  return resources.map((resource) => ({
    resourceId: resource.id,
    url: resource.file_url as string,
    title: resource.title,
    enrichMode: normalizedMode,
  }));
}

export function assertBatchEligibility(
  batch: Resource[],
  mode: EnrichModeInput,
  allResources: Resource[],
): void {
  const normalizedMode = normalizeMode(mode);
  const canonicalEligible = getEligibleResources(allResources, normalizedMode);
  const eligibleIds = new Set(canonicalEligible.map((resource) => resource.id));
  const seenKeys = new Set<string>();
  const violations: Array<{ id: string; title: string; content_status: string | undefined; reason: string }> = [];

  for (const resource of batch) {
    const evaluation = evaluateResourceEligibility(resource, normalizedMode);
    const key = getEligibilityKey(resource);

    if (!evaluation.eligible || !eligibleIds.has(resource.id)) {
      violations.push({
        id: resource.id,
        title: resource.title,
        content_status: resource.content_status,
        reason: evaluation.reason,
      });
      continue;
    }

    if (key && seenKeys.has(key)) {
      violations.push({
        id: resource.id,
        title: resource.title,
        content_status: resource.content_status,
        reason: `duplicate canonical source in batch: ${key}`,
      });
      continue;
    }

    if (key) seenKeys.add(key);
  }

  if (violations.length > 0) {
    const msg = `Batch eligibility assertion failed: ${violations.length} of ${batch.length} items ineligible`;
    log.error(msg, { mode: normalizedMode, violations });
    throw new Error(`${msg}. IDs: ${violations.map((violation) => violation.id).join(', ')}`);
  }

  log.debug('Batch eligibility assertion passed', {
    mode: normalizedMode,
    eligibleCount: canonicalEligible.length,
    batchIds: batch.map((resource) => resource.id),
  });
}

export function logEligibilitySnapshot(resources: Resource[], mode: EnrichModeInput, context: string): void {
  const normalizedMode = normalizeMode(mode);
  const eligible = getEligibleResources(resources, normalizedMode);

  log.info(`[${context}] Eligibility snapshot`, {
    mode: normalizedMode,
    eligibleCount: eligible.length,
    selectedBatchPreview: eligible.slice(0, 10).map((resource) => ({
      id: resource.id,
      title: resource.title,
      reason: evaluateResourceEligibility(resource, normalizedMode).reason,
    })),
  });
}

export function logSelectedBatch(resources: Resource[], mode: EnrichModeInput, context: string): void {
  const normalizedMode = normalizeMode(mode);
  log.info(`[${context}] Selected batch`, {
    mode: normalizedMode,
    selectedBatchIds: resources.map((resource) => resource.id),
    qualificationReasons: resources.map((resource) => ({
      id: resource.id,
      title: resource.title,
      reason: evaluateResourceEligibility(resource, normalizedMode).reason,
    })),
  });
}
