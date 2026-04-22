/**
 * Durable auto-heal audit logger.
 *
 * Persists invariant violations and auto-heal events to the
 * `lifecycle_audit_events` table so contradictions can be inspected
 * historically (not just via console.warn).
 *
 * Design notes:
 *  - Best-effort: failures must NEVER throw into the caller. Audit logging
 *    is observability, not business logic.
 *  - De-duplication: we batch identical events from a single audit pass so
 *    a 700-resource run with 30 violations writes 30 rows, not 30 × repeats.
 */

import { supabase } from '@/integrations/supabase/client';
import { createLogger } from './logger';

const log = createLogger('LifecycleAuditLog');

export type LifecycleViolationType =
  | 'ki_positive_blocked_empty_content'
  | 'ki_positive_blocked_no_extraction'
  | 'ki_positive_stage_pre_extraction'
  | 'pagination_truncation_suspected';

export interface LifecycleAuditEvent {
  resource_id: string;
  resource_title?: string | null;
  violation_type: LifecycleViolationType;
  before_blocked_reason?: string | null;
  after_blocked_reason?: string | null;
  before_canonical_state?: string | null;
  after_canonical_state?: string | null;
  ki_total: number;
  ki_active: number;
  ki_active_with_contexts: number;
  content_length?: number | null;
  auto_healed: boolean;
  details?: Record<string, unknown> | null;
}

/**
 * Persist a batch of audit events. Silent on failure.
 */
export async function recordLifecycleAuditEvents(
  events: LifecycleAuditEvent[],
): Promise<{ inserted: number; error?: string }> {
  if (events.length === 0) return { inserted: 0 };

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      log.warn('Skipping audit event persistence — no authenticated user');
      return { inserted: 0, error: 'no_user' };
    }

    const rows = events.map((e) => ({
      user_id: user.id,
      resource_id: e.resource_id,
      resource_title: e.resource_title ?? null,
      violation_type: e.violation_type,
      before_blocked_reason: e.before_blocked_reason ?? null,
      after_blocked_reason: e.after_blocked_reason ?? null,
      before_canonical_state: e.before_canonical_state ?? null,
      after_canonical_state: e.after_canonical_state ?? null,
      ki_total: e.ki_total,
      ki_active: e.ki_active,
      ki_active_with_contexts: e.ki_active_with_contexts,
      content_length: e.content_length ?? null,
      auto_healed: e.auto_healed,
      details: e.details ?? null,
    }));

    const { error } = await supabase
      .from('lifecycle_audit_events' as any)
      .insert(rows as any);

    if (error) {
      log.warn('Failed to persist lifecycle audit events', { error: error.message, count: rows.length });
      return { inserted: 0, error: error.message };
    }

    log.info('Persisted lifecycle audit events', { count: rows.length });
    return { inserted: rows.length };
  } catch (err) {
    log.warn('Unexpected error persisting lifecycle audit events', { error: err });
    return { inserted: 0, error: 'exception' };
  }
}

/**
 * Read recent audit events for the current user.
 */
export async function fetchRecentLifecycleAuditEvents(
  limit = 200,
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('lifecycle_audit_events' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      log.warn('Failed to fetch audit events', { error: error.message });
      return [];
    }
    return (data ?? []) as any[];
  } catch (err) {
    log.warn('Unexpected error fetching audit events', { error: err });
    return [];
  }
}
