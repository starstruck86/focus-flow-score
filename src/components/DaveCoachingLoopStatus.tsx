/**
 * DaveCoachingLoopStatus — Lightweight UI panel showing closed-loop coaching state.
 *
 * Shows: current concept being coached, attempt count, verification outcome,
 * and what Dave will do next.
 *
 * Designed to be small and unobtrusive — an overlay, not a page.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, RefreshCw, BookOpen, ArrowRight, AlertTriangle } from 'lucide-react';
import type { ClosedLoopState } from '@/hooks/useClosedLoopCoaching';

interface Props {
  state: ClosedLoopState;
  compact?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  teaching: { label: 'Teaching', variant: 'secondary' },
  testing: { label: 'Testing', variant: 'default' },
  verifying: { label: 'Verifying', variant: 'outline' },
  reinforcing: { label: 'Reinforcing', variant: 'secondary' },
  completed: { label: 'Completed', variant: 'default' },
  needs_review: { label: 'Needs Review', variant: 'destructive' },
};

const OUTCOME_ICON: Record<string, React.ReactNode> = {
  strong: <CheckCircle2 className="h-4 w-4 text-primary" />,
  applied: <CheckCircle2 className="h-4 w-4 text-accent-foreground" />,
  partial: <RefreshCw className="h-4 w-4 text-muted-foreground" />,
  missed: <AlertTriangle className="h-4 w-4 text-destructive" />,
};

const NEXT_STEP_LABELS: Record<string, { icon: React.ReactNode; label: string }> = {
  retry_same_focus: { icon: <RefreshCw className="h-3 w-3" />, label: 'Retry' },
  reinforce_with_micro_coaching: { icon: <BookOpen className="h-3 w-3" />, label: 'Micro-coaching' },
  advance_to_harder_variant: { icon: <ArrowRight className="h-3 w-3" />, label: 'Escalate' },
  move_to_next_concept: { icon: <ArrowRight className="h-3 w-3" />, label: 'Next concept' },
  route_to_skill_builder: { icon: <BookOpen className="h-3 w-3" />, label: 'Skill Builder' },
  route_to_learn_review: { icon: <BookOpen className="h-3 w-3" />, label: 'Learn review' },
};

export function DaveCoachingLoopStatus({ state, compact = false }: Props) {
  const { session, verification, coaching } = state;

  if (!session) return null;

  const statusCfg = STATUS_CONFIG[session.status] || STATUS_CONFIG.testing;
  const attemptCount = session.attempts.length;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 text-xs">
        <Badge variant={statusCfg.variant} className="text-[10px] px-1.5 py-0">
          {statusCfg.label}
        </Badge>
        <span className="text-muted-foreground truncate max-w-[140px]">
          {session.subSkill || session.taughtConcept}
        </span>
        {verification && OUTCOME_ICON[verification.outcome]}
      </div>
    );
  }

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={statusCfg.variant} className="text-xs">
              {statusCfg.label}
            </Badge>
            <span className="text-sm font-medium text-foreground">
              {session.subSkill || session.taughtConcept}
            </span>
          </div>
          {attemptCount > 0 && (
            <span className="text-xs text-muted-foreground">
              Attempt {attemptCount}
            </span>
          )}
        </div>

        {/* Verification result */}
        {verification && (
          <div className="flex items-start gap-2 text-sm">
            {OUTCOME_ICON[verification.outcome]}
            <span className="text-muted-foreground leading-tight">
              {verification.summary}
            </span>
          </div>
        )}

        {/* Coaching message */}
        {coaching?.spoken && (
          <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
            {coaching.spoken}
          </p>
        )}

        {/* Next step */}
        {session.nextStep && NEXT_STEP_LABELS[session.nextStep] && (
          <div className="flex items-center gap-1.5 text-xs text-primary">
            {NEXT_STEP_LABELS[session.nextStep].icon}
            <span>Next: {NEXT_STEP_LABELS[session.nextStep].label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
