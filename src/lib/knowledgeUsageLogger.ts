/**
 * Knowledge Usage Logger
 *
 * Lightweight telemetry for tracking which knowledge items are actually
 * surfaced in prep, roleplay, and Dave responses.
 */

import { supabase } from '@/integrations/supabase/client';
import { createLogger } from '@/lib/logger';

const log = createLogger('KnowledgeUsage');

const TABLE = 'knowledge_usage_log' as any;

export type KnowledgeUsageEvent =
  | 'prep_surface'
  | 'roleplay_grounding'
  | 'dave_response_grounding'
  | 'roleplay_preview'
  | 'context_retrieval';

export interface UsageLogEntry {
  knowledge_item_id: string;
  source_resource_id?: string | null;
  event_type: KnowledgeUsageEvent;
  context_type?: string;
  chapter?: string;
  competitor?: string;
  stage?: string;
  persona?: string;
  account_name?: string;
  session_id?: string;
}

/**
 * Log usage of knowledge items. Fire-and-forget — never blocks the caller.
 */
export function logKnowledgeUsage(entries: UsageLogEntry[]): void {
  if (!entries.length) return;

  (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const rows = entries.map(e => ({
        user_id: user.id,
        knowledge_item_id: e.knowledge_item_id,
        source_resource_id: e.source_resource_id ?? null,
        event_type: e.event_type,
        context_type: e.context_type ?? null,
        chapter: e.chapter ?? null,
        competitor: e.competitor ?? null,
        stage: e.stage ?? null,
        persona: e.persona ?? null,
        account_name: e.account_name ?? null,
        session_id: e.session_id ?? null,
      }));

      const { error } = await supabase.from(TABLE).insert(rows);
      if (error) {
        log.warn('Failed to log usage', { error: error.message, count: rows.length });
      } else {
        log.debug('Logged knowledge usage', { count: rows.length, event: entries[0]?.event_type });
      }
    } catch (err) {
      log.warn('Usage logging error', { err });
    }
  })();
}

/**
 * Helper: build entries from an array of knowledge items for a given event.
 */
export function buildUsageEntries(
  items: Array<{ id: string; source_resource_id?: string | null; chapter?: string; competitor_name?: string | null }>,
  event_type: KnowledgeUsageEvent,
  context?: { context_type?: string; stage?: string; persona?: string; account_name?: string; competitor?: string; session_id?: string },
): UsageLogEntry[] {
  return items.map(item => ({
    knowledge_item_id: item.id,
    source_resource_id: item.source_resource_id,
    event_type,
    context_type: context?.context_type,
    chapter: item.chapter,
    competitor: item.competitor_name ?? context?.competitor,
    stage: context?.stage,
    persona: context?.persona,
    account_name: context?.account_name,
    session_id: context?.session_id,
  }));
}

// ── Usage Stats Query ────────────────────────────────────────

export interface KnowledgeUsageStats {
  knowledge_item_id: string;
  total_count: number;
  prep_count: number;
  roleplay_count: number;
  dave_count: number;
  last_used_at: string | null;
  contexts_used: string[];
}

/**
 * Fetch aggregated usage stats for all knowledge items.
 */
export async function getKnowledgeUsageStats(): Promise<Map<string, KnowledgeUsageStats>> {
  const { data } = await supabase
    .from(TABLE)
    .select('knowledge_item_id, event_type, context_type, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);

  const map = new Map<string, KnowledgeUsageStats>();

  for (const row of (data ?? []) as any[]) {
    const id = row.knowledge_item_id;
    if (!map.has(id)) {
      map.set(id, {
        knowledge_item_id: id,
        total_count: 0,
        prep_count: 0,
        roleplay_count: 0,
        dave_count: 0,
        last_used_at: null,
        contexts_used: [],
      });
    }
    const stats = map.get(id)!;
    stats.total_count++;

    if (row.event_type === 'prep_surface') stats.prep_count++;
    else if (row.event_type === 'roleplay_grounding' || row.event_type === 'roleplay_preview') stats.roleplay_count++;
    else if (row.event_type === 'dave_response_grounding') stats.dave_count++;

    if (!stats.last_used_at || row.created_at > stats.last_used_at) {
      stats.last_used_at = row.created_at;
    }
    if (row.context_type && !stats.contexts_used.includes(row.context_type)) {
      stats.contexts_used.push(row.context_type);
    }
  }

  return map;
}
