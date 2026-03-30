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

const log = createLogger('CanonicalLifecycle');

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
  | 'no_extraction'
  | 'no_activation'
  | 'missing_contexts'
  | 'stale_blocker_state'
  | 'none';

export const BLOCKED_LABELS: Record<BlockedReason, string> = {
  empty_content: 'Empty content',
  no_extraction: 'No extraction',
  no_activation: 'No activation',
  missing_contexts: 'Missing contexts',
  stale_blocker_state: 'Stale blocker state',
  none: 'None',
};

// ── Per-resource canonical status ──────────────────────────

export interface CanonicalResourceStatus {
  resource_id: string;
  title: string;
  canonical_stage: LifecycleStage;
  is_enriched: boolean;
  is_content_backed: boolean;
  knowledge_item_count: number;
  active_ki_count: number;
  active_ki_with_context_count: number;
  blocked_reason: BlockedReason;
  last_transition_at: string | null;
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
    no_extraction: number;
    no_activation: number;
    missing_contexts: number;
    stale_blocker_state: number;
  };
  resources: CanonicalResourceStatus[];
}

// ── Constants ──────────────────────────────────────────────

const MIN_CONTENT_LENGTH = 200;
const ENRICHED_STATUSES = ['enriched', 'deep_enriched', 'verified'];

// ── Core: derive canonical stage ───────────────────────────

export function deriveCanonicalStage(
  resource: {
    content_length?: number | null;
    manual_content_present?: boolean | null;
    tags?: string[] | null;
    enrichment_status?: string | null;
  },
  ki: { total: number; active: number; activeWithContexts: number },
): LifecycleStage {
  const contentLength = resource.content_length ?? 0;
  const isContentBacked = contentLength >= MIN_CONTENT_LENGTH || resource.manual_content_present === true;

  if (!isContentBacked) return 'uploaded';

  const tags = resource.tags ?? [];
  const dims = new Set(tags.filter(t => t.includes(':')).map(t => t.split(':')[0]));
  const hasRequiredTags = dims.has('skill') || dims.has('context');

  if (!hasRequiredTags) return 'content_ready';
  if (ki.total === 0) return 'tagged';
  if (ki.active === 0) return 'knowledge_extracted';
  if (ki.activeWithContexts === 0) return 'activated';
  return 'operationalized';
}

// ── Core: derive blocked reason ────────────────────────────

export function deriveBlockedReason(
  resource: {
    content_length?: number | null;
    content?: string | null;
    manual_content_present?: boolean | null;
    enrichment_status?: string | null;
    manual_input_required?: boolean | null;
    recovery_queue_bucket?: string | null;
    failure_reason?: string | null;
  },
  ki: { total: number; active: number; activeWithContexts: number },
): BlockedReason {
  const contentLength = resource.content_length ?? 0;
  const actualLength = resource.content?.length ?? 0;
  const isContentBacked = Math.max(contentLength, actualLength) >= MIN_CONTENT_LENGTH || resource.manual_content_present === true;

  // Stale blocker: content-backed but stuck in failed/blocked state
  if (isContentBacked && (
    resource.manual_input_required === true ||
    resource.enrichment_status === 'failed' ||
    resource.recovery_queue_bucket === 'manual_input' ||
    resource.recovery_queue_bucket === 'blocked'
  )) {
    return 'stale_blocker_state';
  }

  // Empty content (stale content_length)
  if (contentLength > 300 && actualLength < 100) {
    return 'empty_content';
  }

  if (!isContentBacked) return 'empty_content';

  // Has content but no KI
  if (ki.total === 0 && ENRICHED_STATUSES.includes(resource.enrichment_status ?? '')) {
    return 'no_extraction';
  }

  // Has KI but none active
  if (ki.total > 0 && ki.active === 0) return 'no_activation';

  // Active but no contexts
  if (ki.active > 0 && ki.activeWithContexts === 0) return 'missing_contexts';

  return 'none';
}

// ── Main audit function ────────────────────────────────────

export async function auditCanonicalLifecycle(): Promise<LifecycleSummary> {
  const { data: resources, error: rErr } = await supabase
    .from('resources')
    .select('id, title, content, content_length, enrichment_status, tags, updated_at, manual_content_present, manual_input_required, recovery_queue_bucket, failure_reason')
    .order('updated_at', { ascending: false });

  if (rErr || !resources) {
    log.error('Canonical lifecycle query failed', { error: rErr });
    return emptySummary();
  }

  const { data: kiRows } = await supabase
    .from('knowledge_items' as any)
    .select('source_resource_id, active, applies_to_contexts');

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
      no_extraction: 0,
      no_activation: 0,
      missing_contexts: 0,
      stale_blocker_state: 0,
    },
    resources: [],
  };

  for (const r of resources as any[]) {
    const ki = kiMap.get(r.id) ?? { total: 0, active: 0, activeWithContexts: 0 };
    const stage = deriveCanonicalStage(r, ki);
    const blocked = deriveBlockedReason(r, ki);
    const isEnriched = ENRICHED_STATUSES.includes(r.enrichment_status ?? '');
    const isContentBacked = (r.content_length ?? 0) >= MIN_CONTENT_LENGTH || r.manual_content_present === true;

    const status: CanonicalResourceStatus = {
      resource_id: r.id,
      title: r.title ?? '(untitled)',
      canonical_stage: stage,
      is_enriched: isEnriched,
      is_content_backed: isContentBacked,
      knowledge_item_count: ki.total,
      active_ki_count: ki.active,
      active_ki_with_context_count: ki.activeWithContexts,
      blocked_reason: blocked,
      last_transition_at: r.updated_at ?? null,
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
      summary.blocked[blocked]++;
    }
  }

  log.info('Canonical lifecycle audit complete', {
    total: summary.total_resources,
    enriched: summary.enriched,
    content_ready: summary.content_ready,
    with_knowledge: summary.with_knowledge,
    activated: summary.activated,
    operationalized: summary.operationalized,
    blocked: summary.blocked,
  });

  return summary;
}

function emptySummary(): LifecycleSummary {
  return {
    total_resources: 0, enriched: 0, content_ready: 0,
    with_knowledge: 0, activated: 0, operationalized: 0,
    blocked: { empty_content: 0, no_extraction: 0, no_activation: 0, missing_contexts: 0, stale_blocker_state: 0 },
    resources: [],
  };
}
