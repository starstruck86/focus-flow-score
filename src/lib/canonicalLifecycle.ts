/**
 * Canonical Resource Lifecycle — SINGLE SOURCE OF TRUTH
 *
 * Every resource has exactly ONE canonical stage:
 *   uploaded → content_ready → tagged → knowledge_extracted → activated → operationalized
 *
 * A resource is "operationalized" if and only if it has at least 1 active
 * knowledge item with non-empty applies_to_contexts.
 *
 * NO OTHER FILE may compute lifecycle stage or operationalized status independently.
 * All tabs (Learn, Library, Enrich, Resource Readiness) must use this module.
 */

import { supabase } from '@/integrations/supabase/client';
import { createLogger } from './logger';
import { auditImpossibleExtractionStates, recordReconciliationMetrics } from './postExtractionReconciliation';
import { fetchAllPages } from './supabasePagination';

const log = createLogger('CanonicalLifecycle');

// ── Placeholder detection ──────────────────────────────────

const PLACEHOLDER_PATTERNS = [
  /^\[Pending parse:\s*.+\]$/,
  /^\[Pending parse\]$/i,
  /^\[placeholder\]$/i,
];

export function isPlaceholderContent(content: string | null | undefined): boolean {
  if (!content) return true;
  const trimmed = content.trim();
  if (trimmed.length === 0) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

// ── Lifecycle stages ───────────────────────────────────────

export type LifecycleStage =
  | 'uploaded'
  | 'content_ready'
  | 'tagged'
  | 'knowledge_extracted'
  | 'activated'
  | 'operationalized';

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  'uploaded', 'content_ready', 'tagged', 'knowledge_extracted', 'activated', 'operationalized',
];

export const STAGE_LABELS: Record<LifecycleStage, string> = {
  uploaded: 'Uploaded',
  content_ready: 'Content Ready',
  tagged: 'Tagged',
  knowledge_extracted: 'Knowledge Extracted',
  activated: 'Activated',
  operationalized: 'Operationalized',
};

export const STAGE_COLORS: Record<LifecycleStage, string> = {
  uploaded: 'text-muted-foreground',
  content_ready: 'text-amber-600',
  tagged: 'text-primary',
  knowledge_extracted: 'text-blue-600',
  activated: 'text-emerald-600',
  operationalized: 'text-emerald-600',
};

// ── Blocked reasons ────────────────────────────────────────

export type BlockedReason =
  | 'empty_content'
  | 'placeholder_content'
  | 'auth_capture_incomplete'
  | 'no_extraction'
  | 'no_activation'
  | 'missing_contexts'
  | 'stale_blocker_state'
  | 'none';

export const BLOCKED_LABELS: Record<BlockedReason, string> = {
  empty_content: 'Empty content',
  placeholder_content: 'PDF found but content not captured during ingest',
  auth_capture_incomplete: 'Auth-gated content — re-import with authentication required',
  no_extraction: 'Transcript content exists — extraction not yet run',
  no_activation: 'No activation',
  missing_contexts: 'Missing contexts',
  stale_blocker_state: 'Stale blocker state',
  none: 'None',
};

// ── Per-resource canonical status ──────────────────────────

export interface CanonicalResourceStatus {
  resource_id: string;
  title: string;
  resource_type: string | null;
  file_url: string | null;
  canonical_stage: LifecycleStage;
  is_enriched: boolean;
  is_content_backed: boolean;
  knowledge_item_count: number;
  active_ki_count: number;
  active_ki_with_context_count: number;
  blocked_reason: BlockedReason;
  last_transition_at: string | null;
  active_job_status: string | null;
}

// ── Lifecycle summary ──────────────────────────────────────

export interface LifecycleSummary {
  total_resources: number;
  enriched: number;
  content_ready: number;
  with_knowledge: number;
  activated: number;
  operationalized: number;
  blocked: {
    empty_content: number;
    placeholder_content: number;
    no_extraction: number;
    no_activation: number;
    missing_contexts: number;
    stale_blocker_state: number;
  };
  /** Failure-class observability counters */
  failure_classes: {
    transcript_extraction_not_triggered: number;
    pdf_parse_incomplete: number;
    auth_capture_incomplete: number;
    enriched_no_extraction: number;
    extraction_ready_not_queued: number;
    placeholder_enriched_contradiction: number;
  };
  resources: CanonicalResourceStatus[];
}

// ── Constants ──────────────────────────────────────────────

const MIN_CONTENT_LENGTH = 200;
const ENRICHED_STATUSES = ['enriched', 'deep_enriched', 'verified'];
const QUERY_PAGE_SIZE = 1000;

async function fetchKnowledgeItemsForResources(_resourceIds: string[]) {
  // Don't filter by resource IDs — RLS scopes to the user already.
  // Using .in() with 700+ UUIDs exceeds PostgREST URL length limits.
  if (_resourceIds.length === 0) return [] as any[];

  const rows: any[] = [];

  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const to = from + QUERY_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('knowledge_items' as any)
      .select('source_resource_id, active, applies_to_contexts')
      .range(from, to);

    if (error) {
      log.error('Knowledge item lifecycle query failed', { error, from, to });
      break;
    }

    const page = (data ?? []) as any[];
    rows.push(...page);

    if (page.length < QUERY_PAGE_SIZE) break;
  }

  return rows;
}

// ── Core: derive canonical stage ───────────────────────────

export function deriveCanonicalStage(
  resource: {
    content_length?: number | null;
    content?: string | null;
    manual_content_present?: boolean | null;
    tags?: string[] | null;
    enrichment_status?: string | null;
  },
  ki: { total: number; active: number; activeWithContexts: number },
): LifecycleStage {
  const contentLength = resource.content_length ?? 0;
  // Placeholder content is NOT real content
  if (isPlaceholderContent(resource.content ?? null) && !resource.manual_content_present) {
    return 'uploaded';
  }
  const isContentBacked = contentLength >= MIN_CONTENT_LENGTH || resource.manual_content_present === true;

  if (!isContentBacked) return 'uploaded';

  const tags = resource.tags ?? [];
  const dims = new Set(tags.filter(t => t.includes(':')).map(t => t.split(':')[0]));
  const hasRequiredTags = dims.has('skill') || dims.has('context');

  // IMPORTANT INVARIANT: once KIs exist, the resource has moved past "needs extraction"
  // even if legacy resource-level tags are missing or stale.
  if (ki.total > 0) {
    if (ki.active === 0) return 'knowledge_extracted';
    if (ki.activeWithContexts === 0) return 'activated';
    return 'operationalized';
  }

  if (!hasRequiredTags) return 'content_ready';
  return 'tagged';
}

// ── Core: derive blocked reason ────────────────────────────

export function deriveBlockedReason(
  resource: {
    content_length?: number | null;
    /**
     * OPTIONAL: a short prefix (~300 chars) used ONLY for placeholder/auth-gate
     * detection. NEVER treated as the full content. Length is NOT compared to
     * `content_length`. Pass null/undefined when prefix is unavailable.
     */
    content_prefix?: string | null;
    /** @deprecated Legacy alias for content_prefix. Treated as prefix-only. */
    content?: string | null;
    manual_content_present?: boolean | null;
    enrichment_status?: string | null;
    manual_input_required?: boolean | null;
    recovery_queue_bucket?: string | null;
    failure_reason?: string | null;
    file_url?: string | null;
  },
  ki: { total: number; active: number; activeWithContexts: number },
): BlockedReason {
  const contentLength = resource.content_length ?? 0;
  // Prefix is the ~300-char head used purely for placeholder detection.
  // It is NEVER compared to contentLength (that produced false empty_content).
  const prefix = resource.content_prefix ?? resource.content ?? '';
  const prefixLength = prefix.length;
  const hasFullContent = contentLength >= MIN_CONTENT_LENGTH || resource.manual_content_present === true;

  // ── KI-based truth ALWAYS wins ────────────────────────────
  // If KIs exist, the resource has real extracted content by definition.
  // Never report empty_content / no_extraction in this branch.
  if (ki.total > 0) {
    if (ki.active === 0) return 'no_activation';
    if (ki.activeWithContexts === 0) return 'missing_contexts';
    return 'none';
  }

  // ── Placeholder / auth-gated detection (prefix-only) ──────
  if (isPlaceholderContent(prefix) && !resource.manual_content_present) {
    if (prefixLength > 0 && !resource.file_url) {
      return 'auth_capture_incomplete';
    }
    if (prefixLength > 0) return 'placeholder_content';
    // Empty prefix + no full content = truly empty
    if (!hasFullContent) return 'empty_content';
  }

  // ── Stale blocker: full content present but stuck in failed bucket ──
  if (hasFullContent && (
    resource.manual_input_required === true ||
    resource.enrichment_status === 'failed' ||
    resource.recovery_queue_bucket === 'manual_input' ||
    resource.recovery_queue_bucket === 'blocked'
  )) {
    return 'stale_blocker_state';
  }

  if (!hasFullContent) return 'empty_content';

  // Has real content, no KIs yet → extraction has not produced output.
  return 'no_extraction';
}

// ── Main audit function ────────────────────────────────────

export async function auditCanonicalLifecycle(): Promise<LifecycleSummary> {
  // Fetch resource metadata (without full content to avoid 17MB+ payloads).
  // Paginated so libraries above the 1000-row PostgREST cap are not silently truncated.
  let resources: any[];
  try {
    resources = await fetchAllPages<any>((from, to) =>
      supabase
        .from('resources')
        .select('id, title, content_length, enrichment_status, tags, updated_at, manual_content_present, manual_input_required, recovery_queue_bucket, failure_reason, resource_type, file_url, active_job_status')
        .order('updated_at', { ascending: false })
        .range(from, to),
    );
  } catch (rErr) {
    log.error('Canonical lifecycle query failed', { error: rErr });
    return emptySummary();
  }

  // Fetch only content prefixes (first 300 chars) for placeholder detection
  const { data: { user } } = await supabase.auth.getUser();
  const contentPrefixMap = new Map<string, string>();
  if (user) {
    const { data: prefixes } = await supabase.rpc('get_resource_content_prefixes', { p_user_id: user.id });
    if (prefixes) {
      for (const p of prefixes as any[]) {
        contentPrefixMap.set(p.id, p.content_prefix ?? '');
      }
    }
  }

  const resourceIds = (resources as any[]).map((r) => r.id).filter(Boolean);
  const kiRows = await fetchKnowledgeItemsForResources(resourceIds);

  // Build KI map
  const kiMap = new Map<string, { total: number; active: number; activeWithContexts: number }>();
  for (const ki of (kiRows ?? []) as any[]) {
    if (!ki.source_resource_id) continue;
    const entry = kiMap.get(ki.source_resource_id) ?? { total: 0, active: 0, activeWithContexts: 0 };
    entry.total++;
    if (ki.active) {
      entry.active++;
      if (Array.isArray(ki.applies_to_contexts) && ki.applies_to_contexts.length > 0) {
        entry.activeWithContexts++;
      }
    }
    kiMap.set(ki.source_resource_id, entry);
  }

  const summary: LifecycleSummary = {
    total_resources: resources.length,
    enriched: 0,
    content_ready: 0,
    with_knowledge: 0,
    activated: 0,
    operationalized: 0,
    blocked: {
      empty_content: 0,
      placeholder_content: 0,
      no_extraction: 0,
      no_activation: 0,
      missing_contexts: 0,
      stale_blocker_state: 0,
    },
    failure_classes: {
      transcript_extraction_not_triggered: 0,
      pdf_parse_incomplete: 0,
      auth_capture_incomplete: 0,
      enriched_no_extraction: 0,
      extraction_ready_not_queued: 0,
      placeholder_enriched_contradiction: 0,
    },
    resources: [],
  };

  for (const r of resources as any[]) {
    // Inject content prefix as `content_prefix` (NOT `content`) so derive
    // helpers cannot mistake a 300-char head for the full document body.
    const contentPrefix = contentPrefixMap.get(r.id) ?? '';
    (r as any).content_prefix = contentPrefix;
    // Keep `content` populated for legacy placeholder detection in
    // deriveCanonicalStage, but derivation logic must never measure its length.
    (r as any).content = contentPrefix;

    const ki = kiMap.get(r.id) ?? { total: 0, active: 0, activeWithContexts: 0 };
    const stage = deriveCanonicalStage(r, ki);
    const blocked = deriveBlockedReason(r, ki);

    // Invariant guard — warn on impossible KI/blocked combinations.
    if (ki.total > 0 && (blocked === 'empty_content' || blocked === 'no_extraction')) {
      // eslint-disable-next-line no-console
      console.warn('[canonicalLifecycle] INVALID STATE', {
        resource_id: r.id,
        title: r.title,
        ki_total: ki.total,
        blocked,
      });
    }
    const isEnriched = ENRICHED_STATUSES.includes(r.enrichment_status ?? '');
    const isContentBacked = (r.content_length ?? 0) >= MIN_CONTENT_LENGTH || r.manual_content_present === true;

    const status: CanonicalResourceStatus = {
      resource_id: r.id,
      title: r.title ?? '(untitled)',
      resource_type: r.resource_type ?? null,
      file_url: r.file_url ?? null,
      canonical_stage: stage,
      is_enriched: isEnriched,
      is_content_backed: isContentBacked,
      knowledge_item_count: ki.total,
      active_ki_count: ki.active,
      active_ki_with_context_count: ki.activeWithContexts,
      blocked_reason: blocked,
      last_transition_at: r.updated_at ?? null,
      active_job_status: r.active_job_status ?? null,
    };

    summary.resources.push(status);

    // Aggregate counts
    if (isEnriched) summary.enriched++;
    if (isContentBacked) summary.content_ready++;
    if (ki.total > 0) summary.with_knowledge++;
    if (ki.active > 0) summary.activated++;
    if (stage === 'operationalized') summary.operationalized++;

    // Blocked aggregation
    if (blocked !== 'none') {
      if (blocked in summary.blocked) {
        (summary.blocked as any)[blocked]++;
      }
    }

    // Failure-class observability
    const rType = r.resource_type ?? '';
    const isTranscriptType = ['transcript', 'podcast', 'audio'].includes(rType);
    const hasRealContent = !isPlaceholderContent(contentPrefix) && (r.content_length ?? 0) >= MIN_CONTENT_LENGTH;
    const isPlaceholder = isPlaceholderContent(contentPrefix) && contentPrefix.length > 0;

    if (isTranscriptType && hasRealContent && ki.total === 0) {
      summary.failure_classes.transcript_extraction_not_triggered++;
    }
    if (isPlaceholder && (r as any).file_url) {
      summary.failure_classes.pdf_parse_incomplete++;
    }
    if (isPlaceholder && !(r as any).file_url) {
      summary.failure_classes.auth_capture_incomplete++;
    }
    if (!isTranscriptType && hasRealContent && isEnriched && ki.total === 0) {
      summary.failure_classes.enriched_no_extraction++;
    }
    if (hasRealContent && !isEnriched && ki.total === 0 && !isPlaceholder) {
      summary.failure_classes.extraction_ready_not_queued++;
    }
  }

  // ── Impossible-state audit (auto-correction layer) ───────
  const violations = auditImpossibleExtractionStates(summary.resources);
  if (violations.length > 0) {
    // Auto-correct: patch the in-memory summary so downstream consumers never see impossible states
    for (const v of violations) {
      const res = summary.resources.find(r => r.resource_id === v.resourceId);
      if (!res) continue;
      if (v.violation === 'ki_count_positive_but_blocked_no_extraction') {
        // Correct blocked_reason from no_extraction → none (or no_activation if active=0)
        if (res.active_ki_count === 0) {
          res.blocked_reason = 'no_activation';
          summary.blocked.no_extraction--;
          summary.blocked.no_activation = (summary.blocked.no_activation ?? 0) + 1;
        } else {
          res.blocked_reason = 'none';
          summary.blocked.no_extraction--;
        }
      }
      if (v.violation === 'ki_count_positive_but_needs_extraction') {
        // Correct stage from tagged → knowledge_extracted (at minimum)
        res.canonical_stage = res.active_ki_count > 0
          ? (res.active_ki_with_context_count > 0 ? 'operationalized' : 'activated')
          : 'knowledge_extracted';
      }
    }
    log.warn('Auto-corrected impossible extraction states in lifecycle summary', {
      corrected: violations.length,
    });
  }

  // Record reconciliation metrics for observability
  recordReconciliationMetrics({
    totalAudited: summary.total_resources,
    impossibleStatesFound: violations.length,
    impossibleStatesCorrected: violations.length,
    cacheInvalidations: 0,
    timestamp: new Date().toISOString(),
  });

  log.info('Canonical lifecycle audit complete', {
    total: summary.total_resources,
    enriched: summary.enriched,
    content_ready: summary.content_ready,
    with_knowledge: summary.with_knowledge,
    activated: summary.activated,
    operationalized: summary.operationalized,
    blocked: summary.blocked,
    impossibleStatesCorrected: violations.length,
  });

  return summary;
}

function emptySummary(): LifecycleSummary {
  return {
    total_resources: 0, enriched: 0, content_ready: 0,
    with_knowledge: 0, activated: 0, operationalized: 0,
    blocked: { empty_content: 0, placeholder_content: 0, no_extraction: 0, no_activation: 0, missing_contexts: 0, stale_blocker_state: 0 },
    failure_classes: {
      transcript_extraction_not_triggered: 0,
      pdf_parse_incomplete: 0,
      auth_capture_incomplete: 0,
      enriched_no_extraction: 0,
      extraction_ready_not_queued: 0,
      placeholder_enriched_contradiction: 0,
    },
    resources: [],
  };
}
