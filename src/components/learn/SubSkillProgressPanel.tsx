/**
 * SubSkillProgressPanel — Compact grid of sub-skill cards.
 * Sorted weakest-first, side-by-side on desktop.
 */

import type { SkillSubSkillSummary } from '@/lib/learning/learnSubSkillProgress';
import { SubSkillProgressCard } from './SubSkillProgressCard';

interface SubSkillProgressPanelProps {
  summaries: SkillSubSkillSummary[];
}

export function SubSkillProgressPanel({ summaries }: SubSkillProgressPanelProps) {
  if (!summaries || summaries.length === 0) return null;

  const sorted = [...summaries].sort((a, b) => {
    if (b.blockersForNextTier.length !== a.blockersForNextTier.length) {
      return b.blockersForNextTier.length - a.blockersForNextTier.length;
    }
    const avgA = a.subSkills.reduce((s, ss) => s + ss.score, 0) / (a.subSkills.length || 1);
    const avgB = b.subSkills.reduce((s, ss) => s + ss.score, 0) / (b.subSkills.length || 1);
    return avgA - avgB;
  });

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Sub-Skill Breakdown
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sorted.map(summary => (
          <SubSkillProgressCard key={summary.skill} summary={summary} />
        ))}
      </div>
    </div>
  );
}
