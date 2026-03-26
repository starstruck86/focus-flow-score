/**
 * Resource Trust Engine — separates processing status from strategic trust.
 *
 * A resource may be technically "enriched" but not trusted for strategic use.
 * This module provides:
 *   1. Trust scoring (confidence, completeness, freshness, source quality)
 *   2. Trust status classification (trusted, limited, suspect, stale, quarantined)
 *   3. Downstream eligibility per purpose
 *   4. Source-aware policy rules
 *   5. Explainability layer
 *   6. Human override controls
 *   7. Quarantine management
 */

import { createLogger } from './logger';
import {
  QUALITY_THRESHOLDS,
  CURRENT_ENRICHMENT_VERSION,
  CURRENT_VALIDATION_VERSION,
  type QualityResult,
} from './resourceQuality';

const log = createLogger('ResourceTrust');

// ── Trust Statuses ─────────────────────────────────────────
export type TrustStatus = 'trusted' | 'limited' | 'suspect' | 'stale' | 'quarantined';

// ── Downstream Purposes ────────────────────────────────────
export type DownstreamPurpose =
  | 'search'
  | 'library_display'
  | 'summary_generation'
  | 'dave_grounding'
  | 'playbook_generation'
  | 'roleplay'
  | 'weekly_insights'
  | 'strategic_recommendations'
  | 'deal_intelligence';

// ── Trust Score Breakdown ──────────────────────────────────
export interface TrustScore {
  overall: number;           // 0-100
  confidence: number;        // 0-25 — extraction confidence
  completeness: number;      // 0-25 — structural + semantic completeness
  freshness: number;         // 0-25 — enrichment recency + version currency
  sourceQuality: number;     // 0-25 — source type reliability + domain history
}

// ── Trust Assessment Result ────────────────────────────────
export interface TrustAssessment {
  trustStatus: TrustStatus;
  trustScore: TrustScore;
  eligibility: Record<DownstreamPurpose, boolean>;
  explanations: TrustExplanation[];
  overrides: TrustOverride | null;
  quarantineReasons: string[];
}

export interface TrustExplanation {
  aspect: string;
  decision: string;
  reasoning: string;
}

// ── Human Override ─────────────────────────────────────────
export interface TrustOverride {
  forcedTrustStatus?: TrustStatus;
  forcedStrategy?: string;
  pinHighPriority?: boolean;
  excludeFromDownstream?: boolean;
  ignorePermanently?: boolean;
  scheduleReEvaluation?: boolean;
  overrideTimestamp: string;
  overrideReason?: string;
}

// ── Source Policy ──────────────────────────────────────────
export type SourceCategory =
  | 'youtube_transcript'
  | 'pdf_document'
  | 'blog_article'
  | 'training_doc'
  | 'note'
  | 'auth_gated'
  | 'podcast'
  | 'unknown';

interface SourcePolicy {
  category: SourceCategory;
  baseTrustModifier: number;       // -20 to +10
  minContentForTrust: number;      // chars
  allowFallback: boolean;
  defaultFreshnessDecayDays: number;
  supportsSummaryFirst: boolean;
  supportsLightweight: boolean;
  authGatedLikelihood: number;     // 0-1
}

const SOURCE_POLICIES: Record<SourceCategory, SourcePolicy> = {
  youtube_transcript: {
    category: 'youtube_transcript',
    baseTrustModifier: 5,
    minContentForTrust: 800,
    allowFallback: true,
    defaultFreshnessDecayDays: 180,
    supportsSummaryFirst: true,
    supportsLightweight: true,
    authGatedLikelihood: 0.05,
  },
  pdf_document: {
    category: 'pdf_document',
    baseTrustModifier: 0,
    minContentForTrust: 500,
    allowFallback: false,
    defaultFreshnessDecayDays: 365,
    supportsSummaryFirst: false,
    supportsLightweight: true,
    authGatedLikelihood: 0.1,
  },
  blog_article: {
    category: 'blog_article',
    baseTrustModifier: -5,
    minContentForTrust: 600,
    allowFallback: true,
    defaultFreshnessDecayDays: 120,
    supportsSummaryFirst: true,
    supportsLightweight: true,
    authGatedLikelihood: 0.15,
  },
  training_doc: {
    category: 'training_doc',
    baseTrustModifier: 10,
    minContentForTrust: 300,
    allowFallback: false,
    defaultFreshnessDecayDays: 365,
    supportsSummaryFirst: false,
    supportsLightweight: false,
    authGatedLikelihood: 0.3,
  },
  note: {
    category: 'note',
    baseTrustModifier: -10,
    minContentForTrust: 100,
    allowFallback: false,
    defaultFreshnessDecayDays: 60,
    supportsSummaryFirst: false,
    supportsLightweight: false,
    authGatedLikelihood: 0,
  },
  auth_gated: {
    category: 'auth_gated',
    baseTrustModifier: -20,
    minContentForTrust: 500,
    allowFallback: false,
    defaultFreshnessDecayDays: 90,
    supportsSummaryFirst: false,
    supportsLightweight: false,
    authGatedLikelihood: 1.0,
  },
  podcast: {
    category: 'podcast',
    baseTrustModifier: 0,
    minContentForTrust: 1000,
    allowFallback: true,
    defaultFreshnessDecayDays: 180,
    supportsSummaryFirst: true,
    supportsLightweight: true,
    authGatedLikelihood: 0.05,
  },
  unknown: {
    category: 'unknown',
    baseTrustModifier: -10,
    minContentForTrust: 500,
    allowFallback: true,
    defaultFreshnessDecayDays: 90,
    supportsSummaryFirst: true,
    supportsLightweight: true,
    authGatedLikelihood: 0.2,
  },
};

// ── Auth-gated domains ─────────────────────────────────────
const AUTH_GATED_DOMAINS = [
  'circle.so', 'teachable.com', 'kajabi.com', 'skool.com',
  'thinkific.com', 'podia.com', 'gumroad.com',
];

// ── Source classification ──────────────────────────────────
export function classifySource(url: string | null, resourceType?: string): SourceCategory {
  if (!url) return 'note';

  const lower = url.toLowerCase();
  try {
    const hostname = new URL(url).hostname;
    if (AUTH_GATED_DOMAINS.some(d => hostname.includes(d))) return 'auth_gated';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube_transcript';
  } catch { /* ignore */ }

  if (lower.endsWith('.pdf')) return 'pdf_document';
  if (resourceType === 'podcast' || lower.includes('podcast')) return 'podcast';
  if (resourceType === 'training' || resourceType === 'playbook') return 'training_doc';
  if (resourceType === 'note') return 'note';

  return 'blog_article';
}

export function getSourcePolicy(category: SourceCategory): SourcePolicy {
  return SOURCE_POLICIES[category];
}

// ── Resource shape for trust assessment ────────────────────
export interface ResourceForTrust {
  id: string;
  title: string;
  content: string | null;
  content_length: number | null;
  enrichment_status: string;
  enrichment_version: number;
  validation_version: number;
  enriched_at: string | null;
  failure_reason: string | null;
  file_url: string | null;
  resource_type?: string;
  description: string | null;
  last_quality_score: number | null;
  last_quality_tier: string | null;
  failure_count: number;
  last_reconciled_at?: string | null;
  // Usefulness signals (optional, from downstream usage)
  downstream_use_count?: number;
  downstream_accept_rate?: number;
  last_used_at?: string | null;
}

// ── Trust Score Computation ────────────────────────────────
export function computeTrustScore(resource: ResourceForTrust): TrustScore {
  const sourceCategory = classifySource(resource.file_url, resource.resource_type);
  const policy = getSourcePolicy(sourceCategory);

  // 1. Confidence (0-25)
  let confidence = 0;
  const qualityScore = resource.last_quality_score ?? 0;
  if (qualityScore >= 70) confidence = 20;
  else if (qualityScore >= 50) confidence = 14;
  else if (qualityScore >= 30) confidence = 8;
  else confidence = Math.round(qualityScore / 4);

  if (!resource.failure_reason) confidence = Math.min(25, confidence + 5);

  // 2. Completeness (0-25)
  let completeness = 0;
  const contentLen = resource.content_length ?? resource.content?.length ?? 0;
  if (contentLen >= 5000) completeness = 15;
  else if (contentLen >= 2000) completeness = 12;
  else if (contentLen >= policy.minContentForTrust) completeness = 8;
  else completeness = Math.round((contentLen / policy.minContentForTrust) * 5);

  if (resource.enrichment_status === 'deep_enriched') completeness = Math.min(25, completeness + 8);
  else if (resource.enrichment_status === 'incomplete') completeness = Math.min(25, completeness + 3);

  if (resource.description && resource.description.length > 50) completeness = Math.min(25, completeness + 2);

  // 3. Freshness (0-25)
  let freshness = 0;
  if (resource.enriched_at) {
    const daysSince = Math.floor((Date.now() - new Date(resource.enriched_at).getTime()) / 86400000);
    const decayDays = policy.defaultFreshnessDecayDays;
    if (daysSince <= decayDays * 0.25) freshness = 15;
    else if (daysSince <= decayDays * 0.5) freshness = 12;
    else if (daysSince <= decayDays) freshness = 8;
    else freshness = Math.max(0, 5 - Math.floor(daysSince / decayDays));
  }

  if (resource.enrichment_version >= CURRENT_ENRICHMENT_VERSION) freshness = Math.min(25, freshness + 5);
  if (resource.validation_version >= CURRENT_VALIDATION_VERSION) freshness = Math.min(25, freshness + 5);

  // 4. Source Quality (0-25)
  let sourceQuality = 15 + policy.baseTrustModifier;
  sourceQuality = Math.max(0, Math.min(25, sourceQuality));

  // Usefulness boost
  if (resource.downstream_use_count && resource.downstream_use_count > 0) {
    sourceQuality = Math.min(25, sourceQuality + Math.min(5, resource.downstream_use_count));
  }
  if (resource.downstream_accept_rate != null && resource.downstream_accept_rate > 0.7) {
    sourceQuality = Math.min(25, sourceQuality + 3);
  }

  const overall = confidence + completeness + freshness + sourceQuality;

  return { overall, confidence, completeness, freshness, sourceQuality };
}

// ── Trust Status Classification ────────────────────────────
export function classifyTrustStatus(
  score: TrustScore,
  resource: ResourceForTrust,
  override?: TrustOverride | null,
): TrustStatus {
  // Human override takes precedence
  if (override?.forcedTrustStatus) return override.forcedTrustStatus;
  if (override?.ignorePermanently) return 'quarantined';

  // Quarantine triggers
  if (resource.failure_count >= 5) return 'quarantined';
  if (resource.enrichment_status === 'failed' && resource.failure_count >= 3) return 'quarantined';

  // Staleness check
  if (resource.enriched_at) {
    const daysSince = Math.floor((Date.now() - new Date(resource.enriched_at).getTime()) / 86400000);
    const sourcePolicy = getSourcePolicy(classifySource(resource.file_url, resource.resource_type));
    if (daysSince > sourcePolicy.defaultFreshnessDecayDays * 1.5) return 'stale';
  }

  // Not enriched → suspect
  if (resource.enrichment_status !== 'deep_enriched' && resource.enrichment_status !== 'incomplete') {
    return 'suspect';
  }

  // Score-based classification
  if (score.overall >= 70) return 'trusted';
  if (score.overall >= 45) return 'limited';
  if (score.overall >= 25) return 'suspect';
  return 'quarantined';
}

// ── Eligibility Thresholds per Purpose ─────────────────────
const ELIGIBILITY_THRESHOLDS: Record<DownstreamPurpose, {
  minTrustScore: number;
  allowedStatuses: TrustStatus[];
  requiresEnriched: boolean;
}> = {
  search: {
    minTrustScore: 15,
    allowedStatuses: ['trusted', 'limited', 'suspect', 'stale'],
    requiresEnriched: false,
  },
  library_display: {
    minTrustScore: 0,
    allowedStatuses: ['trusted', 'limited', 'suspect', 'stale', 'quarantined'],
    requiresEnriched: false,
  },
  summary_generation: {
    minTrustScore: 40,
    allowedStatuses: ['trusted', 'limited'],
    requiresEnriched: true,
  },
  dave_grounding: {
    minTrustScore: 55,
    allowedStatuses: ['trusted', 'limited'],
    requiresEnriched: true,
  },
  playbook_generation: {
    minTrustScore: 60,
    allowedStatuses: ['trusted'],
    requiresEnriched: true,
  },
  roleplay: {
    minTrustScore: 50,
    allowedStatuses: ['trusted', 'limited'],
    requiresEnriched: true,
  },
  weekly_insights: {
    minTrustScore: 55,
    allowedStatuses: ['trusted', 'limited'],
    requiresEnriched: true,
  },
  strategic_recommendations: {
    minTrustScore: 65,
    allowedStatuses: ['trusted'],
    requiresEnriched: true,
  },
  deal_intelligence: {
    minTrustScore: 60,
    allowedStatuses: ['trusted'],
    requiresEnriched: true,
  },
};

// ── Downstream Eligibility ─────────────────────────────────
export function computeEligibility(
  trustStatus: TrustStatus,
  trustScore: TrustScore,
  resource: ResourceForTrust,
  override?: TrustOverride | null,
): Record<DownstreamPurpose, boolean> {
  const result: Partial<Record<DownstreamPurpose, boolean>> = {};

  // Override: exclude from all downstream
  if (override?.excludeFromDownstream || override?.ignorePermanently) {
    for (const purpose of Object.keys(ELIGIBILITY_THRESHOLDS) as DownstreamPurpose[]) {
      result[purpose] = purpose === 'library_display'; // always visible in library
    }
    return result as Record<DownstreamPurpose, boolean>;
  }

  for (const [purpose, threshold] of Object.entries(ELIGIBILITY_THRESHOLDS)) {
    const p = purpose as DownstreamPurpose;
    const statusAllowed = threshold.allowedStatuses.includes(trustStatus);
    const scoreOk = trustScore.overall >= threshold.minTrustScore;
    const enrichedOk = !threshold.requiresEnriched || resource.enrichment_status === 'deep_enriched';
    result[p] = statusAllowed && scoreOk && enrichedOk;
  }

  return result as Record<DownstreamPurpose, boolean>;
}

// ── Full Trust Assessment ──────────────────────────────────
export function assessTrust(
  resource: ResourceForTrust,
  override?: TrustOverride | null,
): TrustAssessment {
  const trustScore = computeTrustScore(resource);
  const trustStatus = classifyTrustStatus(trustScore, resource, override);
  const eligibility = computeEligibility(trustStatus, trustScore, resource, override);
  const explanations = buildExplanations(resource, trustScore, trustStatus, eligibility);
  const quarantineReasons = getQuarantineReasons(resource, trustScore);

  return { trustStatus, trustScore, eligibility, explanations, overrides: override ?? null, quarantineReasons };
}

// ── Explainability ─────────────────────────────────────────
function buildExplanations(
  resource: ResourceForTrust,
  score: TrustScore,
  status: TrustStatus,
  eligibility: Record<DownstreamPurpose, boolean>,
): TrustExplanation[] {
  const explanations: TrustExplanation[] = [];

  // Trust status explanation
  explanations.push({
    aspect: 'trust_status',
    decision: status,
    reasoning: status === 'trusted'
      ? `Score ${score.overall}/100 meets trusted threshold (≥70).`
      : status === 'limited'
        ? `Score ${score.overall}/100 is between 45-69 — usable but not for strategic decisions.`
        : status === 'suspect'
          ? `Score ${score.overall}/100 is low (25-44) — may have quality issues.`
          : status === 'stale'
            ? `Resource enrichment is outdated beyond freshness threshold.`
            : `Resource is quarantined due to repeated failures or quality issues.`,
  });

  // Confidence explanation
  if (score.confidence < 15) {
    explanations.push({
      aspect: 'confidence',
      decision: 'low',
      reasoning: `Quality score ${resource.last_quality_score ?? 0} and ${resource.failure_reason ? 'active failure flag' : 'no recent validation'} yield low confidence (${score.confidence}/25).`,
    });
  }

  // Freshness explanation
  if (score.freshness < 10) {
    explanations.push({
      aspect: 'freshness',
      decision: 'degraded',
      reasoning: resource.enriched_at
        ? `Enriched ${Math.floor((Date.now() - new Date(resource.enriched_at).getTime()) / 86400000)} days ago — freshness score ${score.freshness}/25.`
        : 'Never enriched — no freshness score.',
    });
  }

  // Downstream blocks
  const blockedPurposes = (Object.entries(eligibility) as [DownstreamPurpose, boolean][])
    .filter(([, eligible]) => !eligible)
    .map(([p]) => p);

  if (blockedPurposes.length > 0 && blockedPurposes.length < 9) {
    explanations.push({
      aspect: 'downstream_eligibility',
      decision: 'partially_blocked',
      reasoning: `Blocked from: ${blockedPurposes.join(', ')}. Trust status "${status}" and score ${score.overall} don't meet thresholds for these purposes.`,
    });
  }

  return explanations;
}

// ── Quarantine Reasons ─────────────────────────────────────
function getQuarantineReasons(resource: ResourceForTrust, score: TrustScore): string[] {
  const reasons: string[] = [];
  if (resource.failure_count >= 5) reasons.push(`Failed ${resource.failure_count} times — exceeds quarantine threshold`);
  if (resource.failure_count >= 3 && resource.enrichment_status === 'failed') reasons.push('Repeated failures without recovery');
  if (score.overall < 25) reasons.push(`Trust score ${score.overall} critically low`);
  if (score.confidence === 0 && score.completeness < 5) reasons.push('No meaningful content or confidence');
  return reasons;
}

// ── Degradation Levels (safe degradation model) ────────────
export type DegradationLevel = 'full_trusted' | 'limited_trusted' | 'searchable_only' | 'metadata_only' | 'quarantined_hidden';

export function getDegradationLevel(assessment: TrustAssessment): DegradationLevel {
  if (assessment.trustStatus === 'quarantined') return 'quarantined_hidden';
  if (assessment.trustStatus === 'trusted') return 'full_trusted';
  if (assessment.trustStatus === 'limited') return 'limited_trusted';
  if (assessment.trustStatus === 'suspect') return 'searchable_only';
  return 'metadata_only'; // stale
}

// ── Trust Status Labels + Colors ───────────────────────────
export function getTrustStatusLabel(status: TrustStatus): string {
  switch (status) {
    case 'trusted': return 'Trusted';
    case 'limited': return 'Limited';
    case 'suspect': return 'Suspect';
    case 'stale': return 'Stale';
    case 'quarantined': return 'Quarantined';
  }
}

export function getTrustStatusColor(status: TrustStatus): string {
  switch (status) {
    case 'trusted': return 'bg-status-green/20 text-status-green';
    case 'limited': return 'bg-status-yellow/20 text-status-yellow';
    case 'suspect': return 'bg-orange-500/20 text-orange-600';
    case 'stale': return 'bg-muted text-muted-foreground';
    case 'quarantined': return 'bg-status-red/20 text-status-red';
  }
}

// ── Batch assessment for dashboard ─────────────────────────
export function assessBatch(resources: ResourceForTrust[]): {
  distribution: Record<TrustStatus, number>;
  eligibilitySummary: Record<DownstreamPurpose, number>;
  avgTrustScore: number;
  quarantinedCount: number;
  topFailureCategories: Array<{ reason: string; count: number }>;
} {
  const distribution: Record<TrustStatus, number> = {
    trusted: 0, limited: 0, suspect: 0, stale: 0, quarantined: 0,
  };
  const eligibilityCounts: Record<DownstreamPurpose, number> = {
    search: 0, library_display: 0, summary_generation: 0, dave_grounding: 0,
    playbook_generation: 0, roleplay: 0, weekly_insights: 0,
    strategic_recommendations: 0, deal_intelligence: 0,
  };
  let totalScore = 0;
  const failureReasons = new Map<string, number>();

  for (const r of resources) {
    const assessment = assessTrust(r);
    distribution[assessment.trustStatus]++;
    totalScore += assessment.trustScore.overall;

    for (const [purpose, eligible] of Object.entries(assessment.eligibility)) {
      if (eligible) eligibilityCounts[purpose as DownstreamPurpose]++;
    }

    if (r.failure_reason) {
      const key = r.failure_reason.slice(0, 80);
      failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
    }
  }

  const topFailureCategories = [...failureReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  return {
    distribution,
    eligibilitySummary: eligibilityCounts,
    avgTrustScore: resources.length > 0 ? Math.round(totalScore / resources.length) : 0,
    quarantinedCount: distribution.quarantined,
    topFailureCategories,
  };
}
