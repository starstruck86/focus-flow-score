/**
 * System Health Strip — answers "Can I trust the system right now?"
 * Focuses on reconciliation outcomes, failures, and trust issues.
 * Drill-in popovers explain each count.
 */
import { useMemo } from 'react';
import {
  ShieldCheck, ShieldAlert, ArrowRight, Activity, XCircle, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { getRecentActions, type ActionOutcome } from '@/lib/actionOutcomeStore';

interface Props {
  refreshKey: number;
  onOpenResource?: (resourceId: string) => void;
}

export function SystemHealthStrip({ refreshKey, onOpenResource }: Props) {
  const analysis = useMemo(() => {
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

    // Top reasons for mismatches
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
  }, [refreshKey]);

  if (analysis.total === 0) return null;

  const hasIssues = analysis.mismatched.length > 0 || analysis.partial.length > 0 || analysis.failed.length > 0;
  const healthy = analysis.total > 0 && !hasIssues;

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2 rounded-lg border text-xs',
      healthy
        ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
        : hasIssues
          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
          : 'bg-card border-border',
    )}>
      <Activity className={cn('h-3.5 w-3.5 shrink-0', healthy ? 'text-emerald-600' : 'text-amber-600')} />
      <span className="font-medium text-foreground">System Health</span>

      <div className="flex items-center gap-3 ml-auto">
        {analysis.confirmed.length > 0 && (
          <DrillInPill
            icon={ShieldCheck}
            label="Confirmed"
            value={analysis.confirmed.length}
            className="text-emerald-600"
            actions={analysis.confirmed}
            onOpenResource={onOpenResource}
          />
        )}
        {analysis.partial.length > 0 && (
          <DrillInPill
            icon={ArrowRight}
            label="Partial"
            value={analysis.partial.length}
            className="text-amber-600"
            actions={analysis.partial}
            onOpenResource={onOpenResource}
          />
        )}
        {analysis.mismatched.length > 0 && (
          <DrillInPill
            icon={ShieldAlert}
            label="Mismatched"
            value={analysis.mismatched.length}
            className="text-destructive"
            actions={analysis.mismatched}
            reasons={analysis.topMismatchReasons}
            onOpenResource={onOpenResource}
          />
        )}
        {analysis.failed.length > 0 && (
          <DrillInPill
            icon={XCircle}
            label="Failed"
            value={analysis.failed.length}
            className="text-destructive"
            actions={analysis.failed}
            onOpenResource={onOpenResource}
          />
        )}
        {healthy && (
          <span className="text-emerald-600 font-medium flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            System healthy — no active trust issues
          </span>
        )}
      </div>
    </div>
  );
}

function DrillInPill({
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
      <PopoverContent className="w-72 text-xs space-y-3" side="bottom" align="center">
        <div className="font-semibold text-foreground">{label} ({value})</div>

        {/* Top reasons */}
        {reasons && reasons.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Top reasons</span>
            <div className="mt-1 space-y-1">
              {reasons.map(([reason, count], i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-muted-foreground tabular-nums shrink-0">×{count}</span>
                  <span className="text-foreground">{reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sample affected resources */}
        <div>
          <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Affected resources
          </span>
          <div className="mt-1 space-y-0.5">
            {actions.slice(0, 4).map(a => (
              <button
                key={a.id}
                onClick={() => onOpenResource?.(a.resourceId)}
                className="block text-left w-full truncate hover:text-primary hover:underline transition-colors"
              >
                • {a.resourceTitle} — {a.actionLabel}
              </button>
            ))}
            {actions.length > 4 && (
              <span className="text-muted-foreground/70 italic">…and {actions.length - 4} more</span>
            )}
          </div>
        </div>

        {/* Timestamps */}
        <div className="flex items-center gap-1 text-muted-foreground/60">
          <Clock className="h-2.5 w-2.5" />
          Most recent: {actions[0] ? new Date(actions[0].timestamp).toLocaleTimeString() : '—'}
        </div>
      </PopoverContent>
    </Popover>
  );
}
