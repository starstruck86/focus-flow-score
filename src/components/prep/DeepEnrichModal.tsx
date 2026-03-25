import { memo, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Zap, RefreshCw } from 'lucide-react';
import { useBulkIngestion } from '@/hooks/useBulkIngestion';
import { BulkIngestionPanel } from './BulkIngestionPanel';
import { useQueryClient } from '@tanstack/react-query';
import {
  getEligiblePool,
  toSourceItems,
  assertBatchEligibility,
  logEligibilitySnapshot,
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
  const [mode, setMode] = useState<EnrichMode>('deep');

  // Scope to selected or all
  const scopedResources = useMemo(() => {
    if (selectedIds && selectedIds.size > 0) {
      return resources.filter(r => selectedIds.has(r.id));
    }
    return resources;
  }, [resources, selectedIds]);

  // ── Canonical eligibility pools (single source of truth) ──
  const deepPool = useMemo(() => getEligiblePool(scopedResources, 'deep'), [scopedResources]);
  const reenrichPool = useMemo(() => getEligiblePool(scopedResources, 'reenrich'), [scopedResources]);

  const activePool = mode === 'deep' ? deepPool : reenrichPool;
  const sourceItems = useMemo(() => toSourceItems(activePool), [activePool]);

  // ── Wrapped start with pre-batch assertion ──
  const handleStart = useCallback(
    (items: Array<{ url: string; title: string }>, opts?: { retryFailedOnly?: boolean }) => {
      if (!opts?.retryFailedOnly) {
        // Map source items back to Resource objects for assertion
        const urlSet = new Set(items.map(i => i.url));
        const batchResources = activePool.filter(r => r.file_url && urlSet.has(r.file_url));

        try {
          assertBatchEligibility(batchResources, mode, scopedResources);
        } catch (err) {
          log.error('Batch rejected by eligibility assertion', { error: err });
          return; // Block the batch
        }

        logEligibilitySnapshot(scopedResources, mode, 'pre-batch');
      }

      bulk.start(items, opts);
    },
    [activePool, mode, scopedResources, bulk],
  );

  const handleClose = useCallback(() => {
    if (isProcessing) return;
    if (isDone) {
      bulk.reset();
      // Recompute eligible counts from canonical source after batch
      queryClient.invalidateQueries({ queryKey: ['resources'] });
    }
    onOpenChange(false);
  }, [isProcessing, isDone, bulk, queryClient, onOpenChange]);

  const handleModeChange = (v: string) => {
    if (isProcessing || isDone) return;
    setMode(v as EnrichMode);
  };

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'deep' ? (
              <Zap className="h-5 w-5 text-primary" />
            ) : (
              <RefreshCw className="h-5 w-5 text-primary" />
            )}
            {mode === 'deep' ? 'Deep Enrich Resources' : 'Re-enrich Resources'}
          </DialogTitle>
        </DialogHeader>

        {/* Mode tabs — only when idle */}
        {!isProcessing && !isDone && (
          <Tabs value={mode} onValueChange={handleModeChange} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="deep" className="text-xs gap-1">
                <Zap className="h-3 w-3" />
                Deep Enrich ({deepPool.length})
              </TabsTrigger>
              <TabsTrigger value="reenrich" className="text-xs gap-1">
                <RefreshCw className="h-3 w-3" />
                Re-enrich ({reenrichPool.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Summary before run */}
        {!isProcessing && !isDone && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">{scopedResources.length}</span> total resources
              {selectedIds && selectedIds.size > 0 && ' (selected)'}
              {' · '}
              <span className="font-medium text-foreground">{activePool.length}</span> eligible for {mode === 'deep' ? 'deep enrichment' : 're-enrichment'}
            </p>
            {activePool.length === 0 && (
              <p className="text-status-yellow">
                {mode === 'deep'
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
          totalEligible={activePool.length}
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
