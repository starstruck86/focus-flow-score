/**
 * Execution Signals
 *
 * Lightweight status strip rendered below the Daily Game Plan header.
 * Shows roleplay status + prep→action readiness at a glance.
 */
import { memo } from 'react';
import { Mic, Phone, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PrepActionSignal } from '@/lib/loopReadiness';

interface ExecutionSignalsProps {
  signal: PrepActionSignal;
}

export const ExecutionSignals = memo(function ExecutionSignals({ signal }: ExecutionSignalsProps) {
  const items: React.ReactNode[] = [];

  // Roleplay status
  if (signal.roleplayStatus === 'completed') {
    items.push(
      <span key="rp" className="inline-flex items-center gap-1 text-primary">
        <Mic className="h-3 w-3" /> Roleplay done
        {signal.roleplayStreakDays > 0 && <span className="text-[9px]">🔥{signal.roleplayStreakDays + 1}</span>}
      </span>
    );
  } else if (signal.roleplayStatus === 'skipped') {
    items.push(
      <span key="rp" className="inline-flex items-center gap-1 text-muted-foreground">
        <Mic className="h-3 w-3" /> Roleplay skipped
      </span>
    );
  } else if (signal.roleplayStatus === 'missed_no_slot') {
    items.push(
      <span key="rp" className="inline-flex items-center gap-1 text-muted-foreground">
        <Mic className="h-3 w-3" /> No roleplay slot today
      </span>
    );
  }

  // Next action block readiness
  if (signal.nextActionBlockLabel) {
    if (signal.nextActionBlockReady) {
      items.push(
        <span key="action" className="inline-flex items-center gap-1 text-primary">
          <Phone className="h-3 w-3" />
          Next block ready
          {signal.preparedAccountsWaiting > 0 && (
            <span className="font-medium">· {signal.preparedAccountsWaiting} prepped</span>
          )}
        </span>
      );
    } else {
      items.push(
        <span key="action" className="inline-flex items-center gap-1 text-status-yellow">
          <AlertTriangle className="h-3 w-3" />
          Prep needed before next call block
        </span>
      );
    }
  }

  // Carry-forward accounts
  if (signal.carryForwardCount > 0 && !signal.nextActionBlockLabel) {
    items.push(
      <span key="carry" className="inline-flex items-center gap-1 text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        {signal.carryForwardCount} prepped account{signal.carryForwardCount !== 1 ? 's' : ''} rolling forward
      </span>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="px-4 py-1.5 border-b border-border/30 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      {items}
    </div>
  );
});
