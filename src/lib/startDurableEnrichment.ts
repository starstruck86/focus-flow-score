/**
 * startDurableEnrichment — Creates a durable background_jobs row and
 * dispatches the enrichment work to the server-side run-enrichment-job
 * edge function. The work continues even if the browser tab is closed.
 */
import { supabase } from '@/integrations/supabase/client';
import { createDurableJob } from '@/lib/durableJobs';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type { EnrichMode } from '@/lib/resourceEligibility';
import { recordEnrichmentEvent } from '@/lib/observability/enrichObserver';

export interface DurableEnrichmentParams {
  userId: string;
  resourceIds: string[];
  mode: EnrichMode;
  title?: string;
}

export async function startDurableEnrichment(params: DurableEnrichmentParams): Promise<string> {
  const { userId, resourceIds, mode, title } = params;
  const jobId = crypto.randomUUID();
  const modeLabel = mode === 'deep_enrich' ? 'Deep Enrich' : 'Re-enrich';
  const jobTitle = title || `${modeLabel}: ${resourceIds.length} resources`;

  console.info(`[DURABLE ENRICH] Creating job "${jobId}" for ${resourceIds.length} resources, mode=${mode}`);
  recordEnrichmentEvent('enrich:dispatched', { jobId, resourceIds, mode, entryPoint: 'startDurableEnrichment' });

  // Create the durable job row
  await createDurableJob({
    id: jobId,
    userId,
    type: mode === 'deep_enrich' ? 'deep_enrich' : 're_enrichment',
    title: jobTitle,
    status: 'queued',
    progressMode: 'determinate',
    stepLabel: `Queued: ${resourceIds.length} resources`,
    metadata: {
      resource_ids: resourceIds,
      mode,
      success_count: 0,
      failed_count: 0,
      resume_from_index: 0,
    },
  });

  // Dispatch to the backend runner (fire-and-forget)
  dispatchEnrichmentJob(jobId).catch((err) => {
    console.error(`[DURABLE ENRICH] Dispatch failed for "${jobId}":`, err);
  });

  return jobId;
}

/**
 * Dispatch (or re-dispatch) a queued enrichment job to the backend runner.
 * Used for both initial start and retry.
 */
export async function dispatchEnrichmentJob(jobId: string): Promise<void> {
  console.info(`[DURABLE ENRICH] Dispatching job "${jobId}" to backend runner`);

  try {
    const response = await authenticatedFetch({
      functionName: 'run-enrichment-job',
      body: { job_id: jobId },
      componentName: 'DurableEnrichment',
      timeoutMs: 10_000, // Just confirm dispatch, don't wait for completion
    });

    const result = await response.json().catch(() => null);
    console.info(`[DURABLE ENRICH] Dispatch response for "${jobId}":`, result?.status || response.status);
  } catch (err) {
    // Dispatch timeout is expected — the job runs server-side
    console.info(`[DURABLE ENRICH] Dispatch for "${jobId}" sent (timeout expected for long jobs)`);
  }
}

/**
 * Retry a failed durable job by resetting it to queued and re-dispatching.
 */
export async function retryDurableJob(jobId: string): Promise<void> {
  console.info(`[DURABLE ENRICH] Retrying job "${jobId}"`);

  // Load the job to get its metadata
  const { data: job } = await supabase
    .from('background_jobs' as any)
    .select('type, metadata')
    .eq('id', jobId)
    .single();

  if (!job) {
    console.error(`[DURABLE ENRICH] Job "${jobId}" not found for retry`);
    return;
  }

  const meta = (job as any).metadata ?? {};
  const jobType = (job as any).type;

  // Reset progress but keep resource list
  await supabase
    .from('background_jobs' as any)
    .update({
      status: 'queued',
      error: null,
      progress_current: 0,
      progress_percent: 0,
      substatus: null,
      step_label: 'Queued for retry',
      completed_at: null,
      metadata: {
        ...meta,
        resume_from_index: 0,
        success_count: 0,
        failed_count: 0,
      },
    })
    .eq('id', jobId);

  // Dispatch based on job type
  if (jobType === 'deep_enrich' || jobType === 're_enrichment') {
    await dispatchEnrichmentJob(jobId);
  } else if (jobType === 're_extraction') {
    // Re-extract jobs use different dispatch — trigger via batch-extract-kis
    const entityId = meta.entity_id;
    if (entityId) {
      try {
        await authenticatedFetch({
          functionName: 'batch-extract-kis',
          body: { resourceId: entityId },
          componentName: 'DurableRetry',
          timeoutMs: 10_000,
        });
      } catch {
        console.info(`[DURABLE ENRICH] Re-extract dispatch sent for "${jobId}"`);
      }
    }
  }
}
