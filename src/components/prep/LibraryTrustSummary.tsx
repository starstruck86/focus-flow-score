/**
 * LibraryTrustSummary — compact library-level trust indicator
 * derived exclusively from deriveLibraryReadiness().
 *
 * Shows: system state label, explicit reason string, blocker counts,
 * burn-down results after Fix All, and clickable health chips.
 */
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, Shield, Zap, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveResourceTruth, deriveLibraryReadiness, type LibraryReadiness } from '@/lib/resourceTruthState';
import { buildFailureDossier, aggregateDossierInsights, FAILURE_STAGE_LABELS, FAILURE_MODE_LABELS } from '@/lib/failureDossier';
import { ROOT_CAUSE_LABELS } from '@/lib/rootCauseDiagnosis';
import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import type { FixAllResult } from '@/lib/fixAllAutoBlockers';

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  audioJobsMap?: Map<string, AudioJobRecord>;
  onFixAllAuto?: (resourceIds: string[]) => void;
  onFilterChange?: (filter: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastFixResult?: FixAllResult | null;
}

function getStatusInfo(r: LibraryReadiness): { label: string; reason: string } {
  if (r.system_ready) {
    return { label: 'System Ready', reason: 'All auto-fixable blockers resolved. Library is trustworthy.' };
  }
  if (r.contradiction_count > 0) {
    return {
      label: 'Blocked by Contradictions',
      reason: `${r.contradiction_count} contradiction${r.contradiction_count > 1 ? 's' : ''} detected — resources claim readiness that truth denies.`,
    };
  }
  if (r.stalled_resources > 0) {
    return {
      label: 'Blocked by Stalled Jobs',
      reason: `${r.stalled_resources} job${r.stalled_resources > 1 ? 's' : ''} stalled — processing timed out and needs retry or manual intervention.`,
    };
  }
  if (r.auto_fixable_blocker_count > 0) {
    return {
      label: 'System Not Ready',
      reason: `${r.auto_fixable_blocker_count} auto-fixable blocker${r.auto_fixable_blocker_count > 1 ? 's' : ''} remain — run enrichment/extraction to resolve.`,
    };
  }
  if (r.manual_only_blocker_count > 0) {
    return {
      label: 'Ready except manual blockers',
      reason: `${r.manual_only_blocker_count} manual-only blocker${r.manual_only_blocker_count > 1 ? 's' : ''} remain — these require human review.`,
    };
  }
  return { label: 'System Not Ready', reason: 'Unknown blockers remain.' };
}

export function LibraryTrustSummary({ resources, lifecycleMap, audioJobsMap, onFixAllAuto, onFilterChange, onRefresh, isRefreshing, lastFixResult }: Props) {
  const { readiness, autoFixableIds, blockerBreakdown, dossierInsights } = useMemo(() => {
    const truths = resources.map(r => {
      const lc = lifecycleMap.get(r.id);
      return deriveResourceTruth(r, lc, audioJobsMap?.get(r.id));
    });
    const rd = deriveLibraryReadiness(truths);
    const ids: string[] = [];
    const breakdown: Record<string, number> = {};
    const dossiers = resources.map((r, i) => {
      const t = truths[i];
      if (t.all_blockers.some(b => b.fixability === 'auto_fixable' || b.fixability === 'semi_auto_fixable')) {
        ids.push(r.id);
      }
      if (t.primary_blocker) {
        breakdown[t.primary_blocker.type] = (breakdown[t.primary_blocker.type] ?? 0) + 1;
      }
      return buildFailureDossier(r, t);
    }).filter((d): d is NonNullable<typeof d> => d !== null);
    const insights = dossiers.length > 0 ? aggregateDossierInsights(dossiers) : null;
    return { readiness: rd, autoFixableIds: ids, blockerBreakdown: breakdown, dossierInsights: insights };
  }, [resources, lifecycleMap, audioJobsMap]);

  if (readiness.total_resources === 0) return null;

  const { label: statusLabel, reason } = getStatusInfo(readiness);
  const StatusIcon = readiness.system_ready ? CheckCircle2 : AlertTriangle;

  const chipClass = 'cursor-pointer hover:underline transition-colors';

  return (
    <div className={cn(
      'rounded-lg border text-xs',
      readiness.system_ready
        ? 'bg-emerald-500/5 border-emerald-500/20'
        : 'bg-amber-500/5 border-amber-500/20',
    )}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-semibold text-foreground shrink-0">Library Trust</span>
        <Badge className={cn(
          'text-[9px] h-4 gap-0.5',
          readiness.system_ready ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700',
        )}>
          <StatusIcon className="h-2.5 w-2.5" />
          {statusLabel}
        </Badge>
        <div className="flex-1" />
        {onRefresh && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
          </Button>
        )}
      </div>

      {/* Reason string */}
      <div className="px-3 pb-1.5">
        <p className="text-[10px] text-muted-foreground">{reason}</p>
      </div>

      {/* Metric pills — clickable */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2">
        <span
          className={cn('text-emerald-600 font-medium', onFilterChange && chipClass)}
          onClick={() => onFilterChange?.('ready')}
        >
          {readiness.ready_resources} ready
        </span>
        {readiness.processing_resources > 0 && (
          <span
            className={cn('text-primary', onFilterChange && chipClass)}
            onClick={() => onFilterChange?.('improving')}
          >
            {readiness.processing_resources} processing
          </span>
        )}
        {readiness.blocked_resources > 0 && (
          <span
            className={cn('text-destructive', onFilterChange && chipClass)}
            onClick={() => onFilterChange?.('blocked')}
          >
            {readiness.blocked_resources} blocked
          </span>
        )}
        {readiness.stalled_resources > 0 && (
          <span
            className={cn('text-destructive', onFilterChange && chipClass)}
            onClick={() => onFilterChange?.('stalled')}
          >
            {readiness.stalled_resources} stalled
          </span>
        )}
        {readiness.qa_required_resources > 0 && (
          <span
            className={cn('text-amber-600', onFilterChange && chipClass)}
            onClick={() => onFilterChange?.('qa_required')}
          >
            {readiness.qa_required_resources} QA required
          </span>
        )}
        {readiness.contradiction_count > 0 && (
          <span
            className={cn('text-destructive font-medium', onFilterChange && chipClass)}
            onClick={() => onFilterChange?.('contradictions')}
          >
            {readiness.contradiction_count} contradictions
          </span>
        )}
      </div>

      {/* Per-blocker-type chips — clickable */}
      {Object.keys(blockerBreakdown).length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2">
          <span className="text-[9px] text-muted-foreground mr-0.5">Blockers:</span>
          {Object.entries(blockerBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
              const filterMap: Record<string, string> = {
                needs_enrichment: 'needs_enrichment',
                needs_extraction: 'needs_extraction',
                needs_activation: 'needs_activation',
                needs_auth: 'needs_auth',
                missing_content: 'missing_content',
                qa_required: 'qa_required',
                route_manual_assist: 'needs_auth',
                stalled_extraction: 'stalled',
                stalled_enrichment: 'stalled',
                contradictory_state: 'contradictions',
              };
              const filterKey = filterMap[type] ?? 'blocked';
              return (
                <Badge
                  key={type}
                  variant="outline"
                  className={cn(
                    'text-[9px] h-4 px-1.5 cursor-pointer hover:bg-accent transition-colors',
                  )}
                  onClick={() => onFilterChange?.(filterKey)}
                >
                  {count} {type.replace(/_/g, ' ')}
                </Badge>
              );
            })}
        </div>
      )}

      {/* Burn-down results from last Fix All run */}
      {lastFixResult && (
        <div className="px-3 pb-2 border-t border-border/50 pt-1.5">
          <p className="text-[10px] font-medium text-foreground mb-1">Last Fix All Results</p>
          <div className="flex items-center gap-2 flex-wrap text-[10px]">
            <span className="text-muted-foreground">Before: {lastFixResult.blockers_before}</span>
            <span className="text-emerald-600">Fixed: {lastFixResult.blockers_fixed}</span>
            {lastFixResult.blockers_failed > 0 && (
              <span className="text-destructive">Failed: {lastFixResult.blockers_failed}</span>
            )}
            <span className={lastFixResult.blockers_after === 0 ? 'text-emerald-600 font-medium' : 'text-amber-600'}>
              Remaining: {lastFixResult.blockers_after}
            </span>
          </div>
          {lastFixResult.phases.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {lastFixResult.phases.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[9px] text-muted-foreground">
                  <span className="font-medium min-w-[80px]">{p.phase}</span>
                  <span>{p.attempted} attempted</span>
                  <span className="text-emerald-600">{p.succeeded} ✓</span>
                  {p.failed > 0 && <span className="text-destructive">{p.failed} ✗</span>}
                </div>
              ))}
            </div>
          )}
          {/* Blocker diff callout */}
          {lastFixResult.blockerDiff && lastFixResult.blockerDiff.some(d => d.unchanged > 0 && d.unchanged === d.before && d.before > 1) && (
            <p className="text-[9px] text-amber-700 mt-1">
              ⚠ Some phases made no progress — check extraction failures in the progress panel above.
            </p>
          )}
        </div>
      )}

      {/* Dossier Insights — grouped root cause summary */}
      {dossierInsights && !readiness.system_ready && (
        <div className="px-3 pb-2 border-t border-border/50 pt-1.5 space-y-1">
          <p className="text-[10px] font-medium text-foreground">Failure Analysis</p>
          <div className="flex items-center gap-1.5 flex-wrap text-[9px]">
            {Object.entries(dossierInsights.by_root_cause)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([cause, count]) => (
                <Badge key={cause} variant="outline" className="text-[9px] h-4 px-1.5">
                  {count} {ROOT_CAUSE_LABELS[cause as keyof typeof ROOT_CAUSE_LABELS] ?? cause}
                </Badge>
              ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[9px]">
            {Object.entries(dossierInsights.by_failure_stage)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([stage, count]) => (
                <span key={stage} className="text-muted-foreground">
                  {count} at {FAILURE_STAGE_LABELS[stage as keyof typeof FAILURE_STAGE_LABELS] ?? stage}
                </span>
              ))}
          </div>
          {dossierInsights.top_permanent_fixes.length > 0 && (
            <div className="text-[9px] text-primary">
              <span className="text-muted-foreground">Top fix: </span>
              {dossierInsights.top_permanent_fixes[0]}
            </div>
          )}
        </div>
      )}

      {/* Fix All Auto-Fixable action */}
      {!readiness.system_ready && autoFixableIds.length > 0 && onFixAllAuto && (
        <div className="px-3 pb-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 w-full"
            onClick={() => onFixAllAuto(autoFixableIds)}
          >
            <Zap className="h-3 w-3" />
            Fix {autoFixableIds.length} auto-fixable blockers
          </Button>
        </div>
      )}
    </div>
  );
}
