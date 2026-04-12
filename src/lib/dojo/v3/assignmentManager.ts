/**
 * V3 Assignment Manager
 *
 * Manages DailyAssignment persistence — the single source of truth for each day.
 *
 * Rules:
 * - One assignment per user per day (UNIQUE constraint in DB)
 * - Once created, the same assignment is reused for the entire day
 * - Assignment is NOT regenerated on every render
 * - recentAssignments is populated from real DB history
 * - KI selection uses real knowledge_items as catalog source
 */

import { supabase } from '@/integrations/supabase/client';
import { getOrCreateActiveBlock } from './blockManager';
import { generateDailyAssignment, type DailyAssignment, type RecentAssignment, type KICatalogEntry, type ProgrammingInput } from './programmingEngine';
import { getAnchorForDate, type DayAnchor, ANCHORS_IN_ORDER } from './dayAnchors';
import { buildSkillMemory, type SkillMemory } from '../skillMemory';

// ── Public API ────────────────────────────────────────────────────

/**
 * Get today's assignment. If it doesn't exist yet, generate and persist it.
 * This is the ONLY entry point for getting the daily assignment.
 */
export async function getOrCreateTodayAssignment(userId: string): Promise<DailyAssignment | null> {
  const today = new Date().toISOString().split('T')[0];
  const anchor = getAnchorForDate(new Date());

  // Weekend — no assignment
  if (!anchor) return null;

  // 1. Check if assignment already exists for today
  const existing = await fetchAssignment(userId, today);
  if (existing) return existing;

  // 2. Generate a new one with real inputs
  const block = await getOrCreateActiveBlock(userId);

  const [skillMemory, recentAssignments, kiCatalog] = await Promise.all([
    buildSkillMemory(userId),
    fetchRecentAssignments(userId, 7),
    fetchKICatalog(userId),
  ]);

  const input: ProgrammingInput = {
    date: new Date(),
    block,
    skillMemory,
    recentAssignments,
    transcriptScenarios: [], // TODO: wire transcript extraction
    kiCatalog,
  };

  const assignment = generateDailyAssignment(input);

  // 3. Persist to DB
  await persistAssignment(userId, today, block.id, assignment);

  return assignment;
}

/**
 * Mark today's assignment as completed and link a session to it.
 * Also updates block progress (unique anchor tracking).
 */
export async function completeAssignment(
  userId: string,
  assignmentDate: string,
  sessionId: string,
): Promise<void> {
  // 1. Fetch current assignment
  const { data: row } = await supabase
    .from('daily_assignments')
    .select('id, session_ids, day_anchor, block_id')
    .eq('user_id', userId)
    .eq('assignment_date', assignmentDate)
    .single();

  if (!row) return;

  const currentSessions: string[] = (row.session_ids as string[] | null) ?? [];

  // 2. Update assignment: mark completed, append session ID
  await supabase
    .from('daily_assignments')
    .update({
      completed: true,
      session_ids: [...currentSessions, sessionId],
    })
    .eq('id', row.id);

  // 3. Update block: record unique anchor completion
  await recordAnchorCompletion(row.block_id, row.day_anchor as DayAnchor);
}

/**
 * Get which unique anchors are completed this week for a block.
 * Reads from daily_assignments, not from a separate column.
 */
export async function getCompletedAnchorsThisWeek(blockId: string): Promise<DayAnchor[]> {
  const { data: block } = await supabase
    .from('training_blocks')
    .select('current_week, user_id')
    .eq('id', blockId)
    .single();

  if (!block) return [];

  // Find all completed assignments for this block + week
  const { data: assignments } = await supabase
    .from('daily_assignments')
    .select('day_anchor')
    .eq('block_id', blockId)
    .eq('block_week', block.current_week)
    .eq('completed', true);

  if (!assignments) return [];

  // Unique anchors only
  const anchors = new Set(assignments.map(a => a.day_anchor as DayAnchor));
  return ANCHORS_IN_ORDER.filter(a => anchors.has(a));
}

// ── Internal ──────────────────────────────────────────────────────

async function fetchAssignment(userId: string, date: string): Promise<DailyAssignment | null> {
  const { data } = await supabase
    .from('daily_assignments')
    .select('*')
    .eq('user_id', userId)
    .eq('assignment_date', date)
    .single();

  if (!data) return null;
  return mapRowToAssignment(data);
}

async function fetchRecentAssignments(userId: string, days: number): Promise<RecentAssignment[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data } = await supabase
    .from('daily_assignments')
    .select('assignment_date, transcript_scenario_used, day_anchor, primary_skill, focus_pattern')
    .eq('user_id', userId)
    .gte('assignment_date', cutoff.toISOString().split('T')[0])
    .order('assignment_date', { ascending: false });

  if (!data) return [];

  return data.map(row => ({
    assignmentDate: row.assignment_date,
    transcriptScenarioUsed: row.transcript_scenario_used,
    dayAnchor: row.day_anchor as DayAnchor,
    primarySkill: row.primary_skill as any,
    focusPattern: row.focus_pattern,
  }));
}

async function fetchKICatalog(userId: string): Promise<KICatalogEntry[]> {
  const { data } = await supabase
    .from('knowledge_items' as any)
    .select('id, title, tags, confidence_score, updated_at')
    .eq('user_id', userId)
    .eq('active', true)
    .limit(100);

  if (!data) return [];

  return (data as any[]).map(ki => ({
    id: ki.id,
    title: ki.title ?? '',
    skills: inferSkillsFromTags(ki.tags ?? []),
    focusPatterns: inferPatternsFromTags(ki.tags ?? []),
    lastTaughtAt: ki.updated_at ?? null,
  }));
}

async function persistAssignment(
  userId: string,
  date: string,
  blockId: string,
  assignment: DailyAssignment,
): Promise<void> {
  const { error } = await supabase
    .from('daily_assignments')
    .insert({
      user_id: userId,
      assignment_date: date,
      block_id: blockId,
      block_week: assignment.blockWeek,
      block_phase: assignment.blockPhase,
      day_anchor: assignment.dayAnchor,
      primary_skill: assignment.primarySkill,
      focus_pattern: assignment.focusPattern,
      kis: assignment.kis as any,
      scenarios: assignment.scenarios as any,
      difficulty: assignment.difficulty,
      retry_strategy: assignment.retryStrategy,
      transcript_scenario_used: assignment.transcriptScenarioUsed,
      benchmark_tag: assignment.benchmarkTag,
      scenario_family_id: assignment.scenarioFamilyId,
      reason: assignment.reason,
      source: assignment.source,
    });

  if (error) {
    // UNIQUE violation = assignment already exists (race condition), which is fine
    if (error.code !== '23505') {
      console.error('[AssignmentManager] Failed to persist assignment:', error);
    }
  }
}

/**
 * Record that a unique anchor was completed for this block's current week.
 * Checks if all 5 anchors are done → advances the week.
 */
async function recordAnchorCompletion(blockId: string, anchor: DayAnchor): Promise<void> {
  const completedAnchors = await getCompletedAnchorsThisWeek(blockId);

  // Update the session counter for compatibility
  await supabase
    .from('training_blocks')
    .update({
      completed_sessions_this_week: completedAnchors.length,
    })
    .eq('id', blockId);

  // All 5 unique anchors completed → advance week
  if (completedAnchors.length >= 5) {
    // Import dynamically to avoid circular deps
    const { advanceWeek } = await import('./blockManager');
    await advanceWeek(blockId);
  }
}

// ── Mapping ───────────────────────────────────────────────────────

function mapRowToAssignment(row: Record<string, unknown>): DailyAssignment {
  return {
    blockNumber: row.block_week as number, // block_week is stored; blockNumber comes from block
    blockWeek: row.block_week as number,
    blockPhase: row.block_phase as any,
    dayAnchor: row.day_anchor as DayAnchor,
    primarySkill: row.primary_skill as any,
    focusPattern: row.focus_pattern as string,
    kis: (row.kis as string[]) ?? [],
    scenarios: (row.scenarios as any[]) ?? [],
    difficulty: row.difficulty as any,
    retryStrategy: row.retry_strategy as any,
    transcriptScenarioUsed: row.transcript_scenario_used as boolean,
    benchmarkTag: row.benchmark_tag as boolean,
    scenarioFamilyId: row.scenario_family_id as string | null,
    reason: row.reason as string,
    source: row.source as any,
  };
}

// ── Tag → Skill/Pattern inference ─────────────────────────────────

const TAG_SKILL_MAP: Record<string, string> = {
  objection: 'objection_handling',
  objections: 'objection_handling',
  discovery: 'discovery',
  qualification: 'qualification',
  executive: 'executive_response',
  deal_control: 'deal_control',
  negotiation: 'deal_control',
  closing: 'deal_control',
  cold_call: 'objection_handling',
  pricing: 'objection_handling',
  roi: 'executive_response',
};

function inferSkillsFromTags(tags: string[]): any[] {
  const skills = new Set<string>();
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [key, skill] of Object.entries(TAG_SKILL_MAP)) {
      if (lower.includes(key)) skills.add(skill);
    }
  }
  return skills.size > 0 ? Array.from(skills) as any[] : ['objection_handling'];
}

const TAG_PATTERN_MAP: Record<string, string> = {
  isolate: 'isolate_before_answering',
  reframe: 'reframe_to_business_impact',
  proof: 'use_specific_proof',
  deepen: 'deepen_one_level',
  quantify: 'quantify_the_pain',
  stakeholder: 'map_stakeholders',
  commitment: 'lock_mutual_commitment',
  next_step: 'control_next_step',
};

function inferPatternsFromTags(tags: string[]): string[] {
  const patterns = new Set<string>();
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [key, pattern] of Object.entries(TAG_PATTERN_MAP)) {
      if (lower.includes(key)) patterns.add(pattern);
    }
  }
  return Array.from(patterns);
}
