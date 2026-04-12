/**
 * Learn Adaptation Engine — Phase 3
 *
 * Adaptive coaching surfaces derived from real Dojo performance data.
 * No new DB tables. No invented content. Pure derivation.
 */

import { supabase } from '@/integrations/supabase/client';
import { buildCapabilityProfiles, type CapabilityProfile } from '@/lib/dojo/v4/capabilityModel';
import { getMistakeEntry } from '@/lib/dojo/mistakeTaxonomy';

// ── Types ──────────────────────────────────────────────────────────

export interface PressureBreakdown {
  firstAttemptStrength: number;
  pressureScore: number | null;
  gap: number | null;
  interpretation: string;
  flowControl: number | null;
  closingUnderPressure: number | null;
  lateTurnDropoff: number | null;
}

export interface MultiThreadMiss {
  stakeholdersDetected: string[];
  stakeholdersAddressed: string[];
  missedStakeholders: string[];
  coachingNote: string | null;
  momentum: 'forward' | 'neutral' | 'at_risk';
  sessionDate: string;
}

export interface DecayItem {
  kiId: string;
  kiTitle: string;
  learnedAt: string | null;
  lastAppliedAt: string | null;
  missesSinceLearned: number;
}

export type TransferState = 'sticking' | 'partial' | 'not_yet';

export interface TransferSignal {
  state: TransferState;
  appliedRate: number;
  avgScoreDelta: number;
  sameMistakeRecurring: boolean;
  coachingLine: string;
}

// ── Pressure Breakdown ─────────────────────────────────────────────

export async function getPressureBreakdown(userId: string): Promise<PressureBreakdown | null> {
  const profiles = await buildCapabilityProfiles(userId);
  if (!profiles || profiles.length === 0) return null;

  // Aggregate across skills that have pressure data
  const withPressure = profiles.filter(p => p.pressureScore != null && p.firstAttemptStrength > 0);
  if (withPressure.length === 0) return null;

  const avgFirst = Math.round(withPressure.reduce((s, p) => s + p.firstAttemptStrength, 0) / withPressure.length);
  const avgPressure = Math.round(withPressure.reduce((s, p) => s + (p.pressureScore ?? 0), 0) / withPressure.length);
  const gap = avgFirst - avgPressure;

  const flowVals = profiles.filter(p => p.flowControl != null).map(p => p.flowControl!);
  const closeVals = profiles.filter(p => p.closingUnderPressure != null).map(p => p.closingUnderPressure!);
  const dropVals = profiles.filter(p => p.lateTurnDropoff != null).map(p => p.lateTurnDropoff!);

  let interpretation: string;
  if (gap <= 5) {
    interpretation = 'Your form mostly holds under pressure.';
  } else if (gap <= 12) {
    interpretation = 'Pressure exposes some instability. You know the material but execution loosens.';
  } else {
    interpretation = 'Pressure changes your execution materially. Focus on staying controlled when it gets hard.';
  }

  return {
    firstAttemptStrength: avgFirst,
    pressureScore: avgPressure,
    gap,
    interpretation,
    flowControl: flowVals.length > 0 ? Math.round(flowVals.reduce((a, b) => a + b, 0) / flowVals.length) : null,
    closingUnderPressure: closeVals.length > 0 ? Math.round(closeVals.reduce((a, b) => a + b, 0) / closeVals.length) : null,
    lateTurnDropoff: dropVals.length > 0 ? Math.round(dropVals.reduce((a, b) => a + b, 0) / dropVals.length) : null,
  };
}

// ── Multi-Thread Miss ──────────────────────────────────────────────

export async function getRecentMultiThreadMiss(userId: string): Promise<MultiThreadMiss | null> {
  // Get recent turns with score_json
  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('score_json, created_at, session_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!turns) return null;

  for (const turn of turns) {
    const sj = turn.score_json as Record<string, any> | null;
    const mt = sj?.multiThread;
    if (!mt || typeof mt !== 'object') continue;

    const detected: string[] = Array.isArray(mt.stakeholdersDetected) ? mt.stakeholdersDetected : [];
    const addressed: string[] = Array.isArray(mt.stakeholdersAddressed) ? mt.stakeholdersAddressed : [];
    const missed: string[] = Array.isArray(mt.missedStakeholders)
      ? mt.missedStakeholders
      : detected.filter((s: string) => !addressed.includes(s));
    const momentum = (mt.dealMomentum as string) ?? 'neutral';
    const coachingNote = (mt.coachingNote as string) ?? null;

    // Only surface if there's something to learn from
    if (missed.length === 0 && momentum === 'forward') continue;

    return {
      stakeholdersDetected: detected,
      stakeholdersAddressed: addressed,
      missedStakeholders: missed,
      coachingNote,
      momentum: momentum as MultiThreadMiss['momentum'],
      sessionDate: turn.created_at,
    };
  }

  return null;
}

// ── Reinforcement Decay ────────────────────────────────────────────

export async function getReinforcementDecay(userId: string): Promise<DecayItem[]> {
  // Get recent assignments (last 14 days)
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: assignments } = await supabase
    .from('daily_assignments')
    .select('id, kis, assignment_date, session_ids')
    .eq('user_id', userId)
    .gte('assignment_date', twoWeeksAgo)
    .order('assignment_date', { ascending: false });

  if (!assignments || assignments.length === 0) return [];

  // Collect all KI appearances and their outcomes
  const kiTracker = new Map<string, { appearances: number; misses: number; firstSeen: string; lastApplied: string | null }>();

  const assignmentIds = assignments.map(a => a.id);
  const sessionIdSets = assignments.flatMap(a => (a.session_ids as string[] | null) ?? []);

  // Get turns for these sessions
  let turnMap = new Map<string, { focusApplied: string; score: number }>();
  if (sessionIdSets.length > 0) {
    const { data: turns } = await supabase
      .from('dojo_session_turns')
      .select('session_id, score_json, score')
      .in('session_id', sessionIdSets.slice(0, 100))
      .eq('turn_index', 0);

    for (const t of turns ?? []) {
      const sj = t.score_json as Record<string, any> | null;
      turnMap.set(t.session_id, {
        focusApplied: (sj?.focusApplied as string) ?? 'unknown',
        score: t.score ?? 0,
      });
    }
  }

  for (const a of assignments) {
    const kiIds = (a.kis as unknown as string[]) ?? [];
    const sessions = (a.session_ids as string[] | null) ?? [];

    for (const kiId of kiIds) {
      if (!kiTracker.has(kiId)) {
        kiTracker.set(kiId, { appearances: 0, misses: 0, firstSeen: a.assignment_date, lastApplied: null });
      }
      const entry = kiTracker.get(kiId)!;
      entry.appearances++;

      // Check if it was applied in any linked session
      let applied = false;
      for (const sid of sessions) {
        const t = turnMap.get(sid);
        if (t && t.focusApplied === 'yes' && t.score >= 55) {
          applied = true;
          entry.lastApplied = a.assignment_date;
          break;
        }
      }
      if (!applied) entry.misses++;
    }
  }

  // Filter to KIs that are fading: appeared 2+ times, missed more than half
  const decaying: { kiId: string; data: typeof kiTracker extends Map<string, infer V> ? V : never }[] = [];
  for (const [kiId, data] of kiTracker) {
    if (data.appearances >= 2 && data.misses >= Math.ceil(data.appearances * 0.5)) {
      decaying.push({ kiId, data });
    }
  }

  if (decaying.length === 0) return [];

  // Resolve KI titles
  const kiIds = decaying.map(d => d.kiId);
  const { data: kiRows } = await supabase
    .from('knowledge_items' as any)
    .select('id, title')
    .in('id', kiIds);

  const titleMap = new Map<string, string>();
  for (const ki of (kiRows ?? []) as any[]) {
    titleMap.set(ki.id, ki.title);
  }

  return decaying
    .map(d => ({
      kiId: d.kiId,
      kiTitle: titleMap.get(d.kiId) ?? 'Unknown KI',
      learnedAt: d.data.firstSeen,
      lastAppliedAt: d.data.lastApplied,
      missesSinceLearned: d.data.misses,
    }))
    .sort((a, b) => b.missesSinceLearned - a.missesSinceLearned)
    .slice(0, 3);
}

// ── Transfer Signal ────────────────────────────────────────────────

export async function getTransferSignal(userId: string): Promise<TransferSignal | null> {
  // Get last 8 completed sessions with turns
  const { data: sessions } = await supabase
    .from('dojo_sessions')
    .select('id, completed_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(8);

  if (!sessions || sessions.length < 3) return null;

  const sessionIds = sessions.map(s => s.id);
  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('session_id, score, score_json, top_mistake')
    .in('session_id', sessionIds)
    .eq('turn_index', 0);

  if (!turns || turns.length < 3) return null;

  // Calculate applied rate
  let applied = 0;
  const mistakes = new Map<string, number>();
  const scores: number[] = [];

  for (const t of turns) {
    const sj = t.score_json as Record<string, any> | null;
    if (sj?.focusApplied === 'yes') applied++;
    if (t.score != null) scores.push(t.score);
    if (t.top_mistake) {
      mistakes.set(t.top_mistake, (mistakes.get(t.top_mistake) ?? 0) + 1);
    }
  }

  const appliedRate = Math.round((applied / turns.length) * 100);

  // Score delta: compare first half to second half
  const half = Math.floor(scores.length / 2);
  const recentHalf = scores.slice(0, half);
  const olderHalf = scores.slice(half);
  const recentAvg = recentHalf.length > 0 ? recentHalf.reduce((a, b) => a + b, 0) / recentHalf.length : 0;
  const olderAvg = olderHalf.length > 0 ? olderHalf.reduce((a, b) => a + b, 0) / olderHalf.length : 0;
  const avgScoreDelta = Math.round(recentAvg - olderAvg);

  // Check for recurring mistakes
  const sameMistakeRecurring = Array.from(mistakes.values()).some(c => c >= 3);

  // Determine state
  let state: TransferState;
  let coachingLine: string;

  if (appliedRate >= 60 && avgScoreDelta >= 0 && !sameMistakeRecurring) {
    state = 'sticking';
    coachingLine = 'Your training is transferring. The reps are building real muscle memory.';
  } else if (appliedRate >= 35 || avgScoreDelta > -3) {
    state = 'partial';
    coachingLine = 'Some improvement is landing, but execution is still inconsistent. Stay on it.';
  } else {
    state = 'not_yet';
    coachingLine = 'The same patterns keep showing up. Slow down and focus on one thing at a time.';
  }

  return { state, appliedRate, avgScoreDelta, sameMistakeRecurring, coachingLine };
}
