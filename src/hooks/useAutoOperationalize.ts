/**
 * useAutoOperationalize — hook that triggers auto-operationalization
 * after resource upload, fix, or content-ready transitions.
 *
 * Provides a manual trigger and exposes the latest result for UI display.
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

export function useAutoOperationalize() {
  const qc = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<AutoOperationalizeResult | null>(null);
  const [lastBatchSummary, setLastBatchSummary] = useState<BatchSummary | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    qc.invalidateQueries({ queryKey: ['resources'] });
  }, [qc]);

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
        } else if (result.stagesCompleted.includes('activated')) {
          toast.success(`${result.knowledgeActivated} knowledge items activated`);
        } else if (result.stagesCompleted.includes('knowledge_extracted')) {
          toast.info(`${result.knowledgeExtracted} items extracted — review and activate`);
        }
      }

      return result;
    } finally {
      setIsRunning(false);
    }
  }, [invalidate]);

  const operationalizeBatch = useCallback(async (resourceIds: string[]): Promise<BatchSummary> => {
    setIsRunning(true);
    try {
      const results: AutoOperationalizeResult[] = [];
      for (const resourceId of resourceIds) {
        const result = await autoOperationalizeResource(resourceId);
        results.push(result);
        // Invalidate after each resource so UI shows live state
        invalidate();
      }
      const summary = summarizeBatchResults(results);
      setLastBatchSummary(summary);

      if (summary.operationalized > 0) {
        toast.success(`${summary.operationalized} resource(s) operationalized, ${summary.totalKnowledgeActivated} items activated`);
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
    operationalizeBatch,
    isRunning,
    lastResult,
    lastBatchSummary,
  };
}
