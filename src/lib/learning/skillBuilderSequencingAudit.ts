/**
 * Skill Builder — Sequencing Audit
 *
 * Generates test sessions across skills/durations and evaluates
 * whether sessions feel progressive instead of repetitive.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import { generateSkillTrack, type SkillTrack } from './skillBuilderEngine';

// ── Types ──────────────────────────────────────────────────────────

export interface SequencingAuditResult {
  skill: string;
  durationMinutes: 15 | 30 | 60;
  patternCount: number;
  levelSpread: number[];
  issues: string[];
  verdict: 'strong' | 'acceptable' | 'weak';
}

// ── Main ──────────────────────────────────────────────────────────

const AUDIT_SKILLS: SkillFocus[] = ['discovery', 'objection_handling', 'deal_control', 'executive_response', 'qualification'];
const AUDIT_DURATIONS: (15 | 30 | 60)[] = [15, 30, 60];

export async function auditSkillBuilderSequencing(userId: string): Promise<SequencingAuditResult[]> {
  const results: SequencingAuditResult[] = [];

  for (const skill of AUDIT_SKILLS) {
    for (const duration of AUDIT_DURATIONS) {
      try {
        const track = await generateSkillTrack({ userId, skill, durationMinutes: duration });
        results.push(auditTrack(track));
      } catch (err) {
        results.push({
          skill,
          durationMinutes: duration,
          patternCount: 0,
          levelSpread: [],
          issues: [`Failed to generate: ${err instanceof Error ? err.message : 'unknown'}`],
          verdict: 'weak',
        });
      }
    }
  }

  return results;
}

// ── Audit a single track ──────────────────────────────────────────

function auditTrack(track: SkillTrack): SequencingAuditResult {
  const issues: string[] = [];
  const patterns = track.focusPatternsUsed;
  const uniquePatterns = new Set(patterns);
  const kiIds = track.kiIdsUsed;
  const uniqueKIs = new Set(kiIds);

  // Level spread — which levels did the patterns come from?
  // We'll infer from the curriculum
  const levelSpread = inferLevelSpread(track);

  // ── Check: pattern repetition ──
  if (patterns.length > uniquePatterns.size) {
    const repeated = patterns.length - uniquePatterns.size;
    issues.push(`${repeated} repeated pattern(s) in session`);
  }

  // ── Check: KI repetition ──
  if (kiIds.length > uniqueKIs.size) {
    issues.push(`${kiIds.length - uniqueKIs.size} repeated KI(s)`);
  }

  // ── Check: too few distinct KIs for duration ──
  if (track.durationMinutes >= 30 && uniqueKIs.size < 3) {
    issues.push(`Only ${uniqueKIs.size} distinct KIs for a ${track.durationMinutes}-min session`);
  }
  if (track.durationMinutes >= 60 && uniqueKIs.size < 4) {
    issues.push(`Only ${uniqueKIs.size} distinct KIs for a 60-min session — may feel repetitive`);
  }

  // ── Check: single-level dominance ──
  if (track.durationMinutes >= 30 && levelSpread.length > 0) {
    const uniqueLevels = new Set(levelSpread);
    if (uniqueLevels.size === 1) {
      issues.push('All patterns from a single curriculum level — no escalation');
    }
  }

  // ── Check: 60 min needs escalation ──
  if (track.durationMinutes >= 60) {
    const uniqueLevels = new Set(levelSpread);
    if (uniqueLevels.size < 2) {
      issues.push('60-min session should span at least 2 levels for progression');
    }
    if (uniquePatterns.size < 4) {
      issues.push('60-min session should have at least 4 distinct patterns');
    }
  }

  // ── Check: 15 min should stay tight ──
  if (track.durationMinutes === 15 && uniquePatterns.size > 3) {
    issues.push('15-min session has too many patterns — may feel scattered');
  }

  // ── Verdict ──
  let verdict: 'strong' | 'acceptable' | 'weak';
  if (issues.length === 0) verdict = 'strong';
  else if (issues.length <= 2 && !issues.some(i => i.includes('Failed'))) verdict = 'acceptable';
  else verdict = 'weak';

  return {
    skill: track.skill,
    durationMinutes: track.durationMinutes as 15 | 30 | 60,
    patternCount: uniquePatterns.size,
    levelSpread,
    issues,
    verdict,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function inferLevelSpread(track: SkillTrack): number[] {
  // Import curriculum to map patterns to levels
  const { SKILL_CURRICULA } = require('./learnSkillCurriculum');
  const curriculum = SKILL_CURRICULA[track.skill];
  if (!curriculum) return [];

  const levels: number[] = [];
  for (const pattern of track.focusPatternsUsed) {
    for (const level of curriculum.levels) {
      if (level.focusPatterns.includes(pattern)) {
        levels.push(level.level);
        break;
      }
    }
  }
  return levels;
}
