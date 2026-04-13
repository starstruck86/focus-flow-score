/**
 * SubSkillProgressCard — Shows sub-skill breakdown for one skill.
 */

import type { SkillSubSkillSummary } from '@/lib/learning/learnSubSkillProgress';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { AlertTriangle, CheckCircle2, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubSkillProgressCardProps {
  summary: SkillSubSkillSummary;
}

const BAND_STYLES = {
  weak: { bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/20', label: 'Weak' },
  building: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', label: 'Building' },
  strong: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/20', label: 'Strong' },
} as const;

const BAND_BAR = {
  weak: 'bg-destructive',
  building: 'bg-amber-500',
  strong: 'bg-green-500',
} as const;

export function SubSkillProgressCard({ summary }: SubSkillProgressCardProps) {
  const { skill, subSkills, strongestSubSkills, weakestSubSkills, blockersForNextTier } = summary;

  if (subSkills.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      {/* Header */}
      <div className="space-y-0.5">
        <p className="text-xs font-semibold text-foreground">
          {SKILL_LABELS[skill]} — Sub-Skills
        </p>
        <p className="text-[11px] text-muted-foreground">What's driving your progress</p>
      </div>

      {/* Strongest / Weakest chips */}
      <div className="flex flex-wrap gap-1.5">
        {strongestSubSkills.slice(0, 2).map(name => (
          <span
            key={name}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 font-medium"
          >
            <CheckCircle2 className="h-2.5 w-2.5" />
            {name}
          </span>
        ))}
        {weakestSubSkills.slice(0, 2).map(name => (
          <span
            key={name}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 border border-destructive/20 text-destructive font-medium"
          >
            <TrendingDown className="h-2.5 w-2.5" />
            {name}
          </span>
        ))}
      </div>

      {/* Blockers */}
      {blockersForNextTier.length > 0 && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="font-medium text-foreground">Blocking next tier: </span>
            {blockersForNextTier.join(', ')}
          </p>
        </div>
      )}

      {/* Sub-skill rows */}
      <div className="space-y-2">
        {subSkills.map(ss => {
          const style = BAND_STYLES[ss.progressBand];
          return (
            <div key={ss.subSkill} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] font-medium text-foreground">{ss.subSkill}</p>
                  <span className={cn(
                    'text-[9px] px-1 py-px rounded font-medium border',
                    style.bg, style.text, style.border,
                  )}>
                    {style.label}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground tabular-nums">{ss.score}</p>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', BAND_BAR[ss.progressBand])}
                  style={{ width: `${ss.score}%` }}
                />
              </div>
              {ss.pressureScore != null && (
                <p className="text-[9px] text-muted-foreground">
                  Under pressure: {ss.pressureScore}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
