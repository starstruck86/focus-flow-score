/**
 * Post-Ingest Validation + Auto-Remediation
 *
 * Runs immediately after ingest completes (or on-demand as an audit sweep)
 * to detect resources that completed ingest in an invalid state, then
 * auto-remediates the fixable ones.
 *
 * Failure classes detected:
 *  1. transcript_extraction_not_triggered — transcript with content but no extraction
 *  2. pdf_parse_incomplete — placeholder content stored instead of parsed text
 *  3. auth_capture_incomplete — auth-gated PDF with no parsed text and no raw file
 *  4. enriched_no_extraction — enriched content with 0 KIs and 0 attempts
 *  5. extraction_ready_not_queued — content-ready resource sitting idle
 */

import { supabase } from '@/integrations/supabase/client';
import { isPlaceholderContent } from './canonicalLifecycle';
import { authenticatedFetch } from './authenticatedFetch';
import { createLogger } from './logger';

const log = createLogger('PostIngestValidation');

// ── Failure class types ───────────────────────────────────

export type FailureClass =
  | 'transcript_extraction_not_triggered'
  | 'pdf_parse_incomplete'
  | 'auth_capture_incomplete'
  | 'enriched_no_extraction'
  | 'extraction_ready_not_queued';

export interface ValidationViolation {
  resource_id: string;
  title: string;
  failure_class: FailureClass;
  detail: string;
  auto_repairable: boolean;
  repair_action: string;
}

export interface RemediationResult {
  resource_id: string;
  failure_class: FailureClass;
  action_taken: string;
  success: boolean;
  detail: string;
}

export interface ValidationReport {
  scanned: number;
  violations: ValidationViolation[];
  remediations: RemediationResult[];
  counts: Record<FailureClass, number>;
  timestamp: string;
}

// ── Constants ─────────────────────────────────────────────

const MIN_REAL_CONTENT = 200;
const ENRICHED_STATUSES = ['enriched', 'deep_enriched', 'verified', 'content_ready'];
const TRANSCRIPT_TYPES = ['transcript', 'podcast', 'audio'];

function emptyReport(): ValidationReport {
  return {
    scanned: 0,
    violations: [],
    remediations: [],
    counts: {
      transcript_extraction_not_triggered: 0,
      pdf_parse_incomplete: 0,
      auth_capture_incomplete: 0,
      enriched_no_extraction: 0,
      extraction_ready_not_queued: 0,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Single resource validation ────────────────────────────

export function validateResource(r: {
  id: string;
  title: string;
  resource_type?: string | null;
  content?: string | null;
  content_length?: number | null;
  enrichment_status?: string | null;
  file_url?: string | null;
  current_resource_ki_count?: number | null;
  extraction_attempt_count?: number | null;
  host_platform?: string | null;
  access_type?: string | null;
}): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const content = r.content ?? '';
  const contentLength = Math.max(r.content_length ?? 0, content.length);
  const kiCount = r.current_resource_ki_count ?? 0;
  const attempts = r.extraction_attempt_count ?? 0;
  const isPlaceholder = isPlaceholderContent(content);
  const hasRealContent = !isPlaceholder && contentLength >= MIN_REAL_CONTENT;
  const isTranscript = TRANSCRIPT_TYPES.includes(r.resource_type ?? '');
  const isEnriched = ENRICHED_STATUSES.includes(r.enrichment_status ?? '');

  // Rule 1: Transcript with content but no extraction
  if (isTranscript && hasRealContent && kiCount === 0 && attempts === 0) {
    violations.push({
      resource_id: r.id,
      title: r.title,
      failure_class: 'transcript_extraction_not_triggered',
      detail: `Transcript (${contentLength} chars) with 0 KIs and 0 extraction attempts`,
      auto_repairable: true,
      repair_action: 'queue_extraction',
    });
  }

  // Rule 2: Placeholder content (PDF parse incomplete)
  if (isPlaceholder && content.length > 0) {
    const hasRawFile = !!(r.file_url);
    if (hasRawFile) {
      violations.push({
        resource_id: r.id,
        title: r.title,
        failure_class: 'pdf_parse_incomplete',
        detail: `Placeholder content: "${content.slice(0, 60)}". Raw file exists — retry parse.`,
        auto_repairable: true,
        repair_action: 'retry_parse',
      });
    } else {
      // Rule 3: Auth-gated with no raw file
      violations.push({
        resource_id: r.id,
        title: r.title,
        failure_class: 'auth_capture_incomplete',
        detail: `Placeholder content with no raw file. Source may be auth-gated — re-import required.`,
        auto_repairable: false,
        repair_action: 're_import_with_auth',
      });
    }
  }

  // Rule 4: Enriched but 0 KIs and 0 attempts (non-transcript)
  if (!isTranscript && hasRealContent && isEnriched && kiCount === 0 && attempts === 0) {
    violations.push({
      resource_id: r.id,
      title: r.title,
      failure_class: 'enriched_no_extraction',
      detail: `Enriched (${r.enrichment_status}) with ${contentLength} chars but 0 KIs and 0 attempts`,
      auto_repairable: true,
      repair_action: 'queue_extraction',
    });
  }

  // Rule 5: Content-ready but not enriched and not queued
  if (hasRealContent && !isEnriched && !isPlaceholder && kiCount === 0 && attempts === 0 &&
      r.enrichment_status !== 'needs_auth' && r.enrichment_status !== 'quarantined') {
    violations.push({
      resource_id: r.id,
      title: r.title,
      failure_class: 'extraction_ready_not_queued',
      detail: `Content-ready (${contentLength} chars) but status is "${r.enrichment_status ?? 'not_enriched'}" — needs enrichment first`,
      auto_repairable: true,
      repair_action: 'queue_enrichment',
    });
  }

  return violations;
}

// ── Auto-remediation engine ───────────────────────────────

async function remediateViolation(v: ValidationViolation): Promise<RemediationResult> {
  const base: Omit<RemediationResult, 'action_taken' | 'success' | 'detail'> = {
    resource_id: v.resource_id,
    failure_class: v.failure_class,
  };

  // Not auto-repairable — diagnostic only
  if (!v.auto_repairable) {
    log.info('Remediation skipped — manual action required', {
      resourceId: v.resource_id,
      failureClass: v.failure_class,
      repairAction: v.repair_action,
    });
    return {
      ...base,
      action_taken: 'none',
      success: false,
      detail: `Manual action required: ${v.repair_action}. ${v.detail}`,
    };
  }

  try {
    switch (v.repair_action) {
      case 'queue_extraction': {
        log.info('Auto-remediation: enqueuing extraction', {
          resourceId: v.resource_id,
          failureClass: v.failure_class,
        });
        const response = await authenticatedFetch({
          functionName: 'batch-extract-kis',
          body: { resourceId: v.resource_id },
          componentName: 'PostIngestRemediation',
          timeoutMs: 150_000,
        });
        const ok = response.ok;
        const payload = await response.json().catch(() => ({}));
        log.info('Extraction enqueue result', {
          resourceId: v.resource_id,
          success: ok,
          status: response.status,
          savedCount: (payload as any)?.persistence?.saved_count,
          error: ok ? null : (payload as any)?.error,
        });
        return {
          ...base,
          action_taken: 'enqueued_extraction',
          success: ok,
          detail: ok
            ? `Extraction dispatched successfully (saved: ${(payload as any)?.persistence?.saved_count ?? '?'})`
            : `Extraction dispatch failed: ${(payload as any)?.error ?? `HTTP ${response.status}`}`,
        };
      }

      case 'retry_parse': {
        log.info('Auto-remediation: retrying PDF parse', {
          resourceId: v.resource_id,
          failureClass: v.failure_class,
        });
        const { data, error } = await supabase.functions.invoke('parse-uploaded-file', {
          body: { resource_id: v.resource_id },
        });
        const ok = !error;
        log.info('Parse retry result', {
          resourceId: v.resource_id,
          success: ok,
          contentLength: (data as any)?.content_length,
          error: error?.message,
        });
        return {
          ...base,
          action_taken: 'retried_parse',
          success: ok,
          detail: ok
            ? `Parse retried successfully (content: ${(data as any)?.content_length ?? '?'} chars)`
            : `Parse retry failed: ${error?.message ?? 'unknown error'}`,
        };
      }

      case 'queue_enrichment': {
        log.info('Auto-remediation: setting enrichment_status to not_enriched', {
          resourceId: v.resource_id,
          failureClass: v.failure_class,
        });
        // Mark as not_enriched so the enrichment pipeline picks it up
        const { error } = await supabase
          .from('resources')
          .update({
            enrichment_status: 'not_enriched',
            last_status_change_at: new Date().toISOString(),
          })
          .eq('id', v.resource_id);
        const ok = !error;
        log.info('Enrichment queue result', {
          resourceId: v.resource_id,
          success: ok,
          error: error?.message,
        });
        return {
          ...base,
          action_taken: 'queued_enrichment',
          success: ok,
          detail: ok
            ? 'Resource marked for enrichment (status reset to not_enriched)'
            : `Failed to queue enrichment: ${error?.message ?? 'unknown error'}`,
        };
      }

      default:
        return {
          ...base,
          action_taken: 'unknown',
          success: false,
          detail: `Unknown repair action: ${v.repair_action}`,
        };
    }
  } catch (err: any) {
    log.error('Remediation failed with exception', {
      resourceId: v.resource_id,
      failureClass: v.failure_class,
      error: err.message,
    });
    return {
      ...base,
      action_taken: v.repair_action,
      success: false,
      detail: `Exception during remediation: ${err.message}`,
    };
  }
}

// ── Validate + auto-remediate single resource ─────────────

export async function validateAndRemediate(resourceId: string): Promise<{
  violations: ValidationViolation[];
  remediations: RemediationResult[];
}> {
  const { data, error } = await supabase
    .from('resources')
    .select('id, title, resource_type, content, content_length, enrichment_status, file_url, current_resource_ki_count, extraction_attempt_count, host_platform, access_type')
    .eq('id', resourceId)
    .single();

  if (error || !data) {
    log.error('Validate-and-remediate query failed', { resourceId, error });
    return { violations: [], remediations: [] };
  }

  const violations = validateResource(data as any);
  if (violations.length === 0) {
    return { violations: [], remediations: [] };
  }

  log.info('Post-ingest violations found — running auto-remediation', {
    resourceId,
    title: (data as any).title,
    violationCount: violations.length,
    classes: violations.map(v => v.failure_class),
  });

  const remediations: RemediationResult[] = [];
  for (const v of violations) {
    const result = await remediateViolation(v);
    remediations.push(result);
  }

  log.info('Remediation summary', {
    resourceId,
    total: remediations.length,
    succeeded: remediations.filter(r => r.success).length,
    failed: remediations.filter(r => !r.success).length,
    actions: remediations.map(r => ({ action: r.action_taken, success: r.success })),
  });

  return { violations, remediations };
}

// ── Batch audit + remediate ───────────────────────────────

export async function runPostIngestAudit(userId: string, options?: { autoRemediate?: boolean }): Promise<ValidationReport> {
  const report = emptyReport();
  const shouldRemediate = options?.autoRemediate ?? false;

  const { data: resources, error } = await supabase
    .from('resources')
    .select('id, title, resource_type, content, content_length, enrichment_status, file_url, current_resource_ki_count, extraction_attempt_count, host_platform, access_type')
    .eq('user_id', userId);

  if (error || !resources) {
    log.error('Post-ingest audit query failed', { error });
    return report;
  }

  report.scanned = resources.length;

  for (const r of resources as any[]) {
    const violations = validateResource(r);
    for (const v of violations) {
      report.violations.push(v);
      report.counts[v.failure_class]++;

      if (shouldRemediate) {
        const result = await remediateViolation(v);
        report.remediations.push(result);
      }
    }
  }

  log.info('Post-ingest audit complete', {
    scanned: report.scanned,
    total_violations: report.violations.length,
    counts: report.counts,
    remediated: shouldRemediate,
    remediationResults: shouldRemediate ? {
      total: report.remediations.length,
      succeeded: report.remediations.filter(r => r.success).length,
      failed: report.remediations.filter(r => !r.success).length,
    } : null,
  });

  return report;
}

// ── Legacy export (kept for backward compat) ──────────────

export async function validateSingleResource(resourceId: string): Promise<ValidationViolation[]> {
  const result = await validateAndRemediate(resourceId);
  return result.violations;
}
