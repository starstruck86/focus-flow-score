import { memo, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';
import { useBulkIngestion } from '@/hooks/useBulkIngestion';
import { BulkIngestionPanel } from './BulkIngestionPanel';
import type { Resource } from '@/hooks/useResources';

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
  const isProcessing = bulk.state.status === 'running' || bulk.state.status === 'paused';
  const isDone = bulk.state.status === 'completed' || bulk.state.status === 'failed' || bulk.state.status === 'cancelled';

  // Build source items from resources that have URLs
  const sourceItems = useMemo(() => {
    const pool = selectedIds && selectedIds.size > 0
      ? resources.filter(r => selectedIds.has(r.id))
      : resources;

    return pool
      .filter(r => (r as any).file_url)
      .map(r => ({
        url: (r as any).file_url as string,
        title: r.title,
      }));
  }, [resources, selectedIds]);

  const handleClose = () => {
    if (isProcessing) return;
    if (isDone) {
      bulk.reset();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Deep Enrich Resources
          </DialogTitle>
          {!isProcessing && !isDone && (
            <p className="text-sm text-muted-foreground">
              {selectedIds && selectedIds.size > 0
                ? `${sourceItems.length} selected resources eligible for deep enrichment.`
                : `${sourceItems.length} resources with URL links eligible for deep enrichment.`}
              {' '}Choose a batch size below — the primary button processes only that batch.
            </p>
          )}
        </DialogHeader>

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
