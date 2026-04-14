/**
 * DimensionFeedbackCard — Post-rep feedback showing which scoring
 * dimensions were strong vs weak, with specific improvement cues.
 */

import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Target } from 'lucide-react';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import { analyzeDimensionScores, getDimensionLabel } from '@/lib/learning/skillScenarioSelector';

interface Props {
  dimensions: Record<string, number> | null | undefined;
  skill: SkillFocus;
}

export function DimensionFeedbackCard({ dimensions, skill }: Props) {
  const analysis = analyzeDimensionScores(dimensions, skill);

  if (!dimensions || Object.keys(dimensions).length === 0) return null;

  const entries = Object.entries(dimensions).sort(([, a], [, b]) => a - b);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs font-semibold text-foreground">Dimension Breakdown</p>
      </div>

      {/* Dimension bars */}
      <div className="space-y-1.5">
        {entries.map(([key, score]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-28 shrink-0 truncate">
              {getDimensionLabel(key)}
            </span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  score >= 7 ? 'bg-green-500' : score >= 5 ? 'bg-amber-500' : 'bg-destructive'
                }`}
                style={{ width: `${score * 10}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono w-5 text-right ${
              score >= 7 ? 'text-green-500' : score >= 5 ? 'text-amber-500' : 'text-destructive'
            }`}>
              {score}
            </span>
          </div>
        ))}
      </div>

      {/* Strongest / Weakest */}
      <div className="flex gap-2">
        {analysis.strongest && (
          <div className="flex-1 rounded-md bg-green-500/5 border border-green-500/15 p-2">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span className="text-[9px] font-bold text-green-600 dark:text-green-400 uppercase">Strongest</span>
            </div>
            <p className="text-[10px] text-foreground">{analysis.strongest.label}</p>
          </div>
        )}
        {analysis.weakest && (
          <div className="flex-1 rounded-md bg-destructive/5 border border-destructive/15 p-2">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingDown className="h-3 w-3 text-destructive" />
              <span className="text-[9px] font-bold text-destructive uppercase">Weakest</span>
            </div>
            <p className="text-[10px] text-foreground">{analysis.weakest.label}</p>
          </div>
        )}
      </div>

      {/* Next focus */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {analysis.nextFocus}
      </p>
    </div>
  );
}
