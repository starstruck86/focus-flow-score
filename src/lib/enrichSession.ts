/**
 * Canonical derived enrich session state.
 * This is the ONLY source of truth for rendering the enrich modal/panel.
 * All counts, labels, and terminal states must derive from this object.
 */
import type { IngestionState, IngestionItem } from '@/store/useEnrichmentJobStore';

export type EnrichTerminalState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed_success'
  | 'completed_with_errors'
  | 'completed_noop'
  | 'cancelled'
  | 'completed_quarantined';

export interface EnrichSession {
  /** Total items selected for the run */
  totalSelected: number;
  /** Items that were runnable at start (queued, not pre-skipped) */
  totalRunnableAtStart: number;
  /** Items currently waiting in queue */
  queuedCount: number;
  /** Items currently being processed (in an active stage) */
  inProgressCount: number;
  /** Successfully enriched */
  successCount: number;
  /** Failed (hard failure) */
  failedCount: number;
  /** Skipped (duplicate, already enriched, invalid) */
  skippedCount: number;
  /** Partial enrichment */
  partialCount: number;
  /** Needs auth */
  needsAuthCount: number;
  /** Unsupported source */
  unsupportedCount: number;
  /** completedCount = successCount + failedCount + skippedCount + partialCount + needsAuthCount + unsupportedCount */
  completedCount: number;
  /** remainingCount = queuedCount + inProgressCount */
  remainingCount: number;
  /** Current batch index (1-based, 0 if not started) */
  currentBatchIndex: number;
  /** Total number of batches */
  totalBatches: number;
  /** Percentage complete (0-100) */
  percentComplete: number;
  /** Terminal state derived from counts + store status */
  terminalState: EnrichTerminalState;
  /** Failed items for detail view */
  failedItems: IngestionItem[];
  /** Retryable subset of failed items */
  retryableCount: number;
}

const ACTIVE_STAGES = new Set([
  'preflight', 'preprocessing', 'checking_duplicate',
  'fetching', 'classifying', 'saving', 'enriching', 'verifying',
]);

const TERMINAL_STAGES = new Set([
  'complete', 'partial', 'needs_auth', 'unsupported', 'skipped', 'failed', 'needs_review', 'quarantined',
]);

/**
 * Derive a canonical session from the raw ingestion state.
 * ALL rendering must use this — never read raw counts directly.
 */
export function deriveEnrichSession(state: IngestionState): EnrichSession {
  const items = state.items;
  const totalSelected = items.length;

  // Count from item stages (source of truth)
  let queuedCount = 0;
  let inProgressCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let partialCount = 0;
  let needsAuthCount = 0;
  let unsupportedCount = 0;
  const failedItems: IngestionItem[] = [];

  for (const item of items) {
    switch (item.stage) {
      case 'queued':
        queuedCount++;
        break;
      case 'complete':
        successCount++;
        break;
      case 'failed':
      case 'needs_review':
        failedCount++;
        failedItems.push(item);
        break;
      case 'quarantined' as any:
        failedCount++;
        failedItems.push(item);
        break;
      case 'skipped':
        skippedCount++;
        break;
      case 'partial':
        partialCount++;
        break;
      case 'needs_auth':
        needsAuthCount++;
        break;
      case 'unsupported':
        unsupportedCount++;
        break;
      default:
        if (ACTIVE_STAGES.has(item.stage)) {
          inProgressCount++;
        }
        break;
    }
  }

  const completedCount = successCount + failedCount + skippedCount + partialCount + needsAuthCount + unsupportedCount;
  let remainingCount = queuedCount + inProgressCount;

  // totalRunnableAtStart = totalSelected - items that were skipped at preprocessing (pre-run skips)
  // We approximate this as totalSelected - skippedCount for initial runs,
  // but more precisely: items that were ever queued = items not pre-skipped
  const totalRunnableAtStart = totalSelected - skippedCount;

  const percentComplete = totalRunnableAtStart > 0
    ? Math.round(((completedCount - skippedCount) / totalRunnableAtStart) * 100)
    : 0;

  // Derive terminal state
  let terminalState: EnrichTerminalState;
  if (state.status === 'idle') {
    terminalState = 'idle';
  } else if (state.status === 'cancelled') {
    terminalState = 'cancelled';
  } else if (state.status === 'paused') {
    terminalState = 'paused';
  } else if (state.status === 'running' && (inProgressCount > 0 || queuedCount > 0)) {
    terminalState = 'running';
  } else if (remainingCount === 0 && (state.status === 'completed' || state.status === 'failed')) {
    if (totalRunnableAtStart === 0) {
      terminalState = 'completed_noop';
    } else if (failedCount > 0) {
      terminalState = 'completed_with_errors';
    } else {
      terminalState = 'completed_success';
    }
  } else if (state.status === 'completed' || state.status === 'failed') {
    // Store says done but we still have remaining — force completed state
    // (this shouldn't happen, but guard against it)
    terminalState = failedCount > 0 ? 'completed_with_errors' : 'completed_success';
  } else {
    // Running but nothing in queue or in-progress — transitional, treat as running
    terminalState = 'running';
  }

  if (terminalState.startsWith('completed') && remainingCount > 0) {
    console.error('Invariant violation: completed state had remaining items');
    remainingCount = 0;
  }

  const retryableCount = failedItems.filter(i => i.retryEligible !== false).length;

  const session: EnrichSession = {
    totalSelected,
    totalRunnableAtStart,
    queuedCount,
    inProgressCount,
    successCount,
    failedCount,
    skippedCount,
    partialCount,
    needsAuthCount,
    unsupportedCount,
    completedCount,
    remainingCount,
    currentBatchIndex: state.currentBatch,
    totalBatches: state.totalBatches,
    percentComplete: Math.min(percentComplete, 100),
    terminalState,
    failedItems,
    retryableCount,
  };

  // Dev-only invariant guards
  if (import.meta.env.DEV) {
    validateSessionInvariants(session);
  }

  return session;
}

/**
 * Dev-only invariant checks. Logs errors but does not throw.
 */
function validateSessionInvariants(s: EnrichSession): void {
  if (s.terminalState.startsWith('completed') && s.remainingCount > 0) {
    console.error(
      `[EnrichSession INVARIANT] terminalState=${s.terminalState} but remainingCount=${s.remainingCount}. ` +
      `Completed state must have remainingCount === 0.`
    );
  }

  const accountedFor = s.completedCount + s.remainingCount;
  if (accountedFor !== s.totalSelected) {
    console.error(
      `[EnrichSession INVARIANT] completedCount(${s.completedCount}) + remainingCount(${s.remainingCount}) = ${accountedFor} ` +
      `!== totalSelected(${s.totalSelected}). Items are unaccounted.`
    );
  }

  if (s.currentBatchIndex === 0 && s.totalBatches === 0 && s.totalRunnableAtStart > 0 && s.terminalState === 'running') {
    console.error(
      `[EnrichSession INVARIANT] Batch shows 0/0 while totalRunnableAtStart=${s.totalRunnableAtStart}. ` +
      `Batch counters not initialized.`
    );
  }

  // Failed items should not also be counted as remaining
  const failedIds = new Set(s.failedItems.map(i => i.id));
  // This check is structural — if an item is in failedItems, its stage must be 'failed'
  for (const item of s.failedItems) {
    if (item.stage !== 'failed' && item.stage !== 'needs_review') {
      if (item.stage === 'quarantined') continue; // quarantined is a valid failed-bucket stage
      console.error(
        `[EnrichSession INVARIANT] Item "${item.title}" is in failedItems but stage="${item.stage}". ` +
        `Failed items must have stage=failed or needs_review.`
      );
    }
  }
}
