/**
 * QueueActionBar — sticky bulk action bar that adapts its primary CTA
 * based on the currently expanded readiness bucket (queue).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  X, Sparkles, Wrench, Tag, Trash2, Zap, RefreshCw, Loader2, CheckCircle2,
  Play, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReadinessBucket } from '@/lib/resourceAudit';

// ── Queue → Action mapping ─────────────────────────────────

interface QueueAction {
  label: string;
  icon: React.ElementType;
  actionType: string;
  variant?: 'default' | 'destructive';
}

export const PRIMARY_ACTIONS: Record<ReadinessBucket, QueueAction> = {
  extractable_not_operationalized: { label: 'Extract Selected', icon: Sparkles, actionType: 'autoOp' },
  needs_tagging: { label: 'Auto-tag Selected', icon: Tag, actionType: 'tag' },
  ready: { label: 'Extract Selected', icon: Sparkles, actionType: 'autoOp' },
  content_backed_needs_fix: { label: 'Fix Selected', icon: Wrench, actionType: 'fix' },
  low_quality_extraction: { label: 'Re-extract Selected', icon: RefreshCw, actionType: 'autoOp' },
  blocked_incorrectly: { label: 'Review Selected', icon: Wrench, actionType: 'fix' },
  operationalized: { label: 'Activate Selected', icon: Zap, actionType: 'activate' },
  junk_or_low_signal: { label: 'Delete Selected', icon: Trash2, actionType: 'delete', variant: 'destructive' },
  missing_content: { label: 'Fix Content', icon: Wrench, actionType: 'fix' },
  orphaned_or_inconsistent: { label: 'Review Selected', icon: Wrench, actionType: 'fix' },
};

const SECONDARY_ACTIONS: QueueAction[] = [
  { label: 'Extract', icon: Sparkles, actionType: 'autoOp' },
  { label: 'Auto-tag', icon: Tag, actionType: 'tag' },
  { label: 'Activate', icon: Zap, actionType: 'activate' },
];

// ── Progress state ─────────────────────────────────────────

export interface QueueProgress {
  phase: 'running' | 'complete' | 'failed' | 'cancelled';
  processed: number;
  total: number;
  current?: string;
  succeeded?: number;
  failed?: number;
}

// ── Props ──────────────────────────────────────────────────

interface Props {
  activeBucket: ReadinessBucket | null;
  selectedIds: Set<string>;
  totalInBucket: number;
  onClearSelection: () => void;
  onSelectCount: (count: number) => void;
  onSelectAll: () => void;
  onAction: (actionType: string, ids: string[]) => void;
  progress: QueueProgress | null;
  actionLoading: string | null;
}

export function QueueActionBar({
  activeBucket,
  selectedIds,
  totalInBucket,
  onClearSelection,
  onSelectCount,
  onSelectAll,
  onAction,
  progress,
  actionLoading,
}: Props) {
  const count = selectedIds.size;
  if (count === 0 && !progress) return null;

  const primary = activeBucket ? PRIMARY_ACTIONS[activeBucket] : null;
  const ids = Array.from(selectedIds);
  const isRunning = !!progress && progress.phase === 'running';

  return (
    <div className="sticky top-0 z-30 rounded-lg border border-primary/30 bg-primary/5 backdrop-blur-sm px-3 py-2 space-y-2 animate-in slide-in-from-top-2">
      {/* ── Top row: count + primary + clear ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-[10px] h-5 font-semibold">
          {count} selected
        </Badge>

        {count > 0 && !isRunning && (
          <>
            {/* Primary CTA */}
            {primary && (
              <Button
                size="sm"
                variant={primary.variant === 'destructive' ? 'destructive' : 'default'}
                className="h-7 text-[11px] gap-1.5"
                disabled={!!actionLoading}
                onClick={() => onAction(primary.actionType, ids)}
              >
                {actionLoading === primary.actionType
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <primary.icon className="h-3 w-3" />
                }
                {primary.label}
              </Button>
            )}

            {/* Secondary actions — only show those different from primary */}
            {SECONDARY_ACTIONS
              .filter(a => a.actionType !== primary?.actionType)
              .map(a => (
                <Button
                  key={a.actionType}
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1"
                  disabled={!!actionLoading}
                  onClick={() => onAction(a.actionType, ids)}
                >
                  <a.icon className="h-3 w-3" />
                  {a.label}
                </Button>
              ))
            }

            <div className="flex-1" />

            <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1" onClick={onClearSelection}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          </>
        )}
      </div>

      {/* ── Quick selection helpers ── */}
      {!isRunning && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] text-muted-foreground font-medium">Select:</span>
          {[10, 25, 50].map(n => (
            <Button
              key={n}
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[9px]"
              disabled={totalInBucket <= 0}
              onClick={() => onSelectCount(n)}
            >
              {n}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[9px]"
            disabled={totalInBucket <= 0}
            onClick={onSelectAll}
          >
            All ({totalInBucket})
          </Button>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[9px] text-muted-foreground"
              onClick={onClearSelection}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* ── Inline progress ── */}
      {progress && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[10px]">
            {progress.phase === 'running' && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            {progress.phase === 'complete' && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
            <span className="font-medium text-foreground">
              {progress.phase === 'running' && `Processing ${progress.processed} / ${progress.total}`}
              {progress.phase === 'complete' && `Complete — ${progress.succeeded ?? progress.processed} succeeded`}
              {progress.phase === 'failed' && `Failed after ${progress.processed} / ${progress.total}`}
              {progress.phase === 'cancelled' && `Cancelled at ${progress.processed} / ${progress.total}`}
            </span>
            {progress.failed != null && progress.failed > 0 && (
              <span className="text-destructive">{progress.failed} failed</span>
            )}
          </div>
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className={cn(
                'h-1.5 rounded-full transition-all',
                progress.phase === 'complete' ? 'bg-emerald-500' :
                progress.phase === 'failed' ? 'bg-destructive' : 'bg-primary'
              )}
              style={{ width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%` }}
            />
          </div>
          {progress.current && progress.phase === 'running' && (
            <p className="text-[9px] text-muted-foreground truncate">{progress.current}</p>
          )}
        </div>
      )}
    </div>
  );
}
