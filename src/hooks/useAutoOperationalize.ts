/**
 * useAutoOperationalize — hook that triggers auto-operationalization
 * with evidence-backed outcome reconciliation against refreshed data.
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
  reconcileOutcome,
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
import { auditCanonicalLifecycle } from '@/lib/canonicalLifecycle';
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

  /** Refetch canonical lifecycle and find a resource's reconciled state */
  const fetchReconciledState = useCallback(async (resourceId: string): Promise<ControlPlaneState | null> => {
    try {
      const freshData = await auditCanonicalLifecycle();
      if (!freshData) return null;
      const resource = freshData.resources.find(r => r.resource_id === resourceId);
      if (!resource) return null;
      return deriveControlPlaneState(resource);
    } catch {
      return null;
    }
  }, []);

  /** Refetch and return all fresh resources */
  const fetchReconciledResources = useCallback(async (): Promise<CanonicalResourceStatus[]> => {
    try {
      const freshData = await auditCanonicalLifecycle();
      return freshData?.resources ?? [];
    } catch {
      return [];
    }
  }, []);

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

      // Determine mutation-derived state
      const mutationToState = mapResultToState(result);
      const status = deriveOutcomeStatus(expectedToState, preState, mutationToState, result);

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
        mutationToState,
        reconciledToState: null,
        reconciliation: 'pending',
        transitionMatched: mutationToState === expectedToState,
        detail: !result.success
          ? result.reason
          : mutationToState !== expectedToState
            ? `Expected ${CONTROL_PLANE_LABELS[expectedToState]} but reached ${CONTROL_PLANE_LABELS[mutationToState]}`
            : undefined,
      };
      recordActionOutcome(outcome);

      // Reconcile against refreshed data
      invalidate();
      const reconciledState = await fetchReconciledState(resourceId);
      if (reconciledState) {
        const reconciled = reconcileOutcome(outcome, reconciledState);

        if (showToast) {
          if (reconciled.reconciliation === 'confirmed') {
            toast.success(`${actionLabel}: ${CONTROL_PLANE_LABELS[preState]} → ${CONTROL_PLANE_LABELS[reconciledState]} ✓ confirmed`);
          } else if (reconciled.reconciliation === 'partial') {
            toast.info(`${actionLabel}: partial — ${reconciled.mismatchExplanation || 'progressed but not to target state'}`);
          } else if (reconciled.reconciliation === 'mismatched') {
            toast.warning(`${actionLabel}: unexpected — ${reconciled.mismatchExplanation || 'state differs from expected'}`);
          } else if (status === 'no_change') {
            toast.info(`${actionLabel}: no state change — ${result.reason || 'already in target state'}`);
          } else if (status === 'failed') {
            toast.error(`${actionLabel} failed: ${result.reason || 'unknown error'}`);
          }
        }
      } else if (showToast) {
        // Fallback if reconciliation fetch fails
        if (status === 'success') {
          toast.success(`${actionLabel}: ${CONTROL_PLANE_LABELS[preState]} → ${CONTROL_PLANE_LABELS[mutationToState]}`);
        } else if (status === 'no_change') {
          toast.info(`${actionLabel}: no state change`);
        } else if (status === 'needs_review') {
          toast.info(`${actionLabel}: needs review — ${result.reason || 'manual intervention required'}`);
        } else {
          toast.error(`${actionLabel} failed: ${result.reason || 'unknown error'}`);
        }
      }

      setOutcomeRefreshKey(k => k + 1);
      return result;
    } finally {
      setIsRunning(false);
    }
  }, [invalidate, fetchReconciledState]);

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
    /** Snapshot of resources to process — preserved even if UI filter changes */
    snapshotResources: CanonicalResourceStatus[],
    actionLabel: string,
    expectedTransitionLabel: string,
    processingIds?: Set<string>,
  ): Promise<BulkActionOutcome> => {
    setIsRunning(true);
    try {
      // Phase 1: Execute mutations on snapshotted resources
      const mutationResults: { resource: CanonicalResourceStatus; preState: ControlPlaneState; result: AutoOperationalizeResult; mutationTo: ControlPlaneState }[] = [];

      for (const resource of snapshotResources) {
        const preState = deriveControlPlaneState(resource, processingIds);
        const result = await autoOperationalizeResource(resource.resource_id);
        const mutationTo = mapResultToState(result);
        mutationResults.push({ resource, preState, result, mutationTo });
        // Invalidate after each to keep UI responsive
        invalidate();
      }

      // Phase 2: Reconcile against fresh data
      const freshResources = await fetchReconciledResources();
      const freshMap = new Map(freshResources.map(r => [r.resource_id, r]));

      const transitionMap = new Map<string, { from: ControlPlaneState; to: ControlPlaneState; count: number }>();
      let succeeded = 0, failed = 0, unchanged = 0, needsReview = 0;
      let confirmed = 0, partial = 0, mismatched = 0;
      const stillNeedAttention: { resourceId: string; title: string; reason: string }[] = [];

      for (const { resource, preState, result, mutationTo } of mutationResults) {
        const status = deriveOutcomeStatus(mutationTo, preState, mutationTo, result);

        // Build initial outcome
        const outcome: ActionOutcome = {
          id: crypto.randomUUID(),
          resourceId: resource.resource_id,
          resourceTitle: resource.title,
          actionKey: 'bulk',
          actionLabel,
          timestamp: new Date().toISOString(),
          status,
          expectedFromState: preState,
          expectedToState: preState, // bulk uses preState progression
          mutationToState: mutationTo,
          reconciledToState: null,
          reconciliation: 'pending',
          transitionMatched: preState !== mutationTo,
        };
        recordActionOutcome(outcome);

        // Reconcile
        const freshResource = freshMap.get(resource.resource_id);
        let reconciledTo = mutationTo;
        if (freshResource) {
          reconciledTo = deriveControlPlaneState(freshResource);
          const reconciled = reconcileOutcome(outcome, reconciledTo);
          if (reconciled.reconciliation === 'confirmed') confirmed++;
          else if (reconciled.reconciliation === 'partial') partial++;
          else if (reconciled.reconciliation === 'mismatched') mismatched++;
        }

        // Classify
        if (status === 'success') {
          succeeded++;
          const key = `${preState}->${reconciledTo}`;
          const existing = transitionMap.get(key);
          if (existing) existing.count++;
          else transitionMap.set(key, { from: preState, to: reconciledTo, count: 1 });
        } else if (status === 'failed') {
          failed++;
          stillNeedAttention.push({ resourceId: resource.resource_id, title: resource.title, reason: result.reason || 'Failed' });
        } else if (status === 'no_change') {
          unchanged++;
        } else {
          needsReview++;
          stillNeedAttention.push({ resourceId: resource.resource_id, title: resource.title, reason: result.reason || 'Needs review' });
        }
      }

      const bulkOutcome: BulkActionOutcome = {
        id: crypto.randomUUID(),
        actionLabel,
        timestamp: new Date().toISOString(),
        attempted: snapshotResources.length,
        succeeded,
        failed,
        unchanged,
        needsReview,
        confirmed,
        partial,
        mismatched,
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
      if (confirmed > 0) parts.push(`${confirmed} confirmed`);
      if (mismatched > 0) parts.push(`${mismatched} mismatched`);
      toast.info(`${actionLabel}: ${parts.join(', ')}`);

      return bulkOutcome;
    } finally {
      setIsRunning(false);
    }
  }, [invalidate, fetchReconciledResources]);

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
