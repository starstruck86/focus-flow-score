/**
 * MicroDrillResultCard — compact evaluation shown after micro-drill submission.
 * Displays score, strength, miss, better version, and readiness signal.
 */

import { CheckCircle2, XCircle, Lightbulb, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface MicroDrillResult {
  score: number;
  strength: string;
  miss: string;
  betterVersion: string;
  ready: boolean;
  coachingCue: string;
}

interface Props {
  result: MicroDrillResult;
  isLoading?: boolean;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30' :
    score >= 6 ? 'bg-primary/15 text-primary border-primary/30' :
    'bg-destructive/15 text-destructive border-destructive/30';

  const label =
    score >= 8 ? 'Strong' :
    score >= 6 ? 'Solid' :
    score >= 4 ? 'Developing' : 'Needs Work';

  return (
    <div className="flex items-center gap-2">
      <span className={cn('text-2xl font-bold tabular-nums', score >= 6 ? 'text-primary' : 'text-destructive')}>
        {score}
      </span>
      <span className="text-lg text-muted-foreground">/10</span>
      <Badge variant="outline" className={cn('text-[10px] ml-1', color)}>
        {label}
      </Badge>
    </div>
  );
}

export function MicroDrillResultCard({ result, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-primary/20 bg-card p-4 flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Evaluating your response…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* Score */}
      <div className="flex items-center justify-between">
        <ScoreBadge score={result.score} />
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            result.ready
              ? 'border-green-500/30 text-green-600 dark:text-green-400'
              : 'border-amber-500/30 text-amber-600 dark:text-amber-400'
          )}
        >
          {result.ready ? '✓ Ready for practice' : '↻ Try revising'}
        </Badge>
      </div>

      {/* Strength */}
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
        <p className="text-sm text-foreground leading-relaxed">{result.strength}</p>
      </div>

      {/* Miss */}
      <div className="flex items-start gap-2">
        <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        <p className="text-sm text-foreground leading-relaxed">{result.miss}</p>
      </div>

      {/* Better version */}
      <div className="rounded-md bg-primary/5 border border-primary/10 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3 w-3 text-primary" />
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Better version
          </p>
        </div>
        <p className="text-sm text-foreground italic leading-relaxed">
          "{result.betterVersion}"
        </p>
      </div>

      {/* Coaching cue */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Next rep goal:</span> {result.coachingCue}
      </p>
    </div>
  );
}
