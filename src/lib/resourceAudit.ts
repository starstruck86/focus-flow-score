/**
 * Resource Audit & Readiness System
 *
 * Scans all resources and classifies them into readiness buckets.
 * Bucket evaluation is deterministic, ordered, and non-overlapping.
 * Each resource lands in exactly ONE bucket.
 *
 * BUCKET PRIORITY ORDER (first match wins):
 *   1. operationalized        – has active KI with contexts → already driving behavior
 *   2. content_backed_needs_fix – has valid content but stuck in stale blocker state
 *   3. blocked_incorrectly    – blocked/manual-required without valid content to auto-fix
 *   4. extractable_not_operationalized – enriched + content but no active KI yet
 *   5. needs_tagging          – missing REQUIRED tags (skill or context)
 *   6. ready                  – content-backed, enriched, tagged — good to go
 *   7. junk_or_low_signal     – no real content, no URL, clearly low value
 *   8. missing_content        – no content but has URL or other recoverable state
 *   9. orphaned_or_inconsistent – true edge cases only
 */

import { supabase } from '@/integrations/supabase/client';
import { inferTags, mergeTags } from './resourceTags';
import { isContentBacked as contractIsContentBacked, ENRICHED_STATUSES } from './pipelineContract';

// ── Types ──────────────────────────────────────────────────

export type ReadinessBucket =
  | 'operationalized'
  | 'content_backed_needs_fix'
  | 'blocked_incorrectly'
  | 'extractable_not_operationalized'
  | 'low_quality_extraction'
  | 'needs_tagging'
  | 'ready'
  | 'junk_or_low_signal'
  | 'missing_content'
  | 'orphaned_or_inconsistent';

export interface TagQualityIssue {
  type: 'missing_competitor_tag' | 'missing_product_tag' | 'active_without_context' | 'active_without_skill';
  message: string;
}

export interface AuditedResource {
  id: string;
  title: string;
  bucket: ReadinessBucket;
  bucketReason: string; // "why this bucket?" explanation
  contentLength: number;
  enrichmentStatus: string;
  qualityScore: number | null;
  hasContent: boolean;
  isNotionDerived: boolean;
  knowledgeItemCount: number;
  activeKnowledgeCount: number;
  activeWithContexts: number;
  hasContexts: boolean;
  tags: string[];
  missingRequiredTags: string[]; // only skill & context
  tagQualityIssues: TagQualityIssue[];
  recommendedAction: string;
  badges: string[]; // quick visual badges
}

export interface AuditSummary {
  totalScanned: number;
  buckets: Record<ReadinessBucket, AuditedResource[]>;
  counts: Record<ReadinessBucket, number>;
  validationSummary: {
    missingRequiredTags: number;
    activeButInconsistent: number;
    operationalizedCount: number;
    tagQualityIssueCount: number;
  };
}

// ── Constants ──────────────────────────────────────────────

const NOTION_METHODS = ['notion_zip_split', 'notion_zip_page_import', 'notion_zip_database_import', 'notion_zip_page_chunk'];

// ── Helpers ────────────────────────────────────────────────

/** Delegates to the shared pipeline contract — SINGLE source of truth */
function isContentBacked(r: any): boolean {
  return contractIsContentBacked(r);
}

function isNotionDerived(r: any): boolean {
  const rm = r.resolution_method || r.extraction_method || '';
  return typeof rm === 'string' && NOTION_METHODS.includes(rm);
}

function hasStaleBlockerState(r: any): boolean {
  return (
    r.manual_input_required === true ||
    r.enrichment_status === 'failed' ||
    r.recovery_queue_bucket === 'manual_input' ||
    r.recovery_queue_bucket === 'blocked' ||
    (r.failure_reason && r.failure_reason.length > 0)
  );
}

function getStructuredTagDims(tags: string[]): Set<string> {
  return new Set(
    tags.filter(t => t.includes(':')).map(t => t.split(':')[0])
  );
}

// ── Tag quality checks ────────────────────────────────────

function checkTagQuality(r: any, ki: { total: number; active: number; hasContexts: boolean; chapters: string[]; types: string[]; hasCompetitor: boolean; hasProduct: boolean }): TagQualityIssue[] {
  const issues: TagQualityIssue[] = [];
  const tags = r.tags ?? [];
  const dims = getStructuredTagDims(tags);

  // Rule 1: competitor knowledge without competitor tag
  if ((ki.chapters.includes('Competitors') || ki.types.includes('competitive')) && !dims.has('competitor')) {
    issues.push({ type: 'missing_competitor_tag', message: 'Competitor knowledge detected but no competitor tag' });
  }

  // Rule 2: messaging/product knowledge without product tag
  if ((ki.chapters.includes('Messaging') || ki.hasProduct) && !dims.has('product')) {
    issues.push({ type: 'missing_product_tag', message: 'Product knowledge detected but no product tag' });
  }

  // Rule 3: active KI without context tag
  if (ki.active > 0 && !ki.hasContexts) {
    issues.push({ type: 'active_without_context', message: `${ki.active} active item(s) but no applies_to_contexts` });
  }

  // Rule 4: active KI without skill alignment
  if (ki.active > 0 && !dims.has('skill') && ki.chapters.length === 0) {
    issues.push({ type: 'active_without_skill', message: 'Active knowledge but no skill tag or chapter' });
  }

  return issues;
}

// ── Main Audit ─────────────────────────────────────────────

export async function auditResourceReadiness(): Promise<AuditSummary> {
  // Paginate the full resource set — the previous .limit(500) silently
  // truncated libraries with >500 rows and produced inconsistent dashboard totals.
  let resources: any[];
  try {
    resources = await fetchAllPages<any>((from, to) =>
      supabase
        .from('resources')
        .select('id, title, content, content_length, content_status, enrichment_status, last_quality_score, last_quality_tier, failure_reason, recovery_status, recovery_queue_bucket, manual_input_required, manual_content_present, resolution_method, extraction_method, tags, updated_at, resource_type, file_url')
        .order('updated_at', { ascending: false })
        .range(from, to),
    );
  } catch {
    return emptyAudit();
  }

  if (!resources || resources.length === 0) return emptyAudit();

  // Fetch knowledge items with richer metadata — paginated for the same reason.
  let kiRows: any[] = [];
  try {
    kiRows = await fetchAllPages<any>((from, to) =>
      supabase
        .from('knowledge_items' as any)
        .select('source_resource_id, active, applies_to_contexts, chapter, knowledge_type, product_area, competitor_name')
        .range(from, to),
    );
  } catch {
    kiRows = [];
  }

  const kiMap = new Map<string, {
    total: number; active: number; hasContexts: boolean;
    activeWithContexts: number; chapters: string[]; types: string[];
    hasCompetitor: boolean; hasProduct: boolean;
  }>();

  for (const ki of (kiRows ?? []) as any[]) {
    if (!ki.source_resource_id) continue;
    const entry = kiMap.get(ki.source_resource_id) ?? {
      total: 0, active: 0, hasContexts: false, activeWithContexts: 0,
      chapters: [], types: [], hasCompetitor: false, hasProduct: false,
    };
    entry.total++;
    if (ki.chapter && !entry.chapters.includes(ki.chapter)) entry.chapters.push(ki.chapter);
    if (ki.knowledge_type && !entry.types.includes(ki.knowledge_type)) entry.types.push(ki.knowledge_type);
    if (ki.competitor_name) entry.hasCompetitor = true;
    if (ki.product_area) entry.hasProduct = true;
    if (ki.active) {
      entry.active++;
      if (Array.isArray(ki.applies_to_contexts) && ki.applies_to_contexts.length > 0) {
        entry.hasContexts = true;
        entry.activeWithContexts++;
      }
    }
    kiMap.set(ki.source_resource_id, entry);
  }

  const buckets = initBuckets();
  let missingRequiredTagsCount = 0;
  let activeButInconsistentCount = 0;
  let tagQualityIssueCount = 0;

  for (const r of resources) {
    const hasCnt = isContentBacked(r);
    const notion = isNotionDerived(r);
    const ki = kiMap.get(r.id) ?? {
      total: 0, active: 0, hasContexts: false, activeWithContexts: 0,
      chapters: [], types: [], hasCompetitor: false, hasProduct: false,
    };
    const tags = r.tags ?? [];
    const dims = getStructuredTagDims(tags);
    const score = r.last_quality_score;
    const status = r.enrichment_status || 'not_enriched';

    // Required tag check: only skill and context
    const missingRequired: string[] = [];
    if (!dims.has('skill')) missingRequired.push('skill');
    if (!dims.has('context')) missingRequired.push('context');

    const tagIssues = checkTagQuality(r, ki);
    if (tagIssues.length > 0) tagQualityIssueCount++;

    // Build badges
    const badges: string[] = [];
    if (hasCnt) badges.push('content-backed');
    if (notion) badges.push('notion');
    if (ki.active > 0 && ki.hasContexts) badges.push('operationalized');
    else if (ki.active > 0) badges.push('active-ki');
    if (ki.total > 0 && ki.active === 0) badges.push('extracted');

    // ── BUCKET CLASSIFICATION (priority order, first match wins) ──

    let bucket: ReadinessBucket;
    let reason: string;
    let action: string;

    // 1. OPERATIONALIZED — active KI with contexts → already driving behavior
    if (ki.active > 0 && ki.hasContexts) {
      bucket = 'operationalized';
      reason = `Has ${ki.activeWithContexts} active knowledge item(s) with applies_to_contexts`;
      action = 'Operationalized — actively used by Dave';
    }
    // 2. CONTENT_BACKED_NEEDS_FIX — has valid content but stuck in stale blocker
    else if (hasCnt && hasStaleBlockerState(r)) {
      const blockers: string[] = [];
      if (r.manual_input_required) blockers.push('manual_input_required=true');
      if (r.enrichment_status === 'failed') blockers.push('enrichment_status=failed');
      if (r.recovery_queue_bucket) blockers.push(`recovery_queue_bucket=${r.recovery_queue_bucket}`);
      if (r.failure_reason) blockers.push(`failure_reason present`);
      bucket = 'content_backed_needs_fix';
      reason = `Has content_length ${r.content_length ?? 0} but ${blockers.join(', ')}`;
      action = 'Fix: clear stale blocker state and re-score';
    }
    // 3. BLOCKED_INCORRECTLY — blocked without valid content to auto-fix
    else if (!hasCnt && hasStaleBlockerState(r) && (r.file_url || (r.content_length ?? 0) > 50)) {
      bucket = 'blocked_incorrectly';
      reason = `Blocked (${r.recovery_queue_bucket || r.enrichment_status}) but has ${r.file_url ? 'file_url' : `${r.content_length} chars`} — not enough content to auto-fix`;
      action = 'Review manually — may need enrichment or manual input';
    }
    // 4. EXTRACTABLE_NOT_OPERATIONALIZED — enriched with content but no active KI
    else if (hasCnt && ENRICHED_STATUSES.includes(status) && ki.total === 0) {
      bucket = 'extractable_not_operationalized';
      reason = `Enriched (${status}) with ${r.content_length ?? 0} chars but 0 knowledge items extracted`;
      action = 'Ready for knowledge extraction';
    }
    // 4b. LOW_QUALITY_EXTRACTION — has KI but 0 activatable (all below threshold or missing fields)
    else if (hasCnt && ENRICHED_STATUSES.includes(status) && ki.total > 0 && ki.active === 0) {
      // Check if any items could be activated (have sufficient confidence)
      bucket = 'low_quality_extraction';
      reason = `Has ${ki.total} extracted knowledge item(s) but 0 are activatable — likely summary-style, not actionable tactics`;
      action = 'Re-extract with tactic-focused extraction or review items manually';
    }
    // 5. NEEDS_TAGGING — missing REQUIRED tags (skill or context) only
    else if (hasCnt && ENRICHED_STATUSES.includes(status) && missingRequired.length > 0) {
      bucket = 'needs_tagging';
      reason = `Missing required tags: ${missingRequired.join(', ')}`;
      action = `Auto-tag to add ${missingRequired.join(' + ')} tags`;
      missingRequiredTagsCount++;
    }
    // 6. READY — content-backed, enriched, tagged
    else if (hasCnt && ENRICHED_STATUSES.includes(status)) {
      bucket = 'ready';
      reason = `Content-backed (${r.content_length ?? 0} chars), enriched, and tagged`;
      action = 'Ready for extraction or use';
    }
    // 7. JUNK_OR_LOW_SIGNAL — no real content, no URL, clearly low value
    else if ((r.content_length ?? 0) < 50 && !r.file_url && !notion) {
      bucket = 'junk_or_low_signal';
      reason = `Only ${r.content_length ?? 0} chars, no file_url, not Notion-derived`;
      action = 'Very low content — may be junk';
    }
    // 8. MISSING_CONTENT — no content but has URL or recoverable state (never for Notion with content)
    else if (!hasCnt && !notion) {
      bucket = 'missing_content';
      reason = `Content_length ${r.content_length ?? 0}, not content-backed`;
      action = 'Needs enrichment or manual input';
    }
    // 9. ORPHANED_OR_INCONSISTENT — true edge cases only
    else {
      bucket = 'orphaned_or_inconsistent';
      reason = `Status=${status}, content_length=${r.content_length ?? 0}, notion=${notion} — state combination is unusual`;
      action = 'Review manually';
    }

    // Track active-but-inconsistent
    if (ki.active > 0 && !ki.hasContexts) activeButInconsistentCount++;

    const audited: AuditedResource = {
      id: r.id,
      title: r.title,
      bucket,
      bucketReason: reason,
      contentLength: r.content_length ?? 0,
      enrichmentStatus: status,
      qualityScore: score,
      hasContent: hasCnt,
      isNotionDerived: notion,
      knowledgeItemCount: ki.total,
      activeKnowledgeCount: ki.active,
      activeWithContexts: ki.activeWithContexts,
      hasContexts: ki.hasContexts,
      tags,
      missingRequiredTags: missingRequired,
      tagQualityIssues: tagIssues,
      recommendedAction: action,
      badges,
    };

    buckets[bucket].push(audited);
  }

  const counts = {} as Record<ReadinessBucket, number>;
  for (const [k, v] of Object.entries(buckets)) {
    counts[k as ReadinessBucket] = v.length;
  }

  const operationalizedCount = counts.operationalized;

  // Console summary for developer debugging
  console.log('[ResourceAudit] Summary:', {
    totalScanned: resources.length,
    counts,
    missingRequiredTags: missingRequiredTagsCount,
    activeButInconsistent: activeButInconsistentCount,
    operationalized: operationalizedCount,
    tagQualityIssues: tagQualityIssueCount,
  });

  return {
    totalScanned: resources.length,
    buckets,
    counts,
    validationSummary: {
      missingRequiredTags: missingRequiredTagsCount,
      activeButInconsistent: activeButInconsistentCount,
      operationalizedCount,
      tagQualityIssueCount,
    },
  };
}

// ── Bulk Actions (hardened) ────────────────────────────────

/**
 * Fix content-backed resources stuck in bad states.
 * SAFETY: Only affects resources that are actually content-backed.
 */
export async function bulkFixContentBacked(resourceIds: string[]): Promise<number> {
  let fixed = 0;
  for (const id of resourceIds) {
    // Re-verify content-backed before fixing
    const { data: r } = await supabase
      .from('resources')
      .select('content_length, manual_content_present')
      .eq('id', id)
      .single();

    if (!r || !((r.content_length ?? 0) > 200 || r.manual_content_present === true)) continue;

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
 * Auto-tag resources with missing REQUIRED tags only.
 * SAFETY: Never overwrites existing tags, only fills gaps.
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
    const existing = r.tags ?? [];
    const dims = getStructuredTagDims(existing);

    // Only tag if missing required dimensions
    if (dims.has('skill') && dims.has('context')) continue;

    const text = [r.title, r.description, r.content?.slice(0, 5000)].filter(Boolean).join('\n');
    const inferred = inferTags(text);
    if (inferred.length === 0) continue;

    // Only add tags for missing required/important dimensions, don't add weak optional tags
    const filtered = inferred.filter(t => {
      if (t.dimension === 'skill' || t.dimension === 'context') return !dims.has(t.dimension);
      if (t.dimension === 'competitor' || t.dimension === 'product') return !dims.has(t.dimension);
      // Skip persona/stage/signal for auto-tagging — too noisy
      return false;
    });

    if (filtered.length === 0) continue;

    const merged = mergeTags(existing, filtered);
    const { error } = await supabase
      .from('resources')
      .update({ tags: merged } as any)
      .eq('id', id);
    if (!error) tagged++;
  }
  return tagged;
}

/**
 * Activate high-confidence extracted knowledge items.
 * SAFETY: Only activates items with confidence ≥ 0.7 that have contexts.
 */
export async function bulkActivateHighConfidence(): Promise<number> {
  // First activate items that already have contexts
  const { data: withContexts, error: err1 } = await supabase
    .from('knowledge_items' as any)
    .update({ active: true, status: 'active', updated_at: new Date().toISOString() })
    .eq('active', false)
    .in('status', ['extracted', 'approved'])
    .gte('confidence_score', 0.7)
    .not('applies_to_contexts', 'eq', '{}')
    .select('id');

  if (err1) return 0;
  return withContexts?.length ?? 0;
}

// ── Helpers ────────────────────────────────────────────────

function initBuckets(): Record<ReadinessBucket, AuditedResource[]> {
  return {
    operationalized: [],
    content_backed_needs_fix: [],
    blocked_incorrectly: [],
    extractable_not_operationalized: [],
    low_quality_extraction: [],
    needs_tagging: [],
    ready: [],
    junk_or_low_signal: [],
    missing_content: [],
    orphaned_or_inconsistent: [],
  };
}

function emptyAudit(): AuditSummary {
  const buckets = initBuckets();
  const counts = {} as Record<ReadinessBucket, number>;
  for (const k of Object.keys(buckets)) counts[k as ReadinessBucket] = 0;
  return {
    totalScanned: 0,
    buckets,
    counts,
    validationSummary: { missingRequiredTags: 0, activeButInconsistent: 0, operationalizedCount: 0, tagQualityIssueCount: 0 },
  };
}
