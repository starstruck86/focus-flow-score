/**
 * Skill Builder — KI Cluster Map
 *
 * Maps focusPattern → { skill, level, kiIds[] }
 * Built dynamically from real KI data using the curriculum structure.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_CURRICULA } from './learnSkillCurriculum';
import type { KICatalogEntry } from '@/lib/dojo/v3/programmingEngine';

export interface KICluster {
  focusPattern: string;
  skill: SkillFocus;
  level: number;
  kiIds: string[];
}

/**
 * Build a cluster map from a KI catalog.
 * Groups KIs by focusPattern, then maps each cluster to the
 * curriculum level where that pattern appears.
 */
export function buildKIClusterMap(catalog: KICatalogEntry[]): Map<string, KICluster> {
  const clusters = new Map<string, KICluster>();

  // Build reverse mapping: focusPattern → { skill, level }
  const patternMeta = new Map<string, { skill: SkillFocus; level: number }>();
  for (const curriculum of Object.values(SKILL_CURRICULA)) {
    for (const lvl of curriculum.levels) {
      for (const pattern of lvl.focusPatterns) {
        // Use the first occurrence (lowest level) as the canonical mapping
        if (!patternMeta.has(pattern)) {
          patternMeta.set(pattern, { skill: curriculum.skill, level: lvl.level });
        }
      }
    }
  }

  // Group KIs into clusters by focusPattern
  for (const ki of catalog) {
    for (const pattern of ki.focusPatterns) {
      const meta = patternMeta.get(pattern);
      if (!meta) continue; // skip patterns not in curriculum

      if (!clusters.has(pattern)) {
        clusters.set(pattern, {
          focusPattern: pattern,
          skill: meta.skill,
          level: meta.level,
          kiIds: [],
        });
      }

      const cluster = clusters.get(pattern)!;
      if (!cluster.kiIds.includes(ki.id)) {
        cluster.kiIds.push(ki.id);
      }
    }
  }

  return clusters;
}

/**
 * Get clusters for a specific skill and optionally a specific level.
 */
export function getClustersForSkill(
  clusterMap: Map<string, KICluster>,
  skill: SkillFocus,
  level?: number,
): KICluster[] {
  return Array.from(clusterMap.values()).filter(c => {
    if (c.skill !== skill) return false;
    if (level != null && c.level !== level) return false;
    return true;
  });
}

/**
 * Get all KI IDs for a skill at a given level.
 */
export function getKIIdsForLevel(
  clusterMap: Map<string, KICluster>,
  skill: SkillFocus,
  level: number,
): string[] {
  const ids = new Set<string>();
  for (const cluster of getClustersForSkill(clusterMap, skill, level)) {
    for (const id of cluster.kiIds) ids.add(id);
  }
  return Array.from(ids);
}
