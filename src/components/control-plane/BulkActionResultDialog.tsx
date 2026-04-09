/**
 * Bulk Action Result Dialog — shows outcome summary after batch operations.
 */
import {
  AlertDialog, AlertDialogAction,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CheckCircle2, XCircle, AlertTriangle, MinusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS } from '@/lib/controlPlaneState';
import type { BulkActionOutcome } from '@/lib/actionOutcomeStore';

interface Props {
  outcome: BulkActionOutcome | null;
  open: boolean;
  onClose: () => void;
}

export function BulkActionResultDialog({ outcome, open, onClose }: Props) {
  if (!outcome) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{outcome.actionLabel} — Results</AlertDialogTitle>
          <p className="text-xs text-muted-foreground">
            Completed at {new Date(outcome.timestamp).toLocaleTimeString()}
          </p>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="space-y-4">
            {/* Counts */}
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={CheckCircle2} label="Succeeded" value={outcome.succeeded} color="text-emerald-600" />
              <Stat icon={XCircle} label="Failed" value={outcome.failed} color="text-destructive" />
              <Stat icon={MinusCircle} label="Unchanged" value={outcome.unchanged} color="text-muted-foreground" />
              <Stat icon={AlertTriangle} label="Needs Review" value={outcome.needsReview} color="text-amber-600" />
            </div>

            {/* State transitions */}
            {outcome.transitions.length > 0 && (
              <div>
                <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Transitions achieved</span>
                <div className="mt-1 space-y-1">
                  {outcome.transitions.map((t, i) => {
                    const fromC = CONTROL_PLANE_COLORS[t.from];
                    const toC = CONTROL_PLANE_COLORS[t.to];
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className={cn('text-[9px]', fromC.text, fromC.bg, fromC.border)}>
                          {CONTROL_PLANE_LABELS[t.from]}
                        </Badge>
                        <span className="text-muted-foreground">→</span>
                        <Badge variant="outline" className={cn('text-[9px]', toC.text, toC.bg, toC.border)}>
                          {CONTROL_PLANE_LABELS[t.to]}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">×{t.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Still need attention */}
            {outcome.stillNeedAttention.length > 0 && (
              <div>
                <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                  Still need attention ({outcome.stillNeedAttention.length})
                </span>
                <ul className="mt-1 space-y-0.5">
                  {outcome.stillNeedAttention.slice(0, 5).map((r, i) => (
                    <li key={i} className="text-xs text-muted-foreground truncate">
                      • {r.title} — {r.reason}
                    </li>
                  ))}
                  {outcome.stillNeedAttention.length > 5 && (
                    <li className="text-[10px] text-muted-foreground/70 italic">
                      …and {outcome.stillNeedAttention.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogAction className="text-xs h-8" onClick={onClose}>Done</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Stat({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={cn('h-3.5 w-3.5', color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums">{value}</span>
    </div>
  );
}
