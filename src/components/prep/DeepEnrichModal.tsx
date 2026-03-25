import { memo, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Zap, RefreshCw } from 'lucide-react';
import { useBulkIngestion } from '@/hooks/useBulkIngestion';
import { BulkIngestionPanel } from './BulkIngestionPanel';
import type { Resource } from '@/hooks/useResources';

interface DeepEnrichModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: Resource[];
  selectedIds?: Set<string>;
}

/** Resources eligible for first-time deep enrichment */
function getDeepEnrichPool(resources: Resource[]): Resource[] {
  return resources.filter(r => {
    if (!r.file_url || !r.file_url.startsWith('http')) return false;
    const status = (r as any).content_status;
    // Eligible if never enriched (placeholder, file, or missing status)
    return !status || status === 'placeholder' || status === 'file';
  });
}

/** Resources eligible for re-enrichment */
function getReenrichPool(resources: Resource[]): Resource[] {
  return resources.filter(r => {
    if (!r.file_url || !r.file_url.startsWith('http')) return false;
    const status = (r as any).content_status;
    return status === 'enriched';
  });
}

function toSourceItems(pool: Resource[]) {
  return pool.map(r => ({
    url: r.file_url as string,
    title: r.title,
  }));
}

export const DeepEnrichModal = memo(function DeepEnrichModal({
  open,
  onOpenChange,
  resources,
  selectedIds,
}: DeepEnrichModalProps) {
  const bulk = useBulkIngestion();
  const isProcessing = bulk.state.status === 'running' || bulk.state.status === 'paused';
  const isDone = bulk.state.status === 'completed' || bulk.state.status === 'failed' || bulk.state.status === 'cancelled';
  const [mode, setMode] = useState<'deep' | 'reenrich'>('deep');

  // Scope to selected or all
  const scopedResources = useMemo(() => {
    if (selectedIds && selectedIds.size > 0) {
      return resources.filter(r => selectedIds.has(r.id));
    }
    return resources;
  }, [resources, selectedIds]);

  const deepPool = useMemo(() => getDeepEnrichPool(scopedResources), [scopedResources]);
  const reenrichPool = useMemo(() => getReenrichPool(scopedResources), [scopedResources]);

  const activePool = mode === 'deep' ? deepPool : reenrichPool;
  const sourceItems = useMemo(() => toSourceItems(activePool), [activePool]);

  const handleClose = () => {
    if (isProcessing) return;
    if (isDone) bulk.reset();
    onOpenChange(false);
  };

  const handleModeChange = (v: string) => {
    if (isProcessing || isDone) return;
    setMode(v as 'deep' | 'reenrich');
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
          onStart={bulk.start}
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
