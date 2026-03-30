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
import { extractKnowledgeHeuristic, type ExtractionSource } from './knowledgeExtraction';
import { createLogger } from '@/lib/logger';

const log = createLogger('AutoOperationalize');

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
  reason?: string;
}

// ── Auto-activation thresholds ─────────────────────────────

const AUTO_ACTIVATE_CONFIDENCE = 0.65;
const MIN_CONTENT_LENGTH = 200;
const MIN_CONTENT_FOR_EXTRACTION = 300;
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

  // ── STAGE 1: Content Ready ──
  const contentLength = r.content_length ?? (r.content?.length ?? 0);
  const isContentBacked = contentLength >= MIN_CONTENT_LENGTH || r.manual_content_present === true;

  if (!isContentBacked) {
    return makeResult(resourceId, r.title, stagesCompleted, 'uploaded', tagsAdded, 0, 0, false, true,
      `Content too short (${contentLength} chars) — needs enrichment or manual input`);
  }
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

  if (!hasExistingKI && contentLength >= MIN_CONTENT_FOR_EXTRACTION) {
    // Extract knowledge heuristically
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      return makeResult(resourceId, r.title, stagesCompleted, 'tagged', tagsAdded, 0, 0, false, true, 'User not authenticated');
    }

    const source: ExtractionSource = {
      resourceId,
      userId,
      title: r.title,
      content: r.content,
      description: r.description,
      tags: allTags,
      resourceType: r.resource_type ?? 'document',
    };

    const extracted = extractKnowledgeHeuristic(source);
    if (extracted.length > 0) {
      const { data: inserted, error: insErr } = await supabase
        .from('knowledge_items' as any)
        .insert(extracted as any)
        .select('id, active, applies_to_contexts, confidence_score, user_edited, tactic_summary, chapter');

      if (!insErr && inserted) {
        knowledgeExtracted = inserted.length;
        existingItems.push(...(inserted as any[]));
        log.info('Extracted knowledge items', { resourceId, count: knowledgeExtracted });
      }
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

  return makeResult(
    resourceId,
    r.title,
    stagesCompleted,
    stagesCompleted[stagesCompleted.length - 1],
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
 * Useful for bulk processing after imports or fixes.
 */
export async function autoOperationalizeBatch(
  resourceIds: string[],
): Promise<AutoOperationalizeResult[]> {
  const results: AutoOperationalizeResult[] = [];
  for (const id of resourceIds) {
    const result = await autoOperationalizeResource(id);
    results.push(result);
  }
  return results;
}

/**
 * Derive the current pipeline stage for a resource without running the pipeline.
 * Used for display purposes in UI.
 */
export function derivePipelineStage(resource: {
  content_length?: number | null;
  manual_content_present?: boolean | null;
  tags?: string[] | null;
  enrichment_status?: string | null;
}, ki: { total: number; active: number; hasContexts: boolean }): PipelineStage {
  const contentLength = resource.content_length ?? 0;
  const isContentBacked = contentLength >= MIN_CONTENT_LENGTH || resource.manual_content_present === true;

  if (!isContentBacked) return 'uploaded';

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
}

export function summarizeBatchResults(results: AutoOperationalizeResult[]): BatchSummary {
  return {
    total: results.length,
    operationalized: results.filter(r => r.operationalized).length,
    activated: results.filter(r => r.stagesCompleted.includes('activated')).length,
    extracted: results.filter(r => r.stagesCompleted.includes('knowledge_extracted')).length,
    needsReview: results.filter(r => r.needsReview).length,
    totalKnowledgeExtracted: results.reduce((s, r) => s + r.knowledgeExtracted, 0),
    totalKnowledgeActivated: results.reduce((s, r) => s + r.knowledgeActivated, 0),
    totalTagsAdded: results.reduce((s, r) => s + r.tagsAdded.length, 0),
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
): AutoOperationalizeResult {
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
    reason,
  };
}
