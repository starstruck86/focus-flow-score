/**
 * V3 Programming Engine
 *
 * Generates a DailyAssignment — the single source of truth for each training day.
 * Pure function: same input → same output.
 *
 * Decision cascade:
 * 1. Map date → dayAnchor (fixed)
 * 2. If benchmark/retest → use scenario family, skip KI
 * 3. Select focus within anchor (persistent mistake > declining > low confidence > stale > transcript)
 * 4. Select KI (default 1, never 2 unless tightly coupled)
 * 5. Select scenarios (direct application, variation, optional pressure)
 * 6. Set difficulty (phase + performance)
 * 7. Set retry strategy (adaptive)
 * 8. Enforce transcript cap
 * 9. V4: Attach pressure profiles to scenarios
 */

import type { SkillFocus, DojoScenario } from '../scenarios';
import { getRandomScenario } from '../scenarios';
import type { SkillProfile, SkillMemory } from '../skillMemory';
import type { DayAnchor } from './dayAnchors';
import { getAnchorForDate, getAnchorDef } from './dayAnchors';
import type { TrainingBlock, BlockPhase } from './blockManager';
import { getFamiliesForAnchor, type ScenarioFamily } from './scenarioFamilies';
import type { PressureProfile } from '../v4/pressureModel';
import { PRESSURE_NONE } from '../v4/pressureModel';
import { selectPressureProfile } from '../v4/pressureSelectors';
import { getArcsForStage, type SimulationArc } from '../v5/simulationArcs';

// ── DailyAssignment — the contract ────────────────────────────────

export interface DailyAssignment {
  blockNumber: number;
  blockWeek: number;
  blockPhase: BlockPhase;
  dayAnchor: DayAnchor;
  primarySkill: SkillFocus;
  focusPattern: string;
  kis: string[];                  // KI IDs — default 1, max 2
  scenarios: ScenarioSpec[];      // 2–3 scenarios
  difficulty: 'foundational' | 'intermediate' | 'advanced';
  retryStrategy: 'weakest' | 'variation' | 'skip';
  transcriptScenarioUsed: boolean;
  benchmarkTag: boolean;
  scenarioFamilyId: string | null;
  reason: string;
  source: 'weakness' | 'coverage' | 'transcript' | 'progression' | 'benchmark';
  // V4 pressure
  pressureExpected: boolean;
  pressureLabel: string | null;
  // V5 simulation
  simulationArcId: string | null;
  simulationExpected: boolean;
}

export interface ScenarioSpec {
  scenario: DojoScenario;
  purpose: 'direct_application' | 'variation' | 'transcript_origin' | 'pressure' | 'benchmark' | 'blended';
  familyId?: string;
  pressure?: PressureProfile;
}

// ── Engine Input ──────────────────────────────────────────────────

export interface ProgrammingInput {
  date: Date;
  block: TrainingBlock;
  skillMemory: SkillMemory | null;
  recentAssignments: RecentAssignment[];  // last 7 days
  transcriptScenarios: DojoScenario[];     // available transcript-origin
  kiCatalog: KICatalogEntry[];
}

export interface RecentAssignment {
  assignmentDate: string;
  transcriptScenarioUsed: boolean;
  dayAnchor: DayAnchor;
  primarySkill: SkillFocus;
  focusPattern: string;
}

export interface KICatalogEntry {
  id: string;
  skills: SkillFocus[];
  focusPatterns: string[];
  lastTaughtAt: string | null;
  title: string;
}

// ── Generate Daily Assignment ─────────────────────────────────────

export function generateDailyAssignment(input: ProgrammingInput): DailyAssignment {
  const { date, block, skillMemory, recentAssignments, transcriptScenarios, kiCatalog } = input;

  // Step 1: Fixed anchor
  const dayAnchor = getAnchorForDate(date);
  if (!dayAnchor) {
    // Weekend fallback — shouldn't normally be called
    return createFallbackAssignment(block, 'opening_cold_call');
  }

  const anchorDef = getAnchorDef(dayAnchor);
  const anchorSkills = anchorDef.primarySkills;

  // Step 2: Benchmark / Retest
  if (block.phase === 'benchmark' || block.phase === 'retest') {
    return generateBenchmarkAssignment(block, dayAnchor, anchorSkills[0]);
  }

  // Step 3: Focus selection within anchor
  const { primarySkill, focusPattern, reason, source } = selectFocus(
    anchorSkills,
    skillMemory,
    recentAssignments,
    transcriptScenarios,
    dayAnchor,
  );

  // Step 4: KI selection — default 1
  const kis = selectKIs(focusPattern, primarySkill, kiCatalog);

  // Step 5: Scenarios
  const isFriday = dayAnchor === 'executive_roi_mixed';
  const scenarios = selectScenarios(primarySkill, transcriptScenarios, recentAssignments, dayAnchor, isFriday);

  // Step 6: Difficulty
  const difficulty = calibrateDifficulty(block.phase, primarySkill, skillMemory);

  // Step 7: Retry strategy (set to default — actual adaptation happens post-session)
  const retryStrategy = 'weakest' as const;

  // Step 8: Transcript cap
  const transcriptThisWeek = recentAssignments.filter(a => a.transcriptScenarioUsed).length;
  const transcriptUsed = scenarios.some(s => s.purpose === 'transcript_origin') && transcriptThisWeek < 2;

  // Step 9: V4 — Attach pressure profiles
  const profile = skillMemory?.profiles.find(p => p.skill === primarySkill);
  const recentAvg = profile?.recentAvg ?? 50;
  const finalScenarios = (transcriptUsed ? scenarios : scenarios.filter(s => s.purpose !== 'transcript_origin'))
    .map(spec => {
      const pressure = selectPressureProfile({
        blockPhase: block.phase,
        dayAnchor,
        isFriday,
        recentAvg,
        stage: block.stage,
      });
      return { ...spec, pressure };
    });

  // Friday validation: ensure at least one pressured + one blended
  if (isFriday) {
    const hasPressure = finalScenarios.some(s => s.pressure?.level !== 'none');
    if (!hasPressure) {
      // Force pressure on the last scenario
      const last = finalScenarios[finalScenarios.length - 1];
      if (last) {
        last.pressure = selectPressureProfile({
          blockPhase: 'build', // force at least build-level pressure
          dayAnchor,
          isFriday: true,
          recentAvg,
          stage: block.stage,
        });
      }
    }
  }

  const pressureExpected = finalScenarios.some(s => s.pressure?.level !== 'none');
  const pressuredSpec = finalScenarios.find(s => s.pressure?.level !== 'none');

  return {
    blockNumber: block.blockNumber,
    blockWeek: block.currentWeek,
    blockPhase: block.phase,
    dayAnchor,
    primarySkill,
    focusPattern,
    kis,
    scenarios: finalScenarios,
    difficulty,
    retryStrategy,
    transcriptScenarioUsed: transcriptUsed,
    benchmarkTag: false,
    scenarioFamilyId: null,
    reason,
    source,
    pressureExpected,
    pressureLabel: pressuredSpec?.pressure?.label ?? null,
  };
}

// ── Step 2: Benchmark Assignment ──────────────────────────────────

function generateBenchmarkAssignment(
  block: TrainingBlock,
  dayAnchor: DayAnchor,
  defaultSkill: SkillFocus,
): DailyAssignment {
  const families = getFamiliesForAnchor(dayAnchor);
  const phase = block.phase as 'benchmark' | 'retest';

  // Pick a family for today — rotate through available families
  const familyIndex = (block.completedSessionsThisWeek) % families.length;
  const family = families[familyIndex] ?? families[0];

  const scenario = phase === 'benchmark' ? family.benchmarkScenario : family.retestScenario;

  return {
    blockNumber: block.blockNumber,
    blockWeek: block.currentWeek,
    blockPhase: block.phase,
    dayAnchor,
    primarySkill: scenario.skillFocus,
    focusPattern: '',
    kis: [],
    scenarios: [{
      scenario,
      purpose: 'benchmark',
      familyId: family.id,
      pressure: PRESSURE_NONE,
    }],
    difficulty: 'intermediate',
    retryStrategy: 'skip',
    transcriptScenarioUsed: false,
    benchmarkTag: true,
    scenarioFamilyId: family.id,
    reason: phase === 'benchmark'
      ? 'Benchmark week — establishing your baseline.'
      : 'Retest week — same challenges, different you.',
    source: 'benchmark',
    pressureExpected: false,
    pressureLabel: null,
  };
}

// ── Step 3: Focus Selection ───────────────────────────────────────

interface FocusResult {
  primarySkill: SkillFocus;
  focusPattern: string;
  reason: string;
  source: DailyAssignment['source'];
}

function selectFocus(
  anchorSkills: SkillFocus[],
  skillMemory: SkillMemory | null,
  recentAssignments: RecentAssignment[],
  transcriptScenarios: DojoScenario[],
  dayAnchor: DayAnchor,
): FocusResult {
  const profiles = skillMemory?.profiles ?? [];

  // Get profiles for this anchor's skills
  const anchorProfiles = profiles.filter(p => anchorSkills.includes(p.skill));

  // A: Persistent mistake (≥3 occurrences, unresolved)
  for (const profile of anchorProfiles) {
    const persistent = profile.topMistakes.find(
      m => m.count >= 3 && !profile.resolvedMistakes.includes(m.mistake)
    );
    if (persistent) {
      return {
        primarySkill: profile.skill,
        focusPattern: mapMistakeToFocusPattern(persistent.mistake, profile.skill),
        reason: `Persistent mistake: "${persistent.label}" keeps appearing (${persistent.count}×).`,
        source: 'weakness',
      };
    }
  }

  // B: Declining trend
  const declining = anchorProfiles.filter(p => p.trend === 'declining')
    .sort((a, b) => a.trendDelta - b.trendDelta);
  if (declining.length > 0) {
    const p = declining[0];
    return {
      primarySkill: p.skill,
      focusPattern: getDefaultPatternForSkill(p.skill),
      reason: `${p.label} is declining (${p.trendDelta} pts). Reversing the slide.`,
      source: 'weakness',
    };
  }

  // C: Lowest confidence
  const lowConf = anchorProfiles.filter(p => p.confidence === 'low' || p.confidence === 'untested')
    .sort((a, b) => a.recentAvg - b.recentAvg);
  if (lowConf.length > 0) {
    const p = lowConf[0];
    return {
      primarySkill: p.skill,
      focusPattern: getDefaultPatternForSkill(p.skill),
      reason: p.confidence === 'untested'
        ? `${p.label} hasn't been practiced yet. Building your baseline.`
        : `${p.label} confidence is low (${p.recentAvg} avg). Drilling fundamentals.`,
      source: 'coverage',
    };
  }

  // D: Stale (>10 days)
  const now = Date.now();
  const stale = anchorProfiles.filter(p => {
    if (!p.lastPracticed) return true;
    const days = (now - new Date(p.lastPracticed).getTime()) / (1000 * 60 * 60 * 24);
    return days > 10;
  });
  if (stale.length > 0) {
    const p = stale[0];
    return {
      primarySkill: p.skill,
      focusPattern: getDefaultPatternForSkill(p.skill),
      reason: `${p.label} hasn't been practiced in over 10 days. Rotating back.`,
      source: 'coverage',
    };
  }

  // E: Transcript signal (check cap)
  const transcriptThisWeek = recentAssignments.filter(a => a.transcriptScenarioUsed).length;
  if (transcriptScenarios.length > 0 && transcriptThisWeek < 2) {
    const ts = transcriptScenarios.find(s => anchorSkills.includes(s.skillFocus));
    if (ts) {
      return {
        primarySkill: ts.skillFocus,
        focusPattern: getDefaultPatternForSkill(ts.skillFocus),
        reason: 'Working on a pattern from your real calls.',
        source: 'transcript',
      };
    }
  }

  // Fallback: lowest recentAvg within anchor
  const sorted = anchorProfiles.length > 0
    ? [...anchorProfiles].sort((a, b) => a.recentAvg - b.recentAvg)
    : [];
  if (sorted.length > 0) {
    const p = sorted[0];
    return {
      primarySkill: p.skill,
      focusPattern: getDefaultPatternForSkill(p.skill),
      reason: `Pushing ${p.label} further (${p.recentAvg} avg).`,
      source: 'progression',
    };
  }

  // Absolute fallback
  return {
    primarySkill: anchorSkills[0],
    focusPattern: getDefaultPatternForSkill(anchorSkills[0]),
    reason: 'Building your baseline on today\'s anchor.',
    source: 'progression',
  };
}

// ── Step 4: KI Selection ──────────────────────────────────────────

function selectKIs(
  focusPattern: string,
  primarySkill: SkillFocus,
  kiCatalog: KICatalogEntry[],
): string[] {
  if (!focusPattern || kiCatalog.length === 0) return [];

  // Find KIs matching the focus pattern
  let candidates = kiCatalog.filter(ki =>
    ki.focusPatterns.includes(focusPattern) && ki.skills.includes(primarySkill)
  );

  // Fallback: any KI for this skill
  if (candidates.length === 0) {
    candidates = kiCatalog.filter(ki => ki.skills.includes(primarySkill));
  }

  if (candidates.length === 0) return [];

  // Prefer untaught or stale (>14 days since last taught)
  const now = Date.now();
  const scored = candidates.map(ki => {
    const daysSinceTaught = ki.lastTaughtAt
      ? (now - new Date(ki.lastTaughtAt).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    return { ki, staleness: daysSinceTaught };
  }).sort((a, b) => b.staleness - a.staleness);

  // Default: 1 KI. Period.
  return [scored[0].ki.id];
}

// ── Step 5: Scenario Selection ────────────────────────────────────

function selectScenarios(
  primarySkill: SkillFocus,
  transcriptScenarios: DojoScenario[],
  recentAssignments: RecentAssignment[],
  dayAnchor: DayAnchor,
  isFriday: boolean,
): ScenarioSpec[] {
  const specs: ScenarioSpec[] = [];

  // Rep 1: Direct application
  const direct = getRandomScenario(primarySkill);
  specs.push({ scenario: direct, purpose: 'direct_application' });

  // Rep 2: Variation (same skill, different scenario)
  const variation = getRandomScenario(primarySkill);
  specs.push({ scenario: variation, purpose: 'variation' });

  // Rep 3 (optional): Transcript-origin or pressure
  const transcriptThisWeek = recentAssignments.filter(a => a.transcriptScenarioUsed).length;
  const anchorDef = getAnchorDef(dayAnchor);
  const matchingTranscript = transcriptScenarios.find(s =>
    anchorDef.primarySkills.includes(s.skillFocus)
  );

  if (matchingTranscript && transcriptThisWeek < 2) {
    specs.push({ scenario: matchingTranscript, purpose: 'transcript_origin' });
  }

  // Friday: Always include blended multi-skill scenario
  // For now, use an executive_response scenario as the "blended pressure" rep
  if (isFriday) {
    const blended = getRandomScenario('executive_response');
    specs.push({ scenario: blended, purpose: 'blended' });
  }

  return specs;
}

// ── Step 6: Difficulty Calibration ────────────────────────────────

function calibrateDifficulty(
  phase: BlockPhase,
  primarySkill: SkillFocus,
  skillMemory: SkillMemory | null,
): 'foundational' | 'intermediate' | 'advanced' {
  const profile = skillMemory?.profiles.find(p => p.skill === primarySkill);
  const recentAvg = profile?.recentAvg ?? 50;

  // Phase-based base
  let base: 'foundational' | 'intermediate' | 'advanced';
  switch (phase) {
    case 'foundation': base = 'foundational'; break;
    case 'build': base = 'intermediate'; break;
    case 'peak': base = 'advanced'; break;
    default: base = 'intermediate';
  }

  // Performance modulation
  if (recentAvg < 50 && base !== 'foundational') {
    // Drop one level
    return base === 'advanced' ? 'intermediate' : 'foundational';
  }
  if (recentAvg > 75 && base !== 'advanced') {
    // Raise one level
    return base === 'foundational' ? 'intermediate' : 'advanced';
  }

  return base;
}

// ── Helpers ───────────────────────────────────────────────────────

function createFallbackAssignment(block: TrainingBlock, anchor: DayAnchor): DailyAssignment {
  return {
    blockNumber: block.blockNumber,
    blockWeek: block.currentWeek,
    blockPhase: block.phase,
    dayAnchor: anchor,
    primarySkill: 'objection_handling',
    focusPattern: 'isolate_before_answering',
    kis: [],
    scenarios: [{ scenario: getRandomScenario(), purpose: 'direct_application', pressure: PRESSURE_NONE }],
    difficulty: 'intermediate',
    retryStrategy: 'weakest',
    transcriptScenarioUsed: false,
    benchmarkTag: false,
    scenarioFamilyId: null,
    reason: 'Fallback assignment.',
    source: 'progression',
    pressureExpected: false,
    pressureLabel: null,
  };
}

/** Map common mistake IDs to the most relevant focus pattern */
function mapMistakeToFocusPattern(mistake: string, skill: SkillFocus): string {
  const mapping: Record<string, string> = {
    // Objection handling
    pitched_too_early: 'isolate_before_answering',
    weak_objection_handle: 'reframe_to_business_impact',
    no_business_impact: 'reframe_to_business_impact',
    too_generic: 'use_specific_proof',
    no_proof: 'use_specific_proof',
    // Discovery
    failed_to_deepen: 'deepen_one_level',
    stacked_questions: 'ask_singular_questions',
    accepted_weak_pain: 'quantify_the_pain',
    // Executive
    too_long: 'cut_to_three_sentences',
    // Deal control
    lack_of_control: 'lock_mutual_commitment',
    weak_close: 'control_next_step',
    vague_next_step: 'control_next_step',
    too_passive: 'name_the_risk',
    no_mutual_plan: 'lock_mutual_commitment',
    accepted_delay: 'test_before_accepting',
    // Qualification
    failed_to_qualify: 'validate_real_pain',
    skipped_stakeholders: 'map_stakeholders',
    no_disqualification: 'disqualify_weak_opportunities',
    no_urgency: 'test_urgency',
  };

  return mapping[mistake] ?? getDefaultPatternForSkill(skill);
}

/** Get the first focus pattern for a skill */
function getDefaultPatternForSkill(skill: SkillFocus): string {
  const defaults: Record<SkillFocus, string> = {
    objection_handling: 'isolate_before_answering',
    discovery: 'deepen_one_level',
    executive_response: 'lead_with_the_number',
    deal_control: 'lock_mutual_commitment',
    qualification: 'validate_real_pain',
  };
  return defaults[skill];
}

// ── Adaptive Retry (called post-session) ──────────────────────────

export function determineRetryStrategy(
  score: number,
  topMistake: string,
  focusPattern: string,
  persistentMistakes: string[],
  sessionDurationMinutes: number,
): 'weakest' | 'variation' | 'skip' {
  // Time-constrained → skip
  if (sessionDurationMinutes > 20) return 'skip';

  // Strong performance + focus not a persistent issue → skip
  if (score >= 70 && !persistentMistakes.includes(topMistake)) return 'skip';

  // Weak → retry same
  if (score < 50) return 'weakest';

  // Mid-range + same persistent mistake → retry same
  if (score < 70 && persistentMistakes.includes(topMistake)) return 'weakest';

  // Mid-range + different mistake → variation
  if (score < 70) return 'variation';

  return 'skip';
}
