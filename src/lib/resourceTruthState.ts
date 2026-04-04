/**
 * resourceTruthState.ts — SINGLE CANONICAL TRUTH for every resource.
 *
 * Every UI surface MUST consume deriveResourceTruth() instead of
 * assembling its own state from scattered sources.
 *
 * Hard rules enforced here:
 *  - ki_total = 0 → NEVER ready
 *  - active_ki_total = 0 → NEVER ready
 *  - stuck job → NEVER ready
 *  - downstream blocked → NEVER ready
 *  - contradiction detected → NEVER ready
 */

import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import { deriveProcessingState } from '@/lib/processingState';
import { deriveProcessingRoute, PIPELINE_LABELS, EXTRACTION_METHOD_LABELS, ASSET_LABELS } from '@/lib/processingRoute';
import { isJobStale, STALE_JOB_TIMEOUT_MS } from '@/store/useResourceJobProgress';

// ── Blocker Taxonomy ──────────────────────────────────────

export type BlockerType =
  | 'missing_content'
  | 'needs_enrichment'
  | 'needs_extraction'
  | 'needs_activation'
  | 'needs_auth'
  | 'missing_context'
  | 'stalled_enrichment'
  | 'stalled_extraction'
  | 'route_low_confidence'
  | 'route_manual_assist'
  | 'stale_version'
  | 'qa_required'
  | 'downstream_ineligible'
  | 'contradictory_state'
  | 'audit_mismatch'
  | 'unknown_processing_state'
  | 'reference_only';

export type BlockerSeverity = 'critical' | 'high' | 'medium' | 'low';
export type BlockerFixability = 'auto_fixable' | 'semi_auto_fixable' | 'manual_only';
export type BlockerOwnership = 'pipeline' | 'routing' | 'extraction' | 'activation' | 'eligibility' | 'ui_truth' | 'manual_review';

export interface Blocker {
  type: BlockerType;
  severity: BlockerSeverity;
  fixability: BlockerFixability;
  ownership: BlockerOwnership;
  label: string;
  detail: string;
}

export const BLOCKER_META: Record<BlockerType, { severity: BlockerSeverity; fixability: BlockerFixability; ownership: BlockerOwnership; label: string }> = {
  missing_content:          { severity: 'critical', fixability: 'semi_auto_fixable', ownership: 'pipeline',       label: 'Missing Content' },
  needs_enrichment:         { severity: 'high',     fixability: 'auto_fixable',      ownership: 'pipeline',       label: 'Needs Enrichment' },
  needs_extraction:         { severity: 'high',     fixability: 'auto_fixable',      ownership: 'extraction',     label: 'Needs Extraction' },
  needs_activation:         { severity: 'high',     fixability: 'auto_fixable',      ownership: 'activation',     label: 'Needs Activation' },
  needs_auth:               { severity: 'high',     fixability: 'manual_only',       ownership: 'manual_review',  label: 'Auth Required' },
  missing_context:          { severity: 'medium',   fixability: 'semi_auto_fixable', ownership: 'activation',     label: 'Missing Contexts' },
  stalled_enrichment:       { severity: 'critical', fixability: 'semi_auto_fixable', ownership: 'pipeline',       label: 'Stalled Enrichment' },
  stalled_extraction:       { severity: 'critical', fixability: 'semi_auto_fixable', ownership: 'extraction',     label: 'Stalled Extraction' },
  route_low_confidence:     { severity: 'medium',   fixability: 'manual_only',       ownership: 'routing',        label: 'Low Confidence Route' },
  route_manual_assist:      { severity: 'medium',   fixability: 'manual_only',       ownership: 'routing',        label: 'Manual Assist Required' },
  stale_version:            { severity: 'low',      fixability: 'auto_fixable',      ownership: 'pipeline',       label: 'Stale Version' },
  qa_required:              { severity: 'medium',   fixability: 'manual_only',       ownership: 'manual_review',  label: 'QA Required' },
  downstream_ineligible:    { severity: 'high',     fixability: 'semi_auto_fixable', ownership: 'eligibility',    label: 'Downstream Ineligible' },
  contradictory_state:      { severity: 'critical', fixability: 'semi_auto_fixable', ownership: 'ui_truth',       label: 'Contradictory State' },
  audit_mismatch:           { severity: 'high',     fixability: 'semi_auto_fixable', ownership: 'ui_truth',       label: 'Audit Mismatch' },
  unknown_processing_state: { severity: 'low',      fixability: 'manual_only',       ownership: 'pipeline',       label: 'Unknown State' },
  reference_only:           { severity: 'low',      fixability: 'manual_only',       ownership: 'manual_review',  label: 'Reference Only' },
};

function blocker(type: BlockerType, detail: string): Blocker {
  const m = BLOCKER_META[type];
  return { type, severity: m.severity, fixability: m.fixability, ownership: m.ownership, label: m.label, detail };
}

// ── Truth State ───────────────────────────────────────────

export type TruthState = 'ready' | 'processing' | 'blocked' | 'stalled' | 'qa_required' | 'quarantined' | 'reference_only';

export interface ResourceTruth {
  truth_state: TruthState;
  readiness_label: string;
  is_ready: boolean;
  is_operationalized: boolean;
  can_feed_downstream: boolean;
  processing_stage: string;
  primary_blocker: Blocker | null;
  secondary_blockers: Blocker[];
  all_blockers: Blocker[];
  next_required_action: { label: string; actionKey: string; variant: 'default' | 'outline' | 'ghost' } | null;
  ki_total: number;
  active_ki_total: number;
  active_ki_with_context_total: number;
  has_stuck_job: boolean;
  stuck_duration_seconds: number;
  integrity_issues: string[];
}

// ── Lifecycle info shape (from useCanonicalLifecycle) ──────

export interface LifecycleInfo {
  stage: string;
  blocked: string;
  kiCount: number;
  activeKi: number;
  activeKiWithCtx: number;
}

// ── Main derivation ───────────────────────────────────────

export function deriveResourceTruth(
  resource: Resource,
  lc: LifecycleInfo | undefined,
  audioJob?: AudioJobRecord | null,
): ResourceTruth {
  const blockers: Blocker[] = [];
  const integrity: string[] = [];
  const rAny = resource as any;

  // KI counts
  const kiTotal = lc?.kiCount ?? 0;
  const activeKiTotal = lc?.activeKi ?? 0;
  const activeKiWithCtx = lc?.activeKiWithCtx ?? 0;
  const stage = lc?.stage ?? 'uploaded';
  const blockedReason = lc?.blocked ?? 'none';

  // ── Stuck job detection ─────────────────────────────────
  let hasStuckJob = false;
  let stuckDurationSeconds = 0;
  if (rAny.active_job_status === 'running' && isJobStale(rAny.active_job_updated_at, 'running')) {
    hasStuckJob = true;
    stuckDurationSeconds = Math.round((Date.now() - new Date(rAny.active_job_updated_at).getTime()) / 1000);
    const jobType = rAny.active_job_type || 'unknown';
    const blockerType: BlockerType = jobType === 'enrich' || jobType === 'deep_enrich' ? 'stalled_enrichment' : 'stalled_extraction';
    blockers.push(blocker(blockerType, `Job stalled for ${Math.round(stuckDurationSeconds / 60)}m (timeout: ${STALE_JOB_TIMEOUT_MS / 60000}m)`));
  }

  // ── Processing state ────────────────────────────────────
  const ps = deriveProcessingState(resource, audioJob);
  const isActivelyProcessing = ps.state === 'RUNNING' && !hasStuckJob;

  // ── Content blockers ────────────────────────────────────
  const contentLength = rAny.content_length ?? 0;
  const hasManualContent = rAny.manual_content_present === true;
  const isContentBacked = contentLength >= 200 || hasManualContent;

  if (!isContentBacked && !isActivelyProcessing) {
    blockers.push(blocker('missing_content', 'Content length < 200 chars and no manual content'));
  }

  const enrichStatus = resource.enrichment_status ?? '';

  // ── Auth-gated resources — manual only ───────────────────
  const enrichStatusRaw = enrichStatus as string;
  if (enrichStatusRaw === 'needs_auth' && !isActivelyProcessing) {
    blockers.push(blocker('needs_auth', `Auth-gated content — ${rAny.failure_reason || 'login required'}`));
  }

  // ── Enrichment blockers ─────────────────────────────────
  const ENRICHED_STATUSES = ['deep_enriched', 'enriched', 'verified', 'extracted', 'extraction_retrying'];
  // Content-backed but not in an enriched state — needs enrichment.
  // Accept both READY and COMPLETED processing states (COMPLETED = content present but status stale).
  const canBeEnriched = ps.state === 'READY' || ps.state === 'COMPLETED';
  if (isContentBacked && !ENRICHED_STATUSES.includes(enrichStatusRaw) && enrichStatusRaw !== 'needs_auth' && canBeEnriched && !isActivelyProcessing) {
    blockers.push(blocker('needs_enrichment', `Status is "${enrichStatusRaw || 'not_enriched'}" — enrichment available`));
  }

  // ── Extraction blockers ─────────────────────────────────
  if (isContentBacked && kiTotal === 0 && ENRICHED_STATUSES.includes(enrichStatus) && !isActivelyProcessing) {
    blockers.push(blocker('needs_extraction', 'Content enriched but no knowledge items extracted'));
  }

  // ── Activation blockers ─────────────────────────────────
  if (kiTotal > 0 && activeKiTotal === 0 && !isActivelyProcessing) {
    blockers.push(blocker('needs_activation', `${kiTotal} KIs exist but none are active`));
  }

  // ── Missing context blocker ─────────────────────────────
  if (activeKiTotal > 0 && activeKiWithCtx === 0 && !isActivelyProcessing) {
    blockers.push(blocker('missing_context', `${activeKiTotal} active KIs but none have context tags`));
  }

  // ── Route blockers ──────────────────────────────────────
  const route = deriveProcessingRoute(resource);
  if (route.confidence === 'low' && !isActivelyProcessing && blockers.length === 0 && stage !== 'operationalized') {
    blockers.push(blocker('route_low_confidence', `Route confidence is low: ${route.reason.slice(-1)[0] || 'ambiguous routing'}`));
  }
  if (route.pipeline === 'manual_assist' && !isActivelyProcessing && stage !== 'operationalized') {
    blockers.push(blocker('route_manual_assist', 'Routing determined manual assistance required'));
  }

  // ── Stale blocker state ─────────────────────────────────
  if (blockedReason === 'stale_blocker_state') {
    blockers.push(blocker('stale_version', 'Resource has stale blocker state — needs review'));
  }

  // ── Integrity validation (contradiction detection) ──────
  // "operationalized" but 0 KIs
  if (stage === 'operationalized' && kiTotal === 0) {
    integrity.push('Stage is operationalized but KI count is 0');
    blockers.push(blocker('contradictory_state', 'Marked operationalized with 0 knowledge items'));
  }
  // "operationalized" but 0 active KIs
  if (stage === 'operationalized' && kiTotal > 0 && activeKiTotal === 0) {
    integrity.push('Stage is operationalized but active KI count is 0');
    blockers.push(blocker('contradictory_state', 'Marked operationalized with 0 active KIs'));
  }
  // Stuck job but lifecycle says operationalized
  if (hasStuckJob && stage === 'operationalized') {
    integrity.push('Job is stalled but stage is operationalized');
  }
  // Processing state says running but lifecycle says operationalized and no active job
  if (ps.state === 'RUNNING' && stage === 'operationalized' && !rAny.active_job_status) {
    integrity.push('Processing state says RUNNING but no active job found');
    blockers.push(blocker('contradictory_state', 'Processing state conflict — RUNNING with no active job'));
  }

  // ── Determine truth state ───────────────────────────────
  const hasBlockers = blockers.length > 0;
  const sortedBlockers = [...blockers].sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    return sev[a.severity] - sev[b.severity];
  });
  const primaryBlocker = sortedBlockers[0] ?? null;
  const secondaryBlockers = sortedBlockers.slice(1);

  let truth_state: TruthState;
  let readiness_label: string;

  if (enrichStatus === 'quarantined') {
    truth_state = 'quarantined';
    readiness_label = 'Quarantined';
  } else if (hasStuckJob) {
    truth_state = 'stalled';
    readiness_label = 'Stalled';
  } else if (isActivelyProcessing) {
    truth_state = 'processing';
    readiness_label = 'Processing';
  } else if (hasBlockers) {
    // Distinguish qa_required from blocked
    const hasQaBlocker = sortedBlockers.some(b => b.type === 'qa_required' || b.type === 'route_low_confidence' || b.type === 'needs_auth');
    const hasOnlyQa = sortedBlockers.every(b => b.type === 'qa_required' || b.type === 'route_low_confidence' || b.type === 'route_manual_assist' || b.type === 'needs_auth');
    if (hasOnlyQa) {
      truth_state = 'qa_required';
      readiness_label = 'QA Required';
    } else {
      truth_state = 'blocked';
      readiness_label = 'Blocked';
    }
  } else {
    // No blockers — truly ready
    truth_state = 'ready';
    readiness_label = 'Ready';
  }

  // ── is_operationalized: stage says so AND no blockers ───
  const is_operationalized = stage === 'operationalized' && !hasBlockers;
  const is_ready = truth_state === 'ready';
  const can_feed_downstream = is_ready && activeKiWithCtx > 0;

  // ── Next required action ────────────────────────────────
  let next_required_action: ResourceTruth['next_required_action'] = null;
  if (primaryBlocker) {
    switch (primaryBlocker.type) {
      case 'missing_content':
        next_required_action = { label: 'Add Content', actionKey: 'manual_assist', variant: 'default' };
        break;
      case 'needs_enrichment':
        next_required_action = { label: 'Enrich', actionKey: 'deep_enrich', variant: 'default' };
        break;
      case 'needs_extraction':
        next_required_action = { label: 'Extract', actionKey: 'extract', variant: 'default' };
        break;
      case 'needs_activation':
        next_required_action = { label: 'Activate', actionKey: 'activate', variant: 'default' };
        break;
      case 'needs_auth':
        next_required_action = { label: 'Add Content', actionKey: 'manual_assist', variant: 'default' };
        break;
      case 'missing_context':
        next_required_action = { label: 'Add Contexts', actionKey: 'repair_contexts', variant: 'outline' };
        break;
      case 'stalled_enrichment':
      case 'stalled_extraction':
        next_required_action = { label: 'Retry', actionKey: 'deep_enrich', variant: 'outline' };
        break;
      case 'route_low_confidence':
      case 'route_manual_assist':
        next_required_action = { label: 'Review', actionKey: 'view', variant: 'outline' };
        break;
      case 'stale_version':
        next_required_action = { label: 'Re-enrich', actionKey: 're_enrich', variant: 'outline' };
        break;
      case 'qa_required':
        next_required_action = { label: 'Review', actionKey: 'view', variant: 'outline' };
        break;
      case 'contradictory_state':
        next_required_action = { label: 'Fix State', actionKey: 'reset', variant: 'outline' };
        break;
      case 'audit_mismatch':
        next_required_action = { label: 'Review', actionKey: 'view', variant: 'outline' };
        break;
      case 'downstream_ineligible':
        next_required_action = { label: 'Fix Eligibility', actionKey: 'view', variant: 'outline' };
        break;
      default:
        next_required_action = { label: 'Review', actionKey: 'view', variant: 'outline' };
    }
  } else if (ps.state === 'READY' && resource.file_url?.startsWith('http') && !is_ready) {
    next_required_action = { label: 'Enrich', actionKey: 'deep_enrich', variant: 'default' };
  } else if (ps.state === 'RETRYABLE_FAILURE') {
    next_required_action = { label: 'Retry', actionKey: 'deep_enrich', variant: 'outline' };
  }

  return {
    truth_state,
    readiness_label,
    is_ready,
    is_operationalized,
    can_feed_downstream,
    processing_stage: stage,
    primary_blocker: primaryBlocker,
    secondary_blockers: secondaryBlockers,
    all_blockers: sortedBlockers,
    next_required_action,
    ki_total: kiTotal,
    active_ki_total: activeKiTotal,
    active_ki_with_context_total: activeKiWithCtx,
    has_stuck_job: hasStuckJob,
    stuck_duration_seconds: stuckDurationSeconds,
    integrity_issues: integrity,
  };
}

// ── Truth State UI Colors ─────────────────────────────────

export const TRUTH_STATE_COLORS: Record<TruthState, { text: string; bg: string }> = {
  ready:       { text: 'text-emerald-600', bg: 'bg-emerald-500/10' },
  processing:  { text: 'text-primary',     bg: 'bg-primary/10' },
  blocked:     { text: 'text-destructive',  bg: 'bg-destructive/10' },
  stalled:     { text: 'text-destructive',  bg: 'bg-destructive/10' },
  qa_required: { text: 'text-amber-600',    bg: 'bg-amber-500/10' },
  quarantined: { text: 'text-muted-foreground', bg: 'bg-muted' },
};

// ── Library Readiness ─────────────────────────────────────

export interface LibraryReadiness {
  total_resources: number;
  ready_resources: number;
  processing_resources: number;
  blocked_resources: number;
  stalled_resources: number;
  qa_required_resources: number;
  contradiction_count: number;
  unresolved_blocker_count: number;
  auto_fixable_blocker_count: number;
  manual_only_blocker_count: number;
  system_ready: boolean;
}

export function deriveLibraryReadiness(
  truths: ResourceTruth[],
): LibraryReadiness {
  let ready = 0, processing = 0, blocked = 0, stalled = 0, qa = 0;
  let contradictions = 0, unresolvedBlockers = 0, autoFixable = 0, manualOnly = 0;

  for (const t of truths) {
    switch (t.truth_state) {
      case 'ready': ready++; break;
      case 'processing': processing++; break;
      case 'blocked': blocked++; break;
      case 'stalled': stalled++; break;
      case 'qa_required': qa++; break;
      case 'quarantined': break; // intentionally excluded from blocker counts
    }
    contradictions += t.integrity_issues.length;
    for (const b of t.all_blockers) {
      if (b.type === 'contradictory_state') continue; // counted above
      unresolvedBlockers++;
      if (b.fixability === 'auto_fixable') autoFixable++;
      if (b.fixability === 'manual_only') manualOnly++;
    }
  }

  return {
    total_resources: truths.length,
    ready_resources: ready,
    processing_resources: processing,
    blocked_resources: blocked,
    stalled_resources: stalled,
    qa_required_resources: qa,
    contradiction_count: contradictions,
    unresolved_blocker_count: unresolvedBlockers,
    auto_fixable_blocker_count: autoFixable,
    manual_only_blocker_count: manualOnly,
    system_ready: autoFixable === 0 && contradictions === 0 && stalled === 0,
  };
}
