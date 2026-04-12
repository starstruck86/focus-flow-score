/**
 * PendingWriteSync — Processes queued writes with idempotency.
 *
 * Runs on:
 * - App load (if online)
 * - 'online' event
 * - After each session turn write
 */

import { supabase } from '@/integrations/supabase/client';
import {
  getPendingWrites,
  removePendingWrite,
  incrementWriteRetry,
} from './sessionDurability';

let processing = false;

export async function processPendingWrites(): Promise<number> {
  if (processing) return 0;
  processing = true;

  try {
    const writes = getPendingWrites();
    if (writes.length === 0) return 0;

    let synced = 0;

    for (const write of writes) {
      try {
        if (write.action === 'insert') {
          // Use turnId as the row id for idempotency
          const payload = { ...write.data, id: write.data.id || write.turnId };
          const { error } = await supabase.from(write.table as any).upsert(payload, {
            onConflict: 'id',
            ignoreDuplicates: true,
          });
          if (error) throw error;
        } else if (write.action === 'update') {
          const { id, ...updates } = write.data;
          const { error } = await supabase.from(write.table as any).update(updates).eq('id', id);
          if (error) throw error;
        }
        removePendingWrite(write.turnId);
        synced++;
      } catch (err) {
        console.warn('[PendingWriteSync] Failed to sync write:', write.turnId, err);
        incrementWriteRetry(write.turnId);
      }
    }

    return synced;
  } finally {
    processing = false;
  }
}

// Auto-sync when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    processPendingWrites().then(count => {
      if (count > 0) console.log(`[PendingWriteSync] Synced ${count} pending writes`);
    });
  });

  // Also try on page load
  if (navigator.onLine) {
    setTimeout(() => processPendingWrites(), 3000);
  }
}
