/**
 * LaneContextBanner — In-session banner showing active lane, rep count, score trend, sub-skill.
 * Compact strip that sits just below the session header.
 */

import { TrendingUp, TrendingDown, Minus, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadActiveLane } from '@/lib/sessionDurability';

export function LaneContextBanner() {
  const lane = loadActiveLane();
  if (!lane || lane.repsThisSession === 0) return null;

  const scores = lane.recentScores;
  const avg = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  // Trend: compare last 2 scores
  let TrendIcon = Minus;
  let trendColor = 'text-muted-foreground';
  if (scores.length >= 2) {
    if (scores[0] > scores[1]) { TrendIcon = TrendingUp; trendColor = 'text-green-500'; }
    else if (scores[0] < scores[1]) { TrendIcon = TrendingDown; trendColor = 'text-destructive'; }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/5 border border-primary/15">
      <Flame className="h-3 w-3 text-primary shrink-0" />
      <span className="text-[11px] font-semibold text-primary">{lane.label} Lane</span>
      <span className="text-[10px] text-muted-foreground">·</span>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        Rep {lane.repsThisSession + 1}
      </span>
      {avg !== null && (
        <>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">Avg {avg}</span>
          <TrendIcon className={cn('h-3 w-3', trendColor)} />
        </>
      )}
      {lane.subSkillTarget && (
        <>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] font-medium text-foreground truncate">{lane.subSkillTarget}</span>
        </>
      )}
    </div>
  );
}
