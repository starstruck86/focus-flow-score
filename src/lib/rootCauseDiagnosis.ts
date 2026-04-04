/**
 * rootCauseDiagnosis.ts — Structured root-cause analysis for blocked resources.
 *
 * For every blocked resource, derives a structured diagnosis explaining:
 * - what category of failure caused the block
 * - which system layer is responsible
 * - what evidence supports the diagnosis
 * - what permanent fix prevents recurrence
 * - whether the fix is automatable
 */

import type { Resource } from '@/hooks/useResources';
import type { ResourceTruth, BlockerType } from '@/lib/resourceTruthState';

// ── Root-Cause Categories ─────────────────────────────────

export type RootCauseCategory =
  | 'stale_status'
  | 'stalled_job'
  | 'routing_misclassification'
  | 'enrichment_failed'
  | 'extraction_failed'
  | 'activation_failed'
  | 'auth_required'
  | 'missing_content'
  | 'contradictory_state'
  | 'reference_only'
  | 'unknown';

export type SourceLayer =
  | 'db_state'
  | 'truth_derivation'
  | 'routing_engine'
  | 'enrichment_pipeline'
  | 'extraction_pipeline'
  | 'activation_pipeline'
  | 'ui_surface';

export type ResolutionMethod =
  | 'normalize'
  | 'retry'
  | 're_enrich'
  | 're_extract'
  | 'activate'
  | 'manual_upload'
  | 'manual_review'
  | 'schema_fix'
  | 'truth_logic_fix';

export interface RootCauseEvidence {
  enrichment_status: string | null;
  active_job_status: string | null;
  active_job_type: string | null;
  active_job_error: string | null;
  content_length: number;
  ki_count: number;
  active_ki_count: number;
  active_ki_with_context_count: number;
  route_pipeline: string | null;
  extraction_method: string | null;
  last_attempt_at: string | null;
  retry_count: number;
}

export interface RootCauseDiagnosis {
  category: RootCauseCategory;
  source_layer: SourceLayer;
  explanation: string;
  evidence: RootCauseEvidence;
  permanent_fix: string;
  auto_fixable: boolean;
  resolved_by: ResolutionMethod;
}

// ── Category Labels ───────────────────────────────────────

export const ROOT_CAUSE_LABELS: Record<RootCauseCategory, string> = {
  stale_status: 'Stale Status',
  stalled_job: 'Stalled Job',
  routing_misclassification: 'Routing Error',
  enrichment_failed: 'Enrichment Failed',
  extraction_failed: 'Extraction Failed',
  activation_failed: 'Activation Failed',
  auth_required: 'Auth Required',
  missing_content: 'Missing Content',
  contradictory_state: 'Contradictory State',
  unknown: 'Unknown',
};

export const ROOT_CAUSE_COLORS: Record<RootCauseCategory, string> = {
  stale_status: 'text-amber-600',
  stalled_job: 'text-destructive',
  routing_misclassification: 'text-orange-600',
  enrichment_failed: 'text-destructive',
  extraction_failed: 'text-destructive',
  activation_failed: 'text-amber-600',
  auth_required: 'text-amber-600',
  missing_content: 'text-destructive',
  contradictory_state: 'text-destructive',
  unknown: 'text-muted-foreground',
};

// ── Resolution outcome labels ─────────────────────────────

export type ResolutionOutcome =
  | 'resolved_permanently'
  | 'temporarily_retried'
  | 'still_blocked_same_cause'
  | 'still_blocked_new_cause';

export const RESOLUTION_OUTCOME_LABELS: Record<ResolutionOutcome, string> = {
  resolved_permanently: 'Resolved permanently',
  temporarily_retried: 'Temporarily retried',
  still_blocked_same_cause: 'Still blocked — same root cause',
  still_blocked_new_cause: 'Still blocked — new root cause',
};

// ── Enriched statuses constant ────────────────────────────

const ENRICHED_STATUSES = ['deep_enriched', 'enriched', 'verified', 'extracted', 'extraction_retrying'];

// ── Main Diagnosis Function ───────────────────────────────

export function diagnoseRootCause(
  resource: Resource,
  truth: ResourceTruth,
): RootCauseDiagnosis {
  const rAny = resource as any;
  const enrichStatus = (resource.enrichment_status ?? '') as string;
  const contentLength = rAny.content_length ?? 0;
  const hasManualContent = rAny.manual_content_present === true;

  const evidence: RootCauseEvidence = {
    enrichment_status: enrichStatus || null,
    active_job_status: rAny.active_job_status ?? null,
    active_job_type: rAny.active_job_type ?? null,
    active_job_error: rAny.active_job_error ?? null,
    content_length: contentLength,
    ki_count: truth.ki_total,
    active_ki_count: truth.active_ki_total,
    active_ki_with_context_count: truth.active_ki_with_context_total,
    route_pipeline: rAny.route_pipeline ?? null,
    extraction_method: rAny.extraction_method ?? null,
    last_attempt_at: rAny.active_job_updated_at ?? rAny.updated_at ?? null,
    retry_count: rAny.extraction_retry_count ?? 0,
  };

  const primary = truth.primary_blocker;
  if (!primary) {
    return {
      category: 'unknown',
      source_layer: 'truth_derivation',
      explanation: 'No blocker detected but resource is not ready.',
      evidence,
      permanent_fix: 'Review resource state manually.',
      auto_fixable: false,
      resolved_by: 'manual_review',
    };
  }

  // ── Rule 1: extraction_retrying + existing KIs → stale status
  if (enrichStatus === 'extraction_retrying' && truth.ki_total > 0) {
    return {
      category: 'stale_status',
      source_layer: 'db_state',
      explanation: `Status stuck in "extraction_retrying" but ${truth.ki_total} KIs already exist. The retry marker was not cleared after a successful extraction.`,
      evidence,
      permanent_fix: 'Normalize enrichment_status to "extracted" and clear stale job markers.',
      auto_fixable: true,
      resolved_by: 'normalize',
    };
  }

  // ── Rule 2: Failed job status but has KIs → stale status
  if (rAny.active_job_status === 'failed' && truth.ki_total > 0) {
    return {
      category: 'stale_status',
      source_layer: 'db_state',
      explanation: `Job marked "failed" but ${truth.ki_total} KIs exist. The failure marker is stale and should be cleared.`,
      evidence,
      permanent_fix: 'Clear failed job status and normalize to succeeded.',
      auto_fixable: true,
      resolved_by: 'normalize',
    };
  }

  // ── Rule 3: Stalled job (running too long)
  if (truth.has_stuck_job) {
    return {
      category: 'stalled_job',
      source_layer: 'db_state',
      explanation: `Job "${rAny.active_job_type || 'unknown'}" has been running for ${Math.round(truth.stuck_duration_seconds / 60)}m without progress. ${rAny.active_job_error ? `Last error: ${rAny.active_job_error}` : 'No error recorded.'}`,
      evidence,
      permanent_fix: 'Clear stalled job status and retry the operation.',
      auto_fixable: true,
      resolved_by: 'retry',
    };
  }

  // ── Rule 4: Auth-required
  if (primary.type === 'needs_auth') {
    return {
      category: 'auth_required',
      source_layer: 'enrichment_pipeline',
      explanation: `Content is behind authentication. ${rAny.failure_reason || 'Login required to access source.'}`,
      evidence,
      permanent_fix: 'Provide authenticated content via manual upload or session-assisted extraction.',
      auto_fixable: false,
      resolved_by: 'manual_upload',
    };
  }

  // ── Rule 5: Contradictory state
  if (primary.type === 'contradictory_state') {
    return {
      category: 'contradictory_state',
      source_layer: 'truth_derivation',
      explanation: primary.detail,
      evidence,
      permanent_fix: 'Repair the underlying state: ensure lifecycle stage matches actual KI state.',
      auto_fixable: true,
      resolved_by: 'normalize',
    };
  }

  // ── Rule 6: Content-backed + enriched + 0 KIs → extraction failed
  if (
    (contentLength >= 200 || hasManualContent) &&
    ENRICHED_STATUSES.includes(enrichStatus) &&
    truth.ki_total === 0
  ) {
    return {
      category: 'extraction_failed',
      source_layer: 'extraction_pipeline',
      explanation: `Content is enriched (${enrichStatus}) with ${contentLength} chars but extraction produced 0 KIs. ${rAny.active_job_error ? `Last error: ${rAny.active_job_error}` : 'Extractor returned no valid segments.'}`,
      evidence,
      permanent_fix: 'Retry extraction with escalated method (dense_teaching or summary-first). If repeated failures, review content quality.',
      auto_fixable: true,
      resolved_by: 're_extract',
    };
  }

  // ── Rule 7: KIs exist but none active → activation failed
  if (primary.type === 'needs_activation' && truth.ki_total > 0 && truth.active_ki_total === 0) {
    return {
      category: 'activation_failed',
      source_layer: 'activation_pipeline',
      explanation: `${truth.ki_total} KIs exist but none are activated. The activation pipeline did not run or failed silently.`,
      evidence,
      permanent_fix: 'Run activation pipeline to operationalize existing KIs.',
      auto_fixable: true,
      resolved_by: 'activate',
    };
  }

  // ── Rule 8: Content-backed but not enriched + usable text exists → routing issue or enrichment needed
  if (
    (contentLength >= 200 || hasManualContent) &&
    !ENRICHED_STATUSES.includes(enrichStatus) &&
    enrichStatus !== 'needs_auth' &&
    primary.type === 'needs_enrichment'
  ) {
    // Check if this is a routing misclassification
    if (rAny.route_pipeline === 'transcribe' && (hasManualContent || contentLength >= 500)) {
      return {
        category: 'routing_misclassification',
        source_layer: 'routing_engine',
        explanation: `Route chose "${rAny.route_pipeline}" pipeline but usable text (${contentLength} chars) already exists. Manual content or parsed text should bypass transcription.`,
        evidence,
        permanent_fix: 'Update route selection to prioritize existing text over transcription. Re-enrich with correct pipeline.',
        auto_fixable: true,
        resolved_by: 're_enrich',
      };
    }

    return {
      category: 'enrichment_failed',
      source_layer: 'enrichment_pipeline',
      explanation: `Content available (${contentLength} chars) but status is "${enrichStatus || 'not_enriched'}". Enrichment has not run or failed.`,
      evidence,
      permanent_fix: 'Run deep enrichment to process content.',
      auto_fixable: true,
      resolved_by: 're_enrich',
    };
  }

  // ── Rule 9: Missing content
  if (primary.type === 'missing_content') {
    return {
      category: 'missing_content',
      source_layer: 'enrichment_pipeline',
      explanation: `Content length is ${contentLength} chars (below 200 threshold) and no manual content present. ${enrichStatus === 'failed' ? 'Previous enrichment attempt failed.' : 'Source may be inaccessible or empty.'}`,
      evidence,
      permanent_fix: 'Re-enrich from source URL, or upload content manually.',
      auto_fixable: contentLength > 0,
      resolved_by: contentLength > 0 ? 're_enrich' : 'manual_upload',
    };
  }

  // ── Rule 10: needs_extraction (general case)
  if (primary.type === 'needs_extraction') {
    return {
      category: 'extraction_failed',
      source_layer: 'extraction_pipeline',
      explanation: `Enriched but no KIs extracted. ${evidence.retry_count > 0 ? `${evidence.retry_count} previous attempts failed.` : 'No extraction attempt recorded.'}`,
      evidence,
      permanent_fix: 'Run extraction pipeline. If repeated failures, escalate extraction method.',
      auto_fixable: true,
      resolved_by: 're_extract',
    };
  }

  // ── Rule 11: Stale version
  if (primary.type === 'stale_version') {
    return {
      category: 'stale_status',
      source_layer: 'db_state',
      explanation: 'Resource has outdated enrichment/validation version. Re-enrichment will bring it current.',
      evidence,
      permanent_fix: 'Re-enrich to update to current version.',
      auto_fixable: true,
      resolved_by: 're_enrich',
    };
  }

  // ── Rule 12: Route confidence issues
  if (primary.type === 'route_low_confidence' || primary.type === 'route_manual_assist') {
    return {
      category: 'routing_misclassification',
      source_layer: 'routing_engine',
      explanation: `Routing engine flagged this resource for manual review: ${primary.detail}`,
      evidence,
      permanent_fix: 'Review and set manual route override, or improve routing rules for this source type.',
      auto_fixable: false,
      resolved_by: 'manual_review',
    };
  }

  // ── Fallback
  return {
    category: 'unknown',
    source_layer: 'truth_derivation',
    explanation: `Blocked by "${primary.type}": ${primary.detail}`,
    evidence,
    permanent_fix: 'Inspect resource and resolve manually.',
    auto_fixable: primary.fixability !== 'manual_only',
    resolved_by: primary.fixability === 'manual_only' ? 'manual_review' : 'retry',
  };
}

/**
 * Compare root causes before and after a Fix All run to determine resolution outcome.
 */
export function classifyResolutionOutcome(
  beforeCause: RootCauseCategory | null,
  afterTruth: ResourceTruth,
  afterResource: Resource,
): ResolutionOutcome {
  if (afterTruth.is_ready) return 'resolved_permanently';
  
  if (!afterTruth.primary_blocker) return 'resolved_permanently';
  
  const afterDiag = diagnoseRootCause(afterResource, afterTruth);
  
  if (beforeCause === afterDiag.category) return 'still_blocked_same_cause';
  if (beforeCause && afterDiag.category !== beforeCause) return 'still_blocked_new_cause';
  
  return 'temporarily_retried';
}
