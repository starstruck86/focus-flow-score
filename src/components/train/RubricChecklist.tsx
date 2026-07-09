import { Check, X, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface RubricCriterion {
  c: string;
  must?: boolean;
}

export interface RubricEvaluation {
  c: string;
  met: boolean;
  note?: string;
}

interface Props {
  rubric: RubricCriterion[];
  /** When provided, renders pass/fail per line (matched by index or exact `c` text). */
  results?: RubricEvaluation[];
  title?: string;
  compact?: boolean;
}

/**
 * Renders the drill rubric as a visible checklist.
 * - Pre-attempt: `results` is undefined → shows a neutral checklist ("What a passing answer contains").
 * - Post-attempt: pass/fail badge per line, with optional grader note.
 */
export function RubricChecklist({ rubric, results, title, compact }: Props) {
  if (!rubric || rubric.length === 0) return null;

  const evalFor = (line: RubricCriterion, idx: number): RubricEvaluation | undefined => {
    if (!results) return undefined;
    // Prefer exact-c match; fall back to positional match.
    return results.find((r) => r.c === line.c) ?? results[idx];
  };

  const passCount = results ? results.filter((r) => r.met).length : 0;

  return (
    <div className={cn(
      'rounded-md border bg-card',
      results
        ? 'border-border'
        : 'border-primary/25 bg-primary/5',
      compact ? 'p-3' : 'p-4',
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
          {title ?? (results ? 'How you scored against the bar' : 'What a passing answer contains')}
        </div>
        {results && (
          <Badge variant="outline" className="text-[10px] tabular-nums">
            {passCount}/{results.length} met
          </Badge>
        )}
      </div>
      <ul className="space-y-1.5">
        {rubric.map((line, idx) => {
          const ev = evalFor(line, idx);
          const state: 'neutral' | 'pass' | 'fail' = !ev ? 'neutral' : ev.met ? 'pass' : 'fail';
          return (
            <li key={idx} className="flex items-start gap-2 text-sm">
              <span
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 rounded-full flex items-center justify-center',
                  state === 'pass' && 'bg-green-500/15 text-green-600 dark:text-green-400',
                  state === 'fail' && 'bg-destructive/15 text-destructive',
                  state === 'neutral' && 'text-muted-foreground',
                )}
              >
                {state === 'pass' ? <Check className="h-3 w-3" /> :
                 state === 'fail' ? <X className="h-3 w-3" /> :
                 <Circle className="h-3 w-3" />}
              </span>
              <div className="flex-1 min-w-0">
                <span className={cn(
                  'leading-snug',
                  state === 'fail' && 'text-foreground',
                  state === 'neutral' && 'text-foreground',
                )}>
                  {line.c}
                </span>
                {line.must ? (
                  <Badge
                    variant="outline"
                    className="ml-1.5 text-[9px] uppercase tracking-wider border-amber-500/40 text-amber-600 dark:text-amber-400 px-1 py-0"
                  >
                    required
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="ml-1.5 text-[9px] uppercase tracking-wider border-muted-foreground/30 text-muted-foreground px-1 py-0"
                  >
                    strengthens
                  </Badge>
                )}
                {ev?.note && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {ev.note}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
