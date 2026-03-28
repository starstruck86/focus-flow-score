/**
 * Fix Broken Resources Engine
 * 
 * Processes real broken resources by bucket, applies the correct recovery strategy,
 * re-scores each resource after remediation, and enforces terminal states.
 * 
 * A resource stays in the queue until it either:
 * - Reaches score >= 100 (truly complete)
 * - Is explicitly accepted as metadata-only
 * - Is quarantined with a clear reason
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { validateResourceQuality, type QualityResult } from '@/lib/resourceQuality';
import { transitionToEnriched } from '@/lib/resourceLifecycle';
import type { VerifiedResource, FixabilityBucket } from '@/lib/enrichmentVerification';
import type { RemediationQueue } from '@/lib/remediationEngine';

// ── Fix Run Types ─────────────────────────────────────────

export type FixItemStatus =
  | 'pending'
  | 'processing'
  | 'enriching'
  | 're_scoring'
  | 'resolved_complete'      // score >= 100
  | 'resolved_metadata_only' // explicitly accepted
  | 'resolved_quarantined'   // quarantined with reason
  | 'awaiting_manual'        // needs human input, cannot auto-fix
  | 'failed_retry_exhausted' // tried everything automatic, still broken
  | 'skipped';               // not eligible for auto-fix in this pass

export interface FixItem {
  id: string;
  title: string;
  url: string | null;
  queue: RemediationQueue;
  subtypeLabel: string;
  status: FixItemStatus;
  previousScore: number;
  currentScore: number | null;
  previousTier: string;
  currentTier: string | null;
  previousState: string;
  currentState: string | null;
  previousFailureBucket: string | null;
  currentFailureBucket: string | null;
  attemptsThisRun: number;
  maxAttempts: number;
  actionTaken: string | null;
  failureReason: string | null;
  terminalReason: string | null;
  resolvedAt: string | null;
  isResolved: boolean;
}

export interface FixRunState {
  status: 'idle' | 'running' | 'paused' | 'completed';
  items: FixItem[];
  totalItems: number;
  processedCount: number;
  resolvedCount: number;
  quarantinedCount: number;
  metadataOnlyCount: number;
  manualRequiredCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  currentItemId: string | null;
}

export type FixRunCallback = (state: FixRunState) => void;

const INITIAL_FIX_STATE: FixRunState = {
  status: 'idle',
  items: [],
  totalItems: 0,
  processedCount: 0,
  resolvedCount: 0,
  quarantinedCount: 0,
  metadataOnlyCount: 0,
  manualRequiredCount: 0,
  failedCount: 0,
  skippedCount: 0,
  startedAt: null,
  completedAt: null,
  currentItemId: null,
};

// Max auto-enrichment attempts per resource per fix run
const MAX_AUTO_ATTEMPTS = 2;
// Queues that can be auto-fixed (re-enriched without human input)
const AUTO_FIXABLE_QUEUES: Set<RemediationQueue> = new Set([
  'auto_fix_now',
  'retry_different_strategy',
  'bad_scoring_state_bug',
]);

// Queues that require manual input — mark and skip
const MANUAL_QUEUES: Set<RemediationQueue> = new Set([
  'needs_transcript',
  'needs_pasted_content',
  'needs_access_auth',
  'needs_alternate_source',
]);

// ── Re-score a resource from DB ───────────────────────────

interface RescoreResult {
  quality: QualityResult;
  enrichmentStatus: string;
  failureReason: string | null;
}

async function rescoreResource(resourceId: string): Promise<RescoreResult | null> {
  const { data, error } = await supabase
    .from('resources')
    .select('id, title, content, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, description')
    .eq('id', resourceId)
    .single();

  if (error || !data) return null;

  const r = data as any;
  const quality = validateResourceQuality({
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

  return {
    quality,
    enrichmentStatus: r.enrichment_status ?? 'not_enriched',
    failureReason: r.failure_reason ?? null,
  };
}

/** Apply rescore results to item and determine resolution */
function applyRescore(item: FixItem, rs: RescoreResult) {
  item.currentScore = rs.quality.score;
  item.currentTier = rs.quality.tier;
  item.currentState = rs.enrichmentStatus;
  item.currentFailureBucket = rs.failureReason;
}

function markResolved(item: FixItem, status: FixItemStatus) {
  item.status = status;
  item.resolvedAt = new Date().toISOString();
  item.isResolved = status === 'resolved_complete' || status === 'resolved_metadata_only' || status === 'resolved_quarantined';
}

// ── Main Fix Engine ───────────────────────────────────────

export async function runFixBrokenResources(
  queues: Record<RemediationQueue, VerifiedResource[]>,
  onUpdate: FixRunCallback,
  signal?: AbortSignal,
): Promise<FixRunState> {
  // Build ordered item list: auto-fixable first, then state bugs, then manual
  const orderedQueues: RemediationQueue[] = [
    'auto_fix_now',
    'bad_scoring_state_bug',
    'retry_different_strategy',
    'accept_metadata_only',
    'needs_quarantine',
    'needs_transcript',
    'needs_pasted_content',
    'needs_access_auth',
    'needs_alternate_source',
  ];

  const items: FixItem[] = [];
  for (const queue of orderedQueues) {
    for (const v of (queues[queue] || [])) {
      items.push({
        id: v.id,
        title: v.title,
        url: v.url,
        queue,
        subtypeLabel: v.subtypeLabel,
        status: 'pending',
        previousScore: v.qualityScore,
        currentScore: null,
        previousTier: v.qualityTier,
        currentTier: null,
        previousState: v.enrichmentStatus as string,
        currentState: null,
        previousFailureBucket: v.failureBucket,
        currentFailureBucket: null,
        attemptsThisRun: 0,
        maxAttempts: AUTO_FIXABLE_QUEUES.has(queue) ? MAX_AUTO_ATTEMPTS : 1,
        actionTaken: null,
        failureReason: null,
        terminalReason: null,
        resolvedAt: null,
        isResolved: false,
      });
    }
  }

  const state: FixRunState = {
    ...INITIAL_FIX_STATE,
    status: 'running',
    items,
    totalItems: items.length,
    startedAt: new Date().toISOString(),
  };

  const emit = () => onUpdate({ ...state, items: [...state.items] });
  emit();

  for (let i = 0; i < state.items.length; i++) {
    if (signal?.aborted) {
      state.status = 'paused';
      emit();
      return state;
    }

    const item = state.items[i];
    state.currentItemId = item.id;

    try {
      await processFixItem(item, state);
    } catch (e: any) {
      item.status = 'failed_retry_exhausted';
      item.failureReason = e.message;
      state.failedCount++;
    }

    state.processedCount++;
    emit();

    // Small delay between items to avoid hammering
    if (i < state.items.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  state.status = 'completed';
  state.currentItemId = null;
  state.completedAt = new Date().toISOString();
  emit();
  return state;
}

async function processFixItem(item: FixItem, state: FixRunState): Promise<void> {
  // Helper to finalize item after DB changes
  const finalizeFromDb = async () => {
    const rs = await rescoreResource(item.id);
    if (rs) {
      applyRescore(item, rs);
    }
  };

  // ── Accept Metadata Only ────────────────────────────────
  if (item.queue === 'accept_metadata_only') {
    item.status = 'processing';
    const { error } = await supabase
      .from('resources')
      .update({
        enrichment_status: 'deep_enriched',
        failure_reason: null,
        last_quality_tier: 'metadata_only',
        last_status_change_at: new Date().toISOString(),
        enriched_at: new Date().toISOString(),
      } as any)
      .eq('id', item.id);

    if (error) throw new Error(error.message);

    item.currentState = 'deep_enriched';
    item.currentFailureBucket = null;
    markResolved(item, 'resolved_metadata_only');
    item.actionTaken = 'Accepted as metadata-only';
    item.terminalReason = 'No enrichable content available — accepted';
    state.metadataOnlyCount++;
    return;
  }

  // ── Quarantine ──────────────────────────────────────────
  if (item.queue === 'needs_quarantine') {
    item.status = 'processing';
    const { error } = await supabase
      .from('resources')
      .update({
        enrichment_status: 'quarantined',
        last_status_change_at: new Date().toISOString(),
      } as any)
      .eq('id', item.id);

    if (error) throw new Error(error.message);

    item.currentState = 'quarantined';
    item.currentFailureBucket = item.previousFailureBucket;
    markResolved(item, 'resolved_quarantined');
    item.actionTaken = 'Quarantined';
    item.terminalReason = `Repeated failures (${item.previousScore} score) — removed from auto-retry`;
    state.quarantinedCount++;
    return;
  }

  // ── Manual queues — mark and skip ───────────────────────
  if (MANUAL_QUEUES.has(item.queue)) {
    item.status = 'processing';
    const reasonMap: Record<string, string> = {
      needs_transcript: 'Transcript required — paste transcript via Manual Assist',
      needs_pasted_content: 'Content inaccessible — paste content via Manual Assist',
      needs_access_auth: 'Authentication required — provide access or paste content',
      needs_alternate_source: 'Multiple extraction failures — provide alternate URL',
    };
    const reason = reasonMap[item.queue] || 'Manual input required';

    const { error } = await supabase
      .from('resources')
      .update({
        enrichment_status: 'incomplete',
        failure_reason: reason,
        last_status_change_at: new Date().toISOString(),
      } as any)
      .eq('id', item.id);

    if (error) throw new Error(error.message);

    item.currentState = 'incomplete';
    item.currentFailureBucket = reason;
    item.status = 'awaiting_manual';
    item.actionTaken = `Routed to manual: ${item.queue}`;
    item.terminalReason = reason;
    item.isResolved = false;
    state.manualRequiredCount++;
    return;
  }

  // ── Auto-fixable queues ─────────────────────────────────
  if (AUTO_FIXABLE_QUEUES.has(item.queue)) {
    // State bug reconciliation first
    if (item.queue === 'bad_scoring_state_bug') {
      await reconcileStateBug(item, state);
      return;
    }

    // Auto-fix: reset then enrich
    for (let attempt = 0; attempt < item.maxAttempts; attempt++) {
      item.attemptsThisRun = attempt + 1;
      item.status = 'processing';

      // Step 1: Reset to not_enriched
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

      if (resetError) throw new Error(`Reset failed: ${resetError.message}`);

      // Step 2: Invoke enrichment
      item.status = 'enriching';
      item.actionTaken = `Enrichment attempt ${attempt + 1}`;

      try {
        const force = attempt > 0;
        const result = await invokeEnrichResource<any>(
          { resource_id: item.id, force },
          { componentName: 'FixBrokenResources', timeoutMs: 60000 },
        );

        if (result.error) {
          item.failureReason = result.error.message || 'Enrichment failed';
          if (attempt >= item.maxAttempts - 1) {
            item.status = 're_scoring';
            await finalizeFromDb();

            if ((item.currentScore ?? 0) >= 70) {
              markResolved(item, 'resolved_complete');
              item.terminalReason = `Score ${item.currentScore} after ${attempt + 1} attempts`;
              state.resolvedCount++;
            } else {
              await supabase.from('resources').update({
                enrichment_status: 'quarantined',
                failure_reason: `Fix run: ${item.failureReason} after ${item.attemptsThisRun} attempts`,
                last_status_change_at: new Date().toISOString(),
              } as any).eq('id', item.id);
              item.currentState = 'quarantined';
              markResolved(item, 'resolved_quarantined');
              item.terminalReason = `Quarantined after ${item.attemptsThisRun} failed auto-fix attempts: ${item.failureReason}`;
              state.quarantinedCount++;
            }
            return;
          }
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // Step 3: Re-score
        item.status = 're_scoring';
        await finalizeFromDb();

        const score = item.currentScore ?? 0;
        const rs = await rescoreResource(item.id);
        const passes = rs?.quality.passesCompletionContract ?? false;

        if (score >= 70 && passes) {
          markResolved(item, 'resolved_complete');
          item.terminalReason = `Score ${score} — enrichment complete`;
          state.resolvedCount++;
          return;
        }

        if (attempt < item.maxAttempts - 1) {
          item.failureReason = `Score ${score} — retrying`;
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        // Last attempt, still not complete
        if (score >= 40) {
          item.status = 'failed_retry_exhausted';
          item.terminalReason = `Score ${score} after ${item.attemptsThisRun} attempts — needs manual review`;
          item.isResolved = false;
          state.failedCount++;
        } else {
          await supabase.from('resources').update({
            enrichment_status: 'quarantined',
            failure_reason: `Fix run: score ${score} after ${item.attemptsThisRun} attempts`,
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', item.id);
          item.currentState = 'quarantined';
          markResolved(item, 'resolved_quarantined');
          item.terminalReason = `Quarantined: score ${score} after ${item.attemptsThisRun} attempts`;
          state.quarantinedCount++;
        }
        return;
      } catch (enrichError: any) {
        item.failureReason = enrichError.message;
        if (attempt >= item.maxAttempts - 1) {
          item.status = 'failed_retry_exhausted';
          item.terminalReason = `Enrichment error: ${enrichError.message}`;
          item.isResolved = false;
          state.failedCount++;
          await finalizeFromDb();
          return;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    return;
  }

  // Fallback — skip
  item.status = 'skipped';
  item.actionTaken = 'No automatic action available';
  item.isResolved = false;
  state.skippedCount++;
}

async function reconcileStateBug(item: FixItem, state: FixRunState): Promise<void> {
  item.status = 'processing';

  item.status = 're_scoring';
  const rs = await rescoreResource(item.id);
  if (!rs) {
    item.status = 'failed_retry_exhausted';
    item.failureReason = 'Could not read resource for re-scoring';
    item.isResolved = false;
    state.failedCount++;
    return;
  }

  applyRescore(item, rs);
  const qr = rs.quality;

  const update: Record<string, any> = {
    last_status_change_at: new Date().toISOString(),
    last_quality_score: qr.score,
    last_quality_tier: qr.tier,
  };

  if (qr.score >= 70 && qr.passesCompletionContract) {
    update.enrichment_status = 'deep_enriched';
    update.failure_reason = null;
    update.enriched_at = new Date().toISOString();

    const { error } = await supabase.from('resources').update(update as any).eq('id', item.id);
    if (error) throw new Error(error.message);

    item.currentState = 'deep_enriched';
    item.currentFailureBucket = null;
    markResolved(item, 'resolved_complete');
    item.actionTaken = 'Reconciled: promoted to complete';
    item.terminalReason = `Score ${qr.score} — status corrected to deep_enriched`;
    state.resolvedCount++;
  } else if (qr.score < 30) {
    update.enrichment_status = 'quarantined';
    update.failure_reason = `Reconciled: score ${qr.score} is too low`;

    const { error } = await supabase.from('resources').update(update as any).eq('id', item.id);
    if (error) throw new Error(error.message);

    item.currentState = 'quarantined';
    markResolved(item, 'resolved_quarantined');
    item.actionTaken = 'Reconciled: quarantined';
    item.terminalReason = `Score ${qr.score} — quarantined`;
    state.quarantinedCount++;
  } else {
    update.enrichment_status = 'not_enriched';
    update.failure_reason = null;

    const { error } = await supabase.from('resources').update(update as any).eq('id', item.id);
    if (error) throw new Error(error.message);

    item.status = 'enriching';
    item.actionTaken = 'Reconciled + re-enriching';
    item.attemptsThisRun = 1;

    try {
      await invokeEnrichResource<any>(
        { resource_id: item.id },
        { componentName: 'FixBrokenResources', timeoutMs: 60000 },
      );

      item.status = 're_scoring';
      const rs2 = await rescoreResource(item.id);
      if (rs2) {
        applyRescore(item, rs2);
      }

      if ((rs2?.quality.score ?? 0) >= 70 && rs2?.quality.passesCompletionContract) {
        markResolved(item, 'resolved_complete');
        item.terminalReason = `Score ${rs2?.quality.score} after reconcile + re-enrich`;
        state.resolvedCount++;
      } else {
        item.status = 'failed_retry_exhausted';
        item.terminalReason = `Score ${rs2?.quality.score ?? 0} — needs manual review`;
        item.isResolved = false;
        state.failedCount++;
      }
    } catch (e: any) {
      item.status = 'failed_retry_exhausted';
      item.failureReason = e.message;
      item.terminalReason = `Enrichment failed: ${e.message}`;
      item.isResolved = false;
      state.failedCount++;
    }
  }
}
