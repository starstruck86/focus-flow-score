/**
 * Batch Queue Processor
 * 
 * Processes selected resources in controlled, sequential batches
 * with limited parallelism and failure isolation.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('BatchQueue');

// ── Types ──────────────────────────────────────────────────

export type ResourceJobStatus =
  | 'queued'
  | 'extracting'
  | 'extracting_edge_fetch'
  | 'extracting_direct_fetch'
  | 'extracting_source_specific'
  | 'awaiting_transcription'
  | 'enriching'
  | 'complete'
  | 'failed'
  | 'needs_attention';

export type BatchAction = 'extraction' | 'enrichment' | 'pipeline';

export interface ExtractionAttempt {
  method: string;
  startedAt: string;
  endedAt: string | null;
  success: boolean;
  responseCode?: number;
  failureReason?: string;
  extractedContentLength?: number;
  timedOut?: boolean;
}

export interface ResourceJobState {
  resourceId: string;
  title: string;
  status: ResourceJobStatus;
  sourceType?: string;
  attempts: ExtractionAttempt[];
  failureReason?: string;
  batchIndex: number;
}

export interface BatchProgress {
  currentBatch: number;
  totalBatches: number;
  processedInBatch: number;
  batchSize: number;
  totalProcessed: number;
  totalResources: number;
  succeeded: number;
  failed: number;
  skipped: number;
  jobs: ResourceJobState[];
  isRunning: boolean;
  isCancelled: boolean;
}

export interface BatchConfig {
  batchSize: number;        // 10-25
  maxConcurrency: number;   // 3-5
  interBatchDelayMs: number; // 500-1000
}

const DEFAULT_CONFIG: BatchConfig = {
  batchSize: 15,
  maxConcurrency: 3,
  interBatchDelayMs: 750,
};

// ── Extraction Methods by Source ────────────────────────────

type ExtractionMethod = 'edge_fetch' | 'direct_fetch' | 'source_specific' | 'transcript_fallback' | 'metadata_only';

function getExtractionMethods(sourceType: string): ExtractionMethod[] {
  const type = (sourceType || '').toLowerCase();
  
  if (type.includes('youtube') || type.includes('video')) {
    return ['edge_fetch', 'source_specific', 'transcript_fallback', 'metadata_only'];
  }
  if (type.includes('zoom')) {
    return ['edge_fetch', 'source_specific', 'transcript_fallback', 'metadata_only'];
  }
  if (type.includes('thinkific') || type.includes('course')) {
    return ['edge_fetch', 'direct_fetch', 'source_specific', 'metadata_only'];
  }
  if (type.includes('audio') || type.includes('podcast')) {
    return ['edge_fetch', 'direct_fetch', 'transcript_fallback', 'metadata_only'];
  }
  if (type.includes('pdf') || type.includes('doc')) {
    return ['edge_fetch', 'direct_fetch', 'source_specific', 'metadata_only'];
  }
  // Default web pages
  return ['edge_fetch', 'direct_fetch', 'source_specific', 'metadata_only'];
}

function methodToStatus(method: ExtractionMethod): ResourceJobStatus {
  switch (method) {
    case 'edge_fetch': return 'extracting_edge_fetch';
    case 'direct_fetch': return 'extracting_direct_fetch';
    case 'source_specific': return 'extracting_source_specific';
    case 'transcript_fallback': return 'awaiting_transcription';
    default: return 'extracting';
  }
}

// ── Concurrency Limiter ────────────────────────────────────

async function runWithConcurrency<T>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

// ── Core Processor ─────────────────────────────────────────

export interface BatchProcessorCallbacks {
  /** Called to actually extract a single resource. Return true if content was extracted/updated. */
  extractResource: (resourceId: string, method: ExtractionMethod) => Promise<{ success: boolean; contentLength?: number; error?: string }>;
  /** Called to enrich a resource (post-extraction). */
  enrichResource: (resourceId: string) => Promise<{ success: boolean; error?: string }>;
  /** Called on every state change for UI updates. */
  onProgress: (progress: BatchProgress) => void;
  /** Called when a single resource completes. */
  onResourceComplete?: (job: ResourceJobState) => void;
  /** Check if resource already has extracted content. */
  hasExtractedContent: (resourceId: string) => Promise<boolean>;
  /** Check if resource already has an active/queued job. */
  hasActiveJob?: (resourceId: string) => Promise<boolean>;
}

export async function runBatchQueue(
  resources: Array<{ id: string; title: string; sourceType?: string }>,
  action: BatchAction,
  callbacks: BatchProcessorCallbacks,
  config: Partial<BatchConfig> = {},
  signal?: AbortSignal,
): Promise<BatchProgress> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const totalBatches = Math.ceil(resources.length / cfg.batchSize);

  // Initialize all jobs
  const jobs: ResourceJobState[] = resources.map((r, i) => ({
    resourceId: r.id,
    title: r.title,
    status: 'queued' as ResourceJobStatus,
    sourceType: r.sourceType,
    attempts: [],
    batchIndex: Math.floor(i / cfg.batchSize),
  }));

  // De-duplicate: skip resources with active jobs
  if (callbacks.hasActiveJob) {
    const deduped: ResourceJobState[] = [];
    for (const job of jobs) {
      const hasActive = await callbacks.hasActiveJob(job.resourceId);
      if (hasActive) {
        job.status = 'needs_attention';
        job.failureReason = 'Duplicate: job already active';
      }
      deduped.push(job);
    }
  }

  const progress: BatchProgress = {
    currentBatch: 0,
    totalBatches,
    processedInBatch: 0,
    batchSize: cfg.batchSize,
    totalProcessed: 0,
    totalResources: resources.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    jobs,
    isRunning: true,
    isCancelled: false,
  };

  const emitProgress = () => callbacks.onProgress({ ...progress, jobs: [...progress.jobs] });
  emitProgress();

  // Process batch by batch
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    if (signal?.aborted) {
      progress.isCancelled = true;
      break;
    }

    progress.currentBatch = batchIdx + 1;
    progress.processedInBatch = 0;
    emitProgress();

    const batchStart = batchIdx * cfg.batchSize;
    const batchEnd = Math.min(batchStart + cfg.batchSize, jobs.length);
    const batchJobs = jobs.slice(batchStart, batchEnd).filter(j => j.status === 'queued');

    // Process batch with limited concurrency
    await runWithConcurrency(batchJobs, cfg.maxConcurrency, async (job) => {
      if (signal?.aborted) return;

      try {
        await processResourceJob(job, action, callbacks);
      } catch (err: any) {
        job.status = 'failed';
        job.failureReason = err?.message || 'Unknown error';
      }

      // Update counters
      if (job.status === 'complete') progress.succeeded++;
      else if (job.status === 'failed') progress.failed++;
      else if (job.status === 'needs_attention') progress.skipped++;

      progress.totalProcessed++;
      progress.processedInBatch++;
      callbacks.onResourceComplete?.(job);
      emitProgress();
    });

    // Inter-batch delay (skip after last batch)
    if (batchIdx < totalBatches - 1 && !signal?.aborted) {
      await new Promise(resolve => setTimeout(resolve, cfg.interBatchDelayMs));
    }
  }

  progress.isRunning = false;
  emitProgress();

  log.info('Batch queue complete', {
    total: progress.totalResources,
    succeeded: progress.succeeded,
    failed: progress.failed,
    skipped: progress.skipped,
    cancelled: progress.isCancelled,
  });

  return progress;
}

// ── Single Resource Processing ─────────────────────────────

async function processResourceJob(
  job: ResourceJobState,
  action: BatchAction,
  callbacks: BatchProcessorCallbacks,
): Promise<void> {
  const needsExtraction = action === 'extraction' || action === 'pipeline';
  const needsEnrichment = action === 'enrichment' || action === 'pipeline';

  // For pipeline: check if extraction is needed
  if (action === 'pipeline') {
    const hasContent = await callbacks.hasExtractedContent(job.resourceId);
    if (hasContent) {
      // Skip extraction, go straight to enrichment
      job.status = 'enriching';
      const result = await callbacks.enrichResource(job.resourceId);
      job.status = result.success ? 'complete' : 'failed';
      if (!result.success) job.failureReason = result.error;
      return;
    }
  }

  // Run extraction with staged fallback
  if (needsExtraction) {
    const extracted = await runExtractionWithFallback(job, callbacks);
    if (!extracted) {
      job.status = 'failed';
      return;
    }
  }

  // Run enrichment
  if (needsEnrichment) {
    job.status = 'enriching';
    const result = await callbacks.enrichResource(job.resourceId);
    if (!result.success) {
      job.status = 'failed';
      job.failureReason = result.error || 'Enrichment failed';
      return;
    }
  }

  job.status = 'complete';
}

async function runExtractionWithFallback(
  job: ResourceJobState,
  callbacks: BatchProcessorCallbacks,
): Promise<boolean> {
  const methods = getExtractionMethods(job.sourceType || '');
  const failedMethods = new Set<string>();

  for (const method of methods) {
    if (failedMethods.has(method)) continue;

    job.status = methodToStatus(method);
    const attempt: ExtractionAttempt = {
      method,
      startedAt: new Date().toISOString(),
      endedAt: null,
      success: false,
    };

    try {
      const result = await callbacks.extractResource(job.resourceId, method);
      attempt.endedAt = new Date().toISOString();
      attempt.success = result.success;
      attempt.extractedContentLength = result.contentLength;

      if (result.success) {
        job.attempts.push(attempt);
        return true;
      }

      attempt.failureReason = result.error;
      failedMethods.add(method);
    } catch (err: any) {
      attempt.endedAt = new Date().toISOString();
      attempt.failureReason = err?.message || 'Unknown';
      attempt.timedOut = err?.message?.toLowerCase().includes('timeout');
      failedMethods.add(method);
    }

    job.attempts.push(attempt);
  }

  // All methods exhausted
  job.failureReason = `All extraction methods failed: ${methods.join(', ')}`;
  return false;
}
