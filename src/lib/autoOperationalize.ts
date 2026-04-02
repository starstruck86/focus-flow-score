/**
 * Auto-Operationalization Pipeline
 *
 * Closes the gap between resource upload and actual usage by automatically:
 *   uploaded → content_ready → tagged → knowledge_extracted → activated → operationalized
 *
 * SAFETY RULES:
 *   - Never auto-activate low-confidence junk
 *   - Never overwrite user-edited knowledge items
 *   - Never delete anything automatically
 *   - Never apply weak optional tags aggressively
 */

import { supabase } from '@/integrations/supabase/client';
import { inferTags, mergeTags, type StructuredTag } from './resourceTags';
import { extractKnowledgeHeuristic, extractKnowledgeLLMFallback, type ExtractionSource } from './knowledgeExtraction';
import { createLogger } from '@/lib/logger';
import {
  isEligibleForExtraction,
  isContentBacked as contractIsContentBacked,
  assertEligibilityAlignment,
  checkRegressionGuard,
  estimateBatchOutput,
  type PipelineOutcome,
  type EligibilityResult,
  ENRICHED_STATUSES,
} from './pipelineContract';

const log = createLogger('AutoOperationalize');

// Re-export for consumers
export { estimateBatchOutput, type PipelineOutcome } from './pipelineContract';

// ── Pipeline Stages ────────────────────────────────────────

export type PipelineStage =
  | 'uploaded'
  | 'content_ready'
  | 'tagged'
  | 'knowledge_extracted'
  | 'activated'
  | 'operationalized';

export const PIPELINE_STAGES: PipelineStage[] = [
  'uploaded',
  'content_ready',
  'tagged',
  'knowledge_extracted',
  'activated',
  'operationalized',
];

export function getStageLabel(stage: PipelineStage): string {
  const labels: Record<PipelineStage, string> = {
    uploaded: 'Uploaded',
    content_ready: 'Content Ready',
    tagged: 'Tagged',
    knowledge_extracted: 'Knowledge Extracted',
    activated: 'Activated',
    operationalized: 'Operationalized',
  };
  return labels[stage];
}

export function getStageColor(stage: PipelineStage): string {
  switch (stage) {
    case 'operationalized': return 'text-green-600';
    case 'activated': return 'text-emerald-600';
    case 'knowledge_extracted': return 'text-blue-600';
    case 'tagged': return 'text-primary';
    case 'content_ready': return 'text-amber-600';
    default: return 'text-muted-foreground';
  }
}

// ── Result type ────────────────────────────────────────────

export interface AutoOperationalizeResult {
  success: boolean;
  resourceId: string;
  resourceTitle: string;
  stagesCompleted: PipelineStage[];
  currentStage: PipelineStage;
  tagsAdded: string[];
  knowledgeExtracted: number;
  knowledgeActivated: number;
  operationalized: boolean;
  needsReview: boolean;
  outcome: PipelineOutcome;
  extractionTier: 'full' | 'reduced' | 'lightweight' | 'none';
  reason?: string;
}

// ── Auto-activation thresholds ─────────────────────────────

const AUTO_ACTIVATE_CONFIDENCE = 0.55;
const MIN_TACTIC_SUMMARY_LENGTH = 20;
const ACTIVATION_RULE_VERSION = '2.0';

// Vague/generic patterns that indicate low-quality extraction
const VAGUE_PATTERNS = [
  /^(this is|it is|you should|they said|the speaker|important to)/i,
  /^(use|do|try|make sure|remember to|always|never) /i,
];

// ── Core Orchestrator ──────────────────────────────────────

/**
 * Runs the full auto-operationalization pipeline on a single resource.
 * Each stage is attempted in order; the pipeline stops at the first stage
 * that cannot be completed automatically.
 */
export async function autoOperationalizeResource(
  resourceId: string,
): Promise<AutoOperationalizeResult> {
  const stagesCompleted: PipelineStage[] = [];
  let tagsAdded: string[] = [];
  let knowledgeExtracted = 0;
  let knowledgeActivated = 0;
  let needsReview = false;
  let reason: string | undefined;

  // ── Load resource ──
  const { data: resource, error: rErr } = await supabase
    .from('resources')
    .select('*')
    .eq('id', resourceId)
    .single();

  if (rErr || !resource) {
    return makeResult(resourceId, '', stagesCompleted, 'uploaded', tagsAdded, 0, 0, false, true, 'Resource not found');
  }

  const r = resource as any;
  stagesCompleted.push('uploaded');

  // ── STAGE 1: Content Ready (uses pipeline contract) ──
  const eligibility = isEligibleForExtraction(r);

  // ── Diagnostic logging ──
  log.info('Pipeline start', {
    resourceId,
    title: r.title?.slice(0, 60),
    content_length_field: r.content_length,
    actual_content_length: r.content?.length ?? 0,
    enrichment_status: r.enrichment_status,
    manual_content_present: r.manual_content_present,
    eligible: eligibility.eligible,
    extractionTier: eligibility.extractionTier,
    eligibilityReason: eligibility.reason,
  });

  if (!eligibility.eligible) {
    log.info('Pipeline stopped: not eligible', { resourceId, reason: eligibility.reason });
    return makeResult(resourceId, r.title, stagesCompleted, 'uploaded', tagsAdded, 0, 0, false, true, eligibility.reason, eligibility.extractionTier, 'no_content');
  }

  const effectiveLength = Math.max(r.content?.length ?? 0, r.content_length ?? 0);
  stagesCompleted.push('content_ready');

  // ── Clear stale blockers if content-backed ──
  if (r.manual_input_required || r.enrichment_status === 'failed' || r.recovery_queue_bucket) {
    await supabase.from('resources').update({
      enrichment_status: 'deep_enriched',
      resolution_method: 'resolved_manual',
      manual_input_required: false,
      recovery_status: null,
      recovery_queue_bucket: null,
      recovery_reason: null,
      failure_reason: null,
      last_recovery_error: null,
      next_best_action: null,
      last_status_change_at: new Date().toISOString(),
    } as any).eq('id', resourceId);
    log.info('Cleared stale blockers for content-backed resource', { resourceId });
  }

  // ── STAGE 2: Tagging ──
  const existingTags: string[] = r.tags ?? [];
  const text = [r.title, r.description, r.content?.slice(0, 10000)].filter(Boolean).join('\n');
  const inferred = inferTags(text);

  // Only add required/important tags, not noisy optional ones
  const newTags = inferred.filter(t => {
    const key = `${t.dimension}:${t.value}`;
    if (existingTags.includes(key)) return false;
    return t.dimension === 'skill' || t.dimension === 'context' ||
           t.dimension === 'competitor' || t.dimension === 'product';
  });

  // For transcript/podcast/audio resources with sales content, ensure baseline tags
  const isTranscriptType = ['transcript', 'podcast', 'audio'].includes(r.resource_type ?? '');
  if (isTranscriptType) {
    const hasSalesContent = /sales|selling|prospect|buyer|deal|pipeline|objection|discovery|demo|close|negotiat|cold call|outbound/i.test(text);
    const hasSkillTag = [...existingTags, ...newTags.map(t => `${t.dimension}:${t.value}`)].some(t => t.startsWith('skill:'));
    const hasContextTag = [...existingTags, ...newTags.map(t => `${t.dimension}:${t.value}`)].some(t => t.startsWith('context:'));
    if (hasSalesContent && !hasSkillTag) {
      newTags.push({ dimension: 'skill', value: 'sales', confidence: 0.7, source: 'inferred' } as any);
    }
    if (!hasContextTag) {
      newTags.push({ dimension: 'context', value: 'coaching', confidence: 0.6, source: 'inferred' } as any);
    }
  }

  if (newTags.length > 0) {
    const merged = mergeTags(existingTags, newTags);
    await supabase.from('resources').update({
      tags: merged,
      updated_at: new Date().toISOString(),
    } as any).eq('id', resourceId);
    tagsAdded = newTags.map(t => `${t.dimension}:${t.value}`);
    log.info('Auto-tagged resource', { resourceId, tagsAdded });
  }

  // Check if required tags are present
  const allTags = mergeTags(existingTags, newTags);
  const dims = new Set(allTags.filter(t => t.includes(':')).map(t => t.split(':')[0]));
  if (!dims.has('skill') && !dims.has('context')) {
    needsReview = true;
    reason = 'Could not infer required tags (skill/context) — needs manual tagging';
    return makeResult(resourceId, r.title, stagesCompleted, 'content_ready', tagsAdded, 0, 0, false, true, reason);
  }
  stagesCompleted.push('tagged');

  // ── STAGE 3: Knowledge Extraction ──
  // Check for existing knowledge items first
  const { data: existingKI } = await supabase
    .from('knowledge_items' as any)
    .select('id, active, applies_to_contexts, confidence_score, user_edited, tactic_summary, chapter, tags')
    .eq('source_resource_id', resourceId);

  const existingItems = (existingKI ?? []) as any[];
  const hasExistingKI = existingItems.length > 0;

  // Use tiered extraction based on contract tier
  const canExtract = !hasExistingKI && (eligibility.extractionTier === 'full' || eligibility.extractionTier === 'lightweight' || eligibility.extractionTier === 'reduced');
  if (canExtract) {
    // Extract knowledge heuristically
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      return makeResult(resourceId, r.title, stagesCompleted, 'tagged', tagsAdded, 0, 0, false, true, 'User not authenticated');
    }

    // Guard: ensure content is actually present (content_length may be stale)
    const contentForExtraction = r.content || '';
    if (contentForExtraction.length < 100) {
      log.warn('Content field empty/truncated despite content_length', {
        resourceId, content_length: r.content_length, actual: contentForExtraction.length,
      });
      needsReview = true;
      reason = `Content field empty (${contentForExtraction.length} chars actual) despite content_length=${r.content_length} — re-enrich needed`;
      return makeResult(resourceId, r.title, stagesCompleted, 'tagged', tagsAdded, 0, 0, false, true, reason);
    }

    const source: ExtractionSource = {
      resourceId,
      userId,
      title: r.title,
      content: contentForExtraction,
      description: r.description,
      tags: allTags,
      resourceType: r.resource_type ?? 'document',
    };

    // Always prefer LLM extraction — produces structured KIs with framework, attribution, etc.
    // Heuristic sentence-splitting produces low-quality transcript fragments for all resource types.
    let finalExtracted: any[] = [];
    
    if (contentForExtraction.length >= 100) {
      log.info('Running LLM extraction', { resourceId, resourceType: r.resource_type });
      try {
        finalExtracted = await extractKnowledgeLLMFallback(source);
        log.info('LLM extraction result', { resourceId, count: finalExtracted.length });
      } catch (err: any) {
        log.warn('LLM extraction failed', { resourceId, error: err?.message || err });
      }
    }

    // Heuristic fallback only if LLM produced nothing
    if (finalExtracted.length === 0) {
      finalExtracted = extractKnowledgeHeuristic(source);
      log.info('Heuristic fallback result', { resourceId, count: finalExtracted.length });
          }
        } catch (err: any) {
          log.warn('LLM fallback failed', { resourceId, error: err?.message || err });
        }
      }
    }

    if (finalExtracted.length > 0) {
      const { data: inserted, error: insErr } = await supabase
        .from('knowledge_items' as any)
        .insert(finalExtracted as any)
        .select('id, active, applies_to_contexts, confidence_score, user_edited, tactic_summary, chapter, tags');

      if (!insErr && inserted) {
        knowledgeExtracted = inserted.length;
        existingItems.push(...(inserted as any[]));
        log.info('Extracted knowledge items', { resourceId, count: knowledgeExtracted });
      } else if (insErr) {
        log.warn('Failed to insert extracted knowledge', { resourceId, error: insErr.message });
      }
    } else {
      log.warn('Both heuristic and LLM extraction returned 0 items', { resourceId, contentLength: contentForExtraction.length });
    }
  } else if (hasExistingKI) {
    knowledgeExtracted = existingItems.length;
  }

  if (knowledgeExtracted === 0 && !hasExistingKI) {
    needsReview = true;
    reason = 'No knowledge could be extracted — content may be too generic or short';
    return makeResult(resourceId, r.title, stagesCompleted, 'tagged', tagsAdded, 0, 0, false, true, reason);
  }
  stagesCompleted.push('knowledge_extracted');

  // ── STAGE 4: Auto-Activation (hardened) ──
  const activatable: Array<{ item: any; reason: string }> = [];
  for (const ki of existingItems) {
    // Never touch user-edited items
    if (ki.user_edited) continue;
    // Already active — skip
    if (ki.active) continue;
    // Must meet confidence threshold
    const conf = ki.confidence_score ?? 0;
    if (conf < AUTO_ACTIVATE_CONFIDENCE) continue;
    // Must have non-trivial tactic_summary
    const summary = (ki.tactic_summary ?? '').trim();
    if (!summary || summary.length < MIN_TACTIC_SUMMARY_LENGTH) continue;
    // Must not be vague/generic
    if (VAGUE_PATTERNS.some(p => p.test(summary))) continue;
    // Must have chapter
    if (!ki.chapter) continue;
    // Must have applies_to_contexts
    if (!Array.isArray(ki.applies_to_contexts) || ki.applies_to_contexts.length === 0) continue;
    // Must have at least one structured tag (required tier: skill or context)
    const tags: string[] = ki.tags ?? [];
    const hasRequiredTag = tags.some((t: string) => t.startsWith('skill:') || t.startsWith('context:'));
    if (!hasRequiredTag) continue;
    // Build activation reason
    const reason = `confidence=${(conf * 100).toFixed(0)}%, chapter=${ki.chapter}, contexts=${ki.applies_to_contexts.length}, tags=${tags.length}`;
    activatable.push({ item: ki, reason });
  }

  if (activatable.length > 0) {
    const now = new Date().toISOString();
    // Activate each item with provenance metadata
    for (const { item: ki, reason } of activatable) {
      const provenance = {
        activation_source: 'auto_pipeline',
        activation_reason: reason,
        activation_timestamp: now,
        activation_resource_id: resourceId,
        activation_confidence_at_time: ki.confidence_score,
        activation_rule_version: ACTIVATION_RULE_VERSION,
      };
      const { error: actErr } = await supabase
        .from('knowledge_items' as any)
        .update({
          active: true,
          status: 'active',
          activation_metadata: provenance,
          updated_at: now,
        } as any)
        .eq('id', ki.id);
      if (!actErr) knowledgeActivated++;
    }
    if (knowledgeActivated > 0) {
      log.info('Auto-activated knowledge items with provenance', { resourceId, count: knowledgeActivated });
    }
  }

  const totalActive = existingItems.filter((ki: any) => ki.active).length + knowledgeActivated;

  if (totalActive === 0) {
    needsReview = true;
    reason = `${knowledgeExtracted} item(s) extracted but none met auto-activation criteria — review and activate manually`;
    return makeResult(resourceId, r.title, stagesCompleted, 'knowledge_extracted', tagsAdded, knowledgeExtracted, 0, false, true, reason);
  }
  stagesCompleted.push('activated');

  // ── STAGE 5: Operationalized ──
  // A resource is operationalized if it has active KI with contexts
  const hasActiveWithContexts = existingItems.some((ki: any) =>
    (ki.active || activatable.some((a: any) => a.id === ki.id)) &&
    Array.isArray(ki.applies_to_contexts) && ki.applies_to_contexts.length > 0
  ) || knowledgeActivated > 0; // newly activated items already passed context check

  if (hasActiveWithContexts) {
    stagesCompleted.push('operationalized');
  }

  // ── Update resource enrichment_status + last_status_change_at after successful extraction ──
  const finalStage = stagesCompleted[stagesCompleted.length - 1];
  if (knowledgeExtracted > 0 || knowledgeActivated > 0 || hasActiveWithContexts) {
    const statusUpdate: Record<string, any> = {
      last_status_change_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Only upgrade enrichment_status if it's not already deep_enriched or better
    const currentStatus = r.enrichment_status ?? 'not_enriched';
    if (!['deep_enriched', 'verified'].includes(currentStatus)) {
      statusUpdate.enrichment_status = 'deep_enriched';
    }
    await supabase.from('resources').update(statusUpdate as any).eq('id', resourceId);
    log.info('Updated resource status after extraction', {
      resourceId, finalStage, knowledgeExtracted, knowledgeActivated,
      enrichment_status: statusUpdate.enrichment_status ?? currentStatus,
    });
  }

  return makeResult(
    resourceId,
    r.title,
    stagesCompleted,
    finalStage,
    tagsAdded,
    knowledgeExtracted,
    knowledgeActivated,
    hasActiveWithContexts,
    false,
  );
}

// ── Batch operationalization ───────────────────────────────

/**
 * Run auto-operationalization on multiple resources.
 * Includes mismatch guard and regression guard.
 */
export async function autoOperationalizeBatch(
  resourceIds: string[],
  onProgress?: (processed: number, total: number, currentTitle: string) => void,
): Promise<AutoOperationalizeResult[]> {
  log.info('Batch auto-operationalize starting', { totalIds: resourceIds.length });

  if (resourceIds.length === 0) {
    log.warn('Batch called with 0 resource IDs — nothing to process');
    return [];
  }

  const results: AutoOperationalizeResult[] = [];
  const outcomeCounts: Record<PipelineOutcome, number> = {
    operationalized: 0,
    partial_extraction: 0,
    lightweight_extraction: 0,
    needs_review: 0,
    no_content: 0,
    failed: 0,
  };

  for (let i = 0; i < resourceIds.length; i++) {
    const result = await autoOperationalizeResource(resourceIds[i]);
    results.push(result);
    outcomeCounts[result.outcome]++;
    onProgress?.(i + 1, resourceIds.length, result.resourceTitle || 'Untitled');
  }

  const totalProcessed = results.filter(r => r.outcome !== 'no_content').length;

  log.info('Batch auto-operationalize complete', {
    total: resourceIds.length,
    processed: totalProcessed,
    outcomes: outcomeCounts,
    reasons: results.filter(r => r.reason).map(r => ({ id: r.resourceId, outcome: r.outcome, reason: r.reason })).slice(0, 20),
  });

  // Regression guard
  checkRegressionGuard(resourceIds.length, totalProcessed, 'autoOperationalizeBatch');

  // Mismatch guard: if we got IDs but processed 0, something is wrong
  assertEligibilityAlignment(resourceIds.length, totalProcessed, 'autoOperationalizeBatch');

  return results;
}

// ── Backfill: all existing resources ──────────────────────

export interface BackfillSummary extends BatchSummary {
  skipped: number;
  errors: number;
}

/**
 * Fetch all eligible resources for backfill.
 * Eligible = content-backed OR enriched OR has manual content.
 * Excludes junk (<50 chars, no URL, no manual content).
 */
async function fetchEligibleResourceIds(
  mode: 'all' | 'smart',
  skipOperationalized: boolean,
): Promise<string[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return [];

  // Fetch candidate resources
  let query = supabase
    .from('resources')
    .select('id, content_length, manual_content_present, enrichment_status, tags, content')
    .eq('user_id', userId);

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as any[]).filter(r => {
    return isEligibleForExtraction(r).eligible;
  }).map(r => r.id);
}

/**
 * Count eligible resources without fetching all data.
 */
export async function countEligibleResources(
  mode: 'all' | 'smart',
): Promise<number> {
  const ids = await fetchEligibleResourceIds(mode, true);
  return ids.length;
}

/**
 * Run auto-operationalization on ALL eligible existing resources.
 * Idempotent: already-operationalized resources will pass through quickly.
 * Batches in groups of 10 to avoid overwhelming the DB.
 */
export async function autoOperationalizeAllResources(
  mode: 'all' | 'smart' = 'smart',
  onProgress?: (processed: number, total: number) => void,
): Promise<BackfillSummary> {
  const ids = await fetchEligibleResourceIds(mode, false);
  const results: AutoOperationalizeResult[] = [];
  let errors = 0;

  // Process in batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    for (const id of batch) {
      try {
        const result = await autoOperationalizeResource(id);
        results.push(result);
      } catch {
        errors++;
      }
    }
    onProgress?.(Math.min(i + BATCH_SIZE, ids.length), ids.length);
  }

  const base = summarizeBatchResults(results);
  return {
    ...base,
    skipped: 0,
    errors,
  };
}

/**
 * Derive the current pipeline stage for a resource without running the pipeline.
 * Used for display purposes in UI.
 */
export function derivePipelineStage(resource: {
  content_length?: number | null;
  content?: string | null;
  manual_content_present?: boolean | null;
  tags?: string[] | null;
  enrichment_status?: string | null;
}, ki: { total: number; active: number; hasContexts: boolean }): PipelineStage {
  const isCB = contractIsContentBacked(resource);

  const isCB2 = isCB; // alias used below
  if (!isCB) return 'uploaded';

  const tags = resource.tags ?? [];
  const dims = new Set(tags.filter(t => t.includes(':')).map(t => t.split(':')[0]));
  const hasRequiredTags = dims.has('skill') || dims.has('context');

  if (!hasRequiredTags) return 'content_ready';
  if (ki.total === 0) return 'tagged';
  if (ki.active === 0) return 'knowledge_extracted';
  if (!ki.hasContexts) return 'activated';
  return 'operationalized';
}

// ── Summarize batch results ────────────────────────────────

export interface BatchSummary {
  total: number;
  operationalized: number;
  activated: number;
  extracted: number;
  needsReview: number;
  totalKnowledgeExtracted: number;
  totalKnowledgeActivated: number;
  totalTagsAdded: number;
  outcomes: Record<PipelineOutcome, number>;
  failedResources: Array<{ id: string; title: string; outcome: PipelineOutcome; reason?: string }>;
}

export function summarizeBatchResults(results: AutoOperationalizeResult[]): BatchSummary {
  const outcomes: Record<PipelineOutcome, number> = {
    operationalized: 0, partial_extraction: 0, lightweight_extraction: 0,
    needs_review: 0, no_content: 0, failed: 0,
  };
  const failedResources: BatchSummary['failedResources'] = [];

  for (const r of results) {
    outcomes[r.outcome]++;
    if (r.outcome === 'failed' || r.outcome === 'no_content' || r.outcome === 'needs_review') {
      failedResources.push({ id: r.resourceId, title: r.resourceTitle, outcome: r.outcome, reason: r.reason });
    }
  }

  return {
    total: results.length,
    operationalized: results.filter(r => r.operationalized).length,
    activated: results.filter(r => r.stagesCompleted.includes('activated')).length,
    extracted: results.filter(r => r.stagesCompleted.includes('knowledge_extracted')).length,
    needsReview: results.filter(r => r.needsReview).length,
    totalKnowledgeExtracted: results.reduce((s, r) => s + r.knowledgeExtracted, 0),
    totalKnowledgeActivated: results.reduce((s, r) => s + r.knowledgeActivated, 0),
    totalTagsAdded: results.reduce((s, r) => s + r.tagsAdded.length, 0),
    outcomes,
    failedResources: failedResources.slice(0, 50),
  };
}

// ── Helpers ────────────────────────────────────────────────

function makeResult(
  resourceId: string,
  title: string,
  stagesCompleted: PipelineStage[],
  currentStage: PipelineStage,
  tagsAdded: string[],
  knowledgeExtracted: number,
  knowledgeActivated: number,
  operationalized: boolean,
  needsReview: boolean,
  reason?: string,
  extractionTier: AutoOperationalizeResult['extractionTier'] = 'none',
  outcome?: PipelineOutcome,
): AutoOperationalizeResult {
  const derivedOutcome: PipelineOutcome = outcome
    ?? (operationalized ? 'operationalized'
      : extractionTier === 'lightweight' && knowledgeExtracted > 0 ? 'lightweight_extraction'
      : knowledgeExtracted > 0 ? 'partial_extraction'
      : needsReview ? 'needs_review'
      : 'no_content');

  return {
    success: !needsReview,
    resourceId,
    resourceTitle: title,
    stagesCompleted,
    currentStage,
    tagsAdded,
    knowledgeExtracted,
    knowledgeActivated,
    operationalized,
    needsReview,
    outcome: derivedOutcome,
    extractionTier,
    reason,
  };
}

// ── Extraction Coverage ────────────────────────────────────

export type BlockedReason =
  | 'blocked_by_empty_content'
  | 'blocked_by_no_extraction'
  | 'blocked_by_activation_criteria'
  | 'blocked_by_missing_contexts'
  | 'blocked_by_stale_blocker_state'
  | 'operationalized';

export interface BlockedExample {
  id: string;
  title: string;
  contentLengthField: number;
  actualContentLength: number;
  kiCount: number;
  activeKiCount: number;
  reason: BlockedReason;
  detail: string;
}

export interface ExtractionCoverage {
  enrichedResources: number;
  withKnowledgeItems: number;
  operationalizedResources: number;
  noKnowledgeYet: number;
  contentEmptyDespiteLength: number;
  /** Percentage of enriched that have KI */
  kiCoveragePct: number;
  /** Percentage of enriched that are operationalized */
  opCoveragePct: number;
  /** Breakdown of why resources are blocked */
  blockedByEmptyContent: number;
  blockedByNoExtraction: number;
  blockedByActivationCriteria: number;
  blockedByMissingContexts: number;
  blockedByStaleBlockerState: number;
  /** Example resources per failure class (up to 5 each) */
  examples: Record<BlockedReason, BlockedExample[]>;
}

export async function getExtractionCoverage(): Promise<ExtractionCoverage> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  const emptyExamples: Record<BlockedReason, BlockedExample[]> = {
    blocked_by_empty_content: [], blocked_by_no_extraction: [],
    blocked_by_activation_criteria: [], blocked_by_missing_contexts: [],
    blocked_by_stale_blocker_state: [], operationalized: [],
  };
  const empty: ExtractionCoverage = { enrichedResources: 0, withKnowledgeItems: 0, operationalizedResources: 0, noKnowledgeYet: 0, contentEmptyDespiteLength: 0, kiCoveragePct: 0, opCoveragePct: 0, blockedByEmptyContent: 0, blockedByNoExtraction: 0, blockedByActivationCriteria: 0, blockedByMissingContexts: 0, blockedByStaleBlockerState: 0, examples: emptyExamples };
  if (!userId) return empty;

  // Enriched + stale-blocker resources
  const { data: allResources } = await supabase
    .from('resources')
    .select('id, title, content_length, content, enrichment_status, manual_input_required, recovery_queue_bucket, failure_reason')
    .eq('user_id', userId);

  const resList = (allResources ?? []) as any[];
  const enrichedStatuses = ['enriched', 'deep_enriched', 'verified'];

  // KI per resource
  const { data: kiData } = await supabase
    .from('knowledge_items' as any)
    .select('source_resource_id, active, applies_to_contexts')
    .eq('user_id', userId);

  const kiList = (kiData ?? []) as any[];
  const kiByResource = new Map<string, any[]>();
  for (const ki of kiList) {
    if (!ki.source_resource_id) continue;
    const arr = kiByResource.get(ki.source_resource_id) ?? [];
    arr.push(ki);
    kiByResource.set(ki.source_resource_id, arr);
  }

  let withKI = 0;
  let operationalized = 0;
  let contentEmpty = 0;
  let blockedByNoExtraction = 0;
  let blockedByActivationCriteria = 0;
  let blockedByMissingContexts = 0;
  let blockedByStaleBlockerState = 0;
  const examples: Record<BlockedReason, BlockedExample[]> = {
    blocked_by_empty_content: [], blocked_by_no_extraction: [],
    blocked_by_activation_criteria: [], blocked_by_missing_contexts: [],
    blocked_by_stale_blocker_state: [], operationalized: [],
  };

  const enrichedList = resList.filter(r => enrichedStatuses.includes(r.enrichment_status));

  // Also detect stale blocker resources (content-backed but stuck)
  const staleBlockerList = resList.filter(r => {
    if (enrichedStatuses.includes(r.enrichment_status)) return false;
    const actualLen = r.content?.length ?? 0;
    const contentLen = r.content_length ?? 0;
    const isCB = Math.max(actualLen, contentLen) >= 200;
    return isCB && (r.manual_input_required || r.recovery_queue_bucket || r.enrichment_status === 'failed');
  });

  for (const r of staleBlockerList) {
    blockedByStaleBlockerState++;
    addExample(examples, 'blocked_by_stale_blocker_state', r, kiByResource, `Stale state: ${r.enrichment_status}, manual_input=${r.manual_input_required}, bucket=${r.recovery_queue_bucket ?? 'none'}`);
  }

  for (const r of enrichedList) {
    const actualLen = r.content?.length ?? 0;
    const items = kiByResource.get(r.id);

    // Safety rule: actual content must be >= 100
    if ((r.content_length ?? 0) > 300 && actualLen < 100) {
      contentEmpty++;
      addExample(examples, 'blocked_by_empty_content', r, kiByResource, `content_length=${r.content_length} but actual=${actualLen}`);
      continue;
    }

    if (items && items.length > 0) {
      withKI++;
      const activeItems = items.filter((ki: any) => ki.active);
      const hasActiveWithCtx = activeItems.some((ki: any) =>
        Array.isArray(ki.applies_to_contexts) && ki.applies_to_contexts.length > 0
      );
      if (hasActiveWithCtx) {
        operationalized++;
        addExample(examples, 'operationalized', r, kiByResource, 'Fully operationalized');
      } else if (activeItems.length > 0) {
        // Active but no contexts
        blockedByMissingContexts++;
        addExample(examples, 'blocked_by_missing_contexts', r, kiByResource, `${activeItems.length} active KI but none have applies_to_contexts`);
      } else {
        // Has KI but none active
        blockedByActivationCriteria++;
        addExample(examples, 'blocked_by_activation_criteria', r, kiByResource, `${items.length} KI extracted but 0 active`);
      }
    } else if (actualLen >= 100) {
      // Has content but no KI extracted
      blockedByNoExtraction++;
      addExample(examples, 'blocked_by_no_extraction', r, kiByResource, `${actualLen} chars of content, no KI extracted`);
    }
  }

  const total = enrichedList.length;
  return {
    enrichedResources: total,
    withKnowledgeItems: withKI,
    operationalizedResources: operationalized,
    noKnowledgeYet: total - withKI - contentEmpty,
    contentEmptyDespiteLength: contentEmpty,
    kiCoveragePct: total > 0 ? Math.round((withKI / total) * 100) : 0,
    opCoveragePct: total > 0 ? Math.round((operationalized / total) * 100) : 0,
    blockedByEmptyContent: contentEmpty,
    blockedByNoExtraction,
    blockedByActivationCriteria,
    blockedByMissingContexts,
    blockedByStaleBlockerState,
    examples,
  };
}

function addExample(
  examples: Record<BlockedReason, BlockedExample[]>,
  reason: BlockedReason,
  r: any,
  kiByResource: Map<string, any[]>,
  detail: string,
) {
  if (examples[reason].length >= 5) return;
  const items = kiByResource.get(r.id) ?? [];
  examples[reason].push({
    id: r.id,
    title: r.title ?? '(untitled)',
    contentLengthField: r.content_length ?? 0,
    actualContentLength: r.content?.length ?? 0,
    kiCount: items.length,
    activeKiCount: items.filter((k: any) => k.active).length,
    reason,
    detail,
  });
}

// ── Force Extract All ──────────────────────────────────────

export interface ForceExtractResult {
  eligible: number;
  processed: number;
  newKnowledgeItems: number;
  becameOperationalized: number;
  stillNeedsReview: number;
  contentEmpty: number;
  errors: string[];
}

/**
 * Force-extract knowledge from all resources with content_length > 300
 * and no existing knowledge items. Ignores prior pipeline state.
 */
export async function forceExtractAll(
  onProgress?: (processed: number, total: number) => void,
): Promise<ForceExtractResult> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { eligible: 0, processed: 0, newKnowledgeItems: 0, becameOperationalized: 0, stillNeedsReview: 0, contentEmpty: 0, errors: [] };

  // Find resources with content but no KI
  const { data: resources } = await supabase
    .from('resources')
    .select('id, title, content, content_length, description, resource_type, tags')
    .eq('user_id', userId)
    .gte('content_length', 300);

  const allResources = (resources ?? []) as any[];

  // Get resources that already have KI
  const { data: existingKIData } = await supabase
    .from('knowledge_items' as any)
    .select('source_resource_id')
    .eq('user_id', userId);

  const hasKI = new Set((existingKIData ?? []).map((k: any) => k.source_resource_id).filter(Boolean));
  const eligible = allResources.filter(r => !hasKI.has(r.id));

  const result: ForceExtractResult = {
    eligible: eligible.length,
    processed: 0,
    newKnowledgeItems: 0,
    becameOperationalized: 0,
    stillNeedsReview: 0,
    contentEmpty: 0,
    errors: [],
  };

  for (let i = 0; i < eligible.length; i++) {
    const r = eligible[i];
    try {
      const actualContent = r.content || '';
      if (actualContent.length < 100) {
        result.contentEmpty++;
        log.warn('forceExtract: content empty', { resourceId: r.id, content_length: r.content_length, actual: actualContent.length });
        continue;
      }

      // Run the full pipeline instead of just extraction
      const pipelineResult = await autoOperationalizeResource(r.id);
      result.processed++;
      result.newKnowledgeItems += pipelineResult.knowledgeExtracted;
      if (pipelineResult.operationalized) result.becameOperationalized++;
      if (pipelineResult.needsReview) result.stillNeedsReview++;
    } catch (err: any) {
      result.errors.push(`${r.id}: ${err?.message ?? 'unknown'}`);
    }
    onProgress?.(i + 1, eligible.length);
  }

  log.info('forceExtractAll complete', result);
  return result;
}
