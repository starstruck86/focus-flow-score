/**
 * NextStepCard — Shows the recommended next action after a rep.
 * Varies phrasing on retries to avoid robotic repetition.
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

// Retry-aware label variations to keep repeated reps feeling fresh
const RETRY_LABELS: Record<NextAction, string[]> = {
  retry_same: ['Retry This Scenario', 'Go Again', 'One More Rep'],
  retry_dimension_focus: ['Isolate & Retry', 'Focus Drill', 'Target This Dimension'],
  return_to_training: ['Review the Concept', 'Back to Skill Builder', 'Revisit Fundamentals'],
  advance_pressure: ['Try Harder Scenario', 'Level Up', 'Raise the Stakes'],
  switch_scenario_same_skill: ['Fresh Scenario', 'New Context', 'Different Scenario'],
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

  // Pick a label variant based on retry count
  const labels = RETRY_LABELS[rec.action];
  const label = labels[Math.min(retryCount, labels.length - 1)];

  const handleAction = () => {
    if (rec.action === 'retry_same' || rec.action === 'retry_dimension_focus') {
      onRetry();
    } else {
      onNextRep();
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
          {rec.reason}
        </p>
      </div>
      <Button
        variant={variant}
        size="sm"
        className="gap-1.5 h-8 shrink-0"
        onClick={handleAction}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </Button>
    </div>
  );
}
