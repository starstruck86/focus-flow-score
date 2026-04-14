/**
 * Extraction Pipeline Engine
 *
 * Automated batch extraction with priority scoring, fallback logic,
 * structured block diagnostics, and lightweight extraction mode.
 *
 * Layers on top of existing autoOperationalize pipeline.
 */

import { supabase } from '@/integrations/supabase/client';
import { autoOperationalizeResource, type AutoOperationalizeResult } from './autoOperationalize';
import { createLogger } from './logger';

const log = createLogger('ExtractionPipeline');

// ── Block Reason Codes ─────────────────────────────────────

export const BLOCK_REASONS = {
  missing_transcript: { label: 'Missing Transcript', autoFixable: true, nextAction: 'Fetch native transcript or captions', terminal: false },
  parser_failure: { label: 'Parser Failure', autoFixable: true, nextAction: 'Retry with alternate parser', terminal: false },
  unsupported_format: { label: 'Unsupported Format', autoFixable: false, nextAction: 'Convert format or extract metadata', terminal: false },
  auth_restricted: { label: 'Auth Restricted', autoFixable: false, nextAction: 'Provide credentials or paste content', terminal: false },
  insufficient_content: { label: 'Insufficient Content', autoFixable: true, nextAction: 'Re-enrich or accept lightweight extraction', terminal: false },
  duplicate_suspected: { label: 'Duplicate Suspected', autoFixable: true, nextAction: 'Resolve duplicate cluster', terminal: false },
  metadata_only: { label: 'Metadata Only', autoFixable: false, nextAction: 'Accept as reference or provide content', terminal: true },
  timeout: { label: 'Timeout', autoFixable: true, nextAction: 'Retry with longer timeout', terminal: false },
  rate_limited: { label: 'Rate Limited', autoFixable: true, nextAction: 'Retry after cooldown', terminal: false },
  corrupted_content: { label: 'Corrupted Content', autoFixable: false, nextAction: 'Re-upload or provide clean source', terminal: true },
} as const;

export type BlockReasonCode = keyof typeof BLOCK_REASONS;

// ── Pipeline Queue Categories ──────────────────────────────

export type PipelineQueue =
  | 'high_value_ready'
  | 'high_value_recoverable'
  | 'low_value_duplicate'
  | 'needs_human_review'
  | 'terminal_blocked'
  | 'completed'
  | 'unscored';

export const QUEUE_LABELS: Record<PipelineQueue, string> = {
  high_value_ready: 'High Value — Ready',
  high_value_recoverable: 'High Value — Recoverable',
  low_value_duplicate: 'Low Value / Duplicate',
  needs_human_review: 'Needs Human Review',
  terminal_blocked: 'Terminal — Blocked',
  completed: 'Completed',
  unscored: 'Unscored',
};

// ── Job Scopes ─────────────────────────────────────────────

export type JobScope =
  | 'all_ready'
  | 'top_priority'
  | 'retry_recoverable'
  | 'new_resources'
  | 'by_source'
  | 'by_tag';

export const JOB_SCOPE_LABELS: Record<JobScope, string> = {
  all_ready: 'Extract All Ready',
  top_priority: 'Extract Top Priority',
  retry_recoverable: 'Retry Recoverable Blocked',
  new_resources: 'Auto-Extract New Resources',
  by_source: 'Extract by Source',
  by_tag: 'Extract by Tag/Category',
};

// ── Priority Scoring ───────────────────────────────────────

export interface PriorityFactors {
  contentRichness: number;    // 0-1 based on content length
  actionability: number;      // 0-1 based on content signals
  uniqueness: number;         // 0-1 inverse of duplicate risk
  freshness: number;          // 0-1 based on age
  extractionLikelihood: number; // 0-1 based on past success
  strategicFit: number;       // 0-1 based on tag relevance
}

const STRATEGIC_TAGS = ['discovery', 'outbound', 'objection_handling', 'executive_messaging', 'demo', 'cold_calling', 'negotiation'];

export function computePriorityScore(resource: any): { score: number; factors: PriorityFactors } {
  const contentLen = resource.content?.length ?? resource.content_length ?? 0;
  const contentRichness = Math.min(contentLen / 5000, 1);

  const content = (resource.content ?? '').toLowerCase();
  const actionSignals = ['question', 'ask', 'say', 'script', 'template', 'example', 'framework', 'tactic', 'objection', 'rebuttal'];
  const actionHits = actionSignals.filter(s => content.includes(s)).length;
  const actionability = Math.min(actionHits / 4, 1);

  const uniqueness = resource.block_reason === 'duplicate_suspected' ? 0.2 : 0.8;

  const ageMs = Date.now() - new Date(resource.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const freshness = Math.max(0, 1 - ageDays / 365);

  const failCount = resource.failure_count ?? 0;
  const extractionLikelihood = contentLen > 300 ? Math.max(0.2, 1 - failCount * 0.25) : 0.3;

  const tags: string[] = resource.tags ?? [];
  const strategicHits = tags.filter(t => STRATEGIC_TAGS.some(s => t.includes(s))).length;
  const strategicFit = Math.min(strategicHits / 2, 1);

  const factors: PriorityFactors = { contentRichness, actionability, uniqueness, freshness, extractionLikelihood, strategicFit };

  const score = (
    contentRichness * 0.20 +
    actionability * 0.25 +
    uniqueness * 0.10 +
    freshness * 0.10 +
    extractionLikelihood * 0.15 +
    strategicFit * 0.20
  ) * 100;

  return { score: Math.round(score * 10) / 10, factors };
}

// ── Block Diagnosis ────────────────────────────────────────

export function diagnoseBlockReason(resource: any): {
  reason: BlockReasonCode | null;
  autoFixable: boolean;
  nextAction: string;
  terminal: boolean;
} {
  const contentLen = resource.content?.length ?? resource.content_length ?? 0;
  const enrichStatus = resource.enrichment_status ?? '';
  const failureReason = (resource.failure_reason ?? '').toLowerCase();
  const resourceType = (resource.resource_type ?? '').toLowerCase();

  // Auth-gated
  if (failureReason.includes('auth') || failureReason.includes('login') || failureReason.includes('403') || failureReason.includes('access_denied')) {
    return { reason: 'auth_restricted', ...BLOCK_REASONS.auth_restricted };
  }

  // Timeout
  if (failureReason.includes('timeout') || failureReason.includes('timed out')) {
    return { reason: 'timeout', ...BLOCK_REASONS.timeout };
  }

  // Rate limited
  if (failureReason.includes('rate') || failureReason.includes('429') || failureReason.includes('throttl')) {
    return { reason: 'rate_limited', ...BLOCK_REASONS.rate_limited };
  }

  // Missing transcript for audio/video
  if (['podcast', 'audio', 'video'].some(t => resourceType.includes(t)) && contentLen < 200) {
    return { reason: 'missing_transcript', ...BLOCK_REASONS.missing_transcript };
  }

  // Corrupted content (HTML/CSS garbage)
  if (resource.content_classification === 'auth_gated' || failureReason.includes('corrupt')) {
    return { reason: 'corrupted_content', ...BLOCK_REASONS.corrupted_content };
  }

  // Parser failure
  if (failureReason.includes('parse') || failureReason.includes('extract')) {
    return { reason: 'parser_failure', ...BLOCK_REASONS.parser_failure };
  }

  // Insufficient content
  if (contentLen > 0 && contentLen < 200) {
    return { reason: 'insufficient_content', ...BLOCK_REASONS.insufficient_content };
  }

  // Metadata only (no content at all)
  if (contentLen === 0 && enrichStatus !== 'not_enriched') {
    return { reason: 'metadata_only', ...BLOCK_REASONS.metadata_only };
  }

  return { reason: null, autoFixable: false, nextAction: '', terminal: false };
}

// ── Lightweight Extraction ─────────────────────────────────

export function createLightweightExtraction(resource: any): Record<string, unknown> {
  const tags: string[] = resource.tags ?? [];
  return {
    title: resource.title ?? 'Untitled',
    source: resource.source_url ?? resource.url ?? null,
    content_type: resource.resource_type ?? 'unknown',
    summary: resource.description ?? resource.title ?? '',
    likely_use_cases: tags.filter(t => t.startsWith('context:') || t.startsWith('skill:')).map(t => t.split(':')[1]),
    tags,
    confidence_score: 0.3,
    extraction_mode: 'lightweight',
    extraction_limitations: 'Full content unavailable — metadata-only extraction',
    why_blocked: resource.block_reason ?? 'unknown',
    created_at: new Date().toISOString(),
  };
}

// ── Queue Assignment ───────────────────────────────────────

export function assignQueue(resource: any, priorityScore: number, hasActiveKI: boolean): PipelineQueue {
  if (hasActiveKI) return 'completed';

  const contentLen = resource.content?.length ?? resource.content_length ?? 0;
  const blockReason = resource.block_reason as BlockReasonCode | null;

  if (blockReason && BLOCK_REASONS[blockReason]?.terminal) return 'terminal_blocked';

  if (contentLen >= 200 && priorityScore >= 50) return 'high_value_ready';
  if (contentLen < 200 && blockReason && !BLOCK_REASONS[blockReason]?.terminal && priorityScore >= 40) return 'high_value_recoverable';
  if (blockReason === 'duplicate_suspected') return 'low_value_duplicate';
  if (priorityScore < 30) return 'low_value_duplicate';

  return 'needs_human_review';
}

// ── Batch Pipeline Orchestrator ────────────────────────────

export interface BatchJobConfig {
  scope: JobScope;
  userId: string;
  filterSource?: string;
  filterTag?: string;
  maxResources?: number;
  onProgress?: (processed: number, total: number, currentTitle: string) => void;
  /** Called after each resource finishes (success, fail, or skip) — use for incremental UI updates */
  onResourceComplete?: (resourceId: string, outcome: 'success' | 'failed' | 'skipped', index: number, total: number) => void;
  signal?: AbortSignal;
}

export interface BatchJobResult {
  jobId: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: Array<{ resourceId: string; title: string; outcome: 'success' | 'failed' | 'skipped'; reason?: string }>;
}

export async function runBatchExtraction(config: BatchJobConfig): Promise<BatchJobResult> {
  const { scope, userId, filterSource, filterTag, maxResources = 100, onProgress, onResourceComplete, signal } = config;

  // Create job record
  const { data: job } = await (supabase as any).from('extraction_pipeline_jobs').insert({
    user_id: userId,
    job_type: 'batch_extract',
    job_scope: scope,
    status: 'running',
    filter_criteria: { source: filterSource, tag: filterTag, maxResources },
    started_at: new Date().toISOString(),
  }).select('id').single();

  const jobId = job?.id ?? 'unknown';

  // Fetch candidate resources
  let query = (supabase as any).from('resources')
    .select('id, title, content_length, content, tags, resource_type, enrichment_status, failure_reason, failure_count, source_url, created_at, block_reason, block_terminal, extraction_priority_score, content_classification')
    .eq('user_id', userId);

  // Apply scope filters
  switch (scope) {
    case 'all_ready':
      query = query.in('enrichment_status', ['enriched', 'deep_enriched', 'verified']).not('enrichment_status', 'eq', 'failed');
      break;
    case 'top_priority':
      query = query.gte('extraction_priority_score', 50).order('extraction_priority_score', { ascending: false });
      break;
    case 'retry_recoverable':
      query = query.eq('block_auto_fixable', true).eq('block_terminal', false);
      break;
    case 'new_resources':
      query = query.is('block_reason', null).is('pipeline_queue', null).or('pipeline_queue.eq.unscored');
      break;
    case 'by_source':
      if (filterSource) query = query.ilike('source_url', `%${filterSource}%`);
      break;
    case 'by_tag':
      if (filterTag) query = query.contains('tags', [filterTag]);
      break;
  }

  query = query.limit(maxResources);
  const { data: resources } = await query;

  if (!resources?.length) {
    await (supabase as any).from('extraction_pipeline_jobs').update({
      status: 'completed', total_resources: 0, completed_at: new Date().toISOString(),
    }).eq('id', jobId);
    return { jobId, total: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  // Score and sort by priority
  const scored = resources.map((r: any) => {
    const { score, factors } = computePriorityScore(r);
    return { ...r, _score: score, _factors: factors };
  }).sort((a: any, b: any) => b._score - a._score);

  await (supabase as any).from('extraction_pipeline_jobs').update({
    total_resources: scored.length,
  }).eq('id', jobId);

  const results: BatchJobResult['results'] = [];
  let succeeded = 0, failed = 0, skipped = 0;

  for (let i = 0; i < scored.length; i++) {
    if (signal?.aborted) {
      await (supabase as any).from('extraction_pipeline_jobs').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(),
        processed_count: i, success_count: succeeded, failed_count: failed, skipped_count: skipped,
      }).eq('id', jobId);
      break;
    }

    const r = scored[i];
    onProgress?.(i + 1, scored.length, r.title ?? 'Untitled');

    // Score & diagnose before processing
    const diagnosis = diagnoseBlockReason(r);
    const queue = assignQueue(r, r._score, false);

    // Update resource metadata
    await (supabase as any).from('resources').update({
      extraction_priority_score: r._score,
      extraction_priority_factors: r._factors,
      block_reason: diagnosis.reason,
      block_auto_fixable: diagnosis.autoFixable,
      block_next_action: diagnosis.nextAction,
      block_terminal: diagnosis.terminal,
      pipeline_queue: queue,
    }).eq('id', r.id);

    // Skip terminal or non-extractable
    const contentLen = r.content?.length ?? r.content_length ?? 0;
    if (diagnosis.terminal || contentLen < 100) {
      // Create lightweight extraction for blocked items
      if (contentLen < 100 && !diagnosis.terminal) {
        const lightweight = createLightweightExtraction(r);
        await (supabase as any).from('resources').update({
          lightweight_extraction: lightweight,
          pipeline_queue: 'terminal_blocked',
        }).eq('id', r.id);
      }
      skipped++;
      results.push({ resourceId: r.id, title: r.title, outcome: 'skipped', reason: diagnosis.nextAction || 'No extractable content' });
      continue;
    }

    // Run extraction
    try {
      const result = await autoOperationalizeResource(r.id);

      if (result.operationalized || result.knowledgeExtracted > 0) {
        succeeded++;
        await (supabase as any).from('resources').update({
          pipeline_queue: 'completed',
          block_reason: null,
          block_auto_fixable: false,
          block_next_action: null,
          block_terminal: false,
        }).eq('id', r.id);
        results.push({ resourceId: r.id, title: r.title, outcome: 'success', reason: `${result.knowledgeExtracted} extracted, ${result.knowledgeActivated} activated` });
        onResourceComplete?.(r.id, 'success', i, scored.length);
      } else if (result.needsReview) {
        skipped++;
        await (supabase as any).from('resources').update({
          pipeline_queue: 'needs_human_review',
          block_retry_count: (r.block_retry_count ?? 0) + 1,
          block_last_attempt_at: new Date().toISOString(),
        }).eq('id', r.id);
        results.push({ resourceId: r.id, title: r.title, outcome: 'skipped', reason: result.reason });
        onResourceComplete?.(r.id, 'skipped', i, scored.length);
      } else {
        failed++;
        results.push({ resourceId: r.id, title: r.title, outcome: 'failed', reason: result.reason });
        onResourceComplete?.(r.id, 'failed', i, scored.length);
      }
    } catch (err: any) {
      failed++;
      await (supabase as any).from('resources').update({
        block_retry_count: (r.block_retry_count ?? 0) + 1,
        block_last_attempt_at: new Date().toISOString(),
      }).eq('id', r.id);
      results.push({ resourceId: r.id, title: r.title, outcome: 'failed', reason: err.message });
      onResourceComplete?.(r.id, 'failed', i, scored.length);
    }

    // Update job progress — save every resource so progress persists if window closes
    await (supabase as any).from('extraction_pipeline_jobs').update({
      processed_count: i + 1,
      success_count: succeeded,
      failed_count: failed,
      skipped_count: skipped,
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);
  }

  // Finalize job
  await (supabase as any).from('extraction_pipeline_jobs').update({
    status: signal?.aborted ? 'cancelled' : 'completed',
    processed_count: results.length,
    success_count: succeeded,
    failed_count: failed,
    skipped_count: skipped,
    completed_at: new Date().toISOString(),
    error_summary: { failedResources: results.filter(r => r.outcome === 'failed').map(r => ({ id: r.resourceId, reason: r.reason })) },
  }).eq('id', jobId);

  log.info('Batch extraction complete', { jobId, total: scored.length, succeeded, failed, skipped });

  return { jobId, total: scored.length, processed: results.length, succeeded, failed, skipped, results };
}

// ── Score All Resources (one-time or periodic) ─────────────

export async function scoreAllResources(userId: string): Promise<{ scored: number }> {
  const { data: resources } = await (supabase as any).from('resources')
    .select('id, title, content_length, content, tags, resource_type, enrichment_status, failure_reason, failure_count, source_url, created_at, block_reason, content_classification')
    .eq('user_id', userId);

  if (!resources?.length) return { scored: 0 };

  // Get active KI counts
  const { data: kiCounts } = await (supabase as any).from('knowledge_items')
    .select('source_resource_id')
    .eq('user_id', userId)
    .eq('active', true);

  const activeKIByResource = new Set((kiCounts ?? []).map((k: any) => k.source_resource_id));

  let scored = 0;
  for (const r of resources) {
    const { score, factors } = computePriorityScore(r);
    const diagnosis = diagnoseBlockReason(r);
    const hasActiveKI = activeKIByResource.has(r.id);
    const queue = assignQueue(r, score, hasActiveKI);

    await (supabase as any).from('resources').update({
      extraction_priority_score: score,
      extraction_priority_factors: factors,
      block_reason: diagnosis.reason,
      block_auto_fixable: diagnosis.autoFixable,
      block_next_action: diagnosis.nextAction,
      block_terminal: diagnosis.terminal,
      pipeline_queue: queue,
    }).eq('id', r.id);
    scored++;
  }

  return { scored };
}

// ── Pipeline Stats Query ───────────────────────────────────

export interface PipelineStats {
  total: number;
  ready: number;
  blocked: number;
  extracted: number;
  completed: number;
  blockedBreakdown: Record<string, number>;
  recoverableBlocked: number;
  terminalBlocked: number;
  queueBreakdown: Record<string, number>;
  pendingJobs: number;
  recentJobs: any[];
}

export async function getPipelineStats(userId: string): Promise<PipelineStats> {
  const { data: resources } = await (supabase as any).from('resources')
    .select('id, pipeline_queue, block_reason, block_terminal, block_auto_fixable, content_length, enrichment_status')
    .eq('user_id', userId);

  const { data: kiData } = await (supabase as any).from('knowledge_items')
    .select('source_resource_id, active')
    .eq('user_id', userId)
    .eq('active', true);

  const { data: jobs } = await (supabase as any).from('extraction_pipeline_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Also fetch canonical lifecycle for truth-aligned blocked count
  const { data: lifecycleData } = await (supabase as any).from('canonical_resource_status')
    .select('resource_id, canonical_stage, blocked_reason')
    .eq('user_id', userId);

  const all = resources ?? [];
  const activeKIResources = new Set((kiData ?? []).map((k: any) => k.source_resource_id));
  const lifecycleMap = new Map<string, { stage: string; blocked: string }>();
  for (const lc of (lifecycleData ?? [])) {
    lifecycleMap.set(lc.resource_id, { stage: lc.canonical_stage, blocked: lc.blocked_reason });
  }

  const blockedBreakdown: Record<string, number> = {};
  let recoverableBlocked = 0, terminalBlocked = 0, ready = 0, blocked = 0, extracted = 0, completed = 0;
  // Canonical blocked count aligned with Control Plane / SystemHealthBar
  let canonicalBlocked = 0;
  const queueBreakdown: Record<string, number> = {};

  for (const r of all) {
    const q = r.pipeline_queue ?? 'unscored';
    queueBreakdown[q] = (queueBreakdown[q] ?? 0) + 1;

    if (activeKIResources.has(r.id)) {
      completed++;
    } else if (['enriched', 'deep_enriched', 'verified'].includes(r.enrichment_status)) {
      ready++;
    }

    // Pipeline-specific block_reason (detail breakdown)
    if (r.block_reason) {
      blocked++;
      blockedBreakdown[r.block_reason] = (blockedBreakdown[r.block_reason] ?? 0) + 1;
      if (r.block_terminal) terminalBlocked++;
      else recoverableBlocked++;
    }

    // Canonical lifecycle blocked (aligned with Control Plane)
    const lc = lifecycleMap.get(r.id);
    if (lc && lc.blocked !== 'none') {
      canonicalBlocked++;
    }

    if (activeKIResources.has(r.id)) extracted++;
  }

  const pendingJobs = (jobs ?? []).filter((j: any) => j.status === 'running' || j.status === 'queued').length;

  return {
    total: all.length,
    ready,
    blocked: canonicalBlocked, // Use canonical count for top-level stat (aligned with Control Plane)
    pipelineBlocked: blocked,  // Pipeline-specific blocked (for detail breakdown)
    extracted,
    completed,
    blockedBreakdown,
    recoverableBlocked,
    terminalBlocked,
    queueBreakdown,
    pendingJobs,
    recentJobs: jobs ?? [],
  };
}
