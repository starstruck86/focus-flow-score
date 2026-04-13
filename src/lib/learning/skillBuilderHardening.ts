/**
 * Skill Builder — Hardening Helpers
 *
 * Practical helper layer so future content and curriculum work
 * can target the right places. Not a UI layer.
 */

import type { SkillBuilderCurationPlan, CurationTask } from './skillBuilderCurationPlan';
import type { CoverageAuditReport } from './skillBuilderCoverageAudit';
import type { GapMapResult } from './skillBuilderGapMap';

// ── Choose patterns to harden ─────────────────────────────────────

export function choosePatternsForHardening(
  plan: SkillBuilderCurationPlan,
  skill?: string,
): CurationTask[] {
  let tasks = plan.tasks.filter(
    t => t.focusPattern != null && (t.type === 'fill_pattern_gap' || t.type === 'add_pressure_variants' || t.type === 'add_multi_thread_variants'),
  );

  if (skill) {
    tasks = tasks.filter(t => t.skill === skill);
  }

  return tasks;
}

// ── Get redundancy candidates ─────────────────────────────────────

export function getRedundancyCandidates(
  report: CoverageAuditReport,
): Array<{ focusPattern: string; skill: string; likelyRedundantCount: number }> {
  return report.perPattern
    .filter(p => p.likelyRedundantCount >= 2)
    .map(p => ({
      focusPattern: p.focusPattern,
      skill: p.skill,
      likelyRedundantCount: p.likelyRedundantCount,
    }))
    .sort((a, b) => b.likelyRedundantCount - a.likelyRedundantCount);
}

// ── Get missing variant targets ───────────────────────────────────

export function getMissingVariantTargets(
  gaps: GapMapResult,
): Array<{ focusPattern: string; skill: string; needsPressureVariants: boolean; needsMultiThreadVariants: boolean }> {
  return gaps.patternGaps
    .filter(g => g.needsPressureVariants || g.needsMultiThreadVariants)
    .map(g => ({
      focusPattern: g.focusPattern,
      skill: g.skill,
      needsPressureVariants: g.needsPressureVariants,
      needsMultiThreadVariants: g.needsMultiThreadVariants,
    }));
}

// ── Coverage-aware depth check ────────────────────────────────────
// Used by the engine to decide whether to attempt full depth or degrade

export interface SkillDepthProfile {
  skill: string;
  viableFor15: boolean;
  viableFor30: boolean;
  viableFor60: boolean;
  usablePatternCount: number;
  deepPatternCount: number;
  shouldDegrade60: boolean;
}

export function getSkillDepthProfile(
  report: CoverageAuditReport,
  skill: string,
): SkillDepthProfile | null {
  const s = report.perSkill.find(sk => sk.skill === skill);
  if (!s) return null;

  return {
    skill: s.skill,
    viableFor15: s.hasEnoughFor15,
    viableFor30: s.hasEnoughFor30,
    viableFor60: s.hasEnoughFor60,
    usablePatternCount: s.usablePatterns.length,
    deepPatternCount: s.deepPatterns.length,
    shouldDegrade60: !s.hasEnoughFor60,
  };
}

// ── Pattern coverage check for engine ─────────────────────────────

export function getPatternCoverage(
  report: CoverageAuditReport,
  focusPattern: string,
  skill: string,
): { hasPressure: boolean; hasMultiThread: boolean; depth: 'thin' | 'usable' | 'deep' } | null {
  const p = report.perPattern.find(pp => pp.focusPattern === focusPattern && pp.skill === skill);
  if (!p) return null;
  return {
    hasPressure: p.pressureCount > 0,
    hasMultiThread: p.multiThreadCount > 0,
    depth: p.depthRating,
  };
}
