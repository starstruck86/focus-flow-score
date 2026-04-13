/**
 * SkillLevelsPanel — Displays all skill tiers together, sorted by weakest first.
 */

import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { SkillLevelCard } from './SkillLevelCard';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { TrendingUp } from 'lucide-react';

interface SkillLevelsPanelProps {
  levels: UserSkillLevel[];
}

export function SkillLevelsPanel({ levels }: SkillLevelsPanelProps) {
  if (levels.length === 0) return null;

  // Sort: lowest tier first, then lowest progress first
  const sorted = [...levels].sort((a, b) => {
    if (a.currentTier !== b.currentTier) return a.currentTier - b.currentTier;
    return a.progressWithinTier - b.progressWithinTier;
  });

  const weakest = sorted[0];
  const closestToTierUp = [...levels]
    .filter(l => l.nextTier && l.progressWithinTier >= 60)
    .sort((a, b) => b.progressWithinTier - a.progressWithinTier)[0];

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Skill Progression
        </p>
      </div>

      {/* Highlights */}
      {(weakest || closestToTierUp) && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {weakest && weakest.currentTier <= 2 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/5 border border-destructive/15 shrink-0">
              <div className="h-1.5 w-1.5 rounded-full bg-destructive" />
              <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                <span className="font-medium text-foreground">Weakest:</span>{' '}
                {SKILL_LABELS[weakest.skill]} — Tier {weakest.currentTier}
              </p>
            </div>
          )}
          {closestToTierUp && closestToTierUp !== weakest && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/5 border border-amber-500/15 shrink-0">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                <span className="font-medium text-foreground">Almost there:</span>{' '}
                {SKILL_LABELS[closestToTierUp.skill]} → Tier {closestToTierUp.currentTier + 1}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {sorted.map(level => (
          <SkillLevelCard key={level.skill} level={level} />
        ))}
      </div>
    </div>
  );
}
