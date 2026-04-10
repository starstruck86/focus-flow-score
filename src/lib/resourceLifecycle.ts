/**
 * Canonical resource enrichment lifecycle engine.
 * 
 * SINGLE WRITE PATH: Only `transitionToEnriched()` may set deep_enriched.
 * All enrichment status mutations MUST flow through this module.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  validateResourceQuality,
  assertEnrichmentInvariants,
  CURRENT_ENRICHMENT_VERSION,
  CURRENT_VALIDATION_VERSION,
  QUALITY_THRESHOLDS,
  type QualityResult,
  type QualityTier,
  type ResourceForValidation,
} from './resourceQuality';
import { createLogger } from './logger';

const log = createLogger('ResourceLifecycle');

// ── Valid state transitions ────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  not_enriched: ['queued_for_deep_enrich', 'deep_enrich_in_progress', 'duplicate', 'superseded', 'quarantined'],
  queued_for_deep_enrich: ['deep_enrich_in_progress', 'not_enriched', 'duplicate', 'superseded', 'quarantined'],
  deep_enrich_in_progress: ['deep_enriched', 'incomplete', 'failed', 'quarantined'],
  deep_enriched: ['queued_for_reenrich', 'reenrich_in_progress', 'not_enriched', 'incomplete', 'duplicate', 'superseded', 'stale', 'quarantined'],
  queued_for_reenrich: ['reenrich_in_progress', 'deep_enriched', 'not_enriched', 'quarantined'],
  reenrich_in_progress: ['deep_enriched', 'incomplete', 'failed', 'quarantined'],
  incomplete: ['queued_for_deep_enrich', 'deep_enrich_in_progress', 'queued_for_reenrich', 'reenrich_in_progress', 'not_enriched', 'duplicate', 'superseded', 'retry_scheduled', 'quarantined'],
  failed: ['queued_for_deep_enrich', 'deep_enrich_in_progress', 'not_enriched', 'duplicate', 'superseded', 'retry_scheduled', 'quarantined'],
  retry_scheduled: ['queued_for_deep_enrich', 'deep_enrich_in_progress', 'not_enriched', 'quarantined'],
  stale: ['queued_for_reenrich', 'reenrich_in_progress', 'not_enriched', 'quarantined'],
  quarantined: ['not_enriched', 'queued_for_deep_enrich'],
  duplicate: ['not_enriched'],
  superseded: ['not_enriched'],
};

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Audit log entry ────────────────────────────────────────
export interface AuditEntry {
  timestamp: string;
  from_status: string;
  to_status: string;
  action: string;
  reason: string;
  quality_score?: number;
  quality_tier?: string;
}

function createAuditEntry(from: string, to: string, action: string, reason: string, qr?: QualityResult): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    from_status: from,
    to_status: to,
    action,
    reason,
    ...(qr ? { quality_score: qr.score, quality_tier: qr.tier } : {}),
  };
}

// ── SINGLE WRITE PATH for deep_enriched (CRITICAL) ─────────
/**
 * The ONLY function that may set enrichment_status = 'deep_enriched'.
 * Enforces completion contract and invariants before writing.
 */
export async function transitionToEnriched(
  resourceId: string,
  resource: ResourceForValidation,
): Promise<{ success: boolean; qualityResult: QualityResult; newStatus: string }> {
  const qr = validateResourceQuality(resource);

  log.info('transitionToEnriched gate', {
    resourceId,
    score: qr.score,
    tier: qr.tier,
    violations: qr.violations,
    passes: qr.passesCompletionContract,
  });

  let newStatus: string;
  if (qr.passesCompletionContract) {
    // Enforce invariant before write
    assertEnrichmentInvariants('deep_enriched', qr.tier);
    newStatus = 'deep_enriched';
  } else {
    newStatus = qr.tier === 'failed' ? 'failed' : 'incomplete';
  }

  const now = new Date().toISOString();
  const auditEntry = createAuditEntry(
    resource.enrichment_status,
    newStatus,
    'enrichment_complete',
    qr.passesCompletionContract ? 'Passed completion contract' : `Failed: ${qr.violations.join('; ')}`,
    qr,
  );

  const update: Record<string, any> = {
    enrichment_status: newStatus,
    last_status_change_at: now,
    last_enrichment_attempt_at: now,
    enrichment_version: CURRENT_ENRICHMENT_VERSION,
    validation_version: CURRENT_VALIDATION_VERSION,
    last_quality_score: qr.score,
    last_quality_tier: qr.tier,
  };

  if (newStatus === 'deep_enriched') {
    update.enriched_at = now;
    update.failure_reason = null;
    update.content_status = 'enriched'; // legacy sync
  } else {
    update.failure_reason = qr.violations.join('; ') || `Quality too low (score ${qr.score})`;
    update.failure_count = (resource as any).failure_count ? (resource as any).failure_count + 1 : 1;
    update.content_status = 'placeholder'; // legacy sync
  }

  const { error } = await supabase
    .from('resources')
    .update(update)
    .eq('id', resourceId);

  if (error) {
    log.error('Failed to update resource status', { resourceId, error });
    return { success: false, qualityResult: qr, newStatus: resource.enrichment_status };
  }

  // Append audit entry
  try {
    const { data: current } = await supabase
      .from('resources')
      .select('enrichment_audit_log')
      .eq('id', resourceId)
      .single();
    const existingLog = Array.isArray((current as any)?.enrichment_audit_log) ? (current as any).enrichment_audit_log : [];
    const newLog = [...existingLog.slice(-19), auditEntry]; // keep last 20
    await supabase.from('resources').update({ enrichment_audit_log: newLog }).eq('id', resourceId);
  } catch {
    // Non-critical
  }

  // ── Post-transition validation + auto-remediation ────────
  // Fire-and-forget: detect and self-heal any invalid states
  try {
    const { validateAndRemediate } = await import('./postIngestValidation');
    validateAndRemediate(resourceId).catch(() => { /* non-critical */ });
  } catch { /* dynamic import safety */ }

  return { success: true, qualityResult: qr, newStatus };
}

// ── Reconciliation ─────────────────────────────────────────
export interface ReconciliationReport {
  total: number;
  checked: number;
  corrected: number;
  downgraded: number;
  contradictions: number;
  details: Array<{
    id: string;
    title: string;
    oldStatus: string;
    newStatus: string;
    score: number;
    tier: string;
    reason: string;
  }>;
}

export async function runReconciliation(userId: string): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    total: 0,
    checked: 0,
    corrected: 0,
    downgraded: 0,
    contradictions: 0,
    details: [],
  };

  const { data: resources, error } = await supabase
    .from('resources')
    .select('id, title, content, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, description, last_quality_tier, failure_count')
    .eq('user_id', userId);

  if (error || !resources) {
    log.error('Reconciliation query failed', { error });
    return report;
  }

  report.total = resources.length;

  for (const r of resources) {
    report.checked++;
    const resource = r as any;

    // Only check deep_enriched resources for false positives
    if (resource.enrichment_status !== 'deep_enriched') continue;

    const qr = validateResourceQuality({
      id: resource.id,
      title: resource.title,
      content: resource.content,
      content_length: resource.content_length,
      enrichment_status: resource.enrichment_status,
      enrichment_version: resource.enrichment_version ?? 0,
      validation_version: resource.validation_version ?? 0,
      enriched_at: resource.enriched_at,
      failure_reason: resource.failure_reason,
      file_url: resource.file_url,
      description: resource.description,
    });

    if (!qr.passesCompletionContract) {
      const newStatus = qr.tier === 'failed' ? 'failed' : 'incomplete';
      report.downgraded++;
      report.corrected++;

      const auditEntry = createAuditEntry(
        'deep_enriched', newStatus, 'reconciliation_downgrade',
        `Score ${qr.score}, tier ${qr.tier}: ${qr.violations.join('; ')}`, qr,
      );

      await supabase.from('resources').update({
        enrichment_status: newStatus,
        last_status_change_at: new Date().toISOString(),
        last_quality_score: qr.score,
        last_quality_tier: qr.tier,
        validation_version: CURRENT_VALIDATION_VERSION,
        failure_reason: qr.violations.join('; '),
      }).eq('id', resource.id);

      report.details.push({
        id: resource.id,
        title: resource.title,
        oldStatus: 'deep_enriched',
        newStatus,
        score: qr.score,
        tier: qr.tier,
        reason: qr.violations.join('; '),
      });
    }
  }

  // Verify: no contradictions remain
  const { data: remaining } = await supabase
    .from('resources')
    .select('id')
    .eq('user_id', userId)
    .eq('enrichment_status', 'deep_enriched')
    .or('last_quality_tier.eq.shallow,last_quality_tier.eq.incomplete,last_quality_tier.eq.failed');

  report.contradictions = remaining?.length ?? 0;

  log.info('Reconciliation complete', {
    total: report.total,
    checked: report.checked,
    corrected: report.corrected,
    downgraded: report.downgraded,
    contradictions: report.contradictions,
  });

  return report;
}

// ── Drift detection (runtime check) ────────────────────────
export function detectDrift(resource: {
  enrichment_status: string;
  last_quality_tier?: string | null;
  last_quality_score?: number | null;
  enrichment_version?: number;
  validation_version?: number;
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
  }

  return { hasDrift: issues.length > 0, issues };
}
