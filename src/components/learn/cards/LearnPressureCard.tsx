/**
 * LearnPressureCard — "Prepare for Friday" card.
 * Routes to scenario-based prep instead of doing nothing.
 */

import { useNavigate } from 'react-router-dom';
import { Flame, AlertTriangle, Shield, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { FridayReadiness } from '@/lib/learning/learnWeeklyEngine';

interface Props {
  readiness: FridayReadiness;
}

export function LearnPressureCard({ readiness }: Props) {
  const navigate = useNavigate();

  if (!readiness.expected) return null;

  const handlePrepare = () => {
    navigate('/dojo/session', {
      state: {
        skillSession: {
          skillId: 'objection_handling',
          skillName: 'Friday Pressure Prep',
          currentTier: 0,
          currentLevel: 0,
          targetTier: 0,
          scenarioType: 'advanced' as const,
        },
        skillFocus: 'objection_handling',
        pressurePrep: true,
        fridayReadiness: readiness,
        pressureLevel: 'high',
        pressureDimensions: [
          readiness.pressureExpected ? 'time_pressure' : '',
          readiness.multiThreadLikely ? 'multi_thread' : '',
          'executive_scrutiny',
        ].filter(Boolean),
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
            <p className="text-[11px] text-muted-foreground">High-pressure simulation day</p>
          </div>
        </div>
      </div>

      {/* Expectations */}
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

      {/* Why */}
      <p className="text-xs text-foreground leading-relaxed">{readiness.whyItMatters}</p>

      {/* Risk */}
      {readiness.primaryRisk && (
        <div className="flex gap-2 px-2.5 py-2 rounded-md bg-destructive/5 border border-destructive/15">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-foreground leading-relaxed">
            <span className="font-semibold">Risk:</span> {readiness.primaryRisk}
          </p>
        </div>
      )}

      {/* Prep focus */}
      <div className="flex gap-2 px-2.5 py-2 rounded-md bg-primary/5 border border-primary/10">
        <Shield className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-foreground leading-relaxed">
          <span className="font-semibold">Focus:</span> {readiness.prepFocus}
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
