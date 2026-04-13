/**
 * Skill Builder — Gap Map
 *
 * Identifies missing areas from a coverage audit report.
 */

import type { CoverageAuditReport } from './skillBuilderCoverageAudit';

// ── Types ──────────────────────────────────────────────────────────

export interface SkillGap {
  skill: string;
  level: number;
  missingPatterns: string[];
  reason: string;
}

export interface PatternGap {
  focusPattern: string;
  skill: string;
  reason: string;
  needsPressureVariants: boolean;
  needsMultiThreadVariants: boolean;
}

export interface GapMapResult {
  skillGaps: SkillGap[];
  patternGaps: PatternGap[];
}

// ── Pressure / Multi-Thread Expectations ──────────────────────────

const PRESSURE_EXPECTED: Record<string, number> = {
  objection_handling: 2,
  deal_control: 2,
  executive_response: 2,
  discovery: 3,
  qualification: 3,
};

const MULTI_THREAD_EXPECTED: Record<string, number> = {
  deal_control: 3,
  executive_response: 3,
  discovery: 4,
  qualification: 3,
};

// ── Main ──────────────────────────────────────────────────────────

export function getSkillBuilderGapMap(report: CoverageAuditReport): GapMapResult {
  const skillGaps: SkillGap[] = [];
  const patternGaps: PatternGap[] = [];

  // Pattern-level gaps
  for (const p of report.perPattern) {
    const reasons: string[] = [];
    let needsPressure = false;
    let needsMT = false;

    if (p.totalKIs < 3) {
      reasons.push(`only ${p.totalKIs} KIs (need ≥3)`);
    }

    if (p.totalKIs >= 3 && p.uniqueTitleCount <= 1) {
      reasons.push('all KIs have near-identical titles');
    }

    // Pressure expected?
    const pressureMinLevel = PRESSURE_EXPECTED[p.skill];
    if (pressureMinLevel != null && p.level >= pressureMinLevel && p.pressureCount === 0) {
      needsPressure = true;
      reasons.push('no pressure variants at this level');
    }

    // Multi-thread expected?
    const mtMinLevel = MULTI_THREAD_EXPECTED[p.skill];
    if (mtMinLevel != null && p.level >= mtMinLevel && p.multiThreadCount === 0) {
      needsMT = true;
      reasons.push('no multi-thread variants at this level');
    }

    if (reasons.length > 0) {
      patternGaps.push({
        focusPattern: p.focusPattern,
        skill: p.skill,
        reason: reasons.join('; '),
        needsPressureVariants: needsPressure,
        needsMultiThreadVariants: needsMT,
      });
    }
  }

  // Skill-level gaps
  for (const s of report.perSkill) {
    if (s.thinPatterns.length > 0) {
      // Group thin patterns by level
      const thinByLevel = new Map<number, string[]>();
      for (const tp of s.thinPatterns) {
        const patternAudit = report.perPattern.find(p => p.focusPattern === tp && p.skill === s.skill);
        const level = patternAudit?.level ?? 1;
        if (!thinByLevel.has(level)) thinByLevel.set(level, []);
        thinByLevel.get(level)!.push(tp);
      }

      for (const [level, patterns] of thinByLevel) {
        let reason = `${patterns.length} thin pattern(s) at level ${level}`;
        if (!s.hasEnoughFor30) reason += ' — blocks 30-min viability';
        if (!s.hasEnoughFor60) reason += ' — blocks 60-min viability';

        skillGaps.push({
          skill: s.skill,
          level,
          missingPatterns: patterns,
          reason,
        });
      }
    }
  }

  // Sort by severity
  patternGaps.sort((a, b) => {
    const scoreA = (a.needsPressureVariants ? 2 : 0) + (a.needsMultiThreadVariants ? 2 : 0) + (a.reason.includes('only') ? 1 : 0);
    const scoreB = (b.needsPressureVariants ? 2 : 0) + (b.needsMultiThreadVariants ? 2 : 0) + (b.reason.includes('only') ? 1 : 0);
    return scoreB - scoreA;
  });

  skillGaps.sort((a, b) => b.missingPatterns.length - a.missingPatterns.length);

  return { skillGaps, patternGaps };
}
