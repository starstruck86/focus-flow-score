/**
 * Controlled bulk resource ingestion engine with batching, progress,
 * retry, pause/cancel, duplicate prevention, and quality guardrails.
 */
import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────
export type IngestionItemStage =
  | 'queued'
  | 'checking_duplicate'
  | 'fetching'
  | 'classifying'
  | 'saving'
  | 'enriching'
  | 'complete'
  | 'skipped'
  | 'failed'
  | 'needs_review';

export type IngestionJobStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type ReprocessMode = 'skip_processed' | 'metadata_only' | 'summary_only' | 'full_reprocess';

export interface IngestionItem {
  id: string;
  url: string;
  title: string;
  stage: IngestionItemStage;
  error?: string;
  /** YouTube-specific metadata */
  videoId?: string;
  channel?: string;
  publishDate?: string;
  duration?: string;
  /** Set if resource already exists in library */
  existingResourceId?: string;
}

export interface IngestionState {
  status: IngestionJobStatus;
  batchSize: number;
  reprocessMode: ReprocessMode;
  totalItems: number;
  currentBatch: number;
  totalBatches: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  reviewCount: number;
  items: IngestionItem[];
}

const INTER_ITEM_DELAY = 1200;
const INTER_BATCH_DELAY = 2500;
const MIN_CONTENT_LENGTH = 200;
const EMPTY_TRANSCRIPT_THRESHOLD = 80;

// ── Canonical identity ─────────────────────────────────────
export type SourceType = 'youtube' | 'webpage' | 'file' | 'unknown';

export interface CanonicalSource {
  canonical_url: string;
  source_type: SourceType;
  source_id: string | null;
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.has('v')) return u.searchParams.get('v');
    if (u.pathname.includes('/embed/')) return u.pathname.split('/embed/')[1]?.split(/[?/]/)[0] || null;
    if (u.pathname.includes('/shorts/')) return u.pathname.split('/shorts/')[1]?.split(/[?/]/)[0] || null;
  } catch {}
  return null;
}

function detectSourceType(url: string): SourceType {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    return 'webpage';
  } catch {
    return 'unknown';
  }
}

/**
 * Build a canonical source identity from a raw URL.
 * YouTube: canonical URL is always https://www.youtube.com/watch?v=VIDEO_ID
 * Other: strip tracking params, hash, trailing slashes.
 */
function canonicalize(rawUrl: string): CanonicalSource {
  const sourceType = detectSourceType(rawUrl);
  const videoId = extractYouTubeVideoId(rawUrl);

  if (sourceType === 'youtube' && videoId) {
    return {
      canonical_url: `https://www.youtube.com/watch?v=${videoId}`,
      source_type: 'youtube',
      source_id: videoId,
    };
  }

  // General URL normalization
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    // Strip tracking / noise params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
     'si', 'feature', 'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
    ].forEach(p => u.searchParams.delete(p));
    // Remove trailing slash
    let canonical = u.toString();
    if (canonical.endsWith('/') && u.pathname !== '/') canonical = canonical.slice(0, -1);
    return { canonical_url: canonical, source_type: sourceType, source_id: null };
  } catch {
    return { canonical_url: rawUrl.trim(), source_type: 'unknown', source_id: null };
  }
}

// ── Failure classification ─────────────────────────────────
function classifyError(err: unknown, context: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('429') || lower.includes('rate limit')) return 'Rate limited — wait and retry';
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) return 'Authentication/access error';
  if (lower.includes('private') || lower.includes('restricted')) return 'Private or restricted content';
  if (lower.includes('unavailable') || lower.includes('not found') || lower.includes('404')) return 'Content not found or unavailable';
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) return 'Request timed out';
  if (lower.includes('parse') || lower.includes('json') || lower.includes('syntax')) return 'Parse/format error';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('econnrefused')) return 'Network error';
  if (lower.includes('transcript')) return 'Transcript unavailable';
  if (lower.includes('embed')) return 'Embedding failed';

  return `${context}: ${msg.slice(0, 120)}`;
}

// ── Hook ───────────────────────────────────────────────────
export function useBulkIngestion() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [state, setState] = useState<IngestionState>({
    status: 'idle',
    batchSize: 10,
    reprocessMode: 'skip_processed',
    totalItems: 0,
    currentBatch: 0,
    totalBatches: 0,
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    reviewCount: 0,
    items: [],
  });

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const runningRef = useRef(false);

  const setBatchSize = useCallback((size: number) => {
    setState(prev => ({ ...prev, batchSize: size }));
  }, []);

  const setReprocessMode = useCallback((mode: ReprocessMode) => {
    setState(prev => ({ ...prev, reprocessMode: mode }));
  }, []);

  const updateItem = (id: string, patch: Partial<IngestionItem>) => {
    setState(prev => ({
      ...prev,
      items: prev.items.map(i => (i.id === id ? { ...i, ...patch } : i)),
    }));
  };

  // ── Duplicate check ────────────────────────────────────
  async function checkDuplicate(url: string, videoId: string | null): Promise<string | null> {
    if (!user) return null;
    const normalizedUrl = normalizeUrl(url);

    // Check by file_url (covers both direct URL and YouTube URLs)
    const { data } = await supabase
      .from('resources')
      .select('id')
      .eq('user_id', user.id)
      .eq('file_url', normalizedUrl)
      .limit(1);

    if (data?.length) return data[0].id;

    // YouTube-specific: also check by video ID in URL patterns
    if (videoId) {
      const { data: ytMatch } = await supabase
        .from('resources')
        .select('id, file_url')
        .eq('user_id', user.id)
        .ilike('file_url', `%${videoId}%`)
        .limit(1);
      if (ytMatch?.length) return ytMatch[0].id;
    }

    return null;
  }

  // ── Process single item ────────────────────────────────
  async function processItem(item: IngestionItem, reprocessMode: ReprocessMode): Promise<void> {
    if (!user) throw new Error('Not authenticated');

    // Step 1: Duplicate check
    updateItem(item.id, { stage: 'checking_duplicate' });
    const existingId = await checkDuplicate(item.url, item.videoId || null);

    if (existingId) {
      if (reprocessMode === 'skip_processed') {
        updateItem(item.id, { stage: 'skipped', existingResourceId: existingId });
        return;
      }
      // For other modes, we'll update the existing resource
      updateItem(item.id, { existingResourceId: existingId });
    }

    // Step 2: Classify
    updateItem(item.id, { stage: 'classifying' });
    let classification: any;
    try {
      const { data, error } = await trackedInvoke<any>('classify-resource', {
        body: { url: item.url },
        componentName: 'BulkIngestion',
      });
      if (error) throw new Error(error.message || 'Classification failed');
      classification = data;
      if (!classification?.title || classification.title === 'Untitled') {
        classification = { ...classification, title: item.title || item.url };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Classification failed';
      if (msg.includes('rate limit') || msg.includes('429')) {
        throw new Error('Rate limited — try again in a moment');
      }
      throw new Error(`Classification: ${msg}`);
    }

    // Step 3: Save or update
    updateItem(item.id, { stage: 'saving' });
    const normalizedUrl = normalizeUrl(item.url);
    const contentToStore = classification.scraped_content?.length > 50
      ? classification.scraped_content
      : `[External Link: ${normalizedUrl}]`;
    const contentStatus = contentToStore.startsWith('[External Link:') ? 'placeholder' : 'enriched';

    let resourceId: string;

    if (existingId && reprocessMode !== 'skip_processed') {
      // Update existing
      const updatePayload: Record<string, any> = {};
      if (reprocessMode === 'full_reprocess' || reprocessMode === 'metadata_only') {
        updatePayload.title = classification.title;
        updatePayload.description = classification.description;
        updatePayload.resource_type = classification.resource_type;
        updatePayload.tags = classification.tags;
      }
      if (reprocessMode === 'full_reprocess' || reprocessMode === 'summary_only') {
        updatePayload.content = contentToStore;
        updatePayload.content_status = contentStatus;
      }
      if (Object.keys(updatePayload).length > 0) {
        await supabase.from('resources').update(updatePayload).eq('id', existingId);
      }
      resourceId = existingId;
    } else {
      // Resolve folder
      let folderId: string | null = null;
      if (classification.top_folder) {
        const { data: folders } = await supabase
          .from('resource_folders')
          .select('id')
          .eq('user_id', user.id)
          .is('parent_id', null)
          .ilike('name', classification.top_folder)
          .limit(1);
        folderId = folders?.[0]?.id || null;
        if (!folderId) {
          const { data: newF } = await supabase
            .from('resource_folders')
            .insert({ name: classification.top_folder, user_id: user.id })
            .select('id')
            .single();
          folderId = newF?.id || null;
        }
      }

      const { data: resource, error } = await supabase
        .from('resources')
        .insert({
          user_id: user.id,
          title: classification.title,
          description: classification.description,
          resource_type: classification.resource_type,
          tags: classification.tags,
          folder_id: folderId,
          file_url: normalizedUrl,
          content: contentToStore,
          content_status: contentStatus,
        } as any)
        .select('id')
        .single();
      if (error) throw new Error(`Save failed: ${error.message}`);
      resourceId = resource.id;
    }

    // Step 4: Quality check
    if (contentStatus === 'enriched' && contentToStore.length < MIN_CONTENT_LENGTH) {
      updateItem(item.id, { stage: 'needs_review' });
      return;
    }

    // Step 5: Enrich if placeholder
    if (contentStatus === 'placeholder') {
      updateItem(item.id, { stage: 'enriching' });
      try {
        await trackedInvoke<any>('enrich-resource-content', {
          body: { resource_id: resourceId },
          componentName: 'BulkIngestion',
          timeoutMs: 60_000,
        });
      } catch {
        // Non-fatal — resource saved, enrichment can be retried later
      }
    }

    updateItem(item.id, { stage: 'complete' });
  }

  // ── Main start ─────────────────────────────────────────
  const start = useCallback(async (
    items: Array<{ url: string; title: string; videoId?: string; channel?: string; publishDate?: string; duration?: string }>,
    options?: { retryFailedOnly?: boolean }
  ) => {
    if (runningRef.current || !user) return;
    runningRef.current = true;
    cancelRef.current = false;
    pauseRef.current = false;

    let ingestionItems: IngestionItem[];

    if (options?.retryFailedOnly) {
      // Only retry failed items from previous run
      ingestionItems = state.items.map(i =>
        i.stage === 'failed'
          ? { ...i, stage: 'queued' as const, error: undefined }
          : i
      );
    } else {
      ingestionItems = items.map((item, idx) => ({
        id: `ingest-${idx}-${Date.now()}`,
        url: item.url,
        title: item.title,
        stage: 'queued' as const,
        videoId: item.videoId || extractYouTubeVideoId(item.url) || undefined,
        channel: item.channel,
        publishDate: item.publishDate,
        duration: item.duration,
      }));
    }

    const queue = ingestionItems.filter(i => i.stage === 'queued');
    const batchSize = state.batchSize;
    const totalBatches = Math.max(1, Math.ceil(queue.length / batchSize));
    const priorSuccess = ingestionItems.filter(i => i.stage === 'complete').length;
    const priorSkipped = ingestionItems.filter(i => i.stage === 'skipped').length;

    setState(prev => ({
      ...prev,
      status: 'running',
      totalItems: ingestionItems.length,
      currentBatch: 0,
      totalBatches,
      processedCount: priorSuccess + priorSkipped,
      successCount: priorSuccess,
      failedCount: 0,
      skippedCount: priorSkipped,
      reviewCount: 0,
      items: ingestionItems,
    }));

    let successCount = priorSuccess;
    let failedCount = 0;
    let skippedCount = priorSkipped;
    let reviewCount = 0;
    let processedCount = priorSuccess + priorSkipped;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      if (cancelRef.current) {
        setState(prev => ({ ...prev, status: 'cancelled' }));
        runningRef.current = false;
        return;
      }

      while (pauseRef.current) {
        setState(prev => ({ ...prev, status: 'paused' }));
        await new Promise(r => setTimeout(r, 500));
        if (cancelRef.current) {
          setState(prev => ({ ...prev, status: 'cancelled' }));
          runningRef.current = false;
          return;
        }
      }

      const batchStart = batchIdx * batchSize;
      const batch = queue.slice(batchStart, batchStart + batchSize);

      setState(prev => ({ ...prev, status: 'running', currentBatch: batchIdx + 1 }));

      for (const item of batch) {
        if (cancelRef.current) {
          setState(prev => ({ ...prev, status: 'cancelled' }));
          runningRef.current = false;
          return;
        }
        while (pauseRef.current) {
          await new Promise(r => setTimeout(r, 500));
          if (cancelRef.current) {
            setState(prev => ({ ...prev, status: 'cancelled' }));
            runningRef.current = false;
            return;
          }
        }

        try {
          await processItem(item, state.reprocessMode);
          processedCount++;

          // Read back the item's final stage
          const finalItem = state.items.find(i => i.id === item.id);
          // We need to read from the latest state — use a helper
          setState(prev => {
            const updated = prev.items.find(i => i.id === item.id);
            const stage = updated?.stage || 'complete';
            const newState = { ...prev, processedCount };
            if (stage === 'complete') { successCount++; newState.successCount = successCount; }
            else if (stage === 'skipped') { skippedCount++; newState.skippedCount = skippedCount; }
            else if (stage === 'needs_review') { reviewCount++; newState.reviewCount = reviewCount; successCount++; newState.successCount = successCount; }
            return newState;
          });
        } catch (err) {
          processedCount++;
          failedCount++;
          const msg = err instanceof Error ? err.message : 'Unknown error';
          updateItem(item.id, { stage: 'failed', error: msg });
          setState(prev => ({ ...prev, processedCount, failedCount }));
        }

        if (batch.indexOf(item) < batch.length - 1) {
          await new Promise(r => setTimeout(r, INTER_ITEM_DELAY));
        }
      }

      if (batchIdx < totalBatches - 1) {
        await new Promise(r => setTimeout(r, INTER_BATCH_DELAY));
      }
    }

    // Invalidate queries to refresh library
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    queryClient.invalidateQueries({ queryKey: ['resource-folders'] });

    setState(prev => ({
      ...prev,
      status: failedCount > 0 ? 'failed' : 'completed',
    }));
    runningRef.current = false;
  }, [user, state.batchSize, state.reprocessMode, state.items, queryClient]);

  const pause = useCallback(() => { pauseRef.current = true; }, []);
  const resume = useCallback(() => { pauseRef.current = false; }, []);
  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  const reset = useCallback(() => {
    cancelRef.current = false;
    pauseRef.current = false;
    runningRef.current = false;
    setState(prev => ({
      status: 'idle',
      batchSize: prev.batchSize,
      reprocessMode: prev.reprocessMode,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      reviewCount: 0,
      items: [],
    }));
  }, []);

  return {
    state,
    setBatchSize,
    setReprocessMode,
    start,
    pause,
    resume,
    cancel,
    reset,
    hasFailures: state.items.some(i => i.stage === 'failed'),
  };
}
