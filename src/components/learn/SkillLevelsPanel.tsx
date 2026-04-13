/**
 * SkillLevelsPanel — Displays all skill levels together, sorted by weakest first.
 */

import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { SkillLevelCard } from './SkillLevelCard';
import { TrendingUp } from 'lucide-react';

interface SkillLevelsPanelProps {
  levels: UserSkillLevel[];
}

export function SkillLevelsPanel({ levels }: SkillLevelsPanelProps) {
  if (levels.length === 0) return null;

  // Sort: lowest level first, then lowest progress first
  const sorted = [...levels].sort((a, b) => {
    if (a.currentLevel !== b.currentLevel) return a.currentLevel - b.currentLevel;
    return a.progressToNext - b.progressToNext;
  });

  const weakest = sorted[0];
  const closestToLevelUp = [...levels]
    .filter(l => l.nextLevel && l.progressToNext >= 60)
    .sort((a, b) => b.progressToNext - a.progressToNext)[0];

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
      {(weakest || closestToLevelUp) && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {weakest && weakest.currentLevel <= 2 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/5 border border-destructive/15 shrink-0">
              <div className="h-1.5 w-1.5 rounded-full bg-destructive" />
              <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                <span className="font-medium text-foreground">Weakest:</span>{' '}
                {weakest.currentLevelName}
              </p>
            </div>
          )}
          {closestToLevelUp && closestToLevelUp !== weakest && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/5 border border-amber-500/15 shrink-0">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                <span className="font-medium text-foreground">Almost there:</span>{' '}
                {closestToLevelUp.currentLevelName} → Lv{closestToLevelUp.currentLevel + 1}
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
