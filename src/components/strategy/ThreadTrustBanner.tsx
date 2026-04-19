/**
 * ThreadTrustBanner — non-dismissible identity/trust surface for a Strategy thread.
 *
 * Visibility rules:
 *   - blocked  → red banner, prominent, lists each blocking conflict with reason and resolution actions
 *   - warning  → amber banner, smaller, shows the warning reason and a "Recheck" affordance
 *   - safe + freeform with no conflicts → no banner (chip in header is enough)
 *   - safe + linked → no banner (chip already shows linkage)
 *
 * The banner is the user-facing complement to the server-side trust gate in
 * strategy-promote-proposal and strategy-stage-proposal. UI and server agree on
 * trust state because both call compute_thread_trust_state.
 */
import { AlertTriangle, ShieldAlert, RefreshCw, Unlink2, Copy, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ThreadConflict, TrustState } from '@/hooks/strategy/useThreadTrustState';

interface Props {
  trustState: TrustState;
  trustReason: string | null;
  conflicts: ThreadConflict[];
  isLinked: boolean;
  isDetecting: boolean;
  onRecheck: () => void;
  onUnlink: () => void;
  onClone: () => void;
}

export function ThreadTrustBanner({
  trustState, conflicts, isLinked, isDetecting, onRecheck, onUnlink, onClone,
}: Props) {
  if (trustState === 'safe') return null;

  const blocking = conflicts.filter(c => c.severity === 'blocking');
  const warnings = conflicts.filter(c => c.severity === 'warning');

  if (trustState === 'blocked') {
    const primary = blocking[0];
    const detected = primary?.detected_account_name ?? null;
    const linked = primary?.linked_account_name ?? null;
    const headline = detected && linked
      ? `Identity conflict: this thread talks about ${detected} but is linked to ${linked}.`
      : 'Identity conflict on this thread — shared promotion is blocked.';
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          'shrink-0 mx-3 mt-2 mb-1 rounded-md border-2 border-destructive/60 bg-destructive/15',
          'px-3 py-2.5 space-y-2 shadow-sm'
        )}
      >
        <div className="flex items-start gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-destructive leading-tight">
                Shared promotion blocked
              </span>
              <Badge variant="outline" className="text-[10px] border-destructive/60 text-destructive px-1.5 py-0 font-semibold">
                {blocking.length} blocking conflict{blocking.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <p className="text-[12px] font-semibold text-foreground/90 leading-snug">
              {headline}
            </p>
            {detected && linked && (
              <p className="text-[11px] text-foreground/75 leading-snug flex items-center gap-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-medium">{detected}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="px-1.5 py-0.5 rounded bg-muted/40 line-through text-muted-foreground">{linked}</span>
                <span className="text-muted-foreground">— mismatch detected in thread content</span>
              </p>
            )}
            <ul className="space-y-1">
              {blocking.map(c => (
                <li key={c.id} className="text-[11px] text-foreground/70 leading-snug pl-2 border-l-2 border-destructive/30">
                  {c.reason}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-foreground/80 leading-snug pt-0.5">
              <span className="font-semibold">Safe path:</span> clone this thread for the correct entity. Do not mutate this one in place.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 pl-7">
          <Button size="sm" variant="default" className="h-7 text-[11px] gap-1.5 font-semibold" onClick={onClone}>
            <Copy className="h-3.5 w-3.5" /> Clone for correct entity
          </Button>
          {isLinked && (
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1.5" onClick={onUnlink}>
              <Unlink2 className="h-3.5 w-3.5" /> Unlink → freeform
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1.5 text-muted-foreground" onClick={onRecheck} disabled={isDetecting}>
            <RefreshCw className={cn('h-3.5 w-3.5', isDetecting && 'animate-spin')} />
            {isDetecting ? 'Re-checking…' : 'Re-check'}
          </Button>
        </div>
      </div>
    );
  }

  // warning
  return (
    <div
      role="status"
      className={cn(
        'shrink-0 mx-3 mt-2 mb-1 rounded-md border border-primary/30 bg-primary/5',
        'px-3 py-1.5 flex items-start gap-2'
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <span className="text-[11px] font-medium text-primary">
          Unconfirmed entity in this thread
        </span>
        {warnings.map(w => (
          <p key={w.id} className="text-[11px] text-foreground/75 leading-snug">{w.reason}</p>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground shrink-0" onClick={onRecheck} disabled={isDetecting}>
        <RefreshCw className={cn('h-3 w-3', isDetecting && 'animate-spin')} />
        Re-check
      </Button>
    </div>
  );
}
