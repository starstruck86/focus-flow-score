/**
 * Sales Brain — Ingestion Engine
 *
 * Responsible for:
 * - Detecting new items from registered sources
 * - Deduplicating against existing resources
 * - Creating resource entries with brain_status = 'pending'
 * - Logging ingestion events
 *
 * Phase 1: client-side with manual trigger / mock polling.
 * Future: edge function scheduled polling.
 */
import { supabase } from '@/integrations/supabase/client';
import type { SourceRegistryRow } from '@/data/source-registry';
import { updateSourceLastChecked } from '@/data/source-registry';

// ── Types ───────────────────────────────────────────────────────

export type BrainStatus = 'pending' | 'promoted' | 'ignored' | 'archived';

export interface IngestionResult {
  sourceId: string;
  sourceName: string;
  newItems: number;
  duplicatesSkipped: number;
  errors: string[];
}

export interface IncomingResource {
  id: string;
  title: string;
  file_url: string | null;
  resource_type: string;
  brain_status: BrainStatus;
  discovered_at: string;
  source_registry_id: string | null;
  external_id: string | null;
  dedupe_hash: string | null;
  tags: string[];
  created_at: string;
  enrichment_status: string;
  description: string | null;
}

// ── Dedupe ──────────────────────────────────────────────────────

function computeDedupeHash(url: string | null, title: string, externalId?: string): string {
  const raw = externalId || url || title;
  // Simple hash: lowercase, trim, strip tracking params
  let cleaned = raw.toLowerCase().trim();
  try {
    const u = new URL(cleaned);
    // strip common tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
     'si', 'ref', 'fbclid', 'gclid', 't', 'feature'].forEach(p => u.searchParams.delete(p));
    u.hash = '';
    cleaned = u.toString().replace(/\/+$/, '');
  } catch { /* not a URL, use as-is */ }
  return cleaned;
}

async function findExistingByHash(userId: string, hash: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from('resources')
    .select('id')
    .eq('user_id', userId)
    .eq('dedupe_hash', hash)
    .limit(1);
  return (data?.length || 0) > 0;
}

async function findExistingByUrl(userId: string, url: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from('resources')
    .select('id')
    .eq('user_id', userId)
    .eq('file_url', url)
    .limit(1);
  return (data?.length || 0) > 0;
}

// ── Ingest Single Item ──────────────────────────────────────────

export interface IngestionItem {
  title: string;
  url: string;
  externalId?: string;
  resourceType?: string;
  tags?: string[];
  description?: string;
}

export async function ingestItem(
  userId: string,
  sourceId: string,
  item: IngestionItem,
): Promise<'created' | 'duplicate' | 'error'> {
  try {
    const hash = computeDedupeHash(item.url, item.title, item.externalId);

    // Check duplicates
    const hashExists = await findExistingByHash(userId, hash);
    if (hashExists) return 'duplicate';

    if (item.url) {
      const urlExists = await findExistingByUrl(userId, item.url);
      if (urlExists) return 'duplicate';
    }

    // Insert as pending resource
    const { error } = await (supabase as any)
      .from('resources')
      .insert({
        user_id: userId,
        title: item.title,
        file_url: item.url || null,
        resource_type: item.resourceType || 'document',
        brain_status: 'pending',
        source_registry_id: sourceId,
        external_id: item.externalId || null,
        dedupe_hash: hash,
        discovered_at: new Date().toISOString(),
        tags: item.tags || [],
        description: item.description || null,
        content_status: 'file',
        enrichment_status: 'not_enriched',
      });

    if (error) {
      console.error('[SalesBrain] ingest error:', error);
      return 'error';
    }
    return 'created';
  } catch (e) {
    console.error('[SalesBrain] ingest exception:', e);
    return 'error';
  }
}

// ── Ingest From Source ──────────────────────────────────────────

export async function ingestFromSource(
  userId: string,
  source: SourceRegistryRow,
  items: IngestionItem[],
): Promise<IngestionResult> {
  const result: IngestionResult = {
    sourceId: source.id,
    sourceName: source.name,
    newItems: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  for (const item of items) {
    const status = await ingestItem(userId, source.id, item);
    if (status === 'created') result.newItems++;
    else if (status === 'duplicate') result.duplicatesSkipped++;
    else result.errors.push(`Failed to ingest: ${item.title}`);
  }

  // Update source check timestamps
  await updateSourceLastChecked(source.id, result.errors.length === 0).catch(() => {});

  return result;
}

// ── Incoming Queue ──────────────────────────────────────────────

export async function getIncomingResources(
  userId: string,
  status: BrainStatus = 'pending',
  limit = 50,
): Promise<IncomingResource[]> {
  const { data, error } = await (supabase as any)
    .from('resources')
    .select('id, title, file_url, resource_type, brain_status, discovered_at, source_registry_id, external_id, dedupe_hash, tags, created_at, enrichment_status, description')
    .eq('user_id', userId)
    .eq('brain_status', status)
    .order('discovered_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as IncomingResource[];
}

export async function updateBrainStatus(
  resourceId: string,
  status: BrainStatus,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('resources')
    .update({
      brain_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', resourceId);
  if (error) throw error;
}

export async function bulkUpdateBrainStatus(
  resourceIds: string[],
  status: BrainStatus,
): Promise<void> {
  if (!resourceIds.length) return;
  const { error } = await (supabase as any)
    .from('resources')
    .update({
      brain_status: status,
      updated_at: new Date().toISOString(),
    })
    .in('id', resourceIds);
  if (error) throw error;
}

// ── Manual Add ──────────────────────────────────────────────────

export async function manualIngestUrl(
  userId: string,
  url: string,
  title: string,
  sourceRegistryId?: string,
): Promise<'created' | 'duplicate' | 'error'> {
  return ingestItem(userId, sourceRegistryId || '', {
    title,
    url,
    resourceType: 'document',
  });
}
