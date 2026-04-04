/**
 * FixAllProgressPanel — Shows real-time progress during a Fix All run.
 * Displays progress bar, timing, stall detection, per-phase results,
 * and post-run blocker diff with "why still blocked" visibility.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Loader2, CheckCircle2, AlertTriangle, Activity, Zap, RefreshCw, Clock, RotateCcw,
  TrendingDown, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDurationShort, type FixAllLiveProgress } from '@/lib/fixAllProgress';
import type { FixAllResult, FixPhaseResult, BlockerDiff, FixResourceOutcome } from '@/lib/fixAllAutoBlockers';
import { ROOT_CAUSE_LABELS, RESOLUTION_OUTCOME_LABELS, type RootCauseCategory, type ResolutionOutcome } from '@/lib/rootCauseDiagnosis';
import { FAILURE_STAGE_LABELS, FAILURE_MODE_LABELS, type FailureStage, type FailureMode } from '@/lib/failureDossier';

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

const BLOCKER_LABELS: Record<string, string> = {
  needs_enrichment: 'Needs Enrichment',
  needs_extraction: 'Needs Extraction',
  needs_activation: 'Needs Activation',
  missing_content: 'Missing Content',
  stalled_extraction: 'Stalled Extraction',
  stalled_enrichment: 'Stalled Enrichment',
  stale_version: 'Stale Version',
  needs_auth: 'Auth Required',
  contradictory_state: 'Contradictions',
  reference_only: 'Reference Only',
};

export function FixAllProgressPanel({ progress, isRunning, result, onRetryStalled }: Props) {
  const lastUpdateAgo = useMemo(() => {
    if (!progress?.lastProgressAt) return null;
    const ms = Date.now() - new Date(progress.lastProgressAt).getTime();
    return formatDurationShort(ms);
  }, [progress?.lastProgressAt, progress?.elapsedMs]);

  if (!isRunning && !result && !progress) return null;

  // Identify high-unchanged blocker types for callout
  const unchangedCallouts = result?.blockerDiff?.filter(d => d.unchanged > 0 && d.before > 1) ?? [];

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

          {/* G-pre. Per-resource execution outcome table */}
          {result.resourceOutcomes.length > 0 && (
            <div className="space-y-1 pt-1.5 border-t border-border/50">
              <p className="text-[10px] font-medium text-foreground">Resource Outcomes ({result.resourceOutcomes.length})</p>
              <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                {result.resourceOutcomes.map((o) => (
                  <div key={o.resourceId} className={cn(
                    'flex items-start gap-1.5 text-[9px] py-0.5 px-1 rounded',
                    o.succeeded ? 'bg-emerald-500/5' : o.attempted ? 'bg-destructive/5' : 'bg-muted/30',
                  )}>
                    <span className="shrink-0 mt-0.5">
                      {o.succeeded ? '✅' : o.attempted ? '❌' : '⏸️'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{o.resourceTitle}</p>
                      <div className="flex items-center gap-1.5 text-muted-foreground flex-wrap">
                        {o.normalized && <Badge variant="outline" className="text-[8px] h-3 px-1">normalized</Badge>}
                        {o.wrapperPageDetected && <Badge variant="outline" className="text-[8px] h-3 px-1 border-amber-500/30 text-amber-700">wrapper page</Badge>}
                        {o.kisCreated > 0 && <span className="text-emerald-600">+{o.kisCreated} KIs</span>}
                        {o.kisActive > 0 && <span className="text-emerald-600">({o.kisActive} active)</span>}
                        {o.error && <span className="text-destructive truncate max-w-[200px]">{o.error}</span>}
                        {o.originalJobStatus && (
                          <span className="text-muted-foreground/70">was: {o.originalJobStatus}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* G. Blocker diff — before/after by type */}
          {result.blockerDiff && result.blockerDiff.length > 0 && (
            <div className="space-y-1 pt-1.5 border-t border-border/50">
              <p className="text-[10px] font-medium text-foreground flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                Blocker Breakdown
              </p>
              {result.blockerDiff.map((d) => (
                <div key={d.type} className="flex items-center gap-2 text-[10px]">
                  <span className="min-w-[100px] text-muted-foreground">
                    {BLOCKER_LABELS[d.type] ?? d.type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-muted-foreground">{d.before}</span>
                  <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className={d.after === 0 ? 'text-emerald-600 font-medium' : d.after === d.before ? 'text-destructive font-medium' : 'text-amber-600'}>
                    {d.after}
                  </span>
                  {d.resolved > 0 && (
                    <span className="text-emerald-600 text-[9px]">−{d.resolved}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* H. High-unchanged callout */}
          {unchangedCallouts.length > 0 && !result.system_ready && (
            <div className="text-[10px] text-amber-700 bg-amber-500/5 border border-amber-500/10 rounded px-2 py-1.5">
              {unchangedCallouts.map(d => (
                <p key={d.type}>
                  {BLOCKER_LABELS[d.type] ?? d.type}: {d.unchanged}/{d.before} unchanged
                  {d.unchanged === d.before && ' — phase made no progress'}
                </p>
              ))}
            </div>
          )}

          {/* I. Root-cause resolution summary */}
          {result.resourceOutcomes.length > 0 && (() => {
            const byCause: Record<string, number> = {};
            const byOutcome: Record<string, number> = {};
            const stillBlocked = result.resourceOutcomes.filter(o => o.resolutionOutcome?.startsWith('still_blocked'));
            for (const o of result.resourceOutcomes) {
              if (o.rootCauseCategory) byCause[o.rootCauseCategory] = (byCause[o.rootCauseCategory] ?? 0) + 1;
              if (o.resolutionOutcome) byOutcome[o.resolutionOutcome] = (byOutcome[o.resolutionOutcome] ?? 0) + 1;
            }
            const hasCauseData = Object.keys(byCause).length > 0;
            if (!hasCauseData) return null;
            return (
              <div className="space-y-1 pt-1.5 border-t border-border/50">
                <p className="text-[10px] font-medium text-foreground">Root Cause Summary</p>
                <div className="flex items-center gap-2 flex-wrap text-[10px]">
                  {Object.entries(byOutcome).map(([outcome, count]) => (
                    <span key={outcome} className={cn(
                      'font-medium',
                      outcome === 'resolved_permanently' ? 'text-emerald-600'
                        : outcome === 'temporarily_retried' ? 'text-amber-600'
                        : 'text-destructive',
                    )}>
                      {count} {RESOLUTION_OUTCOME_LABELS[outcome as ResolutionOutcome] ?? outcome}
                    </span>
                  ))}
                </div>
                {stillBlocked.length > 0 && (
                  <div className="text-[9px] text-muted-foreground space-y-0.5 mt-0.5">
                    {stillBlocked.slice(0, 5).map(o => (
                      <p key={o.resourceId}>
                        <span className="font-medium text-foreground">{o.resourceTitle}</span>
                        {' — '}
                        {ROOT_CAUSE_LABELS[(o.rootCauseCategory as RootCauseCategory) ?? 'unknown'] ?? o.rootCauseCategory}
                        {o.rootCauseExplanation && `: ${o.rootCauseExplanation.slice(0, 60)}…`}
                      </p>
                    ))}
                    {stillBlocked.length > 5 && (
                      <p className="text-muted-foreground">+ {stillBlocked.length - 5} more</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* J. Prevention insights from still-blocked resources */}
          {result.resourceOutcomes.length > 0 && (() => {
            const stillBlocked = result.resourceOutcomes.filter(o => o.resolutionOutcome?.startsWith('still_blocked'));
            if (stillBlocked.length === 0) return null;
            // Count resolution outcomes for quick summary
            const sameCause = stillBlocked.filter(o => o.resolutionOutcome === 'still_blocked_same_cause').length;
            const newCause = stillBlocked.filter(o => o.resolutionOutcome === 'still_blocked_new_cause').length;
            return (
              <div className="text-[10px] text-amber-700 bg-amber-500/5 border border-amber-500/10 rounded px-2 py-1.5 space-y-0.5">
                {sameCause > 0 && (
                  <p>{sameCause} resource{sameCause > 1 ? 's' : ''} still blocked by the same root cause — retry alone will not resolve these.</p>
                )}
                {newCause > 0 && (
                  <p>{newCause} resource{newCause > 1 ? 's' : ''} blocked by a new root cause after fix attempt.</p>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
