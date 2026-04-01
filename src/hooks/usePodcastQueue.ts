/**
 * Hook for managing podcast import queue with Realtime updates.
 * Inserts episodes into podcast_import_queue and subscribes to live progress.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface QueueItem {
  id: string;
  episode_url: string;
  episode_title: string;
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'skipped';
  error_message: string | null;
  resource_id: string | null;
  attempts: number;
  processed_at: string | null;
}

export interface QueueStats {
  total: number;
  queued: number;
  processing: number;
  complete: number;
  failed: number;
  skipped: number;
}

export function usePodcastQueue() {
  const { user } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Load existing queue items on mount ──
  const loadItems = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('podcast_import_queue')
      .select('id, episode_url, episode_title, status, error_message, resource_id, attempts, processed_at')
      .eq('user_id', user.id)
      .in('status', ['queued', 'processing', 'complete', 'failed', 'skipped'])
      .order('created_at', { ascending: true });
    if (data) setItems(data as QueueItem[]);
  }, [user]);

  // ── Subscribe to realtime updates ──
  useEffect(() => {
    if (!user) return;
    loadItems();

    const channel = supabase
      .channel('podcast-queue-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'podcast_import_queue',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setItems(prev => [...prev, payload.new as QueueItem]);
          } else if (payload.eventType === 'UPDATE') {
            setItems(prev =>
              prev.map(i => i.id === (payload.new as QueueItem).id ? payload.new as QueueItem : i)
            );
          } else if (payload.eventType === 'DELETE') {
            setItems(prev => prev.filter(i => i.id !== (payload.old as any).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadItems]);

  // ── Stats ──
  const stats: QueueStats = useMemo(() => {
    const s = { total: items.length, queued: 0, processing: 0, complete: 0, failed: 0, skipped: 0 };
    items.forEach(i => {
      if (i.status in s) s[i.status as keyof Omit<QueueStats, 'total'>]++;
    });
    return s;
  }, [items]);

  const isActive = stats.queued > 0 || stats.processing > 0;
  const isDone = stats.total > 0 && !isActive;

  // ── Enqueue episodes ──
  const enqueue = useCallback(async (
    episodes: Array<{
      url: string;
      title: string;
      guest?: string | null;
      published?: string;
      duration?: string;
    }>,
    sourceRegistryId: string | null,
    showAuthor?: string,
  ) => {
    if (!user || episodes.length === 0) return;
    setLoading(true);

    const rows = episodes.map(ep => ({
      user_id: user.id,
      source_registry_id: sourceRegistryId,
      episode_url: ep.url,
      episode_title: ep.title,
      episode_guest: ep.guest || null,
      episode_published: ep.published ? new Date(ep.published).toISOString() : null,
      episode_duration: ep.duration || null,
      show_author: showAuthor || null,
      status: 'queued' as const,
    }));

    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await (supabase as any).from('podcast_import_queue').insert(batch);
    }

    setLoading(false);
  }, [user]);

  // ── Cancel remaining queued items ──
  const cancelRemaining = useCallback(async () => {
    if (!user) return;
    await (supabase as any)
      .from('podcast_import_queue')
      .update({ status: 'skipped' })
      .eq('user_id', user.id)
      .eq('status', 'queued');
  }, [user]);

  // ── Clear completed/failed items ──
  const clearDone = useCallback(async () => {
    if (!user) return;
    await (supabase as any)
      .from('podcast_import_queue')
      .delete()
      .eq('user_id', user.id)
      .in('status', ['complete', 'failed', 'skipped']);
    setItems(prev => prev.filter(i => !['complete', 'failed', 'skipped'].includes(i.status)));
  }, [user]);

  return {
    items,
    stats,
    isActive,
    isDone,
    loading,
    enqueue,
    cancelRemaining,
    clearDone,
  };
}
