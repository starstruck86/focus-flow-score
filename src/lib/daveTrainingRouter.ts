/**
 * Dave Training Router — Intelligent recommendation engine for audio entry.
 *
 * Given user state (progression, recent sessions, unfinished work),
 * produces a single recommended next move with a spoken intro.
 *
 * OWNERSHIP: This is the "brain" that decides what Dave launches.
 * It does NOT own audio delivery — that stays in useDaveVoiceController.
 */

import { supabase } from '@/integrations/supabase/client';
import { loadVoiceSessionBuffer, type VoiceSessionBuffer } from '@/lib/daveSessionBuffer';
import { loadActiveLoop, type ClosedLoopProgressSummary, buildProgressSummary } from '@/lib/daveClosedLoopStore';
import { buildLoopResumeInfo, shouldPrioritizeLoop } from '@/lib/daveClosedLoopResume';
import type { ClosedLoopSession } from '@/lib/daveClosedLoopEngine';
import type { VoiceSurface } from '@/lib/daveVoiceRuntime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveTrainingRouter');

// ── Types ──────────────────────────────────────────────────────────

export interface DaveRecommendation {
  type: VoiceSurface;
  reason: string;
  launchState: Record<string, unknown>;
  spokenIntro: string;
}

export interface UserTrainingContext {
  userId: string;
  /** Recent dojo sessions with scores */
  recentSessions: Array<{
    skill_focus: string;
    latest_score: number | null;
    completed_at: string | null;
    status: string;
  }>;
  /** Unfinished voice session buffer */
  pendingBuffer: VoiceSessionBuffer | null;
  /** Skill with lowest average score */
  weakestSkill: string | null;
  weakestScore: number | null;
  /** Whether there's an active skill builder session */
  hasActiveSkillBuilder: boolean;
  /** Active closed-loop coaching session */
  activeLoop: ClosedLoopSession | null;
}

// ── Intent Parsing ─────────────────────────────────────────────────

export type UserIntent =
  | 'quick_rep'
  | 'teach_skill'
  | 'weakest_area'
  | 'resume'
  | 'cold_calling'
  | 'objection_handling'
  | 'discovery'
  | 'deal_control'
  | 'qualification'
  | 'executive_response'
  | 'what_next'
  | 'unknown';

const INTENT_PATTERNS: [UserIntent, RegExp][] = [
  ['resume', /\b(pick\s+up|resume|continue|where\s+I\s+left|keep\s+going)\b/i],
  ['quick_rep', /\b(quick\s+rep|fast\s+rep|one\s+rep|short\s+practice|warm\s+up)\b/i],
  ['weakest_area', /\b(weakest|worst|struggle|need\s+work|improve|gap)\b/i],
  ['cold_calling', /\b(cold\s+call|outbound|prospecting)\b/i],
  ['objection_handling', /\b(objection|pushback|handle\s+objection|overcome)\b/i],
  ['discovery', /\b(discovery|discover|pain|excavat|depth)\b/i],
  ['deal_control', /\b(deal\s+control|close|negotiat|next\s+step)\b/i],
  ['qualification', /\b(qualif|budget|authority|timeline|BANT|MEDDIC)\b/i],
  ['executive_response', /\b(executive|c-suite|VP|senior\s+leader|board)\b/i],
  ['teach_skill', /\b(teach|learn|explain|coach\s+me|show\s+me|help\s+me\s+understand)\b/i],
  ['what_next', /\b(what\s+should|what\s+next|recommend|suggest|where\s+do\s+I)\b/i],
];

export function parseUserIntent(transcript: string): UserIntent {
  const trimmed = transcript.trim().toLowerCase();
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(trimmed)) return intent;
  }
  return 'unknown';
}

// ── Context Fetching ──────────────────────────────────────────────

export async function fetchTrainingContext(userId: string): Promise<UserTrainingContext> {
  const pendingBuffer = loadVoiceSessionBuffer();

  // Fetch recent dojo sessions + active closed-loop in parallel
  const [sessionsResult, activeLoop] = await Promise.all([
    supabase
      .from('dojo_sessions')
      .select('skill_focus, latest_score, completed_at, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    loadActiveLoop(userId),
  ]);

  const recentSessions = (sessionsResult.data || []).map(s => ({
    skill_focus: s.skill_focus,
    latest_score: s.latest_score,
    completed_at: s.completed_at,
    status: s.status,
  }));

  // Compute weakest skill from recent completed sessions
  const skillScores: Record<string, number[]> = {};
  for (const s of recentSessions) {
    if (s.latest_score != null && s.status === 'completed') {
      if (!skillScores[s.skill_focus]) skillScores[s.skill_focus] = [];
      skillScores[s.skill_focus].push(s.latest_score);
    }
  }

  let weakestSkill: string | null = null;
  let weakestScore: number | null = null;
  for (const [skill, scores] of Object.entries(skillScores)) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (weakestScore === null || avg < weakestScore) {
      weakestSkill = skill;
      weakestScore = Math.round(avg);
    }
  }

  const hasActiveSkillBuilder = pendingBuffer?.surface === 'skill_builder';

  return {
    userId,
    recentSessions,
    pendingBuffer,
    weakestSkill,
    weakestScore,
    hasActiveSkillBuilder,
    activeLoop,
  };
}

// ── Routing Logic ─────────────────────────────────────────────────

export function routeByIntent(
  intent: UserIntent,
  ctx: UserTrainingContext,
): DaveRecommendation {
  // Active closed-loop coaching takes priority for resume and what_next
  if ((intent === 'resume' || intent === 'what_next') && shouldPrioritizeLoop(ctx.activeLoop)) {
    return buildLoopRecommendation(ctx.activeLoop!);
  }

  // Resume always wins if there's a pending session
  if (intent === 'resume' && ctx.pendingBuffer) {
    return buildResumeRecommendation(ctx.pendingBuffer);
  }

  // Quick rep → Dojo with default or weakest skill
  if (intent === 'quick_rep') {
    const skill = ctx.weakestSkill || 'discovery';
    return {
      type: 'dojo',
      reason: 'Quick practice rep',
      launchState: { skill, mode: 'quick' },
      spokenIntro: `Quick rep. Let's work on ${formatSkill(skill)}.`,
    };
  }

  // Specific skill requests → Dojo
  const skillIntents: Record<string, string> = {
    cold_calling: 'discovery',
    objection_handling: 'objection_handling',
    discovery: 'discovery',
    deal_control: 'deal_control',
    qualification: 'qualification',
    executive_response: 'executive_response',
  };
  if (skillIntents[intent]) {
    const skill = skillIntents[intent];
    return {
      type: 'dojo',
      reason: `Focused practice on ${formatSkill(skill)}`,
      launchState: { skill },
      spokenIntro: `Starting a ${formatSkill(skill)} rep.`,
    };
  }

  // Teach → Learn
  if (intent === 'teach_skill') {
    const skill = ctx.weakestSkill || 'discovery';
    return {
      type: 'learn',
      reason: `Teaching ${formatSkill(skill)}`,
      launchState: { skill },
      spokenIntro: `Let me coach you on ${formatSkill(skill)}.`,
    };
  }

  // Weakest area → route to Learn if score is very low, Dojo otherwise
  if (intent === 'weakest_area') {
    const skill = ctx.weakestSkill || 'discovery';
    const score = ctx.weakestScore ?? 0;
    if (score < 40) {
      return {
        type: 'learn',
        reason: `${formatSkill(skill)} needs concept reinforcement`,
        launchState: { skill },
        spokenIntro: `Your weakest area is ${formatSkill(skill)} at ${score}%. Let me teach the concepts first.`,
      };
    }
    return {
      type: 'dojo',
      reason: `${formatSkill(skill)} needs practice reps`,
      launchState: { skill },
      spokenIntro: `Your weakest area is ${formatSkill(skill)} at ${score}%. Let's drill it.`,
    };
  }

  // What next / unknown → smart default
  return buildSmartDefault(ctx);
}

function buildResumeRecommendation(buffer: VoiceSessionBuffer): DaveRecommendation {
  const surfaceLabel = buffer.surface === 'dojo' ? 'Dojo rep'
    : buffer.surface === 'learn' ? 'coaching session'
    : buffer.surface === 'skill_builder' ? 'Skill Builder session'
    : 'session';

  return {
    type: buffer.surface,
    reason: 'Resuming previous session',
    launchState: {
      sessionId: buffer.sessionId,
      position: buffer.position,
      resume: true,
    },
    spokenIntro: `Picking up your ${surfaceLabel} where you left off. You were on step ${buffer.position + 1}.`,
  };
}

function buildSmartDefault(ctx: UserTrainingContext): DaveRecommendation {
  // Active closed-loop coaching outranks generic recommendations
  if (shouldPrioritizeLoop(ctx.activeLoop)) {
    return buildLoopRecommendation(ctx.activeLoop!);
  }

  // Resume pending if exists
  if (ctx.pendingBuffer) {
    return buildResumeRecommendation(ctx.pendingBuffer);
  }

  // Active skill builder → continue that
  if (ctx.hasActiveSkillBuilder) {
    return {
      type: 'skill_builder',
      reason: 'Unfinished Skill Builder session',
      launchState: { resume: true },
      spokenIntro: "You have an unfinished Skill Builder session. Let's finish it.",
    };
  }

  // Weakest skill reps
  const skill = ctx.weakestSkill || 'discovery';
  const score = ctx.weakestScore;

  if (score != null && score < 50) {
    return {
      type: 'learn',
      reason: `${formatSkill(skill)} needs coaching`,
      launchState: { skill },
      spokenIntro: `I'd focus on ${formatSkill(skill)}. Your average is ${score}%. Let me coach you through the key concepts.`,
    };
  }

  return {
    type: 'dojo',
    reason: 'Practice rep on weakest skill',
    launchState: { skill },
    spokenIntro: score
      ? `Let's sharpen ${formatSkill(skill)}. You're at ${score}%.`
      : `Let's start with a ${formatSkill(skill)} rep.`,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatSkill(skill: string): string {
  return skill
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Objection Handling', 'objection handling')
    .replace('Deal Control', 'deal control')
    .replace('Executive Response', 'executive presence');
}
