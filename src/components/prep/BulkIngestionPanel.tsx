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
  Eye, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  IngestionState,
  IngestionJobStatus,
  IngestionItem,
  ReprocessMode,
} from '@/hooks/useBulkIngestion';

interface BulkIngestionPanelProps {
  state: IngestionState;
  onSetBatchSize: (size: number) => void;
  onSetReprocessMode: (mode: ReprocessMode) => void;
  onStart: (items: Array<{ url: string; title: string; videoId?: string; channel?: string; publishDate?: string; duration?: string }>, opts?: { retryFailedOnly?: boolean }) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReset: () => void;
  hasFailures: boolean;
  /** The items to process — pass selected/all videos or resources */
  sourceItems: Array<{ url: string; title: string; videoId?: string; channel?: string; publishDate?: string; duration?: string }>;
  sourceLabel?: string;
}

const STATUS_LABELS: Record<IngestionJobStatus, string> = {
  idle: 'Ready',
  running: 'Processing…',
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
  checking_duplicate: 'Checking duplicates…',
  fetching: 'Fetching…',
  classifying: 'Classifying…',
  saving: 'Saving…',
  enriching: 'Enriching…',
  complete: 'Complete',
  skipped: 'Skipped (duplicate)',
  failed: 'Failed',
  needs_review: 'Needs review',
};

const REPROCESS_LABELS: Record<ReprocessMode, string> = {
  skip_processed: 'Skip already processed',
  metadata_only: 'Refresh metadata only',
  summary_only: 'Refresh summaries',
  full_reprocess: 'Full reprocess',
};

export const BulkIngestionPanel = memo(function BulkIngestionPanel({
  state,
  onSetBatchSize,
  onSetReprocessMode,
  onStart,
  onPause,
  onResume,
  onCancel,
  onReset,
  hasFailures,
  sourceItems,
  sourceLabel = 'items',
}: BulkIngestionPanelProps) {
  const isActive = state.status === 'running' || state.status === 'paused';
  const isDone = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
  const progressPct = state.totalItems > 0 ? Math.round((state.processedCount / state.totalItems) * 100) : 0;
  const [showDetails, setShowDetails] = useState(false);

  const failedItems = useMemo(() => state.items.filter(i => i.stage === 'failed'), [state.items]);
  const reviewItems = useMemo(() => state.items.filter(i => i.stage === 'needs_review'), [state.items]);
  const currentItem = useMemo(
    () => state.items.find(i => !['queued', 'complete', 'skipped', 'failed', 'needs_review'].includes(i.stage)),
    [state.items]
  );

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Bulk Ingestion</h3>
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
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Batch:</span>
              <Select value={String(state.batchSize)} onValueChange={v => onSetBatchSize(Number(v))}>
                <SelectTrigger className="h-7 w-[64px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Duplicates:</span>
              <Select value={state.reprocessMode} onValueChange={v => onSetReprocessMode(v as ReprocessMode)}>
                <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(REPROCESS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={sourceItems.length === 0}
            onClick={() => onStart(sourceItems)}
          >
            <Play className="h-3 w-3" />
            Process {sourceItems.length} {sourceLabel}
          </Button>
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
                  <span className="text-primary">{STAGE_LABELS[currentItem.stage]}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-0.5 text-status-green">
                <CheckCircle2 className="h-3 w-3" /> {state.successCount}
              </span>
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
              {state.reviewCount > 0 && (
                <span className="flex items-center gap-0.5 text-status-yellow">
                  <Eye className="h-3 w-3" /> {state.reviewCount}
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
          {isDone && hasFailures && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onStart(sourceItems, { retryFailedOnly: true })}
            >
              <RotateCcw className="h-3 w-3" />
              Retry {failedItems.length} failed
            </Button>
          )}
        </div>
      )}

      {/* Results summary */}
      {isDone && (
        <div className="flex items-center gap-4 text-[11px] pt-1 border-t border-border">
          <span className="text-status-green font-medium">{state.successCount} added</span>
          <span className="text-muted-foreground">{state.skippedCount} skipped</span>
          {state.failedCount > 0 && <span className="text-status-red">{state.failedCount} failed</span>}
          {state.reviewCount > 0 && <span className="text-status-yellow">{state.reviewCount} need review</span>}
        </div>
      )}

      {/* Failed details */}
      {isDone && failedItems.length > 0 && (
        <Collapsible open={showDetails} onOpenChange={setShowDetails}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-status-red hover:underline">
            <AlertTriangle className="h-3 w-3" />
            {failedItems.length} failed — view details
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {failedItems.map(item => (
              <div key={item.id} className="flex items-start gap-2 text-[11px] bg-destructive/5 rounded px-2 py-1">
                <XCircle className="h-3 w-3 text-status-red mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-foreground truncate block">{item.title}</span>
                  {item.error && <p className="text-muted-foreground">{item.error}</p>}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
});
