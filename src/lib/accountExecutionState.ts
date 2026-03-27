/**
 * Account Execution State — Canonical account-level truth model
 *
 * Tracks per-account prep, action, outcome, carry-forward, and readiness
 * for each day/loop. This is the source of truth underneath loops.
 *
 * Feature-flagged via ENABLE_ACCOUNT_EXECUTION_MODEL.
 */

// ── Types ──────────────────────────────────────────────────

export type PrepStatus = 'not_prepped' | 'partial_prep' | 'prepped';
export type ActionStatus = 'not_worked' | 'attempted' | 'connected' | 'completed' | 'deferred';
export type OutcomeType = 'no_answer' | 'voicemail' | 'connected' | 'meeting_booked' | 'follow_up_needed' | 'bad_fit' | 'not_now' | null;
export type AccountReadiness = 'ready_to_call' | 'prep_needed' | 'retry_later' | 'follow_up_next_loop' | 'not_actionable_today' | 'carry_forward_tomorrow';

export interface AccountExecutionEntry {
  accountId: string;
  accountName: string;
  date: string;
  loopId: string | null;

  // Prep
  prepStatus: PrepStatus;
  prepCompletedAt: string | null;
  prepSourceBlockId: string | null;

  // Action
  actionStatus: ActionStatus;
  actionCompletedAt: string | null;
  actionSourceBlockId: string | null;

  // Attempts & outcomes
  callAttemptCount: number;
  connectCount: number;
  lastOutcomeType: OutcomeType;
  lastOutcomeNotes: string | null;
  outcomes: AccountOutcome[];

  // Carry-forward
  carryForward: boolean;
  carryForwardReason: string | null;

  // Readiness
  nextRecommendedAction: AccountReadiness;
  nextEligibleLoopId: string | null;

  updatedAt: string;
}

export interface AccountOutcome {
  outcomeType: OutcomeType;
  notes: string | null;
  timestamp: string;
  loopId: string | null;
  blockId: string | null;
}

// ── Persistence ────────────────────────────────────────────

const STORAGE_KEY = 'account-execution-state';

function storageKey(date: string): string {
  return `${STORAGE_KEY}-${date}`;
}

export function loadAccountStates(date: string): AccountExecutionEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(date));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(storageKey(date));
      return [];
    }
    // Corruption guard
    if (parsed.length > 0 && !parsed[0].accountId) {
      localStorage.removeItem(storageKey(date));
      return [];
    }
    return parsed;
  } catch {
    localStorage.removeItem(storageKey(date));
    return [];
  }
}

export function saveAccountStates(date: string, states: AccountExecutionEntry[]): void {
  // Deduplicate by accountId+loopId
  const seen = new Set<string>();
  const deduped = states.filter(s => {
    const key = `${s.accountId}::${s.loopId || 'none'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  localStorage.setItem(storageKey(date), JSON.stringify(deduped));
}

// ── Entry Creation ─────────────────────────────────────────

export function createEntry(
  accountId: string,
  accountName: string,
  date: string,
  loopId: string | null = null,
): AccountExecutionEntry {
  return {
    accountId,
    accountName,
    date,
    loopId,
    prepStatus: 'not_prepped',
    prepCompletedAt: null,
    prepSourceBlockId: null,
    actionStatus: 'not_worked',
    actionCompletedAt: null,
    actionSourceBlockId: null,
    callAttemptCount: 0,
    connectCount: 0,
    lastOutcomeType: null,
    lastOutcomeNotes: null,
    outcomes: [],
    carryForward: false,
    carryForwardReason: null,
    nextRecommendedAction: 'prep_needed',
    nextEligibleLoopId: null,
    updatedAt: new Date().toISOString(),
  };
}

// ── Read Helpers ───────────────────────────────────────────

export function getAccountState(
  date: string,
  accountId: string,
  loopId?: string | null,
): AccountExecutionEntry | null {
  const states = loadAccountStates(date);
  if (loopId) {
    return states.find(s => s.accountId === accountId && s.loopId === loopId) || null;
  }
  // Return most recent entry for this account
  const matches = states.filter(s => s.accountId === accountId);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

export function getPreppedAccounts(date: string): AccountExecutionEntry[] {
  return loadAccountStates(date).filter(s => s.prepStatus === 'prepped');
}

export function getUnworkedPreppedAccounts(date: string): AccountExecutionEntry[] {
  return loadAccountStates(date).filter(
    s => s.prepStatus === 'prepped' && s.actionStatus === 'not_worked',
  );
}

export function getWorkedAccounts(date: string): AccountExecutionEntry[] {
  return loadAccountStates(date).filter(s => s.actionStatus !== 'not_worked');
}

export function getCarryForwardCandidates(date: string): AccountExecutionEntry[] {
  return loadAccountStates(date).filter(s => s.carryForward);
}

export function getAccountsByReadiness(date: string, readiness: AccountReadiness): AccountExecutionEntry[] {
  return loadAccountStates(date).filter(s => s.nextRecommendedAction === readiness);
}

// ── Write Helpers ──────────────────────────────────────────

function upsertEntry(
  date: string,
  accountId: string,
  loopId: string | null,
  updater: (entry: AccountExecutionEntry) => AccountExecutionEntry,
  accountName?: string,
): AccountExecutionEntry {
  const states = loadAccountStates(date);
  const idx = states.findIndex(
    s => s.accountId === accountId && (s.loopId === loopId || (!s.loopId && !loopId)),
  );

  let entry: AccountExecutionEntry;
  if (idx >= 0) {
    entry = updater({ ...states[idx] });
    entry.updatedAt = new Date().toISOString();
    states[idx] = entry;
  } else {
    entry = updater(createEntry(accountId, accountName || accountId, date, loopId));
    entry.updatedAt = new Date().toISOString();
    states.push(entry);
  }

  saveAccountStates(date, states);
  return entry;
}

/** Mark account as prepped */
export function markAccountPrepped(
  date: string,
  accountId: string,
  accountName: string,
  loopId: string | null,
  blockId: string | null,
): AccountExecutionEntry {
  return upsertEntry(date, accountId, loopId, entry => ({
    ...entry,
    accountName,
    prepStatus: 'prepped',
    prepCompletedAt: new Date().toISOString(),
    prepSourceBlockId: blockId,
    nextRecommendedAction: 'ready_to_call',
  }), accountName);
}

/** Record an action attempt/outcome */
export function recordAccountOutcome(
  date: string,
  accountId: string,
  accountName: string,
  loopId: string | null,
  blockId: string | null,
  outcomeType: OutcomeType,
  notes: string | null = null,
): AccountExecutionEntry {
  return upsertEntry(date, accountId, loopId, entry => {
    const outcome: AccountOutcome = {
      outcomeType,
      notes,
      timestamp: new Date().toISOString(),
      loopId,
      blockId,
    };

    const newAttempts = entry.callAttemptCount + 1;
    const newConnects = entry.connectCount + (
      outcomeType === 'connected' || outcomeType === 'meeting_booked' ? 1 : 0
    );

    // Derive action status from outcome
    let actionStatus: ActionStatus = 'attempted';
    if (outcomeType === 'connected' || outcomeType === 'meeting_booked') {
      actionStatus = 'connected';
    } else if (outcomeType === 'bad_fit') {
      actionStatus = 'completed';
    } else if (outcomeType === 'follow_up_needed' || outcomeType === 'not_now') {
      actionStatus = 'deferred';
    }

    // Derive next recommended action
    let nextAction: AccountReadiness = 'retry_later';
    if (outcomeType === 'meeting_booked' || outcomeType === 'bad_fit') {
      nextAction = 'not_actionable_today';
    } else if (outcomeType === 'connected') {
      nextAction = 'not_actionable_today';
    } else if (outcomeType === 'follow_up_needed') {
      nextAction = 'follow_up_next_loop';
    } else if (outcomeType === 'not_now') {
      nextAction = 'carry_forward_tomorrow';
    } else if (outcomeType === 'no_answer' || outcomeType === 'voicemail') {
      nextAction = newAttempts >= 3 ? 'carry_forward_tomorrow' : 'retry_later';
    }

    // Set carry-forward
    const shouldCarry = nextAction === 'carry_forward_tomorrow' || nextAction === 'follow_up_next_loop';
    const carryReason = shouldCarry
      ? (outcomeType === 'no_answer' ? 'no_answer' : outcomeType === 'voicemail' ? 'voicemail' : outcomeType === 'not_now' ? 'not_now' : 'follow_up')
      : null;

    return {
      ...entry,
      accountName,
      actionStatus,
      actionCompletedAt: new Date().toISOString(),
      actionSourceBlockId: blockId,
      callAttemptCount: newAttempts,
      connectCount: newConnects,
      lastOutcomeType: outcomeType,
      lastOutcomeNotes: notes,
      outcomes: [...entry.outcomes, outcome],
      carryForward: shouldCarry,
      carryForwardReason: carryReason,
      nextRecommendedAction: nextAction,
    };
  }, accountName);
}

/** Mark account action as complete (generic) */
export function markAccountWorkedGeneric(
  date: string,
  accountId: string,
  accountName: string,
  loopId: string | null,
  blockId: string | null,
): AccountExecutionEntry {
  return upsertEntry(date, accountId, loopId, entry => {
    if (entry.actionStatus !== 'not_worked') return entry; // already has richer state
    return {
      ...entry,
      accountName,
      actionStatus: 'attempted',
      actionCompletedAt: new Date().toISOString(),
      actionSourceBlockId: blockId,
      callAttemptCount: entry.callAttemptCount + 1,
      nextRecommendedAction: 'retry_later',
    };
  }, accountName);
}

// ── Carry-Forward Engine ───────────────────────────────────

/**
 * Build carry-forward list from account truth.
 * Accounts that are prepped but not fully worked, or deferred/retry.
 */
export function buildCarryForward(date: string): AccountExecutionEntry[] {
  const states = loadAccountStates(date);
  return states.filter(s => {
    if (s.carryForward) return true;
    // Also carry prepped-but-unworked
    if (s.prepStatus === 'prepped' && s.actionStatus === 'not_worked') return true;
    return false;
  }).map(s => ({
    ...s,
    carryForward: true,
    carryForwardReason: s.carryForwardReason || (s.actionStatus === 'not_worked' ? 'no_time' : 'partial_action'),
  }));
}

// ── Readiness Summaries ────────────────────────────────────

export interface AccountExecutionSummary {
  totalAccounts: number;
  preppedCount: number;
  workedCount: number;
  unworkedPreppedCount: number;
  carryForwardCount: number;
  readyToCallCount: number;
  prepNeededCount: number;
  retryLaterCount: number;
  outcomeCounts: Record<string, number>;
  sourceOfTruth: 'account_state' | 'heuristic';
}

export function buildExecutionSummary(date: string): AccountExecutionSummary {
  const states = loadAccountStates(date);
  if (states.length === 0) {
    return {
      totalAccounts: 0,
      preppedCount: 0,
      workedCount: 0,
      unworkedPreppedCount: 0,
      carryForwardCount: 0,
      readyToCallCount: 0,
      prepNeededCount: 0,
      retryLaterCount: 0,
      outcomeCounts: {},
      sourceOfTruth: 'heuristic',
    };
  }

  const outcomeCounts: Record<string, number> = {};
  for (const s of states) {
    if (s.lastOutcomeType) {
      outcomeCounts[s.lastOutcomeType] = (outcomeCounts[s.lastOutcomeType] || 0) + 1;
    }
  }

  return {
    totalAccounts: states.length,
    preppedCount: states.filter(s => s.prepStatus === 'prepped').length,
    workedCount: states.filter(s => s.actionStatus !== 'not_worked').length,
    unworkedPreppedCount: states.filter(s => s.prepStatus === 'prepped' && s.actionStatus === 'not_worked').length,
    carryForwardCount: buildCarryForward(date).length,
    readyToCallCount: states.filter(s => s.nextRecommendedAction === 'ready_to_call').length,
    prepNeededCount: states.filter(s => s.nextRecommendedAction === 'prep_needed').length,
    retryLaterCount: states.filter(s => s.nextRecommendedAction === 'retry_later').length,
    outcomeCounts,
    sourceOfTruth: 'account_state',
  };
}

// ── Loop Integration ───────────────────────────────────────

/**
 * Derive loop readiness from account states for a specific loop.
 */
export function getLoopAccountReadiness(date: string, loopId: string): {
  assigned: number;
  prepped: number;
  worked: number;
  ready: number;
  carryForward: number;
  isReady: boolean;
} {
  const states = loadAccountStates(date).filter(s => s.loopId === loopId);
  const prepped = states.filter(s => s.prepStatus === 'prepped').length;
  const worked = states.filter(s => s.actionStatus !== 'not_worked').length;
  const ready = states.filter(s => s.nextRecommendedAction === 'ready_to_call').length;
  const carry = states.filter(s => s.carryForward).length;

  return {
    assigned: states.length,
    prepped,
    worked,
    ready,
    carryForward: carry,
    isReady: prepped > 0 || ready > 0,
  };
}

// ── Reconciliation ─────────────────────────────────────────

/**
 * Reconcile account states when plan is regenerated.
 * Preserves progress (prepped/worked/outcomes) while allowing new accounts.
 */
export function reconcileOnPlanChange(
  date: string,
  newAccounts: Array<{ id: string; name: string; loopId: string | null; blockId: string | null }>,
): void {
  const existing = loadAccountStates(date);
  const existingMap = new Map(existing.map(e => [`${e.accountId}::${e.loopId || 'none'}`, e]));

  const reconciled: AccountExecutionEntry[] = [];

  for (const acct of newAccounts) {
    const key = `${acct.id}::${acct.loopId || 'none'}`;
    const prev = existingMap.get(key);
    if (prev) {
      // Preserve existing progress
      reconciled.push(prev);
      existingMap.delete(key);
    } else {
      // Check if account existed under different loopId with progress
      const anyPrev = existing.find(e => e.accountId === acct.id && e.actionStatus !== 'not_worked');
      if (anyPrev) {
        reconciled.push({ ...anyPrev, loopId: acct.loopId, updatedAt: new Date().toISOString() });
      } else {
        reconciled.push(createEntry(acct.id, acct.name, date, acct.loopId));
      }
    }
  }

  // Preserve orphaned entries that have real progress
  for (const [, entry] of existingMap) {
    if (entry.actionStatus !== 'not_worked' || entry.prepStatus !== 'not_prepped') {
      reconciled.push(entry);
    }
  }

  saveAccountStates(date, reconciled);
}

// ── Outcome Pattern Hooks (for future coaching/roleplay learning) ─────

export interface OutcomePattern {
  outcomeType: OutcomeType;
  frequency: number;
  lastSeen: string;
}

/**
 * Analyze outcome patterns across recent days (for future coaching/roleplay adaptation).
 * Returns the most common outcome types.
 */
export function getRecentOutcomePatterns(daysBack: number = 7): OutcomePattern[] {
  const patterns: Record<string, { count: number; lastSeen: string }> = {};

  for (let d = 0; d < daysBack; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split('T')[0];
    const states = loadAccountStates(dateStr);
    for (const s of states) {
      if (s.lastOutcomeType) {
        const key = s.lastOutcomeType;
        if (!patterns[key]) {
          patterns[key] = { count: 0, lastSeen: dateStr };
        }
        patterns[key].count++;
        if (dateStr > patterns[key].lastSeen) patterns[key].lastSeen = dateStr;
      }
    }
  }

  return Object.entries(patterns)
    .map(([type, data]) => ({
      outcomeType: type as OutcomeType,
      frequency: data.count,
      lastSeen: data.lastSeen,
    }))
    .sort((a, b) => b.frequency - a.frequency);
}
