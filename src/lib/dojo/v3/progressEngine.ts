/**
 * V3 Progress Engine
 *
 * Computes daily, weekly, and block-level progress signals.
 * Reads from skill memory, daily assignments, and block snapshots.
 */

import type { SkillMemory, SkillProfile } from '../skillMemory';
import type { DayAnchor } from './dayAnchors';
import { ANCHORS_IN_ORDER, DAY_ANCHORS } from './dayAnchors';
import type { TrainingBlock, BlockSnapshot } from './blockManager';

// ── Types ──────────────────────────────────────────────────────────

export interface DailyProgressSignal {
  score: number;
  scoreDelta: number;           // vs recent baseline on this anchor
  focusApplied: 'yes' | 'partial' | 'no' | 'unknown';
  fixedSignals: string[];       // "You fixed: [mistake label]"
  stillBreakingSignals: string[]; // "Still breaking: [mistake label]"
  tomorrowPreview: string | null;
}

export interface WeeklyProgressSummary {
  weekNumber: number;
  anchorsCovered: DayAnchor[];
  anchorsMissed: DayAnchor[];
  perAnchorDelta: Array<{
    anchor: DayAnchor;
    label: string;
    currentAvg: number;
    priorAvg: number;
    delta: number;
  }>;
  topImprovement: string | null;
  biggestGap: string | null;
  mistakesResolvedThisWeek: string[];
  fridaySimulationScore: number | null;
}

export interface BlockProgressSummary {
  blockNumber: number;
  benchmarkScores: BlockSnapshot | null;
  retestScores: BlockSnapshot | null;
  perAnchorComparison: AnchorComparison[];
  mistakesFixed: string[];
  mistakesPersisting: string[];
  mistakesNew: string[];
  stageAdvanced: boolean;
  currentStage: string;
  completionMessage: string;
}

export interface AnchorComparison {
  anchor: DayAnchor;
  label: string;
  benchmarkScore: number;
  retestScore: number;
  delta: number;
}

// ── Daily Progress ────────────────────────────────────────────────

export function computeDailyProgress(
  sessionScore: number,
  focusApplied: 'yes' | 'partial' | 'no' | 'unknown',
  anchor: DayAnchor,
  skillMemory: SkillMemory | null,
  tomorrowAnchor: DayAnchor | null,
): DailyProgressSignal {
  const anchorDef = DAY_ANCHORS[anchor];
  const profiles = skillMemory?.profiles ?? [];
  const anchorProfiles = profiles.filter(p => anchorDef.primarySkills.includes(p.skill));

  // Score delta vs recent avg for this anchor's skills
  const relevantProfile = anchorProfiles[0];
  const scoreDelta = relevantProfile ? sessionScore - relevantProfile.recentAvg : 0;

  // Fixed / still-breaking signals
  const fixedSignals: string[] = [];
  const stillBreakingSignals: string[] = [];

  for (const profile of anchorProfiles) {
    for (const resolved of profile.resolvedMistakes) {
      fixedSignals.push(`You fixed: ${resolved.replace(/_/g, ' ')}`);
    }
    for (const m of profile.topMistakes) {
      if (m.count >= 3 && !profile.resolvedMistakes.includes(m.mistake)) {
        stillBreakingSignals.push(`Still breaking: ${m.label}`);
      }
    }
  }

  // Tomorrow preview
  let tomorrowPreview: string | null = null;
  if (tomorrowAnchor) {
    const tmrDef = DAY_ANCHORS[tomorrowAnchor];
    tomorrowPreview = `Tomorrow: ${tmrDef.label}.`;
  }

  return {
    score: sessionScore,
    scoreDelta,
    focusApplied,
    fixedSignals: fixedSignals.slice(0, 3),
    stillBreakingSignals: stillBreakingSignals.slice(0, 2),
    tomorrowPreview,
  };
}

// ── Weekly Summary ────────────────────────────────────────────────

export function computeWeeklySummary(
  weekNumber: number,
  completedAnchors: DayAnchor[],
  skillMemory: SkillMemory | null,
  fridayScore: number | null,
): WeeklyProgressSummary {
  const covered = new Set(completedAnchors);
  const missed = ANCHORS_IN_ORDER.filter(a => !covered.has(a));
  const profiles = skillMemory?.profiles ?? [];

  const perAnchorDelta = ANCHORS_IN_ORDER.map(anchor => {
    const def = DAY_ANCHORS[anchor];
    const anchorProfiles = profiles.filter(p => def.primarySkills.includes(p.skill));
    const current = anchorProfiles.length > 0
      ? Math.round(anchorProfiles.reduce((s, p) => s + p.recentAvg, 0) / anchorProfiles.length)
      : 0;
    const prior = anchorProfiles.length > 0
      ? Math.round(anchorProfiles.reduce((s, p) => s + p.avgScore, 0) / anchorProfiles.length)
      : 0;
    return {
      anchor,
      label: def.shortLabel,
      currentAvg: current,
      priorAvg: prior,
      delta: current - prior,
    };
  });

  // Top improvement
  const sorted = [...perAnchorDelta].sort((a, b) => b.delta - a.delta);
  const topImprovement = sorted[0]?.delta > 0
    ? `${sorted[0].label} up ${sorted[0].delta} pts`
    : null;

  // Biggest gap
  const weakest = [...perAnchorDelta].sort((a, b) => a.currentAvg - b.currentAvg);
  const biggestGap = weakest[0]?.currentAvg < 60
    ? `${weakest[0].label} needs work (${weakest[0].currentAvg} avg)`
    : null;

  // Resolved mistakes this week
  const resolved = profiles.flatMap(p => p.resolvedMistakes);

  return {
    weekNumber,
    anchorsCovered: completedAnchors,
    anchorsMissed: missed,
    perAnchorDelta,
    topImprovement,
    biggestGap,
    mistakesResolvedThisWeek: resolved,
    fridaySimulationScore: fridayScore,
  };
}

// ── Block Summary ─────────────────────────────────────────────────

export function computeBlockSummary(
  block: TrainingBlock,
  skillMemory: SkillMemory | null,
): BlockProgressSummary {
  const benchmark = block.benchmarkSnapshot;
  const retest = block.retestSnapshot;

  const perAnchorComparison: AnchorComparison[] = ANCHORS_IN_ORDER.map(anchor => {
    const def = DAY_ANCHORS[anchor];
    const bScore = benchmark?.[anchor]?.avgScore ?? 0;
    const rScore = retest?.[anchor]?.avgScore ?? 0;
    return {
      anchor,
      label: def.shortLabel,
      benchmarkScore: bScore,
      retestScore: rScore,
      delta: rScore - bScore,
    };
  });

  // Mistake analysis
  const benchmarkMistakes = new Set<string>();
  const retestMistakes = new Set<string>();

  for (const anchor of ANCHORS_IN_ORDER) {
    const bm = benchmark?.[anchor]?.topMistake;
    const rt = retest?.[anchor]?.topMistake;
    if (bm) benchmarkMistakes.add(bm);
    if (rt) retestMistakes.add(rt);
  }

  const mistakesFixed = Array.from(benchmarkMistakes).filter(m => !retestMistakes.has(m));
  const mistakesPersisting = Array.from(benchmarkMistakes).filter(m => retestMistakes.has(m));
  const mistakesNew = Array.from(retestMistakes).filter(m => !benchmarkMistakes.has(m));

  const avgDelta = perAnchorComparison.reduce((s, c) => s + c.delta, 0) / perAnchorComparison.length;
  const stageAdvanced = block.stage !== 'foundation'; // simplified check

  const completionMessage = retest
    ? `Block ${block.blockNumber} complete. Average improvement: ${Math.round(avgDelta)} pts across ${perAnchorComparison.length} anchors. ${mistakesFixed.length} mistake pattern${mistakesFixed.length !== 1 ? 's' : ''} resolved.`
    : `Block ${block.blockNumber} in progress — Week ${block.currentWeek}.`;

  return {
    blockNumber: block.blockNumber,
    benchmarkScores: benchmark,
    retestScores: retest,
    perAnchorComparison,
    mistakesFixed,
    mistakesPersisting,
    mistakesNew,
    stageAdvanced,
    currentStage: block.stage,
    completionMessage,
  };
}
