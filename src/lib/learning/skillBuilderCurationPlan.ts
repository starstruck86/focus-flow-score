/**
 * Skill Builder — Curation Plan
 *
 * Turns audit output into a prioritized list of concrete curation tasks
 * so we know exactly what to improve next.
 */

import type { CoverageAuditReport } from './skillBuilderCoverageAudit';
import type { GapMapResult } from './skillBuilderGapMap';
import type { SequencingAuditResult } from './skillBuilderSequencingAudit';

// ── Types ──────────────────────────────────────────────────────────

export type CurationTaskType =
  | 'fill_pattern_gap'
  | 'add_pressure_variants'
  | 'add_multi_thread_variants'
  | 'reduce_redundancy'
  | 'improve_sequencing';

export interface CurationTask {
  type: CurationTaskType;
  priority: 'high' | 'medium' | 'low';
  skill: string;
  focusPattern?: string;
  level?: number;
  reason: string;
  action: string;
}

export interface SkillBuilderCurationPlan {
  tasks: CurationTask[];
  topPrioritySkills: string[];
  topPriorityPatterns: string[];
}

// ── Main ──────────────────────────────────────────────────────────

export function buildSkillBuilderCurationPlan(
  report: CoverageAuditReport,
  gaps: GapMapResult,
  sequencing: SequencingAuditResult[],
): SkillBuilderCurationPlan {
  const tasks: CurationTask[] = [];

  // 1. Skills not viable for 30 min — highest priority
  for (const s of report.perSkill) {
    if (!s.hasEnoughFor30) {
      tasks.push({
        type: 'fill_pattern_gap',
        priority: 'high',
        skill: s.skill,
        reason: `${s.skill.replace(/_/g, ' ')} cannot support 30-minute sessions (${s.coveredPatterns}/${s.totalPatterns} patterns covered)`,
        action: `Add KIs to thin patterns in ${s.skill.replace(/_/g, ' ')} until at least 3 patterns reach ≥3 KIs each`,
      });
    }
  }

  // 2. Skills not viable for 60 min
  for (const s of report.perSkill) {
    if (s.hasEnoughFor30 && !s.hasEnoughFor60) {
      tasks.push({
        type: 'fill_pattern_gap',
        priority: 'high',
        skill: s.skill,
        reason: `${s.skill.replace(/_/g, ' ')} supports 30-min but not 60-min sessions`,
        action: `Deepen ${s.skill.replace(/_/g, ' ')} patterns across multiple levels to reach 60-min viability`,
      });
    }
  }

  // 3. Thin patterns in core skills
  for (const pg of gaps.patternGaps) {
    if (pg.reason.includes('only')) {
      const patternAudit = report.perPattern.find(p => p.focusPattern === pg.focusPattern && p.skill === pg.skill);
      tasks.push({
        type: 'fill_pattern_gap',
        priority: (patternAudit?.totalKIs ?? 0) === 0 ? 'high' : 'medium',
        skill: pg.skill,
        focusPattern: pg.focusPattern,
        level: patternAudit?.level,
        reason: pg.reason,
        action: `Add ${3 - (patternAudit?.totalKIs ?? 0)}+ KIs for pattern "${pg.focusPattern.replace(/_/g, ' ')}"`,
      });
    }
  }

  // 4. Missing pressure variants
  for (const pg of gaps.patternGaps) {
    if (pg.needsPressureVariants) {
      tasks.push({
        type: 'add_pressure_variants',
        priority: 'medium',
        skill: pg.skill,
        focusPattern: pg.focusPattern,
        reason: `No pressure variants for "${pg.focusPattern.replace(/_/g, ' ')}" at expected level`,
        action: `Create 1–2 pressure-tagged KIs for this pattern with time_pressure or hostile_persona scenarios`,
      });
    }
  }

  // 5. Missing multi-thread variants
  for (const pg of gaps.patternGaps) {
    if (pg.needsMultiThreadVariants) {
      tasks.push({
        type: 'add_multi_thread_variants',
        priority: 'medium',
        skill: pg.skill,
        focusPattern: pg.focusPattern,
        reason: `No multi-thread variants for "${pg.focusPattern.replace(/_/g, ' ')}" at expected level`,
        action: `Create 1–2 multi-thread KIs for this pattern with stakeholder complexity scenarios`,
      });
    }
  }

  // 6. High redundancy clusters
  for (const alert of report.redundancyAlerts) {
    // Parse pattern name from alert string "pattern (skill): X/Y likely redundant"
    const match = alert.match(/^(.+?)\s+\((.+?)\):/);
    if (match) {
      tasks.push({
        type: 'reduce_redundancy',
        priority: 'low',
        skill: match[2],
        focusPattern: match[1],
        reason: alert,
        action: `Review and deduplicate KIs — keep the most distinct, archive near-duplicates`,
      });
    }
  }

  // 7. Weak sequencing cases
  for (const seq of sequencing) {
    if (seq.verdict === 'weak') {
      tasks.push({
        type: 'improve_sequencing',
        priority: 'medium',
        skill: seq.skill,
        reason: `${seq.skill.replace(/_/g, ' ')} ${seq.durationMinutes}m session has weak sequencing: ${seq.issues.join('; ')}`,
        action: `Ensure curriculum levels for ${seq.skill.replace(/_/g, ' ')} have enough distinct patterns to avoid repetition at ${seq.durationMinutes}m`,
      });
    }
  }

  // Deduplicate: one task per (type + skill + focusPattern)
  const deduped = deduplicateTasks(tasks);

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  deduped.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Compute top-priority skills and patterns
  const highTasks = deduped.filter(t => t.priority === 'high');
  const topPrioritySkills = [...new Set(highTasks.map(t => t.skill))];
  const topPriorityPatterns = [...new Set(
    highTasks.filter(t => t.focusPattern).map(t => t.focusPattern!)
  )];

  return { tasks: deduped, topPrioritySkills, topPriorityPatterns };
}

// ── Helpers ───────────────────────────────────────────────────────

function deduplicateTasks(tasks: CurationTask[]): CurationTask[] {
  const seen = new Set<string>();
  const result: CurationTask[] = [];
  for (const t of tasks) {
    const key = `${t.type}|${t.skill}|${t.focusPattern ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }
  return result;
}
