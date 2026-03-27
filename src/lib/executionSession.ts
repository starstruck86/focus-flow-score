/**
 * Execution Session Layer — Orchestrates active account focus,
 * next-best-account routing, post-action flow, mode suppression,
 * end-of-block cleanup, and lightweight scorekeeping.
 *
 * This is the unifying orchestration layer between account truth,
 * loop truth, and all operating surfaces.
 *
 * Feature-flagged via ENABLE_EXECUTION_SESSION_LAYER.
 */

import { create } from 'zustand';
import { todayInAppTz } from '@/lib/timeFormat';
import {
  getAccountState,
  loadAccountStates,
  recordAccountOutcome,
  type AccountExecutionEntry,
  type OutcomeType,
  type AccountReadiness,
} from '@/lib/accountExecutionState';
import { appendTimelineEvent, type AccountEventType } from '@/lib/accountTimeline';
import {
  getPostActionRecommendation,
  evaluateOpportunityEscalation,
  type PostActionRecommendation,
  type OpportunityEscalation,
} from '@/lib/accountPostAction';
import { isExecutionSessionLayerEnabled, isAccountExecutionModelEnabled } from '@/lib/featureFlags';

// ── Execution Mode ─────────────────────────────────────────

export type ExecutionMode = 'prep' | 'action' | 'follow_up' | 'roleplay' | 'idle';

// ── Active Account Session ─────────────────────────────────

export interface ActiveAccountSession {
  accountId: string;
  accountName: string;
  startedAt: string;
  mode: ExecutionMode;
  loopId: string | null;
  latestOutcome: OutcomeType;
  postActionRecommendation: PostActionRecommendation | null;
  opportunityEscalation: OpportunityEscalation | null;
  isComplete: boolean;
  daveAttached: boolean;
}

// ── Session Scorecard ──────────────────────────────────────

export interface SessionScorecard {
  accountsWorked: number;
  connects: number;
  meetingsBooked: number;
  readyRemaining: number;
  carryForwardCreated: number;
  attempts: number;
}

// ── Override Log ───────────────────────────────────────────

export interface OverrideEntry {
  timestamp: string;
  action: string;
  systemSuggestion: string;
  userChoice: string;
  reason: string | null;
}

// ── Mode Suppression Rules ─────────────────────────────────

export const MODE_SUPPRESSION: Record<ExecutionMode, { allow: string[]; suppress: string[] }> = {
  prep: {
    allow: ['prep_status', 'capability_prompts', 'research_checklist', 'account_context'],
    suppress: ['call_readiness_nudges', 'outcome_logging', 'action_block_signals', 'scorecard_metrics'],
  },
  action: {
    allow: ['outcome_logging', 'quick_actions', 'next_account', 'call_readiness', 'scorecard_metrics'],
    suppress: ['prep_guidance', 'capability_prompts', 'research_checklist', 'coaching_nudges'],
  },
  follow_up: {
    allow: ['follow_up_details', 'opportunity_context', 'scheduling', 'account_history'],
    suppress: ['call_readiness_nudges', 'prep_guidance', 'coaching_nudges'],
  },
  roleplay: {
    allow: ['roleplay_scenario', 'coaching_feedback', 'skill_tracking'],
    suppress: ['account_nudges', 'execution_signals', 'outcome_logging', 'next_account'],
  },
  idle: {
    allow: ['everything'],
    suppress: [],
  },
};

/** Check if a surface/signal type is allowed in the current mode */
export function isAllowedInMode(mode: ExecutionMode, signalType: string): boolean {
  if (mode === 'idle') return true;
  const rules = MODE_SUPPRESSION[mode];
  if (rules.suppress.includes(signalType)) return false;
  return true;
}

// ── Next-Best-Account Logic ────────────────────────────────

export interface NextAccountCandidate {
  accountId: string;
  accountName: string;
  readiness: AccountReadiness;
  reason: string;
  score: number;
}

const READINESS_SCORE: Record<AccountReadiness, number> = {
  ready_to_call: 100,
  prep_needed: 30,
  retry_later: 60,
  follow_up_next_loop: 20,
  carry_forward_tomorrow: 50,
  not_actionable_today: 0,
};

export function getNextBestAccounts(date?: string): NextAccountCandidate[] {
  const today = date || todayInAppTz();
  const states = loadAccountStates(today);

  return states
    .filter(s => s.nextRecommendedAction !== 'not_actionable_today')
    .filter(s => s.actionStatus !== 'completed')
    .map(s => {
      let score = READINESS_SCORE[s.nextRecommendedAction] || 0;
      // Boost carry-forward accounts
      if (s.carryForward) score += 15;
      // Boost prepped but unworked
      if (s.prepStatus === 'prepped' && s.actionStatus === 'not_worked') score += 25;
      // Slight boost for retries (already attempted)
      if (s.actionStatus === 'attempted' && s.nextRecommendedAction === 'retry_later') score += 10;

      return {
        accountId: s.accountId,
        accountName: s.accountName,
        readiness: s.nextRecommendedAction,
        reason: buildNextAccountReason(s),
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildNextAccountReason(s: AccountExecutionEntry): string {
  if (s.prepStatus === 'prepped' && s.actionStatus === 'not_worked') return 'Prepped and ready to call';
  if (s.carryForward) return `Carried forward: ${s.carryForwardReason || 'unfinished'}`;
  if (s.nextRecommendedAction === 'retry_later') return `Retry — ${s.callAttemptCount} attempts so far`;
  if (s.nextRecommendedAction === 'ready_to_call') return 'Ready to call';
  if (s.nextRecommendedAction === 'prep_needed') return 'Needs prep first';
  return s.nextRecommendedAction.replace(/_/g, ' ');
}

// ── Account→Opportunity Transition Model ───────────────────

export type AccountEngagementStage =
  | 'account_only'
  | 'engaged'
  | 'opportunity_candidate'
  | 'opportunity_created'
  | 'opportunity_advancing';

export function deriveEngagementStage(
  entry: AccountExecutionEntry | null,
  hasOpportunity: boolean,
  oppStage: string | null,
): AccountEngagementStage {
  if (hasOpportunity) {
    const earlyStages = ['', 'Prospecting', 'Qualification', null];
    return earlyStages.includes(oppStage) ? 'opportunity_created' : 'opportunity_advancing';
  }
  if (!entry) return 'account_only';
  if (entry.lastOutcomeType === 'meeting_booked') return 'opportunity_candidate';
  if (entry.connectCount >= 2) return 'opportunity_candidate';
  if (entry.connectCount >= 1 || entry.callAttemptCount >= 2) return 'engaged';
  return 'account_only';
}

// ── End-of-Block Cleanup ───────────────────────────────────

export interface BlockCleanupResult {
  workedCount: number;
  readyRemaining: number;
  carryForwardCount: number;
  needsOpportunityAction: number;
  prioritizedForNext: string[]; // account IDs
}

export function runEndOfBlockCleanup(date?: string): BlockCleanupResult {
  const today = date || todayInAppTz();
  const states = loadAccountStates(today);

  const worked = states.filter(s => s.actionStatus !== 'not_worked' && s.actionStatus !== 'deferred');
  const ready = states.filter(s => s.nextRecommendedAction === 'ready_to_call' || s.nextRecommendedAction === 'retry_later');
  const carryFwd = states.filter(s => s.carryForward);
  const needsOpp = states.filter(s =>
    s.lastOutcomeType === 'meeting_booked' ||
    (s.connectCount >= 2 && s.lastOutcomeType === 'connected')
  );

  // Prioritize: carry-forward first, then prepped-unworked
  const prioritized = [
    ...carryFwd.map(s => s.accountId),
    ...states
      .filter(s => s.prepStatus === 'prepped' && s.actionStatus === 'not_worked' && !s.carryForward)
      .map(s => s.accountId),
  ];

  return {
    workedCount: worked.length,
    readyRemaining: ready.length,
    carryForwardCount: carryFwd.length,
    needsOpportunityAction: needsOpp.length,
    prioritizedForNext: [...new Set(prioritized)],
  };
}

// ── Build Scorecard ────────────────────────────────────────

export function buildScorecard(date?: string): SessionScorecard {
  const today = date || todayInAppTz();
  const states = loadAccountStates(today);

  return {
    accountsWorked: states.filter(s => s.actionStatus !== 'not_worked').length,
    connects: states.reduce((sum, s) => sum + s.connectCount, 0),
    meetingsBooked: states.filter(s => s.lastOutcomeType === 'meeting_booked').length,
    readyRemaining: states.filter(s =>
      s.nextRecommendedAction === 'ready_to_call' ||
      s.nextRecommendedAction === 'retry_later'
    ).length,
    carryForwardCreated: states.filter(s => s.carryForward).length,
    attempts: states.reduce((sum, s) => sum + s.callAttemptCount, 0),
  };
}

// ── Zustand Session Store ──────────────────────────────────

interface ExecutionSessionStore {
  // Active session
  activeSession: ActiveAccountSession | null;
  mode: ExecutionMode;
  scorecard: SessionScorecard;
  overrides: OverrideEntry[];

  // Actions
  activateAccount: (accountId: string, accountName: string, mode: ExecutionMode, loopId: string | null) => void;
  logOutcome: (outcomeType: OutcomeType, notes: string | null, blockId: string | null) => void;
  completeAccount: () => void;
  advanceToNext: () => void;
  setMode: (mode: ExecutionMode) => void;
  recordOverride: (systemSuggestion: string, userChoice: string, reason: string | null) => void;
  refreshScorecard: () => void;
  clearSession: () => void;
}

export const useExecutionSession = create<ExecutionSessionStore>((set, get) => ({
  activeSession: null,
  mode: 'idle' as ExecutionMode,
  scorecard: { accountsWorked: 0, connects: 0, meetingsBooked: 0, readyRemaining: 0, carryForwardCreated: 0, attempts: 0 },
  overrides: [],

  activateAccount: (accountId, accountName, mode, loopId) => {
    set({
      activeSession: {
        accountId,
        accountName,
        startedAt: new Date().toISOString(),
        mode,
        loopId,
        latestOutcome: null,
        postActionRecommendation: null,
        opportunityEscalation: null,
        isComplete: false,
        daveAttached: false,
      },
      mode,
    });
  },

  logOutcome: (outcomeType, notes, blockId) => {
    const { activeSession } = get();
    if (!activeSession) return;

    const today = todayInAppTz();

    // Write to account execution truth
    recordAccountOutcome(
      today,
      activeSession.accountId,
      activeSession.accountName,
      activeSession.loopId,
      blockId,
      outcomeType,
      notes,
    );

    // Write to timeline
    const eventMap: Record<string, AccountEventType> = {
      no_answer: 'no_answer',
      voicemail: 'voicemail',
      connected: 'connected',
      meeting_booked: 'meeting_booked',
      follow_up_needed: 'follow_up_needed',
      not_now: 'not_now',
      bad_fit: 'bad_fit',
    };
    if (outcomeType && eventMap[outcomeType]) {
      appendTimelineEvent(activeSession.accountId, activeSession.accountName, eventMap[outcomeType], {
        date: today,
        loopId: activeSession.loopId,
        notes,
      });
    }

    // Compute post-action recommendation
    const execState = getAccountState(today, activeSession.accountId);
    let postAction: PostActionRecommendation | null = null;
    let oppEscalation: OpportunityEscalation | null = null;

    if (execState) {
      postAction = getPostActionRecommendation(execState);
    }

    set(state => ({
      activeSession: state.activeSession ? {
        ...state.activeSession,
        latestOutcome: outcomeType,
        postActionRecommendation: postAction,
        opportunityEscalation: oppEscalation,
      } : null,
    }));

    // Refresh scorecard
    get().refreshScorecard();
  },

  completeAccount: () => {
    set(state => ({
      activeSession: state.activeSession ? { ...state.activeSession, isComplete: true } : null,
    }));
  },

  advanceToNext: () => {
    const candidates = getNextBestAccounts();
    const { activeSession } = get();
    const currentId = activeSession?.accountId;

    // Pick first candidate that isn't the current account
    const next = candidates.find(c => c.accountId !== currentId) || candidates[0];

    if (next) {
      get().activateAccount(next.accountId, next.accountName, 'action', activeSession?.loopId || null);
    } else {
      set({ activeSession: null, mode: 'idle' });
    }
  },

  setMode: (mode) => {
    set(state => ({
      mode,
      activeSession: state.activeSession ? { ...state.activeSession, mode } : null,
    }));
  },

  recordOverride: (systemSuggestion, userChoice, reason) => {
    set(state => ({
      overrides: [
        ...state.overrides.slice(-49),
        {
          timestamp: new Date().toISOString(),
          action: 'session_override',
          systemSuggestion,
          userChoice,
          reason,
        },
      ],
    }));
  },

  refreshScorecard: () => {
    set({ scorecard: buildScorecard() });
  },

  clearSession: () => {
    set({ activeSession: null, mode: 'idle' });
  },
}));

// ── Trust / Explainability ─────────────────────────────────

export interface TrustExplanation {
  whyThisAccount: string;
  whyThisAction: string;
  sourceOfTruth: 'account_execution' | 'heuristic' | 'fallback';
  overrideable: boolean;
}

export function buildTrustExplanation(
  candidate: NextAccountCandidate,
  entry: AccountExecutionEntry | null,
): TrustExplanation {
  return {
    whyThisAccount: candidate.reason,
    whyThisAction: entry
      ? `Based on ${entry.callAttemptCount} attempt(s), ${entry.connectCount} connect(s), last outcome: ${entry.lastOutcomeType || 'none'}`
      : 'No execution data yet — using readiness heuristic',
    sourceOfTruth: entry ? 'account_execution' : 'heuristic',
    overrideable: true,
  };
}

// ── Shared System Contract ─────────────────────────────────

/**
 * Precedence & ownership:
 *
 * 1. AccountExecutionState  — ground truth for prep/action/outcome per account/day
 * 2. ActiveAccountSession   — ephemeral focus state for the current working account
 * 3. AccountWorkingSummary   — read-only composite built from #1 + DB
 * 4. ExecutionSession store  — Zustand store coordinating #2 + scorecard + mode
 * 5. Loop truth             — structural scheduling, derived from account truth
 * 6. Block truth            — backward-compat heuristic, lowest precedence
 *
 * Reconciliation:
 * - Session reads from AccountExecutionState, never overwrites it
 * - AccountWorkingSummary is rebuilt on demand, never cached stale
 * - Scorecard recalculates from AccountExecutionState on each refresh
 * - Overrides are logged but do not mutate account truth — they guide next recommendation
 */
export const SYSTEM_CONTRACT = {
  truthLayers: [
    { layer: 'AccountExecutionState', owner: 'accountExecutionState.ts', mutable: true, precedence: 1 },
    { layer: 'ActiveAccountSession', owner: 'executionSession.ts (Zustand)', mutable: true, precedence: 2 },
    { layer: 'AccountWorkingSummary', owner: 'accountWorkingSummary.ts', mutable: false, precedence: 3 },
    { layer: 'LoopTruth', owner: 'loopRuntime.ts', mutable: true, precedence: 4 },
    { layer: 'BlockHeuristic', owner: 'loopReadiness.ts', mutable: false, precedence: 5 },
  ],
  rules: [
    'ActiveAccountSession reads from AccountExecutionState, never overwrites',
    'AccountWorkingSummary is always rebuilt, never cached stale',
    'Scorecard recalculates on each refresh from AccountExecutionState',
    'Overrides are logged but do not mutate account truth',
    'Opportunity context is attached, never the primary key',
    'Timeline events are append-only, never rewritten',
  ],
} as const;
