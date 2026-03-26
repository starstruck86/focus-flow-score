/**
 * Self-healing resource reconciliation engine.
 *
 * Classifies every resource into a health bucket, repairs status-only issues
 * without re-enrichment, and queues only truly stale resources for re-enrich.
 *
 * Designed to run on-demand now and on a schedule later.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  validateResourceQuality,
  CURRENT_ENRICHMENT_VERSION,
  CURRENT_VALIDATION_VERSION,
  CURRENT_QUALITY_VERSION,
  QUALITY_THRESHOLDS,
  type ResourceForValidation,
} from './resourceQuality';
import { createLogger } from './logger';

const log = createLogger('ResourceReconciliation');

// ── Health buckets ─────────────────────────────────────────
export type HealthBucket =
  | 'healthy'
  | 'needs_status_repair'
  | 'needs_re_enrich'
  | 'failed_retryable'
  | 'invalid_source';

export interface ClassifiedResource {
  id: string;
  title: string;
  bucket: HealthBucket;
  currentStatus: string;
  reasons: string[];
  repairActions?: string[];
}

export interface ReconciliationReport {
  total: number;
  healthy: number;
  needs_status_repair: number;
  needs_re_enrich: number;
  failed_retryable: number;
  invalid_source: number;
  repaired: number;
  details: ClassifiedResource[];
  timestamp: string;
}

// ── Classification logic ───────────────────────────────────
function classifyResource(r: any): ClassifiedResource {
  const reasons: string[] = [];
  const repairActions: string[] = [];
  const status = r.enrichment_status || 'not_enriched';

  // 1. Invalid source check
  if (!r.file_url || !r.file_url.startsWith('http')) {
    return {
      id: r.id, title: r.title, bucket: 'invalid_source',
      currentStatus: status,
      reasons: ['Missing or invalid source URL'],
    };
  }

  // 2. Failed/incomplete → retryable
  if (status === 'failed') {
    return {
      id: r.id, title: r.title, bucket: 'failed_retryable',
      currentStatus: status,
      reasons: [r.failure_reason || 'Previously failed'],
    };
  }

  // 3. Not enriched → needs deep enrich
  if (status === 'not_enriched' || status === 'queued_for_deep_enrich') {
    return {
      id: r.id, title: r.title, bucket: 'needs_re_enrich',
      currentStatus: status,
      reasons: ['Not yet enriched'],
    };
  }

  // 4. Incomplete → needs re-enrich
  if (status === 'incomplete') {
    return {
      id: r.id, title: r.title, bucket: 'needs_re_enrich',
      currentStatus: status,
      reasons: [r.failure_reason || 'Previously incomplete enrichment'],
    };
  }

  // 5. Queued for re-enrich
  if (status === 'queued_for_reenrich') {
    return {
      id: r.id, title: r.title, bucket: 'needs_re_enrich',
      currentStatus: status,
      reasons: ['Explicitly queued for re-enrichment'],
    };
  }

  // 6. In-progress states (stuck)
  if (status === 'deep_enrich_in_progress' || status === 'reenrich_in_progress') {
    return {
      id: r.id, title: r.title, bucket: 'needs_status_repair',
      currentStatus: status,
      reasons: ['Stuck in processing state'],
      repairActions: ['Reset to incomplete'],
    };
  }

  // 7. deep_enriched — validate quality
  if (status === 'deep_enriched') {
    // Version drift
    if ((r.enrichment_version ?? 0) < CURRENT_ENRICHMENT_VERSION) {
      reasons.push(`Outdated enrichment version (v${r.enrichment_version ?? 0} < v${CURRENT_ENRICHMENT_VERSION})`);
    }
    if ((r.validation_version ?? 0) < CURRENT_VALIDATION_VERSION) {
      reasons.push(`Outdated validation version (v${r.validation_version ?? 0} < v${CURRENT_VALIDATION_VERSION})`);
    }

    // Stale failure_reason on enriched resource
    if (r.failure_reason) {
      repairActions.push('Clear stale failure_reason');
    }

    // Quality validation
    const qr = validateResourceQuality({
      id: r.id,
      title: r.title,
      content: r.content,
      content_length: r.content_length,
      enrichment_status: r.enrichment_status,
      enrichment_version: r.enrichment_version ?? 0,
      validation_version: r.validation_version ?? 0,
      enriched_at: r.enriched_at,
      failure_reason: r.failure_reason,
      file_url: r.file_url,
      description: r.description,
    });

    if (!qr.passesCompletionContract) {
      // Content is actually bad → needs re-enrich
      if (qr.tier === 'failed' || qr.tier === 'incomplete' ||
          qr.dimensions.contentDepth < 10 || qr.dimensions.semanticUsefulness < 5) {
        return {
          id: r.id, title: r.title, bucket: 'needs_re_enrich',
          currentStatus: status,
          reasons: [`Quality ${qr.tier} (score ${qr.score}): ${qr.violations.join('; ')}`],
        };
      }

      // Shallow but content may be fine, status just needs correction
      if (qr.tier === 'shallow' && reasons.length === 0) {
        // Only version-related violations → needs re-enrich to get new version output
        return {
          id: r.id, title: r.title, bucket: 'needs_re_enrich',
          currentStatus: status,
          reasons: [`Quality tier shallow (score ${qr.score}): ${qr.violations.join('; ')}`],
        };
      }
    }

    // Status repair only (stale metadata, not content issues)
    if (repairActions.length > 0 && reasons.length === 0) {
      return {
        id: r.id, title: r.title, bucket: 'needs_status_repair',
        currentStatus: status, reasons: repairActions,
        repairActions,
      };
    }

    // Version drift without quality failure → needs re-enrich under new logic
    if (reasons.length > 0) {
      return {
        id: r.id, title: r.title, bucket: 'needs_re_enrich',
        currentStatus: status, reasons,
      };
    }

    // Healthy
    return {
      id: r.id, title: r.title, bucket: 'healthy',
      currentStatus: status, reasons: ['Passes current validation'],
    };
  }

  // Catch-all for duplicate/superseded
  return {
    id: r.id, title: r.title, bucket: 'healthy',
    currentStatus: status, reasons: [`Status: ${status}`],
  };
}

// ── Full reconciliation scan ───────────────────────────────
export async function runFullReconciliation(userId: string, opts?: {
  dryRun?: boolean;
}): Promise<ReconciliationReport> {
  const dryRun = opts?.dryRun ?? false;

  const { data: resources, error } = await supabase
    .from('resources')
    .select('id, title, content, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, description, last_quality_tier, last_quality_score, failure_count')
    .eq('user_id', userId);

  if (error || !resources) {
    log.error('Reconciliation query failed', { error });
    return {
      total: 0, healthy: 0, needs_status_repair: 0, needs_re_enrich: 0,
      failed_retryable: 0, invalid_source: 0, repaired: 0,
      details: [], timestamp: new Date().toISOString(),
    };
  }

  const report: ReconciliationReport = {
    total: resources.length,
    healthy: 0, needs_status_repair: 0, needs_re_enrich: 0,
    failed_retryable: 0, invalid_source: 0, repaired: 0,
    details: [], timestamp: new Date().toISOString(),
  };

  for (const r of resources) {
    const classified = classifyResource(r);
    report[classified.bucket]++;
    report.details.push(classified);
  }

  // ── REPAIR PATH (cheap, no re-enrichment) ────────────────
  if (!dryRun) {
    const toRepair = report.details.filter(d => d.bucket === 'needs_status_repair');
    for (const item of toRepair) {
      const update: Record<string, any> = {
        last_reconciled_at: new Date().toISOString(),
      };

      if (item.currentStatus === 'deep_enrich_in_progress' || item.currentStatus === 'reenrich_in_progress') {
        update.enrichment_status = 'incomplete';
        update.last_status_change_at = new Date().toISOString();
      }

      if (item.repairActions?.includes('Clear stale failure_reason')) {
        update.failure_reason = null;
      }

      await supabase.from('resources').update(update).eq('id', item.id);
      report.repaired++;
    }

    // Mark all scanned resources as reconciled
    const allIds = resources.map(r => (r as any).id as string);
    // Batch update in chunks of 100
    for (let i = 0; i < allIds.length; i += 100) {
      const chunk = allIds.slice(i, i + 100);
      await supabase
        .from('resources')
        .update({ last_reconciled_at: new Date().toISOString() })
        .in('id', chunk);
    }
  }

  log.info('Reconciliation complete', {
    total: report.total,
    healthy: report.healthy,
    needs_status_repair: report.needs_status_repair,
    needs_re_enrich: report.needs_re_enrich,
    failed_retryable: report.failed_retryable,
    invalid_source: report.invalid_source,
    repaired: report.repaired,
  });

  return report;
}

// ── Targeted reconciliation (after version bumps) ──────────
export async function reconcileByVersion(userId: string, opts?: {
  enrichmentVersionBelow?: number;
  validationVersionBelow?: number;
}): Promise<ReconciliationReport> {
  const enrichVer = opts?.enrichmentVersionBelow ?? CURRENT_ENRICHMENT_VERSION;
  const validVer = opts?.validationVersionBelow ?? CURRENT_VALIDATION_VERSION;

  // Only fetch resources that are potentially affected
  const { data: resources, error } = await supabase
    .from('resources')
    .select('id, title, content, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, description, last_quality_tier, last_quality_score, failure_count')
    .eq('user_id', userId)
    .eq('enrichment_status', 'deep_enriched')
    .or(`enrichment_version.lt.${enrichVer},validation_version.lt.${validVer}`);

  if (error || !resources) {
    log.error('Version reconciliation query failed', { error });
    return {
      total: 0, healthy: 0, needs_status_repair: 0, needs_re_enrich: 0,
      failed_retryable: 0, invalid_source: 0, repaired: 0,
      details: [], timestamp: new Date().toISOString(),
    };
  }

  const report: ReconciliationReport = {
    total: resources.length,
    healthy: 0, needs_status_repair: 0, needs_re_enrich: 0,
    failed_retryable: 0, invalid_source: 0, repaired: 0,
    details: [], timestamp: new Date().toISOString(),
  };

  for (const r of resources) {
    const classified = classifyResource(r);
    report[classified.bucket]++;
    report.details.push(classified);
  }

  log.info('Version reconciliation complete', {
    total: report.total,
    affected: report.needs_re_enrich + report.needs_status_repair,
  });

  return report;
}

// ── Drift detection for a single resource ──────────────────
export function detectResourceDrift(resource: {
  enrichment_status: string;
  last_quality_tier?: string | null;
  last_quality_score?: number | null;
  enrichment_version?: number;
  validation_version?: number;
  enriched_at?: string | null;
  failure_reason?: string | null;
}): { hasDrift: boolean; issues: string[] } {
  const issues: string[] = [];

  if (resource.enrichment_status === 'deep_enriched') {
    if (resource.last_quality_tier && resource.last_quality_tier !== 'complete') {
      issues.push(`deep_enriched but tier=${resource.last_quality_tier}`);
    }
    if (resource.last_quality_score != null && resource.last_quality_score < QUALITY_THRESHOLDS.COMPLETE_MIN_SCORE) {
      issues.push(`deep_enriched but score=${resource.last_quality_score} < ${QUALITY_THRESHOLDS.COMPLETE_MIN_SCORE}`);
    }
    if ((resource.enrichment_version ?? 0) < CURRENT_ENRICHMENT_VERSION) {
      issues.push(`outdated enrichment version v${resource.enrichment_version}`);
    }
    if ((resource.validation_version ?? 0) < CURRENT_VALIDATION_VERSION) {
      issues.push(`outdated validation version v${resource.validation_version}`);
    }
    if (resource.failure_reason) {
      issues.push(`stale failure_reason on enriched resource`);
    }
  }

  // Stuck in processing
  if (resource.enrichment_status === 'deep_enrich_in_progress' || resource.enrichment_status === 'reenrich_in_progress') {
    issues.push(`stuck in processing state: ${resource.enrichment_status}`);
  }

  return { hasDrift: issues.length > 0, issues };
}

// ── Dev-only assertion: UI vs DB count check ───────────────
export async function assertFilterConsistency(
  userId: string,
  uiDeepEnrichCount: number,
  uiReenrichCount: number,
): Promise<void> {
  if (!import.meta.env.DEV) return;

  const { data: deepEligible } = await supabase
    .from('resources')
    .select('id')
    .eq('user_id', userId)
    .in('enrichment_status', ['not_enriched', 'queued_for_deep_enrich', 'incomplete', 'failed'])
    .not('file_url', 'is', null);

  const dbDeepCount = deepEligible?.length ?? 0;

  if (Math.abs(dbDeepCount - uiDeepEnrichCount) > 2) {
    console.warn(
      `[ReconciliationAssert] Deep Enrich count drift: UI=${uiDeepEnrichCount}, DB=${dbDeepCount}`,
    );
  }
}
