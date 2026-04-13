/**
 * DaveActiveLoopCard — Compact card surfacing an active closed-loop coaching session.
 *
 * Shows what Dave is coaching, where the user is in the loop, and what's next.
 * Designed to be placed on Learn page, audio entry, or progress areas.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, BookOpen, RefreshCw, Target } from 'lucide-react';
import type { ClosedLoopSession } from '@/lib/daveClosedLoopEngine';

interface Props {
  session: ClosedLoopSession;
  onResume?: () => void;
  compact?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  teaching: 'Learning',
  testing: 'Practice Rep',
  verifying: 'Checking',
  reinforcing: 'Reinforcing',
  needs_review: 'Needs Work',
  completed: 'Done',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  teaching: <BookOpen className="h-4 w-4" />,
  testing: <Target className="h-4 w-4" />,
  reinforcing: <RefreshCw className="h-4 w-4" />,
  needs_review: <BookOpen className="h-4 w-4" />,
};

export function DaveActiveLoopCard({ session, onResume, compact = false }: Props) {
  const concept = session.subSkill || session.taughtConcept;
  const attemptCount = session.attempts.length;
  const statusLabel = STATUS_LABELS[session.status] || session.status;
  const icon = STATUS_ICONS[session.status] || <Target className="h-4 w-4" />;

  if (compact) {
    return (
      <button
        onClick={onResume}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/60 hover:bg-muted transition-colors text-left w-full"
      >
        {icon}
        <span className="text-sm font-medium text-foreground truncate">{concept}</span>
        <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
          {statusLabel}
        </Badge>
      </button>
    );
  }

  return (
    <Card className="border-primary/20 bg-card/90 backdrop-blur-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <p className="text-sm font-medium text-foreground">{concept}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {session.skill.replace(/_/g, ' ')}
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="text-xs">
            {statusLabel}
          </Badge>
        </div>

        {attemptCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {attemptCount} attempt{attemptCount !== 1 ? 's' : ''} so far
            {session.attempts[attemptCount - 1]?.focusApplied === true && ' — last one landed'}
            {session.attempts[attemptCount - 1]?.focusApplied === false && ' — focus not yet applied'}
          </p>
        )}

        {onResume && session.status !== 'completed' && (
          <Button
            size="sm"
            variant="outline"
            onClick={onResume}
            className="w-full text-xs"
          >
            Continue
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
