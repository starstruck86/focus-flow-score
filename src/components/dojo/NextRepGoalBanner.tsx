/**
 * NextRepGoalBanner — Prominent, unmissable display of what the next rep is about.
 * Appears above the retry box or next action to eliminate ambiguity.
 */

import { Target } from 'lucide-react';

interface Props {
  practiceCue: string;
  /** Optional: show a condensed version */
  compact?: boolean;
}

export function NextRepGoalBanner({ practiceCue, compact = false }: Props) {
  if (!practiceCue) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-primary/10 border border-primary/20 px-3 py-2">
        <Target className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-xs font-semibold text-foreground leading-snug">
          <span className="text-primary">Next rep goal: </span>
          {practiceCue}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-3 space-y-1">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-primary shrink-0" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
          Your Next Rep Goal
        </p>
      </div>
      <p className="text-sm font-semibold text-foreground leading-relaxed pl-6">
        {practiceCue}
      </p>
    </div>
  );
}
