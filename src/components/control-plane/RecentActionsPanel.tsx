/**
 * Recent Actions Panel — lightweight log of recent control plane actions.
 */
import { useState, useEffect } from 'react';
import { History, CheckCircle2, XCircle, AlertTriangle, MinusCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getRecentActions, type ActionOutcome } from '@/lib/actionOutcomeStore';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  success: { icon: CheckCircle2, label: 'Updated', color: 'text-emerald-600' },
  no_change: { icon: MinusCircle, label: 'No change', color: 'text-muted-foreground' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-destructive' },
  needs_review: { icon: AlertTriangle, label: 'Needs review', color: 'text-amber-600' },
};

export function RecentActionsPanel({ refreshKey }: { refreshKey: number }) {
  const [expanded, setExpanded] = useState(false);
  const actions = getRecentActions();

  if (actions.length === 0) return null;

  const shown = expanded ? actions.slice(0, 20) : actions.slice(0, 3);

  return (
    <div className="border rounded-lg bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <History className="h-3 w-3 text-muted-foreground" />
          Recent Actions ({actions.length})
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      <div className="border-t divide-y">
        {shown.map(a => {
          const cfg = STATUS_CONFIG[a.status];
          const Icon = cfg.icon;
          return (
            <div key={a.id} className="px-3 py-1.5 flex items-center gap-2 text-xs">
              <Icon className={cn('h-3 w-3 shrink-0', cfg.color)} />
              <span className="font-medium truncate max-w-[120px]">{a.actionLabel}</span>
              <span className="text-muted-foreground truncate max-w-[140px]">{a.resourceTitle}</span>
              {!a.transitionMatched && a.status !== 'no_change' && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-200">
                  unexpected
                </Badge>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/70 whitespace-nowrap">
                {new Date(a.timestamp).toLocaleTimeString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
