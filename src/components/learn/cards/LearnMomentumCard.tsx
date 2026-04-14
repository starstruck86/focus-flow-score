/**
 * LearnMomentumCard — Weekly progress summary.
 * Shows reps, consistency, and progress toward next level.
 */

import { TrendingUp, Flame, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';

interface Props {
  levels: UserSkillLevel[];
  weeklyReps?: number;
  streakDays?: number;
}

export function LearnMomentumCard({ levels, weeklyReps = 0, streakDays = 0 }: Props) {
  const avgProgress = levels.length > 0
    ? Math.round(levels.reduce((sum, l) => sum + l.progressWithinTier, 0) / levels.length)
    : 0;

  const closestToTierUp = [...levels]
    .filter(l => l.nextTier && l.progressWithinTier >= 60)
    .sort((a, b) => b.progressWithinTier - a.progressWithinTier)[0];

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold text-foreground">Weekly Momentum</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Reps */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-1">
            <BarChart3 className="h-3 w-3 text-primary" />
          </div>
          <p className="text-xl font-bold text-foreground">{weeklyReps}</p>
          <p className="text-[10px] text-muted-foreground">Reps This Week</p>
        </div>

        {/* Streak */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-1">
            <Flame className="h-3 w-3 text-orange-500" />
          </div>
          <p className="text-xl font-bold text-foreground">{streakDays}</p>
          <p className="text-[10px] text-muted-foreground">Day Streak</p>
        </div>

        {/* Avg Progress */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-1">
            <TrendingUp className="h-3 w-3 text-green-500" />
          </div>
          <p className="text-xl font-bold text-foreground">{avgProgress}%</p>
          <p className="text-[10px] text-muted-foreground">Avg Progress</p>
        </div>
      </div>

      {/* Closest to tier-up */}
      {closestToTierUp && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/15">
          <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
          <p className="text-[11px] text-foreground">
            <span className="font-medium">{closestToTierUp.currentTierName}</span>
            <span className="text-muted-foreground"> — {closestToTierUp.progressWithinTier}% to Tier {closestToTierUp.currentTier + 1}</span>
          </p>
        </div>
      )}
    </div>
  );
}
