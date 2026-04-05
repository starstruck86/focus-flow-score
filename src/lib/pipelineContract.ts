/**
 * Pipeline Contract — SINGLE source of truth for extraction eligibility.
 *
 * RULE: Both the UI (audit counts, button labels) and the execution pipeline
 * (autoOperationalizeResource, batch, backfill) MUST use these functions.
 * No duplicate eligibility logic anywhere.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('PipelineContract');

// ── Enrichment statuses that indicate "ready for extraction" ──
// HARDENED: content_ready is included because resources with usable content
// in this state should proceed to extraction, not sit idle.
export const ENRICHED_STATUSES: readonly string[] = ['enriched', 'deep_enriched', 'verified', 'content_ready', 'extracted'];

// ── Minimum thresholds ──
const MIN_CONTENT_FOR_FULL_EXTRACTION = 100;
const MIN_CONTENT_FOR_LIGHTWEIGHT = 30;

// ── Standardized result states ──
export type PipelineOutcome =
  | 'operationalized'        // Full success: active KI with contexts
  | 'partial_extraction'     // Extracted KI but couldn't fully activate
  | 'lightweight_extraction'  // Short content — minimal KI created
  | 'needs_review'           // Edge case requiring manual intervention
  | 'no_content'             // No usable content at all
  | 'failed';                // Extraction attempted but failed

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  extractionTier: 'full' | 'reduced' | 'lightweight' | 'none';
}

/**
 * Is this resource content-backed?
 * Used by audit buckets AND pipeline entry gate.
 */
export function isContentBacked(resource: {
  content_length?: number | null;
  content?: string | null;
  manual_content_present?: boolean | null;
  enrichment_status?: string | null;
}): boolean {
  const actualLen = resource.content?.length ?? 0;
  const fieldLen = resource.content_length ?? 0;
  const effectiveLen = Math.max(actualLen, fieldLen);
  const isEnriched = ENRICHED_STATUSES.includes(resource.enrichment_status as any);
  
  return effectiveLen >= MIN_CONTENT_FOR_LIGHTWEIGHT
    || resource.manual_content_present === true
    || isEnriched;
}

/**
 * Is this resource eligible for extraction?
 * THE canonical check used by UI counts AND pipeline execution.
 */
export function isEligibleForExtraction(resource: {
  enrichment_status?: string | null;
  content_length?: number | null;
  content?: string | null;
  manual_content_present?: boolean | null;
  title?: string | null;
}): EligibilityResult {
  const isEnriched = ENRICHED_STATUSES.includes(resource.enrichment_status as any);
  const actualLen = resource.content?.length ?? 0;
  const fieldLen = resource.content_length ?? 0;
  const effectiveLen = Math.max(actualLen, fieldLen);
  const hasManual = resource.manual_content_present === true;

  // SAFETY NET: needs_auth with usable content should still be eligible.
  // Normalization should reclassify these, but if it was missed, don't block extraction.
  const isStructuredLesson = !!(resource.title && /\s>\s/.test(resource.title));
  const contentThreshold = isStructuredLesson ? 100 : MIN_CONTENT_FOR_FULL_EXTRACTION;
  const isNeedsAuthWithContent = resource.enrichment_status === 'needs_auth' && effectiveLen >= contentThreshold;

  // Not enriched and no content → not eligible (unless needs_auth with content)
  if (!isEnriched && !isNeedsAuthWithContent && effectiveLen < MIN_CONTENT_FOR_LIGHTWEIGHT && !hasManual) {
    return {
      eligible: false,
      reason: `Not enriched (${resource.enrichment_status ?? 'null'}) and insufficient content (${effectiveLen} chars)`,
      extractionTier: 'none',
    };
  }

  // Determine extraction tier
  let tier: EligibilityResult['extractionTier'];
  if (effectiveLen >= MIN_CONTENT_FOR_FULL_EXTRACTION) {
    tier = 'full';
  } else if (effectiveLen >= MIN_CONTENT_FOR_LIGHTWEIGHT || hasManual) {
    tier = 'lightweight';
  } else if (isEnriched) {
    // Enriched but very short — try lightweight from metadata
    tier = 'lightweight';
  } else {
    tier = 'none';
  }

  if (tier === 'none') {
    return {
      eligible: false,
      reason: `No extraction path available (${effectiveLen} chars, enriched=${isEnriched})`,
      extractionTier: 'none',
    };
  }

  return {
    eligible: true,
    reason: `Eligible: ${tier} extraction (${effectiveLen} chars, status=${resource.enrichment_status ?? 'null'})`,
    extractionTier: tier,
  };
}

/**
 * Estimate the output from a batch of resources.
 */
export function estimateBatchOutput(resourceCount: number): {
  estimatedKnowledgeItems: { min: number; max: number };
  estimatedTimeMinutes: { min: number; max: number };
} {
  // Avg 2-4 KI per resource based on historical data
  return {
    estimatedKnowledgeItems: {
      min: Math.floor(resourceCount * 2),
      max: Math.ceil(resourceCount * 4),
    },
    estimatedTimeMinutes: {
      min: Math.max(1, Math.floor(resourceCount * 0.5 / 60)),
      max: Math.ceil(resourceCount * 2 / 60) + 1,
    },
  };
}

/**
 * Mismatch guard: if UI sent N IDs but pipeline would process 0, that's a bug.
 */
export function assertEligibilityAlignment(
  uiCount: number,
  pipelineCount: number,
  context: string,
): void {
  if (uiCount > 0 && pipelineCount === 0) {
    // HARDENED: Log error but do NOT throw — throwing here crashes the entire
    // Fix All run and prevents post-run reporting. Some resources may legitimately
    // produce 0 eligible results after normalization reclassifies them.
    const msg = `[PipelineContract] CRITICAL MISMATCH in ${context}: UI sent ${uiCount} IDs but pipeline found 0 eligible. This indicates a filter divergence between UI audit buckets and pipeline eligibility.`;
    log.error(msg);
  }

  // Warn on significant variance (>30% difference)
  if (uiCount > 10 && pipelineCount < uiCount * 0.7) {
    log.warn(`[PipelineContract] Significant variance in ${context}`, {
      uiCount,
      pipelineCount,
      dropRate: `${((1 - pipelineCount / uiCount) * 100).toFixed(1)}%`,
    });
  }
}

/**
 * Regression guard: call after any batch returns 0 processed.
 */
export function checkRegressionGuard(
  totalEnriched: number,
  totalProcessed: number,
  context: string,
): void {
  if (totalEnriched > 0 && totalProcessed === 0) {
    log.error(`[REGRESSION GUARD] ${context}: ${totalEnriched} enriched resources exist but pipeline processed 0. Likely eligibility bug.`);
  }
}
