/**
 * Staged, resumable resource processing pipeline.
 * Processes large resources (e.g. 2-hour YouTube videos) in discrete steps
 * with per-step persistence, idempotency, and retry safety.
 */

import { supabase } from '@/integrations/supabase/client';
import { generateTraceId, normalizeError, recordError } from './appError';
import { trackedInvoke } from './trackedInvoke';
import { createLogger } from './logger';

const logger = createLogger('ResourcePipeline');

// ── Pipeline Step Definitions ──────────────────────────────
export const PIPELINE_STEPS = [
  { name: 'ingest', sequence: 1, label: 'Ingest Resource' },
  { name: 'transcript_acquisition', sequence: 2, label: 'Acquire Transcript' },
  { name: 'transcript_chunking', sequence: 3, label: 'Chunk Transcript' },
  { name: 'chunk_summarization', sequence: 4, label: 'Summarize Chunks' },
  { name: 'action_extraction', sequence: 5, label: 'Extract Actions' },
  { name: 'artifact_creation', sequence: 6, label: 'Create Artifacts' },
] as const;

export type StepName = typeof PIPELINE_STEPS[number]['name'];
export type JobStatus = 'queued' | 'running' | 'partial' | 'failed' | 'completed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

const CHUNK_SIZE_CHARS = 12_000; // ~3k tokens per chunk

// ── Types ──────────────────────────────────────────────────
export interface ResourceJob {
  id: string;
  resource_id: string;
  user_id: string;
  job_type: string;
  status: JobStatus;
  trace_id: string;
  started_at: string | null;
  ended_at: string | null;
  error_category: string | null;
  error_message: string | null;
  retry_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ResourceJobStep {
  id: string;
  job_id: string;
  step_name: string;
  sequence: number;
  status: StepStatus;
  started_at: string | null;
  ended_at: string | null;
  error_category: string | null;
  error_message: string | null;
  payload_size: number | null;
  retry_count: number;
  metadata: Record<string, unknown>;
}

export interface ResourceChunk {
  id: string;
  resource_id: string;
  job_id: string | null;
  chunk_index: number;
  content: string;
  summary: string | null;
  actions: unknown[];
  status: string;
  token_count: number | null;
}

// ── Job Creation ───────────────────────────────────────────
export async function createResourceJob(
  resourceId: string,
  userId: string,
  jobType = 'full_pipeline',
): Promise<ResourceJob> {
  const traceId = generateTraceId();
  
  const { data: job, error } = await supabase
    .from('resource_jobs')
    .insert({
      resource_id: resourceId,
      user_id: userId,
      job_type: jobType,
      status: 'queued' as string,
      trace_id: traceId,
    })
    .select()
    .single();

  if (error) throw error;

  // Create all step records upfront
  const stepInserts = PIPELINE_STEPS.map(s => ({
    job_id: job.id,
    step_name: s.name,
    sequence: s.sequence,
    status: 'pending' as string,
  }));

  await supabase.from('resource_job_steps').insert(stepInserts);

  logger.info('Job created', { jobId: job.id, traceId, resourceId });
  return job as ResourceJob;
}

// ── Step Execution Helpers ─────────────────────────────────
async function markStepRunning(stepId: string) {
  await supabase.from('resource_job_steps').update({
    status: 'running',
    started_at: new Date().toISOString(),
  }).eq('id', stepId);
}

async function markStepCompleted(stepId: string, metadata?: Record<string, unknown>, payloadSize?: number) {
  await supabase.from('resource_job_steps').update({
    status: 'completed',
    ended_at: new Date().toISOString(),
    metadata: (metadata || {}) as any,
    payload_size: payloadSize || null,
  }).eq('id', stepId);
}

async function markStepFailed(stepId: string, error: unknown) {
  const appError = normalizeError({ error, source: 'frontend', componentName: 'ResourcePipeline' });
  recordError(appError);
  await supabase.from('resource_job_steps').update({
    status: 'failed',
    ended_at: new Date().toISOString(),
    error_category: appError.category,
    error_message: appError.rawMessage.slice(0, 500),
    retry_count: 1, // will be incremented on actual retry
  }).eq('id', stepId);
}

async function updateJobStatus(jobId: string, status: JobStatus, errorInfo?: { category: string; message: string }) {
  const update: Record<string, unknown> = { status };
  if (status === 'running' || status === 'queued') update.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'failed') update.ended_at = new Date().toISOString();
  if (errorInfo) {
    update.error_category = errorInfo.category;
    update.error_message = errorInfo.message;
  }
  await supabase.from('resource_jobs').update(update).eq('id', jobId);
}

// ── Content Chunking ───────────────────────────────────────
export function chunkContent(content: string, maxChars = CHUNK_SIZE_CHARS): string[] {
  if (content.length <= maxChars) return [content];
  
  const chunks: string[] = [];
  let remaining = content;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    // Try to break at paragraph or sentence boundary
    let breakPoint = remaining.lastIndexOf('\n\n', maxChars);
    if (breakPoint < maxChars * 0.5) breakPoint = remaining.lastIndexOf('. ', maxChars);
    if (breakPoint < maxChars * 0.5) breakPoint = remaining.lastIndexOf(' ', maxChars);
    if (breakPoint < maxChars * 0.3) breakPoint = maxChars;
    
    chunks.push(remaining.slice(0, breakPoint + 1).trim());
    remaining = remaining.slice(breakPoint + 1).trim();
  }
  
  return chunks;
}

// ── Pipeline Runner ────────────────────────────────────────
export async function runPipeline(
  jobId: string,
  options?: { resumeFromStep?: StepName; onStepComplete?: (step: string) => void },
): Promise<{ success: boolean; completedSteps: string[]; failedStep?: string }> {
  // Fetch job and steps
  const { data: job } = await supabase.from('resource_jobs').select('*').eq('id', jobId).single();
  if (!job) throw new Error('Job not found');

  const { data: steps } = await supabase
    .from('resource_job_steps')
    .select('*')
    .eq('job_id', jobId)
    .order('sequence', { ascending: true });
  if (!steps) throw new Error('Steps not found');

  // Fetch the resource
  const { data: resource } = await supabase.from('resources').select('*').eq('id', job.resource_id).single();
  if (!resource) throw new Error('Resource not found');

  await updateJobStatus(jobId, 'running');

  const completedSteps: string[] = [];
  let resumeActive = !options?.resumeFromStep;

  for (const step of steps as ResourceJobStep[]) {
    // Skip already completed steps (idempotency)
    if (step.status === 'completed') {
      completedSteps.push(step.step_name);
      continue;
    }

    // Handle resume: skip until we reach the resume step
    if (!resumeActive) {
      if (step.step_name === options?.resumeFromStep) {
        resumeActive = true;
      } else {
        continue;
      }
    }

    try {
      await markStepRunning(step.id);
      await executeStep(step.step_name as StepName, job as ResourceJob, resource, jobId);
      await markStepCompleted(step.id, {}, resource.content_length);
      completedSteps.push(step.step_name);
      options?.onStepComplete?.(step.step_name);
    } catch (err) {
      await markStepFailed(step.id, err);
      const appError = normalizeError({ error: err, source: 'frontend' });
      await updateJobStatus(jobId, completedSteps.length > 0 ? 'partial' : 'failed', {
        category: appError.category,
        message: appError.rawMessage.slice(0, 500),
      });
      logger.error(`Pipeline failed at step: ${step.step_name}`, { jobId, error: err });
      return { success: false, completedSteps, failedStep: step.step_name };
    }
  }

  await updateJobStatus(jobId, 'completed');
  logger.info('Pipeline completed', { jobId, steps: completedSteps.length });
  return { success: true, completedSteps };
}

// ── Step Implementations ───────────────────────────────────
async function executeStep(
  stepName: StepName,
  job: ResourceJob,
  resource: Record<string, unknown>,
  jobId: string,
) {
  switch (stepName) {
    case 'ingest':
      return stepIngest(job, resource);
    case 'transcript_acquisition':
      return stepTranscriptAcquisition(job, resource);
    case 'transcript_chunking':
      return stepTranscriptChunking(job, resource, jobId);
    case 'chunk_summarization':
      return stepChunkSummarization(job, jobId);
    case 'action_extraction':
      return stepActionExtraction(job, jobId);
    case 'artifact_creation':
      return stepArtifactCreation(job, resource);
  }
}

async function stepIngest(job: ResourceJob, resource: Record<string, unknown>) {
  // Resource already exists in DB — validate it has minimum data
  if (!resource.title) throw new Error('Resource missing title');
  // Update job metadata with resource info
  await supabase.from('resource_jobs').update({
    metadata: {
      ...(job.metadata || {}),
      resource_type: resource.resource_type,
      content_length: resource.content_length || (resource.content as string)?.length || 0,
    },
  }).eq('id', job.id);
}

async function stepTranscriptAcquisition(job: ResourceJob, resource: Record<string, unknown>) {
  const content = resource.content as string;
  if (content && content.length > 500) {
    // Already has substantial content, skip acquisition
    return;
  }
  // Invoke enrichment to get deep content
  const result = await trackedInvoke('enrich-resource-content', {
    body: { resource_id: job.resource_id },
    traceId: job.trace_id,
    componentName: 'ResourcePipeline',
  });
  if (result.error) throw new Error(result.error.rawMessage);
}

async function stepTranscriptChunking(job: ResourceJob, resource: Record<string, unknown>, jobId: string) {
  // Re-fetch resource to get latest content (may have been enriched in previous step)
  const { data: fresh } = await supabase.from('resources').select('content, content_length').eq('id', job.resource_id).single();
  const content = fresh?.content || resource.content as string || '';
  
  if (!content || content.length < 100) {
    // Nothing meaningful to chunk — mark as skipped effectively
    return;
  }

  // Delete any existing chunks for this job (idempotency)
  await supabase.from('resource_chunks').delete().eq('job_id', jobId);

  const chunks = chunkContent(content);
  
  const chunkInserts = chunks.map((c, i) => ({
    resource_id: job.resource_id,
    job_id: jobId,
    user_id: job.user_id,
    chunk_index: i,
    content: c,
    status: 'pending' as string,
    token_count: Math.ceil(c.length / 4),
  }));

  const { error } = await supabase.from('resource_chunks').insert(chunkInserts);
  if (error) throw error;
  
  // Store chunk count in job metadata
  await supabase.from('resource_jobs').update({
    metadata: { ...(job.metadata || {}), chunk_count: chunks.length, total_chars: content.length },
  }).eq('id', job.id);
}

async function stepChunkSummarization(job: ResourceJob, jobId: string) {
  const { data: chunks } = await supabase
    .from('resource_chunks')
    .select('*')
    .eq('job_id', jobId)
    .order('chunk_index', { ascending: true });
  
  if (!chunks || chunks.length === 0) return;

  // Process only pending chunks (resumability)
  const pending = chunks.filter(c => c.status === 'pending' || c.status === 'failed');
  
  for (const chunk of pending) {
    try {
      const result = await trackedInvoke<{ summary: string }>('classify-resource', {
        body: { content: chunk.content, mode: 'summarize' },
        traceId: job.trace_id,
        componentName: 'ResourcePipeline',
      });
      
      const summary = result.data && typeof result.data === 'object' && 'summary' in result.data
        ? (result.data as any).summary
        : `Chunk ${chunk.chunk_index + 1} processed`;

      await supabase.from('resource_chunks').update({
        summary,
        status: 'completed',
      }).eq('id', chunk.id);
    } catch (err) {
      await supabase.from('resource_chunks').update({
        status: 'failed',
      }).eq('id', chunk.id);
      // Continue processing other chunks — don't fail the whole step
      logger.warn(`Chunk ${chunk.chunk_index} summarization failed`, { jobId, chunkId: chunk.id });
    }
  }
  
  // Check if any chunks still failed
  const { data: afterChunks } = await supabase
    .from('resource_chunks')
    .select('status')
    .eq('job_id', jobId);
  
  const failedCount = afterChunks?.filter(c => c.status === 'failed').length || 0;
  if (failedCount > 0 && failedCount === afterChunks?.length) {
    throw new Error(`All ${failedCount} chunks failed summarization`);
  }
}

async function stepActionExtraction(job: ResourceJob, jobId: string) {
  const { data: chunks } = await supabase
    .from('resource_chunks')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'completed')
    .order('chunk_index', { ascending: true });
  
  if (!chunks || chunks.length === 0) return;

  // Combine summaries for action extraction
  const combinedSummary = chunks
    .map(c => c.summary)
    .filter(Boolean)
    .join('\n\n');

  if (combinedSummary.length < 50) return;

  const result = await trackedInvoke<{ actions: unknown[] }>('extract-tasks', {
    body: { text: combinedSummary, source: 'resource_pipeline' },
    traceId: job.trace_id,
    componentName: 'ResourcePipeline',
  });

  if (result.data && Array.isArray((result.data as any)?.tasks)) {
    await supabase.from('resource_jobs').update({
      metadata: {
        ...(job.metadata || {}),
        extracted_actions: (result.data as any).tasks,
      },
    }).eq('id', job.id);
  }
}

async function stepArtifactCreation(job: ResourceJob, resource: Record<string, unknown>) {
  // Invoke operationalize to create digest
  const result = await trackedInvoke('operationalize-resource', {
    body: { resource_id: job.resource_id },
    traceId: job.trace_id,
    componentName: 'ResourcePipeline',
  });
  
  if (result.error) {
    // Non-fatal: digest creation is bonus
    logger.warn('Artifact creation partial failure', { jobId: job.id, error: result.error.message });
  }
}

// ── Resume / Retry ─────────────────────────────────────────
export async function retryJob(jobId: string): Promise<{ success: boolean; completedSteps: string[]; failedStep?: string }> {
  // Find the first failed step
  const { data: steps } = await supabase
    .from('resource_job_steps')
    .select('*')
    .eq('job_id', jobId)
    .order('sequence', { ascending: true });
  
  if (!steps) throw new Error('No steps found');

  const failedStep = steps.find(s => s.status === 'failed');
  if (!failedStep) {
    // No failed step — check if just needs to continue
    const pendingStep = steps.find(s => s.status === 'pending');
    if (pendingStep) {
      return runPipeline(jobId, { resumeFromStep: pendingStep.step_name as StepName });
    }
    return { success: true, completedSteps: steps.map(s => s.step_name) };
  }

  // Reset the failed step
  await supabase.from('resource_job_steps').update({
    status: 'pending',
    error_category: null,
    error_message: null,
    started_at: null,
    ended_at: null,
    retry_count: (failedStep.retry_count || 0) + 1,
  }).eq('id', failedStep.id);

  // Increment job retry count
  await supabase.from('resource_jobs').update({
    retry_count: (await supabase.from('resource_jobs').select('retry_count').eq('id', jobId).single()).data?.retry_count || 0 + 1,
    error_category: null,
    error_message: null,
  }).eq('id', jobId);

  return runPipeline(jobId, { resumeFromStep: failedStep.step_name as StepName });
}

// ── Query Helpers ──────────────────────────────────────────
export async function getJobWithSteps(jobId: string) {
  const [jobResult, stepsResult] = await Promise.all([
    supabase.from('resource_jobs').select('*').eq('id', jobId).single(),
    supabase.from('resource_job_steps').select('*').eq('job_id', jobId).order('sequence', { ascending: true }),
  ]);
  return { job: jobResult.data as ResourceJob | null, steps: (stepsResult.data || []) as ResourceJobStep[] };
}

export async function getJobsForResource(resourceId: string) {
  const { data } = await supabase
    .from('resource_jobs')
    .select('*')
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(5);
  return (data || []) as ResourceJob[];
}
