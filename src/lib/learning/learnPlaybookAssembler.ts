/**
 * Dynamic Playbook Engine — Assembler
 *
 * Assembles a playbook from indexed KIs using coverage-aware selection.
 * Enforces concept coverage, deduplication, role variety, and difficulty escalation.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { IndexedKI } from './learnKIIndexer';
import type {
  PlaybookDefinition,
  PlaybookSlot,
  AssembledPlaybook,
  KILessonRole,
} from './learnPlaybookSchema';
import { getPlaybookById } from './learnPlaybookSchema';
import { buildCoverageForSkill } from './learnCoverageMap';

// ── Config ─────────────────────────────────────────────────────────

const KIS_PER_MINUTE = 0.5; // ~2 min per KI on average
const MIN_SLOTS = 4;
const MAX_REDUNDANCY_PER_GROUP = 2;

// ── Main Assembler ────────────────────────────────────────────────

export interface AssembleOptions {
  playbookId: string;
  durationMinutes: number;
  mode: 'learn' | 'skill_builder';
}

export function assemblePlaybook(
  options: AssembleOptions,
  index: IndexedKI[],
): AssembledPlaybook {
  const playbook = getPlaybookById(options.playbookId);
  if (!playbook) {
    return emptyResult(options, 'Playbook not found');
  }

  const { durationMinutes } = options;
  const targetSlots = Math.max(MIN_SLOTS, Math.round(durationMinutes * KIS_PER_MINUTE));

  // Get candidate KIs for this playbook
  const candidates = filterCandidates(index, playbook);

  if (candidates.length < MIN_SLOTS) {
    return emptyResult(options, `Only ${candidates.length} KIs available — not enough for assembly`, playbook);
  }

  // Check coverage depth for graceful degradation
  const coverage = buildCoverageForSkill(index, playbook.skill);
  const shouldDegrade =
    (durationMinutes >= 60 && !coverage.viableFor60) ||
    (durationMinutes >= 30 && !coverage.viableFor30);

  const effectiveSlots = shouldDegrade
    ? Math.min(targetSlots, Math.ceil(candidates.length * 0.7))
    : targetSlots;

  // Phase 1: Fill required concepts
  const slots: PlaybookSlot[] = [];
  const usedKIIds = new Set<string>();
  const usedRedundancyKeys = new Map<string, number>();
  let sectionIndex = 0;

  for (const concept of playbook.requiredConcepts) {
    const conceptKIs = candidates.filter(
      ki => ki.concepts.includes(concept) && !usedKIIds.has(ki.kiId),
    );
    const picked = pickBestForConcept(conceptKIs, concept, usedRedundancyKeys);
    if (picked) {
      slots.push(makeSlot(picked, concept, 'core_concept', sectionIndex));
      usedKIIds.add(picked.kiId);
      trackRedundancy(picked, usedRedundancyKeys);
      sectionIndex++;
    }
  }

  // Phase 2: Fill optional concepts
  for (const concept of playbook.optionalConcepts) {
    if (slots.length >= effectiveSlots) break;
    const conceptKIs = candidates.filter(
      ki => ki.concepts.includes(concept) && !usedKIIds.has(ki.kiId),
    );
    const picked = pickBestForConcept(conceptKIs, concept, usedRedundancyKeys);
    if (picked) {
      slots.push(makeSlot(picked, concept, 'core_concept', sectionIndex));
      usedKIIds.add(picked.kiId);
      trackRedundancy(picked, usedRedundancyKeys);
      sectionIndex++;
    }
  }

  // Phase 3: Fill remaining slots with variety
  const remainingSlots = effectiveSlots - slots.length;
  if (remainingSlots > 0) {
    const fillers = fillWithVariety(
      candidates,
      usedKIIds,
      usedRedundancyKeys,
      remainingSlots,
      sectionIndex,
      playbook,
    );
    slots.push(...fillers);
  }

  // Phase 4: Sort by difficulty for escalation
  slots.sort((a, b) => a.difficulty - b.difficulty);
  // Re-assign section indices after sort
  slots.forEach((s, i) => { s.sectionIndex = i; });

  // Compute coverage stats
  const coveredConcepts = [...new Set(slots.map(s => s.concept))];
  const allRequired = [...playbook.requiredConcepts, ...playbook.optionalConcepts];
  const missingConcepts = allRequired.filter(c => !coveredConcepts.includes(c));

  return {
    playbookId: options.playbookId,
    label: playbook.label,
    skill: playbook.skill,
    durationMinutes: options.durationMinutes,
    slots,
    conceptsCovered: coveredConcepts,
    conceptsMissing: missingConcepts,
    degraded: shouldDegrade,
    degradationReason: shouldDegrade
      ? `Skill "${playbook.skill}" lacks depth for ${durationMinutes} min — session tightened`
      : undefined,
  };
}

// ── Candidate Filtering ───────────────────────────────────────────

function filterCandidates(index: IndexedKI[], playbook: PlaybookDefinition): IndexedKI[] {
  return index.filter(ki => {
    // Must match skill
    if (ki.skill !== playbook.skill) return false;

    // Must match at least one target pattern or context
    const matchesPattern = ki.focusPatterns.some(p => playbook.targetPatterns.includes(p));
    const matchesContext = ki.contexts.some(c => playbook.targetContexts.includes(c));

    return matchesPattern || matchesContext;
  });
}

// ── Selection Logic ───────────────────────────────────────────────

function pickBestForConcept(
  candidates: IndexedKI[],
  _concept: string,
  usedRedundancyKeys: Map<string, number>,
): IndexedKI | null {
  if (candidates.length === 0) return null;

  // Score each candidate
  const scored = candidates.map(ki => {
    let score = ki.sourceQuality;

    // Penalize redundancy
    const redundancyCount = usedRedundancyKeys.get(ki.redundancyKey) ?? 0;
    if (redundancyCount >= MAX_REDUNDANCY_PER_GROUP) score -= 1000;
    else score -= redundancyCount * 20;

    // Reward role variety
    if (ki.lessonRoles.length > 1) score += 5;
    if (ki.lessonRoles.includes('example')) score += 3;
    if (ki.lessonRoles.includes('practice_seed')) score += 3;

    return { ki, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.ki ?? null;
}

function fillWithVariety(
  candidates: IndexedKI[],
  usedKIIds: Set<string>,
  usedRedundancyKeys: Map<string, number>,
  count: number,
  startSection: number,
  playbook: PlaybookDefinition,
): PlaybookSlot[] {
  const slots: PlaybookSlot[] = [];
  const roleQuota: Record<KILessonRole, number> = {
    core_concept: 0,
    example: 0,
    counterexample: 0,
    framework_step: 0,
    cheat: 0,
    diagnostic: 0,
    practice_seed: 0,
  };

  // Sort remaining candidates by quality, penalize redundancy
  const remaining = candidates
    .filter(ki => !usedKIIds.has(ki.kiId))
    .map(ki => {
      const redundancyCount = usedRedundancyKeys.get(ki.redundancyKey) ?? 0;
      const redundancyPenalty = redundancyCount >= MAX_REDUNDANCY_PER_GROUP ? -1000 : redundancyCount * -20;
      return { ki, score: ki.sourceQuality + redundancyPenalty };
    })
    .sort((a, b) => b.score - a.score);

  for (const { ki } of remaining) {
    if (slots.length >= count) break;
    if (usedKIIds.has(ki.kiId)) continue;

    const redundancyCount = usedRedundancyKeys.get(ki.redundancyKey) ?? 0;
    if (redundancyCount >= MAX_REDUNDANCY_PER_GROUP) continue;

    // Pick least-used role this KI can fill
    const bestRole = pickLeastUsedRole(ki.lessonRoles, roleQuota);
    const concept = ki.concepts[0] ?? playbook.requiredConcepts[0] ?? 'general';

    slots.push(makeSlot(ki, concept, bestRole, startSection + slots.length));
    usedKIIds.add(ki.kiId);
    trackRedundancy(ki, usedRedundancyKeys);
    roleQuota[bestRole]++;
  }

  return slots;
}

function pickLeastUsedRole(
  available: KILessonRole[],
  quota: Record<KILessonRole, number>,
): KILessonRole {
  let bestRole: KILessonRole = available[0] ?? 'core_concept';
  let bestCount = Infinity;
  for (const role of available) {
    if ((quota[role] ?? 0) < bestCount) {
      bestCount = quota[role] ?? 0;
      bestRole = role;
    }
  }
  return bestRole;
}

// ── Slot Builder ──────────────────────────────────────────────────

function makeSlot(
  ki: IndexedKI,
  concept: string,
  role: KILessonRole,
  sectionIndex: number,
): PlaybookSlot {
  return {
    kiId: ki.kiId,
    title: ki.title,
    role,
    concept,
    difficulty: ki.difficulty,
    sectionIndex,
  };
}

function trackRedundancy(ki: IndexedKI, map: Map<string, number>): void {
  map.set(ki.redundancyKey, (map.get(ki.redundancyKey) ?? 0) + 1);
}

function emptyResult(
  options: AssembleOptions,
  reason: string,
  playbook?: PlaybookDefinition,
): AssembledPlaybook {
  return {
    playbookId: options.playbookId,
    label: playbook?.label ?? options.playbookId,
    skill: playbook?.skill ?? ('discovery' as SkillFocus),
    durationMinutes: options.durationMinutes,
    slots: [],
    conceptsCovered: [],
    conceptsMissing: playbook?.requiredConcepts ?? [],
    degraded: true,
    degradationReason: reason,
  };
}

// ── Public Helpers ────────────────────────────────────────────────

/** Quick check: can a playbook support a given duration? */
export function canSupportDuration(
  playbookId: string,
  durationMinutes: number,
  index: IndexedKI[],
): boolean {
  const result = assemblePlaybook({ playbookId, durationMinutes, mode: 'learn' }, index);
  return !result.degraded && result.slots.length >= MIN_SLOTS;
}

/** Get all viable playbooks for a skill at a given duration */
export function getViablePlaybooks(
  skill: SkillFocus,
  durationMinutes: number,
  index: IndexedKI[],
  registry: PlaybookDefinition[],
): string[] {
  return registry
    .filter(p => p.skill === skill)
    .filter(p => canSupportDuration(p.id, durationMinutes, index))
    .map(p => p.id);
}
