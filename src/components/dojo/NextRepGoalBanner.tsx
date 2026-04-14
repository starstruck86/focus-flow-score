/**
 * NextRepGoalBanner — Prominent, unmissable display of what the next rep is about.
 * Appears above the retry box or next action to eliminate ambiguity.
 */

import { Target } from 'lucide-react';

interface Props {
  practiceCue: string;
  /** Optional: show a condensed version */
  compact?: boolean;
  /** Retry number for tone variation */
  retryCount?: number;
}

const HEADERS = [
  'Your Next Rep Goal',
  'Focus on This',
  'Lock In on This',
];

export function NextRepGoalBanner({ practiceCue, compact = false, retryCount = 0 }: Props) {
  if (!practiceCue) return null;
  const header = HEADERS[Math.min(retryCount, HEADERS.length - 1)];

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-primary/10 border border-primary/20 px-3 py-2">
        <Target className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-xs font-semibold text-foreground leading-snug">
          <span className="text-primary">{header}: </span>
          {practiceCue}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-primary/10 border border-primary/20 px-3.5 py-2.5 space-y-0.5">
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
          {header}
        </p>
      </div>
      <p className="text-sm font-semibold text-foreground leading-relaxed pl-[22px]">
        {practiceCue}
      </p>
    </div>
  );
}
