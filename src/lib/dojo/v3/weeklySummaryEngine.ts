/**
 * V3 Weekly Summary Engine
 *
 * Computes weekly progress summary from real assignment and session data.
 */

import { supabase } from '@/integrations/supabase/client';
import { ANCHORS_IN_ORDER, DAY_ANCHORS, type DayAnchor } from './dayAnchors';

// ── Types ──────────────────────────────────────────────────────────

export interface WeeklySummary {
  weekNumber: number;
  blockId: string;
  anchorsCovered: DayAnchor[];
  anchorsMissed: DayAnchor[];
  perAnchorStats: AnchorWeekStat[];
  topImprovement: string | null;
  biggestGap: string | null;
  mistakesResolvedThisWeek: string[];
  fridayScore: number | null;
  totalSessions: number;
  avgScore: number;
  // V4 pressure metrics
  pressureRepsCompleted: number;
  avgPressureScore: number | null;
  strongestPressureAnchor: string | null;
  weakestPressureAnchor: string | null;
  // V5 simulation / flow metrics
  simulationsCompleted: number;
  flowControlAvg: number | null;
  controlHeldRate: number | null;  // 0–100 percentage
}

export interface AnchorWeekStat {
  anchor: DayAnchor;
  label: string;
  currentWeekAvg: number;
  priorWeekAvg: number;
  delta: number;
  sessionCount: number;
  topMistake: string | null;
}

// ── Compute Weekly Summary ───────────────────────────────────────

export async function computeWeeklySummaryFromDB(
  userId: string,
  blockId: string,
  weekNumber: number,
): Promise<WeeklySummary> {
  // Fetch current week's completed assignments
  const { data: currentAssignments } = await supabase
    .from('daily_assignments')
    .select('day_anchor, session_ids, completed')
    .eq('block_id', blockId)
    .eq('block_week', weekNumber);

  // Fetch prior week's assignments (for delta comparison)
  const priorWeek = weekNumber - 1;
  const { data: priorAssignments } = await supabase
    .from('daily_assignments')
    .select('day_anchor, session_ids')
    .eq('block_id', blockId)
    .eq('block_week', priorWeek)
    .eq('completed', true);

  const completed = (currentAssignments ?? []).filter(a => a.completed);
  const coveredAnchors = [...new Set(completed.map(a => a.day_anchor as DayAnchor))];
  const missedAnchors = ANCHORS_IN_ORDER.filter(a => !coveredAnchors.includes(a));

  // Collect all session IDs
  const currentSessionIds = completed.flatMap(a => (a.session_ids as string[] | null) ?? []);
  const priorSessionIds = (priorAssignments ?? []).flatMap(a => (a.session_ids as string[] | null) ?? []);

  // Fetch session scores
  const allIds = [...currentSessionIds, ...priorSessionIds];
  let sessions: Array<{ id: string; best_score: number | null; latest_score: number | null; pressure_level: string | null; session_type: string }> = [];
  let turns: Array<{ session_id: string; top_mistake: string | null; score: number | null; turn_index: number }> = [];

  if (allIds.length > 0) {
    const [sessRes, turnsRes] = await Promise.all([
      supabase.from('dojo_sessions').select('id, best_score, latest_score, pressure_level, session_type').in('id', allIds),
      supabase.from('dojo_session_turns').select('session_id, top_mistake, score, turn_index').in('session_id', allIds),
    ]);
    sessions = sessRes.data ?? [];
    turns = turnsRes.data ?? [];
  }

  const getScore = (s: typeof sessions[0]) => s.best_score ?? s.latest_score ?? 0;

  // Per-anchor stats
  const perAnchorStats: AnchorWeekStat[] = ANCHORS_IN_ORDER.map(anchor => {
    const anchorCurrent = completed.filter(a => a.day_anchor === anchor);
    const currentIds = anchorCurrent.flatMap(a => (a.session_ids as string[] | null) ?? []);
    const currentSessions = sessions.filter(s => currentIds.includes(s.id));

    const anchorPrior = (priorAssignments ?? []).filter(a => a.day_anchor === anchor);
    const priorIds = anchorPrior.flatMap(a => (a.session_ids as string[] | null) ?? []);
    const priorSessions = sessions.filter(s => priorIds.includes(s.id));

    const currentAvg = currentSessions.length > 0
      ? Math.round(currentSessions.reduce((s, sess) => s + getScore(sess), 0) / currentSessions.length)
      : 0;
    const priorAvg = priorSessions.length > 0
      ? Math.round(priorSessions.reduce((s, sess) => s + getScore(sess), 0) / priorSessions.length)
      : 0;

    // Top mistake for this anchor this week
    const anchorTurns = turns.filter(t => currentIds.includes(t.session_id));
    const mistakeCounts: Record<string, number> = {};
    for (const t of anchorTurns) {
      if (t.top_mistake) mistakeCounts[t.top_mistake] = (mistakeCounts[t.top_mistake] ?? 0) + 1;
    }
    const topMistake = Object.entries(mistakeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      anchor,
      label: DAY_ANCHORS[anchor].shortLabel,
      currentWeekAvg: currentAvg,
      priorWeekAvg: priorAvg,
      delta: currentAvg - priorAvg,
      sessionCount: currentSessions.length,
      topMistake,
    };
  });

  // Top improvement
  const improving = [...perAnchorStats].filter(a => a.delta > 0).sort((a, b) => b.delta - a.delta);
  const topImprovement = improving[0]
    ? `${improving[0].label} improved +${improving[0].delta} pts${improving[0].delta >= 10 ? ' — real progress' : ''}`
    : null;

  // Biggest gap
  const weakest = [...perAnchorStats].filter(a => a.currentWeekAvg > 0).sort((a, b) => a.currentWeekAvg - b.currentWeekAvg);
  const biggestGap = weakest[0]?.currentWeekAvg < 60
    ? `${weakest[0].label} needs work (${weakest[0].currentWeekAvg} avg)`
    : null;

  // Friday simulation score
  const fridayAssignment = completed.find(a => a.day_anchor === 'executive_roi_mixed');
  const fridayIds = (fridayAssignment?.session_ids as string[] | null) ?? [];
  const fridaySessions = sessions.filter(s => fridayIds.includes(s.id));
  const fridayScore = fridaySessions.length > 0
    ? Math.round(fridaySessions.reduce((s, sess) => s + getScore(sess), 0) / fridaySessions.length)
    : null;

  // Overall stats
  const currentScores = sessions.filter(s => currentSessionIds.includes(s.id)).map(getScore);
  const avgScore = currentScores.length > 0
    ? Math.round(currentScores.reduce((a, b) => a + b, 0) / currentScores.length)
    : 0;

  // V4 pressure metrics
  const currentSessions = sessions.filter(s => currentSessionIds.includes(s.id));
  const pressureSessions = currentSessions.filter(s => s.pressure_level && s.pressure_level !== 'none');
  const pressureRepsCompleted = pressureSessions.length;
  const pressureScores = pressureSessions.map(getScore);
  const avgPressureScore = pressureScores.length > 0
    ? Math.round(pressureScores.reduce((a, b) => a + b, 0) / pressureScores.length)
    : null;

  // Pressure by anchor
  const pressureByAnchor: { anchor: string; label: string; avg: number }[] = [];
  for (const anchor of ANCHORS_IN_ORDER) {
    const anchorCurr = completed.filter(a => a.day_anchor === anchor);
    const ids = anchorCurr.flatMap(a => (a.session_ids as string[] | null) ?? []);
    const anchorPressure = pressureSessions.filter(s => ids.includes(s.id));
    if (anchorPressure.length > 0) {
      const avg = Math.round(anchorPressure.map(getScore).reduce((a, b) => a + b, 0) / anchorPressure.length);
      pressureByAnchor.push({ anchor, label: DAY_ANCHORS[anchor].shortLabel, avg });
    }
  }
  pressureByAnchor.sort((a, b) => b.avg - a.avg);
  const strongestPressureAnchor = pressureByAnchor[0] ? `${pressureByAnchor[0].label} (${pressureByAnchor[0].avg} avg)` : null;
  const weakestPressureAnchor = pressureByAnchor.length > 1
    ? `${pressureByAnchor[pressureByAnchor.length - 1].label} (${pressureByAnchor[pressureByAnchor.length - 1].avg} avg)`
    : null;

  // V5 simulation / flow metrics
  const simSessions = currentSessions.filter(s => s.session_type === 'simulation');
  const simulationsCompleted = simSessions.length;

  // Compute flow control avg from simulation turn scores
  let flowControlAvg: number | null = null;
  let controlHeldRate: number | null = null;

  if (simSessions.length > 0) {
    const flowScores: number[] = [];
    let controlHeldCount = 0;

    for (const sim of simSessions) {
      const simTurns = turns
        .filter(t => t.session_id === sim.id && t.score != null)
        .sort((a, b) => a.turn_index - b.turn_index);

      if (simTurns.length >= 2) {
        // Flow control: penalize drops between turns (same logic as arcScoring)
        let flowScore = 100;
        for (let i = 1; i < simTurns.length; i++) {
          const drop = (simTurns[i - 1].score ?? 0) - (simTurns[i].score ?? 0);
          if (drop >= 20) flowScore -= 30;
          else if (drop >= 12) flowScore -= 20;
          else if (drop >= 8) flowScore -= 10;
        }
        flowScores.push(Math.max(0, Math.min(100, flowScore)));

        // Control held: no drop >= 12 and closing >= 60
        const maxDrop = Math.max(0, ...simTurns.slice(1).map((t, i) => (simTurns[i].score ?? 0) - (t.score ?? 0)));
        const closingScore = simTurns[simTurns.length - 1].score ?? 0;
        if (maxDrop < 12 && closingScore >= 60) controlHeldCount++;
      }
    }

    flowControlAvg = flowScores.length > 0
      ? Math.round(flowScores.reduce((a, b) => a + b, 0) / flowScores.length)
      : null;
    controlHeldRate = Math.round((controlHeldCount / simSessions.length) * 100);
  }

  return {
    weekNumber,
    blockId,
    anchorsCovered: coveredAnchors,
    anchorsMissed: missedAnchors,
    perAnchorStats,
    topImprovement,
    biggestGap,
    mistakesResolvedThisWeek: [],
    fridayScore,
    totalSessions: currentSessionIds.length,
    avgScore,
    pressureRepsCompleted,
    avgPressureScore,
    strongestPressureAnchor,
    weakestPressureAnchor,
    simulationsCompleted,
    flowControlAvg,
    controlHeldRate,
  };
}
