import { memo, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Play, Pause, Square, RotateCcw, ChevronDown,
  CheckCircle2, XCircle, SkipForward, AlertTriangle,
  Eye, Loader2, Zap, Lock, AlertOctagon, TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  IngestionState,
  IngestionJobStatus,
  IngestionItem,
} from '@/store/useEnrichmentJobStore';

interface BulkIngestionPanelProps {
  state: IngestionState;
  onSetBatchSize: (size: number) => void;
  onSetReprocessMode?: (mode: any) => void;
  onStart: (items: Array<{ resourceId?: string; url: string; title: string; enrichMode?: 'deep_enrich' | 're_enrich'; videoId?: string; channel?: string; publishDate?: string; duration?: string }>, opts?: { retryFailedOnly?: boolean }) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReset: () => void;
  hasFailures: boolean;
  sourceItems: Array<{ resourceId?: string; url: string; title: string; enrichMode?: 'deep_enrich' | 're_enrich'; videoId?: string; channel?: string; publishDate?: string; duration?: string }>;
  sourceLabel?: string;
  totalEligible?: number;
}

const STATUS_LABELS: Record<IngestionJobStatus, string> = {
  idle: 'Ready',
  running: 'Deep Enriching…',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Completed with errors',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<IngestionJobStatus, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-primary/20 text-primary',
  paused: 'bg-status-yellow/20 text-status-yellow',
  completed: 'bg-status-green/20 text-status-green',
  failed: 'bg-status-red/20 text-status-red',
  cancelled: 'bg-muted text-muted-foreground',
};

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  preflight: 'Preflight…',
  preprocessing: 'Preprocessing…',
  checking_duplicate: 'Checking duplicates…',
  fetching: 'Fetching…',
  classifying: 'Classifying…',
  saving: 'Saving…',
  enriching: 'Deep enriching…',
  verifying: 'Verifying…',
  complete: 'Enriched',
  partial: 'Partially Enriched',
  needs_auth: 'Needs Auth',
  unsupported: 'Unsupported',
  skipped: 'Skipped',
  failed: 'Failed',
  needs_review: 'Needs review',
};

/** User-friendly failure labels keyed by FailureCategory */
const FAILURE_LABELS: Record<string, string> = {
  failed_network_transport: 'Network issue — retrying',
  failed_edge_unreachable: 'Server unreachable — retrying',
  failed_timeout: 'Timed out — retrying with extended timeout',
  failed_request_too_large: 'Content too large — needs smaller payload',
  failed_request: 'Request error — retrying',
  failed_request_serialization: 'Serialization error',
  failed_quality: 'Content too weak to enrich',
  failed_needs_auth: 'Needs authentication',
  failed_unsupported: 'Source type not supported',
  failed_preflight: 'Preflight check failed',
  failed_bad_route: 'Service route not found',
  failed_missing_auth: 'Session expired — sign in again',
  failed_verification: 'Post-write verification failed',
  failed_write: 'Failed to save data',
  failed_preflight_blocked: 'Blocked by preflight',
  failed_unknown_transport: 'Transport error',
  failed_unknown: 'Unexpected error',
};

const SKIP_REASON_LABELS: Record<string, string> = {
  already_enriched: 'Already enriched',
  duplicate_resource: 'Duplicate detected',
  unsupported_source: 'Unsupported source type',
  invalid_url: 'Invalid URL',
  missing_data: 'Missing required data',
};

function ItemDetail({ item }: { item: IngestionItem }) {
  const isRetryable = item.retryEligible !== false;
  const failureLabel = item.failureCategory
    ? (FAILURE_LABELS[item.failureCategory] || item.failureCategory.replace(/^failed_/, '').replace(/_/g, ' '))
    : null;
  return (
    <div className="flex items-start gap-2 text-[11px] bg-destructive/5 rounded px-2 py-1.5">
      {item.stage === 'needs_auth' ? (
        <Lock className="h-3 w-3 text-status-yellow mt-0.5 shrink-0" />
      ) : item.stage === 'unsupported' ? (
        <AlertOctagon className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
      ) : item.stage === 'partial' ? (
        <TriangleAlert className="h-3 w-3 text-status-yellow mt-0.5 shrink-0" />
      ) : (
        <XCircle className="h-3 w-3 text-status-red mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground truncate block">{item.title}</span>
        {item.error && <p className="text-muted-foreground">{item.error}</p>}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {failureLabel && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 uppercase tracking-[0.08em]">
              {failureLabel}
            </Badge>
          )}
          {item.sourceType && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono">
              {item.sourceType}
            </Badge>
          )}
          {item.platform && (
            <Badge variant="outline" className="text-[9px] h-4 px-1">
              {item.platform}
            </Badge>
          )}
          {item.methodUsed && (
            <span className="text-[10px] text-muted-foreground">via {item.methodUsed}</span>
          )}
          {item.attemptCount != null && item.attemptCount > 1 && (
            <span className="text-[10px] text-muted-foreground">{item.attemptCount} attempts</span>
          )}
          {item.completenessScore != null && (
            <span className="text-[10px] text-muted-foreground">score: {item.completenessScore}</span>
          )}
        </div>
        {item.recoveryHint && (
          <p className="text-[10px] text-primary/80 italic mt-0.5">{item.recoveryHint}</p>
        )}
        {!isRetryable && (
          <p className="text-[10px] text-muted-foreground italic mt-0.5">Not retryable — fix source first</p>
        )}
      </div>
    </div>
  );
}

export const BulkIngestionPanel = memo(function BulkIngestionPanel({
  state,
  onSetBatchSize,
  onStart,
  onPause,
  onResume,
  onCancel,
  onReset,
  hasFailures,
  sourceItems,
  sourceLabel = 'items',
  totalEligible,
}: BulkIngestionPanelProps) {
  const isActive = state.status === 'running' || state.status === 'paused';
  const isDone = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
  const progressPct = state.totalItems > 0 ? Math.round((state.processedCount / state.totalItems) * 100) : 0;
  const [showFailed, setShowFailed] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showPartial, setShowPartial] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const failedItems = useMemo(() => state.items.filter(i => i.stage === 'failed'), [state.items]);
  const skippedItems = useMemo(() => state.items.filter(i => i.stage === 'skipped'), [state.items]);
  const partialItems = useMemo(() => state.items.filter(i => i.stage === 'partial'), [state.items]);
  const authItems = useMemo(() => state.items.filter(i => i.stage === 'needs_auth' || i.stage === 'unsupported'), [state.items]);
  const currentItem = useMemo(
    () => state.items.find(i => !['queued', 'complete', 'partial', 'needs_auth', 'unsupported', 'skipped', 'failed', 'needs_review'].includes(i.stage)),
    [state.items]
  );

  const allSkipped = isDone && state.skippedCount > 0 && state.successCount === 0 && state.failedCount === 0 && (state.partialCount || 0) === 0;
  const retryableCount = failedItems.filter(i => i.retryEligible !== false).length;

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Deep Enrich</h3>
          <Badge className={cn('text-[10px]', STATUS_COLORS[state.status])}>
            {STATUS_LABELS[state.status]}
          </Badge>
        </div>
        {isDone && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onReset}>
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
        )}
      </div>

      {/* Controls — idle */}
      {state.status === 'idle' && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Classifies source type, runs multi-method extraction with fallback, and validates quality before marking enriched.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Batch:</span>
              <Select value={String(state.batchSize)} onValueChange={v => onSetBatchSize(Number(v))}>
                <SelectTrigger className="h-7 w-[64px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {sourceItems.length > 0 && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className="font-medium text-foreground">{sourceItems.length}</span>
              <span>eligible {sourceLabel}</span>
              {totalEligible != null && totalEligible > sourceItems.length && (
                <>
                  <span>·</span>
                  <span>{totalEligible} total eligible</span>
                </>
              )}
              <span>·</span>
              <span>will process <span className="font-medium text-foreground">{Math.min(state.batchSize, sourceItems.length)}</span> per batch</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={sourceItems.length === 0}
              onClick={() => onStart(sourceItems.slice(0, state.batchSize))}
            >
              <Play className="h-3.5 w-3.5" />
              Run next {Math.min(state.batchSize, sourceItems.length)}
            </Button>
            {sourceItems.length > state.batchSize && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => onStart(sourceItems)}
              >
                <Zap className="h-3.5 w-3.5" />
                Queue all {sourceItems.length} in batches
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Progress */}
      {(isActive || isDone) && (
        <div className="space-y-2">
          <Progress value={progressPct} className="h-2" />

          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1 text-muted-foreground">
              {state.currentBatch > 0 && <span>Batch {state.currentBatch}/{state.totalBatches} · </span>}
              <span>{state.processedCount}/{state.totalItems}</span>
              {currentItem && (
                <span className="ml-1 flex items-center gap-1">
                  · <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="truncate max-w-[140px]">{currentItem.title}</span>
                  <span className="text-primary">{STAGE_LABELS[currentItem.stage] || currentItem.stage}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-0.5 text-status-green">
                <CheckCircle2 className="h-3 w-3" /> {state.successCount}
              </span>
              {(state.partialCount || 0) > 0 && (
                <span className="flex items-center gap-0.5 text-status-yellow">
                  <TriangleAlert className="h-3 w-3" /> {state.partialCount}
                </span>
              )}
              {(state.needsAuthCount || 0) > 0 && (
                <span className="flex items-center gap-0.5 text-status-yellow">
                  <Lock className="h-3 w-3" /> {state.needsAuthCount}
                </span>
              )}
              {state.failedCount > 0 && (
                <span className="flex items-center gap-0.5 text-status-red">
                  <XCircle className="h-3 w-3" /> {state.failedCount}
                </span>
              )}
              {state.skippedCount > 0 && (
                <span className="flex items-center gap-0.5 text-muted-foreground">
                  <SkipForward className="h-3 w-3" /> {state.skippedCount}
                </span>
              )}
            </div>
          </div>

          {/* Active controls */}
          {isActive && (
            <div className="flex items-center gap-2">
              {state.status === 'running' ? (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onPause}>
                  <Pause className="h-3 w-3" /> Pause
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onResume}>
                  <Play className="h-3 w-3" /> Resume
                </Button>
              )}
              <Button variant="destructive" size="sm" className="h-7 text-xs gap-1" onClick={onCancel}>
                <Square className="h-3 w-3" /> Stop
              </Button>
            </div>
          )}

          {/* Retry */}
          {isDone && retryableCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onStart(sourceItems, { retryFailedOnly: true })}
            >
              <RotateCcw className="h-3 w-3" />
              Retry {retryableCount} failed
            </Button>
          )}

          {/* Post-batch remaining */}
          {isDone && (totalEligible != null ? totalEligible - state.successCount > 0 : sourceItems.length > state.processedCount) && (
            <div className="text-[11px] text-muted-foreground pt-1">
              {state.successCount > 0 && <span className="text-status-green font-medium">{state.successCount} enriched</span>}
              {' · '}
              {totalEligible != null
                ? `${Math.max(0, totalEligible - state.successCount)} eligible ${sourceLabel} remaining`
                : `${sourceItems.length - state.processedCount} ${sourceLabel} remaining`}
            </div>
          )}
        </div>
      )}

      {/* All-skipped explanation */}
      {allSkipped && (
        <div className="bg-muted/50 rounded-md p-3 text-[11px] text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">All {state.skippedCount} {sourceLabel} were skipped</p>
          <p>Items were skipped because they were already enriched or are duplicates.</p>
        </div>
      )}

      {/* Trust gate summary */}
      {isDone && !allSkipped && (
        <div className="flex items-center gap-4 text-[11px] pt-1 border-t border-border flex-wrap">
          <span className="text-status-green font-medium">{state.successCount} enriched</span>
          {(state.partialCount || 0) > 0 && <span className="text-status-yellow">{state.partialCount} partial</span>}
          {(state.needsAuthCount || 0) > 0 && <span className="text-status-yellow">{state.needsAuthCount} needs auth</span>}
          {(state.unsupportedCount || 0) > 0 && <span className="text-muted-foreground">{state.unsupportedCount} unsupported</span>}
          <span className="text-muted-foreground">{state.skippedCount} skipped</span>
          {state.failedCount > 0 && <span className="text-status-red">{state.failedCount} failed</span>}
        </div>
      )}

      {/* Partial details */}
      {isDone && partialItems.length > 0 && (
        <Collapsible open={showPartial} onOpenChange={setShowPartial}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-status-yellow hover:underline">
            <TriangleAlert className="h-3 w-3" />
            {partialItems.length} partially enriched — view details
            <ChevronDown className={cn("h-3 w-3 transition-transform", showPartial && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {partialItems.map(item => <ItemDetail key={item.id} item={item} />)}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Auth/unsupported details */}
      {isDone && authItems.length > 0 && (
        <Collapsible open={showAuth} onOpenChange={setShowAuth}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-status-yellow hover:underline">
            <Lock className="h-3 w-3" />
            {authItems.length} need auth or unsupported — view details
            <ChevronDown className={cn("h-3 w-3 transition-transform", showAuth && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {authItems.map(item => <ItemDetail key={item.id} item={item} />)}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Skip details */}
      {isDone && skippedItems.length > 0 && (
        <Collapsible open={showSkipped} onOpenChange={setShowSkipped}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            <SkipForward className="h-3 w-3" />
            {skippedItems.length} skipped — view reasons
            <ChevronDown className={cn("h-3 w-3 transition-transform", showSkipped && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1 max-h-36 overflow-y-auto">
            {skippedItems.map(item => (
              <div key={item.id} className="flex items-start gap-2 text-[11px] bg-muted/30 rounded px-2 py-1">
                <SkipForward className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-foreground truncate block">{item.title}</span>
                  <p className="text-muted-foreground">
                    {item.error ? (SKIP_REASON_LABELS[item.error] || item.error) : 'Already enriched'}
                  </p>
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Failed details */}
      {isDone && failedItems.length > 0 && (
        <Collapsible open={showFailed} onOpenChange={setShowFailed}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-status-red hover:underline">
            <AlertTriangle className="h-3 w-3" />
            {failedItems.length} failed — view details
            <ChevronDown className={cn("h-3 w-3 transition-transform", showFailed && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {failedItems.map(item => <ItemDetail key={item.id} item={item} />)}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
});
