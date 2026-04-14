/**
 * resolveSkillSessionFromRoute — Canonical SkillSession resolver.
 *
 * Reads from navigation state and URL search params, merges intelligently,
 * and returns a normalized SkillSession or null if insufficient data.
 *
 * This is the single source of truth for any surface that receives skill context.
 */

import { useLocation, useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import type { SkillSession } from './skillSession';

const VALID_SKILLS: SkillFocus[] = [
  'objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification',
];

function isValidSkill(s: string | null | undefined): s is SkillFocus {
  return !!s && VALID_SKILLS.includes(s as SkillFocus);
}

export interface ResolvedSkillSession {
  session: SkillSession;
  source: 'state' | 'params' | 'merged';
}

/**
 * Resolve SkillSession from React Router state + search params.
 * State takes priority over params; params fill gaps.
 */
export function resolveSkillSession(
  locationState: unknown,
  searchParams: URLSearchParams,
): ResolvedSkillSession | null {
  const stateObj = (locationState as Record<string, unknown>) ?? {};
  const fromState = stateObj.skillSession as SkillSession | undefined;

  // Direct SkillSession in state — highest fidelity
  if (fromState && isValidSkill(fromState.skillId)) {
    return { session: normalizeSession(fromState), source: 'state' };
  }

  // Legacy state.skill / state.skillFocus (used by existing callers)
  const legacySkill = (stateObj.skill ?? stateObj.skillFocus) as string | undefined;
  const paramSkill = searchParams.get('skillId');

  const skillId = isValidSkill(legacySkill) ? legacySkill
    : isValidSkill(paramSkill) ? paramSkill
    : null;

  if (!skillId) return null;

  const session: SkillSession = {
    skillId,
    skillName: SKILL_LABELS[skillId],
    currentTier: fromState?.currentTier ?? safeInt(searchParams.get('tier'), 1),
    currentLevel: fromState?.currentLevel ?? safeInt(searchParams.get('level'), 1),
    targetTier: fromState?.targetTier ?? safeInt(searchParams.get('tier'), 1) + 1,
    focusPattern: fromState?.focusPattern ?? searchParams.get('focus') ?? undefined,
    topBlocker: fromState?.topBlocker,
    scenarioType: (fromState?.scenarioType ?? searchParams.get('scenario') ?? undefined) as SkillSession['scenarioType'],
  };

  const source = legacySkill ? 'state' : paramSkill ? 'params' : 'merged';
  return { session: normalizeSession(session), source: source as ResolvedSkillSession['source'] };
}

/**
 * React hook version — call at top of component.
 */
export function useResolvedSkillSession(): ResolvedSkillSession | null {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  return useMemo(
    () => resolveSkillSession(location.state, searchParams),
    [location.state, searchParams],
  );
}

function normalizeSession(s: SkillSession): SkillSession {
  return {
    ...s,
    skillName: s.skillName || SKILL_LABELS[s.skillId] || s.skillId.replace(/_/g, ' '),
    currentTier: s.currentTier ?? 1,
    currentLevel: s.currentLevel ?? 1,
    targetTier: s.targetTier ?? (s.currentTier ?? 1) + 1,
  };
}

function safeInt(val: string | null, fallback: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}
