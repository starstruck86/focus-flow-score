/**
 * SubSkillProgressPanel — Shows sub-skill cards for all skills.
 * Sorted weakest-first.
 */

import type { SkillSubSkillSummary } from '@/lib/learning/learnSubSkillProgress';
import { SubSkillProgressCard } from './SubSkillProgressCard';

interface SubSkillProgressPanelProps {
  summaries: SkillSubSkillSummary[];
}

export function SubSkillProgressPanel({ summaries }: SubSkillProgressPanelProps) {
  if (!summaries || summaries.length === 0) return null;

  // Sort: most blockers first, then lowest avg score
  const sorted = [...summaries].sort((a, b) => {
    if (b.blockersForNextTier.length !== a.blockersForNextTier.length) {
      return b.blockersForNextTier.length - a.blockersForNextTier.length;
    }
    const avgA = a.subSkills.reduce((s, ss) => s + ss.score, 0) / (a.subSkills.length || 1);
    const avgB = b.subSkills.reduce((s, ss) => s + ss.score, 0) / (b.subSkills.length || 1);
    return avgA - avgB;
  });

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Sub-Skill Breakdown
      </p>
      {sorted.map(summary => (
        <SubSkillProgressCard key={summary.skill} summary={summary} />
      ))}
    </div>
  );
}
