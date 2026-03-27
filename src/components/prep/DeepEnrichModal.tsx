import { memo, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Zap, RefreshCw, AlertTriangle, Info, FileAudio } from 'lucide-react';
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
  classifyEnrichability,
  getSubtypeLabel,
  getEnrichabilityLabel,
  getEnrichabilityColor,
} from '@/lib/salesBrain/resourceSubtype';
import {
  isAudioResource,
  detectAudioSubtype,
  getAudioStrategy,
  getAudioJobForResource,
  getAudioStageLabel,
  getAudioFailureDescription,
} from '@/lib/salesBrain/audioPipeline';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';
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
  const [showReasons, setShowReasons] = useState(false);

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

  // Per-resource enrichability breakdown
  const enrichabilityBreakdown = useMemo(() => {
    const breakdown: Record<string, { count: number; resources: Array<{ title: string; reason: string }> }> = {};
    for (const r of scopedResources) {
      const result = classifyEnrichability(r.file_url, r.resource_type);
      const key = result.enrichability;
      if (!breakdown[key]) breakdown[key] = { count: 0, resources: [] };
      breakdown[key].count++;
      breakdown[key].resources.push({
        title: r.title,
        reason: `${getSubtypeLabel(result.subtype)} — ${result.reason}`,
      });
    }
    return breakdown;
  }, [scopedResources]);

  const blockedCount = useMemo(() => {
    return scopedResources.length - eligibleCount;
  }, [scopedResources.length, eligibleCount]);

  // Audio-specific breakdown
  const audioBreakdown = useMemo(() => {
    const audioResources = scopedResources.filter(r => isAudioResource(r.file_url, r.resource_type));
    const items = audioResources.map(r => {
      const sub = detectAudioSubtype(r.file_url, r.resource_type);
      const strategy = getAudioStrategy(sub);
      const job = getAudioJobForResource(r.id);
      return { resource: r, subtype: sub, strategy, job };
    });
    return {
      total: audioResources.length,
      items,
      failed: items.filter(i => i.job?.stage === 'failed').length,
      needsManual: items.filter(i => i.job?.stage === 'needs_manual_assist' || i.strategy.manualAssistRequired).length,
      retryable: items.filter(i => i.job?.stage === 'failed' && i.job?.retryable).length,
    };
  }, [scopedResources]);

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
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <p>
                <span className="font-medium text-foreground">{scopedResources.length}</span> total resources
                {selectedIds && selectedIds.size > 0 && ' (selected)'}
                {' · '}
                <span className="font-medium text-foreground">{eligibleCount}</span> eligible
                {blockedCount > 0 && (
                  <>
                    {' · '}
                    <span className="font-medium text-status-yellow">{blockedCount}</span> blocked
                  </>
                )}
              </p>
              {blockedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1"
                  onClick={() => setShowReasons(!showReasons)}
                >
                  <Info className="h-3 w-3" />
                  {showReasons ? 'Hide' : 'Show'} reasons
                </Button>
              )}
            </div>

            {eligibleCount === 0 && (
              <p className="text-status-yellow">
                {mode === 'deep_enrich'
                  ? 'All resources are already enriched. Switch to Re-enrich to reprocess.'
                  : 'No previously enriched resources to reprocess.'}
              </p>
            )}

            {showReasons && (
              <ScrollArea className="max-h-[180px] border border-border rounded-md p-2">
                <div className="space-y-1.5">
                  {Object.entries(enrichabilityBreakdown).map(([state, data]) => (
                    <div key={state}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Badge className={cn('text-[8px]', getEnrichabilityColor(state as any))}>
                          {getEnrichabilityLabel(state as any)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">({data.count})</span>
                      </div>
                      {data.resources.slice(0, 5).map((r, i) => (
                        <p key={i} className="text-[10px] text-muted-foreground pl-3 truncate">
                          {r.title} — {r.reason}
                        </p>
                      ))}
                      {data.resources.length > 5 && (
                        <p className="text-[10px] text-muted-foreground pl-3">
                          +{data.resources.length - 5} more
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
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
