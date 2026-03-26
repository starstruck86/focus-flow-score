/**
 * Global enrichment job store — persists job execution outside any modal/component lifecycle.
 * Jobs continue running even when the DeepEnrichModal is closed.
 *
 * HARDENED: preflight validation, post-write verification, failure categorization,
 * stuck-job recovery, idempotency guards, and dev-only integrity assertions.
 */
import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { QueryClient } from '@tanstack/react-query';
import type { EnrichMode } from '@/lib/resourceEligibility';

// ── Failure categories ─────────────────────────────────────
export type FailureCategory =
  | 'failed_preflight'
  | 'failed_request'
  | 'failed_quality'
  | 'failed_write'
  | 'failed_verification'
  | 'failed_timeout'
  | 'failed_needs_auth'
  | 'failed_unsupported'
  | 'failed_unknown';

// ── Enrichment final status (from orchestrator) ────────────
export type EnrichmentFinalStatus = 'enriched' | 'partial' | 'needs_auth' | 'unsupported' | 'failed';

/**
 * Invalidate resource-related queries globally.
 * Called progressively during processing and after completion.
 */
function invalidateResourceQueries() {
  const qc = (window as any).__QUERY_CLIENT__ as QueryClient | undefined;
  if (!qc) return;
  qc.invalidateQueries({ queryKey: ['resources'] });
  qc.invalidateQueries({ queryKey: ['resource-digests'] });
  qc.invalidateQueries({ queryKey: ['resource-jobs-active'] });
}

/**
 * Dev-only: after a batch completes, query DB counts and compare
 * against the store's success/failed tallies. Logs warnings on mismatch.
 */
async function runConsistencyCheck() {
  try {
    const store = useEnrichmentJobStore.getState();
    const completedItems = store.state.items.filter(i => i.stage === 'complete');
    if (completedItems.length === 0) return;

    const ids = completedItems
      .map(i => i.existingResourceId || i.resourceId)
      .filter(Boolean) as string[];

    if (ids.length === 0) return;

    const { data } = await supabase
      .from('resources')
      .select('id, enrichment_status, last_quality_tier')
      .in('id', ids.slice(0, 50));

    if (!data) return;

    const notEnriched = data.filter(r =>
      r.enrichment_status !== 'deep_enriched'
    );

    if (notEnriched.length > 0) {
      console.warn(
        `[EnrichmentConsistencyCheck] ${notEnriched.length}/${data.length} items marked complete in UI but NOT deep_enriched in DB:`,
        notEnriched.map(r => ({ id: r.id, status: r.enrichment_status, tier: r.last_quality_tier })),
      );
    } else {
      console.info(`[EnrichmentConsistencyCheck] ✓ ${data.length} items confirmed deep_enriched in DB`);
    }

    // Inverse check: failed items must NOT be deep_enriched
    const failedItems = store.state.items.filter(i => i.stage === 'failed');
    const failedIds = failedItems
      .map(i => i.existingResourceId || i.resourceId)
      .filter(Boolean) as string[];

    if (failedIds.length > 0) {
      const { data: failedData } = await supabase
        .from('resources')
        .select('id, enrichment_status')
        .in('id', failedIds.slice(0, 50));

      const falseSuccesses = failedData?.filter(r => r.enrichment_status === 'deep_enriched') || [];
      if (falseSuccesses.length > 0) {
        console.error(
          `[EnrichmentConsistencyCheck] CRITICAL: ${falseSuccesses.length} failed items are deep_enriched in DB!`,
          falseSuccesses.map(r => r.id),
        );
      }
    }

    // Count check: success count must match DB deep_enriched count
    const dbEnrichedCount = data.filter(r => r.enrichment_status === 'deep_enriched').length;
    if (dbEnrichedCount !== completedItems.length) {
      console.warn(
        `[EnrichmentConsistencyCheck] Count mismatch: UI says ${completedItems.length} complete, DB has ${dbEnrichedCount} deep_enriched`,
      );
    }
  } catch (e) {
    console.warn('[EnrichmentConsistencyCheck] Check failed:', e);
  }
}

// ── Types ──────────────────────────────────────────────────
export type IngestionItemStage =
  | 'queued'
  | 'preflight'
  | 'preprocessing'
  | 'checking_duplicate'
  | 'fetching'
  | 'classifying'
  | 'saving'
  | 'enriching'
  | 'verifying'
  | 'complete'
  | 'partial'
  | 'needs_auth'
  | 'unsupported'
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
  failureCategory?: FailureCategory;
  failureTimestamp?: string;
  retryEligible?: boolean;
  videoId?: string;
  channel?: string;
  publishDate?: string;
  duration?: string;
  resourceId?: string;
  enrichMode?: EnrichMode;
  existingResourceId?: string;
  // Orchestrator output fields
  sourceType?: string;
  platform?: string;
  finalStatus?: EnrichmentFinalStatus;
  methodUsed?: string;
  attemptCount?: number;
  completenessScore?: number;
  recoveryHint?: string;
}

export interface IngestionState {
  status: IngestionJobStatus;
  mode: EnrichMode;
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
  startedAt: number | null;
}

// ── Constants ──────────────────────────────────────────────
const INTER_ITEM_DELAY = 1200;
const INTER_BATCH_DELAY = 2500;
const MIN_CONTENT_LENGTH = 200;
const EMPTY_TRANSCRIPT_THRESHOLD = 80;
const MAX_BATCH_SIZE = 10;
const DEFAULT_BATCH_SIZE = 5;
const ENRICHMENT_TIMEOUT_MS = 120_000;

// ── Idempotency: track in-flight resource IDs ──────────────
const inFlightResourceIds = new Set<string>();

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

  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
     'si', 'feature', 'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
    ].forEach(p => u.searchParams.delete(p));
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

function categorizeFailure(err: unknown): FailureCategory {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('preflight')) return 'failed_preflight';
  if (msg.includes('quality') || msg.includes('score') || msg.includes('contract')) return 'failed_quality';
  if (msg.includes('verification') || msg.includes('verify')) return 'failed_verification';
  if (msg.includes('write') || msg.includes('save') || msg.includes('update')) return 'failed_write';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) return 'failed_timeout';
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('network') || msg.includes('fetch')) return 'failed_request';
  return 'failed_unknown';
}

function validateUrl(rawUrl: string): string | null {
  if (!rawUrl || !rawUrl.trim()) return 'missing_data';
  try {
    const u = new URL(rawUrl.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return 'unsupported_source';
    return null;
  } catch {
    return 'invalid_url';
  }
}

// ── Preflight validation ───────────────────────────────────
async function preflightCheck(resourceId: string): Promise<{ pass: boolean; reason?: string }> {
  // Check resource exists and is in valid state
  const { data: resource, error } = await supabase
    .from('resources')
    .select('id, enrichment_status, content, content_length, file_url')
    .eq('id', resourceId)
    .single();

  if (error || !resource) {
    return { pass: false, reason: 'Preflight: resource not found in database' };
  }

  // Check not already being processed (idempotency)
  if (inFlightResourceIds.has(resourceId)) {
    return { pass: false, reason: 'Preflight: resource already being processed' };
  }

  // Check resource is in a valid state for enrichment
  const status = (resource as any).enrichment_status;
  const invalidForEnrich = ['deep_enrich_in_progress', 'reenrich_in_progress'];
  if (invalidForEnrich.includes(status)) {
    return { pass: false, reason: `Preflight: resource in active state "${status}"` };
  }

  // Check has valid source URL
  const url = (resource as any).file_url;
  if (!url || !url.startsWith('http')) {
    return { pass: false, reason: 'Preflight: missing or invalid source URL' };
  }

  return { pass: true };
}

// ── Post-write verification ────────────────────────────────
async function verifyPostWrite(resourceId: string, expectedStatus: 'deep_enriched'): Promise<{ pass: boolean; actual?: string; reason?: string }> {
  const { data, error } = await supabase
    .from('resources')
    .select('id, enrichment_status, last_quality_tier, last_quality_score')
    .eq('id', resourceId)
    .single();

  if (error || !data) {
    return { pass: false, reason: 'Verification: could not read resource after write' };
  }

  const actual = (data as any).enrichment_status;
  if (actual === expectedStatus) {
    return { pass: true, actual };
  }

  // It's okay if it's incomplete/failed — the edge function handled it correctly
  if (actual === 'incomplete' || actual === 'failed') {
    return { pass: false, actual, reason: `Verification: resource is "${actual}" (quality gate), not "${expectedStatus}"` };
  }

  return { pass: false, actual, reason: `Verification: expected "${expectedStatus}", got "${actual}"` };
}

// ── Preprocessing ──────────────────────────────────────────
function preprocessItems(
  rawItems: Array<{ resourceId?: string; url: string; title: string; enrichMode?: EnrichMode; videoId?: string; channel?: string; publishDate?: string; duration?: string }>
): IngestionItem[] {
  const seenCanonicals = new Set<string>();
  return rawItems.map((item, idx) => {
    const urlError = validateUrl(item.url);
    if (urlError) {
      return {
        id: item.resourceId ?? `ingest-${idx}-${Date.now()}`,
        url: item.url,
        title: item.title || 'Untitled',
        stage: 'skipped' as const,
        error: urlError,
        failureCategory: 'failed_preflight' as FailureCategory,
        retryEligible: false,
        videoId: item.videoId,
        channel: item.channel,
        publishDate: item.publishDate,
        duration: item.duration,
        resourceId: item.resourceId,
        enrichMode: item.enrichMode,
      };
    }

    const source = canonicalize(item.url);
    const canonicalKey = item.resourceId || source.source_id || source.canonical_url;

    if (seenCanonicals.has(canonicalKey)) {
      return {
        id: item.resourceId ?? `ingest-${idx}-${Date.now()}`,
        url: item.url,
        title: item.title || 'Untitled',
        stage: 'skipped' as const,
        error: 'duplicate_resource',
        failureCategory: 'failed_preflight' as FailureCategory,
        retryEligible: false,
        videoId: item.videoId || source.source_id || undefined,
        channel: item.channel,
        publishDate: item.publishDate,
        duration: item.duration,
        resourceId: item.resourceId,
        enrichMode: item.enrichMode,
      };
    }

    seenCanonicals.add(canonicalKey);

    return {
      id: item.resourceId ?? `ingest-${idx}-${Date.now()}`,
      url: item.url,
      title: item.title || 'Untitled',
      stage: 'queued' as const,
      retryEligible: true,
      videoId: item.videoId || extractYouTubeVideoId(item.url) || undefined,
      channel: item.channel,
      publishDate: item.publishDate,
      duration: item.duration,
      resourceId: item.resourceId,
      enrichMode: item.enrichMode,
    };
  });
}

// ── Store ──────────────────────────────────────────────────
interface EnrichmentJobStore {
  state: IngestionState;
  _cancelRequested: boolean;
  _pauseRequested: boolean;
  _running: boolean;

  setBatchSize: (size: number) => void;
  setMode: (mode: EnrichMode) => void;
  start: (
    userId: string,
    items: Array<{ resourceId?: string; url: string; title: string; enrichMode?: EnrichMode }>,
    options?: { retryFailedOnly?: boolean },
  ) => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  reset: () => void;
  hasFailures: () => boolean;
  isActive: () => boolean;
}

const INITIAL_STATE: IngestionState = {
  status: 'idle',
  mode: 'deep_enrich',
  batchSize: DEFAULT_BATCH_SIZE,
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
  startedAt: null,
};

export const useEnrichmentJobStore = create<EnrichmentJobStore>((set, get) => {
  // Internal helpers
  const updateItem = (id: string, patch: Partial<IngestionItem>) => {
    set(store => ({
      state: {
        ...store.state,
        items: store.state.items.map(i => (i.id === id ? { ...i, ...patch } : i)),
      },
    }));
  };

  function failItem(id: string, error: string, category: FailureCategory, retryEligible = true) {
    updateItem(id, {
      stage: 'failed',
      error,
      failureCategory: category,
      failureTimestamp: new Date().toISOString(),
      retryEligible,
    });
  }

  async function checkDuplicate(userId: string, url: string): Promise<string | null> {
    const { canonical_url, source_id } = canonicalize(url);
    const { data } = await supabase
      .from('resources')
      .select('id')
      .eq('user_id', userId)
      .eq('file_url', canonical_url)
      .limit(1);
    if (data?.length) return data[0].id;

    if (source_id) {
      const { data: ytMatch } = await supabase
        .from('resources')
        .select('id')
        .eq('user_id', userId)
        .ilike('file_url', `%${source_id}%`)
        .limit(1);
      if (ytMatch?.length) return ytMatch[0].id;
    }
    return null;
  }

  async function processItem(userId: string, item: IngestionItem, reprocessMode: ReprocessMode): Promise<void> {
    const isDirectResourceRun = !!item.resourceId;
    const resourceId = item.resourceId;

    if (isDirectResourceRun && resourceId) {
      // ── PREFLIGHT ────────────────────────────────────────
      updateItem(item.id, { stage: 'preflight' });
      const preflight = await preflightCheck(resourceId);
      if (!preflight.pass) {
        failItem(item.id, preflight.reason || 'Preflight failed', 'failed_preflight', true);
        throw new Error(preflight.reason);
      }

      // Register in-flight
      inFlightResourceIds.add(resourceId);

      updateItem(item.id, { stage: 'enriching', existingResourceId: resourceId });
      try {
        const force = item.enrichMode === 're_enrich';
        const result = await trackedInvoke<any>('enrich-resource-content', {
          body: { resource_id: resourceId, force },
          componentName: 'DeepEnrich',
          timeoutMs: ENRICHMENT_TIMEOUT_MS,
        });

        // Check for application-level errors (quality validation failures)
        if (result.error) {
          // Use rawMessage for actionable detail, not the generic friendly message
          const rawMsg = result.error.rawMessage || result.error.message || 'Enrichment failed';
          const friendlyMsg = result.error.message || rawMsg;
          const isQualityFail = rawMsg.toLowerCase().includes('quality') || rawMsg.toLowerCase().includes('score');
          const isTimeout = result.error.category === 'FUNCTION_TIMEOUT';
          const isNetwork = result.error.category === 'NETWORK_ERROR';
          
          // Build a user-useful error with recovery hint
          let displayMsg = rawMsg;
          if (isTimeout) {
            displayMsg = `Timed out after ${ENRICHMENT_TIMEOUT_MS / 1000}s — retry will use extended timeout`;
          } else if (isNetwork) {
            displayMsg = `Connection failed — retry will attempt again`;
          } else if (isQualityFail) {
            // Strip prefix for clarity
            displayMsg = rawMsg.replace(/^Quality validation failed:\s*/i, 'Content quality: ');
          }
          
          const category: FailureCategory = isTimeout ? 'failed_timeout' : isQualityFail ? 'failed_quality' : isNetwork ? 'failed_request' : 'failed_request';
          failItem(item.id, displayMsg, category, true);
          inFlightResourceIds.delete(resourceId);
          throw new Error(displayMsg);
        }

        // ── POST-WRITE VERIFICATION ─────────────────────────
        updateItem(item.id, { stage: 'verifying' });
        const verification = await verifyPostWrite(resourceId, 'deep_enriched');

        if (!verification.pass) {
          // The edge function ran but quality gate rejected it — this is NOT a success
          if (verification.actual === 'incomplete' || verification.actual === 'failed') {
            failItem(
              item.id,
              `Quality gate: resource is "${verification.actual}" after enrichment`,
              'failed_quality',
              true,
            );
            inFlightResourceIds.delete(resourceId);
            throw new Error(verification.reason);
          }
          // Unexpected state
          failItem(item.id, verification.reason || 'Post-write verification failed', 'failed_verification', true);
          inFlightResourceIds.delete(resourceId);
          throw new Error(verification.reason);
        }

        updateItem(item.id, { stage: 'complete' });
        inFlightResourceIds.delete(resourceId);
        return;
      } catch (enrichErr) {
        inFlightResourceIds.delete(resourceId);
        // Only update if not already failed by inner logic
        const currentItem = get().state.items.find(i => i.id === item.id);
        if (currentItem?.stage !== 'failed') {
          const enrichMsg = classifyError(enrichErr, 'Deep enrichment');
          const category = categorizeFailure(enrichErr);
          failItem(item.id, enrichMsg, category, category !== 'failed_preflight');
        }
        throw enrichErr;
      }
    }

    // ── NEW RESOURCE PATH (ingest from URL) ────────────────

    // Step 1: Duplicate check
    updateItem(item.id, { stage: 'checking_duplicate' });
    const existingId = await checkDuplicate(userId, item.url);

    if (existingId) {
      if (reprocessMode === 'skip_processed') {
        updateItem(item.id, { stage: 'skipped', existingResourceId: existingId, error: 'already_enriched' });
        return;
      }
      updateItem(item.id, { existingResourceId: existingId });
    }

    // Step 2: Classify
    updateItem(item.id, { stage: 'classifying' });
    let classification: any;
    try {
      const { data, error } = await trackedInvoke<any>('classify-resource', {
        body: { url: item.url },
        componentName: 'DeepEnrich',
      });
      if (error) throw new Error(error.message || 'Classification failed');
      classification = data;
      if (!classification?.title || classification.title === 'Untitled') {
        classification = { ...classification, title: item.title || item.url };
      }
    } catch (err) {
      throw new Error(classifyError(err, 'Classification'));
    }

    // Step 3: Save or update
    updateItem(item.id, { stage: 'saving' });
    const source = canonicalize(item.url);
    const contentToStore = classification.scraped_content?.length > 50
      ? classification.scraped_content
      : `[External Link: ${source.canonical_url}]`;
    const contentStatus = contentToStore.startsWith('[External Link:') ? 'placeholder' : 'enriched';

    if (contentStatus === 'enriched' && contentToStore.length < EMPTY_TRANSCRIPT_THRESHOLD) {
      failItem(item.id, 'Content too short — possible empty transcript', 'failed_quality', true);
      return;
    }

    let savedResourceId: string;

    if (existingId && reprocessMode !== 'skip_processed') {
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
      updatePayload.file_url = source.canonical_url;
      if (Object.keys(updatePayload).length > 0) {
        await supabase.from('resources').update(updatePayload).eq('id', existingId);
      }
      savedResourceId = existingId;
    } else {
      let folderId: string | null = null;
      if (classification.top_folder) {
        const { data: folders } = await supabase
          .from('resource_folders')
          .select('id')
          .eq('user_id', userId)
          .is('parent_id', null)
          .ilike('name', classification.top_folder)
          .limit(1);
        folderId = folders?.[0]?.id || null;
        if (!folderId) {
          const { data: newF } = await supabase
            .from('resource_folders')
            .insert({ name: classification.top_folder, user_id: userId })
            .select('id')
            .single();
          folderId = newF?.id || null;
        }
      }

      const { data: resource, error } = await supabase
        .from('resources')
        .insert({
          user_id: userId,
          title: classification.title,
          description: classification.description
            ? `${classification.description}\n\n---\nSource: ${source.source_type}${source.source_id ? ` (${source.source_id})` : ''} · Ingested ${new Date().toISOString().split('T')[0]}`
            : `Source: ${source.source_type}${source.source_id ? ` (${source.source_id})` : ''} · Ingested ${new Date().toISOString().split('T')[0]}`,
          resource_type: classification.resource_type,
          tags: classification.tags,
          folder_id: folderId,
          file_url: source.canonical_url,
          content: contentToStore,
          content_status: contentStatus,
        } as any)
        .select('id')
        .single();
      if (error) throw new Error(`Save failed: ${error.message}`);
      savedResourceId = resource.id;
    }

    if (contentStatus === 'enriched' && contentToStore.length < MIN_CONTENT_LENGTH) {
      failItem(item.id, `Content only ${contentToStore.length} chars — may be low quality`, 'failed_quality', true);
      return;
    }

    // Register in-flight
    inFlightResourceIds.add(savedResourceId);

    updateItem(item.id, { stage: 'enriching', existingResourceId: savedResourceId });
    try {
      const enrichResult = await trackedInvoke<any>('enrich-resource-content', {
        body: { resource_id: savedResourceId, force: true },
        componentName: 'DeepEnrich',
        timeoutMs: ENRICHMENT_TIMEOUT_MS,
      });
      // Check for application-level errors
      if (enrichResult.error) {
        const enrichMsg = enrichResult.error.message || 'Enrichment failed';
        failItem(item.id, `Saved but enrichment failed: ${enrichMsg}`, 'failed_quality', true);
        inFlightResourceIds.delete(savedResourceId);
        return;
      }
    } catch (enrichErr) {
      const enrichMsg = classifyError(enrichErr, 'Deep enrichment');
      failItem(item.id, `Saved but enrichment failed: ${enrichMsg}`, categorizeFailure(enrichErr), true);
      inFlightResourceIds.delete(savedResourceId);
      return;
    }

    // ── POST-WRITE VERIFICATION for new resources ─────────
    updateItem(item.id, { stage: 'verifying' });
    const verification = await verifyPostWrite(savedResourceId, 'deep_enriched');
    inFlightResourceIds.delete(savedResourceId);

    if (!verification.pass) {
      if (verification.actual === 'incomplete' || verification.actual === 'failed') {
        failItem(
          item.id,
          `Quality gate: resource is "${verification.actual}" after enrichment`,
          'failed_quality',
          true,
        );
      } else {
        failItem(item.id, verification.reason || 'Post-write verification failed', 'failed_verification', true);
      }
      return;
    }

    updateItem(item.id, { stage: 'complete', existingResourceId: savedResourceId });
  }

  // Main execution loop — runs detached from any component
  async function runLoop(userId: string) {
    const store = get();
    const { items, batchSize, reprocessMode } = store.state;
    const queue = items.filter(i => i.stage === 'queued');
    const cappedBatchSize = Math.min(batchSize, MAX_BATCH_SIZE);
    const totalBatches = Math.max(1, Math.ceil(queue.length / cappedBatchSize));

    const priorSuccess = items.filter(i => i.stage === 'complete').length;
    const priorSkipped = items.filter(i => i.stage === 'skipped').length;

    set(s => ({
      state: {
        ...s.state,
        status: 'running',
        totalBatches,
        currentBatch: 0,
        processedCount: priorSuccess + priorSkipped,
        successCount: priorSuccess,
        failedCount: 0,
        skippedCount: priorSkipped,
        reviewCount: 0,
      },
    }));

    if (queue.length === 0) {
      set(s => ({ state: { ...s.state, status: 'completed' } }));
      get()._running = false;
      return;
    }

    let successCount = priorSuccess;
    let failedCount = 0;
    let skippedCount = priorSkipped;
    let reviewCount = 0;
    let processedCount = priorSuccess + priorSkipped;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      if (get()._cancelRequested) {
        set(s => ({ state: { ...s.state, status: 'cancelled' }, _running: false }));
        inFlightResourceIds.clear();
        return;
      }

      while (get()._pauseRequested) {
        set(s => ({ state: { ...s.state, status: 'paused' } }));
        await new Promise(r => setTimeout(r, 500));
        if (get()._cancelRequested) {
          set(s => ({ state: { ...s.state, status: 'cancelled' }, _running: false }));
          inFlightResourceIds.clear();
          return;
        }
      }

      const batchStart = batchIdx * cappedBatchSize;
      const batch = queue.slice(batchStart, batchStart + cappedBatchSize);

      set(s => ({ state: { ...s.state, status: 'running', currentBatch: batchIdx + 1 } }));

      for (const item of batch) {
        if (get()._cancelRequested) {
          set(s => ({ state: { ...s.state, status: 'cancelled' }, _running: false }));
          inFlightResourceIds.clear();
          return;
        }
        while (get()._pauseRequested) {
          await new Promise(r => setTimeout(r, 500));
          if (get()._cancelRequested) {
            set(s => ({ state: { ...s.state, status: 'cancelled' }, _running: false }));
            inFlightResourceIds.clear();
            return;
          }
        }

        try {
          await processItem(userId, item, reprocessMode);
          processedCount++;

          set(s => {
            const updated = s.state.items.find(i => i.id === item.id);
            const stage = updated?.stage || 'complete';
            const newState = { ...s.state, processedCount };
            if (stage === 'complete') { successCount++; newState.successCount = successCount; }
            else if (stage === 'skipped') { skippedCount++; newState.skippedCount = skippedCount; }
            // needs_review is NOT a success — count as failed
            else if (stage === 'needs_review') { reviewCount++; newState.reviewCount = reviewCount; failedCount++; newState.failedCount = failedCount; }
            else if (stage === 'failed') { failedCount++; newState.failedCount = failedCount; }
            return { state: newState };
          });

          // Progressive invalidation so UI updates per-item
          invalidateResourceQueries();
        } catch (err) {
          processedCount++;
          // Only increment failedCount if not already handled inside processItem
          const currentItem = get().state.items.find(i => i.id === item.id);
          if (currentItem?.stage !== 'failed') {
            const msg = classifyError(err, 'Deep enrichment');
            failItem(item.id, msg, categorizeFailure(err));
          }
          failedCount++;
          set(s => ({ state: { ...s.state, processedCount, failedCount } }));
        }

        if (batch.indexOf(item) < batch.length - 1) {
          await new Promise(r => setTimeout(r, INTER_ITEM_DELAY));
        }
      }

      if (batchIdx < totalBatches - 1) {
        await new Promise(r => setTimeout(r, INTER_BATCH_DELAY));
      }
    }

    // Clear in-flight tracking
    inFlightResourceIds.clear();

    set(s => ({
      state: { ...s.state, status: failedCount > 0 ? 'failed' : 'completed' },
      _running: false,
    }));

    // Final invalidation to ensure UI is fully up-to-date
    invalidateResourceQueries();

    // Dev-only consistency assertion
    if (import.meta.env.DEV) {
      runConsistencyCheck();
    }
  }

  return {
    state: { ...INITIAL_STATE },
    _cancelRequested: false,
    _pauseRequested: false,
    _running: false,

    setBatchSize: (size: number) => {
      const capped = Math.min(Math.max(size, 1), MAX_BATCH_SIZE);
      set(s => ({ state: { ...s.state, batchSize: capped } }));
    },

    setMode: (mode: EnrichMode) => {
      set(s => ({ state: { ...s.state, mode } }));
    },

    start: (
      userId: string,
      items: Array<{ resourceId?: string; url: string; title: string; enrichMode?: EnrichMode }>,
      options?: { retryFailedOnly?: boolean },
    ) => {
      const store = get();
      if (store._running) return;

      let ingestionItems: IngestionItem[];

      if (options?.retryFailedOnly) {
        ingestionItems = store.state.items.map(i =>
          i.stage === 'failed'
            ? { ...i, stage: 'queued' as const, error: undefined, failureCategory: undefined, failureTimestamp: undefined }
            : i
        );
      } else {
        ingestionItems = preprocessItems(items);
      }

      set({
        _running: true,
        _cancelRequested: false,
        _pauseRequested: false,
        state: {
          ...store.state,
          status: 'running',
          totalItems: ingestionItems.length,
          items: ingestionItems,
          startedAt: Date.now(),
        },
      });

      // Fire and forget — runs in background
      runLoop(userId);
    },

    pause: () => {
      set({ _pauseRequested: true });
    },

    resume: () => {
      set({ _pauseRequested: false });
    },

    cancel: () => {
      set({ _cancelRequested: true });
    },

    reset: () => {
      inFlightResourceIds.clear();
      set({
        _cancelRequested: false,
        _pauseRequested: false,
        _running: false,
        state: { ...INITIAL_STATE, batchSize: get().state.batchSize },
      });
    },

    hasFailures: () => get().state.items.some(i => i.stage === 'failed'),
    isActive: () => {
      const s = get().state.status;
      return s === 'running' || s === 'paused';
    },
  };
});
