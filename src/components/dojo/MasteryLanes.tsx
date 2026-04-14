/**
 * MasteryLanes — Explicit lane entry cards on the Dojo hub.
 * Lets users intentionally choose a mastery lane like Cold Calling.
 */

import { useNavigate } from 'react-router-dom';
import { Phone, Search, Shield, Target, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DAY_ANCHORS, ANCHORS_IN_ORDER, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import { saveActiveLane, type ActiveLane } from '@/lib/sessionDurability';

const LANE_ICONS: Record<DayAnchor, React.ElementType> = {
  opening_cold_call: Phone,
  discovery_qualification: Search,
  objection_pricing: Shield,
  deal_control_negotiation: Target,
  executive_roi_mixed: Briefcase,
};

interface MasteryLanesProps {
  todayAnchor: DayAnchor | null;
}

export function MasteryLanes({ todayAnchor }: MasteryLanesProps) {
  const navigate = useNavigate();

  const startLane = (anchor: DayAnchor) => {
    const def = DAY_ANCHORS[anchor];
    const lane: ActiveLane = {
      anchor,
      label: def.shortLabel,
      skillFocus: def.primarySkills[0],
      repsThisSession: 0,
      recentScores: [],
      startedAt: Date.now(),
      lastRepAt: Date.now(),
    };
    saveActiveLane(lane);
    navigate('/dojo/session', {
      state: {
        skillFocus: def.primarySkills[0],
        laneAnchor: anchor,
        laneLabel: def.shortLabel,
      },
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Mastery Lanes
      </p>
      <div className="grid grid-cols-2 gap-2">
        {ANCHORS_IN_ORDER.map(anchor => {
          const def = DAY_ANCHORS[anchor];
          const Icon = LANE_ICONS[anchor];
          const isToday = anchor === todayAnchor;
          return (
            <button
              key={anchor}
              onClick={() => startLane(anchor)}
              className={cn(
                'flex items-center gap-2.5 p-3 rounded-lg border transition-colors text-left',
                isToday
                  ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
                  : 'border-border/60 bg-card hover:bg-accent/50',
              )}
            >
              <div className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
                isToday ? 'bg-primary/15' : 'bg-muted',
              )}>
                <Icon className={cn('h-4 w-4', isToday ? 'text-primary' : 'text-muted-foreground')} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{def.shortLabel}</p>
                <p className="text-[10px] text-muted-foreground">
                  {def.subSkills.length} sub-skills
                  {isToday && <span className="text-primary font-medium ml-1">· Today</span>}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
