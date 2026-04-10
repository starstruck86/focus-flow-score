/**
 * Unified Health Strip — merges System Health + Resource Health into one row.
 * Answers both "Can I trust the system?" and "What needs work?" in a single glance.
 */
import { useMemo } from 'react';
import {
  Activity, ShieldCheck, ShieldAlert, ArrowRight, XCircle, Clock,
  AlertTriangle, Zap, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { getRecentActions, type ActionOutcome } from '@/lib/actionOutcomeStore';
import type { ControlPlaneSummary, ControlPlaneFilter } from '@/lib/controlPlaneState';

interface Props {
  summary: ControlPlaneSummary;
  conflictCount: number;
  outcomeRefreshKey: number;
  onFilterChange: (filter: ControlPlaneFilter) => void;
  onOpenResource?: (resourceId: string) => void;
}

export function UnifiedHealthStrip({ summary, conflictCount, outcomeRefreshKey, onFilterChange, onOpenResource }: Props) {
  const trustAnalysis = useMemo(() => {
    const actions = getRecentActions();
    const confirmed: ActionOutcome[] = [];
    const partial: ActionOutcome[] = [];
    const mismatched: ActionOutcome[] = [];
    const failed: ActionOutcome[] = [];

    for (const a of actions) {
      if (a.reconciliation === 'confirmed') confirmed.push(a);
      else if (a.reconciliation === 'partial') partial.push(a);
      else if (a.reconciliation === 'mismatched') mismatched.push(a);
      if (a.status === 'failed') failed.push(a);
    }

    const mismatchReasons = new Map<string, number>();
    for (const a of mismatched) {
      const reason = a.mismatchExplanation || 'Unknown';
      mismatchReasons.set(reason, (mismatchReasons.get(reason) || 0) + 1);
    }
    const topMismatchReasons = [...mismatchReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return { confirmed, partial, mismatched, failed, topMismatchReasons, total: actions.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeRefreshKey]);

  const hasSystemIssues = trustAnalysis.mismatched.length > 0 || trustAnalysis.partial.length > 0 || trustAnalysis.failed.length > 0;
  const systemHealthy = trustAnalysis.total > 0 && !hasSystemIssues;

  // Resource health pills
  const resourcePills: { icon: React.ElementType; label: string; value: number; color: string; filter: ControlPlaneFilter }[] = [];
  if (summary.needsReview > 0) resourcePills.push({ icon: AlertTriangle, label: 'Blocked', value: summary.needsReview, color: 'text-destructive', filter: 'needs_review' });
  if (summary.needsExtraction > 0) resourcePills.push({ icon: Zap, label: 'Extract', value: summary.needsExtraction, color: 'text-amber-600', filter: 'needs_extraction' });
  if (conflictCount > 0) resourcePills.push({ icon: ShieldAlert, label: 'Conflicts', value: conflictCount, color: 'text-destructive', filter: 'conflicts' });
  if (summary.processing > 0) resourcePills.push({ icon: Loader2, label: 'Processing', value: summary.processing, color: 'text-primary', filter: 'processing' });

  const hasAnything = trustAnalysis.total > 0 || resourcePills.length > 0;
  if (!hasAnything) return null;

  const borderColor = hasSystemIssues
    ? 'border-amber-200 dark:border-amber-800'
    : systemHealthy
      ? 'border-emerald-200 dark:border-emerald-800'
      : 'border-border';

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg border bg-card text-xs', borderColor)}>
      <Activity className={cn('h-3.5 w-3.5 shrink-0', hasSystemIssues ? 'text-amber-600' : systemHealthy ? 'text-emerald-600' : 'text-muted-foreground')} />
      <span className="font-medium text-foreground">Health</span>

      {/* System trust metrics */}
      {trustAnalysis.total > 0 && (
        <>
          {systemHealthy && (
            <span className="text-emerald-600 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              Trusted
            </span>
          )}
          {trustAnalysis.confirmed.length > 0 && !systemHealthy && (
            <TrustPill icon={ShieldCheck} label="OK" value={trustAnalysis.confirmed.length} className="text-emerald-600" actions={trustAnalysis.confirmed} onOpenResource={onOpenResource} />
          )}
          {trustAnalysis.partial.length > 0 && (
            <TrustPill icon={ArrowRight} label="Partial" value={trustAnalysis.partial.length} className="text-amber-600" actions={trustAnalysis.partial} onOpenResource={onOpenResource} />
          )}
          {trustAnalysis.mismatched.length > 0 && (
            <TrustPill icon={ShieldAlert} label="Mismatch" value={trustAnalysis.mismatched.length} className="text-destructive" actions={trustAnalysis.mismatched} reasons={trustAnalysis.topMismatchReasons} onOpenResource={onOpenResource} />
          )}
          {trustAnalysis.failed.length > 0 && (
            <TrustPill icon={XCircle} label="Failed" value={trustAnalysis.failed.length} className="text-destructive" actions={trustAnalysis.failed} onOpenResource={onOpenResource} />
          )}
        </>
      )}

      {/* Divider between system trust and resource health */}
      {trustAnalysis.total > 0 && resourcePills.length > 0 && (
        <span className="h-3.5 w-px bg-border shrink-0" />
      )}

      {/* Resource health pills */}
      {resourcePills.map(({ icon: Icon, label, value, color, filter }) => (
        <button
          key={label}
          onClick={() => onFilterChange(filter)}
          className={cn('flex items-center gap-1 hover:underline cursor-pointer', color)}
        >
          <Icon className="h-3 w-3" />
          <span className="tabular-nums font-medium">{value}</span>
          <span className="text-muted-foreground">{label}</span>
        </button>
      ))}
    </div>
  );
}

function TrustPill({
  icon: Icon, label, value, className, actions, reasons, onOpenResource,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  className: string;
  actions: ActionOutcome[];
  reasons?: [string, number][];
  onOpenResource?: (id: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn('flex items-center gap-1 hover:underline cursor-pointer', className)}>
          <Icon className="h-3 w-3" />
          <span className="tabular-nums font-medium">{value}</span>
          <span className="text-muted-foreground">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs space-y-2" side="bottom" align="center">
        <div className="font-semibold text-foreground">{label} ({value})</div>
        {reasons && reasons.length > 0 && (
          <div className="space-y-0.5">
            {reasons.map(([reason, count], i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-muted-foreground tabular-nums shrink-0">×{count}</span>
                <span className="text-foreground">{reason}</span>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-0.5">
          {actions.slice(0, 3).map(a => (
            <button
              key={a.id}
              onClick={() => onOpenResource?.(a.resourceId)}
              className="block text-left w-full truncate hover:text-primary hover:underline"
            >
              • {a.resourceTitle}
            </button>
          ))}
          {actions.length > 3 && (
            <span className="text-muted-foreground/70 italic">…+{actions.length - 3} more</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground/60">
          <Clock className="h-2.5 w-2.5" />
          {actions[0] ? new Date(actions[0].timestamp).toLocaleTimeString() : '—'}
        </div>
      </PopoverContent>
    </Popover>
  );
}
