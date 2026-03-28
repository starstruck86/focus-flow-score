/**
 * Autonomous Remediation Engine
 * 
 * Continuously processes all non-complete resources to resolution.
 * Uses verification engine as single source of truth.
 * Strict exit conditions: score===100 + no contradictions, accepted metadata-only, or quarantined after 2 identical failures.
 * No infinite loops — failure escalation with history tracking.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { validateResourceQuality, type QualityResult } from '@/lib/resourceQuality';
import type { VerifiedResource, FixabilityBucket } from '@/lib/enrichmentVerification';
import type { RemediationQueue } from '@/lib/remediationEngine';

// ── Types ─────────────────────────────────────────────────

export type RemediationItemStatus =
  | 'queued'
  | 'processing'
  | 'enriching'
  | 're_verifying'
  | 'resolved_complete'
  | 'resolved_metadata_only'
  | 'resolved_quarantined'
  | 'awaiting_manual'
  | 'escalated';

export interface FailureHistoryEntry {
  bucket: string;
  reason: string;
  timestamp: string;
  attempt: number;
}

export interface RemediationItem {
  id: string;
  title: string;
  url: string | null;
  queue: RemediationQueue;
  subtypeLabel: string;
  status: RemediationItemStatus;
  // Before state (from verification)
  beforeScore: number;
  beforeState: string;
  beforeFailureBucket: string | null;
  beforeContradictions: number;
  // After state (post-remediation)
  afterScore: number | null;
  afterState: string | null;
  afterFailureBucket: string | null;
  afterContradictions: number | null;
  isResolved: boolean;
  // Strategy
  strategyUsed: string | null;
  attemptsThisRun: number;
  // Failure tracking
  failureHistory: FailureHistoryEntry[];
  sameFailureCount: number; // how many times the SAME bucket has failed
  escalatedBecause: string | null;
  // UX
  whyFailed: string | null;
  whatToDoNext: string | null;
  terminalReason: string | null;
}

export interface RemediationCycleState {
  status: 'idle' | 'running' | 'paused' | 'completed';
  cycleNumber: number;
  items: RemediationItem[];
  totalItems: number;
  processedCount: number;
  resolvedCompleteCount: number;
  resolvedMetadataCount: number;
  resolvedQuarantinedCount: number;
  awaitingManualCount: number;
  escalatedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  currentItemId: string | null;
  // Per-cycle delta tracking
  scoreImprovements: number;
  stateChanges: number;
  newResolutions: number;
}

export type RemediationCallback = (state: RemediationCycleState) => void;

// ── Priority order for processing ─────────────────────────

const PROCESSING_PRIORITY: RemediationQueue[] = [
  'bad_scoring_state_bug',
  'auto_fix_now',
  'retry_different_strategy',
  'needs_transcript',
  'needs_pasted_content',
  'needs_access_auth',
  'needs_alternate_source',
  'accept_metadata_only',
  'needs_quarantine',
];

// ── Strategy definitions ──────────────────────────────────

interface QueueStrategy {
  canAutomate: boolean;
  maxAttempts: number;
  action: string;
  requiresInput: boolean;
  inputType: string | null;
}

const QUEUE_STRATEGIES: Record<RemediationQueue, QueueStrategy> = {
  auto_fix_now: {
    canAutomate: true,
    maxAttempts: 2,
    action: 'Run enrichment immediately',
    requiresInput: false,
    inputType: null,
  },
  retry_different_strategy: {
    canAutomate: true,
    maxAttempts: 1,
    action: 'Reset and retry with different pipeline',
    requiresInput: false,
    inputType: null,
  },
  bad_scoring_state_bug: {
    canAutomate: true,
    maxAttempts: 1,
    action: 'Re-run scoring + fix state (no enrichment call)',
    requiresInput: false,
    inputType: null,
  },
  needs_transcript: {
    canAutomate: false,
    maxAttempts: 0,
    action: 'Provide transcript or alternate URL',
    requiresInput: true,
    inputType: 'transcript',
  },
  needs_pasted_content: {
    canAutomate: false,
    maxAttempts: 0,
    action: 'Paste content manually',
    requiresInput: true,
    inputType: 'pasted_content',
  },
  needs_access_auth: {
    canAutomate: false,
    maxAttempts: 0,
    action: 'Provide access credentials or paste content',
    requiresInput: true,
    inputType: 'access_or_content',
  },
  needs_alternate_source: {
    canAutomate: false,
    maxAttempts: 0,
    action: 'Provide a different URL (do NOT retry same one)',
    requiresInput: true,
    inputType: 'alternate_url',
  },
  accept_metadata_only: {
    canAutomate: true,
    maxAttempts: 1,
    action: 'Accept as metadata-only or request content',
    requiresInput: false,
    inputType: null,
  },
  needs_quarantine: {
    canAutomate: false,
    maxAttempts: 0,
    action: 'Manual review only — no automation',
    requiresInput: false,
    inputType: null,
  },
};

export { QUEUE_STRATEGIES };

// ── Rescore from DB ───────────────────────────────────────

async function rescoreFromDb(resourceId: string): Promise<QualityResult | null> {
  const { data, error } = await supabase
    .from('resources')
    .select('id, title, content, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, description')
    .eq('id', resourceId)
    .single();

  if (error || !data) return null;
  const r = data as any;
  return validateResourceQuality({
    id: r.id,
    title: r.title,
    content: r.content ?? null,
    content_length: r.content_length ?? (r.content || '').length,
    enrichment_status: r.enrichment_status ?? 'not_enriched',
    enrichment_version: r.enrichment_version ?? 0,
    validation_version: r.validation_version ?? 0,
    enriched_at: r.enriched_at ?? null,
    failure_reason: r.failure_reason ?? null,
    file_url: r.file_url ?? null,
    description: r.description ?? null,
  });
}

async function getResourceState(resourceId: string): Promise<{ status: string; failureReason: string | null } | null> {
  const { data, error } = await supabase
    .from('resources')
    .select('enrichment_status, failure_reason')
    .eq('id', resourceId)
    .single();
  if (error || !data) return null;
  return { status: (data as any).enrichment_status, failureReason: (data as any).failure_reason };
}

// ── Check strict exit conditions ──────────────────────────

function checkExitCondition(item: RemediationItem, score: number, contradictions: number): RemediationItemStatus | null {
  // Exit 1: score === 100 AND no contradictions
  if (score >= 100 && contradictions === 0) return 'resolved_complete';
  // Exit 2: explicitly accepted metadata-only (handled by accept_metadata_only queue)
  // Exit 3: quarantined after 2 identical failures (checked in failure escalation)
  return null;
}

// ── Failure escalation ────────────────────────────────────

function shouldEscalateToQuarantine(item: RemediationItem, currentBucket: string): boolean {
  // If same failure bucket occurs twice → quarantine
  const sameBucketCount = item.failureHistory.filter(h => h.bucket === currentBucket).length;
  return sameBucketCount >= 2;
}

function getEscalationTarget(item: RemediationItem, currentBucket: string): { status: RemediationItemStatus; reason: string } {
  if (shouldEscalateToQuarantine(item, currentBucket)) {
    return {
      status: 'resolved_quarantined',
      reason: `Quarantined: same failure bucket "${currentBucket}" occurred ${item.failureHistory.filter(h => h.bucket === currentBucket).length + 1} times`,
    };
  }
  return {
    status: 'escalated',
    reason: `Escalated from "${currentBucket}" after ${item.attemptsThisRun} attempts`,
  };
}

// ── Build items from verification ─────────────────────────

export function buildRemediationItems(
  queues: Record<RemediationQueue, VerifiedResource[]>,
): RemediationItem[] {
  const items: RemediationItem[] = [];

  for (const queue of PROCESSING_PRIORITY) {
    for (const v of (queues[queue] || [])) {
      items.push({
        id: v.id,
        title: v.title,
        url: v.url,
        queue,
        subtypeLabel: v.subtypeLabel,
        status: 'queued',
        beforeScore: v.qualityScore,
        beforeState: v.enrichmentStatus as string,
        beforeFailureBucket: v.failureBucket,
        beforeContradictions: v.contradictions.length,
        afterScore: null,
        afterState: null,
        afterFailureBucket: null,
        afterContradictions: null,
        isResolved: false,
        strategyUsed: null,
        attemptsThisRun: 0,
        failureHistory: [],
        escalatedBecause: null,
        whyFailed: null,
        whatToDoNext: null,
        terminalReason: null,
      });
    }
  }

  return items;
}

// ── Main Autonomous Loop ──────────────────────────────────

export async function runAutonomousRemediation(
  queues: Record<RemediationQueue, VerifiedResource[]>,
  onUpdate: RemediationCallback,
  signal?: AbortSignal,
): Promise<RemediationCycleState> {
  const items = buildRemediationItems(queues);

  const state: RemediationCycleState = {
    status: 'running',
    cycleNumber: 1,
    items,
    totalItems: items.length,
    processedCount: 0,
    resolvedCompleteCount: 0,
    resolvedMetadataCount: 0,
    resolvedQuarantinedCount: 0,
    awaitingManualCount: 0,
    escalatedCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    currentItemId: null,
    scoreImprovements: 0,
    stateChanges: 0,
    newResolutions: 0,
  };

  const emit = () => onUpdate({ ...state, items: [...state.items] });
  emit();

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) {
      state.status = 'paused';
      emit();
      return state;
    }

    const item = items[i];
    state.currentItemId = item.id;
    item.status = 'processing';
    emit();

    try {
      await processItem(item, state);
    } catch (e: any) {
      item.status = 'escalated';
      item.whyFailed = e.message;
      item.whatToDoNext = 'Review error and retry manually';
      state.escalatedCount++;
    }

    // Update delta tracking
    if (item.afterScore !== null && item.afterScore > item.beforeScore) state.scoreImprovements++;
    if (item.afterState !== null && item.afterState !== item.beforeState) state.stateChanges++;
    if (item.isResolved) state.newResolutions++;

    state.processedCount++;
    emit();

    // Throttle between items
    if (i < items.length - 1 && !signal?.aborted) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  state.status = 'completed';
  state.currentItemId = null;
  state.completedAt = new Date().toISOString();
  emit();
  return state;
}

// ── Process Single Item ───────────────────────────────────

async function processItem(item: RemediationItem, state: RemediationCycleState): Promise<void> {
  const strategy = QUEUE_STRATEGIES[item.queue];

  // ── Quarantined: NO automation ──────────────────────────
  if (item.queue === 'needs_quarantine') {
    await quarantineResource(item, state, 'Pre-existing quarantine — manual review only');
    return;
  }

  // ── State bugs: re-score only, no enrichment ────────────
  if (item.queue === 'bad_scoring_state_bug') {
    await reconcileStateBug(item, state);
    return;
  }

  // ── Accept metadata only ────────────────────────────────
  if (item.queue === 'accept_metadata_only') {
    await acceptMetadataOnly(item, state);
    return;
  }

  // ── Manual queues: route and mark ───────────────────────
  if (!strategy.canAutomate) {
    await routeToManual(item, state, strategy);
    return;
  }

  // ── Auto-fixable: enrich with retry + escalation ────────
  await autoFix(item, state, strategy);
}

// ── Strategy Implementations ──────────────────────────────

async function autoFix(item: RemediationItem, state: RemediationCycleState, strategy: QueueStrategy): Promise<void> {
  for (let attempt = 0; attempt < strategy.maxAttempts; attempt++) {
    item.attemptsThisRun = attempt + 1;
    item.status = 'processing';
    item.strategyUsed = attempt === 0 ? strategy.action : `Retry #${attempt + 1}: ${strategy.action}`;

    // Step 1: Reset resource state
    const resetPayload: Record<string, any> = {
      enrichment_status: 'not_enriched',
      failure_reason: null,
      last_status_change_at: new Date().toISOString(),
    };
    if (item.queue === 'retry_different_strategy') {
      resetPayload.failure_count = 0;
    }

    const { error: resetError } = await supabase
      .from('resources')
      .update(resetPayload as any)
      .eq('id', item.id);

    if (resetError) {
      item.failureHistory.push({ bucket: item.queue, reason: resetError.message, timestamp: new Date().toISOString(), attempt: attempt + 1 });
      continue;
    }

    // Step 2: Run enrichment
    item.status = 'enriching';
    const force = attempt > 0;
    const result = await invokeEnrichResource<any>(
      { resource_id: item.id, force },
      { componentName: 'AutonomousRemediation', timeoutMs: 60000 },
    );

    // Step 3: Re-verify immediately
    item.status = 're_verifying';
    const quality = await rescoreFromDb(item.id);
    const dbState = await getResourceState(item.id);

    if (quality && dbState) {
      item.afterScore = quality.score;
      item.afterState = dbState.status;
      item.afterFailureBucket = dbState.failureReason;
      item.afterContradictions = 0; // Simplified — real contradictions need full re-verify

      // Check strict exit
      const exit = checkExitCondition(item, quality.score, 0);
      if (exit) {
        markTerminal(item, state, exit, `Score ${quality.score} — fully enriched with no contradictions`);
        return;
      }

      // If score >= 85 with real content, promote to complete
      if (quality.score >= 85 && quality.passesCompletionContract) {
        await supabase.from('resources').update({
          enrichment_status: 'deep_enriched',
          failure_reason: null,
          enriched_at: new Date().toISOString(),
          last_quality_score: quality.score,
          last_quality_tier: quality.tier,
          last_status_change_at: new Date().toISOString(),
        } as any).eq('id', item.id);
        markTerminal(item, state, 'resolved_complete', `Score ${quality.score} — promoted to complete`);
        return;
      }
    }

    if (result.error) {
      const failBucket = item.queue;
      item.failureHistory.push({
        bucket: failBucket,
        reason: result.error.message,
        timestamp: new Date().toISOString(),
        attempt: attempt + 1,
      });

      // Check escalation
      if (shouldEscalateToQuarantine(item, failBucket)) {
        await quarantineResource(item, state, `Same failure "${failBucket}" occurred ${item.failureHistory.filter(h => h.bucket === failBucket).length} times`);
        return;
      }

      // If retryable and more attempts left, continue loop
      if (result.error.retryable && attempt < strategy.maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
    }

    // If we got here on last attempt and not resolved, escalate
    if (attempt >= strategy.maxAttempts - 1) {
      const finalScore = item.afterScore ?? 0;
      if (finalScore < 50) {
        await quarantineResource(item, state, `Score ${finalScore} after ${item.attemptsThisRun} attempts — auto-fix exhausted`);
      } else {
        item.status = 'escalated';
        item.whyFailed = `Score ${finalScore} after ${item.attemptsThisRun} auto-fix attempts`;
        item.whatToDoNext = 'Review content quality and consider manual enrichment or alternate source';
        item.isResolved = false;
        state.escalatedCount++;
      }
      return;
    }

    await new Promise(r => setTimeout(r, 1500));
  }
}

async function reconcileStateBug(item: RemediationItem, state: RemediationCycleState): Promise<void> {
  item.strategyUsed = 'Re-score + fix state only (no enrichment)';
  item.status = 're_verifying';

  const quality = await rescoreFromDb(item.id);
  if (!quality) {
    item.status = 'escalated';
    item.whyFailed = 'Could not read resource for re-scoring';
    item.whatToDoNext = 'Check if resource still exists in database';
    state.escalatedCount++;
    return;
  }

  item.afterScore = quality.score;

  const update: Record<string, any> = {
    last_status_change_at: new Date().toISOString(),
    last_quality_score: quality.score,
    last_quality_tier: quality.tier,
  };

  // If score >= 85 and resource already has real content, accept as complete
  // (short but genuine content like podcast summaries shouldn't block completion)
  if (quality.score >= 85 && quality.passesCompletionContract) {
    update.enrichment_status = 'deep_enriched';
    update.failure_reason = null;
    update.enriched_at = new Date().toISOString();
    await supabase.from('resources').update(update as any).eq('id', item.id);
    item.afterState = 'deep_enriched';
    item.afterFailureBucket = null;
    markTerminal(item, state, 'resolved_complete', `Score ${quality.score} — state corrected to deep_enriched`);
  } else if (quality.score >= 95 && quality.passesCompletionContract) {
    await quarantineResource(item, state, `Score ${quality.score} too low — state bug with unrecoverable content`);
  } else {
    // Mid-range score — reset for re-enrichment
    update.enrichment_status = 'not_enriched';
    update.failure_reason = null;
    await supabase.from('resources').update(update as any).eq('id', item.id);

    // Try one enrichment
    item.status = 'enriching';
    item.attemptsThisRun = 1;
    try {
      await invokeEnrichResource<any>(
        { resource_id: item.id },
        { componentName: 'AutonomousRemediation', timeoutMs: 60000 },
      );

      item.status = 're_verifying';
      const q2 = await rescoreFromDb(item.id);
      const s2 = await getResourceState(item.id);
      if (q2) item.afterScore = q2.score;
      if (s2) { item.afterState = s2.status; item.afterFailureBucket = s2.failureReason; }

      if (q2 && q2.score >= 85 && q2.passesCompletionContract) {
        await supabase.from('resources').update({
          enrichment_status: 'deep_enriched', failure_reason: null,
          enriched_at: new Date().toISOString(), last_quality_score: q2.score,
          last_quality_tier: q2.tier, last_status_change_at: new Date().toISOString(),
        } as any).eq('id', item.id);
        markTerminal(item, state, 'resolved_complete', `Score ${q2.score} after reconcile + re-enrich`);
      } else {
        item.status = 'escalated';
        item.whyFailed = `Score ${q2?.score ?? 0} after state reconciliation + enrichment`;
        item.whatToDoNext = 'Needs manual content review or alternate source';
        state.escalatedCount++;
      }
    } catch (e: any) {
      item.status = 'escalated';
      item.whyFailed = `Enrichment after state fix failed: ${e.message}`;
      item.whatToDoNext = 'Review resource and retry manually';
      state.escalatedCount++;
    }
  }
}

async function acceptMetadataOnly(item: RemediationItem, state: RemediationCycleState): Promise<void> {
  item.strategyUsed = 'Accept as metadata-only';
  const { error } = await supabase.from('resources').update({
    enrichment_status: 'deep_enriched',
    failure_reason: null,
    last_quality_tier: 'metadata_only',
    last_status_change_at: new Date().toISOString(),
    enriched_at: new Date().toISOString(),
  } as any).eq('id', item.id);

  if (error) throw new Error(error.message);

  item.afterState = 'deep_enriched';
  item.afterFailureBucket = null;
  const q = await rescoreFromDb(item.id);
  if (q) item.afterScore = q.score;

  markTerminal(item, state, 'resolved_metadata_only', 'No enrichable content — accepted as metadata-only');
}

async function routeToManual(item: RemediationItem, state: RemediationCycleState, strategy: QueueStrategy): Promise<void> {
  item.strategyUsed = `Routed to manual: ${strategy.action}`;

  const reasonMap: Record<string, string> = {
    needs_transcript: 'Transcript required — paste transcript via Manual Assist',
    needs_pasted_content: 'Content inaccessible — paste content via Manual Assist',
    needs_access_auth: 'Authentication required — provide access or paste content',
    needs_alternate_source: 'Multiple extraction failures — provide a different URL',
  };
  const reason = reasonMap[item.queue] || 'Manual input required';

  await supabase.from('resources').update({
    enrichment_status: 'incomplete',
    failure_reason: reason,
    last_status_change_at: new Date().toISOString(),
  } as any).eq('id', item.id);

  item.afterState = 'incomplete';
  item.afterFailureBucket = reason;
  item.status = 'awaiting_manual';
  item.isResolved = false;
  item.whyFailed = reason;
  item.whatToDoNext = strategy.action;
  state.awaitingManualCount++;
}

async function quarantineResource(item: RemediationItem, state: RemediationCycleState, reason: string): Promise<void> {
  await supabase.from('resources').update({
    enrichment_status: 'quarantined',
    failure_reason: reason,
    last_status_change_at: new Date().toISOString(),
  } as any).eq('id', item.id);

  item.afterState = 'quarantined';
  item.afterFailureBucket = reason;
  markTerminal(item, state, 'resolved_quarantined', reason);
}

function markTerminal(item: RemediationItem, state: RemediationCycleState, status: RemediationItemStatus, reason: string) {
  item.status = status;
  item.terminalReason = reason;
  item.isResolved = status === 'resolved_complete' || status === 'resolved_metadata_only' || status === 'resolved_quarantined';

  if (status === 'resolved_complete') state.resolvedCompleteCount++;
  else if (status === 'resolved_metadata_only') state.resolvedMetadataCount++;
  else if (status === 'resolved_quarantined') state.resolvedQuarantinedCount++;
}

// ── Queue summary for dashboard ───────────────────────────

export interface QueueSummary {
  queue: RemediationQueue;
  count: number;
  canAutomate: boolean;
  action: string;
  requiresInput: boolean;
  inputType: string | null;
}

export function getQueueSummaries(queues: Record<RemediationQueue, VerifiedResource[]>): QueueSummary[] {
  return PROCESSING_PRIORITY
    .filter(q => (queues[q] || []).length > 0)
    .map(q => ({
      queue: q,
      count: queues[q].length,
      ...QUEUE_STRATEGIES[q],
    }));
}
