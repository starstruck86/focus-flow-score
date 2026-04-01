/**
 * Resource deletion utilities — single, bulk, and Notion group deletes.
 * Cleans up related records before removing resources.
 */
import { supabase } from '@/integrations/supabase/client';
import { getRecoveryInvalidationKeys } from './manualRecoveryResolver';

const BATCH_SIZE = 20;

// Tables with resource_id column
const RELATED_TABLES_BY_RESOURCE_ID = [
  'enrichment_attempts',
  'intelligence_units',
  'knowledge_signals',
  'resource_digests',
  'audio_jobs',
  'batch_run_jobs',
  'pipeline_diagnoses',
  'stage_resources',
  'resource_usage_events',
] as const;

// Tables with source_resource_id column
const RELATED_TABLES_BY_SOURCE_RESOURCE_ID = [
  'knowledge_items',
  'asset_provenance',
  'knowledge_usage_log',
  'execution_templates',
] as const;

/**
 * Delete a single resource and its related records.
 */
export async function deleteResourceWithCleanup(resourceId: string): Promise<void> {
  console.log('[ResourceDelete] Deleting resource:', resourceId);
  await cleanupRelatedRecords([resourceId]);
  const { error } = await supabase.from('resources').delete().eq('id', resourceId);
  if (error) {
    console.error('[ResourceDelete] Failed:', error);
    throw new Error(`Failed to delete resource: ${error.message}`);
  }
  console.log('[ResourceDelete] Success:', resourceId);
}

/**
 * Delete multiple resources and their related records.
 */
export async function bulkDeleteResources(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
  if (ids.length === 0) return { deleted: 0, errors: [] };
  console.log('[ResourceDelete] Bulk deleting:', ids.length, 'resources');

  await cleanupRelatedRecords(ids);

  let deleted = 0;
  const errors: string[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('resources').delete().in('id', batch);
    if (error) {
      console.error('[ResourceDelete] Batch error:', error);
      errors.push(error.message);
    } else {
      deleted += batch.length;
    }
  }

  console.log('[ResourceDelete] Bulk result:', { deleted, errors: errors.length });
  return { deleted, errors };
}

/**
 * Clean up related records for a set of resource IDs.
 */
async function cleanupRelatedRecords(resourceIds: string[]): Promise<void> {
  // Clean tables with resource_id
  for (const table of RELATED_TABLES_BY_RESOURCE_ID) {
    try {
      for (let i = 0; i < resourceIds.length; i += BATCH_SIZE) {
        await (supabase as any).from(table).delete().in('resource_id', resourceIds.slice(i, i + BATCH_SIZE));
      }
    } catch {
      // Non-fatal — some tables may not have matching rows or lack delete RLS
    }
  }
  // Clean tables with source_resource_id
  for (const table of RELATED_TABLES_BY_SOURCE_RESOURCE_ID) {
    try {
      for (let i = 0; i < resourceIds.length; i += BATCH_SIZE) {
        await (supabase as any).from(table).delete().in('source_resource_id', resourceIds.slice(i, i + BATCH_SIZE));
      }
    } catch {
      // Non-fatal
    }
  }
}

/**
 * Returns all query keys that should be invalidated after resource deletion.
 */
export function getDeleteInvalidationKeys(): string[][] {
  return getRecoveryInvalidationKeys();
}
