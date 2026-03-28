/**
 * Deterministic resource quality validation engine.
 *
 * Computes a quality score and tier after each enrichment attempt.
 * Only resources with tier='complete' may be marked deep_enriched.
 *
 * THRESHOLDS ARE CENTRALIZED HERE. Do not scatter quality logic elsewhere.
 */
import { createLogger } from './logger';

const log = createLogger('ResourceQuality');

// ── Version ────────────────────────────────────────────────
export const CURRENT_VALIDATION_VERSION = 1;
export const CURRENT_ENRICHMENT_VERSION = 1;
export const CURRENT_QUALITY_VERSION = 1;

// ── Quality Tiers ──────────────────────────────────────────
export type QualityTier = 'complete' | 'shallow' | 'incomplete' | 'failed';

export interface QualityResult {
  score: number; // 0-100
  tier: QualityTier;
  dimensions: QualityDimensions;
  violations: string[];
  passesCompletionContract: boolean;
}

export interface QualityDimensions {
  contentDepth: number;       // 0-25
  structuralCompleteness: number; // 0-25
  semanticUsefulness: number; // 0-25
  extractionConfidence: number;   // 0-15
  freshnessIntegrity: number; // 0-10
}

// ── Hard Thresholds (centralized, versioned) ───────────────
export const QUALITY_THRESHOLDS = {
  version: 2,
  // Content depth — lowered minimum to allow short-but-real content (summaries, podcast descriptions)
  MIN_CONTENT_CHARS: 200,
  GOOD_CONTENT_CHARS: 1000,
  EXCELLENT_CONTENT_CHARS: 3000,
  // Structural completeness
  REQUIRED_FIELDS: ['content', 'enrichment_status', 'enrichment_version'] as const,
  // Semantic usefulness
  BOILERPLATE_MAX_RATIO: 0.5, // if >50% of content is boilerplate → fail
  MIN_UNIQUE_WORDS: 25, // lowered from 50 to not penalize short legitimate content
  // Quality score thresholds for tiers
  COMPLETE_MIN_SCORE: 70,
  SHALLOW_MIN_SCORE: 40,
  INCOMPLETE_MIN_SCORE: 10,
  // Max tolerated violations for deep_enriched
  // Allow minor violations (e.g. "content too short" warnings) — only block on hard failures
  MAX_VIOLATIONS_FOR_COMPLETE: 1,
  // Freshness
  FRESHNESS_DAYS: 90,
} as const;

// ── Boilerplate patterns ───────────────────────────────────
const BOILERPLATE_PATTERNS = [
  /cookie\s*(policy|consent|notice)/i,
  /privacy\s*policy/i,
  /terms\s*(of\s*service|and\s*conditions)/i,
  /subscribe\s*(to\s*our|now)/i,
  /sign\s*up\s*for/i,
  /follow\s*us\s*on/i,
  /all\s*rights\s*reserved/i,
  /©\s*\d{4}/,
  /skip\s*to\s*(main\s*)?content/i,
  /navigation\s*menu/i,
  /search\s*this\s*site/i,
];

// ── Resource shape for validation ──────────────────────────
export interface ResourceForValidation {
  id: string;
  title: string;
  content: string | null;
  content_length: number | null;
  enrichment_status: string;
  enrichment_version: number;
  validation_version?: number;
  enriched_at: string | null;
  failure_reason: string | null;
  file_url: string | null;
  description: string | null;
}

// ── Main validator ─────────────────────────────────────────
export function validateResourceQuality(resource: ResourceForValidation): QualityResult {
  const violations: string[] = [];
  const content = resource.content || '';
  const contentLen = content.length;

  // ── 1. Content Depth (0-25) ──────────────────────────────
  // Detect binary/non-text content (audio files stored as content)
  const isBinaryContent = contentLen > 100 && /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 200));
  const effectiveContentLen = isBinaryContent ? 0 : contentLen;

  let contentDepth = 0;
  if (isBinaryContent) {
    violations.push('binary_content_detected');
    contentDepth = 0;
  } else if (effectiveContentLen === 0) {
    violations.push('No content extracted');
    contentDepth = 0;
  } else if (effectiveContentLen < QUALITY_THRESHOLDS.MIN_CONTENT_CHARS) {
    violations.push(`Content too short: ${effectiveContentLen} chars (min ${QUALITY_THRESHOLDS.MIN_CONTENT_CHARS})`);
    contentDepth = Math.round((effectiveContentLen / QUALITY_THRESHOLDS.MIN_CONTENT_CHARS) * 10);
  } else if (effectiveContentLen < QUALITY_THRESHOLDS.GOOD_CONTENT_CHARS) {
    // 500-2000 chars: real content that may be a summary or short resource — award 20/25
    contentDepth = 20;
  } else if (effectiveContentLen < QUALITY_THRESHOLDS.EXCELLENT_CONTENT_CHARS) {
    contentDepth = 22;
  } else {
    contentDepth = 25;
  }

  // ── 2. Structural Completeness (0-25) ────────────────────
  let structuralCompleteness = 0;
  const hasContent = contentLen > 0;
  const hasEnrichmentVersion = (resource.enrichment_version ?? 0) >= CURRENT_ENRICHMENT_VERSION;
  const hasEnrichedAt = !!resource.enriched_at;
  const hasFileUrl = !!resource.file_url;

  if (hasContent) structuralCompleteness += 8;
  else violations.push('Missing content');

  if (hasEnrichmentVersion) structuralCompleteness += 7;
  else violations.push(`Enrichment version outdated (v${resource.enrichment_version ?? 0} < v${CURRENT_ENRICHMENT_VERSION})`);

  if (hasEnrichedAt) structuralCompleteness += 5;
  else violations.push('Missing enriched_at timestamp');

  if (hasFileUrl) structuralCompleteness += 5;
  else violations.push('Missing source URL');

  // ── 3. Semantic Usefulness (0-25) ────────────────────────
  let semanticUsefulness = 0;
  if (isBinaryContent) {
    violations.push('binary_content_detected — no semantic analysis possible');
    semanticUsefulness = 0;
  } else if (effectiveContentLen > 0) {
    // Check boilerplate ratio
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const boilerplateLines = lines.filter(line =>
      BOILERPLATE_PATTERNS.some(p => p.test(line))
    );
    const boilerplateRatio = lines.length > 0 ? boilerplateLines.length / lines.length : 0;

    if (boilerplateRatio > QUALITY_THRESHOLDS.BOILERPLATE_MAX_RATIO) {
      violations.push(`High boilerplate ratio: ${Math.round(boilerplateRatio * 100)}%`);
      semanticUsefulness = 5;
    } else {
      semanticUsefulness += 10;
    }

    // Check unique word count
    const words = new Set(content.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
    if (words.size < QUALITY_THRESHOLDS.MIN_UNIQUE_WORDS) {
      violations.push(`Low vocabulary diversity: ${words.size} unique words (min ${QUALITY_THRESHOLDS.MIN_UNIQUE_WORDS})`);
      semanticUsefulness += 3;
    } else {
      semanticUsefulness += 10;
    }

    // Check if content is just a placeholder/external link stub
    if (content.startsWith('[External Link:') || content.startsWith('[Placeholder')) {
      violations.push('Content is a placeholder stub');
      semanticUsefulness = 0;
    } else {
      semanticUsefulness += 5;
    }
  }

  // ── 4. Extraction Confidence (0-15) ──────────────────────
  let extractionConfidence = 0;
  if (!resource.failure_reason) {
    extractionConfidence += 10;
  } else {
    violations.push(`Failure flag present: ${resource.failure_reason}`);
  }

  // No placeholder content (use effective length to exclude binary)
  if (effectiveContentLen >= QUALITY_THRESHOLDS.MIN_CONTENT_CHARS) {
    extractionConfidence += 5;
  }

  // ── 5. Freshness/Version Integrity (0-10) ────────────────
  let freshnessIntegrity = 0;
  if (hasEnrichmentVersion) freshnessIntegrity += 5;
  const validationVersion = resource.validation_version ?? 0;
  if (validationVersion >= CURRENT_VALIDATION_VERSION) {
    freshnessIntegrity += 5;
  } else if (validationVersion > 0) {
    freshnessIntegrity += 2;
    violations.push(`Validation version outdated (v${validationVersion} < v${CURRENT_VALIDATION_VERSION})`);
  }

  // ── Compute total ────────────────────────────────────────
  const dimensions: QualityDimensions = {
    contentDepth,
    structuralCompleteness,
    semanticUsefulness,
    extractionConfidence,
    freshnessIntegrity,
  };

  const score = contentDepth + structuralCompleteness + semanticUsefulness + extractionConfidence + freshnessIntegrity;

  // ── Determine tier ───────────────────────────────────────
  let tier: QualityTier;
  if (score >= QUALITY_THRESHOLDS.COMPLETE_MIN_SCORE && violations.length === 0) {
    tier = 'complete';
  } else if (score >= QUALITY_THRESHOLDS.SHALLOW_MIN_SCORE) {
    tier = 'shallow';
  } else if (score >= QUALITY_THRESHOLDS.INCOMPLETE_MIN_SCORE) {
    tier = 'incomplete';
  } else {
    tier = 'failed';
  }

  const passesCompletionContract = tier === 'complete';

  return { score, tier, dimensions, violations, passesCompletionContract };
}

// ── Completion contract assertion ──────────────────────────
export interface CompletionContractResult {
  passes: boolean;
  reason: string;
  qualityResult: QualityResult;
}

export function assertCompletionContract(resource: ResourceForValidation): CompletionContractResult {
  const qr = validateResourceQuality(resource);

  if (!qr.passesCompletionContract) {
    const reason = qr.violations.length > 0
      ? `Failed: ${qr.violations.join('; ')}`
      : `Score too low: ${qr.score} (need ${QUALITY_THRESHOLDS.COMPLETE_MIN_SCORE})`;
    
    log.warn('Completion contract FAILED', {
      resourceId: resource.id,
      title: resource.title,
      score: qr.score,
      tier: qr.tier,
      violations: qr.violations,
    });

    return { passes: false, reason, qualityResult: qr };
  }

  return { passes: true, reason: 'All checks passed', qualityResult: qr };
}

// ── Determine correct status based on quality ──────────────
export function determinePostEnrichmentStatus(
  qr: QualityResult,
  wasReenrich: boolean,
): string {
  if (qr.passesCompletionContract) return 'deep_enriched';
  if (qr.tier === 'shallow') return wasReenrich ? 'incomplete' : 'incomplete';
  if (qr.tier === 'incomplete') return 'incomplete';
  return 'failed';
}

// ── Failure mode classification ────────────────────────────
export type FailureMode = 'transient_failure' | 'permanent_invalid_input' | 'incomplete_extraction' | 'validation_failure';

export function classifyFailureMode(qr: QualityResult, errorMsg?: string): FailureMode {
  if (errorMsg) {
    const lower = errorMsg.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('timeout') || lower.includes('network') || lower.includes('429')) {
      return 'transient_failure';
    }
    if (lower.includes('private') || lower.includes('restricted') || lower.includes('auth-gated') || lower.includes('unsupported')) {
      return 'permanent_invalid_input';
    }
  }

  if (qr.tier === 'failed' && qr.dimensions.contentDepth === 0) {
    return 'incomplete_extraction';
  }

  if (qr.tier === 'shallow' || qr.tier === 'incomplete') {
    return 'validation_failure';
  }

  return 'transient_failure';
}

// ── Recommended action from quality + status ───────────────
export type RecommendedAction =
  | 'deep_enrich'
  | 're_enrich'
  | 'retry_failed'
  | 'review_manually'
  | 'no_action'
  | 'ignore';

export function getRecommendedActionFromQuality(
  status: string | undefined,
  tier: QualityTier | string | null | undefined,
  failureReason: string | null | undefined,
  failureCount: number,
): RecommendedAction {
  if (status === 'duplicate' || status === 'superseded') return 'ignore';
  if (!status || status === 'not_enriched' || status === 'queued_for_deep_enrich') return 'deep_enrich';
  if (status === 'incomplete') return 're_enrich';
  if (status === 'failed') {
    if (failureCount >= 3) return 'review_manually';
    return 'retry_failed';
  }
  if (status === 'queued_for_reenrich') return 're_enrich';
  if (status === 'deep_enriched') {
    if (tier === 'shallow') return 're_enrich';
    return 'no_action';
  }
  return 'no_action';
}

// ── Quality tier label helpers ─────────────────────────────
export function getQualityTierLabel(tier: QualityTier | string | null | undefined): string {
  switch (tier) {
    case 'complete': return 'Complete';
    case 'shallow': return 'Shallow';
    case 'incomplete': return 'Incomplete';
    case 'failed': return 'Failed';
    default: return 'Unknown';
  }
}

export function getQualityTierColor(tier: QualityTier | string | null | undefined): string {
  switch (tier) {
    case 'complete': return 'bg-status-green/20 text-status-green';
    case 'shallow': return 'bg-status-yellow/20 text-status-yellow';
    case 'incomplete': return 'bg-orange-500/20 text-orange-600';
    case 'failed': return 'bg-status-red/20 text-status-red';
    default: return 'bg-muted text-muted-foreground';
  }
}

// ── Reconciliation: check if a resource's status is consistent ──
export interface ReconciliationResult {
  id: string;
  title: string;
  currentStatus: string;
  currentTier: string | null;
  computedTier: QualityTier;
  computedScore: number;
  action: 'downgrade' | 'upgrade' | 'ok';
  newStatus?: string;
  reason: string;
}

export function reconcileResource(resource: ResourceForValidation & { last_quality_tier?: string | null }): ReconciliationResult {
  const qr = validateResourceQuality(resource);
  const currentStatus = resource.enrichment_status;
  const currentTier = (resource as any).last_quality_tier as string | null;

  // deep_enriched but quality is not complete → downgrade
  if (currentStatus === 'deep_enriched' && !qr.passesCompletionContract) {
    return {
      id: resource.id,
      title: resource.title,
      currentStatus,
      currentTier,
      computedTier: qr.tier,
      computedScore: qr.score,
      action: 'downgrade',
      newStatus: qr.tier === 'shallow' || qr.tier === 'incomplete' ? 'incomplete' : 'failed',
      reason: `Quality ${qr.tier} (score ${qr.score}), violations: ${qr.violations.join('; ')}`,
    };
  }

  return {
    id: resource.id,
    title: resource.title,
    currentStatus,
    currentTier,
    computedTier: qr.tier,
    computedScore: qr.score,
    action: 'ok',
    reason: 'Status consistent with quality',
  };
}

// ── Hard invariant assertions ──────────────────────────────
export function assertEnrichmentInvariants(
  status: string,
  tier: QualityTier | null,
): void {
  // deep_enriched implies tier = complete
  if (status === 'deep_enriched' && tier !== 'complete' && tier !== null) {
    throw new Error(
      `INVARIANT VIOLATION: status=deep_enriched but tier=${tier}. ` +
      `deep_enriched requires tier=complete.`
    );
  }

  // shallow/incomplete/failed must NOT be deep_enriched
  if ((tier === 'shallow' || tier === 'incomplete' || tier === 'failed') && status === 'deep_enriched') {
    throw new Error(
      `INVARIANT VIOLATION: tier=${tier} but status=deep_enriched. ` +
      `Only complete tier maps to deep_enriched.`
    );
  }

  // Cannot be both deep_enriched and queued_for_deep_enrich
  if (status === 'queued_for_deep_enrich' && tier === 'complete') {
    // This is a logic mismatch — if tier is complete, status should be deep_enriched
    log.warn('Status/tier mismatch: queued_for_deep_enrich with complete tier');
  }
}
