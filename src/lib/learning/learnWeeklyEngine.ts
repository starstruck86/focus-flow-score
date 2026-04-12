/**
 * Learn Weekly Engine — Phase 4
 *
 * Forward-looking weekly coaching surfaces derived from
 * training_blocks, daily_assignments, weekly summary, and capability profiles.
 *
 * Additive. Does not change Dojo logic.
 */

import { supabase } from '@/integrations/supabase/client';
import { getOrCreateActiveBlock, derivePhase, type TrainingBlock } from '@/lib/dojo/v3/blockManager';
import { computeWeeklySummaryFromDB, type WeeklySummary } from '@/lib/dojo/v3/weeklySummaryEngine';
import { ANCHORS_IN_ORDER, DAY_ANCHORS, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import { buildCapabilityProfiles, type CapabilityProfile } from '@/lib/dojo/v4/capabilityModel';
import { getMistakeEntry } from '@/lib/dojo/mistakeTaxonomy';

// ── Types ──────────────────────────────────────────────────────────

export interface WeeklyCoachingPlan {
  blockNumber: number;
  weekNumber: number;
  phase: string;
  stage: string;
  anchorsExpected: DayAnchor[];
  anchorsCompleted: DayAnchor[];
  weakestAnchor: DayAnchor | null;
  weakestAnchorLabel: string | null;
  weakestAnchorReason: string | null;
  topStudyPriorities: string[];
  fridayExpected: boolean;
  fridayPressureExpected: boolean;
  fridaySimulationExpected: boolean;
  multiThreadLikely: boolean;
  coachingHeadline: string;
  coachingBody: string;
}

export interface FridayReadiness {
  expected: boolean;
  pressureExpected: boolean;
  simulationExpected: boolean;
  multiThreadLikely: boolean;
  primaryRisk: string | null;
  prepFocus: string;
  whyItMatters: string;
  recommendedKITitles: string[];
}

export interface BlockRemediation {
  headline: string;
  primaryGap: string;
  gaps: string[];
  recommendedActions: string[];
  recommendedKITitles: string[];
}

// ── Weekly Coaching Plan ───────────────────────────────────────────

export async function getWeeklyCoachingPlan(userId: string): Promise<WeeklyCoachingPlan | null> {
  let block: TrainingBlock;
  try {
    block = await getOrCreateActiveBlock(userId);
  } catch {
    return null;
  }

  const [summary, capabilities] = await Promise.all([
    computeWeeklySummaryFromDB(userId, block.id, block.currentWeek),
    buildCapabilityProfiles(userId),
  ]);

  const phase = derivePhase(block.currentWeek);
  const anchorsCompleted = summary.anchorsCovered;

  // Weakest anchor: lowest avg this week, or lowest capability if no data yet
  let weakestAnchor: DayAnchor | null = null;
  let weakestAnchorLabel: string | null = null;
  let weakestAnchorReason: string | null = null;

  const anchorStats = summary.perAnchorStats.filter(s => s.sessionCount > 0);
  if (anchorStats.length > 0) {
    const sorted = [...anchorStats].sort((a, b) => a.currentWeekAvg - b.currentWeekAvg);
    const worst = sorted[0];
    weakestAnchor = worst.anchor;
    weakestAnchorLabel = worst.label;
    weakestAnchorReason = `${worst.label} averaged ${worst.currentWeekAvg} this week${worst.topMistake ? ` — top mistake: ${getMistakeEntry(worst.topMistake)?.label ?? worst.topMistake}` : ''}`;
  } else if (capabilities.length > 0) {
    // Use capability profiles
    const sorted = [...capabilities].sort((a, b) => a.firstAttemptStrength - b.firstAttemptStrength);
    const weakSkill = sorted[0];
    // Map skill back to anchor
    const anchorEntry = ANCHORS_IN_ORDER.find(a =>
      DAY_ANCHORS[a].primarySkills.includes(weakSkill.skill)
    );
    if (anchorEntry) {
      weakestAnchor = anchorEntry;
      weakestAnchorLabel = DAY_ANCHORS[anchorEntry].shortLabel;
      weakestAnchorReason = `${weakSkill.label} is your weakest skill area (${weakSkill.firstAttemptStrength} avg)`;
    }
  }

  // Study priorities (max 3)
  const priorities: string[] = [];

  if (weakestAnchorLabel) {
    priorities.push(`Strengthen ${weakestAnchorLabel}`);
  }

  // Pressure gap
  const withPressure = capabilities.filter(c => c.pressureScore != null && c.firstAttemptStrength > 0);
  if (withPressure.length > 0) {
    const avgGap = withPressure.reduce((s, c) => s + (c.firstAttemptStrength - (c.pressureScore ?? 0)), 0) / withPressure.length;
    if (avgGap > 8) {
      priorities.push('Close the pressure gap — form breaks under stress');
    }
  }

  // Multi-thread
  const mtWeakCap = capabilities.find(c => c.multiThreadReadiness === 'low');
  const multiThreadLikely = phase === 'build' || phase === 'peak';
  if (mtWeakCap && multiThreadLikely) {
    priorities.push('Prepare for multi-stakeholder scenarios');
  }

  // Friday expectations
  const fridayCompleted = anchorsCompleted.includes('executive_roi_mixed');
  const fridayExpected = !fridayCompleted;
  const fridayPressureExpected = phase === 'build' || phase === 'peak';
  const fridaySimulationExpected = phase !== 'benchmark';

  // Coaching headline
  let coachingHeadline: string;
  const remaining = ANCHORS_IN_ORDER.length - anchorsCompleted.length;
  if (remaining === 0) {
    coachingHeadline = `Week ${block.currentWeek} complete. Review your signals.`;
  } else if (remaining <= 2) {
    coachingHeadline = `${remaining} anchor${remaining > 1 ? 's' : ''} left this week. Finish strong.`;
  } else {
    coachingHeadline = `Week ${block.currentWeek} of Block ${block.blockNumber} — ${phase} phase.`;
  }

  // Coaching body
  const bodyParts: string[] = [];
  if (weakestAnchorLabel && weakestAnchorReason) {
    bodyParts.push(weakestAnchorReason);
  }
  if (fridayExpected && fridayPressureExpected) {
    bodyParts.push('Friday will test you under pressure — prep accordingly.');
  }
  const coachingBody = bodyParts.join(' ') || `Stay consistent across all ${ANCHORS_IN_ORDER.length} anchors this week.`;

  return {
    blockNumber: block.blockNumber,
    weekNumber: block.currentWeek,
    phase,
    stage: block.stage,
    anchorsExpected: ANCHORS_IN_ORDER,
    anchorsCompleted: anchorsCompleted,
    weakestAnchor,
    weakestAnchorLabel,
    weakestAnchorReason,
    topStudyPriorities: priorities.slice(0, 3),
    fridayExpected,
    fridayPressureExpected,
    fridaySimulationExpected,
    multiThreadLikely,
    coachingHeadline,
    coachingBody,
  };
}

// ── Friday Readiness ───────────────────────────────────────────────

export async function getFridayReadiness(userId: string): Promise<FridayReadiness | null> {
  let block: TrainingBlock;
  try {
    block = await getOrCreateActiveBlock(userId);
  } catch {
    return null;
  }

  const phase = derivePhase(block.currentWeek);

  // Check if Friday is upcoming (not yet completed this week)
  const { data: fridayAssignments } = await supabase
    .from('daily_assignments')
    .select('completed')
    .eq('block_id', block.id)
    .eq('block_week', block.currentWeek)
    .eq('day_anchor', 'executive_roi_mixed');

  const fridayDone = (fridayAssignments ?? []).some(a => a.completed);
  if (fridayDone) return null; // Already done, no prep needed

  const pressureExpected = phase === 'build' || phase === 'peak';
  const simulationExpected = phase !== 'benchmark';
  const multiThreadLikely = phase === 'build' || phase === 'peak';

  const capabilities = await buildCapabilityProfiles(userId);
  const execCap = capabilities.find(c => c.skill === 'executive_response');

  // Primary risk
  let primaryRisk: string | null = null;
  let prepFocus = 'Stay controlled when a senior buyer challenges your position.';

  if (execCap) {
    if (execCap.closingUnderPressure != null && execCap.closingUnderPressure < 55) {
      primaryRisk = 'Weak closing under pressure — you tend to lose control late.';
      prepFocus = 'Focus on landing strong commitments in the final moment.';
    } else if (execCap.flowControl != null && execCap.flowControl < 60) {
      primaryRisk = 'Flow control breaks down — your form doesn\'t hold across turns.';
      prepFocus = 'Maintain steady execution from first turn to last.';
    } else if (execCap.pressureScore != null && execCap.firstAttemptStrength - execCap.pressureScore > 10) {
      primaryRisk = 'Large pressure gap — your execution drops under stress.';
      prepFocus = 'Keep form tight even when the buyer gets aggressive.';
    }
  }

  const whyItMatters = simulationExpected
    ? 'Friday is your highest-pressure day — multi-turn simulations test whether your skills hold.'
    : 'Friday focuses on executive-level interactions where precision matters most.';

  // Recommended KIs — find real KIs tied to executive/deal_control
  const recommendedKITitles: string[] = [];
  const { data: recentAssignments } = await supabase
    .from('daily_assignments')
    .select('kis')
    .eq('user_id', userId)
    .eq('day_anchor', 'executive_roi_mixed')
    .order('assignment_date', { ascending: false })
    .limit(3);

  if (recentAssignments) {
    const kiIds = recentAssignments.flatMap(a => (a.kis as unknown as string[]) ?? []).slice(0, 3);
    if (kiIds.length > 0) {
      const { data: kiRows } = await supabase
        .from('knowledge_items' as any)
        .select('title')
        .in('id', kiIds);
      for (const ki of (kiRows ?? []) as any[]) {
        if (ki.title && recommendedKITitles.length < 3) {
          recommendedKITitles.push(ki.title);
        }
      }
    }
  }

  return {
    expected: true,
    pressureExpected,
    simulationExpected,
    multiThreadLikely,
    primaryRisk,
    prepFocus,
    whyItMatters,
    recommendedKITitles,
  };
}

// ── Block Remediation ──────────────────────────────────────────────

export async function getBlockRemediationPlan(userId: string): Promise<BlockRemediation | null> {
  let block: TrainingBlock;
  try {
    block = await getOrCreateActiveBlock(userId);
  } catch {
    return null;
  }

  // Only show after week 2 (need enough data)
  if (block.currentWeek < 3) return null;

  const [summary, capabilities] = await Promise.all([
    computeWeeklySummaryFromDB(userId, block.id, block.currentWeek),
    buildCapabilityProfiles(userId),
  ]);

  const gaps: string[] = [];
  const actions: string[] = [];

  // Find anchors with persistent weakness
  for (const stat of summary.perAnchorStats) {
    if (stat.sessionCount > 0 && stat.currentWeekAvg < 55) {
      gaps.push(`${stat.label} is still below 55 avg`);
      actions.push(`Run focused reps on ${stat.label}`);
    }
  }

  // Pressure gap
  const withPressure = capabilities.filter(c => c.pressureScore != null);
  if (withPressure.length > 0) {
    const avgGap = withPressure.reduce((s, c) => s + (c.firstAttemptStrength - (c.pressureScore ?? 0)), 0) / withPressure.length;
    if (avgGap > 10) {
      gaps.push('Pressure gap remains large across skills');
      actions.push('Prioritize pressure reps to build durability');
    }
  }

  // Multi-thread
  const mtWeak = capabilities.filter(c => c.multiThreadReadiness === 'low');
  if (mtWeak.length >= 2) {
    gaps.push('Multi-thread readiness is low in multiple areas');
    actions.push('Focus on stakeholder alignment in complex scenarios');
  }

  if (gaps.length === 0) return null;

  const primaryGap = gaps[0];
  const headline = `Block ${block.blockNumber}, Week ${block.currentWeek} — here's what still needs work.`;

  // Recommended KIs from weakest areas
  const recommendedKITitles: string[] = [];
  const weakAnchors = summary.perAnchorStats
    .filter(s => s.sessionCount > 0)
    .sort((a, b) => a.currentWeekAvg - b.currentWeekAvg)
    .slice(0, 2);

  if (weakAnchors.length > 0) {
    const weakAnchorNames = weakAnchors.map(a => a.anchor);
    const { data: recentAssignments } = await supabase
      .from('daily_assignments')
      .select('kis')
      .eq('user_id', userId)
      .in('day_anchor', weakAnchorNames)
      .order('assignment_date', { ascending: false })
      .limit(5);

    if (recentAssignments) {
      const kiIds = [...new Set(recentAssignments.flatMap(a => (a.kis as unknown as string[]) ?? []))].slice(0, 3);
      if (kiIds.length > 0) {
        const { data: kiRows } = await supabase
          .from('knowledge_items' as any)
          .select('title')
          .in('id', kiIds);
        for (const ki of (kiRows ?? []) as any[]) {
          if (ki.title && recommendedKITitles.length < 3) {
            recommendedKITitles.push(ki.title);
          }
        }
      }
    }
  }

  return {
    headline,
    primaryGap,
    gaps: gaps.slice(0, 3),
    recommendedActions: actions.slice(0, 3),
    recommendedKITitles,
  };
}
