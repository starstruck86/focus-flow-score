/**
 * NextStepCard — Shows the recommended next action after a rep.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RotateCcw, ArrowRight, BookOpen, Zap, Shuffle } from 'lucide-react';
import { recommendNextStep, type NextStepRecommendation, type NextAction } from '@/lib/dojo/nextStepRecommendation';
import type { SkillFocus } from '@/lib/dojo/scenarios';

const ACTION_ICONS: Record<NextAction, typeof RotateCcw> = {
  retry_same: RotateCcw,
  retry_dimension_focus: RotateCcw,
  return_to_training: BookOpen,
  advance_pressure: Zap,
  switch_scenario_same_skill: Shuffle,
};

const ACTION_VARIANTS: Record<NextAction, 'default' | 'outline' | 'secondary'> = {
  retry_same: 'default',
  retry_dimension_focus: 'default',
  return_to_training: 'secondary',
  advance_pressure: 'default',
  switch_scenario_same_skill: 'outline',
};

interface Props {
  score: number;
  dimensions: Record<string, unknown> | null | undefined;
  skill: SkillFocus;
  retryCount: number;
  topMistake: string;
  previousTopMistake?: string;
  onRetry: () => void;
  onNextRep: () => void;
}

export function NextStepCard({
  score, dimensions, skill, retryCount, topMistake,
  previousTopMistake, onRetry, onNextRep,
}: Props) {
  const rec = recommendNextStep({
    score, dimensions, skill, retryCount, topMistake, previousTopMistake,
  });

  const Icon = ACTION_ICONS[rec.action];
  const variant = ACTION_VARIANTS[rec.action];

  // Map actions to handlers
  const handleAction = () => {
    if (rec.action === 'retry_same' || rec.action === 'retry_dimension_focus') {
      onRetry();
    } else {
      onNextRep();
    }
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
          Recommended Next Step
        </p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed pl-[22px]">
        {rec.reason}
      </p>
      {rec.focusDimensionLabel && (
        <div className="pl-[22px]">
          <Badge variant="outline" className="text-[9px]">
            Focus: {rec.focusDimensionLabel}
          </Badge>
        </div>
      )}
      <div className="pl-[22px]">
        <Button
          variant={variant}
          size="sm"
          className="gap-2 h-9"
          onClick={handleAction}
        >
          <Icon className="h-3.5 w-3.5" />
          {rec.label}
        </Button>
      </div>
    </div>
  );
}
