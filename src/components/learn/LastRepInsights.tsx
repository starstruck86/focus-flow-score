/**
 * Last Rep Insights
 *
 * Shows what happened in the user's most recent Dojo session:
 * applied KI, missed KI, and specific correction.
 */

import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import type { LastRepInsight } from '@/lib/learning/learnEngine';

interface Props {
  insight: LastRepInsight;
}

export function LastRepInsights({ insight }: Props) {
  const isSuccess = insight.focusApplied === 'yes';
  const isPartial = insight.focusApplied === 'partial';

  // Relative time
  const ago = getRelativeTime(insight.completedAt);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          From Your Last Rep
        </p>
        <span className="text-[10px] text-muted-foreground ml-auto">{ago}</span>
      </div>

      <Card className={isSuccess ? 'border-green-500/20 bg-green-500/5' : 'border-amber-500/20 bg-amber-500/5'}>
        <CardContent className="p-3 space-y-2">
          {isSuccess ? (
            <div className="flex gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {insight.kiTitle ? `You applied "${insight.kiTitle}".` : 'Focus was applied.'} Lock it in.
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Score: {insight.score}</p>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <XCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">
                  {insight.kiTitle
                    ? `You missed "${insight.kiTitle}". Here's what to fix:`
                    : 'Focus wasn\'t applied. Here\'s what to fix:'}
                </p>
                {insight.topMistakeLabel && (
                  <p className="text-xs text-foreground">
                    <span className="font-medium">Mistake:</span> {insight.topMistakeLabel}
                  </p>
                )}
                {insight.feedback && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {insight.feedback}
                  </p>
                )}
                {isPartial && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Partially applied — close, but not locked in yet.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getRelativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
