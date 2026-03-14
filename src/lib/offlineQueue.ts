// Offline sync queue for Power Hour sessions (and future use)
import { supabase } from '@/integrations/supabase/client';

const QUEUE_KEY = 'quota-compass-offline-queue';

interface QueuedAction {
  id: string;
  table: string;
  action: 'insert' | 'update' | 'delete';
  data: Record<string, any>;
  timestamp: number;
  retries: number;
}

function getQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedAction[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('[OfflineQueue] localStorage write failed:', err);
  }
}

export function enqueueAction(table: string, action: 'insert' | 'update' | 'delete', data: Record<string, any>) {
  const queue = getQueue();
  queue.push({
    id: crypto.randomUUID(),
    table,
    action,
    data,
    timestamp: Date.now(),
    retries: 0,
  });
  saveQueue(queue);
}

export async function processQueue(): Promise<number> {
  const queue = getQueue();
  if (queue.length === 0) return 0;

  const remaining: QueuedAction[] = [];
  let processed = 0;

  for (const item of queue) {
    try {
      if (item.action === 'insert') {
        const { error } = await supabase.from(item.table as any).insert(item.data);
        if (error) throw error;
      } else if (item.action === 'update') {
        const { id, ...updates } = item.data;
        const { error } = await supabase.from(item.table as any).update(updates).eq('id', id);
        if (error) throw error;
      }
      processed++;
    } catch (err) {
      item.retries++;
      if (item.retries < 5) {
        remaining.push(item);
      }
      // Drop after 5 retries
    }
  }

  saveQueue(remaining);
  return processed;
}

// Auto-process queue when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    processQueue().then(count => {
      if (count > 0) {
        console.log(`Synced ${count} offline actions`);
      }
    });
  });

  // Also try on page load
  if (navigator.onLine) {
    setTimeout(() => processQueue(), 3000);
  }
}
