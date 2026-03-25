import { memo, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, RefreshCw } from 'lucide-react';
import { useBulkIngestion } from '@/hooks/useBulkIngestion';
import { BulkIngestionPanel } from './BulkIngestionPanel';
import { useQueryClient } from '@tanstack/react-query';
import {
  getEligibleResources,
  getEligibleCount,
  selectEligibleBatch,
  toEligibleResourceItems,
  assertBatchEligibility,
  logEligibilitySnapshot,
  logSelectedBatch,
  type EnrichMode,
} from '@/lib/resourceEligibility';
import { createLogger } from '@/lib/logger';
import type { Resource } from '@/hooks/useResources';

const log = createLogger('DeepEnrichModal');

interface DeepEnrichModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: Resource[];
  selectedIds?: Set<string>;
}

export const DeepEnrichModal = memo(function DeepEnrichModal({
  open,
  onOpenChange,
  resources,
  selectedIds,
}: DeepEnrichModalProps) {
  const bulk = useBulkIngestion();
  const queryClient = useQueryClient();
  const isProcessing = bulk.state.status === 'running' || bulk.state.status === 'paused';
  const isDone = bulk.state.status === 'completed' || bulk.state.status === 'failed' || bulk.state.status === 'cancelled';
  const [mode, setMode] = useState<EnrichMode>('deep_enrich');

  const scopedResources = useMemo(() => {
    if (selectedIds && selectedIds.size > 0) {
      return resources.filter((resource) => selectedIds.has(resource.id));
    }
    return resources;
  }, [resources, selectedIds]);

  const deepEligibleResources = useMemo(() => getEligibleResources(scopedResources, 'deep_enrich'), [scopedResources]);
  const reEnrichEligibleResources = useMemo(() => getEligibleResources(scopedResources, 're_enrich'), [scopedResources]);
  const activeEligibleResources = mode === 'deep_enrich' ? deepEligibleResources : reEnrichEligibleResources;
  const sourceItems = useMemo(() => toEligibleResourceItems(activeEligibleResources, mode), [activeEligibleResources, mode]);
  const eligibleCount = useMemo(() => getEligibleCount(scopedResources, mode), [scopedResources, mode]);

  const handleStart = useCallback(
    (
      requestedItems: Array<{ resourceId?: string; url: string; title: string; enrichMode?: EnrichMode }>,
      opts?: { retryFailedOnly?: boolean },
    ) => {
      if (opts?.retryFailedOnly) {
        bulk.start(requestedItems, opts);
        return;
      }

      const canonicalEligibleResources = getEligibleResources(scopedResources, mode);
      const queueAllRequested = requestedItems.length === sourceItems.length && sourceItems.length > bulk.state.batchSize;
      const selectedResources = queueAllRequested
        ? canonicalEligibleResources
        : selectEligibleBatch(scopedResources, mode, bulk.state.batchSize);

      logEligibilitySnapshot(scopedResources, mode, 'pre-batch');
      logSelectedBatch(selectedResources, mode, 'pre-batch');

      try {
        assertBatchEligibility(selectedResources, mode, scopedResources);
      } catch (error) {
        log.error('Blocked invalid enrich batch selection', { error, mode });
        return;
      }

      bulk.start(toEligibleResourceItems(selectedResources, mode), opts);
    },
    [bulk, mode, scopedResources, sourceItems.length],
  );

  const handleClose = useCallback(() => {
    if (isProcessing) return;
    if (isDone) {
      bulk.reset();
      queryClient.invalidateQueries({ queryKey: ['resources'] });
    }
    onOpenChange(false);
  }, [isProcessing, isDone, bulk, queryClient, onOpenChange]);

  const handleModeChange = (value: string) => {
    if (isProcessing || isDone) return;
    setMode(value as EnrichMode);
  };

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'deep_enrich' ? (
              <Zap className="h-5 w-5 text-primary" />
            ) : (
              <RefreshCw className="h-5 w-5 text-primary" />
            )}
            {mode === 'deep_enrich' ? 'Deep Enrich Resources' : 'Re-enrich Resources'}
          </DialogTitle>
        </DialogHeader>

        {!isProcessing && !isDone && (
          <Tabs value={mode} onValueChange={handleModeChange} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="deep_enrich" className="gap-1 text-xs">
                <Zap className="h-3 w-3" />
                Deep Enrich ({deepEligibleResources.length})
              </TabsTrigger>
              <TabsTrigger value="re_enrich" className="gap-1 text-xs">
                <RefreshCw className="h-3 w-3" />
                Re-enrich ({reEnrichEligibleResources.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {!isProcessing && !isDone && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">{scopedResources.length}</span> total resources
              {selectedIds && selectedIds.size > 0 && ' (selected)'}
              {' · '}
              <span className="font-medium text-foreground">{eligibleCount}</span> eligible for {mode === 'deep_enrich' ? 'deep enrichment' : 're-enrichment'}
            </p>
            {eligibleCount === 0 && (
              <p className="text-status-yellow">
                {mode === 'deep_enrich'
                  ? 'All resources are already enriched. Switch to Re-enrich to reprocess.'
                  : 'No previously enriched resources to reprocess.'}
              </p>
            )}
          </div>
        )}

        <BulkIngestionPanel
          state={bulk.state}
          onSetBatchSize={bulk.setBatchSize}
          onStart={handleStart}
          onPause={bulk.pause}
          onResume={bulk.resume}
          onCancel={bulk.cancel}
          onReset={bulk.reset}
          hasFailures={bulk.hasFailures}
          sourceItems={sourceItems}
          sourceLabel="resources"
          totalEligible={eligibleCount}
        />

        {isDone && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
});
