/**
 * LearnFocusCard — Highest-priority card on the Learn page.
 * Shows the single most important skill to train right now.
 */

import { useNavigate } from 'react-router-dom';
import { Target, Zap, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { buildSkillSession, skillSessionToParams } from '@/lib/learning/skillSession';

interface Props {
  level: UserSkillLevel;
  insight?: string | null;
}

export function LearnFocusCard({ level, insight }: Props) {
  const navigate = useNavigate();
  const label = SKILL_LABELS[level.skill];
  const session = buildSkillSession(level, label);

  const handleTrain = () => {
    navigate(`/learn/skill-builder?${skillSessionToParams(session)}`, {
      state: { skillSession: session },
    });
  };

  const handlePractice = () => {
    navigate(`/dojo/session?${skillSessionToParams(session)}`, {
      state: { skillSession: session, skillFocus: session.skillId },
    });
  };

  const topGap = level.gaps[0];
  const blocker = level.blockers[0];

  return (
    <div className="col-span-full rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-5 space-y-4 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-base font-bold text-foreground">Focus: {label}</p>
            <p className="text-xs text-muted-foreground">
              Tier {level.currentTier} — {level.currentTierName} · Level {level.overallLevel}/30
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
          Priority
        </Badge>
      </div>

      {/* Why it matters */}
      {blocker && (
        <p className="text-sm text-foreground leading-relaxed">
          <span className="font-semibold text-primary">Why:</span> {blocker}
        </p>
      )}

      {/* Key insight */}
      {insight && (
        <div className="rounded-lg bg-muted/50 px-3 py-2.5 border border-border">
          <p className="text-xs text-foreground leading-relaxed italic">{insight}</p>
        </div>
      )}

      {/* Gap highlight */}
      {topGap && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/5 border border-destructive/15">
          <div className="h-2 w-2 rounded-full bg-destructive shrink-0" />
          <p className="text-xs text-foreground">
            <span className="font-medium capitalize">{topGap.label}</span>
            {topGap.current != null && (
              <span className="text-muted-foreground ml-1">
                — {topGap.current}/{topGap.required}
              </span>
            )}
          </p>
        </div>
      )}

      {/* CTAs */}
      <div className="flex gap-2">
        <Button onClick={handleTrain} className="flex-1 gap-1.5" size="default">
          <Zap className="h-4 w-4" />
          Train Skill
        </Button>
        <Button onClick={handlePractice} variant="outline" className="flex-1 gap-1.5" size="default">
          <Swords className="h-4 w-4" />
          Practice
        </Button>
      </div>
    </div>
  );
}
