/**
 * Post-output next step guidance.
 * Shows clickable suggestions for what to do after generating.
 */

import { ArrowRight } from 'lucide-react';
import type { StageNextStep } from './stageConfig';

interface Props {
  nextSteps: StageNextStep[];
  onSelectAction: (actionId: string) => void;
  onChangeStage: (stageId: string) => void;
  show: boolean;
}

export function NextStepGuidance({ nextSteps, onSelectAction, onChangeStage, show }: Props) {
  if (!show || nextSteps.length === 0) return null;

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <p className="text-xs font-semibold text-muted-foreground">What should you do next?</p>
      <div className="flex flex-wrap gap-1.5">
        {nextSteps.map((ns, i) => (
          <button
            key={i}
            onClick={() => {
              if (ns.actionId) onSelectAction(ns.actionId);
              else if (ns.targetStage) onChangeStage(ns.targetStage);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-muted/30 text-xs font-medium text-foreground hover:bg-accent/50 hover:border-primary/30 transition-colors"
          >
            <ArrowRight className="h-3 w-3 text-primary" />
            {ns.label}
          </button>
        ))}
      </div>
    </div>
  );
}
