/**
 * Dynamic Playbook Engine — Coverage Map
 *
 * Builds a coverage map per skill / sub-skill / concept from the KI index.
 * Identifies what's covered, thin, overrepresented, or missing.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { IndexedKI } from './learnKIIndexer';
import { getRedundancyGroups } from './learnKIIndexer';
import { SKILL_DECOMPOSITIONS } from './learnSkillDecomposition';

// ── Types ──────────────────────────────────────────────────────────

export interface ConceptCoverage {
  concept: string;
  kiCount: number;
  uniqueRedundancyGroups: number;
  dominantRole: string;
  hasExamples: boolean;
  hasCounterexamples: boolean;
  hasPracticeSeeds: boolean;
  depthRating: 'thin' | 'usable' | 'deep';
}

export interface SubSkillCoverage {
  subSkill: string;
  kiCount: number;
  concepts: ConceptCoverage[];
  contexts: string[];
  depthRating: 'thin' | 'usable' | 'deep';
}

export interface SkillCoverage {
  skill: SkillFocus;
  label: string;
  totalKIs: number;
  uniqueRedundancyGroups: number;
  subSkills: SubSkillCoverage[];
  concepts: ConceptCoverage[];
  thinConcepts: string[];
  overusedConcepts: string[];
  missingContexts: string[];
  dominantPatterns: string[];
  weakPatterns: string[];
  viableFor15: boolean;
  viableFor30: boolean;
  viableFor60: boolean;
}

// ── Coverage Builder ──────────────────────────────────────────────

export function buildCoverageForSkill(
  index: IndexedKI[],
  skill: SkillFocus,
): SkillCoverage {
  const skillKIs = index.filter(ki => ki.skill === skill);
  const redundancyGroups = getRedundancyGroups(skillKIs);

  // Build concept coverage
  const conceptMap = new Map<string, IndexedKI[]>();
  for (const ki of skillKIs) {
    for (const c of ki.concepts) {
      if (!conceptMap.has(c)) conceptMap.set(c, []);
      conceptMap.get(c)!.push(ki);
    }
  }

  const concepts: ConceptCoverage[] = Array.from(conceptMap.entries()).map(
    ([concept, kis]) => {
      const groups = getRedundancyGroups(kis);
      const uniqueGroups = groups.size;
      const roles = kis.flatMap(ki => ki.lessonRoles);
      const roleCounts = new Map<string, number>();
      for (const r of roles) {
        roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
      }
      const dominantRole = [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'core_concept';

      return {
        concept,
        kiCount: kis.length,
        uniqueRedundancyGroups: uniqueGroups,
        dominantRole,
        hasExamples: kis.some(ki => ki.lessonRoles.includes('example')),
        hasCounterexamples: kis.some(ki => ki.lessonRoles.includes('counterexample')),
        hasPracticeSeeds: kis.some(ki => ki.lessonRoles.includes('practice_seed')),
        depthRating: rateDepth(uniqueGroups),
      };
    },
  );

  // Sub-skill coverage
  const decomp = SKILL_DECOMPOSITIONS[skill];
  const subSkills: SubSkillCoverage[] = decomp.subSkills.map(sub => {
    const subKIs = skillKIs.filter(ki => ki.subSkills.includes(sub.name));
    const subConcepts = new Map<string, IndexedKI[]>();
    for (const ki of subKIs) {
      for (const c of ki.concepts) {
        if (!subConcepts.has(c)) subConcepts.set(c, []);
        subConcepts.get(c)!.push(ki);
      }
    }
    const subConceptCoverage: ConceptCoverage[] = Array.from(subConcepts.entries()).map(
      ([concept, kis]) => {
        const groups = getRedundancyGroups(kis);
        return {
          concept,
          kiCount: kis.length,
          uniqueRedundancyGroups: groups.size,
          dominantRole: 'core_concept',
          hasExamples: kis.some(ki => ki.lessonRoles.includes('example')),
          hasCounterexamples: kis.some(ki => ki.lessonRoles.includes('counterexample')),
          hasPracticeSeeds: kis.some(ki => ki.lessonRoles.includes('practice_seed')),
          depthRating: rateDepth(groups.size),
        };
      },
    );

    const allContexts = new Set<string>();
    for (const ki of subKIs) {
      for (const c of ki.contexts) allContexts.add(c);
    }

    return {
      subSkill: sub.name,
      kiCount: subKIs.length,
      concepts: subConceptCoverage,
      contexts: Array.from(allContexts),
      depthRating: rateDepth(subKIs.length),
    };
  });

  // Thin / overused concepts
  const thinConcepts = concepts.filter(c => c.depthRating === 'thin').map(c => c.concept);
  const overusedConcepts = concepts
    .filter(c => c.kiCount > 20 && c.uniqueRedundancyGroups < c.kiCount * 0.4)
    .map(c => c.concept);

  // Pattern dominance
  const patternCounts = new Map<string, number>();
  for (const ki of skillKIs) {
    for (const p of ki.focusPatterns) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
    }
  }
  const sortedPatterns = [...patternCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dominantPatterns = sortedPatterns.slice(0, 3).map(([p]) => p);
  const weakPatterns = sortedPatterns.filter(([, c]) => c < 3).map(([p]) => p);

  // Missing contexts
  const allContexts = new Set<string>();
  for (const ki of skillKIs) {
    for (const c of ki.contexts) allContexts.add(c);
  }
  const expectedContexts = getExpectedContexts(skill);
  const missingContexts = expectedContexts.filter(c => !allContexts.has(c));

  // Viability
  const usableOrDeep = concepts.filter(c => c.depthRating !== 'thin').length;
  const uniqueGroups = redundancyGroups.size;

  return {
    skill,
    label: decomp.label,
    totalKIs: skillKIs.length,
    uniqueRedundancyGroups: uniqueGroups,
    subSkills,
    concepts,
    thinConcepts,
    overusedConcepts,
    missingContexts,
    dominantPatterns,
    weakPatterns,
    viableFor15: usableOrDeep >= 2 && skillKIs.length >= 5,
    viableFor30: usableOrDeep >= 3 && uniqueGroups >= 8,
    viableFor60: usableOrDeep >= 4 && uniqueGroups >= 15 && thinConcepts.length < concepts.length * 0.5,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function rateDepth(count: number): 'thin' | 'usable' | 'deep' {
  if (count <= 2) return 'thin';
  if (count <= 5) return 'usable';
  return 'deep';
}

function getExpectedContexts(skill: SkillFocus): string[] {
  const map: Record<SkillFocus, string[]> = {
    discovery: ['discovery', 'needs_analysis', 'qualification'],
    objection_handling: ['objection_handling', 'pricing', 'competitive'],
    deal_control: ['deal_control', 'closing', 'negotiation', 'follow_up'],
    executive_response: ['executive', 'c_suite', 'leadership'],
    qualification: ['qualification', 'discovery'],
  };
  return map[skill] ?? [];
}

// ── Public API ────────────────────────────────────────────────────

export function getCoverageForSkill(index: IndexedKI[], skill: SkillFocus): SkillCoverage {
  return buildCoverageForSkill(index, skill);
}

export function getCoverageForSubSkill(
  index: IndexedKI[],
  skill: SkillFocus,
  subSkillName: string,
): SubSkillCoverage | null {
  const coverage = buildCoverageForSkill(index, skill);
  return coverage.subSkills.find(s => s.subSkill === subSkillName) ?? null;
}

export function getThinConcepts(index: IndexedKI[], skill: SkillFocus): string[] {
  return buildCoverageForSkill(index, skill).thinConcepts;
}

export function getOverusedConcepts(index: IndexedKI[], skill: SkillFocus): string[] {
  return buildCoverageForSkill(index, skill).overusedConcepts;
}

/** Build full coverage map across all skills */
export function buildFullCoverageMap(index: IndexedKI[]): SkillCoverage[] {
  const skills: SkillFocus[] = ['discovery', 'objection_handling', 'deal_control', 'executive_response', 'qualification'];
  return skills.map(skill => buildCoverageForSkill(index, skill));
}
