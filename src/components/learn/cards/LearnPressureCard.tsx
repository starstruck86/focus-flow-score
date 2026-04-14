/**
 * LearnPressureCard — Intelligent Friday Prep card.
 * Dynamically selects the most at-risk skill instead of hardcoding.
 */

import { useNavigate } from 'react-router-dom';
import { Flame, AlertTriangle, Shield, ArrowRight, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { FridayReadiness } from '@/lib/learning/learnWeeklyEngine';
import { useSkillLevels } from '@/hooks/useSkillLevels';
import { selectFridayPrepSkill } from '@/lib/learning/intelligentFridayPrep';

interface Props {
  readiness: FridayReadiness;
}

export function LearnPressureCard({ readiness }: Props) {
  const navigate = useNavigate();
  const { data: skillLevels } = useSkillLevels();

  if (!readiness.expected) return null;

  const prep = selectFridayPrepSkill(skillLevels);

  const handlePrepare = () => {
    navigate('/dojo/session', {
      state: {
        skillSession: prep.session,
        skillFocus: prep.skill,
        pressurePrep: true,
        fridayReadiness: readiness,
        pressureLevel: 'high',
        pressureDimensions: prep.pressureDimensions,
      },
    });
  };

  return (
    <div className="rounded-xl border border-orange-500/20 bg-gradient-to-br from-orange-500/5 via-card to-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-orange-500/15 flex items-center justify-center">
            <Flame className="h-4.5 w-4.5 text-orange-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Prepare for Friday</p>
            <p className="text-[11px] text-muted-foreground">Pressure skill: {prep.skillName}</p>
          </div>
        </div>
      </div>

      {/* Why this skill */}
      <div className="flex gap-2 px-2.5 py-2 rounded-md bg-orange-500/5 border border-orange-500/15">
        <Target className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" />
        <p className="text-xs text-foreground leading-relaxed">
          <span className="font-semibold">Why:</span> {prep.reason}
        </p>
      </div>

      {/* What will be tested */}
      <p className="text-xs text-muted-foreground leading-relaxed">{prep.whatWillBeTested}</p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {readiness.pressureExpected && (
          <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-600 dark:text-orange-400">
            Pressure
          </Badge>
        )}
        {readiness.simulationExpected && (
          <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">
            Simulation
          </Badge>
        )}
        {readiness.multiThreadLikely && (
          <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-600 dark:text-violet-400">
            Multi-Thread
          </Badge>
        )}
      </div>

      {/* What ready looks like */}
      <div className="flex gap-2 px-2.5 py-2 rounded-md bg-primary/5 border border-primary/10">
        <Shield className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-foreground leading-relaxed">
          <span className="font-semibold">Ready =</span> {prep.whatReadyLooksLike}
        </p>
      </div>

      {/* CTA */}
      <Button onClick={handlePrepare} className="w-full gap-1.5" variant="default">
        <Flame className="h-4 w-4" />
        Prepare Now
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
