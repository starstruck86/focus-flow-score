/**
 * Canonical eligibility selectors for Deep Enrich and Re-enrich.
 *
 * RULE: eligible count, next batch selection, remaining count, assertions,
 * and debug logging MUST all flow through this file.
 *
 * The ONLY source of truth is `enrichment_status`. Never infer from artifacts.
 */
import type { Resource } from '@/hooks/useResources';
import { createLogger } from '@/lib/logger';
import {
  CURRENT_ENRICHMENT_VERSION,
  CURRENT_VALIDATION_VERSION,
  QUALITY_THRESHOLDS,
  getRecommendedActionFromQuality,
  type RecommendedAction as QualityRecommendedAction,
} from '@/lib/resourceQuality';

const log = createLogger('ResourceEligibility');

// ── Re-export enrichment version from quality ──────────────
export { CURRENT_ENRICHMENT_VERSION } from '@/lib/resourceQuality';

// ── Canonical lifecycle statuses ───────────────────────────
export const ENRICHMENT_STATUSES = [
  'not_enriched',
  'queued_for_deep_enrich',
  'deep_enrich_in_progress',
  'deep_enriched',
  'queued_for_reenrich',
  'reenrich_in_progress',
  'incomplete',
  'failed',
  'retry_scheduled',
  'stale',
  'quarantined',
  'duplicate',
  'superseded',
] as const;

export type EnrichmentStatus = typeof ENRICHMENT_STATUSES[number];

export type EnrichMode = 'deep_enrich' | 're_enrich';
export type EnrichModeInput = EnrichMode | 'deep' | 'reenrich';

export interface EligibleResourceItem {
  resourceId: string;
  url: string;
  title: string;
  enrichMode: EnrichMode;
}

export interface RecommendedAction {
  action: 'deep_enrich' | 're_enrich' | 'retry' | 'review_manually' | 'no_action' | 'ignore';
  reason: string;
}

// ── Freshness policy ───────────────────────────────────────
const FRESHNESS_DAYS = QUALITY_THRESHOLDS.FRESHNESS_DAYS;

// ── Mode normalization ─────────────────────────────────────
function normalizeMode(mode: EnrichModeInput): EnrichMode {
  if (mode === 'deep') return 'deep_enrich';
  if (mode === 'reenrich') return 're_enrich';
  return mode;
}

// ── Canonical key for dedup ────────────────────────────────
function getEligibilityKey(resource: Resource): string {
  return (resource.file_url ?? '').trim().toLowerCase();
}
// ── Has valid source (HTTP URL or uploaded file path) ──────
function hasValidSource(resource: Resource): boolean {
  if (!resource.file_url) return false;
  // HTTP/HTTPS URLs
  if (resource.file_url.startsWith('http')) return true;
  // Uploaded files stored in Supabase storage (non-URL paths like "userId/timestamp-file.pdf")
  if (resource.file_url.length > 3 && !resource.file_url.startsWith('[')) return true;
  return false;
}

// ── Detect resource origin ─────────────────────────────────
export type ResourceOrigin = 'uploaded_file' | 'source_url' | 'manual_content' | 'unknown';

export function getResourceOrigin(resource: Resource): ResourceOrigin {
  const url = resource.file_url;
  if (!url) return resource.content ? 'manual_content' : 'unknown';
  if (url.startsWith('http')) return 'source_url';
  // Storage paths (uploaded files) don't start with http
  if (url.length > 3 && !url.startsWith('[')) return 'uploaded_file';
  return resource.content ? 'manual_content' : 'unknown';
}

// ── Eligibility evaluation ─────────────────────────────────
interface EligibilityEvaluation {
  eligible: boolean;
  reason: string;
  normalizedMode: EnrichMode;
}

export function evaluateResourceEligibility(resource: Resource, mode: EnrichModeInput): EligibilityEvaluation {
  const normalizedMode = normalizeMode(mode);
  const status = (resource as any).enrichment_status as EnrichmentStatus | undefined;

  if (!hasValidSource(resource)) {
    return { eligible: false, reason: 'missing or non-http file_url', normalizedMode };
  }

  // Block metadata-only stubs — they need transcript/manual content first
  const contentStatus = (resource as any).content_status as string | undefined;
  if (contentStatus === 'metadata_only') {
    return { eligible: false, reason: 'metadata_only: needs transcript or manual content before enrichment', normalizedMode };
  }

  if (status === 'duplicate' || status === 'superseded' || status === 'quarantined') {
    return { eligible: false, reason: `excluded: ${status}`, normalizedMode };
  }

  if (normalizedMode === 'deep_enrich') {
    // Eligible: not_enriched, queued_for_deep_enrich, incomplete, failed
    if (!status || status === 'not_enriched' || status === 'queued_for_deep_enrich') {
      return {
        eligible: true,
        reason: `deep eligible: enrichment_status="${status ?? 'not_enriched'}"`,
        normalizedMode,
      };
    }
    if (status === 'incomplete') {
      return {
        eligible: true,
        reason: 'deep eligible: previously incomplete',
        normalizedMode,
      };
    }
    if (status === 'failed') {
      return {
        eligible: true,
        reason: 'deep eligible: previously failed, retryable',
        normalizedMode,
      };
    }
    return {
      eligible: false,
      reason: `not deep eligible: enrichment_status="${status}"`,
      normalizedMode,
    };
  }

  // re_enrich mode
  if (status === 'queued_for_reenrich') {
    return {
      eligible: true,
      reason: 're-enrich eligible: explicitly queued',
      normalizedMode,
    };
  }

  if (status === 'incomplete') {
    return {
      eligible: true,
      reason: 're-enrich eligible: incomplete enrichment',
      normalizedMode,
    };
  }

  if (status === 'deep_enriched') {
    // Check quality tier — shallow deep_enriched items should be eligible
    const qualityTier = (resource as any).last_quality_tier;
    if (qualityTier === 'shallow') {
      return {
        eligible: true,
        reason: 're-enrich eligible: quality tier is shallow',
        normalizedMode,
      };
    }

    const version = (resource as any).enrichment_version ?? 0;
    const enrichedAt = (resource as any).enriched_at;

    if (version < CURRENT_ENRICHMENT_VERSION) {
      return {
        eligible: true,
        reason: `re-enrich eligible: outdated version (v${version} < v${CURRENT_ENRICHMENT_VERSION})`,
        normalizedMode,
      };
    }

    const validationVersion = (resource as any).validation_version ?? 0;
    if (validationVersion < CURRENT_VALIDATION_VERSION) {
      return {
        eligible: true,
        reason: `re-enrich eligible: outdated validation version (v${validationVersion} < v${CURRENT_VALIDATION_VERSION})`,
        normalizedMode,
      };
    }

    if (enrichedAt) {
      const daysSince = Math.floor((Date.now() - new Date(enrichedAt).getTime()) / 86400000);
      if (daysSince >= FRESHNESS_DAYS) {
        return {
          eligible: true,
          reason: `re-enrich eligible: stale (${daysSince} days since enrichment)`,
          normalizedMode,
        };
      }
    }

    return {
      eligible: false,
      reason: `deep_enriched but fresh (v${version}, recently enriched)`,
      normalizedMode,
    };
  }

  return {
    eligible: false,
    reason: `not re-enrichable: enrichment_status="${status ?? 'unknown'}"`,
    normalizedMode,
  };
}

// ── Simple boolean checkers ────────────────────────────────
export function isDeepEnrichEligible(resource: Resource): boolean {
  return evaluateResourceEligibility(resource, 'deep_enrich').eligible;
}

export function isReenrichEligible(resource: Resource): boolean {
  return evaluateResourceEligibility(resource, 're_enrich').eligible;
}

// ── Recommended action per resource ────────────────────────
export function getRecommendedAction(resource: Resource): RecommendedAction {
  const status = (resource as any).enrichment_status as EnrichmentStatus | undefined;
  const tier = (resource as any).last_quality_tier;
  const failureReason = (resource as any).failure_reason;
  const failureCount = (resource as any).failure_count ?? 0;

  if (!hasValidSource(resource)) {
    return { action: 'no_action', reason: 'No valid source URL' };
  }

  const qa = getRecommendedActionFromQuality(status, tier, failureReason, failureCount);

  const actionMap: Record<QualityRecommendedAction, RecommendedAction['action']> = {
    deep_enrich: 'deep_enrich',
    re_enrich: 're_enrich',
    retry_failed: 'retry',
    review_manually: 'review_manually',
    no_action: 'no_action',
    ignore: 'ignore',
  };

  const reasonMap: Record<QualityRecommendedAction, string> = {
    deep_enrich: 'Not yet enriched',
    re_enrich: status === 'incomplete' ? 'Previous enrichment incomplete' : 'Queued for re-enrichment',
    retry_failed: `Failed: ${failureReason || 'unknown'}`,
    review_manually: `Failed ${failureCount} times — needs manual review`,
    no_action: 'Fully enriched and fresh',
    ignore: `Resource is ${status}`,
  };

  return { action: actionMap[qa], reason: reasonMap[qa] };
}

// ── ONE canonical selector ─────────────────────────────────
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

/** Backward-compatible alias */
export function getEligiblePool(resources: Resource[], mode: EnrichModeInput): Resource[] {
  return getEligibleResources(resources, mode);
}

/** Backward-compatible alias */
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

// ── Hard assertion ─────────────────────────────────────────
export function assertBatchEligibility(
  batch: Resource[],
  mode: EnrichModeInput,
  allResources: Resource[],
): void {
  const normalizedMode = normalizeMode(mode);
  const canonicalEligible = getEligibleResources(allResources, normalizedMode);
  const eligibleIds = new Set(canonicalEligible.map((r) => r.id));
  const seenKeys = new Set<string>();
  const violations: Array<{ id: string; title: string; enrichment_status: string | undefined; reason: string }> = [];

  for (const resource of batch) {
    const evaluation = evaluateResourceEligibility(resource, normalizedMode);
    const key = getEligibilityKey(resource);

    if (!evaluation.eligible || !eligibleIds.has(resource.id)) {
      violations.push({
        id: resource.id,
        title: resource.title,
        enrichment_status: (resource as any).enrichment_status,
        reason: evaluation.reason,
      });
      continue;
    }

    if (key && seenKeys.has(key)) {
      violations.push({
        id: resource.id,
        title: resource.title,
        enrichment_status: (resource as any).enrichment_status,
        reason: `duplicate canonical source in batch: ${key}`,
      });
      continue;
    }

    if (key) seenKeys.add(key);
  }

  if (violations.length > 0) {
    const msg = `Batch eligibility assertion failed: ${violations.length} of ${batch.length} items ineligible`;
    log.error(msg, { mode: normalizedMode, violations });
    throw new Error(`${msg}. IDs: ${violations.map((v) => v.id).join(', ')}`);
  }

  log.debug('Batch eligibility assertion passed', {
    mode: normalizedMode,
    eligibleCount: canonicalEligible.length,
    batchIds: batch.map((r) => r.id),
  });
}

// ── Debug logging ──────────────────────────────────────────
export function logEligibilitySnapshot(resources: Resource[], mode: EnrichModeInput, context: string): void {
  const normalizedMode = normalizeMode(mode);
  const eligible = getEligibleResources(resources, normalizedMode);

  log.info(`[${context}] Eligibility snapshot`, {
    mode: normalizedMode,
    eligibleCount: eligible.length,
    preview: eligible.slice(0, 10).map((r) => ({
      id: r.id,
      title: r.title,
      enrichment_status: (r as any).enrichment_status,
      last_quality_tier: (r as any).last_quality_tier,
      reason: evaluateResourceEligibility(r, normalizedMode).reason,
    })),
  });
}

export function logSelectedBatch(resources: Resource[], mode: EnrichModeInput, context: string): void {
  const normalizedMode = normalizeMode(mode);
  log.info(`[${context}] Selected batch`, {
    mode: normalizedMode,
    batchIds: resources.map((r) => r.id),
    qualifications: resources.map((r) => ({
      id: r.id,
      title: r.title,
      enrichment_status: (r as any).enrichment_status,
      last_quality_tier: (r as any).last_quality_tier,
      reason: evaluateResourceEligibility(r, normalizedMode).reason,
    })),
  });
}

// ── Enrichment status label helper ─────────────────────────
export function getEnrichmentStatusLabel(status: EnrichmentStatus | string | undefined): string {
  switch (status) {
    case 'not_enriched': return 'Not Enriched';
    case 'queued_for_deep_enrich': return 'Queued';
    case 'deep_enrich_in_progress': return 'Enriching…';
    case 'deep_enriched': return 'Enriched';
    case 'queued_for_reenrich': return 'Re-enrich Queued';
    case 'reenrich_in_progress': return 'Re-enriching…';
    case 'incomplete': return 'Incomplete';
    case 'failed': return 'Failed';
    case 'retry_scheduled': return 'Retry Scheduled';
    case 'stale': return 'Stale';
    case 'quarantined': return 'Quarantined';
    case 'duplicate': return 'Duplicate';
    case 'superseded': return 'Superseded';
    default: return 'Not Enriched';
  }
}

export function getEnrichmentStatusColor(status: EnrichmentStatus | string | undefined): string {
  switch (status) {
    case 'deep_enriched': return 'bg-status-green/20 text-status-green';
    case 'queued_for_deep_enrich':
    case 'queued_for_reenrich': return 'bg-primary/20 text-primary';
    case 'deep_enrich_in_progress':
    case 'reenrich_in_progress': return 'bg-primary/20 text-primary';
    case 'incomplete': return 'bg-orange-500/20 text-orange-600';
    case 'failed': return 'bg-status-red/20 text-status-red';
    case 'retry_scheduled': return 'bg-status-yellow/20 text-status-yellow';
    case 'stale': return 'bg-muted text-muted-foreground';
    case 'quarantined': return 'bg-status-red/20 text-status-red';
    case 'duplicate':
    case 'superseded': return 'bg-muted text-muted-foreground';
    default: return 'bg-status-yellow/20 text-status-yellow';
  }
}
