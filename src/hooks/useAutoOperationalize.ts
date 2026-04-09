/**
 * useAutoOperationalize — hook that triggers auto-operationalization
 * after resource upload, fix, or content-ready transitions.
 *
 * Now includes outcome tracking for post-action verification.
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  autoOperationalizeResource,
  summarizeBatchResults,
  type AutoOperationalizeResult,
  type BatchSummary,
} from '@/lib/autoOperationalize';
import {
  recordActionOutcome,
  recordBulkActionOutcome,
  deriveOutcomeStatus,
  type ActionOutcome,
  type BulkActionOutcome,
  type RowFlashStatus,
} from '@/lib/actionOutcomeStore';
import {
  type ControlPlaneState,
  deriveControlPlaneState,
  CONTROL_PLANE_LABELS,
} from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';

export function useAutoOperationalize() {
  const qc = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<AutoOperationalizeResult | null>(null);
  const [lastBatchSummary, setLastBatchSummary] = useState<BatchSummary | null>(null);
  const [lastBulkOutcome, setLastBulkOutcome] = useState<BulkActionOutcome | null>(null);
  const [outcomeRefreshKey, setOutcomeRefreshKey] = useState(0);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    qc.invalidateQueries({ queryKey: ['resources'] });
    qc.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
  }, [qc]);

  const operationalizeWithOutcome = useCallback(async (
    resourceId: string,
    preState: ControlPlaneState,
    expectedToState: ControlPlaneState,
    actionKey: string,
    actionLabel: string,
    resourceTitle: string,
    showToast = true,
  ): Promise<AutoOperationalizeResult> => {
    setIsRunning(true);
    try {
      const result = await autoOperationalizeResource(resourceId);
      setLastResult(result);
      invalidate();

      // Determine actual post-state from result
      const actualToState = mapResultToState(result);
      const status = deriveOutcomeStatus(expectedToState, preState, actualToState, result);

      const outcome: ActionOutcome = {
        id: crypto.randomUUID(),
        resourceId,
        resourceTitle,
        actionKey,
        actionLabel,
        timestamp: new Date().toISOString(),
        status,
        expectedFromState: preState,
        expectedToState,
        actualFromState: preState,
        actualToState,
        transitionMatched: actualToState === expectedToState,
        detail: !result.success
          ? result.reason
          : actualToState !== expectedToState
            ? `Expected ${CONTROL_PLANE_LABELS[expectedToState]} but reached ${CONTROL_PLANE_LABELS[actualToState]}`
            : undefined,
      };
      recordActionOutcome(outcome);
      setOutcomeRefreshKey(k => k + 1);

      if (showToast) {
        if (status === 'success') {
          toast.success(`${actionLabel}: ${CONTROL_PLANE_LABELS[preState]} → ${CONTROL_PLANE_LABELS[actualToState]}`);
        } else if (status === 'no_change') {
          toast.info(`${actionLabel}: no state change — ${result.reason || 'already in target state'}`);
        } else if (status === 'needs_review') {
          toast.info(`${actionLabel}: needs review — ${result.reason || 'manual intervention required'}`);
        } else {
          toast.error(`${actionLabel} failed: ${result.reason || 'unknown error'}`);
        }
      }

      return result;
    } finally {
      setIsRunning(false);
    }
  }, [invalidate]);

  // Simple version without outcome tracking (backward compat)
  const operationalize = useCallback(async (resourceId: string, showToast = true): Promise<AutoOperationalizeResult> => {
    setIsRunning(true);
    try {
      const result = await autoOperationalizeResource(resourceId);
      setLastResult(result);
      invalidate();
      if (showToast) {
        if (result.operationalized) {
          toast.success(`Operationalized — ${result.knowledgeExtracted} extracted, ${result.knowledgeActivated} activated`);
        } else if (result.needsReview) {
          toast.info(result.reason || 'Resource needs manual review');
        }
      }
      return result;
    } finally {
      setIsRunning(false);
    }
  }, [invalidate]);

  const operationalizeBatchWithOutcome = useCallback(async (
    resources: CanonicalResourceStatus[],
    actionLabel: string,
    expectedTransitionLabel: string,
    processingIds?: Set<string>,
  ): Promise<BulkActionOutcome> => {
    setIsRunning(true);
    try {
      const results: { resource: CanonicalResourceStatus; preState: ControlPlaneState; result: AutoOperationalizeResult }[] = [];

      for (const resource of resources) {
        const preState = deriveControlPlaneState(resource, processingIds);
        const result = await autoOperationalizeResource(resource.resource_id);
        results.push({ resource, preState, result });
        invalidate();
      }

      // Compute transitions
      const transitionMap = new Map<string, { from: ControlPlaneState; to: ControlPlaneState; count: number }>();
      let succeeded = 0, failed = 0, unchanged = 0, needsReview = 0;
      const stillNeedAttention: { resourceId: string; title: string; reason: string }[] = [];

      for (const { resource, preState, result } of results) {
        const actualTo = mapResultToState(result);
        const status = deriveOutcomeStatus(actualTo, preState, actualTo, result);

        if (status === 'success') {
          succeeded++;
          const key = `${preState}->${actualTo}`;
          const existing = transitionMap.get(key);
          if (existing) existing.count++;
          else transitionMap.set(key, { from: preState, to: actualTo, count: 1 });
        } else if (status === 'failed') {
          failed++;
          stillNeedAttention.push({ resourceId: resource.resource_id, title: resource.title, reason: result.reason || 'Failed' });
        } else if (status === 'no_change') {
          unchanged++;
        } else {
          needsReview++;
          stillNeedAttention.push({ resourceId: resource.resource_id, title: resource.title, reason: result.reason || 'Needs review' });
        }

        // Record individual outcome too
        recordActionOutcome({
          id: crypto.randomUUID(),
          resourceId: resource.resource_id,
          resourceTitle: resource.title,
          actionKey: 'bulk',
          actionLabel,
          timestamp: new Date().toISOString(),
          status,
          expectedFromState: preState,
          expectedToState: preState, // bulk doesn't have per-resource expected
          actualFromState: preState,
          actualToState: actualTo,
          transitionMatched: preState !== actualTo,
        });
      }

      const bulkOutcome: BulkActionOutcome = {
        id: crypto.randomUUID(),
        actionLabel,
        timestamp: new Date().toISOString(),
        attempted: resources.length,
        succeeded,
        failed,
        unchanged,
        needsReview,
        transitions: Array.from(transitionMap.values()),
        stillNeedAttention,
      };

      recordBulkActionOutcome(bulkOutcome);
      setLastBulkOutcome(bulkOutcome);
      setOutcomeRefreshKey(k => k + 1);

      // Summary toast
      const parts: string[] = [];
      if (succeeded > 0) parts.push(`${succeeded} succeeded`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (unchanged > 0) parts.push(`${unchanged} unchanged`);
      if (needsReview > 0) parts.push(`${needsReview} need review`);
      toast.info(`${actionLabel}: ${parts.join(', ')}`);

      return bulkOutcome;
    } finally {
      setIsRunning(false);
    }
  }, [invalidate]);

  // Legacy batch (backward compat)
  const operationalizeBatch = useCallback(async (resourceIds: string[]): Promise<BatchSummary> => {
    setIsRunning(true);
    try {
      const results: AutoOperationalizeResult[] = [];
      for (const resourceId of resourceIds) {
        const result = await autoOperationalizeResource(resourceId);
        results.push(result);
        invalidate();
      }
      const summary = summarizeBatchResults(results);
      setLastBatchSummary(summary);
      if (summary.operationalized > 0) {
        toast.success(`${summary.operationalized} resource(s) operationalized`);
      }
      if (summary.needsReview > 0) {
        toast.info(`${summary.needsReview} resource(s) need manual review`);
      }
      return summary;
    } finally {
      setIsRunning(false);
    }
  }, [invalidate]);

  return {
    operationalize,
    operationalizeWithOutcome,
    operationalizeBatch,
    operationalizeBatchWithOutcome,
    isRunning,
    lastResult,
    lastBatchSummary,
    lastBulkOutcome,
    setLastBulkOutcome,
    outcomeRefreshKey,
  };
}

/** Map an auto-operationalize result to a ControlPlaneState */
function mapResultToState(result: AutoOperationalizeResult): ControlPlaneState {
  if (result.operationalized || result.stagesCompleted.includes('activated')) return 'activated';
  if (result.stagesCompleted.includes('knowledge_extracted')) return 'extracted';
  if (result.stagesCompleted.includes('content_ready')) return 'has_content';
  if (result.needsReview) return 'blocked';
  return 'ingested';
}
