/**
 * Hook for managing podcast import queue with Realtime updates.
 * Supports batch tracking, per-item pipeline stages, and live KI counts.
 * Provides approve/reject/reprocess workflows.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface QueueItem {
  id: string;
  episode_url: string;
  episode_title: string;
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'skipped';
  error_message: string | null;
  resource_id: string | null;
  attempts: number;
  processed_at: string | null;
  platform: string | null;
  transcript_status: string | null;
  failure_type: string | null;
  content_validation: Record<string, any> | null;
  ki_status: string | null;
  ki_count: number;
  transcript_preview: string | null;
  transcript_length: number;
  transcript_section_count: number;
  review_reason: string | null;
  raw_transcript: string | null;
  structured_transcript: string | null;
  // Source identity fields
  original_episode_url: string | null;
  resolved_url: string | null;
  audio_url: string | null;
  host_platform: string | null;
  episode_description: string | null;
  artwork_url: string | null;
  show_title: string | null;
  resolution_method: string | null;
  metadata_status: string | null;
  // Batch & pipeline fields
  batch_id: string | null;
  pipeline_stage: string | null;
}

export interface QueueStats {
  total: number;
  queued: number;
  processing: number;
  complete: number;
  failed: number;
  skipped: number;
  totalKIs: number;
  readyForKI: number;
  awaitingApproval: number;
  rejected: number;
}

export interface BatchInfo {
  id: string;
  total_resources: number;
  succeeded: number;
  failed: number;
  skipped: number;
  started_at: string;
  ended_at: string | null;
}

/** Pipeline stage labels for UI */
export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  resolving: 'Resolving URL…',
  transcribing: 'Transcribing…',
  transcript_ready: 'Transcript ready',
  preprocessing: 'Preprocessing…',
  saving_resource: 'Saving resource…',
  generating_kis: 'Generating KIs…',
  complete: 'Complete',
  failed: 'Failed',
};

/** Approval guardrail check */
export function canApproveItem(item: QueueItem): { allowed: boolean; reason: string | null } {
  if (item.failure_type) {
    return { allowed: false, reason: `Has failure: ${item.failure_type}` };
  }
  if (item.transcript_length < 1000) {
    return { allowed: false, reason: `Transcript too short (${item.transcript_length} chars, need 1000+)` };
  }
  if (item.transcript_section_count < 3) {
    return { allowed: false, reason: `Too few sections (${item.transcript_section_count}, need 3+)` };
  }
  const cv = item.content_validation;
  if (cv?.preprocess_issues && cv.preprocess_issues.length > 0) {
    return { allowed: false, reason: `Preprocess issues: ${cv.preprocess_issues.join(', ')}` };
  }
  return { allowed: true, reason: null };
}

function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("spotify.com") || u.includes("open.spotify")) return "spotify";
  if (u.includes("apple.com/podcast") || u.includes("podcasts.apple")) return "apple";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("anchor.fm") || u.includes("podcasters.spotify")) return "anchor";
  if (u.includes("buzzsprout.com")) return "buzzsprout";
  if (u.includes("libsyn.com")) return "libsyn";
  if (u.includes("pdst.fm") || u.includes("megaphone.fm") || u.includes("traffic.megaphone")) return "direct_audio";
  if (u.endsWith(".mp3") || u.endsWith(".m4a") || u.endsWith(".wav")) return "direct_audio";
  if (u.match(/\.(mp3|m4a|ogg|wav)(\?|$)/)) return "direct_audio";
  if (u.includes("/feed") || u.includes("rss") || u.includes(".xml")) return "rss_direct";
  return "unknown";
}

export function usePodcastQueue() {
  const { user } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingKIs, setGeneratingKIs] = useState<Set<string>>(new Set());
  const [activeBatch, setActiveBatch] = useState<BatchInfo | null>(null);

  // ── Load existing queue items on mount ──
  const loadItems = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('podcast_import_queue')
      .select('id, episode_url, episode_title, status, error_message, resource_id, attempts, processed_at, platform, transcript_status, failure_type, content_validation, ki_status, ki_count, transcript_preview, transcript_length, transcript_section_count, review_reason, raw_transcript, structured_transcript, original_episode_url, resolved_url, audio_url, host_platform, episode_description, artwork_url, show_title, resolution_method, metadata_status, batch_id, pipeline_stage')
      .eq('user_id', user.id)
      .in('status', ['queued', 'processing', 'complete', 'failed', 'skipped'])
      .order('created_at', { ascending: true });
    if (data) setItems(data as QueueItem[]);
  }, [user]);

  // ── Load active batch info ──
  const loadBatch = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from('batch_runs')
      .select('id, total_resources, succeeded, failed, skipped, started_at, ended_at')
      .eq('user_id', user.id)
      .eq('action_type', 'podcast_import')
      .is('ended_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data?.length) setActiveBatch(data[0]);
    else setActiveBatch(null);
  }, [user]);

  // ── Subscribe to realtime updates ──
  useEffect(() => {
    if (!user) return;
    loadItems();
    loadBatch();

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
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'batch_runs',
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.action_type === 'podcast_import') {
            setActiveBatch(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadItems, loadBatch]);

  // ── Stats ──
  const stats: QueueStats = useMemo(() => {
    const s: QueueStats = { total: items.length, queued: 0, processing: 0, complete: 0, failed: 0, skipped: 0, totalKIs: 0, readyForKI: 0, awaitingApproval: 0, rejected: 0 };
    items.forEach(i => {
      if (i.status in s) s[i.status as keyof Omit<QueueStats, 'total' | 'totalKIs' | 'readyForKI' | 'awaitingApproval' | 'rejected'>]++;
      s.totalKIs += i.ki_count || 0;
      if (i.ki_status === 'ready_for_review' && i.resource_id) s.readyForKI++;
      if (i.ki_status === 'awaiting_approval' && i.resource_id) s.awaitingApproval++;
      if (i.ki_status === 'rejected') s.rejected++;
    });
    return s;
  }, [items]);

  const isActive = stats.queued > 0 || stats.processing > 0;
  const isDone = stats.total > 0 && !isActive;

  // ── Generate KIs for a single queue item (manual) ──
  const generateKIs = useCallback(async (queueItemId: string) => {
    const item = items.find(i => i.id === queueItemId);
    if (!item?.resource_id || !user) return;

    setGeneratingKIs(prev => new Set(prev).add(queueItemId));

    try {
      await (supabase as any)
        .from('podcast_import_queue')
        .update({ ki_status: 'extracting', pipeline_stage: 'generating_kis', updated_at: new Date().toISOString() })
        .eq('id', queueItemId);

      const { data, error } = await supabase.functions.invoke('batch-actionize', {
        body: { batchSize: 1, resource_id: item.resource_id, user_id: user.id },
      });

      if (error) throw error;

      const kiCount = data?.knowledge_created || 0;
      await (supabase as any)
        .from('podcast_import_queue')
        .update({ ki_status: 'extracted', ki_count: kiCount, pipeline_stage: 'complete', updated_at: new Date().toISOString() })
        .eq('id', queueItemId);

      toast.success(`Generated ${kiCount} knowledge item${kiCount !== 1 ? 's' : ''}`);
    } catch (err: any) {
      console.error('KI generation failed:', err);
      await (supabase as any)
        .from('podcast_import_queue')
        .update({
          ki_status: 'ki_failed',
          error_message: `KI extraction failed: ${err.message?.slice(0, 200) || 'Unknown error'}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', queueItemId);
      toast.error('KI extraction failed');
    } finally {
      setGeneratingKIs(prev => {
        const next = new Set(prev);
        next.delete(queueItemId);
        return next;
      });
    }
  }, [items, user]);

  // ── Generate KIs for all ready items (bulk) ──
  const generateAllKIs = useCallback(async () => {
    const readyItems = items.filter(i => i.ki_status === 'ready_for_review' && i.resource_id);
    if (readyItems.length === 0) return;
    toast.info(`Generating KIs for ${readyItems.length} episode${readyItems.length !== 1 ? 's' : ''}...`);
    for (const item of readyItems) {
      await generateKIs(item.id);
    }
  }, [items, generateKIs]);

  // ── Enqueue episodes (creates batch + items) ──
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

    try {
      // Create parent batch
      const { data: batch } = await (supabase as any)
        .from('batch_runs')
        .insert({
          user_id: user.id,
          action_type: 'podcast_import',
          total_resources: episodes.length,
          batch_size: episodes.length,
          concurrency: 3,
        })
        .select('id')
        .single();

      const batchId = batch?.id || null;
      if (batchId) setActiveBatch({ id: batchId, total_resources: episodes.length, succeeded: 0, failed: 0, skipped: 0, started_at: new Date().toISOString(), ended_at: null });

      const rows = episodes.map(ep => ({
        user_id: user.id,
        source_registry_id: sourceRegistryId,
        batch_id: batchId,
        episode_url: ep.url,
        episode_title: ep.title,
        episode_guest: ep.guest || null,
        episode_published: ep.published ? new Date(ep.published).toISOString() : null,
        episode_duration: ep.duration || null,
        show_author: showAuthor || null,
        status: 'queued' as const,
        pipeline_stage: 'queued',
        platform: detectPlatform(ep.url),
      }));

      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        await (supabase as any).from('podcast_import_queue').insert(batch);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  // ── Cancel remaining queued items ──
  const cancelRemaining = useCallback(async () => {
    if (!user) return;
    await (supabase as any)
      .from('podcast_import_queue')
      .update({ status: 'skipped', pipeline_stage: 'failed' })
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
    setActiveBatch(null);
  }, [user]);

  // ── Approve transcript ──
  const approveTranscript = useCallback(async (queueItemId: string) => {
    if (!user) return;
    const item = items.find(i => i.id === queueItemId);
    if (!item) return;
    const check = canApproveItem(item);
    if (!check.allowed) {
      toast.error(`Cannot approve: ${check.reason}`);
      return;
    }
    await (supabase as any)
      .from('podcast_import_queue')
      .update({ ki_status: 'ready_for_review', review_reason: null, updated_at: new Date().toISOString() })
      .eq('id', queueItemId);
    toast.success('Transcript approved — ready for KI generation');
  }, [user, items]);

  // ── Approve all awaiting transcripts ──
  const approveAllTranscripts = useCallback(async () => {
    if (!user) return;
    const awaiting = items.filter(i => i.ki_status === 'awaiting_approval' && i.resource_id);
    const approvable = awaiting.filter(i => canApproveItem(i).allowed);
    if (approvable.length === 0) {
      toast.error('No transcripts pass approval guardrails');
      return;
    }
    const ids = approvable.map(i => i.id);
    await (supabase as any)
      .from('podcast_import_queue')
      .update({ ki_status: 'ready_for_review', review_reason: null, updated_at: new Date().toISOString() })
      .in('id', ids);
    toast.success(`${approvable.length} transcript${approvable.length !== 1 ? 's' : ''} approved`);
  }, [user, items]);

  // ── Reject transcript ──
  const rejectTranscript = useCallback(async (queueItemId: string, reason?: string) => {
    if (!user) return;
    await (supabase as any)
      .from('podcast_import_queue')
      .update({ ki_status: 'rejected', review_reason: reason || null, updated_at: new Date().toISOString() })
      .eq('id', queueItemId);
    toast.success('Transcript rejected');
  }, [user]);

  // ── Reprocess Structure ──
  const reprocessStructure = useCallback(async (queueItemId: string) => {
    if (!user) return;
    const item = items.find(i => i.id === queueItemId);
    if (!item?.raw_transcript) {
      toast.error('No raw transcript available for reprocessing');
      return;
    }
    await (supabase as any)
      .from('podcast_import_queue')
      .update({
        ki_status: 'pending', transcript_status: 'transcript_ready', failure_type: null,
        error_message: null, review_reason: null, structured_transcript: null,
        transcript_preview: null, transcript_length: 0, transcript_section_count: 0,
        status: 'queued', pipeline_stage: 'queued', updated_at: new Date().toISOString(),
      })
      .eq('id', queueItemId);
    toast.success('Queued for structure reprocessing');
  }, [user, items]);

  // ── Reprocess Full ──
  const reprocessFull = useCallback(async (queueItemId: string) => {
    if (!user) return;
    await (supabase as any)
      .from('podcast_import_queue')
      .update({
        ki_status: 'pending', transcript_status: 'pending', failure_type: null,
        error_message: null, review_reason: null, raw_transcript: null,
        structured_transcript: null, transcript_preview: null, transcript_length: 0,
        transcript_section_count: 0, content_validation: null,
        status: 'queued', pipeline_stage: 'queued', attempts: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', queueItemId);
    toast.success('Queued for full reprocessing');
  }, [user]);

  return {
    items,
    stats,
    isActive,
    isDone,
    loading,
    generatingKIs,
    activeBatch,
    enqueue,
    cancelRemaining,
    clearDone,
    generateKIs,
    generateAllKIs,
    approveTranscript,
    approveAllTranscripts,
    rejectTranscript,
    reprocessStructure,
    reprocessFull,
  };
}
