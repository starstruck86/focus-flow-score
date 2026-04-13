/**
 * Skill Builder Engine — Phase 2
 *
 * Generates structured, progressive training sessions for a chosen skill.
 * Uses real KIs from the catalog, curriculum levels, and capability data.
 * Sessions feed directly into Dojo.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { SKILL_CURRICULA, getCurriculumLevel, type CurriculumLevel } from './learnSkillCurriculum';
import { buildKIClusterMap, getKIIdsForLevel } from './learnKIClusterMap';
import { selectKIsForLevel } from './kiClusterBuilder';
import { fetchFullKICatalog } from '@/lib/dojo/v3/kiCatalogBridge';
import { buildCapabilityProfiles } from '@/lib/dojo/v4/capabilityModel';
import type { KICatalogEntry } from '@/lib/dojo/v3/programmingEngine';
import { runSkillBuilderCoverageAudit } from './skillBuilderCoverageAudit';
import { getSkillDepthProfile, getPatternCoverage } from './skillBuilderHardening';
import { evaluateSkillLevel, type UserSkillLevel } from './learnLevelEvaluator';
import { getSkillLevel as getSkillLevelDef, getCumulativePatterns } from './learnSkillLevels';

// ── Types ──────────────────────────────────────────────────────────

export type SkillBlockType = 'mental_model' | 'ki_intro' | 'rep' | 'reflection';

export interface SkillBlockMentalModel {
  type: 'mental_model';
  skill: SkillFocus;
  levelName: string;
  levelDescription: string;
  focusPatterns: string[];
}

export interface SkillBlockKIIntro {
  type: 'ki_intro';
  kiId: string;
  kiTitle: string;
  focusPattern: string;
}

export interface SkillBlockRep {
  type: 'rep';
  focusPattern: string;
  kiId: string;
  kiTitle: string;
  scenarioContext: string;
  scenarioObjection: string;
  difficulty: 'foundational' | 'intermediate' | 'advanced';
}

export interface SkillBlockReflection {
  type: 'reflection';
  prompt: string;
  focusPatternsReviewed: string[];
}

export type SkillBlock =
  | SkillBlockMentalModel
  | SkillBlockKIIntro
  | SkillBlockRep
  | SkillBlockReflection;

export interface SkillTrack {
  skill: SkillFocus;
  skillLabel: string;
  durationMinutes: number;
  currentLevel: number;
  levelName: string;
  blocks: SkillBlock[];
  kiIdsUsed: string[];
  focusPatternsUsed: string[];
  /** Level evaluation details for UI display */
  levelEvaluation?: UserSkillLevel;
}

export interface GenerateSkillTrackInput {
  userId: string;
  skill: SkillFocus;
  durationMinutes: 15 | 30 | 60;
}

// ── Duration → Pattern Count ──────────────────────────────────────

function getPatternCount(duration: number, shouldDegrade: boolean = false): number {
  if (duration <= 15) return 2;
  if (duration <= 30) return shouldDegrade ? 2 : 3;
  // 60 min: degrade to fewer patterns if skill is thin
  return shouldDegrade ? 3 : 5;
}

// ── Determine User Level ──────────────────────────────────────────

function determineLevel(
  skill: SkillFocus,
  firstAttemptStrength: number,
  consistency: number,
  pressureScore: number | null,
): number {
  const curriculum = SKILL_CURRICULA[skill];
  const maxLevel = curriculum.levels.length;

  // Strong performer → highest level
  if (firstAttemptStrength >= 75 && consistency >= 70) {
    return maxLevel;
  }

  // Building → mid level
  if (firstAttemptStrength >= 55 || consistency >= 55) {
    return Math.min(2, maxLevel);
  }

  // Everyone else starts at level 1
  return 1;
}

// ── Main Generator ────────────────────────────────────────────────

export async function generateSkillTrack(
  input: GenerateSkillTrackInput,
): Promise<SkillTrack> {
  const { userId, skill, durationMinutes } = input;

  // Fetch data in parallel
  const [catalog, capabilities, coverageReport] = await Promise.all([
    fetchFullKICatalog(userId),
    buildCapabilityProfiles(userId),
    runSkillBuilderCoverageAudit(userId).catch(() => null),
  ]);

  // Determine user level from capability data
  const cap = capabilities.find(c => c.skill === skill);
  const firstAttemptStrength = cap?.firstAttemptStrength ?? 0;
  const consistency = cap?.consistency ?? 0;
  const pressureScore = cap?.pressureScore ?? null;

  const currentLevel = determineLevel(skill, firstAttemptStrength, consistency, pressureScore);
  const curriculum = SKILL_CURRICULA[skill];
  const levelDef = getCurriculumLevel(skill, currentLevel)!;

  // Coverage-aware depth check: degrade gracefully for thin skills
  const depthProfile = coverageReport ? getSkillDepthProfile(coverageReport, skill) : null;
  const shouldDegrade = depthProfile?.shouldDegrade60 === true && durationMinutes >= 60;

  // Fetch recent KI IDs to avoid repetition (extend window for longer sessions)
  const recentDays = durationMinutes >= 60 ? 14 : 7;
  const recentKIIds = await fetchRecentlyUsedKIIds(userId, recentDays);

  // Build cluster map for KI selection
  const clusterMap = buildKIClusterMap(catalog);

  // Select focus patterns for this session
  const patternCount = getPatternCount(durationMinutes, shouldDegrade);
  const selectedPatterns = selectPatterns(levelDef, curriculum.levels, patternCount, currentLevel);

  // Select KIs for each pattern — avoid repeats more aggressively
  const kisByPattern = new Map<string, KICatalogEntry[]>();
  const usedKIIds = new Set<string>(recentKIIds);

  for (const pattern of selectedPatterns) {
    const patternKIs = catalog.filter(ki => ki.focusPatterns.includes(pattern));
    // Prefer KIs not recently used
    const freshKIs = patternKIs.filter(ki => !usedKIIds.has(ki.id));
    const pool = freshKIs.length > 0 ? freshKIs : patternKIs;

    const selected = selectKIsForLevel(pool, levelDef, Array.from(usedKIIds), 1);
    if (selected.length > 0) {
      kisByPattern.set(pattern, selected);
      selected.forEach(ki => usedKIIds.add(ki.id));
    } else if (pool.length > 0) {
      kisByPattern.set(pattern, [pool[0]]);
      usedKIIds.add(pool[0].id);
    }
  }

  // Build blocks: Mental Model → (KI → Rep)* → Reflection
  const blocks: SkillBlock[] = [];
  const kiIdsUsed: string[] = [];
  const focusPatternsUsed: string[] = [];

  // 1. Mental Model
  blocks.push({
    type: 'mental_model',
    skill,
    levelName: levelDef.name,
    levelDescription: levelDef.description,
    focusPatterns: selectedPatterns,
  });

  // 2. KI + Rep pairs
  for (const pattern of selectedPatterns) {
    const kis = kisByPattern.get(pattern);
    if (!kis || kis.length === 0) continue;

    const ki = kis[0];
    kiIdsUsed.push(ki.id);
    focusPatternsUsed.push(pattern);

    // KI Introduction
    blocks.push({
      type: 'ki_intro',
      kiId: ki.id,
      kiTitle: ki.title,
      focusPattern: pattern,
    });

    // Rep
    blocks.push({
      type: 'rep',
      focusPattern: pattern,
      kiId: ki.id,
      kiTitle: ki.title,
      scenarioContext: buildScenarioContext(skill, pattern, ki),
      scenarioObjection: buildScenarioObjection(skill, pattern),
      difficulty: mapDifficulty(currentLevel),
    });
  }

  // 3. Reflection
  blocks.push({
    type: 'reflection',
    prompt: buildReflectionPrompt(skill, focusPatternsUsed, currentLevel),
    focusPatternsReviewed: focusPatternsUsed,
  });

  return {
    skill,
    skillLabel: SKILL_LABELS[skill],
    durationMinutes,
    currentLevel,
    levelName: levelDef.name,
    blocks,
    kiIdsUsed,
    focusPatternsUsed,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function selectPatterns(
  primary: CurriculumLevel,
  allLevels: CurriculumLevel[],
  count: number,
  currentLevel: number,
): string[] {
  const patterns: string[] = [];
  const seen = new Set<string>();

  // Start with primary level patterns
  for (const p of primary.focusPatterns) {
    if (!seen.has(p) && patterns.length < count) {
      patterns.push(p);
      seen.add(p);
    }
  }

  // Fill from adjacent levels if needed
  if (patterns.length < count) {
    // Pull from level below first (reinforcement), then above (stretch)
    const orderedLevels = allLevels
      .filter(l => l.level !== currentLevel)
      .sort((a, b) => {
        const da = Math.abs(a.level - currentLevel);
        const db = Math.abs(b.level - currentLevel);
        if (da !== db) return da - db;
        return a.level - b.level; // prefer lower (reinforcement)
      });

    for (const level of orderedLevels) {
      for (const p of level.focusPatterns) {
        if (!seen.has(p) && patterns.length < count) {
          patterns.push(p);
          seen.add(p);
        }
      }
    }
  }

  return patterns;
}

function mapDifficulty(level: number): 'foundational' | 'intermediate' | 'advanced' {
  if (level <= 1) return 'foundational';
  if (level <= 2) return 'intermediate';
  return 'advanced';
}

function buildScenarioContext(skill: SkillFocus, pattern: string, ki: KICatalogEntry): string {
  // Build a context string from KI data
  const base = `Apply "${ki.title}" in a ${SKILL_LABELS[skill].toLowerCase()} scenario.`;
  return base;
}

function buildScenarioObjection(skill: SkillFocus, pattern: string): string {
  // Generate a generic objection aligned to the pattern
  const objections: Record<string, string> = {
    isolate_before_answering: "We're already working with someone on this.",
    reframe_to_business_impact: "It's too expensive for what it does.",
    use_specific_proof: "How do I know this actually works?",
    stay_concise_under_pressure: "Just give me the bottom line.",
    control_next_step: "Let me think about it and get back to you.",
    deepen_one_level: "Our current process works fine.",
    tie_to_business_impact: "I don't see how this affects our revenue.",
    ask_singular_questions: "What exactly do you need to know?",
    test_urgency: "We're not in a rush to change anything.",
    quantify_the_pain: "It's not that big of a deal.",
    lead_with_the_number: "What's the ROI here?",
    cut_to_three_sentences: "I have 2 minutes. Go.",
    anchor_to_their_priority: "How does this fit our Q3 goals?",
    project_certainty: "Are you sure this will work for us?",
    close_with_a_specific_ask: "So what are you proposing exactly?",
    name_the_risk: "We'll figure out the timeline later.",
    lock_mutual_commitment: "Let's just see how things go.",
    test_before_accepting: "I'll circle back after our planning meeting.",
    create_urgency_without_pressure: "There's no rush on our end.",
    validate_real_pain: "Yeah, it's a nice-to-have I guess.",
    map_stakeholders: "I'm the only one involved in this decision.",
    disqualify_weak_opportunities: "We're just exploring options right now.",
    tie_problem_to_business_impact: "It's more of an operational issue.",
  };

  return objections[pattern] ?? "Tell me why I should care about this.";
}

function buildReflectionPrompt(
  skill: SkillFocus,
  patterns: string[],
  level: number,
): string {
  const patternList = patterns.length > 0
    ? patterns.map(p => p.replace(/_/g, ' ')).join(', ')
    : 'the session patterns';

  if (level <= 1) {
    return `What was the hardest moment in today's ${SKILL_LABELS[skill].toLowerCase()} practice? Which pattern (${patternList}) felt least natural?`;
  }
  if (level <= 2) {
    return `Where did you feel in control and where did control slip? Think about ${patternList}.`;
  }
  return `What would you do differently in a live call? Which of today's patterns (${patternList}) would change the outcome most?`;
}

async function fetchRecentlyUsedKIIds(userId: string, days: number): Promise<string[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from('daily_assignments' as any)
    .select('kis')
    .eq('user_id', userId)
    .gte('assignment_date', since.toISOString().split('T')[0])
    .limit(14);

  if (!data) return [];

  const ids = new Set<string>();
  for (const row of data as any[]) {
    const kis = row.kis;
    if (Array.isArray(kis)) {
      for (const id of kis) {
        if (typeof id === 'string') ids.add(id);
      }
    }
  }
  return Array.from(ids);
}
