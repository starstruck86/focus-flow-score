/**
 * Enrichment Verification Engine
 * 
 * Evaluates REAL resources from the database against the enrichment system's
 * expected behavior. Detects contradictions, misclassifications, and stuck states.
 */
import type { Resource } from '@/hooks/useResources';
import { detectResourceSubtype, classifyEnrichability, getSubtypeLabel, type ResourceSubtype, type EnrichabilityState } from '@/lib/salesBrain/resourceSubtype';
import { validateResourceQuality, type QualityResult } from '@/lib/resourceQuality';
import { routeFailure, type FailureBucket, NON_RETRYABLE_BUCKETS } from '@/lib/failureRouting';
import { getEnrichmentStatusLabel, type EnrichmentStatus } from '@/lib/resourceEligibility';
import { generateRemediationPlan } from '@/lib/remediationIntelligence';

// ── Types ──────────────────────────────────────────────────

export type FixabilityBucket =
  | 'auto_fix_now'
  | 'retry_different_strategy'
  | 'needs_alternate_source'
  | 'needs_transcript'
  | 'needs_pasted_content'
  | 'needs_access_auth'
  | 'accept_metadata_only'
  | 'true_unsupported'
  | 'bad_scoring_state_bug'
  | 'needs_quarantine'
  | 'already_fixed_stale_ui'
  | 'truly_complete';

export interface Contradiction {
  type: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface VerifiedResource {
  id: string;
  title: string;
  url: string | null;
  subtype: ResourceSubtype;
  subtypeLabel: string;
  enrichability: EnrichabilityState;
  enrichmentStatus: EnrichmentStatus | string;
  enrichmentStatusLabel: string;
  qualityScore: number;
  qualityTier: string;
  failureBucket: FailureBucket | null;
  failureReason: string | null;
  failureCount: number;
  retryEligible: boolean;
  quarantined: boolean;
  contentLength: number;
  enrichmentVersion: number;
  enrichedAt: string | null;
  lastAttemptAt: string | null;
  // Audio
  audioJobStatus: string | null;
  transcriptMode: string | null;
  finalResolutionStatus: string | null;
  hasTranscript: boolean;
  // Diagnosis
  contradictions: Contradiction[];
  fixabilityBucket: FixabilityBucket;
  rootCauseCategory: string;
  whyNotComplete: string;
  recommendedAction: string;
  isSystemBehaviorCorrect: boolean;
  isMisclassified: boolean;
  isStuckInWrongQueue: boolean;
  scoreStatusContradict: boolean;
  // Remediation Intelligence
  resolutionType: 'auto_fix' | 'manual_input' | 'system_gap';
  rootCause: string;
  requiredBuild: { type: string; description: string; suggestedImplementation: string } | null;
}

export interface VerificationSummary {
  totalInScope: number;
  totalContradictions: number;
  byFailureBucket: Record<string, number>;
  byProcessingState: Record<string, number>;
  bySubtype: Record<string, number>;
  byEnrichability: Record<string, number>;
  byRetryable: { retryable: number; nonRetryable: number };
  byQuarantined: number;
  byManualRequired: number;
  byMetadataOnly: number;
  byScoreBand: Record<string, number>;
  byFixability: Record<string, number>;
  repeatedPatterns: Array<{ pattern: string; count: number }>;
  fixRecommendations: FixRecommendation[];
}

export interface FixRecommendation {
  issueName: string;
  affectedCount: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  whyItMatters: string;
  fix: string;
}

export interface AudioJobInfo {
  resourceId: string;
  stage: string;
  failureCode: string | null;
  failureReason: string | null;
  hasTranscript: boolean;
  transcriptMode: string | null;
  finalResolutionStatus: string | null;
  transcriptWordCount: number | null;
  attemptsCount: number;
}

// ── Score Bands ────────────────────────────────────────────

function getScoreBand(score: number): string {
  if (score === 0) return '0';
  if (score < 50) return '1-49';
  if (score < 80) return '50-79';
  if (score < 100) return '80-99';
  return '100';
}

// ── Contradiction Detection ────────────────────────────────

function detectContradictions(r: Resource, quality: QualityResult, audioJob: AudioJobInfo | null): Contradiction[] {
  const contradictions: Contradiction[] = [];
  const status = r.enrichment_status as string;
  const score = quality.score;

  // completed but score critically low (below 70 is a real contradiction;
  // 70-99 is acceptable for short-but-genuine content like podcast summaries)
  if (status === 'deep_enriched' && score < 70) {
    contradictions.push({
      type: 'completed_low_score',
      description: `Status is deep_enriched but quality score is ${score}/100`,
      severity: score < 50 ? 'critical' : 'warning',
    });
  }

  // completed but has failure bucket
  if (status === 'deep_enriched' && r.failure_reason) {
    contradictions.push({
      type: 'completed_with_failure',
      description: `Status is deep_enriched but failure_reason is set: "${r.failure_reason}"`,
      severity: 'warning',
    });
  }

  // score = 100 but state is failed/partial/manual/quarantined
  if (score >= 95 && ['failed', 'incomplete', 'quarantined'].includes(status)) {
    contradictions.push({
      type: 'high_score_bad_state',
      description: `Score is ${score} but status is ${status}`,
      severity: 'critical',
    });
  }

  // quarantined but failure_count < 2
  if (status === 'quarantined' && (r.failure_count ?? 0) < 2) {
    contradictions.push({
      type: 'quarantined_low_failures',
      description: `Quarantined but only ${r.failure_count ?? 0} failures`,
      severity: 'warning',
    });
  }

  // audio resource marked complete without transcript and without accepted metadata-only
  if (audioJob && status === 'deep_enriched' && !audioJob.hasTranscript) {
    const contentLen = (r.content || '').length;
    if (contentLen < 500) {
      contradictions.push({
        type: 'audio_complete_no_transcript',
        description: 'Audio resource marked complete but has no transcript and thin content',
        severity: 'critical',
      });
    }
  }

  // metadata-only but no metadata explanation
  if (r.enrichment_status === 'deep_enriched' && quality.tier === 'shallow' && !r.description) {
    contradictions.push({
      type: 'shallow_no_description',
      description: 'Shallow quality tier with no description — may be metadata-only without explicit acceptance',
      severity: 'info',
    });
  }

  // failed but no failure_reason
  if (status === 'failed' && !r.failure_reason) {
    contradictions.push({
      type: 'failed_no_reason',
      description: 'Status is failed but no failure_reason recorded',
      severity: 'warning',
    });
  }

  return contradictions;
}

// ── Fixability Classification ──────────────────────────────

function classifyFixability(
  r: Resource,
  quality: QualityResult,
  subtype: ResourceSubtype,
  enrichability: EnrichabilityState,
  contradictions: Contradiction[],
): FixabilityBucket {
  const status = r.enrichment_status as string;

  // If score >= 95 and status is wrong, it's a state bug
  if (quality.score >= 95 && status !== 'deep_enriched') {
    return 'bad_scoring_state_bug';
  }

  // If status is deep_enriched but score is low
  if (status === 'deep_enriched' && quality.score < 70) {
    return 'bad_scoring_state_bug';
  }

  // If truly complete (score >= 70 with no major contradictions)
  if (status === 'deep_enriched' && quality.score >= 70 && contradictions.length === 0) {
    return 'truly_complete';
  }

  // If deep_enriched with score >= 70 but minor issues
  if (status === 'deep_enriched' && quality.score >= 70) {
    // Check if contradictions are only minor (info level)
    const hasSerious = contradictions.some(c => c.severity === 'critical' || c.severity === 'warning');
    if (!hasSerious) return 'truly_complete';
    return 'already_fixed_stale_ui';
  }

  // Quarantined
  if (status === 'quarantined') {
    return 'needs_quarantine';
  }

  // Source-based routing
  switch (enrichability) {
    case 'needs_auth':
      return 'needs_access_auth';
    case 'manual_input_needed':
      return 'needs_pasted_content';
    case 'metadata_only':
      return 'accept_metadata_only';
    case 'unsupported':
      return 'true_unsupported';
    case 'no_source':
      return 'true_unsupported';
  }

  // Subtype-specific
  if (['spotify_episode'].includes(subtype)) {
    return 'needs_transcript';
  }
  if (['apple_podcast_episode', 'podcast_episode', 'audio_file'].includes(subtype)) {
    if ((r.content || '').length < 500) return 'needs_transcript';
  }

  // Binary content stored as text — needs transcript extraction
  const contentStr = r.content || '';
  if (contentStr.length > 100 && /[\x00-\x08\x0E-\x1F]/.test(contentStr.slice(0, 200))) {
    return 'needs_transcript';
  }

  // Partial status with real text content — can be promoted
  if (status === 'partial' && quality.score >= 70) {
    return 'auto_fix_now';
  }

  // Retryable failures
  if (status === 'failed' || status === 'incomplete' || status === 'partial') {
    const failureCount = r.failure_count ?? 0;
    if (failureCount >= 2) {
      return 'needs_alternate_source';
    }
    if (enrichability === 'fully_enrichable') {
      return 'auto_fix_now';
    }
    if (enrichability === 'partially_enrichable') {
      return 'retry_different_strategy';
    }
  }

  // Not enriched yet
  if (status === 'not_enriched' || !status) {
    if (enrichability === 'fully_enrichable' || enrichability === 'partially_enrichable') {
      return 'auto_fix_now';
    }
  }

  return 'retry_different_strategy';
}

// ── Verify Single Resource ─────────────────────────────────

export function verifyResource(
  resource: Resource,
  audioJob: AudioJobInfo | null,
): VerifiedResource {
  const url = resource.file_url ?? null;
  const subtype = detectResourceSubtype(url, resource.resource_type);
  const enrichResult = classifyEnrichability(url, resource.resource_type);
  const status = (resource.enrichment_status ?? 'not_enriched') as EnrichmentStatus;

  // Quality validation
  const quality = validateResourceQuality({
    id: resource.id,
    title: resource.title,
    content: resource.content ?? null,
    content_length: resource.content_length ?? (resource.content || '').length,
    enrichment_status: status,
    enrichment_version: resource.enrichment_version ?? 0,
    validation_version: resource.validation_version ?? 0,
    enriched_at: resource.enriched_at ?? null,
    failure_reason: resource.failure_reason ?? null,
    file_url: url,
    description: resource.description ?? null,
  });

  // Failure routing
  let failureBucket: FailureBucket | null = null;
  let retryEligible = false;
  if (status === 'failed' || status === 'incomplete' || (status === 'deep_enriched' && quality.score < 50)) {
    const routing = routeFailure(url, resource.resource_type, undefined, resource.failure_reason ?? undefined);
    failureBucket = routing.bucket;
    retryEligible = routing.retryable;
  }

  const contradictions = detectContradictions(resource, quality, audioJob);
  const fixability = classifyFixability(resource, quality, subtype, enrichResult.enrichability, contradictions);

  // Root cause
  let rootCause = 'Unknown';
  let whyNotComplete = 'Under investigation';
  let recommendedAction = 'Review manually';

  if (quality.score >= 95 && contradictions.length === 0) {
    rootCause = 'N/A — effectively complete';
    whyNotComplete = 'Score is high; minor quality gap';
    recommendedAction = 'No action needed';
  } else if (!url) {
    rootCause = 'No source URL';
    whyNotComplete = 'Cannot enrich without a source';
    recommendedAction = 'Provide URL or paste content';
  } else if (enrichResult.requiresAuth) {
    rootCause = 'Authentication required';
    whyNotComplete = 'Source requires login/access';
    recommendedAction = 'Provide access or paste content manually';
  } else if (quality.violations.length > 0) {
    rootCause = quality.violations[0];
    whyNotComplete = quality.violations.join('; ');
    recommendedAction = getActionForViolations(quality.violations, subtype);
  } else if (status === 'not_enriched') {
    rootCause = 'Never enriched';
    whyNotComplete = 'Enrichment has not been attempted';
    recommendedAction = 'Run Deep Enrich';
  } else if (status === 'failed') {
    rootCause = resource.failure_reason || 'Enrichment failed';
    whyNotComplete = resource.failure_reason || 'Unknown failure';
    recommendedAction = retryEligible ? 'Retry enrichment' : 'Manual assist required';
  }

  const scoreStatusContradict =
    (status === 'deep_enriched' && quality.score < 50) ||
    (quality.score >= 90 && ['failed', 'quarantined'].includes(status));

  const partial: Omit<VerifiedResource, 'resolutionType' | 'rootCause' | 'requiredBuild'> = {
    id: resource.id,
    title: resource.title,
    url,
    subtype,
    subtypeLabel: getSubtypeLabel(subtype),
    enrichability: enrichResult.enrichability,
    enrichmentStatus: status,
    enrichmentStatusLabel: getEnrichmentStatusLabel(status),
    qualityScore: quality.score,
    qualityTier: quality.tier,
    failureBucket,
    failureReason: resource.failure_reason ?? null,
    failureCount: resource.failure_count ?? 0,
    retryEligible,
    quarantined: status === 'quarantined',
    contentLength: (resource.content || '').length,
    enrichmentVersion: resource.enrichment_version ?? 0,
    enrichedAt: resource.enriched_at ?? null,
    lastAttemptAt: resource.last_enrichment_attempt_at ?? null,
    audioJobStatus: audioJob?.stage ?? null,
    transcriptMode: audioJob?.transcriptMode ?? null,
    finalResolutionStatus: audioJob?.finalResolutionStatus ?? null,
    hasTranscript: audioJob?.hasTranscript ?? false,
    contradictions,
    fixabilityBucket: fixability,
    rootCauseCategory: rootCause,
    whyNotComplete,
    recommendedAction,
    isSystemBehaviorCorrect: contradictions.length === 0,
    isMisclassified: contradictions.some(c => c.type === 'high_score_bad_state' || c.type === 'completed_low_score'),
    isStuckInWrongQueue: scoreStatusContradict,
    scoreStatusContradict,
  };

  // Generate remediation intelligence
  const plan = generateRemediationPlan(partial as VerifiedResource);

  return {
    ...partial,
    resolutionType: plan.resolutionType,
    rootCause: plan.rootCause,
    requiredBuild: plan.requiredBuild,
  };
}

function getActionForViolations(violations: string[], subtype: ResourceSubtype): string {
  const first = violations[0]?.toLowerCase() || '';
  if (first.includes('no content')) {
    if (['spotify_episode', 'apple_podcast_episode', 'podcast_episode', 'audio_file'].includes(subtype)) {
      return 'Paste transcript or provide alternate audio source';
    }
    return 'Run Deep Enrich or paste content';
  }
  if (first.includes('too short')) return 'Re-enrich or supplement content manually';
  if (first.includes('boilerplate')) return 'Re-enrich with better extraction or paste clean content';
  if (first.includes('unique words')) return 'Content is shallow — paste full content or transcript';
  return 'Review and re-enrich';
}

// ── Build Summary ──────────────────────────────────────────

export function buildVerificationSummary(verified: VerifiedResource[]): VerificationSummary {
  const byFailureBucket: Record<string, number> = {};
  const byProcessingState: Record<string, number> = {};
  const bySubtype: Record<string, number> = {};
  const byEnrichability: Record<string, number> = {};
  const byScoreBand: Record<string, number> = { '0': 0, '1-49': 0, '50-79': 0, '80-99': 0, '100': 0 };
  const byFixability: Record<string, number> = {};
  let retryable = 0, nonRetryable = 0, quarantined = 0, manualRequired = 0, metadataOnly = 0;
  let totalContradictions = 0;

  // Pattern tracking
  const bucketSubtypeCombos: Record<string, number> = {};

  for (const v of verified) {
    // Failure bucket
    if (v.failureBucket) {
      byFailureBucket[v.failureBucket] = (byFailureBucket[v.failureBucket] || 0) + 1;
    }

    // Processing state
    byProcessingState[v.enrichmentStatus] = (byProcessingState[v.enrichmentStatus] || 0) + 1;

    // Subtype
    bySubtype[v.subtypeLabel] = (bySubtype[v.subtypeLabel] || 0) + 1;

    // Enrichability
    byEnrichability[v.enrichability] = (byEnrichability[v.enrichability] || 0) + 1;

    // Retry
    if (v.retryEligible) retryable++;
    else nonRetryable++;

    if (v.quarantined) quarantined++;
    if (v.fixabilityBucket === 'needs_pasted_content' || v.fixabilityBucket === 'needs_transcript') manualRequired++;
    if (v.fixabilityBucket === 'accept_metadata_only') metadataOnly++;

    // Score band
    byScoreBand[getScoreBand(v.qualityScore)]++;

    // Fixability
    byFixability[v.fixabilityBucket] = (byFixability[v.fixabilityBucket] || 0) + 1;

    // Contradictions
    totalContradictions += v.contradictions.length;

    // Patterns
    if (v.failureBucket) {
      const combo = `${v.subtypeLabel} + ${v.failureBucket}`;
      bucketSubtypeCombos[combo] = (bucketSubtypeCombos[combo] || 0) + 1;
    }
  }

  const repeatedPatterns = Object.entries(bucketSubtypeCombos)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([pattern, count]) => ({ pattern, count }));

  // Fix recommendations
  const fixRecommendations = generateFixRecommendations(verified, byFixability, byFailureBucket, totalContradictions);

  return {
    totalInScope: verified.length,
    totalContradictions,
    byFailureBucket,
    byProcessingState,
    bySubtype,
    byEnrichability,
    byRetryable: { retryable, nonRetryable },
    byQuarantined: quarantined,
    byManualRequired: manualRequired,
    byMetadataOnly: metadataOnly,
    byScoreBand,
    byFixability,
    repeatedPatterns,
    fixRecommendations,
  };
}

function generateFixRecommendations(
  verified: VerifiedResource[],
  byFixability: Record<string, number>,
  byFailureBucket: Record<string, number>,
  totalContradictions: number,
): FixRecommendation[] {
  const recs: FixRecommendation[] = [];

  if (totalContradictions > 0) {
    const critical = verified.filter(v => v.contradictions.some(c => c.severity === 'critical'));
    recs.push({
      issueName: 'State-Score Contradictions',
      affectedCount: critical.length,
      severity: 'critical',
      whyItMatters: 'Resources have contradictory status and quality scores, indicating state machine bugs',
      fix: 'Run state reconciliation to align enrichment_status with actual quality scores',
    });
  }

  const autoFixable = byFixability['auto_fix_now'] || 0;
  if (autoFixable > 0) {
    recs.push({
      issueName: 'Un-enriched but enrichable resources',
      affectedCount: autoFixable,
      severity: 'high',
      whyItMatters: 'These resources have valid sources and can be enriched automatically',
      fix: 'Run Deep Enrich batch on all not_enriched resources with valid URLs',
    });
  }

  const needsTranscript = byFixability['needs_transcript'] || 0;
  if (needsTranscript > 0) {
    recs.push({
      issueName: 'Audio/podcast resources needing transcripts',
      affectedCount: needsTranscript,
      severity: 'medium',
      whyItMatters: 'These are audio resources that cannot be enriched without transcript input',
      fix: 'Surface these in a "Needs Transcript" queue; allow paste-transcript from row actions',
    });
  }

  const needsAuth = (byFailureBucket['auth_required'] || 0);
  if (needsAuth > 0) {
    recs.push({
      issueName: 'Auth-gated resources',
      affectedCount: needsAuth,
      severity: 'medium',
      whyItMatters: 'These resources are behind authentication walls and cannot be auto-enriched',
      fix: 'Route to manual assist with "Provide access or paste content" CTA',
    });
  }

  const stateBugs = byFixability['bad_scoring_state_bug'] || 0;
  if (stateBugs > 0) {
    recs.push({
      issueName: 'Scoring/state bugs',
      affectedCount: stateBugs,
      severity: 'critical',
      whyItMatters: 'Resources have inconsistent scores vs. statuses — system is lying about completeness',
      fix: 'Re-validate quality scores and reconcile enrichment_status accordingly',
    });
  }

  const staleUI = byFixability['already_fixed_stale_ui'] || 0;
  if (staleUI > 0) {
    recs.push({
      issueName: 'Already enriched but UI shows incomplete',
      affectedCount: staleUI,
      severity: 'low',
      whyItMatters: 'Resources are functionally enriched but appear broken in the UI',
      fix: 'Clear stale UI state by re-running quality validation',
    });
  }

  return recs.sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    return sev[a.severity] - sev[b.severity];
  });
}

// ── Fixability Labels ──────────────────────────────────────

export const FIXABILITY_LABELS: Record<FixabilityBucket, string> = {
  auto_fix_now: 'Auto-fix Now',
  retry_different_strategy: 'Retry Different Strategy',
  needs_alternate_source: 'Needs Alternate Source',
  needs_transcript: 'Needs Transcript',
  needs_pasted_content: 'Needs Pasted Content',
  needs_access_auth: 'Needs Access/Auth',
  accept_metadata_only: 'Accept Metadata Only',
  true_unsupported: 'True Unsupported',
  bad_scoring_state_bug: 'Scoring/State Bug',
  needs_quarantine: 'Needs Quarantine',
  already_fixed_stale_ui: 'Stale UI State',
  truly_complete: 'Truly Complete',
};

export const FIXABILITY_COLORS: Record<FixabilityBucket, string> = {
  auto_fix_now: 'bg-status-green/20 text-status-green',
  retry_different_strategy: 'bg-status-yellow/20 text-status-yellow',
  needs_alternate_source: 'bg-orange-500/20 text-orange-600',
  needs_transcript: 'bg-primary/20 text-primary',
  needs_pasted_content: 'bg-primary/20 text-primary',
  needs_access_auth: 'bg-status-red/20 text-status-red',
  accept_metadata_only: 'bg-muted text-muted-foreground',
  true_unsupported: 'bg-muted text-muted-foreground',
  bad_scoring_state_bug: 'bg-status-red/20 text-status-red',
  needs_quarantine: 'bg-status-red/20 text-status-red',
  already_fixed_stale_ui: 'bg-status-yellow/20 text-status-yellow',
  truly_complete: 'bg-status-green/20 text-status-green',
};

// ── Sort priority (highest pain first) ─────────────────────

const SORT_PRIORITY: Record<string, number> = {
  quarantined: 0,
  bad_scoring_state_bug: 1,
  needs_quarantine: 2,
  auto_fix_now: 3,
  retry_different_strategy: 4,
  needs_transcript: 5,
  needs_pasted_content: 6,
  needs_access_auth: 7,
  needs_alternate_source: 8,
  accept_metadata_only: 9,
  true_unsupported: 10,
  already_fixed_stale_ui: 11,
  truly_complete: 12,
};

export function sortByPain(a: VerifiedResource, b: VerifiedResource): number {
  const pa = SORT_PRIORITY[a.fixabilityBucket] ?? 99;
  const pb = SORT_PRIORITY[b.fixabilityBucket] ?? 99;
  if (pa !== pb) return pa - pb;
  // Within same bucket, sort by contradictions count desc, then score asc
  if (a.contradictions.length !== b.contradictions.length) return b.contradictions.length - a.contradictions.length;
  return a.qualityScore - b.qualityScore;
}
