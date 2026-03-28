/**
 * Remediation Intelligence Engine
 *
 * Classifies every non-complete resource into one of three resolution types
 * (auto_fix, manual_input, system_gap), assigns a root cause, a recommended
 * action, and — for system_gap — a required build specification.
 *
 * This is a PURE classification layer. It does not mutate state.
 */

import type { VerifiedResource, FixabilityBucket } from '@/lib/enrichmentVerification';
import type { ResourceSubtype } from '@/lib/salesBrain/resourceSubtype';

// ── Resolution types ───────────────────────────────────────
export type ResolutionType = 'auto_fix' | 'manual_input' | 'system_gap';

export type FailureType =
  | 'scoring_state_mismatch'
  | 'extraction_failure'
  | 'content_too_short'
  | 'binary_content'
  | 'auth_gated'
  | 'platform_unsupported'
  | 'no_source_url'
  | 'transient_network'
  | 'boilerplate_dominated'
  | 'repeated_same_failure'
  | 'extractor_bug'
  | 'never_enriched'
  | 'unknown';

export type SystemGapBuildType = 'parser' | 'integration' | 'pipeline_fix' | 'scoring_fix';

export interface RequiredBuild {
  type: SystemGapBuildType;
  description: string;
  suggestedImplementation: string;
}

export interface RemediationPlan {
  resolutionType: ResolutionType;
  rootCause: string;
  failureType: FailureType;
  recommendedAction: string;
  requiredBuild: RequiredBuild | null;
}

// ── Unsupported platform subtypes ──────────────────────────
const PLATFORM_UNSUPPORTED_SUBTYPES: ResourceSubtype[] = [
  'spotify_episode',
  'apple_podcast_episode',
  'auth_gated_community_page',
  'google_drive_file',
];

// ── Main entry point ───────────────────────────────────────
export function generateRemediationPlan(resource: VerifiedResource): RemediationPlan {
  // 1. Check for system gaps first (highest signal)
  const gap = detectSystemGap(resource);
  if (gap) return gap;

  // 2. Check for auto-fixable
  const auto = detectAutoFix(resource);
  if (auto) return auto;

  // 3. Remaining = manual input
  return buildManualInputPlan(resource);
}

// ── System gap detection ───────────────────────────────────
function detectSystemGap(r: VerifiedResource): RemediationPlan | null {
  // Repeated same failure (2+ times with same bucket)
  if (r.failureCount >= 2 && r.fixabilityBucket === r.fixabilityBucket) {
    // Check if it's a retryable bucket that keeps failing
    const isRetryBucket = ['auto_fix_now', 'retry_different_strategy'].includes(r.fixabilityBucket);
    if (isRetryBucket && r.failureCount >= 2) {
      return {
        resolutionType: 'system_gap',
        rootCause: `Same failure repeated ${r.failureCount} times — enrichment pipeline cannot handle this resource`,
        failureType: 'repeated_same_failure',
        recommendedAction: 'Investigate enrichment pipeline for this resource type',
        requiredBuild: {
          type: 'pipeline_fix',
          description: `Enrichment pipeline fails repeatedly on ${r.subtypeLabel} (${r.failureReason || 'unknown error'})`,
          suggestedImplementation: `Add retry-with-fallback for ${r.subtypeLabel} resources. Current failure: ${r.failureReason || r.whyNotComplete}`,
        },
      };
    }
  }

  // Binary content detected
  const hasBinaryViolation = r.whyNotComplete?.includes('binary') ||
    r.rootCauseCategory?.includes('binary');
  if (hasBinaryViolation) {
    return {
      resolutionType: 'system_gap',
      rootCause: 'Content stored as binary data instead of text — transcript extraction missing',
      failureType: 'binary_content',
      recommendedAction: 'Build transcript extraction pipeline for this audio/binary resource',
      requiredBuild: {
        type: 'parser',
        description: 'Binary content stored in content field needs transcript extraction',
        suggestedImplementation: 'Route binary-detected resources through audio transcription pipeline or require manual transcript paste',
      },
    };
  }

  // Platform not supported (Spotify, Apple, Circle, Drive)
  if (PLATFORM_UNSUPPORTED_SUBTYPES.includes(r.subtype)) {
    const hasContent = r.contentLength > 500;
    if (!hasContent) {
      return {
        resolutionType: 'system_gap',
        rootCause: `Platform "${r.subtypeLabel}" has no direct content extraction support`,
        failureType: 'platform_unsupported',
        recommendedAction: `Build ${r.subtypeLabel} content integration or accept metadata-only`,
        requiredBuild: {
          type: 'integration',
          description: `No content extractor for ${r.subtypeLabel} resources`,
          suggestedImplementation: buildPlatformSuggestion(r.subtype),
        },
      };
    }
  }

  // Extractor fails on valid content (has URL, enrichable, but content is bad)
  if (
    r.url &&
    r.enrichability === 'fully_enrichable' &&
    r.contentLength > 0 &&
    r.contentLength < 500 &&
    r.enrichmentVersion > 0
  ) {
    return {
      resolutionType: 'system_gap',
      rootCause: 'Extractor ran but produced insufficient content from a valid source',
      failureType: 'extractor_bug',
      recommendedAction: 'Investigate content extraction for this URL pattern',
      requiredBuild: {
        type: 'parser',
        description: `Extraction produced only ${r.contentLength} chars from enrichable URL`,
        suggestedImplementation: `Debug Firecrawl/extraction output for URL pattern: ${r.url?.substring(0, 60)}. May need custom scraping logic.`,
      },
    };
  }

  // Scoring state mismatch that persists after fix attempts
  if (r.fixabilityBucket === 'bad_scoring_state_bug' && r.failureCount >= 1) {
    return {
      resolutionType: 'system_gap',
      rootCause: 'Scoring/state reconciliation bug persists after attempted fix',
      failureType: 'scoring_state_mismatch',
      recommendedAction: 'Fix scoring engine or state transition logic',
      requiredBuild: {
        type: 'scoring_fix',
        description: `Resource "${r.title}" has persistent score/status mismatch (score=${r.qualityScore}, status=${r.enrichmentStatus})`,
        suggestedImplementation: 'Review validateResourceQuality thresholds and determinePostEnrichmentStatus logic for edge cases',
      },
    };
  }

  return null;
}

// ── Auto-fix detection ─────────────────────────────────────
function detectAutoFix(r: VerifiedResource): RemediationPlan | null {
  // Scoring state bug (no enrichment needed, just re-score)
  if (r.fixabilityBucket === 'bad_scoring_state_bug' && r.failureCount === 0) {
    return {
      resolutionType: 'auto_fix',
      rootCause: 'Score/status mismatch — needs re-scoring without re-enrichment',
      failureType: 'scoring_state_mismatch',
      recommendedAction: 'Re-run quality scoring and reconcile status',
      requiredBuild: null,
    };
  }

  // Retryable enrichment
  if (r.fixabilityBucket === 'auto_fix_now') {
    return {
      resolutionType: 'auto_fix',
      rootCause: r.rootCauseCategory || 'Enrichment can be retried',
      failureType: r.enrichmentStatus === 'not_enriched' ? 'never_enriched' : 'extraction_failure',
      recommendedAction: 'Run enrichment pipeline immediately',
      requiredBuild: null,
    };
  }

  // Retry with different strategy
  if (r.fixabilityBucket === 'retry_different_strategy' && r.failureCount < 2) {
    return {
      resolutionType: 'auto_fix',
      rootCause: r.rootCauseCategory || 'Previous extraction strategy failed',
      failureType: 'extraction_failure',
      recommendedAction: 'Retry with alternate extraction method',
      requiredBuild: null,
    };
  }

  // Content too short but enrichable
  if (
    r.enrichability === 'fully_enrichable' &&
    r.contentLength > 0 &&
    r.contentLength < 500 &&
    r.failureCount === 0
  ) {
    return {
      resolutionType: 'auto_fix',
      rootCause: 'Content extracted but too short — may improve with re-enrichment',
      failureType: 'content_too_short',
      recommendedAction: 'Re-run enrichment to attempt deeper extraction',
      requiredBuild: null,
    };
  }

  return null;
}

// ── Manual input plan ──────────────────────────────────────
function buildManualInputPlan(r: VerifiedResource): RemediationPlan {
  const bucketToFailureType: Record<string, FailureType> = {
    needs_transcript: 'binary_content',
    needs_pasted_content: 'auth_gated',
    needs_access_auth: 'auth_gated',
    needs_alternate_source: 'no_source_url',
    accept_metadata_only: 'platform_unsupported',
  };

  const bucketToAction: Record<string, string> = {
    needs_transcript: 'Provide transcript text or direct audio URL',
    needs_pasted_content: 'Paste the content from the source manually',
    needs_access_auth: 'Provide authenticated access or paste content',
    needs_alternate_source: 'Provide a different, accessible URL for this content',
    accept_metadata_only: 'Accept as metadata-only or provide content',
    needs_quarantine: 'Resource is quarantined — manual review required',
    truly_complete: 'No action needed',
    true_unsupported: 'Resource type is unsupported — accept metadata-only or remove',
    already_fixed_stale_ui: 'Refresh UI — resource may already be fixed',
  };

  const failureType = bucketToFailureType[r.fixabilityBucket] || inferFailureType(r);
  const action = bucketToAction[r.fixabilityBucket] || r.recommendedAction || 'Review manually';

  return {
    resolutionType: 'manual_input',
    rootCause: r.rootCauseCategory || 'Requires human intervention',
    failureType,
    recommendedAction: action,
    requiredBuild: null,
  };
}

// ── Helpers ────────────────────────────────────────────────
function inferFailureType(r: VerifiedResource): FailureType {
  if (!r.url) return 'no_source_url';
  if (r.enrichability === 'needs_auth') return 'auth_gated';
  if (r.failureReason?.toLowerCase().includes('timeout') ||
      r.failureReason?.toLowerCase().includes('network')) return 'transient_network';
  if (r.whyNotComplete?.includes('boilerplate')) return 'boilerplate_dominated';
  if (r.enrichmentStatus === 'not_enriched') return 'never_enriched';
  return 'unknown';
}

function buildPlatformSuggestion(subtype: ResourceSubtype): string {
  switch (subtype) {
    case 'spotify_episode':
    case 'spotify_show':
      return 'Integrate Spotify API for episode metadata + require manual transcript or alternate audio URL for transcription';
    case 'apple_podcast_episode':
    case 'apple_podcast_show':
      return 'Use iTunes Search API to resolve RSS feed, extract audio enclosure URL, then route through transcription pipeline';
    case 'auth_gated_community_page':
      return 'Build authenticated scraper for community platforms (Circle.so, etc.) or provide manual paste workflow';
    case 'google_drive_file':
      return 'Implement Google Drive API export for supported MIME types (docs, sheets, slides)';
    default:
      return `Build content extraction adapter for ${subtype} resources`;
  }
}

// ── Batch analysis ─────────────────────────────────────────
export interface RemediationSummary {
  totalAnalyzed: number;
  byResolutionType: Record<ResolutionType, number>;
  byFailureType: Record<string, number>;
  systemGaps: Array<{
    failureType: FailureType;
    count: number;
    requiredBuild: RequiredBuild;
    affectedResourceIds: string[];
  }>;
  autoFixable: number;
  manualInput: number;
}

export function analyzeRemediationBatch(resources: VerifiedResource[]): RemediationSummary {
  const plans = resources.map(r => ({ id: r.id, plan: generateRemediationPlan(r) }));

  const byResolutionType: Record<ResolutionType, number> = { auto_fix: 0, manual_input: 0, system_gap: 0 };
  const byFailureType: Record<string, number> = {};
  const gapMap = new Map<FailureType, { build: RequiredBuild; ids: string[] }>();

  for (const { id, plan } of plans) {
    byResolutionType[plan.resolutionType]++;
    byFailureType[plan.failureType] = (byFailureType[plan.failureType] || 0) + 1;

    if (plan.resolutionType === 'system_gap' && plan.requiredBuild) {
      const existing = gapMap.get(plan.failureType);
      if (existing) {
        existing.ids.push(id);
      } else {
        gapMap.set(plan.failureType, { build: plan.requiredBuild, ids: [id] });
      }
    }
  }

  const systemGaps = Array.from(gapMap.entries()).map(([failureType, { build, ids }]) => ({
    failureType,
    count: ids.length,
    requiredBuild: build,
    affectedResourceIds: ids,
  }));

  return {
    totalAnalyzed: resources.length,
    byResolutionType,
    byFailureType,
    systemGaps,
    autoFixable: byResolutionType.auto_fix,
    manualInput: byResolutionType.manual_input,
  };
}
