/**
 * ResumeLaneBanner — Prominent banner on Dojo hub when an active lane exists.
 * Shows lane name, rep count, avg score, and a one-tap resume.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight, Flame, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DAY_ANCHORS, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import { loadActiveLane, clearActiveLane } from '@/lib/sessionDurability';

export function ResumeLaneBanner() {
  const navigate = useNavigate();
  const lane = loadActiveLane();

  if (!lane || lane.repsThisSession === 0) return null;

  const def = DAY_ANCHORS[lane.anchor as DayAnchor];
  const avg = lane.recentScores.length > 0
    ? Math.round(lane.recentScores.reduce((a, b) => a + b, 0) / lane.recentScores.length)
    : null;

  // Score trend
  const improving = lane.recentScores.length >= 2 && lane.recentScores[0] > lane.recentScores[1];

  const handleResume = () => {
    navigate('/dojo/session', {
      state: {
        skillFocus: lane.skillFocus,
        laneAnchor: lane.anchor,
        laneLabel: lane.label,
      },
    });
  };

  const handleDismiss = () => {
    clearActiveLane();
    // Force re-render by navigating to same page
    navigate('/dojo', { replace: true });
  };

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-r from-primary/5 via-card to-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          <p className="text-sm font-bold text-foreground">
            {def?.shortLabel ?? lane.label} Lane Active
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          End Lane
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{lane.repsThisSession} reps completed</span>
        {avg !== null && (
          <>
            <span>·</span>
            <span className="tabular-nums">Avg score: {avg}</span>
            {improving && <TrendingUp className="h-3 w-3 text-green-500" />}
          </>
        )}
      </div>
      <Button onClick={handleResume} className="w-full gap-2" size="sm">
        <ArrowRight className="h-4 w-4" />
        Continue {def?.shortLabel ?? lane.label}
      </Button>
    </div>
  );
}
