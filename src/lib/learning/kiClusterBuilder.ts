/**
 * Skill Builder — KI Cluster Builder
 *
 * Helper functions for grouping, inferring, and tagging KIs
 * for use in Skill Builder sessions.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { KICatalogEntry } from '@/lib/dojo/v3/programmingEngine';
import { SKILL_CURRICULA, type CurriculumLevel } from './learnSkillCurriculum';
import { CHAPTER_PATTERN_MAP, ANCHOR_SKILL_MAP } from '@/lib/dojo/v3/kiCatalogBridge';

// ── Group KIs by focusPattern ─────────────────────────────────────

export function groupKIsByPattern(catalog: KICatalogEntry[]): Map<string, KICatalogEntry[]> {
  const groups = new Map<string, KICatalogEntry[]>();
  for (const ki of catalog) {
    for (const pattern of ki.focusPatterns) {
      if (!groups.has(pattern)) groups.set(pattern, []);
      groups.get(pattern)!.push(ki);
    }
  }
  return groups;
}

// ── Infer skill from a KI ─────────────────────────────────────────

export function inferSkillFromKI(ki: KICatalogEntry): SkillFocus | null {
  if (ki.skills.length > 0) return ki.skills[0];
  return null;
}

// ── Infer curriculum level from focus patterns ────────────────────

export function inferLevelFromPatterns(
  skill: SkillFocus,
  patterns: string[],
): number {
  const curriculum = SKILL_CURRICULA[skill];
  if (!curriculum) return 1;

  // Find the highest level that matches any of the patterns
  let maxLevel = 1;
  for (const level of curriculum.levels) {
    for (const p of level.focusPatterns) {
      if (patterns.includes(p) && level.level > maxLevel) {
        maxLevel = level.level;
      }
    }
  }
  return maxLevel;
}

// ── Tag KIs with training context ─────────────────────────────────

export type KITag = 'pressure' | 'multi_thread' | 'executive' | 'competitive' | 'closing';

const TAG_KEYWORDS: Record<KITag, string[]> = {
  pressure: ['pressure', 'stress', 'tense', 'hostile', 'aggressive', 'pushback'],
  multi_thread: ['stakeholder', 'committee', 'multi-thread', 'champion', 'blocker', 'influencer'],
  executive: ['executive', 'c-suite', 'cfo', 'ceo', 'vp', 'board'],
  competitive: ['competitor', 'competitive', 'versus', 'alternative', 'switch'],
  closing: ['close', 'closing', 'commitment', 'sign', 'contract', 'procurement'],
};

export function tagKI(ki: KICatalogEntry): KITag[] {
  const tags: KITag[] = [];
  const titleLower = ki.title.toLowerCase();

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS) as [KITag, string[]][]) {
    if (keywords.some(kw => titleLower.includes(kw))) {
      tags.push(tag);
    }
  }

  return tags;
}

// ── Select KIs for a curriculum level ─────────────────────────────

/**
 * Select the best KIs for training a specific curriculum level.
 * Prioritizes KIs with matching focus patterns, avoids recently used ones.
 */
export function selectKIsForLevel(
  catalog: KICatalogEntry[],
  level: CurriculumLevel,
  recentKIIds: string[] = [],
  maxCount: number = 3,
): KICatalogEntry[] {
  // Score each KI based on pattern match
  const scored = catalog.map(ki => {
    let score = 0;
    for (const p of level.focusPatterns) {
      if (ki.focusPatterns.includes(p)) score += 10;
    }
    // Penalize recently used
    if (recentKIIds.includes(ki.id)) score -= 5;
    return { ki, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .map(s => s.ki);
}
