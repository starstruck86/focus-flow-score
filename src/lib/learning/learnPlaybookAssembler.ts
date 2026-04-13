/**
 * Dynamic Playbook Engine — Assembler
 *
 * Assembles a playbook from indexed KIs using coverage-aware selection.
 * Enforces concept coverage, deduplication, role variety, difficulty escalation,
 * and quality-aware scoring with freshness and thin-concept boosts.
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
import { getCachedPlaybook, setCachedPlaybook } from './learnPlaybookCache';

// ── Config ─────────────────────────────────────────────────────────

const KIS_PER_MINUTE = 0.5; // ~2 min per KI on average
const MIN_SLOTS = 4;
const MAX_REDUNDANCY_PER_GROUP = 2;

// ── Candidate Scoring ─────────────────────────────────────────────

export interface KICandidateScore {
  sourceQuality: number;
  roleFit: number;
  freshnessBoost: number;
  thinConceptBoost: number;
  redundancyPenalty: number;
  overusePenalty: number;
  total: number;
}

function scoreCandidate(
  ki: IndexedKI,
  context: {
    thinConcepts: string[];
    overusedConcepts: string[];
    usedRedundancyKeys: Map<string, number>;
    targetDifficulty?: number;
    desiredRoles?: KILessonRole[];
  },
): KICandidateScore {
  // 1. Source quality (0-100 range)
  const sourceQuality = ki.sourceQuality;

  // 2. Role fit bonus
  let roleFit = 0;
  if (ki.lessonRoles.length > 1) roleFit += 5;
  if (context.desiredRoles) {
    const matchCount = ki.lessonRoles.filter(r => context.desiredRoles!.includes(r)).length;
    roleFit += matchCount * 4;
  }
  if (ki.lessonRoles.includes('example')) roleFit += 3;
  if (ki.lessonRoles.includes('practice_seed')) roleFit += 3;

  // 3. Freshness boost (moderate — never overpowers quality)
  let freshnessBoost = 0;
  if (ki.freshnessTimestamp) {
    const ageMs = Date.now() - new Date(ki.freshnessTimestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 3) freshnessBoost = 8;
    else if (ageDays < 7) freshnessBoost = 5;
    else if (ageDays < 14) freshnessBoost = 2;
  }

  // 4. Thin concept boost (significant — drives coverage improvement)
  let thinConceptBoost = 0;
  const fillsThin = ki.concepts.filter(c => context.thinConcepts.includes(c));
  thinConceptBoost = fillsThin.length * 12;

  // 5. Redundancy penalty
  let redundancyPenalty = 0;
  const redundancyCount = context.usedRedundancyKeys.get(ki.redundancyKey) ?? 0;
  if (redundancyCount >= MAX_REDUNDANCY_PER_GROUP) {
    redundancyPenalty = -1000;
  } else {
    redundancyPenalty = -(redundancyCount * 20);
  }

  // 6. Overuse penalty
  let overusePenalty = 0;
  const hitsOverused = ki.concepts.filter(c => context.overusedConcepts.includes(c));
  overusePenalty = -(hitsOverused.length * 8);

  const total = sourceQuality + roleFit + freshnessBoost + thinConceptBoost + redundancyPenalty + overusePenalty;

  return { sourceQuality, roleFit, freshnessBoost, thinConceptBoost, redundancyPenalty, overusePenalty, total };
}

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
  // Check cache first
  const cached = getCachedPlaybook(options.playbookId, options.durationMinutes, options.mode);
  if (cached) return cached;

  const playbook = getPlaybookById(options.playbookId);
  if (!playbook) {
    return emptyResult(options, 'Playbook not found');
  }

  const { durationMinutes } = options;
  const targetSlots = Math.max(MIN_SLOTS, Math.round(durationMinutes * KIS_PER_MINUTE));

  // Get candidate KIs and coverage context
  const candidates = filterCandidates(index, playbook);
  const coverage = buildCoverageForSkill(index, playbook.skill);

  if (candidates.length < MIN_SLOTS) {
    return emptyResult(options, `Only ${candidates.length} KIs available — not enough for assembly`, playbook);
  }

  // Scoring context
  const scoringContext = {
    thinConcepts: coverage.thinConcepts,
    overusedConcepts: coverage.overusedConcepts,
    usedRedundancyKeys: new Map<string, number>(),
  };

  // Graceful degradation
  const shouldDegrade =
    (durationMinutes >= 60 && !coverage.viableFor60) ||
    (durationMinutes >= 30 && !coverage.viableFor30);

  const effectiveSlots = shouldDegrade
    ? Math.min(targetSlots, Math.ceil(candidates.length * 0.7))
    : targetSlots;

  // Phase 1: Fill required concepts (scored selection)
  const slots: PlaybookSlot[] = [];
  const usedKIIds = new Set<string>();
  let sectionIndex = 0;

  for (const concept of playbook.requiredConcepts) {
    const conceptKIs = candidates.filter(
      ki => ki.concepts.includes(concept) && !usedKIIds.has(ki.kiId),
    );
    const picked = pickBestScored(conceptKIs, scoringContext);
    if (picked) {
      slots.push(makeSlot(picked, concept, 'core_concept', sectionIndex));
      usedKIIds.add(picked.kiId);
      trackRedundancy(picked, scoringContext.usedRedundancyKeys);
      sectionIndex++;
    }
  }

  // Phase 2: Fill optional concepts
  for (const concept of playbook.optionalConcepts) {
    if (slots.length >= effectiveSlots) break;
    const conceptKIs = candidates.filter(
      ki => ki.concepts.includes(concept) && !usedKIIds.has(ki.kiId),
    );
    const picked = pickBestScored(conceptKIs, scoringContext);
    if (picked) {
      slots.push(makeSlot(picked, concept, 'core_concept', sectionIndex));
      usedKIIds.add(picked.kiId);
      trackRedundancy(picked, scoringContext.usedRedundancyKeys);
      sectionIndex++;
    }
  }

  // Phase 3: Fill remaining slots with scored variety
  const remainingSlots = effectiveSlots - slots.length;
  if (remainingSlots > 0) {
    const fillers = fillWithScoredVariety(
      candidates,
      usedKIIds,
      scoringContext,
      remainingSlots,
      sectionIndex,
      playbook,
    );
    slots.push(...fillers);
  }

  // Phase 4: Sort by difficulty for escalation
  slots.sort((a, b) => a.difficulty - b.difficulty);
  slots.forEach((s, i) => { s.sectionIndex = i; });

  // Compute coverage stats
  const coveredConcepts = [...new Set(slots.map(s => s.concept))];
  const allRequired = [...playbook.requiredConcepts, ...playbook.optionalConcepts];
  const missingConcepts = allRequired.filter(c => !coveredConcepts.includes(c));

  const result: AssembledPlaybook = {
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

  // Cache the result
  setCachedPlaybook(result);

  return result;
}

// ── Candidate Filtering ───────────────────────────────────────────

function filterCandidates(index: IndexedKI[], playbook: PlaybookDefinition): IndexedKI[] {
  return index.filter(ki => {
    if (ki.skill !== playbook.skill) return false;
    const matchesPattern = ki.focusPatterns.some(p => playbook.targetPatterns.includes(p));
    const matchesContext = ki.contexts.some(c => playbook.targetContexts.includes(c));
    return matchesPattern || matchesContext;
  });
}

// ── Scored Selection ──────────────────────────────────────────────

function pickBestScored(
  candidates: IndexedKI[],
  context: {
    thinConcepts: string[];
    overusedConcepts: string[];
    usedRedundancyKeys: Map<string, number>;
  },
): IndexedKI | null {
  if (candidates.length === 0) return null;

  const scored = candidates.map(ki => ({
    ki,
    score: scoreCandidate(ki, context),
  }));

  scored.sort((a, b) => b.score.total - a.score.total);
  return scored[0]?.ki ?? null;
}

function fillWithScoredVariety(
  candidates: IndexedKI[],
  usedKIIds: Set<string>,
  scoringContext: {
    thinConcepts: string[];
    overusedConcepts: string[];
    usedRedundancyKeys: Map<string, number>;
  },
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

  // Score and sort all remaining candidates
  const remaining = candidates
    .filter(ki => !usedKIIds.has(ki.kiId))
    .map(ki => ({
      ki,
      score: scoreCandidate(ki, scoringContext),
    }))
    .sort((a, b) => b.score.total - a.score.total);

  for (const { ki } of remaining) {
    if (slots.length >= count) break;
    if (usedKIIds.has(ki.kiId)) continue;

    const redundancyCount = scoringContext.usedRedundancyKeys.get(ki.redundancyKey) ?? 0;
    if (redundancyCount >= MAX_REDUNDANCY_PER_GROUP) continue;

    const bestRole = pickLeastUsedRole(ki.lessonRoles, roleQuota);
    const concept = ki.concepts[0] ?? playbook.requiredConcepts[0] ?? 'general';

    slots.push(makeSlot(ki, concept, bestRole, startSection + slots.length));
    usedKIIds.add(ki.kiId);
    trackRedundancy(ki, scoringContext.usedRedundancyKeys);
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
