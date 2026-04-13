/**
 * Skill Builder Session Summary Card
 *
 * Post-session summary showing reps completed, avg score,
 * weakest/strongest patterns. Updates existing engines.
 */

import { Badge } from '@/components/ui/badge';
import { CheckCircle2, TrendingUp, TrendingDown, Target } from 'lucide-react';
import { FOCUS_PATTERN_LABELS } from '@/lib/dojo/focusPatterns';

export interface SkillBuilderSummary {
  repsCompleted: number;
  avgScore: number | null;
  weakestPattern: string | null;
  strongestPattern: string | null;
  skill: string;
  level: number;
}

interface Props {
  summary: SkillBuilderSummary;
}

export function SkillBuilderSummaryCard({ summary }: Props) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <p className="text-sm font-medium">Last Skill Builder</p>
        <Badge variant="outline" className="text-[10px] ml-auto">
          Level {summary.level}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/50">
          <Target className="h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground">{summary.repsCompleted}</span> reps
          </p>
        </div>
        {summary.avgScore != null && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/50">
            <Target className="h-3 w-3 text-muted-foreground shrink-0" />
            <p className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">{Math.round(summary.avgScore)}</span> avg
            </p>
          </div>
        )}
        {summary.strongestPattern && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-green-500/5 border border-green-500/15">
            <TrendingUp className="h-3 w-3 text-green-500 shrink-0" />
            <p className="text-[10px] text-muted-foreground truncate">
              {FOCUS_PATTERN_LABELS[summary.strongestPattern] ?? summary.strongestPattern.replace(/_/g, ' ')}
            </p>
          </div>
        )}
        {summary.weakestPattern && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-red-500/5 border border-red-500/15">
            <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />
            <p className="text-[10px] text-muted-foreground truncate">
              {FOCUS_PATTERN_LABELS[summary.weakestPattern] ?? summary.weakestPattern.replace(/_/g, ' ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
