/**
 * SubSkillProgressCard — Compact sub-skill breakdown for one skill.
 * Collapsed by default, expandable for full detail.
 */

import { useState } from 'react';
import type { SkillSubSkillSummary } from '@/lib/learning/learnSubSkillProgress';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { AlertTriangle, CheckCircle2, TrendingDown, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubSkillProgressCardProps {
  summary: SkillSubSkillSummary;
}

const BAND_COLORS = {
  weak: 'bg-destructive/80',
  building: 'bg-amber-500/80',
  strong: 'bg-green-500/80',
} as const;

export function SubSkillProgressCard({ summary }: SubSkillProgressCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { skill, subSkills, strongestSubSkills, weakestSubSkills, blockersForNextTier } = summary;

  if (subSkills.length === 0) return null;

  const weakCount = subSkills.filter(s => s.progressBand === 'weak').length;
  const buildingCount = subSkills.filter(s => s.progressBand === 'building').length;
  const strongCount = subSkills.filter(s => s.progressBand === 'strong').length;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <p className="text-xs font-semibold text-foreground flex-1 truncate">
          {SKILL_LABELS[skill]}
        </p>

        {/* Summary pills */}
        <div className="flex items-center gap-1 shrink-0">
          {weakCount > 0 && (
            <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-destructive/10 text-destructive border border-destructive/20">
              {weakCount} weak
            </span>
          )}
          {buildingCount > 0 && (
            <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              {buildingCount} building
            </span>
          )}
          {strongCount > 0 && (
            <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
              {strongCount} strong
            </span>
          )}
        </div>

        {blockersForNextTier.length > 0 && (
          <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
        )}

        <ChevronDown className={cn(
          'h-3 w-3 text-muted-foreground shrink-0 transition-transform',
          expanded && 'rotate-180'
        )} />
      </button>

      {/* Strongest/Weakest chips — always visible */}
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {weakestSubSkills.slice(0, 2).map(name => (
          <span key={name} className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-px rounded-full bg-destructive/10 text-destructive font-medium">
            <TrendingDown className="h-2 w-2" />{name}
          </span>
        ))}
        {strongestSubSkills.slice(0, 1).map(name => (
          <span key={name} className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-px rounded-full bg-green-500/10 text-green-600 dark:text-green-400 font-medium">
            <CheckCircle2 className="h-2 w-2" />{name}
          </span>
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/50 pt-2">
          {blockersForNextTier.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">Blocking: </span>
              {blockersForNextTier.join(', ')}
            </p>
          )}
          {subSkills.map(ss => (
            <div key={ss.subSkill} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-24 truncate shrink-0">{ss.subSkill}</span>
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full', BAND_COLORS[ss.progressBand])}
                  style={{ width: `${ss.score}%` }}
                />
              </div>
              <span className="text-[9px] font-mono w-5 text-right text-muted-foreground">{ss.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
