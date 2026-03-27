/**
 * Workflow Orchestrator
 *
 * Unifies Prep Hub, Coach, and Dave by providing a single API to get
 * execution context, coaching nudges, and post-action prompts.
 *
 * Enforces single-recommendation-per-moment rule.
 *
 * Feature-flagged via ENABLE_SYSTEM_OS.
 */

import { createLogger } from './logger';
import { isEnabled } from './systemGovernance';
import { shouldSuppressIntervention, recordIntervention } from './interventionGuard';
import { computePersonalProfile, type PersonalProfile } from './systemIntelligence';

const log = createLogger('WorkflowOrchestrator');

// ── Types ──────────────────────────────────────────────────

export interface ExecutionContext {
  topDeals: ExecutionDeal[];
  nextBestAction: NextBestAction | null;
  recommendedPlaybook: PlaybookRecommendation | null;
  coachNudge: CoachNudge | null;
  riskSignals: RiskSignal[];
  timestamp: string;
}

export interface ExecutionDeal {
  id: string;
  name: string;
  accountName: string;
  urgency: number;      // 0–100
  confidence: number;    // 0–100
  nextAction: string;
  stage: string;
  arrK: number;
}

export interface NextBestAction {
  dealId: string;
  dealName: string;
  action: string;
  urgency: number;
  confidence: number;
  reasoning: string;
  consequenceOfDelay: string;
}

export interface PlaybookRecommendation {
  playbookId: string;
  playbookTitle: string;
  explanation: string;
  riskIfIgnored: string;
  confidence: number;
  dealId?: string;
}

export interface CoachNudge {
  message: string;
  skillFocus: string;
  practiceCTA: string | null;
  source: string;
}

export interface RiskSignal {
  type: 'stalled_deal' | 'ignored_playbook' | 'fatigue' | 'repeated_mistake';
  dealId?: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface PostActionPrompt {
  type: 'reflection' | 'log_outcome' | 'next_step';
  message: string;
  actionLabel: string;
}

// ── Execution Context ──────────────────────────────────────

export function getExecutionContext(
  deals: ExecutionDeal[],
  playbooks: { id: string; title: string; problemType: string; confidence: number }[],
  riskSignals: RiskSignal[],
): ExecutionContext {
  if (!isEnabled('RECOMMENDATION_ENABLED')) {
    return { topDeals: [], nextBestAction: null, recommendedPlaybook: null, coachNudge: null, riskSignals: [], timestamp: new Date().toISOString() };
  }

  // Sort deals by urgency
  const sorted = [...deals].sort((a, b) => b.urgency - a.urgency);
  const topDeals = sorted.slice(0, 3);

  // Next best action = top deal
  let nextBestAction: NextBestAction | null = null;
  if (topDeals.length > 0) {
    const top = topDeals[0];
    nextBestAction = {
      dealId: top.id,
      dealName: top.name,
      action: top.nextAction,
      urgency: top.urgency,
      confidence: top.confidence,
      reasoning: `Highest urgency deal (${top.urgency}) at ${top.stage} stage with $${top.arrK}K ARR`,
      consequenceOfDelay: top.urgency > 80 ? 'High risk of deal stalling or competitor advance' : 'Moderate — deal may lose momentum',
    };
  }

  // Recommended playbook = top confidence playbook
  let recommendedPlaybook: PlaybookRecommendation | null = null;
  if (playbooks.length > 0 && isEnabled('COACHING_ENABLED')) {
    const topPb = [...playbooks].sort((a, b) => b.confidence - a.confidence)[0];
    recommendedPlaybook = {
      playbookId: topPb.id,
      playbookTitle: topPb.title,
      explanation: `Best match for current deal context (${topPb.problemType})`,
      riskIfIgnored: 'May miss opportunity to advance deal using proven approach',
      confidence: topPb.confidence,
      dealId: nextBestAction?.dealId,
    };
  }

  // Coach nudge
  const coachNudge = getCoachingNudge();

  return {
    topDeals,
    nextBestAction,
    recommendedPlaybook,
    coachNudge,
    riskSignals: riskSignals.slice(0, 5),
    timestamp: new Date().toISOString(),
  };
}

// ── Coaching Nudge ─────────────────────────────────────────

export function getCoachingNudge(): CoachNudge | null {
  if (!isEnabled('COACHING_ENABLED')) return null;
  if (shouldSuppressIntervention('coach_nudge')) return null;

  const profile = computePersonalProfile();

  // Find lowest performing area
  let nudge: CoachNudge | null = null;

  if (profile.conversionSignals.length > 0) {
    const weakest = [...profile.conversionSignals].sort((a, b) => a.strength - b.strength)[0];
    if (weakest && weakest.strength < 0.4) {
      nudge = {
        message: `Your conversion at the "${weakest.signal}" stage is ${Math.round(weakest.strength * 100)}%. Consider focused practice.`,
        skillFocus: weakest.signal,
        practiceCTA: 'Practice this scenario',
        source: 'personal_performance',
      };
    }
  }

  if (!nudge && profile.topPlaybooks.length > 0) {
    nudge = {
      message: 'Keep leveraging your strongest playbooks — consistency drives results.',
      skillFocus: 'execution_consistency',
      practiceCTA: null,
      source: 'personal_performance',
    };
  }

  if (nudge) {
    recordIntervention('coach_nudge');
  }

  return nudge;
}

// ── Post-Action Prompt ─────────────────────────────────────

export function getPostActionPrompt(actionType: 'call' | 'email' | 'meeting'): PostActionPrompt | null {
  if (shouldSuppressIntervention('post_action')) return null;

  const prompts: Record<string, PostActionPrompt> = {
    call: {
      type: 'reflection',
      message: 'How did that call go? Log the outcome to track patterns.',
      actionLabel: 'Log Outcome',
    },
    email: {
      type: 'next_step',
      message: 'Follow-up sent. Set a reminder for the next touch?',
      actionLabel: 'Set Reminder',
    },
    meeting: {
      type: 'log_outcome',
      message: 'Meeting complete. Capture key decisions and next steps.',
      actionLabel: 'Log Meeting Notes',
    },
  };

  const prompt = prompts[actionType] ?? null;
  if (prompt) recordIntervention('post_action');
  return prompt;
}
