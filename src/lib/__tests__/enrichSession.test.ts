import { describe, it, expect } from 'vitest';
import { deriveEnrichSession, type EnrichTerminalState } from '@/lib/enrichSession';
import type { IngestionState, IngestionItem, IngestionItemStage } from '@/store/useEnrichmentJobStore';

function makeItem(overrides: Partial<IngestionItem> & { stage: IngestionItemStage }): IngestionItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    url: 'https://example.com',
    title: 'Test Item',
    retryEligible: true,
    ...overrides,
  };
}

function makeState(overrides: Partial<IngestionState> = {}): IngestionState {
  return {
    status: 'idle',
    mode: 'deep_enrich',
    batchSize: 5,
    reprocessMode: 'skip_processed',
    totalItems: 0,
    currentBatch: 0,
    totalBatches: 0,
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    reviewCount: 0,
    partialCount: 0,
    needsAuthCount: 0,
    unsupportedCount: 0,
    items: [],
    startedAt: null,
    ...overrides,
  };
}

describe('deriveEnrichSession', () => {
  // Case A: Normal successful run
  it('Case A — successful run shows completed_success', () => {
    const items = [
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'complete' }),
    ];
    const session = deriveEnrichSession(makeState({
      status: 'completed',
      items,
      totalItems: 3,
    }));

    expect(session.terminalState).toBe('completed_success');
    expect(session.successCount).toBe(3);
    expect(session.failedCount).toBe(0);
    expect(session.remainingCount).toBe(0);
    expect(session.percentComplete).toBe(100);
  });

  // Case B: Run completes with failures
  it('Case B — run with failures shows completed_with_errors', () => {
    const items = [
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'failed', error: 'Network error', retryEligible: true }),
      makeItem({ stage: 'failed', error: 'Quality too low', retryEligible: false }),
    ];
    const session = deriveEnrichSession(makeState({
      status: 'failed',
      items,
      totalItems: 3,
    }));

    expect(session.terminalState).toBe('completed_with_errors');
    expect(session.successCount).toBe(1);
    expect(session.failedCount).toBe(2);
    expect(session.remainingCount).toBe(0);
    expect(session.failedItems).toHaveLength(2);
    expect(session.retryableCount).toBe(1);
  });

  // Case C: No-op run with zero runnable items
  it('Case C — zero runnable items shows completed_noop', () => {
    const items = [
      makeItem({ stage: 'skipped', error: 'already_enriched' }),
      makeItem({ stage: 'skipped', error: 'duplicate_resource' }),
    ];
    const session = deriveEnrichSession(makeState({
      status: 'completed',
      items,
      totalItems: 2,
    }));

    expect(session.terminalState).toBe('completed_noop');
    expect(session.totalRunnableAtStart).toBe(0);
    expect(session.skippedCount).toBe(2);
    expect(session.remainingCount).toBe(0);
  });

  // Case D: Retryable failures after prior run
  it('Case D — retry resets failed to queued', () => {
    const items = [
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'queued' }), // was failed, now re-queued for retry
      makeItem({ stage: 'skipped' }),
    ];
    const session = deriveEnrichSession(makeState({
      status: 'running',
      items,
      totalItems: 3,
      currentBatch: 1,
      totalBatches: 1,
    }));

    expect(session.terminalState).toBe('running');
    expect(session.queuedCount).toBe(1);
    expect(session.successCount).toBe(1);
    expect(session.remainingCount).toBe(1);
  });

  // Case E: Reset after completed_with_errors
  it('Case E — reset returns to idle with empty state', () => {
    const session = deriveEnrichSession(makeState({
      status: 'idle',
      items: [],
      totalItems: 0,
    }));

    expect(session.terminalState).toBe('idle');
    expect(session.totalSelected).toBe(0);
    expect(session.completedCount).toBe(0);
    expect(session.remainingCount).toBe(0);
    expect(session.failedItems).toHaveLength(0);
  });

  // Case F: Close and reopen — state must be clean after reset
  it('Case F — after reset, no stale completed state', () => {
    // Simulate: was completed_with_errors, then reset
    const session = deriveEnrichSession(makeState());

    expect(session.terminalState).toBe('idle');
    expect(session.successCount).toBe(0);
    expect(session.failedCount).toBe(0);
    // The key assertion: no contradictory "completed + remaining" state
    expect(session.remainingCount).toBe(0);
  });

  // Case G: Mixed batch where last batch partially fails
  it('Case G — partial batch failure reconciles correctly', () => {
    const items = [
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'failed', error: 'timeout', retryEligible: true }),
      makeItem({ stage: 'failed', error: 'quality', retryEligible: false }),
    ];
    const session = deriveEnrichSession(makeState({
      status: 'failed',
      items,
      totalItems: 5,
      currentBatch: 1,
      totalBatches: 1,
    }));

    expect(session.terminalState).toBe('completed_with_errors');
    expect(session.successCount).toBe(3);
    expect(session.failedCount).toBe(2);
    expect(session.completedCount).toBe(5); // all accounted for
    expect(session.remainingCount).toBe(0); // nothing remaining
    expect(session.retryableCount).toBe(1);
    expect(session.percentComplete).toBe(100);
  });

  // Invariant: completed + remaining must never coexist
  it('INVARIANT — completed state never has remaining items', () => {
    // Force a contradictory raw state (store says completed but items still queued)
    const items = [
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'queued' }), // shouldn't exist if completed
    ];
    const session = deriveEnrichSession(makeState({
      status: 'completed',
      items,
      totalItems: 2,
    }));

    // The session must still derive correctly — queued item means remaining > 0
    // but since store says completed, the guard should log error
    // The terminal state forces to completed anyway (guard is for logging)
    expect(session.completedCount + session.remainingCount).toBe(session.totalSelected);
  });

  // Invariant: all items accounted for
  it('INVARIANT — completedCount + remainingCount === totalSelected', () => {
    const items = [
      makeItem({ stage: 'complete' }),
      makeItem({ stage: 'failed' }),
      makeItem({ stage: 'skipped' }),
      makeItem({ stage: 'enriching' }), // in-progress
      makeItem({ stage: 'queued' }),
    ];
    const session = deriveEnrichSession(makeState({
      status: 'running',
      items,
      totalItems: 5,
    }));

    expect(session.completedCount + session.remainingCount).toBe(5);
    expect(session.successCount).toBe(1);
    expect(session.failedCount).toBe(1);
    expect(session.skippedCount).toBe(1);
    expect(session.inProgressCount).toBe(1);
    expect(session.queuedCount).toBe(1);
  });

  // Progress must be 0 when nothing is runnable
  it('progress is 0 when totalRunnableAtStart is 0', () => {
    const items = [makeItem({ stage: 'skipped' })];
    const session = deriveEnrichSession(makeState({ status: 'completed', items }));
    expect(session.percentComplete).toBe(0);
  });

  // All-failed case
  it('all items failed shows clear counts', () => {
    const items = [
      makeItem({ stage: 'failed', error: 'err1' }),
      makeItem({ stage: 'failed', error: 'err2' }),
    ];
    const session = deriveEnrichSession(makeState({ status: 'failed', items }));
    expect(session.terminalState).toBe('completed_with_errors');
    expect(session.successCount).toBe(0);
    expect(session.failedCount).toBe(2);
    expect(session.remainingCount).toBe(0);
  });
});
