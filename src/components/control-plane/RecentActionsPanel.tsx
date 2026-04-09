/**
 * Recent Actions Panel — clickable log with reconciliation verdicts.
 * Row actions open the inspect drawer; bulk actions open the bulk result dialog.
 */
import { useState } from 'react';
import {
  History, CheckCircle2, XCircle, AlertTriangle, MinusCircle,
  ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, ArrowRight, Clock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getRecentActions, getRecentBulkActions, type ActionOutcome, type ReconciliationVerdict } from '@/lib/actionOutcomeStore';
import type { BulkActionOutcome } from '@/lib/actionOutcomeStore';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  success: { icon: CheckCircle2, label: 'Updated', color: 'text-emerald-600' },
  no_change: { icon: MinusCircle, label: 'No change', color: 'text-muted-foreground' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-destructive' },
  needs_review: { icon: AlertTriangle, label: 'Needs review', color: 'text-amber-600' },
};

const RECONCILE_CONFIG: Record<ReconciliationVerdict, { icon: React.ElementType; label: string; color: string }> = {
  confirmed: { icon: ShieldCheck, label: '✓', color: 'text-emerald-600' },
  partial: { icon: ArrowRight, label: '~', color: 'text-amber-600' },
  mismatched: { icon: ShieldAlert, label: '✗', color: 'text-destructive' },
  pending: { icon: Clock, label: '…', color: 'text-muted-foreground' },
};

interface Props {
  refreshKey: number;
  onOpenResource?: (resourceId: string) => void;
  onOpenBulkResult?: (outcome: BulkActionOutcome) => void;
}

export function RecentActionsPanel({ refreshKey, onOpenResource, onOpenBulkResult }: Props) {
  const [expanded, setExpanded] = useState(false);
  const actions = getRecentActions();
  const bulkActions = getRecentBulkActions();

  if (actions.length === 0 && bulkActions.length === 0) return null;

  const shown = expanded ? actions.slice(0, 20) : [];
  const shownBulk = expanded ? bulkActions.slice(0, 5) : [];

  return (
    <div className="border rounded-lg bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <History className="h-3 w-3 text-muted-foreground" />
          Recent Actions ({actions.length + bulkActions.length})
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (shown.length > 0 || shownBulk.length > 0) && (
        <div className="border-t divide-y">
          {shownBulk.map(b => (
            <button
              key={b.id}
              onClick={() => onOpenBulkResult?.(b)}
              className="w-full px-3 py-1 flex items-center gap-2 text-xs hover:bg-muted/30 transition-colors text-left"
            >
              <History className="h-3 w-3 shrink-0 text-primary" />
              <span className="font-medium truncate max-w-[120px]">{b.actionLabel}</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0">
                {b.succeeded}/{b.attempted}
              </Badge>
              {b.mismatched > 0 && (
                <ShieldAlert className="h-3 w-3 text-destructive shrink-0" />
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/70 whitespace-nowrap">
                {new Date(b.timestamp).toLocaleTimeString()}
              </span>
            </button>
          ))}
          {shown.map(a => {
            const cfg = STATUS_CONFIG[a.status];
            const Icon = cfg.icon;
            const rcfg = RECONCILE_CONFIG[a.reconciliation];
            const RIcon = rcfg.icon;
            return (
              <button
                key={a.id}
                onClick={() => onOpenResource?.(a.resourceId)}
                className="w-full px-3 py-1 flex items-center gap-2 text-xs hover:bg-muted/30 transition-colors text-left"
              >
                <Icon className={cn('h-3 w-3 shrink-0', cfg.color)} />
                <span className="font-medium truncate max-w-[100px]">{a.actionLabel}</span>
                <span className="text-muted-foreground truncate max-w-[120px]">{a.resourceTitle}</span>
                <RIcon className={cn('h-3 w-3 shrink-0', rcfg.color)} title={`Reconciliation: ${a.reconciliation}`} />
                {a.mismatchExplanation && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-200 max-w-[120px] truncate">
                    {a.reconciliation}
                  </Badge>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground/70 whitespace-nowrap">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
