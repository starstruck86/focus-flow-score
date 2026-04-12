/**
 * "Replay That Moment" Card — Phase 2
 *
 * Surfaces when the user missed the KI or scored low.
 * Offers a one-tap replay to immediately fix the last mistake.
 */

import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { RotateCcw, ArrowRight } from 'lucide-react';
import type { LastRepInsight } from '@/lib/learning/learnEngine';

interface Props {
  lastRep: LastRepInsight;
}

const MISTAKE_OBJECTIONS: Record<string, string> = {
  pitched_too_early: "We're not really looking at new tools right now.",
  weak_objection_handle: "I'm not sure this is the right fit for us.",
  reactive_not_reframing: "That sounds like what we already have.",
  no_discovery: "Just walk me through the product.",
  surface_level_questions: "We need better reporting.",
  didnt_follow_up: "Yeah, it's been a challenge.",
  lost_control: "Can you just send me some materials?",
  no_next_step: "This was really helpful, thanks.",
  vague_commitment: "Let's circle back next quarter.",
  too_generic: "We're evaluating a few options.",
  filler_heavy: "Tell me about your solution.",
  talked_past_the_close: "Sounds great, let's do it.",
};

export function ReplayMomentCard({ lastRep }: Props) {
  const navigate = useNavigate();

  // Only render if KI was missed or score was low
  const shouldShow = lastRep.focusApplied === 'no' || lastRep.score < 60;
  if (!shouldShow) return null;

  const objection = lastRep.topMistake
    ? MISTAKE_OBJECTIONS[lastRep.topMistake] ?? "I'm not sure about this."
    : "I'm not sure about this.";

  const handleReplay = () => {
    navigate('/dojo/session', {
      state: {
        scenario: {
          skillFocus: 'objection_handling',
          context: 'Replay from your last rep — fix this specific moment.',
          objection,
        },
        mode: 'autopilot',
        fromLearn: true,
      },
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Replay That Moment
        </p>
      </div>

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">
            You missed this moment:
          </p>

          {lastRep.topMistakeLabel && (
            <div className="bg-background/60 rounded-md p-3">
              <p className="text-xs text-foreground font-medium">
                {lastRep.topMistakeLabel}
              </p>
            </div>
          )}

          <button
            onClick={handleReplay}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-md bg-amber-500 text-white text-sm font-medium hover:bg-amber-500/85 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Fix This Now
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
