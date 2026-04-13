/**
 * Dynamic Playbook Engine — Cache Layer
 *
 * Lightweight runtime/session cache for assembled playbooks.
 * Invalidated when KI content changes for affected skills.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { AssembledPlaybook } from './learnPlaybookSchema';

// ── Cache Store ───────────────────────────────────────────────────

const cache = new Map<string, { result: AssembledPlaybook; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cacheKey(playbookId: string, durationMinutes: number, mode: string): string {
  return `${playbookId}::${durationMinutes}::${mode}`;
}

// ── Public API ────────────────────────────────────────────────────

export function getCachedPlaybook(
  playbookId: string,
  durationMinutes: number,
  mode: 'learn' | 'skill_builder',
): AssembledPlaybook | null {
  const key = cacheKey(playbookId, durationMinutes, mode);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedPlaybook(result: AssembledPlaybook): void {
  // Infer mode from context — cache with both modes to be safe
  for (const mode of ['learn', 'skill_builder']) {
    const key = cacheKey(result.playbookId, result.durationMinutes, mode);
    cache.set(key, { result, timestamp: Date.now() });
  }
}

export function invalidatePlaybookCacheForSkill(skill: SkillFocus): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.result.skill === skill) {
      cache.delete(key);
    }
  }
}

/** Clear entire cache (useful for dev/testing) */
export function clearPlaybookCache(): void {
  cache.clear();
}

/** Get cache stats for diagnostics */
export function getPlaybookCacheStats(): { size: number; skills: string[] } {
  const skills = new Set<string>();
  for (const entry of cache.values()) {
    skills.add(entry.result.skill);
  }
  return { size: cache.size, skills: Array.from(skills) };
}
