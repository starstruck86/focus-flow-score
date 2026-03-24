import { memo, useMemo } from 'react';
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
import { Play, Pause, Square, RotateCcw, ChevronDown, CheckCircle2, XCircle, SkipForward, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BulkEnrichState, BulkEnrichStatus, BulkRecordResult } from '@/hooks/useBulkEnrichment';
import type { Account } from '@/types';

interface BulkEnrichmentPanelProps {
  state: BulkEnrichState;
  accounts: Account[];
  onSetBatchSize: (size: number) => void;
  onStart: (accounts: Account[], opts?: { retryFailedOnly?: boolean }) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReset: () => void;
  hasFailures: boolean;
}

const STATUS_LABELS: Record<BulkEnrichStatus, string> = {
  idle: 'Ready',
  running: 'Enriching…',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Completed with errors',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<BulkEnrichStatus, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-primary/20 text-primary',
  paused: 'bg-status-yellow/20 text-status-yellow',
  completed: 'bg-status-green/20 text-status-green',
  failed: 'bg-status-red/20 text-status-red',
  cancelled: 'bg-muted text-muted-foreground',
};

export const BulkEnrichmentPanel = memo(function BulkEnrichmentPanel({
  state,
  accounts,
  onSetBatchSize,
  onStart,
  onPause,
  onResume,
  onCancel,
  onReset,
  hasFailures,
}: BulkEnrichmentPanelProps) {
  const isActive = state.status === 'running' || state.status === 'paused';
  const isDone = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
  const progressPct = state.totalRecords > 0 ? Math.round((state.processedCount / state.totalRecords) * 100) : 0;

  const failedResults = useMemo(
    () => state.results.filter(r => r.status === 'failed'),
    [state.results]
  );

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Bulk Enrichment</h3>
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

      {/* Controls — shown when idle */}
      {state.status === 'idle' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Batch size:</span>
            <Select value={String(state.batchSize)} onValueChange={v => onSetBatchSize(Number(v))}>
              <SelectTrigger className="h-7 w-[72px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={accounts.length === 0}
            onClick={() => onStart(accounts)}
          >
            <Play className="h-3 w-3" />
            Enrich {accounts.length} accounts
          </Button>
        </div>
      )}

      {/* Progress — shown when active or done */}
      {(isActive || isDone) && (
        <div className="space-y-2">
          <Progress value={progressPct} className="h-2" />

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {state.currentBatch > 0 && `Batch ${state.currentBatch} of ${state.totalBatches} · `}
              {state.processedCount} / {state.totalRecords} processed
            </span>
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

          {/* Retry failed */}
          {isDone && hasFailures && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onStart(accounts, { retryFailedOnly: true })}
            >
              <RotateCcw className="h-3 w-3" />
              Retry {failedResults.length} failed
            </Button>
          )}
        </div>
      )}

      {/* Failed records detail */}
      {isDone && failedResults.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-status-red hover:underline">
            <AlertTriangle className="h-3 w-3" />
            {failedResults.length} failed — view details
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {failedResults.map(r => (
              <div key={r.accountId} className="flex items-start gap-2 text-[11px] bg-destructive/5 rounded px-2 py-1">
                <XCircle className="h-3 w-3 text-status-red mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-foreground">{r.accountName}</span>
                  {r.error && <p className="text-muted-foreground">{r.error}</p>}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
});
