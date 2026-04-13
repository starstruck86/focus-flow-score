/**
 * DaveLoopCompletionToast — Concise celebration when a coaching loop resolves.
 *
 * Shows what was mastered and optionally what unlocks next.
 * Not a modal — just an informative toast-style card.
 */

import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  concept: string;
  skill: string;
  attempts: number;
  nextConcept?: string;
  onContinue?: () => void;
  onDismiss?: () => void;
}

export function DaveLoopCompletionCard({
  concept,
  skill,
  attempts,
  nextConcept,
  onContinue,
  onDismiss,
}: Props) {
  return (
    <Card className="border-primary/30 bg-primary/5 backdrop-blur-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {concept} — locked in
            </p>
            <p className="text-xs text-muted-foreground">
              {attempts === 1
                ? 'Nailed it on the first try.'
                : `Took ${attempts} attempts to get here. Well earned.`}
            </p>
            {nextConcept && (
              <p className="text-xs text-primary">
                Next up: {nextConcept}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {nextConcept && onContinue && (
            <Button size="sm" variant="default" onClick={onContinue} className="flex-1 text-xs">
              Continue
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss} className="text-xs">
              Done for now
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
