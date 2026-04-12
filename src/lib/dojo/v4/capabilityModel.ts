/**
 * V4 Capability Model
 *
 * Computes durability metrics from existing session/turn data.
 * Layers on top of V3 SkillMemory — does not replace it.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from '../scenarios';
import { SKILL_LABELS } from '../scenarios';

// ── Types ──────────────────────────────────────────────────────────

export type PressureReadiness = 'low' | 'building' | 'ready';

export interface CapabilityProfile {
  skill: SkillFocus;
  label: string;
  consistency: number;            // 0–100
  pressureScore: number | null;   // avg score on pressured sessions, null if < 3
  recoveryRate: number | null;    // avg retry delta, null if no retries
  firstAttemptStrength: number;   // avg first attempt score
  pressureReadiness: PressureReadiness;
  summary: string;
}

// ── Build Capability Profiles ─────────────────────────────────────

const ALL_SKILLS: SkillFocus[] = [
  'objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification',
];

export async function buildCapabilityProfiles(userId: string): Promise<CapabilityProfile[]> {
  // Fetch recent completed sessions
  const { data: sessions } = await supabase
    .from('dojo_sessions')
    .select('id, skill_focus, latest_score, best_score, pressure_level, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(200);

  // Fetch first-attempt and retry turns
  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('session_id, score, turn_index, retry_of_turn_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);

  const sessionList = sessions ?? [];
  const turnList = turns ?? [];

  // Index turns by session
  const turnsBySession = new Map<string, typeof turnList>();
  for (const t of turnList) {
    if (!turnsBySession.has(t.session_id)) turnsBySession.set(t.session_id, []);
    turnsBySession.get(t.session_id)!.push(t);
  }

  return ALL_SKILLS.map(skill => {
    const skillSessions = sessionList.filter(s => s.skill_focus === skill);

    // First-attempt scores (last 8)
    const firstAttemptScores: number[] = [];
    for (const s of skillSessions) {
      const sTurns = turnsBySession.get(s.id) ?? [];
      const first = sTurns.find(t => t.turn_index === 0 && !t.retry_of_turn_id);
      if (first?.score != null) firstAttemptScores.push(first.score);
      if (firstAttemptScores.length >= 8) break;
    }

    // Consistency from std dev of last 8 first attempts
    const consistency = computeConsistency(firstAttemptScores);

    // First attempt strength
    const firstAttemptStrength = firstAttemptScores.length > 0
      ? Math.round(firstAttemptScores.reduce((a, b) => a + b, 0) / firstAttemptScores.length)
      : 0;

    // Pressure score — avg on sessions with pressure
    const pressureSessions = skillSessions.filter(
      s => s.pressure_level && s.pressure_level !== 'none'
    );
    const pressureScores = pressureSessions
      .map(s => s.latest_score ?? s.best_score ?? 0)
      .slice(0, 10);
    const pressureScore = pressureScores.length >= 3
      ? Math.round(pressureScores.reduce((a, b) => a + b, 0) / pressureScores.length)
      : null;

    // Recovery rate — avg (retry score - original score)
    const retryDeltas: number[] = [];
    for (const s of skillSessions) {
      const sTurns = turnsBySession.get(s.id) ?? [];
      const originals = sTurns.filter(t => t.turn_index === 0 && !t.retry_of_turn_id && t.score != null);
      const retries = sTurns.filter(t => t.retry_of_turn_id != null && t.score != null);
      for (const retry of retries) {
        const orig = originals.find(o => o.session_id === retry.session_id);
        if (orig?.score != null && retry.score != null) {
          retryDeltas.push(retry.score - orig.score);
        }
      }
    }
    const recoveryRate = retryDeltas.length > 0
      ? Math.round(retryDeltas.reduce((a, b) => a + b, 0) / retryDeltas.length)
      : null;

    // Pressure readiness
    const pressureReadiness = derivePressureReadiness(
      firstAttemptStrength, consistency, pressureScore,
    );

    // Summary
    const summary = buildSummary(skill, consistency, pressureScore, recoveryRate, firstAttemptStrength, pressureReadiness);

    return {
      skill,
      label: SKILL_LABELS[skill],
      consistency,
      pressureScore,
      recoveryRate,
      firstAttemptStrength,
      pressureReadiness,
      summary,
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────

function computeConsistency(scores: number[]): number {
  if (scores.length < 3) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev <= 5) return Math.min(90 + Math.round((5 - stdDev) * 2), 100);
  if (stdDev <= 10) return Math.round(70 + (10 - stdDev) * 3.8);
  if (stdDev <= 15) return Math.round(50 + (15 - stdDev) * 3.8);
  return Math.max(0, Math.round(49 - (stdDev - 15) * 3));
}

function derivePressureReadiness(
  firstAttempt: number,
  consistency: number,
  pressureScore: number | null,
): PressureReadiness {
  if (firstAttempt >= 70 && consistency >= 70 && (pressureScore ?? 0) >= 65) return 'ready';
  if (firstAttempt >= 55 || consistency >= 55) return 'building';
  return 'low';
}

function buildSummary(
  skill: SkillFocus,
  consistency: number,
  pressureScore: number | null,
  recoveryRate: number | null,
  firstAttempt: number,
  readiness: PressureReadiness,
): string {
  const label = SKILL_LABELS[skill];
  const parts: string[] = [];

  if (firstAttempt === 0) return `${label}: no data yet.`;

  if (consistency >= 80) parts.push('consistent performer');
  else if (consistency >= 60) parts.push('building consistency');
  else parts.push('inconsistent — scores vary widely');

  if (pressureScore != null) {
    if (pressureScore >= 70) parts.push('holds up under pressure');
    else if (pressureScore >= 55) parts.push('pressure exposes some gaps');
    else parts.push('struggles under pressure');
  }

  if (recoveryRate != null) {
    if (recoveryRate >= 10) parts.push('strong self-corrector');
    else if (recoveryRate >= 3) parts.push('recovers on retry');
    else parts.push('retries show limited improvement');
  }

  return `${label}: ${parts.join(', ')}.`;
}
