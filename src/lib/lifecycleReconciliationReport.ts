/**
 * Lifecycle Reconciliation Report
 *
 * Admin/debug audit that walks the FULL resource library and emits one
 * authoritative row per resource showing canonical state, blocked reason,
 * KI counts, content metrics, and any invariant violations.
 *
 * Also reconstructs what the OLD prefix-based logic would have computed,
 * so we can quantify the delta the resolver fix produced.
 */

import { supabase } from '@/integrations/supabase/client';
import { fetchAllPages } from './supabasePagination';
import {
  resolveResourceState,
  auditResourceInvariants,
  type ResourceState,
} from './resourceStateResolver';
import { deriveBlockedReason, type BlockedReason } from './canonicalLifecycle';
import { runKiPaginationHealthcheck, type KiPaginationHealth } from './kiPaginationHealthcheck';
import { recordLifecycleAuditEvents, type LifecycleAuditEvent } from './lifecycleAuditLog';
import { createLogger } from './logger';

const log = createLogger('LifecycleReconciliationReport');

// ── Types ──────────────────────────────────────────────────

export interface ReconciliationRow {
  resource_id: string;
  title: string;
  canonical_state: ResourceState;
  blocked_reason: BlockedReason;
  content_length: number;
  ki_total: number;
  ki_active: number;
  ki_active_with_contexts: number;
  invariant_violations: string[];
  /** What the OLD prefix-based path would have produced. */
  legacy_blocked_reason: BlockedReason;
  legacy_canonical_state: ResourceState;
}

export interface ReconciliationReport {
  generated_at: string;
  total_resources: number;
  rows: ReconciliationRow[];
  ki_pagination_health: KiPaginationHealth;
  /** Validation summary for the user. */
  summary: {
    canonical_state_after: Record<ResourceState, number>;
    canonical_state_before: Record<ResourceState, number>;
    blocked_reason_after: Record<BlockedReason, number>;
    blocked_reason_before: Record<BlockedReason, number>;
    invariant_violations_total: number;
    invariant_violations_unique_resources: number;
    /** Top blocked resources with full explanation. */
    top_blocked: Array<{
      resource_id: string;
      title: string;
      canonical_state: ResourceState;
      blocked_reason: BlockedReason;
      content_length: number;
      ki_total: number;
      ki_active: number;
      ki_active_with_contexts: number;
      explanation: string;
    }>;
    audit_log_persisted: number;
    audit_log_error?: string;
  };
}

// ── Constants ──────────────────────────────────────────────

const MIN_CONTENT_LENGTH = 500;
const EMPTY_STATE: Record<ResourceState, number> = {
  no_content: 0,
  ready_for_extraction: 0,
  extracted: 0,
  needs_activation: 0,
  needs_context: 0,
  ready: 0,
  blocked: 0,
};

const EMPTY_BLOCKED: Record<BlockedReason, number> = {
  empty_content: 0,
  placeholder_content: 0,
  auth_capture_incomplete: 0,
  no_extraction: 0,
  no_activation: 0,
  missing_contexts: 0,
  stale_blocker_state: 0,
  none: 0,
};

// ── Legacy reconstruction ──────────────────────────────────

/**
 * Reconstruct what the OLD (buggy) prefix-based path would have produced.
 *
 * The pre-fix bug: `r.content` was set to the 300-char PREFIX, then
 * compared against `content_length`. Any resource with content_length > 300
 * would still be flagged empty_content if the prefix was small/empty AND
 * KI truth was not given precedence.
 *
 * We approximate the legacy behaviour by:
 *  - Treating prefix length as the only "content seen"
 *  - NOT applying the KI-wins invariant
 */
function reconstructLegacyState(
  resource: { content_length?: number | null; manual_content_present?: boolean | null },
  prefix: string,
  ki: { total: number; active: number; activeWithContexts: number },
): { state: ResourceState; blocked: BlockedReason } {
  const prefixLen = prefix.length;
  const hasContentByPrefix = prefixLen >= MIN_CONTENT_LENGTH || resource.manual_content_present === true;

  // Legacy path did NOT honor KI truth — KIs could coexist with empty_content.
  let blocked: BlockedReason;
  if (!hasContentByPrefix) {
    blocked = 'empty_content';
  } else if (ki.total === 0) {
    blocked = 'no_extraction';
  } else if (ki.active === 0) {
    blocked = 'no_activation';
  } else if (ki.activeWithContexts === 0) {
    blocked = 'missing_contexts';
  } else {
    blocked = 'none';
  }

  // Legacy state derivation (also prefix-based)
  let state: ResourceState;
  if (!hasContentByPrefix) {
    state = 'no_content';
  } else if (ki.total === 0) {
    state = 'ready_for_extraction';
  } else if (ki.active === 0) {
    state = 'extracted';
  } else if (ki.activeWithContexts === 0) {
    state = 'needs_context';
  } else {
    state = 'ready';
  }

  return { state, blocked };
}

// ── Main entrypoint ────────────────────────────────────────

export async function buildLifecycleReconciliationReport(): Promise<ReconciliationReport> {
  log.info('Starting lifecycle reconciliation report');

  // 1. Fetch resources (paginated)
  let resources: any[] = [];
  try {
    resources = await fetchAllPages<any>((from, to) =>
      supabase
        .from('resources')
        .select('id, title, content_length, manual_content_present, manual_input_required, recovery_queue_bucket, enrichment_status, failure_reason, file_url, updated_at')
        .order('updated_at', { ascending: false })
        .range(from, to),
    );
  } catch (err) {
    log.error('Failed to fetch resources', { error: err });
  }

  // 2. Fetch content prefixes (only used for legacy reconstruction now)
  const { data: { user } } = await supabase.auth.getUser();
  const prefixMap = new Map<string, string>();
  if (user) {
    try {
      const { data: prefixes } = await supabase.rpc('get_resource_content_prefixes', { p_user_id: user.id });
      for (const p of (prefixes ?? []) as any[]) {
        prefixMap.set(p.id, p.content_prefix ?? '');
      }
    } catch (err) {
      log.warn('Failed to fetch content prefixes', { error: err });
    }
  }

  // 3. KI pagination healthcheck (also returns the KI map)
  const kiHealth = await runKiPaginationHealthcheck();
  const kiMap = kiHealth.ki_map;

  // 4. Build per-resource rows
  const rows: ReconciliationRow[] = [];
  const stateAfter: Record<ResourceState, number> = { ...EMPTY_STATE };
  const stateBefore: Record<ResourceState, number> = { ...EMPTY_STATE };
  const blockedAfter: Record<BlockedReason, number> = { ...EMPTY_BLOCKED };
  const blockedBefore: Record<BlockedReason, number> = { ...EMPTY_BLOCKED };
  const auditEvents: LifecycleAuditEvent[] = [];
  const violatingResourceIds = new Set<string>();
  let totalViolations = 0;

  for (const r of resources) {
    const ki = kiMap.get(r.id) ?? { total: 0, active: 0, activeWithContexts: 0 };
    const prefix = prefixMap.get(r.id) ?? '';

    const canonical_state = resolveResourceState(
      {
        content_length: r.content_length,
        manual_content_present: r.manual_content_present,
      },
      ki,
    );

    const blocked_reason = deriveBlockedReason(
      {
        content_length: r.content_length,
        content_prefix: prefix,
        manual_content_present: r.manual_content_present,
        enrichment_status: r.enrichment_status,
        manual_input_required: r.manual_input_required,
        recovery_queue_bucket: r.recovery_queue_bucket,
        failure_reason: r.failure_reason,
        file_url: r.file_url,
      },
      ki,
    );

    const violations = auditResourceInvariants(
      { id: r.id, content_length: r.content_length, manual_content_present: r.manual_content_present },
      ki,
      blocked_reason,
    );
    if (violations.length > 0) {
      totalViolations += violations.length;
      violatingResourceIds.add(r.id);
    }

    const legacy = reconstructLegacyState(
      { content_length: r.content_length, manual_content_present: r.manual_content_present },
      prefix,
      ki,
    );

    // If the legacy path would have flagged empty_content / no_extraction
    // while KIs exist, that's a healed case — record it.
    const wasHealed =
      ki.total > 0 &&
      (legacy.blocked === 'empty_content' || legacy.blocked === 'no_extraction') &&
      blocked_reason !== legacy.blocked;

    if (wasHealed) {
      auditEvents.push({
        resource_id: r.id,
        resource_title: r.title ?? null,
        violation_type: legacy.blocked === 'empty_content'
          ? 'ki_positive_blocked_empty_content'
          : 'ki_positive_blocked_no_extraction',
        before_blocked_reason: legacy.blocked,
        after_blocked_reason: blocked_reason,
        before_canonical_state: legacy.state,
        after_canonical_state: canonical_state,
        ki_total: ki.total,
        ki_active: ki.active,
        ki_active_with_contexts: ki.activeWithContexts,
        content_length: r.content_length ?? 0,
        auto_healed: true,
        details: { source: 'reconciliation_report' },
      });
    }

    rows.push({
      resource_id: r.id,
      title: r.title ?? '(untitled)',
      canonical_state,
      blocked_reason,
      content_length: r.content_length ?? 0,
      ki_total: ki.total,
      ki_active: ki.active,
      ki_active_with_contexts: ki.activeWithContexts,
      invariant_violations: violations,
      legacy_blocked_reason: legacy.blocked,
      legacy_canonical_state: legacy.state,
    });

    stateAfter[canonical_state]++;
    stateBefore[legacy.state]++;
    blockedAfter[blocked_reason]++;
    blockedBefore[legacy.blocked]++;
  }

  // 5. Persist auto-heal events durably
  const auditResult = await recordLifecycleAuditEvents(auditEvents);

  // 6. Build top-blocked explanations
  const topBlocked = rows
    .filter((r) => r.blocked_reason !== 'none' || r.canonical_state === 'blocked')
    .sort((a, b) => {
      // Prioritize content-rich + ki-rich resources still showing as blocked
      const score = (x: ReconciliationRow) =>
        (x.ki_total > 0 ? 1000 : 0) + (x.content_length >= MIN_CONTENT_LENGTH ? 100 : 0) + x.ki_total;
      return score(b) - score(a);
    })
    .slice(0, 25)
    .map((r) => ({
      resource_id: r.resource_id,
      title: r.title,
      canonical_state: r.canonical_state,
      blocked_reason: r.blocked_reason,
      content_length: r.content_length,
      ki_total: r.ki_total,
      ki_active: r.ki_active,
      ki_active_with_contexts: r.ki_active_with_contexts,
      explanation: explainBlocked(r),
    }));

  return {
    generated_at: new Date().toISOString(),
    total_resources: resources.length,
    rows,
    ki_pagination_health: { ...kiHealth, ki_map: undefined as any }, // strip map from output
    summary: {
      canonical_state_after: stateAfter,
      canonical_state_before: stateBefore,
      blocked_reason_after: blockedAfter,
      blocked_reason_before: blockedBefore,
      invariant_violations_total: totalViolations,
      invariant_violations_unique_resources: violatingResourceIds.size,
      top_blocked: topBlocked,
      audit_log_persisted: auditResult.inserted,
      audit_log_error: auditResult.error,
    },
  };
}

function explainBlocked(r: ReconciliationRow): string {
  const parts: string[] = [];
  switch (r.blocked_reason) {
    case 'empty_content':
      parts.push(`content_length=${r.content_length} is below threshold (${MIN_CONTENT_LENGTH}) and no manual content present`);
      break;
    case 'placeholder_content':
      parts.push('Prefix matches a placeholder pattern (e.g. "[Pending parse]"). Re-import or run extraction.');
      break;
    case 'auth_capture_incomplete':
      parts.push('Resource appears auth-gated — no file_url and prefix is placeholder. Re-import with credentials.');
      break;
    case 'no_extraction':
      parts.push(`Has ${r.content_length} chars of real content but 0 knowledge items extracted. Run extraction.`);
      break;
    case 'no_activation':
      parts.push(`${r.ki_total} extracted KIs exist but none are active. Review and activate.`);
      break;
    case 'missing_contexts':
      parts.push(`${r.ki_active} active KIs but none have applies_to_contexts. Tag them with contexts.`);
      break;
    case 'stale_blocker_state':
      parts.push('Has real content but is still flagged as failed/manual_input. Clear the stale blocker.');
      break;
    case 'none':
      parts.push(r.canonical_state === 'blocked' ? 'hard_blocked is true.' : 'Not blocked.');
      break;
  }
  if (r.invariant_violations.length > 0) {
    parts.push(`Invariant violations: ${r.invariant_violations.length}`);
  }
  return parts.join(' ');
}

// ── CSV export ─────────────────────────────────────────────

export function reportToCsv(report: ReconciliationReport): string {
  const headers = [
    'resource_id',
    'title',
    'canonical_state',
    'blocked_reason',
    'content_length',
    'ki_total',
    'ki_active',
    'ki_active_with_contexts',
    'invariant_violations',
    'legacy_blocked_reason',
    'legacy_canonical_state',
  ];
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of report.rows) {
    lines.push([
      r.resource_id,
      r.title,
      r.canonical_state,
      r.blocked_reason,
      r.content_length,
      r.ki_total,
      r.ki_active,
      r.ki_active_with_contexts,
      r.invariant_violations.join(' | '),
      r.legacy_blocked_reason,
      r.legacy_canonical_state,
    ].map(escape).join(','));
  }
  return lines.join('\n');
}
