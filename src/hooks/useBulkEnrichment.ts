/**
 * Controlled bulk enrichment engine with batching, progress, retry, pause/cancel, and idempotency.
 */
import { useState, useCallback, useRef } from 'react';
import { useAccountEnrichment, type EnrichmentResult } from './useAccountEnrichment';
import type { Account } from '@/types';

export type BulkEnrichStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface BulkRecordResult {
  accountId: string;
  accountName: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface BulkEnrichState {
  status: BulkEnrichStatus;
  batchSize: number;
  totalRecords: number;
  currentBatch: number;
  totalBatches: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  results: BulkRecordResult[];
}

const STALE_DAYS = 90;
const INTER_RECORD_DELAY = 1000;
const INTER_BATCH_DELAY = 2000;

function isRecentlyEnriched(account: Account): boolean {
  if (!account.lastEnrichedAt) return false;
  const daysSince = Math.floor(
    (Date.now() - new Date(account.lastEnrichedAt).getTime()) / 86400000
  );
  return daysSince <= STALE_DAYS;
}

export function useBulkEnrichment() {
  const { enrichAccount } = useAccountEnrichment();
  const [state, setState] = useState<BulkEnrichState>({
    status: 'idle',
    batchSize: 10,
    totalRecords: 0,
    currentBatch: 0,
    totalBatches: 0,
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    results: [],
  });

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const runningRef = useRef(false);

  const setBatchSize = useCallback((size: number) => {
    setState(prev => ({ ...prev, batchSize: size }));
  }, []);

  const start = useCallback(async (accounts: Account[], options?: { retryFailedOnly?: boolean }) => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    pauseRef.current = false;

    // Filter: skip recently enriched (idempotency) unless retrying failed
    let queue: Account[];
    let initialResults: BulkRecordResult[];

    if (options?.retryFailedOnly) {
      const failedIds = new Set(
        state.results.filter(r => r.status === 'failed').map(r => r.accountId)
      );
      queue = accounts.filter(a => failedIds.has(a.id));
      // Keep previous successes/skips, reset failed to pending
      initialResults = state.results.map(r =>
        r.status === 'failed' && failedIds.has(r.accountId)
          ? { ...r, status: 'pending' as const, error: undefined }
          : r
      );
    } else {
      initialResults = accounts.map(a => {
        if (isRecentlyEnriched(a)) {
          return { accountId: a.id, accountName: a.name, status: 'skipped' as const };
        }
        return { accountId: a.id, accountName: a.name, status: 'pending' as const };
      });
      queue = accounts.filter(a => !isRecentlyEnriched(a));
    }

    const batchSize = state.batchSize;
    const totalBatches = Math.max(1, Math.ceil(queue.length / batchSize));
    const skippedCount = initialResults.filter(r => r.status === 'skipped').length;
    const priorSuccess = initialResults.filter(r => r.status === 'success').length;

    setState(prev => ({
      ...prev,
      status: 'running',
      totalRecords: accounts.length,
      currentBatch: 0,
      totalBatches,
      processedCount: skippedCount + priorSuccess,
      successCount: priorSuccess,
      failedCount: 0,
      skippedCount,
      results: initialResults,
    }));

    let successCount = priorSuccess;
    let failedCount = 0;
    let processedCount = skippedCount + priorSuccess;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      if (cancelRef.current) {
        setState(prev => ({ ...prev, status: 'cancelled' }));
        runningRef.current = false;
        return;
      }

      // Handle pause
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

      for (const account of batch) {
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
          const result: EnrichmentResult = await enrichAccount(account);
          processedCount++;
          if (result.success) {
            successCount++;
            setState(prev => ({
              ...prev,
              processedCount,
              successCount,
              results: prev.results.map(r =>
                r.accountId === account.id ? { ...r, status: 'success' as const } : r
              ),
            }));
          } else {
            failedCount++;
            setState(prev => ({
              ...prev,
              processedCount,
              failedCount,
              results: prev.results.map(r =>
                r.accountId === account.id
                  ? { ...r, status: 'failed' as const, error: result.error || 'Unknown error' }
                  : r
              ),
            }));
          }
        } catch (err) {
          processedCount++;
          failedCount++;
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setState(prev => ({
            ...prev,
            processedCount,
            failedCount,
            results: prev.results.map(r =>
              r.accountId === account.id
                ? { ...r, status: 'failed' as const, error: msg }
                : r
            ),
          }));
        }

        // Delay between records to avoid rate limits
        if (batch.indexOf(account) < batch.length - 1) {
          await new Promise(r => setTimeout(r, INTER_RECORD_DELAY));
        }
      }

      // Delay between batches
      if (batchIdx < totalBatches - 1) {
        await new Promise(r => setTimeout(r, INTER_BATCH_DELAY));
      }
    }

    setState(prev => ({
      ...prev,
      status: failedCount > 0 ? 'failed' : 'completed',
    }));
    runningRef.current = false;
  }, [enrichAccount, state.batchSize, state.results]);

  const pause = useCallback(() => { pauseRef.current = true; }, []);
  const resume = useCallback(() => { pauseRef.current = false; }, []);
  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  const reset = useCallback(() => {
    cancelRef.current = false;
    pauseRef.current = false;
    runningRef.current = false;
    setState({
      status: 'idle',
      batchSize: state.batchSize,
      totalRecords: 0,
      currentBatch: 0,
      totalBatches: 0,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      results: [],
    });
  }, [state.batchSize]);

  return {
    state,
    setBatchSize,
    start,
    pause,
    resume,
    cancel,
    reset,
    hasFailures: state.results.some(r => r.status === 'failed'),
  };
}
