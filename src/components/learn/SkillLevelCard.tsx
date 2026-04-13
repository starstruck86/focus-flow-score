/**
 * SkillLevelCard — Shows tier, micro-level progress, gaps, and next steps.
 */

import { useNavigate } from 'react-router-dom';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { getSkillTier } from '@/lib/learning/learnSkillLevels';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { ArrowRight, Target, AlertTriangle, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SkillLevelCardProps {
  level: UserSkillLevel;
}

export function SkillLevelCard({ level }: SkillLevelCardProps) {
  const navigate = useNavigate();
  const currentDef = getSkillTier(level.skill, level.currentTier);
  const isCloseToTierUp = level.progressWithinTier >= 75;
  const isMaxTier = !level.nextTier;

  const statusColor = isMaxTier
    ? 'text-green-500'
    : isCloseToTierUp
      ? 'text-amber-500'
      : 'text-muted-foreground';

  const barColor = isMaxTier
    ? 'bg-green-500'
    : isCloseToTierUp
      ? 'bg-amber-500'
      : 'bg-primary';

  const handleCTA = () => {
    navigate('/learn/skill-builder', {
      state: { skill: level.skill, duration: 30 },
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            {SKILL_LABELS[level.skill]}
          </p>
          <Badge
            variant="secondary"
            className="text-[10px] font-medium px-1.5 py-0"
          >
            Tier {level.currentTier} — {level.currentTierName}
          </Badge>
        </div>
      </div>

      {/* Micro-level sub-progress */}
      {!isMaxTier && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Level {level.levelWithinTier} / {level.maxLevelWithinTier} in this tier
            </p>
            <p className="text-[11px] text-muted-foreground">
              Overall: {level.overallLevel} / 30
            </p>
          </div>
        </div>
      )}

      {/* Progress bar to next tier */}
      {!isMaxTier && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Progress to Tier {level.currentTier + 1}
            </p>
            <p className={cn('text-[11px] font-medium', statusColor)}>
              {level.progressWithinTier}%
            </p>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', barColor)}
              style={{ width: `${level.progressWithinTier}%` }}
            />
          </div>
        </div>
      )}

      {isMaxTier && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-green-500/5 border border-green-500/15">
          <Sparkles className="h-3 w-3 text-green-500 shrink-0" />
          <p className="text-[11px] text-green-600 dark:text-green-400 font-medium">
            Tier 6, Level {level.levelWithinTier} — Master
          </p>
        </div>
      )}

      {/* Gaps */}
      {level.gaps.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <p className="text-[11px] font-medium text-muted-foreground">
              What's blocking you
            </p>
          </div>
          <div className="grid gap-1">
            {level.gaps.slice(0, 4).map((gap) => {
              const pct = gap.current != null
                ? Math.round((gap.current / gap.required) * 100)
                : 0;
              const gapColor = pct >= 80 ? 'text-amber-500' : 'text-destructive';
              return (
                <div
                  key={gap.metric}
                  className="flex items-center justify-between px-2 py-1 rounded bg-muted/50"
                >
                  <p className="text-[11px] text-muted-foreground capitalize">
                    {gap.metric.replace(/([A-Z])/g, ' $1').trim()}
                  </p>
                  <p className={cn('text-[11px] font-medium', gapColor)}>
                    {gap.current ?? 0} / {gap.required}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Next tier preview */}
      {level.nextTier && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-primary/5 border border-primary/10">
          <Target className="h-3 w-3 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-medium text-foreground">
              Tier {level.nextTier.tier}: {level.nextTier.name}
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {level.nextTier.description}
            </p>
          </div>
        </div>
      )}

      {/* Elite behavior */}
      {currentDef?.eliteBehavior && (
        <p className="text-[10px] text-muted-foreground italic leading-relaxed border-l-2 border-primary/20 pl-2">
          Elite: {currentDef.eliteBehavior}
        </p>
      )}

      {/* CTA */}
      {!isMaxTier && (
        <button
          onClick={handleCTA}
          className={cn(
            'w-full h-9 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors',
            isCloseToTierUp
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20'
              : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20',
          )}
        >
          {isCloseToTierUp ? (
            <>Push to Tier {level.currentTier + 1}</>
          ) : (
            <>Train This Skill</>
          )}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
