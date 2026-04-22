// ════════════════════════════════════════════════════════════════
// PromoteToDeepWork — small CTA shown on assisted answers when the
// router detected deep intent but did not auto-promote (e.g. no
// account attached, or composer was set to auto without context).
//
// Always passes an explicit taskType — never inferred at submit.
// ════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
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
  const { start } = useStrategyJob();
  const [isStarting, setIsStarting] = useState(false);

  const handleClick = async () => {
    if (isStarting) return;
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
      const msg = e instanceof Error ? e.message : 'Failed to promote to deep work';
      toast.error(msg);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={isStarting}
      className={className}
    >
      {isStarting ? (
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="mr-2 h-3.5 w-3.5" />
      )}
      {LABEL[taskType]}
    </Button>
  );
}
