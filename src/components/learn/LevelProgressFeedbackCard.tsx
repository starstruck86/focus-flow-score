/**
 * LevelProgressFeedbackCard — Post-session progress feedback.
 * Shows how much progress was gained toward the next tier,
 * plus which sub-skills improved or are blocking.
 */

import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { TrendingUp, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LevelProgressFeedbackCardProps {
  current: UserSkillLevel;
  /** Previous progress value (0–100) before this session */
  previousProgress?: number;
  /** Which metrics improved */
  improvedMetrics?: string[];
  /** Sub-skill insights from post-session evaluation */
  subSkillInsights?: {
    improved?: string[];
    stillBlocking?: string[];
  };
}

export function LevelProgressFeedbackCard({
  current,
  previousProgress,
  improvedMetrics,
  subSkillInsights,
}: LevelProgressFeedbackCardProps) {
  const delta = previousProgress != null
    ? current.progressWithinTier - previousProgress
    : null;

  const isCloseToTierUp = current.progressWithinTier >= 80;
  const isMaxTier = !current.nextTier;

  if (isMaxTier) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <p className="text-xs font-medium text-foreground">
          {SKILL_LABELS[current.skill]} Progress
        </p>
      </div>

      {/* Delta line */}
      {delta != null && delta > 0 && (
        <p className="text-sm font-semibold text-primary">
          +{delta}% progress toward Tier {current.currentTier + 1}
        </p>
      )}

      {/* What improved */}
      {improvedMetrics && improvedMetrics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {improvedMetrics.map((m) => (
            <span
              key={m}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/5 border border-primary/10 text-primary font-medium"
            >
              {m}
            </span>
          ))}
        </div>
      )}

      {/* Sub-skill insights */}
      {subSkillInsights?.improved && subSkillInsights.improved.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Improved: </span>
          {subSkillInsights.improved.join(', ')}
        </p>
      )}
      {subSkillInsights?.stillBlocking && subSkillInsights.stillBlocking.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Still blocking: </span>
          {subSkillInsights.stillBlocking.join(', ')}
        </p>
      )}

      {/* Close to tier up nudge */}
      {isCloseToTierUp && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/5 border border-amber-500/15">
          <Zap className="h-3 w-3 text-amber-500" />
          <p className={cn('text-[11px] font-medium text-amber-600 dark:text-amber-400')}>
            You're close to Tier {current.currentTier + 1}
          </p>
        </div>
      )}

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            Tier {current.currentTier} → {current.currentTier + 1}
          </p>
          <p className="text-[10px] font-medium text-muted-foreground">
            {current.progressWithinTier}%
          </p>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              isCloseToTierUp ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${current.progressWithinTier}%` }}
          />
        </div>
      </div>
    </div>
  );
}
