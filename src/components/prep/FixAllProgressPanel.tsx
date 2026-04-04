/**
 * FixAllProgressPanel — Shows real-time progress during a Fix All run.
 * Displays progress bar, timing, stall detection, and per-phase results.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Loader2, CheckCircle2, AlertTriangle, Activity, Zap, RefreshCw, Clock, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDurationShort, type FixAllLiveProgress } from '@/lib/fixAllProgress';
import type { FixAllResult, FixPhaseResult } from '@/lib/fixAllAutoBlockers';

interface Props {
  progress: FixAllLiveProgress | null;
  isRunning: boolean;
  result: FixAllResult | null;
  onRetryStalled?: () => void;
}

const PHASE_ICONS: Record<string, React.ElementType> = {
  normalize_status: RefreshCw,
  stalled_retry: AlertTriangle,
  enrichment: Zap,
  extraction: Activity,
  activation: CheckCircle2,
};

const PHASE_LABELS: Record<string, string> = {
  normalize_status: 'Normalize',
  stalled_retry: 'Stalled Retry',
  enrichment: 'Enrichment',
  extraction: 'Extraction',
  activation: 'Activation',
};

export function FixAllProgressPanel({ progress, isRunning, result, onRetryStalled }: Props) {
  if (!isRunning && !result && !progress) return null;

  const lastUpdateAgo = useMemo(() => {
    if (!progress?.lastProgressAt) return null;
    const ms = Date.now() - new Date(progress.lastProgressAt).getTime();
    return formatDurationShort(ms);
  }, [progress?.lastProgressAt, progress?.elapsedMs]); // elapsedMs changes every second to trigger recompute

  return (
    <div className={cn(
      'rounded-lg border text-xs space-y-2 p-3',
      isRunning
        ? progress?.stalled
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-primary/5 border-primary/20'
        : result?.system_ready
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : 'bg-amber-500/5 border-amber-500/20',
    )}>
      {/* A. Header */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="font-semibold text-foreground">Fix All Running…</span>
          </>
        ) : (
          <>
            {result?.system_ready ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            )}
            <span className="font-semibold text-foreground">Fix All Complete</span>
          </>
        )}
      </div>

      {/* B. Main progress bar */}
      {progress && progress.total > 0 && (
        <div className="space-y-1.5">
          <Progress value={progress.percent} className="h-2" />
          <div className="flex items-center gap-3 text-[11px] flex-wrap">
            <span className="font-medium text-foreground">
              {progress.completed} / {progress.total} finished
            </span>
            {progress.running > 0 && (
              <span className="text-primary">{progress.running} running</span>
            )}
            {progress.failed > 0 && (
              <span className="text-destructive">{progress.failed} failed</span>
            )}
            <span className="text-muted-foreground">{progress.remaining} remaining</span>
          </div>
        </div>
      )}

      {/* C. Timing row */}
      {progress && isRunning && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            Elapsed: {formatDurationShort(progress.elapsedMs)}
          </span>
          {progress.etaMs !== null && (
            <span>ETA: {formatDurationShort(progress.etaMs)}</span>
          )}
          {lastUpdateAgo && (
            <span>Last update: {lastUpdateAgo} ago</span>
          )}
        </div>
      )}

      {/* D. Stall warning */}
      {progress?.stalled && isRunning && (
        <div className="flex items-center gap-2 text-[11px] text-destructive bg-destructive/5 rounded px-2 py-1.5 border border-destructive/10">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="flex-1">
            No progress for {formatDurationShort(
              progress.lastProgressAt
                ? Date.now() - new Date(progress.lastProgressAt).getTime()
                : 0
            )} — likely stalled
          </span>
          {onRetryStalled && (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-[10px] px-2"
              onClick={onRetryStalled}
            >
              <RotateCcw className="h-2.5 w-2.5 mr-1" />
              Retry stalled jobs
            </Button>
          )}
        </div>
      )}

      {/* E. Current phase */}
      {progress && isRunning && progress.phase && (
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Phase: {progress.phaseLabel}</span>
          {progress.currentMessage && progress.currentMessage !== progress.phaseLabel && (
            <span className="ml-2 animate-pulse">{progress.currentMessage}</span>
          )}
        </div>
      )}

      {/* F. Completion summary */}
      {result && (
        <>
          <div className="flex items-center gap-3 text-[11px] flex-wrap">
            <span className="text-muted-foreground">Before: <span className="font-medium text-foreground">{result.blockers_before}</span></span>
            <span className="text-emerald-600">Fixed: <span className="font-medium">{result.blockers_fixed}</span></span>
            {result.blockers_failed > 0 && (
              <span className="text-destructive">Failed: <span className="font-medium">{result.blockers_failed}</span></span>
            )}
            <span className={result.blockers_after === 0 ? 'text-emerald-600 font-medium' : 'text-amber-600'}>
              Remaining: <span className="font-medium">{result.blockers_after}</span>
            </span>
            <Badge className={cn(
              'text-[9px] h-4',
              result.system_ready ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700',
            )}>
              {result.system_ready ? 'System Ready' : 'Not Ready'}
            </Badge>
          </div>

          {/* Per-phase breakdown */}
          {result.phases.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/50">
              {result.phases.map((p, i) => {
                const Icon = PHASE_ICONS[p.phase] ?? Activity;
                return (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium min-w-[70px]">{PHASE_LABELS[p.phase] ?? p.phase}</span>
                    <span className="text-muted-foreground">{p.attempted} attempted</span>
                    <span className="text-emerald-600">{p.succeeded} ✓</span>
                    {p.failed > 0 && <span className="text-destructive">{p.failed} ✗</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
