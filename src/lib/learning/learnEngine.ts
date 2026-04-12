/**
 * Learn Engine — Phase 1
 *
 * Provides daily learn loop data:
 * - Today's Mental Model (derived from assignment + skill memory)
 * - Reinforcement Queue (KIs missed in recent reps)
 * - Last Rep Insights (applied/missed from most recent session)
 *
 * All data is derived from real dojo_sessions, dojo_session_turns,
 * knowledge_items, and the DailyAssignment. No fake content.
 */

import { supabase } from '@/integrations/supabase/client';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';
import type { DailyKIContext } from '@/hooks/useDailyKI';
import { getMistakeEntry } from '@/lib/dojo/mistakeTaxonomy';
import type { SkillMemory } from '@/lib/dojo/skillMemory';

// ── Types ──────────────────────────────────────────────────────────

export interface MentalModel {
  /** What matters today — 1 sentence */
  whatMatters: string;
  /** Common failure pattern — 1 sentence */
  failurePattern: string;
  /** Correct behavior example — 1 sentence */
  correctBehavior: string;
  /** Persistent mistake warning (if applicable) */
  persistentMistake: string | null;
  /** Multi-thread advisory (if applicable) */
  multiThreadAdvisory: string | null;
}

export interface LastRepInsight {
  sessionId: string;
  score: number;
  focusApplied: 'yes' | 'partial' | 'no' | 'unknown';
  kiTitle: string | null;
  topMistake: string | null;
  topMistakeLabel: string | null;
  feedback: string | null;
  completedAt: string;
}

export interface ReinforcementItem {
  kiId: string;
  kiTitle: string;
  mistakeItFixes: string | null;
  lastSeen: string;
  missCount: number;
}

// ── Mental Model ───────────────────────────────────────────────────

export function buildMentalModel(
  dailyKI: DailyKIContext,
  skillMemory: SkillMemory | null,
): MentalModel {
  const ki = dailyKI.items[0];
  const anchor = dailyKI.anchor;
  const focusPattern = dailyKI.focusPattern;

  // What matters today
  const whatMatters = ki?.tactic_summary
    ? `Today's focus: ${ki.tactic_summary}`
    : `Today we're working on ${focusPattern.replace(/_/g, ' ')} — build the muscle memory.`;

  // Find persistent mistake for this skill area
  let persistentMistake: string | null = null;
  let failurePattern = 'Reps without intention don\'t compound. Be deliberate with every response.';

  if (skillMemory) {
    // Find the profile that matches this anchor's skill
    const anchorSkillMap: Record<string, string> = {
      monday: 'objection_handling',
      tuesday: 'discovery',
      wednesday: 'objection_handling',
      thursday: 'deal_control',
      friday: 'executive_response',
    };
    const targetSkill = anchorSkillMap[anchor] ?? 'objection_handling';
    const profile = skillMemory.profiles.find(p => p.skill === targetSkill);

    if (profile && profile.topMistakes.length > 0) {
      const topMistake = profile.topMistakes[0];
      const entry = getMistakeEntry(topMistake.mistake);
      if (entry) {
        persistentMistake = `You've been breaking on: ${entry.label}`;
        failurePattern = entry.whyItHurts;
      }
    }
  }

  // Correct behavior example
  let correctBehavior = ki?.how_to_execute
    ?? ki?.example_usage
    ?? 'When the moment comes, execute the tactic exactly — don\'t improvise until you\'ve earned it.';

  // Multi-thread advisory
  let multiThreadAdvisory: string | null = null;
  if (dailyKI.items[0] && (dailyKI as any).multiThreadExpected) {
    multiThreadAdvisory = 'Multiple stakeholders = multiple priorities. Don\'t answer just one.';
  }

  return {
    whatMatters,
    failurePattern,
    correctBehavior,
    persistentMistake,
    multiThreadAdvisory,
  };
}

// ── Last Rep Insights ──────────────────────────────────────────────

export async function getLastRepInsights(userId: string): Promise<LastRepInsight | null> {
  // Get most recent completed session
  const { data: session } = await supabase
    .from('dojo_sessions')
    .select('id, latest_score, skill_focus, completed_at, assignment_id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) return null;

  // Get first turn for this session
  const { data: turn } = await supabase
    .from('dojo_session_turns')
    .select('score, score_json, top_mistake, feedback')
    .eq('session_id', session.id)
    .eq('turn_index', 0)
    .single();

  if (!turn) return null;

  const scoreJson = turn.score_json as Record<string, any> | null;
  const focusApplied = (scoreJson?.focusApplied as string) ?? 'unknown';

  // Try to get KI title from the assignment
  let kiTitle: string | null = null;
  if (session.assignment_id) {
    const { data: assignment } = await supabase
      .from('daily_assignments')
      .select('kis')
      .eq('id', session.assignment_id)
      .single();

    if (assignment?.kis) {
      const kiIds = assignment.kis as unknown as string[];
      if (kiIds.length > 0) {
        const { data: kiData } = await supabase
          .from('knowledge_items' as any)
          .select('title')
          .eq('id', kiIds[0])
          .single();
        kiTitle = (kiData as any)?.title ?? null;
      }
    }
  }

  const mistakeEntry = turn.top_mistake ? getMistakeEntry(turn.top_mistake) : null;

  return {
    sessionId: session.id,
    score: turn.score ?? session.latest_score ?? 0,
    focusApplied: focusApplied as LastRepInsight['focusApplied'],
    kiTitle,
    topMistake: turn.top_mistake,
    topMistakeLabel: mistakeEntry?.label ?? turn.top_mistake,
    feedback: turn.feedback,
    completedAt: session.completed_at ?? '',
  };
}

// ── Reinforcement Queue ────────────────────────────────────────────

export async function getReinforcementQueue(userId: string): Promise<ReinforcementItem[]> {
  // Get last 5 completed sessions with their turns
  const { data: sessions } = await supabase
    .from('dojo_sessions')
    .select('id, assignment_id, completed_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(5);

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map(s => s.id);
  const assignmentIds = sessions.map(s => s.assignment_id).filter(Boolean) as string[];

  // Get first turns
  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('session_id, score_json, top_mistake, score')
    .in('session_id', sessionIds)
    .eq('turn_index', 0);

  // Get assignments to find KI IDs
  let assignmentKIs: Record<string, { kis: string[]; date: string }> = {};
  if (assignmentIds.length > 0) {
    const { data: assignments } = await supabase
      .from('daily_assignments')
      .select('id, kis, assignment_date')
      .in('id', assignmentIds);

    for (const a of assignments ?? []) {
      assignmentKIs[a.id] = {
        kis: (a.kis as unknown as string[]) ?? [],
        date: a.assignment_date,
      };
    }
  }

  // Find KIs where focusApplied = 'no' or same mistake repeated
  const missedKIIds = new Map<string, { count: number; lastSeen: string; mistake: string | null }>();

  for (const session of sessions) {
    if (!session.assignment_id) continue;
    const aData = assignmentKIs[session.assignment_id];
    if (!aData) continue;

    const turn = (turns ?? []).find(t => t.session_id === session.id);
    if (!turn) continue;

    const sj = turn.score_json as Record<string, any> | null;
    const focusApplied = sj?.focusApplied as string | undefined;

    if (focusApplied === 'no' || (turn.score !== null && turn.score < 55)) {
      for (const kiId of aData.kis) {
        const existing = missedKIIds.get(kiId);
        if (existing) {
          existing.count++;
        } else {
          missedKIIds.set(kiId, {
            count: 1,
            lastSeen: session.completed_at ?? aData.date,
            mistake: turn.top_mistake,
          });
        }
      }
    }
  }

  if (missedKIIds.size === 0) return [];

  // Resolve KI titles
  const kiIds = Array.from(missedKIIds.keys());
  const { data: kiRows } = await supabase
    .from('knowledge_items' as any)
    .select('id, title')
    .in('id', kiIds);

  const items: ReinforcementItem[] = [];
  for (const ki of (kiRows ?? []) as any[]) {
    const miss = missedKIIds.get(ki.id);
    if (!miss) continue;
    const mistakeEntry = miss.mistake ? getMistakeEntry(miss.mistake) : null;
    items.push({
      kiId: ki.id,
      kiTitle: ki.title,
      mistakeItFixes: mistakeEntry?.label ?? miss.mistake,
      lastSeen: miss.lastSeen,
      missCount: miss.count,
    });
  }

  // Sort by miss count desc, return max 3
  items.sort((a, b) => b.missCount - a.missCount);
  return items.slice(0, 3);
}
