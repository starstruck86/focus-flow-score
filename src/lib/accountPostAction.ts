/**
 * Account Post-Action Decisioning + Opportunity Escalation
 *
 * After an account is worked, determines the next right move.
 * Also provides threshold-based opportunity escalation suggestions.
 *
 * Feature-flagged via ENABLE_ACCOUNT_CENTRIC_EXECUTION.
 */

import type { AccountExecutionEntry, OutcomeType, AccountReadiness } from '@/lib/accountExecutionState';
import type { AccountWorkingSummary, OpportunityContext } from '@/lib/accountWorkingSummary';

// ── Post-Action Decision Model ─────────────────────────────

export type PostActionDecision =
  | 'retry_later_today'
  | 'follow_up_next_loop'
  | 'carry_forward_tomorrow'
  | 'create_opportunity'
  | 'update_opportunity'
  | 'mark_not_actionable'
  | 'leave_ready'
  | 'schedule_follow_up';

export interface PostActionRecommendation {
  decision: PostActionDecision;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  requiresUserAction: boolean;
  suggestedFields?: Record<string, string>;
}

/**
 * Given an account's current execution state and latest outcome,
 * recommend the next action with minimal admin friction.
 */
export function getPostActionRecommendation(
  entry: AccountExecutionEntry,
  summary?: AccountWorkingSummary | null,
): PostActionRecommendation {
  const outcome = entry.lastOutcomeType;
  const attempts = entry.callAttemptCount;
  const hasOpp = summary?.hasOpportunity || false;

  // Meeting booked → suggest opportunity creation if none exists
  if (outcome === 'meeting_booked') {
    if (!hasOpp) {
      return {
        decision: 'create_opportunity',
        reason: 'Meeting booked — time to create an opportunity.',
        confidence: 'high',
        requiresUserAction: true,
      };
    }
    return {
      decision: 'update_opportunity',
      reason: 'Meeting booked — update opportunity stage.',
      confidence: 'high',
      requiresUserAction: true,
      suggestedFields: { stage: 'Discovery' },
    };
  }

  // Connected but no meeting → follow up
  if (outcome === 'connected') {
    return {
      decision: 'schedule_follow_up',
      reason: 'Connected but no meeting — schedule follow-up.',
      confidence: 'high',
      requiresUserAction: false,
    };
  }

  // Bad fit → done
  if (outcome === 'bad_fit') {
    return {
      decision: 'mark_not_actionable',
      reason: 'Bad fit confirmed — remove from active work.',
      confidence: 'high',
      requiresUserAction: false,
    };
  }

  // Not now → carry forward
  if (outcome === 'not_now') {
    return {
      decision: 'carry_forward_tomorrow',
      reason: 'Prospect said "not now" — carry forward for later.',
      confidence: 'medium',
      requiresUserAction: false,
    };
  }

  // Follow-up needed
  if (outcome === 'follow_up_needed') {
    return {
      decision: 'follow_up_next_loop',
      reason: 'Follow-up needed — queue for next loop.',
      confidence: 'high',
      requiresUserAction: false,
    };
  }

  // No answer / voicemail with multiple attempts
  if ((outcome === 'no_answer' || outcome === 'voicemail') && attempts >= 3) {
    return {
      decision: 'carry_forward_tomorrow',
      reason: `${attempts} attempts with no contact — carry forward.`,
      confidence: 'medium',
      requiresUserAction: false,
    };
  }

  // No answer / voicemail, few attempts
  if (outcome === 'no_answer' || outcome === 'voicemail') {
    return {
      decision: 'retry_later_today',
      reason: `Attempt #${attempts} — retry later this session.`,
      confidence: 'medium',
      requiresUserAction: false,
    };
  }

  // Default
  return {
    decision: 'leave_ready',
    reason: 'No clear signal yet — leave as ready.',
    confidence: 'low',
    requiresUserAction: false,
  };
}

// ── Opportunity Escalation ─────────────────────────────────

export type EscalationType =
  | 'suggest_create_opportunity'
  | 'suggest_update_stage'
  | 'suggest_update_status'
  | 'no_escalation'
  | 'defer';

export interface OpportunityEscalation {
  type: EscalationType;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  suggestedAction: string;
  autoWrite: boolean; // true = safe to auto-execute, false = suggestion only
}

/**
 * Determine if account engagement warrants opportunity creation/update.
 * Conservative: suggestions only unless confidence is very high.
 */
export function evaluateOpportunityEscalation(
  summary: AccountWorkingSummary,
): OpportunityEscalation {
  const { connectCount, callAttemptCount, latestOutcome, hasOpportunity, primaryOpportunity } = summary;

  // Meeting booked + no opportunity = strong signal
  if (latestOutcome === 'meeting_booked' && !hasOpportunity) {
    return {
      type: 'suggest_create_opportunity',
      reason: 'Meeting booked with no existing opportunity.',
      confidence: 'high',
      suggestedAction: `Create opportunity for ${summary.accountName}`,
      autoWrite: false, // still a suggestion
    };
  }

  // Multiple connects + no opportunity
  if (connectCount >= 2 && !hasOpportunity) {
    return {
      type: 'suggest_create_opportunity',
      reason: `${connectCount} connects — consider creating an opportunity.`,
      confidence: 'medium',
      suggestedAction: `Evaluate opportunity for ${summary.accountName}`,
      autoWrite: false,
    };
  }

  // Meeting booked + has opportunity → suggest stage update
  if (latestOutcome === 'meeting_booked' && hasOpportunity && primaryOpportunity) {
    const earlyStages = ['', 'Prospecting', 'Qualification'];
    if (earlyStages.includes(primaryOpportunity.stage || '')) {
      return {
        type: 'suggest_update_stage',
        reason: 'Meeting booked — opportunity may need stage advancement.',
        confidence: 'medium',
        suggestedAction: `Update ${primaryOpportunity.opportunityName} to Discovery`,
        autoWrite: false,
      };
    }
  }

  // Many attempts, no connects, has opportunity → risk flag
  if (callAttemptCount >= 5 && connectCount === 0 && hasOpportunity) {
    return {
      type: 'suggest_update_status',
      reason: `${callAttemptCount} attempts, 0 connects — opportunity at risk.`,
      confidence: 'low',
      suggestedAction: `Review opportunity health for ${summary.accountName}`,
      autoWrite: false,
    };
  }

  // Bad fit
  if (latestOutcome === 'bad_fit' && !hasOpportunity) {
    return {
      type: 'defer',
      reason: 'Bad fit confirmed — no opportunity needed.',
      confidence: 'high',
      suggestedAction: 'None',
      autoWrite: false,
    };
  }

  return {
    type: 'no_escalation',
    reason: 'No escalation signals yet.',
    confidence: 'low',
    suggestedAction: 'Continue working.',
    autoWrite: false,
  };
}

// ── Surface Responsibility Map ─────────────────────────────
// Defines what each surface should show to minimize duplication

export const SURFACE_RESPONSIBILITY = {
  cockpit: {
    primary: 'Which account to work now and why',
    shows: ['next recommended action', 'readiness summary', 'carry-forward count'],
    suppresses: ['full timeline', 'opportunity detail', 'coaching data'],
  },
  dailyPlan: {
    primary: 'Where this account sits in today\'s loops',
    shows: ['loop position', 'prep/action status', 'block timing'],
    suppresses: ['full account history', 'opportunity stage detail'],
  },
  dave: {
    primary: 'Conversational read/write for the account',
    shows: ['any field on demand', 'outcome logging', 'post-action recommendation'],
    suppresses: ['nothing — Dave has full access'],
  },
  prepHub: {
    primary: 'Prep depth + capability relevance for the account',
    shows: ['prep status', 'account context', 'recommended playbook'],
    suppresses: ['action outcomes', 'loop position'],
  },
  coach: {
    primary: 'Skill development informed by patterns',
    shows: ['outcome patterns', 'roleplay relevance', 'improvement areas'],
    suppresses: ['individual account execution state', 'loop timing'],
  },
} as const;

// ── Measurement Hooks ──────────────────────────────────────

export interface MeasurementEvent {
  eventType: string;
  accountId: string;
  timestamp: string;
  metadata: Record<string, any>;
}

const MEASUREMENT_KEY = 'account-measurement-events';
const MAX_MEASUREMENT_EVENTS = 500;

export function recordMeasurementEvent(event: MeasurementEvent): void {
  try {
    const existing: MeasurementEvent[] = JSON.parse(localStorage.getItem(MEASUREMENT_KEY) || '[]');
    existing.push(event);
    localStorage.setItem(MEASUREMENT_KEY, JSON.stringify(existing.slice(-MAX_MEASUREMENT_EVENTS)));
  } catch {}
}

export function loadMeasurementEvents(): MeasurementEvent[] {
  try {
    return JSON.parse(localStorage.getItem(MEASUREMENT_KEY) || '[]');
  } catch { return []; }
}

/** Record prep→attempt conversion for future analysis */
export function recordPrepToAttempt(accountId: string, prepTime: string, attemptTime: string): void {
  recordMeasurementEvent({
    eventType: 'prep_to_attempt',
    accountId,
    timestamp: attemptTime,
    metadata: { prepTime, attemptTime, gapMs: new Date(attemptTime).getTime() - new Date(prepTime).getTime() },
  });
}

/** Record attempt→connect conversion */
export function recordAttemptToConnect(accountId: string, attempts: number): void {
  recordMeasurementEvent({
    eventType: 'attempt_to_connect',
    accountId,
    timestamp: new Date().toISOString(),
    metadata: { attemptsBeforeConnect: attempts },
  });
}

/** Record whether roleplay preceded first action */
export function recordRoleplayBeforeAction(accountId: string, hadRoleplay: boolean, roleplayType: string): void {
  recordMeasurementEvent({
    eventType: 'roleplay_before_action',
    accountId,
    timestamp: new Date().toISOString(),
    metadata: { hadRoleplay, roleplayType },
  });
}

/** Record carry-forward → next-loop productivity */
export function recordCarryForwardOutcome(accountId: string, originalDate: string, outcome: string): void {
  recordMeasurementEvent({
    eventType: 'carry_forward_outcome',
    accountId,
    timestamp: new Date().toISOString(),
    metadata: { originalDate, outcome },
  });
}
