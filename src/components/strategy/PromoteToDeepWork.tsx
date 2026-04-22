// ════════════════════════════════════════════════════════════════
// PromoteToDeepWork — small CTA shown on assisted answers when the
// router detected deep intent but did not auto-promote (e.g. no
// account attached, or composer was set to auto without context).
//
// Always passes an explicit taskType — never inferred at submit.
//
// Hardening (Cycle 1):
//   - promotedRef guard prevents duplicate launches from double-click.
//   - Failure UI surfaces error + failed stage + retry hint + Retry button.
//   - Retry resets promotedRef so the user is never wedged.
// ════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { useStrategyJob, type StrategyTaskType } from '@/lib/strategy/useStrategyJob';
import { toast } from 'sonner';

export interface PromoteToDeepWorkProps {
  threadId: string;
  originalMessage: string;
  inputs: Record<string, unknown>;
  taskType: StrategyTaskType;
  onPromoted: (runId: string, taskType: StrategyTaskType) => void;
  className?: string;
}

const LABEL: Record<StrategyTaskType, string> = {
  account_brief: 'Promote to Account Brief',
  ninety_day_plan: 'Promote to 90-Day Plan',
};

export function PromoteToDeepWork({
  threadId,
  originalMessage,
  inputs,
  taskType,
  onPromoted,
  className,
}: PromoteToDeepWorkProps) {
  const { state, start } = useStrategyJob();
  const [isStarting, setIsStarting] = useState(false);
  const promotedRef = useRef(false);

  const launch = useCallback(async () => {
    if (promotedRef.current || isStarting) {
      console.log('[strategy-ui:dup_prevented]', JSON.stringify({ kind: 'promote' }));
      return;
    }
    promotedRef.current = true;
    setIsStarting(true);
    try {
      const runId = await start(
        taskType,
        {
          ...inputs,
          thread_id: threadId,
          original_message: originalMessage,
        },
        'deep',
      );
      onPromoted(runId, taskType);
    } catch (e) {
      // Reset on failure so Retry can re-launch.
      promotedRef.current = false;
      const msg = e instanceof Error ? e.message : 'Failed to promote to deep work';
      toast.error(msg);
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, start, taskType, inputs, threadId, originalMessage, onPromoted]);

  const handleRetry = useCallback(async () => {
    promotedRef.current = false;
    await launch();
  }, [launch]);

  const failed = state.status === 'failed';

  return (
    <div className={className}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={launch}
        disabled={isStarting || failed}
      >
        {isStarting ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-3.5 w-3.5" />
        )}
        {LABEL[taskType]}
      </Button>

      {failed && (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Deep work failed
          </div>
          {state.error && (
            <div className="mt-1 text-muted-foreground">{state.error}</div>
          )}
          {state.failedStage && (
            <div className="text-muted-foreground">Stage: {state.failedStage}</div>
          )}
          {state.retryHint && (
            <div className="mt-1 text-foreground">{state.retryHint}</div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={handleRetry}
            disabled={isStarting}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
