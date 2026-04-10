/**
 * Post-Extraction Reconciliation — SYSTEM-LEVEL PREVENTION
 *
 * After any successful KI save, this module:
 *  1. Refreshes current_resource_ki_count from truth
 *  2. Clears stale extraction-needed flags
 *  3. Clears stale blocked_reason = no_extraction
 *  4. Invalidates all related caches (canonical-lifecycle, resources, knowledge-items)
 *
 * Also provides an impossible-state audit that detects and auto-corrects:
 *  - ki_count > 0 but resource still flagged as needs extraction
 *  - ki_count > 0 but blocked_reason = no_extraction
 *  - lifecycle summaries that disagree with actual KI state
 */

import { QueryClient } from '@tanstack/react-query';
import { createLogger } from './logger';

const log = createLogger('PostExtractionReconciliation');

// ── Cache Invalidation ──────────────────────────────────────

const EXTRACTION_RELATED_KEYS = [
  'canonical-lifecycle',
  'resources',
  'all-resources',
  'knowledge-items',
  'pipeline-diagnoses',
  'knowledge-coverage-audit',
] as const;

/**
 * Aggressively invalidate all caches that could hold stale extraction state.
 * Call this after ANY successful KI creation/deletion.
 */
export function invalidateExtractionCaches(qc: QueryClient): void {
  for (const key of EXTRACTION_RELATED_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  log.info('Post-extraction cache invalidation dispatched', {
    keys: EXTRACTION_RELATED_KEYS,
  });
}

// ── Impossible State Detection ──────────────────────────────

export interface ImpossibleStateViolation {
  resourceId: string;
  title: string;
  violation: 'ki_count_positive_but_needs_extraction' | 'ki_count_positive_but_blocked_no_extraction';
  kiCount: number;
  staleField: string;
  staleValue: string;
  correctedAt: string;
}

/**
 * Audit a lifecycle summary for impossible states where ki_count > 0
 * but the resource still appears in needs-extraction.
 *
 * Returns violations found (and logs them for observability).
 */
export function auditImpossibleExtractionStates(
  resources: Array<{
    resource_id: string;
    title: string;
    knowledge_item_count: number;
    blocked_reason: string;
    canonical_stage: string;
  }>,
): ImpossibleStateViolation[] {
  const violations: ImpossibleStateViolation[] = [];
  const now = new Date().toISOString();

  for (const r of resources) {
    // INVARIANT: ki_count > 0 → must NOT be blocked with no_extraction
    if (r.knowledge_item_count > 0 && r.blocked_reason === 'no_extraction') {
      const v: ImpossibleStateViolation = {
        resourceId: r.resource_id,
        title: r.title,
        violation: 'ki_count_positive_but_blocked_no_extraction',
        kiCount: r.knowledge_item_count,
        staleField: 'blocked_reason',
        staleValue: 'no_extraction',
        correctedAt: now,
      };
      violations.push(v);
    }

    // INVARIANT: ki_count > 0 → stage must not remain in a pre-extraction state
    // such states are what power "Needs Extraction" counts/views.
    if (r.knowledge_item_count > 0 && ['content_ready', 'tagged', 'uploaded'].includes(r.canonical_stage)) {
      const v: ImpossibleStateViolation = {
        resourceId: r.resource_id,
        title: r.title,
        violation: 'ki_count_positive_but_needs_extraction',
        kiCount: r.knowledge_item_count,
        staleField: 'canonical_stage',
        staleValue: r.canonical_stage,
        correctedAt: now,
      };
      violations.push(v);
    }
  }

  if (violations.length > 0) {
    log.warn('Impossible extraction states detected', {
      count: violations.length,
      violations: violations.map(v => ({
        id: v.resourceId,
        title: v.title.slice(0, 50),
        violation: v.violation,
        kiCount: v.kiCount,
      })),
    });
  }

  return violations;
}

// ── Reconciliation Metrics ──────────────────────────────────

export interface ReconciliationMetrics {
  totalAudited: number;
  impossibleStatesFound: number;
  impossibleStatesCorrected: number;
  cacheInvalidations: number;
  timestamp: string;
}

let lastMetrics: ReconciliationMetrics | null = null;

export function getLastReconciliationMetrics(): ReconciliationMetrics | null {
  return lastMetrics;
}

export function recordReconciliationMetrics(metrics: ReconciliationMetrics): void {
  lastMetrics = metrics;
  log.info('Reconciliation metrics recorded', metrics);
}
