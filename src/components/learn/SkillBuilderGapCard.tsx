/**
 * Skill Builder Gap Card — Shows highest priority missing patterns
 */

import { AlertTriangle, Shield, Users, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { GapMapResult } from '@/lib/learning/skillBuilderGapMap';

interface Props {
  gaps: GapMapResult;
}

export function SkillBuilderGapCard({ gaps }: Props) {
  const topPatternGaps = gaps.patternGaps.slice(0, 8);
  const topSkillGaps = gaps.skillGaps.slice(0, 5);

  if (topPatternGaps.length === 0 && topSkillGaps.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">No critical gaps detected.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <p className="text-sm font-semibold text-foreground">Gap Map — What to Fix Next</p>

      {/* Pattern gaps */}
      {topPatternGaps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Pattern Gaps</p>
          {topPatternGaps.map((g, i) => (
            <div key={i} className="flex items-start gap-2 py-1 border-b border-border/50 last:border-0">
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[10px] font-medium text-foreground">
                    {g.focusPattern.replace(/_/g, ' ')}
                  </p>
                  <Badge variant="outline" className="text-[8px] capitalize">
                    {g.skill.replace(/_/g, ' ')}
                  </Badge>
                  {g.needsPressureVariants && (
                    <span className="inline-flex items-center gap-0.5 text-[8px] text-amber-600">
                      <Shield className="h-2.5 w-2.5" /> pressure
                    </span>
                  )}
                  {g.needsMultiThreadVariants && (
                    <span className="inline-flex items-center gap-0.5 text-[8px] text-amber-600">
                      <Users className="h-2.5 w-2.5" /> multi-thread
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{g.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Skill gaps */}
      {topSkillGaps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Skill Gaps</p>
          {topSkillGaps.map((g, i) => (
            <div key={i} className="flex items-start gap-2 py-1">
              <Target className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-foreground capitalize">
                  {g.skill.replace(/_/g, ' ')} — Level {g.level}
                </p>
                <p className="text-[10px] text-muted-foreground">{g.reason}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {g.missingPatterns.map(p => (
                    <Badge key={p} variant="outline" className="text-[8px] border-destructive/40 text-destructive">
                      {p.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
