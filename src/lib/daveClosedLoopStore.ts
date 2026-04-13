/**
 * Dave Closed-Loop Store — Persistence layer for coaching loops.
 *
 * Reads/writes to the closed_loop_sessions table.
 * Provides a clean API for the hook and orchestrator to persist loop state.
 *
 * OWNERSHIP: This file owns DB persistence for closed-loop coaching.
 * It does NOT own loop logic, verification, or audio delivery.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ClosedLoopSession, ClosedLoopAttempt, ClosedLoopVerification, ClosedLoopNextStep } from '@/lib/daveClosedLoopEngine';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ClosedLoopStore');

// ── Progress Summary ──────────────────────────────────────────────

export interface ClosedLoopProgressSummary {
  skill: string;
  concept: string;
  attempts: number;
  firstOutcome: 'missed' | 'partial' | 'applied' | 'strong';
  latestOutcome: 'missed' | 'partial' | 'applied' | 'strong';
  improved: boolean;
  mastered: boolean;
  routedToReview: boolean;
  routedToSkillBuilder: boolean;
}

// ── DB Row shape (matches Supabase) ───────────────────────────────

interface ClosedLoopRow {
  id: string;
  user_id: string;
  skill: string;
  sub_skill: string | null;
  focus_pattern: string | null;
  taught_concept: string;
  taught_at: string;
  attempts: unknown;
  latest_verification: unknown;
  status: string;
  next_step: string | null;
  routed_to_review: boolean;
  routed_to_skill_builder: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Write Operations ──────────────────────────────────────────────

export async function createClosedLoopRecord(
  userId: string,
  session: ClosedLoopSession,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('closed_loop_sessions')
    .insert({
      id: session.id.startsWith('cl_') ? undefined : session.id,
      user_id: userId,
      skill: session.skill,
      sub_skill: session.subSkill || null,
      focus_pattern: session.focusPattern || null,
      taught_concept: session.taughtConcept,
      taught_at: session.taughtAt,
      attempts: JSON.parse(JSON.stringify(session.attempts)),
      status: session.status,
      next_step: session.nextStep || null,
    } as any)
    .select('id')
    .single();

  if (error) {
    logger.error('Failed to create closed-loop record', { error: error.message });
    return null;
  }
  return data?.id ?? null;
}

export async function saveAttemptAndVerification(
  sessionId: string,
  attempts: ClosedLoopAttempt[],
  verification: ClosedLoopVerification,
  status: ClosedLoopSession['status'],
  nextStep: ClosedLoopNextStep | null,
): Promise<boolean> {
  const updates: Record<string, unknown> = {
    attempts: JSON.parse(JSON.stringify(attempts)),
    latest_verification: JSON.parse(JSON.stringify(verification)),
    status,
    next_step: nextStep || null,
  };

  if (nextStep === 'route_to_learn_review') {
    updates.routed_to_review = true;
  }
  if (nextStep === 'route_to_skill_builder') {
    updates.routed_to_skill_builder = true;
  }
  if (status === 'completed') {
    updates.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('closed_loop_sessions')
    .update(updates as any)
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to save attempt', { sessionId, error: error.message });
    return false;
  }
  return true;
}

export async function markLoopCompleted(sessionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('closed_loop_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    } as any)
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to mark loop completed', { sessionId, error: error.message });
    return false;
  }
  return true;
}

// ── Read Operations ───────────────────────────────────────────────

export async function loadActiveLoop(userId: string): Promise<ClosedLoopSession | null> {
  const { data, error } = await supabase
    .from('closed_loop_sessions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['teaching', 'testing', 'verifying', 'reinforcing', 'needs_review'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToSession(data as unknown as ClosedLoopRow);
}

export async function loadUnresolvedLoops(userId: string): Promise<ClosedLoopSession[]> {
  const { data, error } = await supabase
    .from('closed_loop_sessions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['teaching', 'testing', 'verifying', 'reinforcing', 'needs_review'])
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error || !data) return [];
  return (data as unknown as ClosedLoopRow[]).map(rowToSession);
}

export async function loadLatestLoopBySkill(
  userId: string,
  skill: string,
): Promise<ClosedLoopSession | null> {
  const { data, error } = await supabase
    .from('closed_loop_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('skill', skill)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToSession(data as unknown as ClosedLoopRow);
}

export async function loadRecentCompletedLoops(
  userId: string,
  limit = 10,
): Promise<ClosedLoopSession[]> {
  const { data, error } = await supabase
    .from('closed_loop_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as unknown as ClosedLoopRow[]).map(rowToSession);
}

// ── Duplicate Prevention ──────────────────────────────────────────

export async function hasActiveLoopForConcept(
  userId: string,
  skill: string,
  concept: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('closed_loop_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('skill', skill)
    .eq('taught_concept', concept)
    .in('status', ['teaching', 'testing', 'verifying', 'reinforcing', 'needs_review']);

  return !error && (count ?? 0) > 0;
}

// ── Progress Summary Builder ──────────────────────────────────────

export function buildProgressSummary(session: ClosedLoopSession): ClosedLoopProgressSummary {
  const attempts = session.attempts;
  const first = attempts[0];
  const latest = attempts[attempts.length - 1];

  const firstOutcome = classifyAttemptOutcome(first);
  const latestOutcome = classifyAttemptOutcome(latest);

  const OUTCOME_RANK: Record<string, number> = { missed: 0, partial: 1, applied: 2, strong: 3 };
  const improved = attempts.length > 1 && (OUTCOME_RANK[latestOutcome] ?? 0) > (OUTCOME_RANK[firstOutcome] ?? 0);
  const mastered = session.status === 'completed' && (latestOutcome === 'strong' || latestOutcome === 'applied');

  return {
    skill: session.skill,
    concept: session.taughtConcept,
    attempts: attempts.length,
    firstOutcome,
    latestOutcome,
    improved,
    mastered,
    routedToReview: session.nextStep === 'route_to_learn_review',
    routedToSkillBuilder: session.nextStep === 'route_to_skill_builder',
  };
}

// ── Completion Check ──────────────────────────────────────────────

export function isClosedLoopComplete(session: ClosedLoopSession): boolean {
  if (session.status === 'completed') return true;

  const latest = session.attempts[session.attempts.length - 1];
  if (!latest) return false;

  const outcome = classifyAttemptOutcome(latest);

  // Strong application → complete
  if (outcome === 'strong') return true;

  // Applied after at least 2 attempts → complete
  if (outcome === 'applied' && session.attempts.length >= 2) return true;

  // Moving to next concept means this one is done
  if (session.nextStep === 'move_to_next_concept') return true;

  return false;
}

// ── Helpers ────────────────────────────────────────────────────────

function classifyAttemptOutcome(attempt?: ClosedLoopAttempt): 'missed' | 'partial' | 'applied' | 'strong' {
  if (!attempt) return 'missed';
  if (attempt.focusApplied && (attempt.score ?? 0) >= 70) return 'strong';
  if (attempt.focusApplied) return 'applied';
  if ((attempt.score ?? 0) >= 50 || (attempt.weakDimensions?.length ?? 0) < 3) return 'partial';
  return 'missed';
}

function rowToSession(row: ClosedLoopRow): ClosedLoopSession {
  const attempts = Array.isArray(row.attempts) ? row.attempts : [];

  return {
    id: row.id,
    skill: row.skill as SkillFocus,
    subSkill: row.sub_skill || undefined,
    focusPattern: row.focus_pattern || undefined,
    taughtConcept: row.taught_concept,
    taughtAt: row.taught_at,
    attempts: attempts as ClosedLoopAttempt[],
    status: row.status as ClosedLoopSession['status'],
    nextStep: (row.next_step as ClosedLoopNextStep) || null,
  };
}
