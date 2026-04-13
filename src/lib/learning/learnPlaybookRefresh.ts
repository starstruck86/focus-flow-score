/**
 * Dynamic Playbook Engine — Refresh Layer
 *
 * Handles incremental KI changes: re-indexes affected KIs,
 * refreshes coverage for affected skills, and invalidates caches.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import { indexSingleKI, mergeIndexedKI, type IndexedKI } from './learnKIIndexer';
import { getAffectedSkillsFromIndexedKI } from './learnCoverageMap';
import { invalidatePlaybookCacheForSkill } from './learnPlaybookCache';

// ── Runtime Index Store ───────────────────────────────────────────
// Holds the current session's index. Rebuilt on first use, then
// incrementally updated as KIs change.

let _currentIndex: IndexedKI[] | null = null;

export function getCurrentIndex(): IndexedKI[] | null {
  return _currentIndex;
}

export function setCurrentIndex(index: IndexedKI[]): void {
  _currentIndex = index;
}

// ── Refresh Functions ─────────────────────────────────────────────

/**
 * Re-index specific KIs by ID and merge into the current index.
 * Refreshes coverage and invalidates caches for all affected skills.
 */
export async function refreshKIIndexForChangedKIs(kiIds: string[]): Promise<void> {
  if (!_currentIndex || kiIds.length === 0) return;

  const affectedSkills = new Set<SkillFocus>();

  for (const kiId of kiIds) {
    const updated = await indexSingleKI(kiId);

    if (updated) {
      // Track skills affected by the new version
      for (const skill of getAffectedSkillsFromIndexedKI(updated)) {
        affectedSkills.add(skill);
      }
      _currentIndex = mergeIndexedKI(_currentIndex, updated);
    } else {
      // KI was deleted or deactivated — find old entry skills before removing
      const oldEntry = _currentIndex.find(ki => ki.kiId === kiId);
      if (oldEntry) {
        for (const skill of getAffectedSkillsFromIndexedKI(oldEntry)) {
          affectedSkills.add(skill);
        }
        _currentIndex = _currentIndex.filter(ki => ki.kiId !== kiId);
      }
    }
  }

  // Invalidate caches for all affected skills
  for (const skill of affectedSkills) {
    await invalidatePlaybookCachesForSkill(skill);
  }
}

/**
 * Refresh coverage data for a specific skill.
 * This is a no-op on the index itself — coverage is computed on demand
 * from the index. But it invalidates caches so next assembly uses fresh data.
 */
export async function refreshCoverageForSkill(skill: SkillFocus): Promise<void> {
  invalidatePlaybookCacheForSkill(skill);
}

/**
 * Invalidate all cached playbooks for a given skill.
 */
export async function invalidatePlaybookCachesForSkill(skill: SkillFocus): Promise<void> {
  invalidatePlaybookCacheForSkill(skill);
}

/**
 * Handle a single KI change — the main entry point for the refresh lifecycle.
 *
 * Lifecycle:
 * 1. KI added/updated
 * 2. KI re-indexed
 * 3. Affected skills identified
 * 4. Coverage refreshed (cache invalidated)
 * 5. Next playbook assembly naturally includes the KI if it improves quality
 */
export async function handleKIChange(kiId: string): Promise<void> {
  await refreshKIIndexForChangedKIs([kiId]);
}

// ── Promotion Diagnostics ─────────────────────────────────────────

/**
 * Explain why a KI would be selected (or not) in the current context.
 * Useful for internal audit/debug.
 */
export function explainKISelection(
  ki: IndexedKI,
  context: {
    thinConcepts: string[];
    overusedConcepts: string[];
    usedRedundancyKeys: string[];
  },
): string[] {
  const reasons: string[] = [];

  // Thin concept fill
  const fillsThin = ki.concepts.filter(c => context.thinConcepts.includes(c));
  if (fillsThin.length > 0) {
    reasons.push(`fills thin concept: ${fillsThin.join(', ')}`);
  }

  // Quality
  if (ki.sourceQuality >= 80) {
    reasons.push('high source quality (≥80)');
  }

  // Role diversity
  if (ki.lessonRoles.includes('example')) {
    reasons.push('adds example coverage to this playbook');
  }
  if (ki.lessonRoles.includes('counterexample')) {
    reasons.push('adds counterexample coverage');
  }
  if (ki.lessonRoles.includes('practice_seed')) {
    reasons.push('adds practice seed for active learning');
  }
  if (ki.lessonRoles.includes('framework_step')) {
    reasons.push('provides framework structure');
  }

  // Freshness
  if (ki.freshnessTimestamp) {
    const ageMs = Date.now() - new Date(ki.freshnessTimestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 7) {
      reasons.push('fresher than most candidates (< 7 days old)');
    }
  }

  // Redundancy
  const isRedundant = context.usedRedundancyKeys.includes(ki.redundancyKey);
  if (!isRedundant) {
    reasons.push('not blocked by redundancy cap');
  } else {
    reasons.push('⚠ redundancy key already used');
  }

  // Overuse penalty
  const hitsOverused = ki.concepts.filter(c => context.overusedConcepts.includes(c));
  if (hitsOverused.length > 0) {
    reasons.push(`⚠ contributes to overused concept: ${hitsOverused.join(', ')}`);
  }

  return reasons;
}
