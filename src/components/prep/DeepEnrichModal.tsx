import { memo, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, RefreshCw } from 'lucide-react';
import { BulkIngestionPanel } from './BulkIngestionPanel';
import { useQueryClient } from '@tanstack/react-query';
import { useEnrichmentJobStore } from '@/store/useEnrichmentJobStore';
import { useAuth } from '@/contexts/AuthContext';
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const store = useEnrichmentJobStore();
  const { state } = store;
  const isProcessing = state.status === 'running' || state.status === 'paused';
  const isDone = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
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
      if (!user) return;

      if (opts?.retryFailedOnly) {
        store.start(user.id, requestedItems, opts);
        return;
      }

      const canonicalEligibleResources = getEligibleResources(scopedResources, mode);
      const queueAllRequested = requestedItems.length === sourceItems.length && sourceItems.length > state.batchSize;
      const selectedResources = queueAllRequested
        ? canonicalEligibleResources
        : selectEligibleBatch(scopedResources, mode, state.batchSize);

      logEligibilitySnapshot(scopedResources, mode, 'pre-batch');
      logSelectedBatch(selectedResources, mode, 'pre-batch');

      try {
        assertBatchEligibility(selectedResources, mode, scopedResources);
      } catch (error) {
        log.error('Blocked invalid enrich batch selection', { error, mode });
        return;
      }

      store.setMode(mode);
      store.start(user.id, toEligibleResourceItems(selectedResources, mode), opts);
    },
    [store, mode, scopedResources, sourceItems.length, state.batchSize, user],
  );

  // Closing the modal does NOT stop the job — this is the key change
  const handleClose = useCallback(() => {
    if (isDone) {
      store.reset();
      queryClient.invalidateQueries({ queryKey: ['resources'] });
    }
    onOpenChange(false);
  }, [isDone, store, queryClient, onOpenChange]);

  const handleModeChange = (value: string) => {
    if (isProcessing || isDone) return;
    setMode(value as EnrichMode);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
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
          state={state}
          onSetBatchSize={store.setBatchSize}
          onStart={handleStart}
          onPause={store.pause}
          onResume={store.resume}
          onCancel={store.cancel}
          onReset={store.reset}
          hasFailures={store.hasFailures()}
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
