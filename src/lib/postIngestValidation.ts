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
 *
 * Idempotency: Two layers prevent duplicate remediation:
 *  - In-memory dedup map (fast, same-tab, 60s window)
 *  - Durable DB column `last_remediation_at` (cross-tab, cross-reload, 5min cooldown)
 *
 * In-flight protection: Before dispatching, checks for active background_jobs
 * and resource heartbeat fields to avoid duplicate work.
 */

import { supabase } from '@/integrations/supabase/client';
import { isPlaceholderContent } from './canonicalLifecycle';
import { authenticatedFetch } from './authenticatedFetch';
import { createLogger } from './logger';

const log = createLogger('PostIngestValidation');

// ── In-memory idempotency (fast, same-tab) ────────────────
const DEDUP_WINDOW_MS = 60_000;
const recentRemediations = new Map<string, number>();

function isDuplicateInMemory(resourceId: string): boolean {
  const lastTime = recentRemediations.get(resourceId);
  return !!(lastTime && Date.now() - lastTime < DEDUP_WINDOW_MS);
}

function markRemediatedInMemory(resourceId: string): void {
  recentRemediations.set(resourceId, Date.now());
  if (recentRemediations.size > 200) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [id, ts] of recentRemediations) {
      if (ts < cutoff) recentRemediations.delete(id);
    }
  }
}

// ── Durable idempotency (cross-tab, cross-reload) ─────────
const DURABLE_COOLDOWN_MS = 5 * 60_000; // 5 minutes

async function isDuplicateDurable(resourceId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('resources')
      .select('last_remediation_at')
      .eq('id', resourceId)
      .single();

    if (!data?.last_remediation_at) return false;
    const elapsed = Date.now() - new Date(data.last_remediation_at).getTime();
    return elapsed < DURABLE_COOLDOWN_MS;
  } catch {
    return false; // fail open — allow remediation if check fails
  }
}

async function markRemediatedDurable(resourceId: string): Promise<void> {
  try {
    await supabase
      .from('resources')
      .update({ last_remediation_at: new Date().toISOString() } as any)
      .eq('id', resourceId);
  } catch {
    // Non-critical
  }
}

// ── In-flight operation detection ─────────────────────────
// Checks background_jobs table and resource heartbeat fields
// to determine if a matching operation is already running.

type OperationType = 'extraction' | 'parse' | 'enrichment';

async function hasInFlightOperation(resourceId: string, opType: OperationType): Promise<boolean> {
  try {
    // Check 1: Active background_jobs for this resource
    const jobTypes: string[] = opType === 'extraction'
      ? ['extraction', 'batch-extract-kis', 'extract-tactics']
      : opType === 'parse'
        ? ['parse', 'parse-uploaded-file']
        : ['enrichment', 'run-enrichment-job'];

    const { data: activeJobs } = await supabase
      .from('background_jobs')
      .select('id, status, type')
      .eq('entity_id', resourceId)
      .in('status', ['queued', 'running'])
      .limit(1);

    if (activeJobs && activeJobs.length > 0) {
      log.info('In-flight job detected via background_jobs', {
        resourceId,
        opType,
        jobId: activeJobs[0].id,
        jobStatus: activeJobs[0].status,
      });
      return true;
    }

    // Check 2: Resource heartbeat — if active_job_updated_at is recent (< 3 min)
    const { data: resource } = await supabase
      .from('resources')
      .select('active_job_step_label, active_job_updated_at')
      .eq('id', resourceId)
      .single();

    if (resource?.active_job_updated_at) {
      const heartbeatAge = Date.now() - new Date(resource.active_job_updated_at).getTime();
      if (heartbeatAge < 3 * 60_000) { // 3 minutes
        log.info('In-flight operation detected via resource heartbeat', {
          resourceId,
          opType,
          stepLabel: resource.active_job_step_label,
          heartbeatAgeMs: heartbeatAge,
        });
        return true;
      }
    }

    // Check 3: enrichment_status indicates in-progress work
    if (opType === 'extraction' || opType === 'enrichment') {
      const { data: statusData } = await supabase
        .from('resources')
        .select('enrichment_status')
        .eq('id', resourceId)
        .single();

      const inProgressStatuses = [
        'deep_enrich_in_progress',
        'reenrich_in_progress',
        'queued_for_deep_enrich',
        'queued_for_reenrich',
      ];
      if (statusData && inProgressStatuses.includes(statusData.enrichment_status)) {
        log.info('In-flight operation detected via enrichment_status', {
          resourceId,
          opType,
          status: statusData.enrichment_status,
        });
        return true;
      }
    }

    return false;
  } catch (err: any) {
    log.error('In-flight check failed — allowing remediation', { resourceId, opType, error: err.message });
    return false; // fail open
  }
}

// ── Failure class types ───────────────────────────────────

export type FailureClass =
  | 'transcript_extraction_not_triggered'
  | 'pdf_parse_incomplete'
  | 'auth_capture_incomplete'
  | 'enriched_no_extraction'
  | 'extraction_ready_not_queued'
  | 'placeholder_enriched_contradiction';

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
      placeholder_enriched_contradiction: 0,
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

  // Rule 2b: IMPOSSIBLE STATE — placeholder content must never coexist with enriched/deep_enriched
  // Auto-correct the enrichment status immediately.
  if (isPlaceholder && isEnriched) {
    violations.push({
      resource_id: r.id,
      title: r.title,
      failure_class: 'placeholder_enriched_contradiction',
      detail: `Placeholder content ("${content.slice(0, 40)}…") with enrichment_status="${r.enrichment_status}" — impossible state, auto-correcting.`,
      auto_repairable: true,
      repair_action: 'reset_enrichment_status',
    });
  }

  // Rule 4: Enriched but 0 KIs and 0 attempts (non-transcript only —
  // transcripts are already covered by Rule 1 with a more specific class)
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

function repairActionToOpType(action: string): OperationType {
  switch (action) {
    case 'queue_extraction': return 'extraction';
    case 'retry_parse': return 'parse';
    case 'queue_enrichment': return 'enrichment';
    default: return 'extraction';
  }
}

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

  // In-flight check: skip if a matching operation is already running
  const opType = repairActionToOpType(v.repair_action);
  const inFlight = await hasInFlightOperation(v.resource_id, opType);
  if (inFlight) {
    log.info('Remediation skipped — in-flight operation detected', {
      resourceId: v.resource_id,
      failureClass: v.failure_class,
      opType,
    });
    return {
      ...base,
      action_taken: 'skipped_in_flight',
      success: true, // Not a failure — work is already happening
      detail: `Skipped: ${opType} operation already in flight for this resource`,
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
  // Layer 1: In-memory dedup (fast, same-tab)
  if (isDuplicateInMemory(resourceId)) {
    log.info('Skipping remediation — in-memory dedup', { resourceId });
    return { violations: [], remediations: [] };
  }

  // Layer 2: Durable DB cooldown (cross-tab, cross-reload)
  const durableDup = await isDuplicateDurable(resourceId);
  if (durableDup) {
    log.info('Skipping remediation — durable cooldown active', { resourceId, cooldownMs: DURABLE_COOLDOWN_MS });
    markRemediatedInMemory(resourceId); // sync memory to avoid re-checking DB
    return { violations: [], remediations: [] };
  }

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

  // Mark as remediated in BOTH layers BEFORE dispatching
  markRemediatedInMemory(resourceId);
  await markRemediatedDurable(resourceId);

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
        // In-flight + durable checks per resource during batch
        const opType = repairActionToOpType(v.repair_action);
        const inFlight = await hasInFlightOperation(v.resource_id, opType);
        if (inFlight) {
          report.remediations.push({
            resource_id: v.resource_id,
            failure_class: v.failure_class,
            action_taken: 'skipped_in_flight',
            success: true,
            detail: `Skipped: ${opType} already in flight`,
          });
          continue;
        }

        const durableDup = await isDuplicateDurable(v.resource_id);
        if (durableDup) {
          report.remediations.push({
            resource_id: v.resource_id,
            failure_class: v.failure_class,
            action_taken: 'skipped_cooldown',
            success: true,
            detail: 'Skipped: durable cooldown active',
          });
          continue;
        }

        await markRemediatedDurable(v.resource_id);
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
      skipped: report.remediations.filter(r => r.action_taken.startsWith('skipped_')).length,
    } : null,
  });

  return report;
}

// ── Legacy export (kept for backward compat) ──────────────

export async function validateSingleResource(resourceId: string): Promise<ValidationViolation[]> {
  const result = await validateAndRemediate(resourceId);
  return result.violations;
}
