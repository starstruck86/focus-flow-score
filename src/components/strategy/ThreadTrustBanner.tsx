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
import { AlertTriangle, ShieldAlert, RefreshCw, Unlink2, Copy } from 'lucide-react';
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
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          'shrink-0 mx-3 mt-2 mb-1 rounded-md border border-destructive/40 bg-destructive/10',
          'px-3 py-2 space-y-1.5'
        )}
      >
        <div className="flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-destructive">
                Promotion blocked — entity conflict
              </span>
              <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive px-1.5 py-0">
                {blocking.length} blocking
              </Badge>
            </div>
            <ul className="space-y-1">
              {blocking.map(c => (
                <li key={c.id} className="text-[11px] text-foreground/85 leading-snug">
                  {c.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1 pl-6">
          {isLinked && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onUnlink}>
              <Unlink2 className="h-3 w-3" /> Unlink → freeform
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onClone}>
            <Copy className="h-3 w-3" /> Clone for correct entity
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={onRecheck} disabled={isDetecting}>
            <RefreshCw className={cn('h-3 w-3', isDetecting && 'animate-spin')} />
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
        'shrink-0 mx-3 mt-2 mb-1 rounded-md border border-amber-500/30 bg-amber-500/5',
        'px-3 py-1.5 flex items-start gap-2'
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
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
