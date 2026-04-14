/**
 * SkillSession — Shared context passed between Learn, Skill Builder, and Dojo.
 *
 * This is the bridge that connects all training surfaces. When a user clicks
 * "Train" or "Practice" from Learn, the SkillSession travels with them.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface SkillSession {
  skillId: SkillFocus;
  skillName: string;
  currentTier: number;
  currentLevel: number;
  targetTier: number;
  /** What pattern/sub-skill to focus on */
  focusPattern?: string;
  /** Top blocker description */
  topBlocker?: string;
  scenarioType?: 'foundational' | 'intermediate' | 'advanced';
  context?: {
    account?: string;
    persona?: string;
    dealStage?: string;
  };
}

/**
 * Build a SkillSession from a UserSkillLevel.
 */
export function buildSkillSession(
  level: {
    skill: SkillFocus;
    currentTier: number;
    overallLevel: number;
    gaps: { metric: string; label: string }[];
    blockers: string[];
  },
  skillName: string,
): SkillSession {
  const difficulty = level.currentTier <= 2
    ? 'foundational'
    : level.currentTier <= 4
      ? 'intermediate'
      : 'advanced';

  return {
    skillId: level.skill,
    skillName,
    currentTier: level.currentTier,
    currentLevel: level.overallLevel,
    targetTier: Math.min(level.currentTier + 1, 6),
    focusPattern: level.gaps[0]?.metric,
    topBlocker: level.blockers[0],
    scenarioType: difficulty,
  };
}

/**
 * Serialize SkillSession to URL search params for navigation.
 */
export function skillSessionToParams(session: SkillSession): URLSearchParams {
  const params = new URLSearchParams();
  params.set('skillId', session.skillId);
  params.set('tier', String(session.currentTier));
  params.set('level', String(session.currentLevel));
  if (session.focusPattern) params.set('focus', session.focusPattern);
  if (session.scenarioType) params.set('scenario', session.scenarioType);
  return params;
}

/**
 * Parse SkillSession from URL search params (partial).
 */
export function skillSessionFromParams(params: URLSearchParams): Partial<SkillSession> {
  return {
    skillId: params.get('skillId') as SkillFocus | undefined,
    currentTier: params.get('tier') ? Number(params.get('tier')) : undefined,
    currentLevel: params.get('level') ? Number(params.get('level')) : undefined,
    focusPattern: params.get('focus') ?? undefined,
    scenarioType: params.get('scenario') as SkillSession['scenarioType'] | undefined,
  };
}
