/**
 * Dave Surface Transitions — Intelligent handoffs between Learn / Dojo / Skill Builder.
 *
 * Produces spoken transition prompts that feel deliberate, not spammy.
 * Only triggers when useful based on session context.
 */

import type { VoiceSurface } from '@/lib/daveVoiceRuntime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveSurfaceTransitions');

// ── Types ──────────────────────────────────────────────────────────

export interface TransitionOffer {
  from: VoiceSurface;
  to: VoiceSurface;
  spokenPrompt: string;
  reason: string;
  launchState: Record<string, unknown>;
  /** Whether this is a strong recommendation vs optional */
  strength: 'strong' | 'gentle';
}

export interface SessionOutcome {
  surface: VoiceSurface;
  skill: string;
  score?: number | null;
  topMistake?: string | null;
  completedBlocks?: number;
  totalBlocks?: number;
  conceptTaught?: string;
}

// ── Transition Logic ──────────────────────────────────────────────

export function evaluateTransition(outcome: SessionOutcome): TransitionOffer | null {
  switch (outcome.surface) {
    case 'learn':
      return evaluateLearnTransition(outcome);
    case 'dojo':
      return evaluateDojoTransition(outcome);
    case 'skill_builder':
      return evaluateSkillBuilderTransition(outcome);
    default:
      return null;
  }
}

// ── Learn → Dojo / Skill Builder ──────────────────────────────────

function evaluateLearnTransition(outcome: SessionOutcome): TransitionOffer | null {
  // After teaching a concept, offer a practice rep
  return {
    from: 'learn',
    to: 'dojo',
    spokenPrompt: `Want to practice ${formatSkill(outcome.skill)} now? One quick rep.`,
    reason: 'Apply what was just taught',
    launchState: { skill: outcome.skill, mode: 'quick' },
    strength: 'gentle',
  };
}

// ── Dojo → Learn ──────────────────────────────────────────────────

function evaluateDojoTransition(outcome: SessionOutcome): TransitionOffer | null {
  // Only offer if score was low — means they need concept work
  if (outcome.score == null || outcome.score >= 60) return null;

  const skill = outcome.skill;
  const mistake = outcome.topMistake;

  if (mistake) {
    return {
      from: 'dojo',
      to: 'learn',
      spokenPrompt: `You're struggling with ${mistake.replace(/_/g, ' ')}. Want me to coach you on that for a few minutes?`,
      reason: `Low score (${outcome.score}) with specific weakness`,
      launchState: { skill, focusArea: mistake },
      strength: 'strong',
    };
  }

  return {
    from: 'dojo',
    to: 'learn',
    spokenPrompt: `That was tough. Want me to break down ${formatSkill(skill)} concepts before your next rep?`,
    reason: `Low score (${outcome.score})`,
    launchState: { skill },
    strength: 'gentle',
  };
}

// ── Skill Builder → Dojo ─────────────────────────────────────────

function evaluateSkillBuilderTransition(outcome: SessionOutcome): TransitionOffer | null {
  // After completing blocks, offer a live rep
  if (!outcome.completedBlocks || outcome.completedBlocks < 2) return null;

  return {
    from: 'skill_builder',
    to: 'dojo',
    spokenPrompt: `Nice work. Want one live rep to apply what you just learned?`,
    reason: 'Apply Skill Builder concepts in practice',
    launchState: { skill: outcome.skill, mode: 'quick' },
    strength: 'gentle',
  };
}

// ── Spoken Resume Intros ──────────────────────────────────────────

export interface ResumeContext {
  surface: VoiceSurface;
  position: number;
  sessionId: string;
  surfaceState: Record<string, unknown>;
}

export function buildResumeIntro(ctx: ResumeContext): string {
  const step = ctx.position + 1;

  switch (ctx.surface) {
    case 'dojo': {
      const skill = ctx.surfaceState?.skill as string | undefined;
      return skill
        ? `You were on rep ${step} of ${formatSkill(skill)}. Picking up there.`
        : `You were on rep ${step}. Picking up there.`;
    }
    case 'learn': {
      const skill = ctx.surfaceState?.skill as string | undefined;
      return skill
        ? `You were in section ${step} of ${formatSkill(skill)} coaching. Continuing.`
        : `You were on section ${step}. Continuing.`;
    }
    case 'skill_builder': {
      const blockLabel = ctx.surfaceState?.blockLabel as string | undefined;
      return blockLabel
        ? `You were on block ${step}: ${blockLabel}. Let's keep going.`
        : `You were on block ${step} of your Skill Builder session. Let's keep going.`;
    }
    default:
      return `Picking up where you left off. Step ${step}.`;
  }
}

// ── Progress Awareness Snippets ───────────────────────────────────

export interface ProgressSnapshot {
  skill: string;
  tier?: number;
  averageScore?: number;
  trend?: 'improving' | 'declining' | 'stable';
  sessionsThisWeek?: number;
}

export function buildProgressSnippet(snapshot: ProgressSnapshot): string | null {
  const skill = formatSkill(snapshot.skill);

  // Only speak progress when it's motivating or orienting
  if (snapshot.tier && snapshot.averageScore && snapshot.averageScore >= 70) {
    return `You're close to Tier ${snapshot.tier + 1} in ${skill}.`;
  }

  if (snapshot.trend === 'improving' && snapshot.averageScore) {
    return `${skill} is improving. You're averaging ${snapshot.averageScore}%.`;
  }

  if (snapshot.trend === 'declining' && snapshot.averageScore) {
    return `${skill} has dipped to ${snapshot.averageScore}%. Worth some focused work.`;
  }

  // Don't speak progress if there's nothing meaningful to say
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatSkill(skill: string): string {
  return skill.replace(/_/g, ' ');
}
