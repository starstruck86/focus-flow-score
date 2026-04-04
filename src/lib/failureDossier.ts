/**
 * failureDossier.ts — Per-resource forensic failure analysis.
 *
 * Provides exact diagnosis of WHY a resource is blocked, at which stage,
 * with what evidence, and what code/processing rule should change.
 */

import type { Resource } from '@/hooks/useResources';
import type { ResourceTruth } from '@/lib/resourceTruthState';
import { diagnoseRootCause, type RootCauseCategory, type RootCauseEvidence } from '@/lib/rootCauseDiagnosis';

// ── Failure Stage ─────────────────────────────────────────

export type FailureStage =
  | 'routing'
  | 'enrichment'
  | 'transcription'
  | 'parsing'
  | 'extraction'
  | 'activation'
  | 'truth_derivation'
  | 'state_normalization'
  | 'job_execution';

// ── Failure Mode ──────────────────────────────────────────

export type FailureMode =
  | 'no_content_extracted'
  | 'content_extracted_but_empty_segments'
  | 'content_extracted_but_zero_kis'
  | 'kis_created_but_not_activated'
  | 'auth_required'
  | 'job_stalled'
  | 'stale_status'
  | 'pipeline_misrouted'
  | 'contradictory_state'
  | 'unsupported_format'
  | 'timeout'
  | 'silent_no_output'
  | 'parser_failure'
  | 'unknown';

// ── Dossier Evidence ──────────────────────────────────────

export interface DossierEvidence {
  // Source/input
  source_url: string | null;
  resource_type: string | null;
  content_length: number;
  manual_content_present: boolean;
  transcript_present: boolean;
  lesson_text_present: boolean;
  parsed_content_present: boolean;

  // Routing
  route_pipeline: string | null;
  route_primary_asset: string | null;
  route_extraction_method: string | null;
  route_confidence: string | null;
  route_reasons: string[];
  route_override: boolean;

  // Enrichment
  enrichment_status: string | null;
  enriched_at: string | null;
  failure_reason: string | null;

  // Extraction
  extraction_attempt_count: number;
  extraction_method: string | null;
  ki_count: number;
  active_ki_count: number;
  active_ki_with_context_count: number;

  // Job
  active_job_status: string | null;
  active_job_type: string | null;
  active_job_error: string | null;
  active_job_started_at: string | null;
  active_job_updated_at: string | null;
  active_job_finished_at: string | null;
  job_elapsed_seconds: number | null;

  // State
  canonical_stage: string | null;
  truth_state: string;
  primary_blocker: string | null;
  integrity_issues: string[];
}

// ── Dossier ───────────────────────────────────────────────

export interface ResourceFailureDossier {
  resource_id: string;
  resource_title: string;
  resource_type: string | null;
  current_truth_state: string;
  current_primary_blocker: string | null;

  root_cause_category: RootCauseCategory;
  root_cause_confidence: 'high' | 'medium' | 'low';
  failure_stage: FailureStage;
  failure_mode: FailureMode;

  exact_explanation: string;
  evidence: DossierEvidence;

  recommended_permanent_fix: string;
  recommended_immediate_action: string;
  future_prevention_rule: string;
}

// ── Stage / Mode Labels ───────────────────────────────────

export const FAILURE_STAGE_LABELS: Record<FailureStage, string> = {
  routing: 'Routing',
  enrichment: 'Enrichment',
  transcription: 'Transcription',
  parsing: 'Parsing',
  extraction: 'Extraction',
  activation: 'Activation',
  truth_derivation: 'Truth Derivation',
  state_normalization: 'State Normalization',
  job_execution: 'Job Execution',
};

export const FAILURE_MODE_LABELS: Record<FailureMode, string> = {
  no_content_extracted: 'No content extracted',
  content_extracted_but_empty_segments: 'Content present, empty segments',
  content_extracted_but_zero_kis: 'Content present, 0 KIs produced',
  kis_created_but_not_activated: 'KIs exist, none activated',
  auth_required: 'Authentication required',
  job_stalled: 'Job stalled',
  stale_status: 'Stale status marker',
  pipeline_misrouted: 'Pipeline misrouted',
  contradictory_state: 'Contradictory state',
  unsupported_format: 'Unsupported format',
  timeout: 'Timeout',
  silent_no_output: 'Silent no-output',
  parser_failure: 'Parser failure',
  unknown: 'Unknown',
};

// ── Evidence Builder ──────────────────────────────────────

function buildEvidence(resource: Resource, truth: ResourceTruth): DossierEvidence {
  const r = resource as any;
  const jobUpdated = r.active_job_updated_at ?? r.active_job_started_at;
  const jobElapsed = jobUpdated ? Math.round((Date.now() - new Date(jobUpdated).getTime()) / 1000) : null;

  return {
    source_url: r.file_url ?? null,
    resource_type: r.resource_type ?? r.type ?? null,
    content_length: r.content_length ?? 0,
    manual_content_present: r.manual_content_present === true,
    transcript_present: !!(r.transcript_text || r.has_transcript),
    lesson_text_present: !!(r.lesson_text),
    parsed_content_present: (r.content_length ?? 0) >= 200,

    route_pipeline: r.route_pipeline ?? null,
    route_primary_asset: r.route_primary_asset ?? null,
    route_extraction_method: r.route_extraction_method ?? null,
    route_confidence: r.route_confidence ?? null,
    route_reasons: r.route_reasons ?? [],
    route_override: r.route_override === true,

    enrichment_status: r.enrichment_status ?? null,
    enriched_at: r.enriched_at ?? null,
    failure_reason: r.failure_reason ?? null,

    extraction_attempt_count: r.extraction_attempt_count ?? r.extraction_retry_count ?? 0,
    extraction_method: r.extraction_method ?? null,
    ki_count: truth.ki_total,
    active_ki_count: truth.active_ki_total,
    active_ki_with_context_count: truth.active_ki_with_context_total,

    active_job_status: r.active_job_status ?? null,
    active_job_type: r.active_job_type ?? null,
    active_job_error: r.active_job_error ?? null,
    active_job_started_at: r.active_job_started_at ?? null,
    active_job_updated_at: r.active_job_updated_at ?? null,
    active_job_finished_at: r.active_job_finished_at ?? null,
    job_elapsed_seconds: jobElapsed,

    canonical_stage: truth.processing_stage ?? null,
    truth_state: truth.truth_state,
    primary_blocker: truth.primary_blocker?.type ?? null,
    integrity_issues: truth.integrity_issues,
  };
}

// ── Classification Rules ──────────────────────────────────

const ENRICHED_STATUSES = ['deep_enriched', 'enriched', 'verified', 'extracted', 'extraction_retrying', 'content_ready'];

export function buildFailureDossier(resource: Resource, truth: ResourceTruth): ResourceFailureDossier | null {
  // Only blocked/stalled/qa resources get dossiers
  if (truth.is_ready) return null;
  if (truth.truth_state === 'processing') return null;

  const r = resource as any;
  const evidence = buildEvidence(resource, truth);
  const rootCause = diagnoseRootCause(resource, truth);
  const enrichStatus = (r.enrichment_status ?? '') as string;
  const contentLength = r.content_length ?? 0;

  let stage: FailureStage = 'extraction';
  let mode: FailureMode = 'unknown';
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let explanation = rootCause.explanation;
  let immediateFix = rootCause.permanent_fix;
  let permanentFix = rootCause.permanent_fix;
  let prevention = 'Review this failure class and add automated guardrails.';

  // ── Rule 1: extraction_retrying + existing KIs → stale status
  if (enrichStatus === 'extraction_retrying' && truth.ki_total > 0) {
    stage = 'state_normalization';
    mode = 'stale_status';
    confidence = 'high';
    explanation = `Status stuck in "extraction_retrying" but ${truth.ki_total} KIs already exist. The retry marker was never cleared after successful extraction.`;
    immediateFix = 'Normalize status to "extracted" and clear stale job markers.';
    permanentFix = 'Auto-normalize resources with extraction_retrying status when KI count > 0.';
    prevention = 'Any resource with extraction_retrying + KI count > 0 must auto-normalize on refresh.';
  }

  // ── Rule 2: Failed job status but has KIs → stale status
  else if (r.active_job_status === 'failed' && truth.ki_total > 0) {
    stage = 'state_normalization';
    mode = 'stale_status';
    confidence = 'high';
    explanation = `Job marked "failed" but ${truth.ki_total} KIs exist. The failure marker is stale from a partial success.`;
    immediateFix = 'Clear failed job status.';
    permanentFix = 'Clear failed job markers automatically when KIs are present.';
    prevention = 'Failed job markers on resources with KIs must auto-clear.';
  }

  // ── Rule 3: Stalled job
  else if (truth.has_stuck_job) {
    stage = 'job_execution';
    mode = 'job_stalled';
    confidence = 'high';
    const mins = Math.round(truth.stuck_duration_seconds / 60);
    explanation = `Job "${r.active_job_type || 'unknown'}" has been running ${mins}m with no progress. ${r.active_job_error ? `Last error: ${r.active_job_error}` : 'No error recorded.'}`;
    immediateFix = 'Clear stalled job status and retry.';
    permanentFix = 'Add job timeout watchdog that auto-clears stalled jobs after threshold.';
    prevention = 'Jobs running > 10m without progress must auto-reset.';
  }

  // ── Rule 4: Auth required
  else if (truth.primary_blocker?.type === 'needs_auth') {
    stage = 'enrichment';
    mode = 'auth_required';
    confidence = 'high';
    explanation = `Content is behind authentication. ${r.failure_reason || 'Login required to access source.'}`;
    immediateFix = 'Upload authenticated content manually or use session-assisted extraction.';
    permanentFix = 'Detect auth-walls earlier in enrichment and classify as auth_required immediately.';
    prevention = 'Auth-gated resources must be classified distinctly from generic enrichment failures.';
  }

  // ── Rule 5: Contradictory state
  else if (truth.primary_blocker?.type === 'contradictory_state') {
    stage = 'truth_derivation';
    mode = 'contradictory_state';
    confidence = 'high';
    explanation = truth.primary_blocker.detail;
    immediateFix = 'Repair lifecycle stage to match actual KI state.';
    permanentFix = 'Ensure lifecycle stage transitions verify KI presence before marking operationalized.';
    prevention = 'Stage = operationalized must be gated by KI count > 0 AND active KI count > 0.';
  }

  // ── Rule 6: Content-backed + enriched + 0 KIs → extraction failure
  else if (
    (contentLength >= 200 || r.manual_content_present) &&
    ENRICHED_STATUSES.includes(enrichStatus) &&
    truth.ki_total === 0
  ) {
    stage = 'extraction';
    confidence = 'high';

    // Sub-classify: did extraction attempt happen?
    const attempts = r.extraction_attempt_count ?? 0;
    if (attempts === 0) {
      mode = 'silent_no_output';
      explanation = `Content is enriched (${enrichStatus}, ${contentLength} chars) but extraction was never attempted. The extraction pipeline may not have been triggered.`;
      immediateFix = 'Run extraction explicitly.';
      permanentFix = 'Ensure enriched resources always trigger extraction automatically.';
      prevention = 'Any enriched resource with 0 KIs and 0 extraction attempts must flag for extraction.';
    } else if (r.active_job_error) {
      mode = 'content_extracted_but_zero_kis';
      explanation = `${attempts} extraction attempt(s) completed but produced 0 KIs. Last error: ${r.active_job_error}`;
      immediateFix = 'Retry extraction with escalated method (dense_teaching or summary-first).';
      permanentFix = 'Persist extraction empty-output reasons instead of generic failure. Escalate method automatically.';
      prevention = 'Extraction producing 0 KIs must store the exact failure reason and trigger method escalation.';
    } else {
      mode = 'content_extracted_but_zero_kis';
      explanation = `${attempts} extraction attempt(s) completed but produced 0 KIs. No error recorded — extractor may have returned empty output or post-filters removed all candidates.`;
      immediateFix = 'Retry with dense_teaching method. If content is very short, try summary-first.';
      permanentFix = 'Differentiate "extractor returned 0 segments" from "post-filter removed all KIs". Persist structured extraction outcome.';
      prevention = 'Any extraction completing with 0 KIs must persist a structured outcome summary explaining why.';
    }
  }

  // ── Rule 7: KIs exist but none active → activation failure
  else if (truth.ki_total > 0 && truth.active_ki_total === 0) {
    stage = 'activation';
    mode = 'kis_created_but_not_activated';
    confidence = 'high';
    explanation = `${truth.ki_total} KIs exist but none are activated. Activation pipeline did not run or failed silently.`;
    immediateFix = 'Run activation/operationalization pipeline.';
    permanentFix = 'Ensure extraction completion always triggers activation automatically.';
    prevention = 'Any resource with KIs but 0 active KIs must auto-trigger activation.';
  }

  // ── Rule 8: Route misclassification
  else if (
    (contentLength >= 500 || r.manual_content_present) &&
    r.route_pipeline === 'transcribe' &&
    !ENRICHED_STATUSES.includes(enrichStatus)
  ) {
    stage = 'routing';
    mode = 'pipeline_misrouted';
    confidence = 'high';
    explanation = `Route chose "${r.route_pipeline}" pipeline but ${contentLength} chars of usable text already exist. Text content should bypass transcription.`;
    immediateFix = 'Override route to direct_extract and re-enrich.';
    permanentFix = 'Update route selection to prioritize existing text over transcription.';
    prevention = 'Any resource with text content ≥ 500 chars must not be routed through transcription.';
  }

  // ── Rule 9: Missing content
  else if (truth.primary_blocker?.type === 'missing_content') {
    stage = 'enrichment';
    mode = contentLength > 0 ? 'parser_failure' : 'no_content_extracted';
    confidence = contentLength > 0 ? 'medium' : 'high';
    if (contentLength > 0 && contentLength < 200) {
      explanation = `Content length is ${contentLength} chars (below 200 threshold). Content was extracted but is too short — may be a login page, nav text, or truncated content.`;
      immediateFix = 'Re-enrich from source URL or upload content manually.';
      permanentFix = 'Validate extracted content quality before persisting — reject nav/login text.';
      prevention = 'Content under 200 chars after enrichment must be validated for quality, not just length.';
    } else {
      explanation = `No content extracted. Source may be inaccessible, empty, or in an unsupported format. ${r.failure_reason ? `Failure: ${r.failure_reason}` : ''}`;
      immediateFix = 'Upload content manually.';
      permanentFix = 'Improve enrichment to handle this source type.';
      prevention = 'Resources with 0 content after enrichment must persist the exact failure reason.';
    }
  }

  // ── Rule 10: Needs enrichment (general)
  else if (truth.primary_blocker?.type === 'needs_enrichment') {
    stage = 'enrichment';
    mode = 'no_content_extracted';
    confidence = 'medium';
    explanation = `Status is "${enrichStatus || 'not_enriched'}" — enrichment hasn't run or failed. Content length: ${contentLength}.`;
    immediateFix = 'Run deep enrichment.';
    permanentFix = 'Ensure all ingested resources are automatically enriched.';
    prevention = 'Any resource with a valid source URL must auto-enrich after ingestion.';
  }

  // ── Rule 11: Needs extraction (general fallback)
  else if (truth.primary_blocker?.type === 'needs_extraction') {
    stage = 'extraction';
    mode = 'silent_no_output';
    confidence = 'medium';
    explanation = `Enriched but no KIs extracted. ${evidence.extraction_attempt_count > 0 ? `${evidence.extraction_attempt_count} attempt(s) recorded.` : 'No extraction attempt recorded.'}`;
    immediateFix = 'Run extraction pipeline.';
    permanentFix = 'Ensure extraction attempts persist structured outcomes.';
    prevention = 'Extraction failures must always record exactly why 0 KIs were produced.';
  }

  // ── Fallback
  else {
    stage = 'truth_derivation';
    mode = 'unknown';
    confidence = 'low';
    explanation = `Blocked by "${truth.primary_blocker?.type ?? 'unknown'}": ${truth.primary_blocker?.detail ?? 'No detail available.'}`;
    immediateFix = 'Inspect resource and resolve manually.';
    permanentFix = 'Investigate this blocker class and add specific handling.';
    prevention = 'New blocker types must have explicit handling in the truth model.';
  }

  return {
    resource_id: resource.id,
    resource_title: resource.title || 'Untitled',
    resource_type: r.resource_type ?? r.type ?? null,
    current_truth_state: truth.truth_state,
    current_primary_blocker: truth.primary_blocker?.type ?? null,

    root_cause_category: rootCause.category,
    root_cause_confidence: confidence,
    failure_stage: stage,
    failure_mode: mode,

    exact_explanation: explanation,
    evidence,

    recommended_permanent_fix: permanentFix,
    recommended_immediate_action: immediateFix,
    future_prevention_rule: prevention,
  };
}

// ── Grouped Insights ──────────────────────────────────────

export interface DossierInsights {
  by_root_cause: Record<string, number>;
  by_failure_stage: Record<string, number>;
  by_failure_mode: Record<string, number>;
  by_resource_type: Record<string, number>;
  by_route_pipeline: Record<string, number>;
  top_prevention_rules: string[];
  top_permanent_fixes: string[];
}

export function aggregateDossierInsights(dossiers: ResourceFailureDossier[]): DossierInsights {
  const byCause: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byPipeline: Record<string, number> = {};
  const fixCounts: Record<string, number> = {};
  const prevCounts: Record<string, number> = {};

  for (const d of dossiers) {
    byCause[d.root_cause_category] = (byCause[d.root_cause_category] ?? 0) + 1;
    byStage[d.failure_stage] = (byStage[d.failure_stage] ?? 0) + 1;
    byMode[d.failure_mode] = (byMode[d.failure_mode] ?? 0) + 1;
    const rt = d.resource_type ?? 'unknown';
    byType[rt] = (byType[rt] ?? 0) + 1;
    const rp = d.evidence.route_pipeline ?? 'none';
    byPipeline[rp] = (byPipeline[rp] ?? 0) + 1;
    fixCounts[d.recommended_permanent_fix] = (fixCounts[d.recommended_permanent_fix] ?? 0) + 1;
    prevCounts[d.future_prevention_rule] = (prevCounts[d.future_prevention_rule] ?? 0) + 1;
  }

  const topFixes = Object.entries(fixCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const topPrev = Object.entries(prevCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  return {
    by_root_cause: byCause,
    by_failure_stage: byStage,
    by_failure_mode: byMode,
    by_resource_type: byType,
    by_route_pipeline: byPipeline,
    top_prevention_rules: topPrev,
    top_permanent_fixes: topFixes,
  };
}
