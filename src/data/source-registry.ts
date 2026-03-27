/**
 * Data access layer for source_registry table.
 */
import { supabase } from '@/integrations/supabase/client';

export type SourceType =
  | 'youtube_playlist'
  | 'youtube_channel'
  | 'podcast_rss'
  | 'web_article'
  | 'manual_note'
  | 'competitor_url';

export interface SourceRegistryRow {
  id: string;
  user_id: string;
  name: string;
  source_type: SourceType;
  url: string | null;
  external_id: string | null;
  polling_enabled: boolean;
  poll_interval_hours: number;
  last_checked_at: string | null;
  last_successful_sync_at: string | null;
  trust_weight: number;
  status: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type SourceRegistryInsert = Omit<SourceRegistryRow, 'id' | 'created_at' | 'updated_at' | 'last_checked_at' | 'last_successful_sync_at'>;

// ── Queries ─────────────────────────────────────────────────────

export async function getSources(userId: string): Promise<SourceRegistryRow[]> {
  const { data, error } = await (supabase as any)
    .from('source_registry')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as SourceRegistryRow[];
}

export async function getActiveSources(userId: string): Promise<SourceRegistryRow[]> {
  const { data, error } = await (supabase as any)
    .from('source_registry')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as SourceRegistryRow[];
}

export async function upsertSource(
  source: SourceRegistryInsert,
): Promise<SourceRegistryRow> {
  const { data, error } = await (supabase as any)
    .from('source_registry')
    .upsert({ ...source, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data as SourceRegistryRow;
}

export async function insertSource(
  source: SourceRegistryInsert,
): Promise<SourceRegistryRow> {
  const { data, error } = await (supabase as any)
    .from('source_registry')
    .insert(source)
    .select()
    .single();
  if (error) throw error;
  return data as SourceRegistryRow;
}

export async function updateSourceStatus(id: string, status: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('source_registry')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function updateSourceLastChecked(id: string, success: boolean): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, any> = {
    last_checked_at: now,
    updated_at: now,
  };
  if (success) update.last_successful_sync_at = now;

  const { error } = await (supabase as any)
    .from('source_registry')
    .update(update)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteSource(id: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('source_registry')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
