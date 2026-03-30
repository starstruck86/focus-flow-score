/**
 * Resource deletion utilities — single, bulk, and Notion group deletes.
 * Cleans up related records before removing resources.
 */
import { supabase } from '@/integrations/supabase/client';
import { getRecoveryInvalidationKeys } from './manualRecoveryResolver';

const BATCH_SIZE = 20;
const RELATED_TABLES = ['enrichment_attempts', 'intelligence_units', 'knowledge_signals', 'resource_digests'] as const;

/**
 * Delete a single resource and its related records.
 */
export async function deleteResourceWithCleanup(resourceId: string): Promise<void> {
  await cleanupRelatedRecords([resourceId]);
  const { error } = await supabase.from('resources').delete().eq('id', resourceId);
  if (error) throw new Error(`Failed to delete resource: ${error.message}`);
}

/**
 * Delete multiple resources and their related records.
 */
export async function bulkDeleteResources(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
  if (ids.length === 0) return { deleted: 0, errors: [] };

  await cleanupRelatedRecords(ids);

  let deleted = 0;
  const errors: string[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('resources').delete().in('id', batch);
    if (error) errors.push(error.message);
    else deleted += batch.length;
  }

  return { deleted, errors };
}

/**
 * Clean up related records for a set of resource IDs.
 */
async function cleanupRelatedRecords(resourceIds: string[]): Promise<void> {
  for (const table of RELATED_TABLES) {
    try {
      for (let i = 0; i < resourceIds.length; i += BATCH_SIZE) {
        await (supabase as any).from(table).delete().in('resource_id', resourceIds.slice(i, i + BATCH_SIZE));
      }
    } catch {
      // Non-fatal — some tables may not have matching rows
    }
  }
}

/**
 * Returns all query keys that should be invalidated after resource deletion.
 */
export function getDeleteInvalidationKeys(): string[][] {
  return getRecoveryInvalidationKeys();
}
