/**
 * Bulk Action Result Dialog — outcome summary with category-aware language
 * and clickable attention items.
 */
import {
  AlertDialog, AlertDialogAction,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CheckCircle2, XCircle, AlertTriangle, MinusCircle, ShieldCheck, ShieldAlert, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS } from '@/lib/controlPlaneState';
import type { BulkActionOutcome } from '@/lib/actionOutcomeStore';

interface Props {
  outcome: BulkActionOutcome | null;
  open: boolean;
  onClose: () => void;
  onFilterAttention?: (ids: Set<string>) => void;
  onOpenResource?: (resourceId: string) => void;
}

/** Derive a category-specific verb for "succeeded" based on the dominant transition */
function successVerb(outcome: BulkActionOutcome): string {
  if (outcome.transitions.length === 0) return 'moved forward';
  const dominant = outcome.transitions.reduce((a, b) => b.count > a.count ? b : a);
  if (dominant.to === 'extracted') return 'extracted';
  if (dominant.to === 'activated') return 'activated';
  if (dominant.to === 'has_content' && dominant.from === 'blocked') return 'unblocked';
  if (dominant.to === 'has_content') return 'enriched';
  return 'moved forward';
}

/** Derive a category-specific phrase for failures */
function failurePhrase(outcome: BulkActionOutcome): string {
  if (outcome.transitions.length === 0) return 'failed';
  const dominant = outcome.transitions.reduce((a, b) => b.count > a.count ? b : a);
  if (dominant.from === 'blocked') return 'still blocked';
  return 'failed';
}

/** Build a plain-English summary sentence for the outcome */
function buildOutcomeSummary(outcome: BulkActionOutcome): string {
  const parts: string[] = [];
  const verb = successVerb(outcome);

  if (outcome.succeeded > 0) {
    parts.push(`${outcome.succeeded} ${verb}`);
  }
  if (outcome.unchanged > 0) {
    parts.push(`${outcome.unchanged} already in target state`);
  }
  if (outcome.failed > 0) {
    parts.push(`${outcome.failed} ${failurePhrase(outcome)}`);
  }
  if (outcome.needsReview > 0) {
    parts.push(`${outcome.needsReview} still need attention`);
  }

  if (parts.length === 0) return 'No resources were affected.';

  const summary = parts.join(', ');

  if (outcome.mismatched > 0) {
    return `${summary}. ${outcome.mismatched} ended in an unexpected state — open each to verify.`;
  }
  if (outcome.confirmed > 0 && outcome.failed === 0 && outcome.mismatched === 0) {
    return `${summary}. All transitions confirmed by reconciliation.`;
  }
  if (outcome.failed > 0 && outcome.succeeded === 0) {
    return `${summary}. Consider diagnosing individually.`;
  }
  return `${summary}.`;
}

export function BulkActionResultDialog({ outcome, open, onClose, onFilterAttention, onOpenResource }: Props) {
  if (!outcome) return null;

  const summaryText = buildOutcomeSummary(outcome);

  const handleFilterAttention = () => {
    if (!onFilterAttention || outcome.stillNeedAttention.length === 0) return;
    const ids = new Set(outcome.stillNeedAttention.map(r => r.resourceId));
    onFilterAttention(ids);
    onClose();
  };

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
            {/* Plain-English summary */}
            <p className="text-xs text-foreground font-medium leading-relaxed">
              {summaryText}
            </p>

            {/* Orientation hint — contextual */}
            {outcome.succeeded > 0 && outcome.failed === 0 && outcome.unchanged === 0 && outcome.stillNeedAttention.length === 0 && (
              <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
                ✓ All done. Resources moved forward and may now appear under a different filter.
              </p>
            )}
            {outcome.succeeded > 0 && outcome.failed > 0 && (
              <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
                {outcome.succeeded} moved forward. {outcome.failed} remaining — open each to diagnose individually.
              </p>
            )}
            {outcome.succeeded === 0 && outcome.failed > 0 && outcome.stillNeedAttention.length > 0 && (
              <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
                None moved forward. Use "Show in table" below to inspect each resource.
              </p>
            )}

            {/* Execution counts */}
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={CheckCircle2} label={successVerb(outcome).charAt(0).toUpperCase() + successVerb(outcome).slice(1)} value={outcome.succeeded} color="text-emerald-600" />
              <Stat icon={XCircle} label={failurePhrase(outcome).charAt(0).toUpperCase() + failurePhrase(outcome).slice(1)} value={outcome.failed} color="text-destructive" />
              <Stat icon={MinusCircle} label="Already in target state" value={outcome.unchanged} color="text-muted-foreground" />
              <Stat icon={AlertTriangle} label="Still need attention" value={outcome.needsReview} color="text-amber-600" />
            </div>

            {/* Reconciliation summary */}
            {(outcome.confirmed > 0 || outcome.partial > 0 || outcome.mismatched > 0) && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground">Reconciliation</span>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <Stat icon={ShieldCheck} label="Confirmed" value={outcome.confirmed} color="text-emerald-600" />
                  <Stat icon={AlertTriangle} label="Partial" value={outcome.partial} color="text-amber-600" />
                  <Stat icon={ShieldAlert} label="Mismatched" value={outcome.mismatched} color="text-destructive" />
                </div>
              </div>
            )}

            {/* State transitions */}
            {outcome.transitions.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground">State transitions</span>
                <div className="mt-1 space-y-1">
                  {outcome.transitions.map((t, i) => {
                    const fromC = CONTROL_PLANE_COLORS[t.from];
                    const toC = CONTROL_PLANE_COLORS[t.to];
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className={cn('text-[9px]', fromC.text, fromC.bg, fromC.border)}>
                          {CONTROL_PLANE_LABELS[t.from]}
                        </Badge>
                        <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                        <Badge variant="outline" className={cn('text-[9px]', toC.text, toC.bg, toC.border)}>
                          {CONTROL_PLANE_LABELS[t.to]}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">×{t.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Still need attention — clickable */}
            {outcome.stillNeedAttention.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-muted-foreground">
                    Still need attention ({outcome.stillNeedAttention.length})
                  </span>
                  {onFilterAttention && (
                    <button
                      onClick={handleFilterAttention}
                      className="text-[10px] text-primary hover:underline"
                    >
                      Filter in table →
                    </button>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {outcome.stillNeedAttention.slice(0, 5).map((r, i) => (
                    <li key={i}>
                      <button
                        onClick={() => onOpenResource?.(r.resourceId)}
                        className="text-xs text-muted-foreground truncate hover:text-foreground hover:underline transition-colors text-left w-full"
                      >
                        • {r.title} — {r.reason}
                      </button>
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
          {outcome.stillNeedAttention.length > 0 && onFilterAttention ? (
            <>
              <AlertDialogAction className="text-xs h-8 bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={onClose}>Dismiss</AlertDialogAction>
              <AlertDialogAction className="text-xs h-8" onClick={handleFilterAttention}>
                Show {outcome.stillNeedAttention.length} in table
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction className="text-xs h-8" onClick={onClose}>Done</AlertDialogAction>
          )}
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
