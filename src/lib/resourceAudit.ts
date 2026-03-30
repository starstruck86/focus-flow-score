/**
 * Resource Audit & Readiness System
 *
 * Scans all resources and classifies them into readiness buckets.
 * Provides bulk actions for fixing, extracting, and activating.
 */

import { supabase } from '@/integrations/supabase/client';
import { inferTags, mergeTags, tagsToFlat } from './resourceTags';

// ── Types ──────────────────────────────────────────────────

export type ReadinessBucket =
  | 'ready'
  | 'blocked_incorrectly'
  | 'missing_content'
  | 'content_backed_needs_fix'
  | 'extractable_not_operationalized'
  | 'operationalized'
  | 'needs_tagging'
  | 'junk_or_low_signal'
  | 'orphaned_or_inconsistent';

export interface AuditedResource {
  id: string;
  title: string;
  bucket: ReadinessBucket;
  contentLength: number;
  enrichmentStatus: string;
  qualityScore: number | null;
  hasContent: boolean;
  isNotionDerived: boolean;
  knowledgeItemCount: number;
  activeKnowledgeCount: number;
  hasContexts: boolean;
  tags: string[];
  missingTagDimensions: string[];
  recommendedAction: string;
}

export interface AuditSummary {
  totalScanned: number;
  buckets: Record<ReadinessBucket, AuditedResource[]>;
  counts: Record<ReadinessBucket, number>;
}

const NOTION_METHODS = ['notion_zip_split', 'notion_zip_page_import', 'notion_zip_database_import', 'notion_zip_page_chunk'];

function isContentBacked(r: any): boolean {
  return (r.content_length ?? 0) > 200 || r.manual_content_present === true;
}

function isNotionDerived(r: any): boolean {
  const rm = r.resolution_method || r.extraction_method || '';
  return typeof rm === 'string' && NOTION_METHODS.includes(rm);
}

/**
 * Full resource readiness audit.
 */
export async function auditResourceReadiness(): Promise<AuditSummary> {
  // Fetch resources
  const { data: resources, error: rErr } = await supabase
    .from('resources')
    .select('id, title, content, content_length, content_status, enrichment_status, last_quality_score, last_quality_tier, failure_reason, recovery_status, recovery_queue_bucket, manual_input_required, manual_content_present, resolution_method, extraction_method, tags, updated_at, resource_type, file_url')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (rErr || !resources) return emptyAudit();

  // Fetch knowledge items
  const { data: kiRows } = await supabase
    .from('knowledge_items' as any)
    .select('source_resource_id, active, applies_to_contexts');

  const kiMap = new Map<string, { total: number; active: number; hasContexts: boolean }>();
  for (const ki of (kiRows ?? []) as any[]) {
    if (!ki.source_resource_id) continue;
    const entry = kiMap.get(ki.source_resource_id) ?? { total: 0, active: 0, hasContexts: false };
    entry.total++;
    if (ki.active) {
      entry.active++;
      if (Array.isArray(ki.applies_to_contexts) && ki.applies_to_contexts.length > 0) {
        entry.hasContexts = true;
      }
    }
    kiMap.set(ki.source_resource_id, entry);
  }

  const buckets: Record<ReadinessBucket, AuditedResource[]> = {
    ready: [],
    blocked_incorrectly: [],
    missing_content: [],
    content_backed_needs_fix: [],
    extractable_not_operationalized: [],
    operationalized: [],
    needs_tagging: [],
    junk_or_low_signal: [],
    orphaned_or_inconsistent: [],
  };

  for (const r of resources) {
    const hasCnt = isContentBacked(r);
    const notion = isNotionDerived(r);
    const ki = kiMap.get(r.id) ?? { total: 0, active: 0, hasContexts: false };
    const tags = r.tags ?? [];
    const structuredTags = tags.filter((t: string) => t.includes(':'));
    const score = r.last_quality_score;
    const status = r.enrichment_status || 'not_enriched';

    // Determine missing tag dimensions
    const dims = new Set(structuredTags.map((t: string) => t.split(':')[0]));
    const missingDims: string[] = [];
    if (!dims.has('skill')) missingDims.push('skill');
    if (!dims.has('context')) missingDims.push('context');

    // Classify into bucket
    let bucket: ReadinessBucket;
    let action: string;

    if (ki.active > 0 && ki.hasContexts) {
      bucket = 'operationalized';
      action = 'Operationalized — actively used by Dave';
    } else if (hasCnt && (
      r.manual_input_required === true ||
      status === 'failed' ||
      r.recovery_queue_bucket === 'manual_input' ||
      (notion && status === 'not_enriched')
    )) {
      bucket = 'content_backed_needs_fix';
      action = 'Fix: clear stale blocker state and re-score';
    } else if (hasCnt && (
      r.recovery_queue_bucket === 'blocked' ||
      (status === 'not_enriched' && !notion)
    )) {
      bucket = 'blocked_incorrectly';
      action = 'Blocked incorrectly — fix available';
    } else if (!hasCnt && (!r.content || (r.content_length ?? 0) < 50)) {
      if ((r.content_length ?? 0) < 50 && !r.file_url) {
        bucket = 'junk_or_low_signal';
        action = 'Very low content — may be junk';
      } else {
        bucket = 'missing_content';
        action = 'No content — needs enrichment or manual input';
      }
    } else if (
      hasCnt &&
      ['enriched', 'deep_enriched', 'verified'].includes(status) &&
      ki.total === 0
    ) {
      bucket = 'extractable_not_operationalized';
      action = 'Ready for extraction';
    } else if (ki.total > 0 && ki.active === 0) {
      bucket = 'extractable_not_operationalized';
      action = 'Extracted, not yet activated';
    } else if (hasCnt && structuredTags.length === 0) {
      bucket = 'needs_tagging';
      action = 'Has content but no structured tags';
    } else if (hasCnt && ['enriched', 'deep_enriched', 'verified'].includes(status)) {
      bucket = 'ready';
      action = 'Ready';
    } else {
      bucket = 'orphaned_or_inconsistent';
      action = 'Status inconsistent — review manually';
    }

    const audited: AuditedResource = {
      id: r.id,
      title: r.title,
      bucket,
      contentLength: r.content_length ?? 0,
      enrichmentStatus: status,
      qualityScore: score,
      hasContent: hasCnt,
      isNotionDerived: notion,
      knowledgeItemCount: ki.total,
      activeKnowledgeCount: ki.active,
      hasContexts: ki.hasContexts,
      tags,
      missingTagDimensions: missingDims,
      recommendedAction: action,
    };

    buckets[bucket].push(audited);
  }

  const counts = {} as Record<ReadinessBucket, number>;
  for (const [k, v] of Object.entries(buckets)) {
    counts[k as ReadinessBucket] = v.length;
  }

  return { totalScanned: resources.length, buckets, counts };
}

// ── Bulk Actions ──────────────────────────────────────────

/**
 * Fix content-backed resources stuck in bad states.
 */
export async function bulkFixContentBacked(resourceIds: string[]): Promise<number> {
  let fixed = 0;
  for (const id of resourceIds) {
    const { error } = await supabase
      .from('resources')
      .update({
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
      } as any)
      .eq('id', id);
    if (!error) fixed++;
  }
  return fixed;
}

/**
 * Auto-tag resources based on content.
 */
export async function bulkAutoTag(resourceIds: string[]): Promise<number> {
  let tagged = 0;
  for (const id of resourceIds) {
    const { data: r } = await supabase
      .from('resources')
      .select('id, title, content, description, tags')
      .eq('id', id)
      .single();

    if (!r) continue;
    const text = [r.title, r.description, r.content].filter(Boolean).join('\n');
    const inferred = inferTags(text);
    if (inferred.length === 0) continue;

    const merged = mergeTags(r.tags ?? [], inferred);
    const { error } = await supabase
      .from('resources')
      .update({ tags: merged } as any)
      .eq('id', id);
    if (!error) tagged++;
  }
  return tagged;
}

/**
 * Activate all high-confidence extracted knowledge items.
 */
export async function bulkActivateHighConfidence(): Promise<number> {
  const { data, error } = await supabase
    .from('knowledge_items' as any)
    .update({ active: true, status: 'active', updated_at: new Date().toISOString() })
    .eq('active', false)
    .in('status', ['extracted', 'approved'])
    .gte('confidence_score', 0.7)
    .select('id');

  if (error) return 0;
  return data?.length ?? 0;
}

function emptyAudit(): AuditSummary {
  const empty: Record<ReadinessBucket, AuditedResource[]> = {
    ready: [], blocked_incorrectly: [], missing_content: [],
    content_backed_needs_fix: [], extractable_not_operationalized: [],
    operationalized: [], needs_tagging: [],
    junk_or_low_signal: [], orphaned_or_inconsistent: [],
  };
  const counts = {} as Record<ReadinessBucket, number>;
  for (const k of Object.keys(empty)) counts[k as ReadinessBucket] = 0;
  return { totalScanned: 0, buckets: empty, counts };
}
