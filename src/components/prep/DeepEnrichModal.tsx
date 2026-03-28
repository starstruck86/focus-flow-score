import { memo, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Zap, RefreshCw, AlertTriangle, Info, CheckCircle2, HelpCircle } from 'lucide-react';
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
import {
  deriveProcessingState,
  deriveModalActionState,
  getProcessingStateColor,
  type ActionState,
} from '@/lib/processingState';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import type { Resource } from '@/hooks/useResources';

const log = createLogger('DeepEnrichModal');

interface DeepEnrichModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: Resource[];
  selectedIds?: Set<string>;
  audioJobsMap?: Map<string, AudioJobRecord>;
}

export const DeepEnrichModal = memo(function DeepEnrichModal({
  open,
  onOpenChange,
  resources,
  selectedIds,
  audioJobsMap,
}: DeepEnrichModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const store = useEnrichmentJobStore();
  const { state } = store;
  const isProcessing = state.status === 'running' || state.status === 'paused';
  const isDone = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
  const [mode, setMode] = useState<EnrichMode>('deep_enrich');
  const [showDetails, setShowDetails] = useState(false);

  const scopedResources = useMemo(() => {
    if (selectedIds && selectedIds.size > 0) {
      return resources.filter((resource) => selectedIds.has(resource.id));
    }
    return resources;
  }, [resources, selectedIds]);

  const deepEligibleCount = useMemo(() => getEligibleCount(scopedResources, 'deep_enrich'), [scopedResources]);
  const reEnrichEligibleCount = useMemo(() => getEligibleCount(scopedResources, 're_enrich'), [scopedResources]);

  // Auto-switch mode if current mode has 0 eligible but other doesn't
  const effectiveMode = useMemo(() => {
    if (mode === 'deep_enrich' && deepEligibleCount === 0 && reEnrichEligibleCount > 0) return 're_enrich';
    if (mode === 're_enrich' && reEnrichEligibleCount === 0 && deepEligibleCount > 0) return 'deep_enrich';
    return mode;
  }, [mode, deepEligibleCount, reEnrichEligibleCount]);

  const activeEligibleResources = useMemo(
    () => getEligibleResources(scopedResources, effectiveMode),
    [scopedResources, effectiveMode],
  );
  const sourceItems = useMemo(
    () => toEligibleResourceItems(activeEligibleResources, effectiveMode),
    [activeEligibleResources, effectiveMode],
  );
  const eligibleCount = effectiveMode === 'deep_enrich' ? deepEligibleCount : reEnrichEligibleCount;

  // Derive ActionState from scoped resources
  const { actionState, counts } = useMemo(
    () => deriveModalActionState(scopedResources, audioJobsMap),
    [scopedResources, audioJobsMap],
  );

  // Per-resource processing state breakdown for details view
  const processingBreakdown = useMemo(() => {
    const groups: Record<string, Array<{ title: string; description: string; nextAction: string | null }>> = {
      READY: [],
      RUNNING: [],
      RETRYABLE_FAILURE: [],
      MANUAL_REQUIRED: [],
      METADATA_ONLY: [],
      COMPLETED: [],
    };
    for (const r of scopedResources) {
      const job = audioJobsMap?.get(r.id) ?? null;
      const ps = deriveProcessingState(r, job);
      groups[ps.state].push({ title: r.title, description: ps.description, nextAction: ps.nextAction });
    }
    return groups;
  }, [scopedResources, audioJobsMap]);

  const modeLabel = effectiveMode === 'deep_enrich' ? 'Deep Enrich' : 'Re-enrich';
  const ModeIcon = effectiveMode === 'deep_enrich' ? Zap : RefreshCw;

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

      const canonicalEligibleResources = getEligibleResources(scopedResources, effectiveMode);
      const queueAllRequested = requestedItems.length === sourceItems.length && sourceItems.length > state.batchSize;
      const selectedResources = queueAllRequested
        ? canonicalEligibleResources
        : selectEligibleBatch(scopedResources, effectiveMode, state.batchSize);

      logEligibilitySnapshot(scopedResources, effectiveMode, 'pre-batch');
      logSelectedBatch(selectedResources, effectiveMode, 'pre-batch');

      try {
        assertBatchEligibility(selectedResources, effectiveMode, scopedResources);
      } catch (error) {
        log.error('Blocked invalid enrich batch selection', { error, mode: effectiveMode });
        return;
      }

      store.setMode(effectiveMode);
      store.start(user.id, toEligibleResourceItems(selectedResources, effectiveMode), opts);
    },
    [store, effectiveMode, scopedResources, sourceItems.length, state.batchSize, user],
  );

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

  // ── Determine header state ────────────────────────────────
  const headerLabel = actionState === 'DONE'
    ? 'All Processed'
    : actionState === 'MANUAL_REQUIRED'
      ? 'Needs Attention'
      : `${modeLabel} Resources`;

  const HeaderIcon = actionState === 'DONE'
    ? CheckCircle2
    : actionState === 'MANUAL_REQUIRED'
      ? AlertTriangle
      : ModeIcon;

  // Whether mode tabs should render: only when both modes have >0 eligible
  const showModeTabs = actionState !== 'DONE' && deepEligibleCount > 0 && reEnrichEligibleCount > 0;

  // Whether the bulk ingestion panel should render
  const showBulkPanel = isProcessing || isDone || (eligibleCount > 0 && (actionState === 'RUN_ENRICH' || actionState === 'RETRY_FIXABLE'));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {/* Pre-start state */}
        {!isProcessing && !isDone && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <HeaderIcon className={cn('h-5 w-5', actionState === 'DONE' ? 'text-status-green' : 'text-primary')} />
                {headerLabel}
              </DialogTitle>
            </DialogHeader>

            {/* Mode tabs — only when BOTH modes have eligible items */}
            {showModeTabs && (
              <Tabs value={effectiveMode} onValueChange={handleModeChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="deep_enrich" className="gap-1 text-xs">
                    <Zap className="h-3 w-3" />
                    Deep Enrich ({deepEligibleCount})
                  </TabsTrigger>
                  <TabsTrigger value="re_enrich" className="gap-1 text-xs">
                    <RefreshCw className="h-3 w-3" />
                    Re-enrich ({reEnrichEligibleCount})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            {/* DONE state */}
            {actionState === 'DONE' && (
              <div className="text-center py-6 space-y-2">
                <CheckCircle2 className="h-10 w-10 text-status-green mx-auto" />
                <p className="text-sm font-medium text-foreground">All resources processed</p>
                <p className="text-xs text-muted-foreground">
                  {counts.done} completed
                  {counts.manual > 0 && ` · ${counts.manual} need manual input`}
                </p>
              </div>
            )}

            {/* Actionable states — summary + details */}
            {actionState !== 'DONE' && (
              <div className="space-y-3">
                {/* Primary action description */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <p>
                    {actionState === 'RUN_ENRICH' && (
                      <>
                        <span className="font-medium text-foreground">{eligibleCount}</span> ready to {modeLabel.toLowerCase()}
                      </>
                    )}
                    {actionState === 'RETRY_FIXABLE' && (
                      <>
                        <span className="font-medium text-orange-600">{counts.retryable}</span> can be retried automatically
                      </>
                    )}
                    {actionState === 'MANUAL_REQUIRED' && (
                      <>
                        <span className="font-medium text-status-red">{counts.manual}</span> need manual input or an alternate source
                      </>
                    )}
                    {/* Secondary counts */}
                    {actionState === 'RUN_ENRICH' && counts.retryable > 0 && (
                      <> · <span className="font-medium text-orange-600">{counts.retryable}</span> retryable</>
                    )}
                    {(actionState === 'RUN_ENRICH' || actionState === 'RETRY_FIXABLE') && counts.manual > 0 && (
                      <> · <span className="font-medium text-status-red">{counts.manual}</span> need attention</>
                    )}
                  </p>
                  {(counts.retryable > 0 || counts.manual > 0 || processingBreakdown.COMPLETED.length > 0) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => setShowDetails(!showDetails)}
                    >
                      <Info className="h-3 w-3" />
                      {showDetails ? 'Hide' : 'Details'}
                    </Button>
                  )}
                </div>

                {/* Details panel */}
                {showDetails && (
                  <ScrollArea className="max-h-[280px] border border-border rounded-md p-2">
                    <div className="space-y-3">
                      {processingBreakdown.RETRYABLE_FAILURE.length > 0 && (
                        <DetailSection
                          label="Retry Available"
                          color="bg-orange-500/20 text-orange-600"
                          items={processingBreakdown.RETRYABLE_FAILURE}
                        />
                      )}
                      {processingBreakdown.MANUAL_REQUIRED.length > 0 && (
                        <DetailSection
                          label="Manual Input Needed"
                          color="bg-status-red/20 text-status-red"
                          items={processingBreakdown.MANUAL_REQUIRED}
                        />
                      )}
                      {processingBreakdown.METADATA_ONLY.length > 0 && (
                        <DetailSection
                          label="Metadata Only"
                          color="bg-orange-500/20 text-orange-600"
                          items={processingBreakdown.METADATA_ONLY}
                        />
                      )}
                      {processingBreakdown.READY.length > 0 && (
                        <DetailSection
                          label="Ready"
                          color="bg-primary/20 text-primary"
                          items={processingBreakdown.READY}
                        />
                      )}
                      {processingBreakdown.COMPLETED.length > 0 && (
                        <DetailSection
                          label="Completed"
                          color="bg-status-green/20 text-status-green"
                          items={processingBreakdown.COMPLETED}
                        />
                      )}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </>
        )}

        {/* Processing/done header */}
        {(isProcessing || isDone) && (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ModeIcon className="h-5 w-5 text-primary" />
              {modeLabel} Resources
            </DialogTitle>
          </DialogHeader>
        )}

        {/* Bulk ingestion panel — ONLY when there's something to run or already running */}
        {showBulkPanel && (
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
        )}

        {/* Close buttons */}
        {isDone && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </DialogFooter>
        )}
        {!isProcessing && !isDone && actionState === 'DONE' && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </DialogFooter>
        )}
        {!isProcessing && !isDone && actionState === 'MANUAL_REQUIRED' && eligibleCount === 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
});

// ── Detail section sub-component ───────────────────────────
function DetailSection({
  label,
  color,
  items,
}: {
  label: string;
  color: string;
  items: Array<{ title: string; description: string; nextAction: string | null }>;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Badge className={cn('text-[8px]', color)}>{label}</Badge>
        <span className="text-[10px] text-muted-foreground">({items.length})</span>
      </div>
      {items.slice(0, 6).map((item, i) => (
        <div key={i} className="pl-3 mb-1">
          <p className="text-[10px] text-foreground truncate">{item.title}</p>
          <p className="text-[9px] text-muted-foreground">{item.description}</p>
          {item.nextAction && (
            <p className="text-[9px] text-primary">→ {item.nextAction}</p>
          )}
        </div>
      ))}
      {items.length > 6 && (
        <p className="text-[10px] text-muted-foreground pl-3">+{items.length - 6} more</p>
      )}
    </div>
  );
}
