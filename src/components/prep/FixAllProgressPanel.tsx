/**
 * FixAllProgressPanel — Shows live phase-by-phase progress during a Fix All run.
 * Displays before/after blocker counts, current phase, and per-phase results.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Loader2, CheckCircle2, AlertTriangle, Activity, Zap, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FixAllResult, FixPhaseResult } from '@/lib/fixAllAutoBlockers';

interface Props {
  /** Live progress message from the orchestrator */
  progressMessage?: string | null;
  /** Is a fix-all run currently active? */
  isRunning: boolean;
  /** Result of the last completed run */
  result?: FixAllResult | null;
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

export function FixAllProgressPanel({ progressMessage, isRunning, result }: Props) {
  if (!isRunning && !result) return null;

  return (
    <div className={cn(
      'rounded-lg border text-xs space-y-2 p-3',
      isRunning ? 'bg-primary/5 border-primary/20' : result?.system_ready ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20',
    )}>
      {/* Header */}
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

      {/* Live progress message */}
      {isRunning && progressMessage && (
        <div className="text-[11px] text-muted-foreground animate-pulse">
          {progressMessage}
        </div>
      )}

      {/* Result summary */}
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
