/**
 * Sub-Skill Progress Types
 *
 * Shared types for the sub-skill progression system.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface SubSkillProgress {
  skill: SkillFocus;
  subSkill: string;

  score: number;           // 0–100
  consistency: number;     // 0–100
  pressureScore?: number | null;

  progressBand: 'weak' | 'building' | 'strong';

  relatedPatterns: string[];
  relatedConcepts: string[];

  blockerForNextTier: boolean;
  blockerReason?: string | null;
}

export interface SkillSubSkillSummary {
  skill: SkillFocus;
  subSkills: SubSkillProgress[];

  strongestSubSkills: string[];
  weakestSubSkills: string[];

  blockersForNextTier: string[];
}
