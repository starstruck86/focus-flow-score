/**
 * Skill Memory V3 — Builds structured per-skill development profile.
 *
 * Tracks:
 * - average score + trend (improving / declining / stable)
 * - most frequent mistakes per skill
 * - last practiced / last improved timestamps
 * - confidence level (derived from consistency + score)
 * - progress signals ("You fixed this", "Still breaking", "Improving")
 *
 * Built entirely from existing dojo_sessions + dojo_session_turns data.
 * Does NOT change scoring logic.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from './scenarios';
import { SKILL_LABELS } from './scenarios';
import { getMistakeEntry } from './mistakeTaxonomy';

// ── Types ──────────────────────────────────────────────────────────

export type SkillTrend = 'improving' | 'declining' | 'stable' | 'new';
export type ConfidenceLevel = 'high' | 'building' | 'low' | 'untested';
export type ProgressSignalType = 'fixed' | 'improving' | 'still_breaking' | 'new_issue' | 'mastered';

export interface ProgressSignal {
  type: ProgressSignalType;
  label: string;
  detail: string;
  skill: SkillFocus;
  pattern?: string;
}

export interface SkillProfile {
  skill: SkillFocus;
  label: string;
  avgScore: number;
  recentAvg: number; // last 5 sessions
  trend: SkillTrend;
  trendDelta: number; // positive = improving
  totalReps: number;
  lastPracticed: string | null; // ISO date
  lastImproved: string | null; // ISO date of last session where score > prior avg
  confidence: ConfidenceLevel;
  topMistakes: Array<{ mistake: string; count: number; label: string }>;
  /** Mistakes that used to appear but haven't in last 5 sessions */
  resolvedMistakes: string[];
}

export interface SkillMemory {
  profiles: SkillProfile[];
  dailyFocus: DailyFocus;
  progressSignals: ProgressSignal[];
  lastUpdated: string;
}

export interface DailyFocus {
  primary: SkillFocus;
  primaryReason: string;
  secondary: SkillFocus | null;
  secondaryReason: string | null;
  daveMessage: string;
}

// ── Constants ──────────────────────────────────────────────────────

const ALL_SKILLS: SkillFocus[] = [
  'objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification',
];

const RECENT_WINDOW = 5; // sessions for trend calculation
const IMPROVING_THRESHOLD = 5; // points delta to count as "improving"

// ── Build Skill Memory ─────────────────────────────────────────────

export async function buildSkillMemory(userId: string): Promise<SkillMemory> {
  // Fetch sessions with their turns
  const { data: sessions } = await supabase
    .from('dojo_sessions')
    .select('id, skill_focus, best_score, latest_score, created_at, completed_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(200);

  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('session_id, score, turn_index, score_json, top_mistake, created_at')
    .eq('user_id', userId)
    .eq('turn_index', 0) // first attempts only for pattern tracking
    .order('created_at', { ascending: false })
    .limit(200);

  // Group by skill
  const sessionsBySkill: Record<string, typeof sessions> = {};
  const turnsBySession = new Map<string, (typeof turns extends (infer T)[] | null ? T : never)[]>();

  for (const s of sessions ?? []) {
    const skill = s.skill_focus as SkillFocus;
    if (!sessionsBySkill[skill]) sessionsBySkill[skill] = [];
    sessionsBySkill[skill]!.push(s);
  }

  for (const t of turns ?? []) {
    if (!turnsBySession.has(t.session_id)) turnsBySession.set(t.session_id, []);
    turnsBySession.get(t.session_id)!.push(t);
  }

  // Build profiles
  const profiles: SkillProfile[] = ALL_SKILLS.map(skill => {
    const skillSessions = sessionsBySkill[skill] ?? [];
    const totalReps = skillSessions.length;

    if (totalReps === 0) {
      return {
        skill,
        label: SKILL_LABELS[skill],
        avgScore: 0,
        recentAvg: 0,
        trend: 'new' as SkillTrend,
        trendDelta: 0,
        totalReps: 0,
        lastPracticed: null,
        lastImproved: null,
        confidence: 'untested' as ConfidenceLevel,
        topMistakes: [],
        resolvedMistakes: [],
      };
    }

    // Scores (sessions are ordered desc)
    const scores = skillSessions.map(s => s.latest_score ?? s.best_score ?? 0);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const recentScores = scores.slice(0, RECENT_WINDOW);
    const recentAvg = Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length);

    // Trend: compare recent avg to older avg
    const olderScores = scores.slice(RECENT_WINDOW);
    let trend: SkillTrend = 'stable';
    let trendDelta = 0;
    if (olderScores.length >= 2) {
      const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
      trendDelta = Math.round(recentAvg - olderAvg);
      if (trendDelta >= IMPROVING_THRESHOLD) trend = 'improving';
      else if (trendDelta <= -IMPROVING_THRESHOLD) trend = 'declining';
    } else if (totalReps <= 3) {
      trend = 'new';
    }

    // Timestamps
    const lastPracticed = skillSessions[0]?.created_at ?? null;

    // Find last session where score exceeded prior running average
    let lastImproved: string | null = null;
    let runningTotal = 0;
    let runningCount = 0;
    // Process oldest to newest
    const chronological = [...skillSessions].reverse();
    for (const s of chronological) {
      const score = s.latest_score ?? s.best_score ?? 0;
      if (runningCount >= 2 && score > (runningTotal / runningCount) + 3) {
        lastImproved = s.created_at;
      }
      runningTotal += score;
      runningCount++;
    }

    // Confidence
    let confidence: ConfidenceLevel;
    if (recentAvg >= 75 && trendDelta >= 0 && totalReps >= 5) confidence = 'high';
    else if (recentAvg >= 55 || (totalReps >= 3 && recentAvg >= 40)) confidence = 'building';
    else confidence = 'low';

    // Mistake tracking
    const mistakeCounts = new Map<string, number>();
    const recentMistakes = new Set<string>();

    for (let i = 0; i < skillSessions.length; i++) {
      const session = skillSessions[i];
      const sessionTurns = turnsBySession.get(session.id) ?? [];
      for (const turn of sessionTurns) {
        // Use the canonical top_mistake column; fall back to score_json for legacy rows
        const mistake = (turn as Record<string, unknown>).top_mistake as string | undefined
          ?? (turn.score_json as Record<string, unknown> | null)?.topMistake as string | undefined;
        if (mistake) {
          mistakeCounts.set(mistake, (mistakeCounts.get(mistake) ?? 0) + 1);
          if (i < RECENT_WINDOW) recentMistakes.add(mistake);
        }
      }
    }

    const topMistakes = Array.from(mistakeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([mistake, count]) => {
        const entry = getMistakeEntry(mistake);
        return { mistake, count, label: entry.label };
      });

    // Resolved mistakes: appeared in older sessions but NOT in recent window
    const resolvedMistakes = Array.from(mistakeCounts.keys())
      .filter(m => !recentMistakes.has(m) && (mistakeCounts.get(m) ?? 0) >= 2);

    return {
      skill,
      label: SKILL_LABELS[skill],
      avgScore,
      recentAvg,
      trend,
      trendDelta,
      totalReps,
      lastPracticed,
      lastImproved,
      confidence,
      topMistakes,
      resolvedMistakes,
    };
  });

  // Daily focus selection
  const dailyFocus = selectDailyFocus(profiles);

  // Progress signals
  const progressSignals = deriveProgressSignals(profiles);

  return {
    profiles,
    dailyFocus,
    progressSignals,
    lastUpdated: new Date().toISOString(),
  };
}

// ── Daily Focus Selection ──────────────────────────────────────────

function selectDailyFocus(profiles: SkillProfile[]): DailyFocus {
  const practiced = profiles.filter(p => p.totalReps > 0);
  const unpracticed = profiles.filter(p => p.totalReps === 0);

  // Priority 1: unpracticed skills
  if (unpracticed.length > 0) {
    const primary = unpracticed[0];
    const secondary = practiced.length > 0
      ? [...practiced].sort((a, b) => a.recentAvg - b.recentAvg)[0]
      : null;

    return {
      primary: primary.skill,
      primaryReason: `You haven't practiced ${primary.label} yet.`,
      secondary: secondary?.skill ?? null,
      secondaryReason: secondary ? `Keep sharpening ${secondary.label} (${secondary.recentAvg} avg).` : null,
      daveMessage: `Today we're starting with ${primary.label}. ${secondary ? `Then we'll sharpen your ${secondary.label}.` : "Let's build your baseline."}`,
    };
  }

  // Priority 2: declining skill
  const declining = practiced.filter(p => p.trend === 'declining')
    .sort((a, b) => a.trendDelta - b.trendDelta);
  if (declining.length > 0) {
    const primary = declining[0];
    const secondary = practiced
      .filter(p => p.skill !== primary.skill)
      .sort((a, b) => a.recentAvg - b.recentAvg)[0] ?? null;

    return {
      primary: primary.skill,
      primaryReason: `${primary.label} has been slipping (${primary.trendDelta > 0 ? '+' : ''}${primary.trendDelta} pts).`,
      secondary: secondary?.skill ?? null,
      secondaryReason: secondary ? `Then work on ${secondary.label}.` : null,
      daveMessage: `Your ${primary.label.toLowerCase()} has been sliding. Today we fix that.${secondary ? ` Then ${secondary.label.toLowerCase()}.` : ''}`,
    };
  }

  // Priority 3: weakest skill by recent avg (with staleness boost)
  const scored = practiced.map(p => {
    const daysSince = p.lastPracticed
      ? Math.floor((Date.now() - new Date(p.lastPracticed).getTime()) / (1000 * 60 * 60 * 24))
      : 30;
    // Lower is worse: low recentAvg + stale = most needy
    const needScore = p.recentAvg - Math.min(daysSince * 2, 20);
    return { ...p, needScore };
  }).sort((a, b) => a.needScore - b.needScore);

  const primary = scored[0];
  const secondary = scored.length > 1 ? scored[1] : null;

  return {
    primary: primary.skill,
    primaryReason: primary.confidence === 'low'
      ? `${primary.label} needs work (${primary.recentAvg} avg).`
      : `Time to push ${primary.label} further.`,
    secondary: secondary?.skill ?? null,
    secondaryReason: secondary ? `Then rotate to ${secondary.label}.` : null,
    daveMessage: buildDailyFocusMessage(primary, secondary),
  };
}

function buildDailyFocusMessage(primary: SkillProfile, secondary: SkillProfile | null): string {
  const skill = primary.label.toLowerCase();

  if (primary.confidence === 'low') {
    return `Today we're working on ${skill}. Your recent average is ${primary.recentAvg} — there's real room to grow here.${secondary ? ` We'll also touch ${secondary.label.toLowerCase()}.` : ''}`;
  }

  if (primary.trend === 'improving') {
    return `${primary.label} is trending up — let's keep the momentum going.${secondary ? ` Then ${secondary.label.toLowerCase()}.` : ''}`;
  }

  if (primary.confidence === 'high') {
    return `Your ${skill} is strong. Today we push it to elite.${secondary ? ` Then sharpen ${secondary.label.toLowerCase()}.` : ''}`;
  }

  return `Today we're drilling ${skill}.${secondary ? ` Then ${secondary.label.toLowerCase()}.` : ' Stay focused.'}`;
}

// ── Progress Signals ───────────────────────────────────────────────

function deriveProgressSignals(profiles: SkillProfile[]): ProgressSignal[] {
  const signals: ProgressSignal[] = [];

  for (const p of profiles) {
    if (p.totalReps === 0) continue;

    // "You fixed this" — resolved mistakes
    for (const resolved of p.resolvedMistakes) {
      const entry = getMistakeEntry(resolved);
      signals.push({
        type: 'fixed',
        label: 'You fixed this',
        detail: `"${entry.label}" hasn't appeared in your recent ${p.label} sessions.`,
        skill: p.skill,
        pattern: resolved,
      });
    }

    // "This is improving" — positive trend with enough data
    if (p.trend === 'improving' && p.totalReps >= 5) {
      signals.push({
        type: 'improving',
        label: 'This is improving',
        detail: `${p.label} is up ${p.trendDelta} pts. Keep going.`,
        skill: p.skill,
      });
    }

    // "This is still breaking" — top mistake with 3+ occurrences AND still appearing recently
    // (Skip if already resolved — avoids contradictory "fixed" + "still breaking" signals)
    for (const m of p.topMistakes) {
      if (m.count >= 3 && !p.resolvedMistakes.includes(m.mistake)) {
        signals.push({
          type: 'still_breaking',
          label: 'This is still breaking',
          detail: `"${m.label}" keeps showing up in ${p.label} (${m.count}×).`,
          skill: p.skill,
          pattern: m.mistake,
        });
      }
    }

    // "Mastered" — high confidence + positive trend
    if (p.confidence === 'high' && p.recentAvg >= 80) {
      signals.push({
        type: 'mastered',
        label: 'Strong',
        detail: `${p.label} is at ${p.recentAvg} avg. This skill is locked in.`,
        skill: p.skill,
      });
    }
  }

  // Sort: still_breaking first (most actionable), then fixed (motivating)
  const priority: Record<ProgressSignalType, number> = {
    still_breaking: 0, new_issue: 1, improving: 2, fixed: 3, mastered: 4,
  };
  signals.sort((a, b) => priority[a.type] - priority[b.type]);

  return signals.slice(0, 6); // cap to avoid noise
}
