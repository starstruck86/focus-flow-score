/**
 * System Confidence Strip — answers "Can I trust the system right now?"
 * Shows recent reconciliation verdicts + unresolved conflicts.
 */
import { useMemo } from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, ArrowRight, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getRecentActions, type ReconciliationVerdict } from '@/lib/actionOutcomeStore';

interface Props {
  conflictCount: number;
  refreshKey: number;
}

export function SystemConfidenceStrip({ conflictCount, refreshKey }: Props) {
  const counts = useMemo(() => {
    const actions = getRecentActions();
    const c = { confirmed: 0, partial: 0, mismatched: 0, pending: 0, total: 0 };
    for (const a of actions) {
      c[a.reconciliation]++;
      c.total++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (counts.total === 0 && conflictCount === 0) return null;

  const hasIssues = counts.mismatched > 0 || counts.partial > 0 || conflictCount > 0;
  const allClear = counts.total > 0 && !hasIssues;

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2 rounded-lg border text-xs',
      allClear
        ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
        : hasIssues
          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
          : 'bg-card border-border',
    )}>
      <Activity className={cn('h-3.5 w-3.5 shrink-0', allClear ? 'text-emerald-600' : hasIssues ? 'text-amber-600' : 'text-muted-foreground')} />
      <span className="font-medium text-foreground">System Confidence</span>

      <div className="flex items-center gap-3 ml-auto">
        {counts.confirmed > 0 && (
          <Pill icon={ShieldCheck} label="Confirmed" value={counts.confirmed} className="text-emerald-600" />
        )}
        {counts.partial > 0 && (
          <Pill icon={ArrowRight} label="Partial" value={counts.partial} className="text-amber-600" />
        )}
        {counts.mismatched > 0 && (
          <Pill icon={ShieldAlert} label="Mismatched" value={counts.mismatched} className="text-destructive" />
        )}
        {conflictCount > 0 && (
          <Pill icon={AlertTriangle} label="Conflicts" value={conflictCount} className="text-destructive" />
        )}
        {allClear && (
          <span className="text-emerald-600 font-medium">All clear ✓</span>
        )}
      </div>
    </div>
  );
}

function Pill({ icon: Icon, label, value, className }: { icon: React.ElementType; label: string; value: number; className: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <Icon className="h-3 w-3" />
      <span className="tabular-nums font-medium">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
