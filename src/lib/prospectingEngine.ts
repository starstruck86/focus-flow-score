/**
 * Prospecting Execution Engine — step-driven execution system.
 * Guides user through atomic steps in prospecting cycles.
 * Each cycle: select_account → find_contacts → enrich → add_to_system → launch_cadence → make_call
 * Completing steps auto-increments target metrics. Never a blank state.
 */

// ── Data Model ──────────────────────────────────────────────────

export type ProspectingStepId =
  | 'select_account'
  | 'find_contacts'
  | 'enrich'
  | 'add_to_system'
  | 'launch_cadence'
  | 'make_call';

export interface ProspectingStep {
  id: ProspectingStepId;
  label: string;
  verb: string;            // action verb for the "Next Action" card
  description: string;
  daveHint: string;        // what Dave can help with
  estimateMinutes: number; // <5 always
  order: number;
  /** Which target metric this step increments */
  incrementsMetric: keyof DailyTargetActuals | null;
  incrementAmount: number;
}

export const PROSPECTING_STEPS: ProspectingStep[] = [
  {
    id: 'select_account', label: 'Select Account', verb: 'Pick your next target account',
    description: 'Choose a high-fit account from your pipeline or sourced leads',
    daveHint: 'Say "suggest next accounts" for AI-ranked picks',
    estimateMinutes: 2, order: 0,
    incrementsMetric: 'accountsWorked', incrementAmount: 1,
  },
  {
    id: 'find_contacts', label: 'Find Contacts', verb: 'Identify 2–3 key contacts',
    description: 'Find decision-makers and champions at the selected account',
    daveHint: 'Say "discover contacts for [account]" to auto-find',
    estimateMinutes: 3, order: 1,
    incrementsMetric: 'contactsAdded', incrementAmount: 2,
  },
  {
    id: 'enrich', label: 'Enrich', verb: 'Research the account & contacts',
    description: 'Review enrichment data, check tech stack, recent news',
    daveHint: 'Say "enrich [account]" for automated research',
    estimateMinutes: 3, order: 2,
    incrementsMetric: null, incrementAmount: 0,
  },
  {
    id: 'add_to_system', label: 'Add to CRM', verb: 'Save account + contacts to system',
    description: 'Ensure account and contacts exist in your CRM',
    daveHint: 'Say "create account [name]" or "add contact [name]"',
    estimateMinutes: 2, order: 3,
    incrementsMetric: null, incrementAmount: 0,
  },
  {
    id: 'launch_cadence', label: 'Launch Cadence', verb: 'Start the outreach sequence',
    description: 'Begin multi-touch cadence for this account',
    daveHint: 'Say "update outreach status for [account]"',
    estimateMinutes: 2, order: 4,
    incrementsMetric: 'cadencesLaunched', incrementAmount: 1,
  },
  {
    id: 'make_call', label: 'Make Call', verb: 'Call a contact at this account',
    description: 'Make a prospecting call to advance the conversation',
    daveHint: 'Say "log touch for [account]" after the call',
    estimateMinutes: 5, order: 5,
    incrementsMetric: 'callsMade', incrementAmount: 1,
  },
];

export type TierLevel = 'floor' | 'target' | 'stretch';

export interface DailyTierTargets {
  accountsToWork: number;
  contactsToAdd: number;
  cadencesToLaunch: number;
  callsToMake: number;
}

// ── Cycle State ─────────────────────────────────────────────────

/** One pass through the step sequence for a single account */
export interface ProspectingCycle {
  cycleIndex: number;       // 0-based: which account cycle we're on today
  accountName?: string;     // set after select_account
  completedSteps: ProspectingStepId[];
  startedAt: string;        // ISO timestamp
}

export interface DailyTargetActuals {
  accountsWorked: number;
  contactsAdded: number;
  cadencesLaunched: number;
  callsMade: number;
}

export interface ProspectingState {
  date: string;
  cycles: ProspectingCycle[];
  actuals: DailyTargetActuals;
  totalStepsCompleted: number;
}

// ── Weekly Progress (unchanged) ─────────────────────────────────

export interface WeeklyProgress {
  accountsAdded: number;
  contactsAdded: number;
  cadencesLaunched: number;
  callsMade: number;
  daysCompleted: number;
  daysRemaining: number;
  weeklyAccountTarget: number;
  weeklyContactTarget: number;
  weeklyCadenceTarget: number;
  weeklyCallTarget: number;
}

// ── Daily Plan ──────────────────────────────────────────────────

export interface DailyProspectingPlan {
  date: string;
  floor: DailyTierTargets;
  target: DailyTierTargets;
  stretch: DailyTierTargets;
  adjustmentReason: string | null;
  riskAlerts: string[];
  meetingLoadHours: number;
  weeklyProgress: WeeklyProgress;
}

// ── Step Engine Output ──────────────────────────────────────────

export interface NextActionResult {
  step: ProspectingStep;
  cycleIndex: number;
  accountName?: string;
  contextMessage: string; // e.g. "Account 2 of 3 — find contacts"
}

// ── Constants ───────────────────────────────────────────────────

const BASE_WEEKLY = {
  accounts: 15,
  contacts: 30,
  cadences: 10,
  calls: 50,
};

const TIER_MULTIPLIERS = {
  floor: 0.6,
  target: 1.0,
  stretch: 1.4,
};

// ── Step Engine ─────────────────────────────────────────────────

/**
 * Determines the ONE next action. Never returns null — always has a step.
 * After completing a full cycle, starts a new one automatically.
 */
export function resolveNextAction(state: ProspectingState): NextActionResult {
  const currentCycle = state.cycles[state.cycles.length - 1];

  // No cycles started yet → start first cycle
  if (!currentCycle) {
    return {
      step: PROSPECTING_STEPS[0],
      cycleIndex: 0,
      contextMessage: 'Start your first prospecting cycle — pick an account',
    };
  }

  // Find first incomplete step in current cycle
  for (const step of PROSPECTING_STEPS) {
    if (!currentCycle.completedSteps.includes(step.id)) {
      const accountLabel = currentCycle.accountName || `Account ${currentCycle.cycleIndex + 1}`;
      return {
        step,
        cycleIndex: currentCycle.cycleIndex,
        accountName: currentCycle.accountName,
        contextMessage: step.id === 'select_account'
          ? `Cycle ${currentCycle.cycleIndex + 1} — pick your next account`
          : `${accountLabel} — ${step.verb}`,
      };
    }
  }

  // Current cycle complete → suggest starting next cycle
  const nextIndex = currentCycle.cycleIndex + 1;
  return {
    step: PROSPECTING_STEPS[0],
    cycleIndex: nextIndex,
    contextMessage: `Cycle ${nextIndex + 1} — pick your next account 🔥`,
  };
}

/**
 * Complete a step in the current cycle. Returns updated state.
 * Auto-increments the relevant target metric.
 */
export function completeStepInState(
  state: ProspectingState,
  stepId: ProspectingStepId,
  accountName?: string,
): ProspectingState {
  const step = PROSPECTING_STEPS.find(s => s.id === stepId)!;
  let cycles = [...state.cycles];
  let actuals = { ...state.actuals };

  // Ensure we have a current cycle
  if (cycles.length === 0) {
    cycles.push({
      cycleIndex: 0,
      completedSteps: [],
      startedAt: new Date().toISOString(),
      accountName,
    });
  }

  const currentIdx = cycles.length - 1;
  const current = { ...cycles[currentIdx] };

  // Mark step done
  if (!current.completedSteps.includes(stepId)) {
    current.completedSteps = [...current.completedSteps, stepId];
  }

  // Set account name if this is the select step
  if (stepId === 'select_account' && accountName) {
    current.accountName = accountName;
  }

  cycles[currentIdx] = current;

  // Auto-increment metric
  if (step.incrementsMetric && step.incrementAmount > 0) {
    actuals = {
      ...actuals,
      [step.incrementsMetric]: (actuals[step.incrementsMetric] as number) + step.incrementAmount,
    };
  }

  // If cycle is fully complete, start next cycle skeleton
  const allDone = PROSPECTING_STEPS.every(s => current.completedSteps.includes(s.id));
  if (allDone) {
    cycles.push({
      cycleIndex: current.cycleIndex + 1,
      completedSteps: [],
      startedAt: new Date().toISOString(),
    });
  }

  return {
    ...state,
    cycles,
    actuals,
    totalStepsCompleted: state.totalStepsCompleted + 1,
  };
}

// ── Plan Generator (kept for tier tracking) ─────────────────────

export function generateDailyPlan(
  weeklyProgress: WeeklyProgress,
  meetingHoursToday: number,
): DailyProspectingPlan {
  const today = new Date().toISOString().split('T')[0];
  const effectiveDays = Math.max(1, weeklyProgress.daysRemaining);

  const remaining = (weekly: number, done: number) => Math.max(0, weekly - done);
  const base = (rem: number) => Math.ceil(rem / effectiveDays);

  const rAccounts = remaining(weeklyProgress.weeklyAccountTarget, weeklyProgress.accountsAdded);
  const rContacts = remaining(weeklyProgress.weeklyContactTarget, weeklyProgress.contactsAdded);
  const rCadences = remaining(weeklyProgress.weeklyCadenceTarget, weeklyProgress.cadencesLaunched);
  const rCalls = remaining(weeklyProgress.weeklyCallTarget, weeklyProgress.callsMade);

  // Meeting load: reduce by 15% per hour beyond 2
  const excess = Math.max(0, meetingHoursToday - 2);
  const loadFactor = Math.max(0.4, 1 - excess * 0.15);

  let adjustmentReason: string | null = null;
  if (loadFactor < 1) {
    adjustmentReason = `Reduced ${Math.round((1 - loadFactor) * 100)}% — ${meetingHoursToday.toFixed(1)}h meetings`;
  }

  // Behind-pace boost
  const daysPctUsed = weeklyProgress.daysCompleted / (weeklyProgress.daysCompleted + weeklyProgress.daysRemaining);
  const workPctDone = weeklyProgress.weeklyAccountTarget > 0
    ? weeklyProgress.accountsAdded / weeklyProgress.weeklyAccountTarget : 1;
  let paceFactor = 1;
  if (daysPctUsed > 0.6 && workPctDone < 0.4) {
    paceFactor = 1.2;
    adjustmentReason = (adjustmentReason ? adjustmentReason + '. ' : '') + 'Behind pace +20%';
  }

  const adj = (b: number) => Math.max(1, Math.round(base(b) * loadFactor * paceFactor));

  const targetTier: DailyTierTargets = {
    accountsToWork: adj(rAccounts),
    contactsToAdd: adj(rContacts),
    cadencesToLaunch: adj(rCadences),
    callsToMake: adj(rCalls),
  };

  const mult = (t: DailyTierTargets, m: number): DailyTierTargets => ({
    accountsToWork: Math.max(1, Math.round(t.accountsToWork * m)),
    contactsToAdd: Math.max(1, Math.round(t.contactsToAdd * m)),
    cadencesToLaunch: Math.max(1, Math.round(t.cadencesToLaunch * m)),
    callsToMake: Math.max(1, Math.round(t.callsToMake * m)),
  });

  // Risk alerts
  const riskAlerts: string[] = [];
  if (rAccounts > effectiveDays * 5) riskAlerts.push(`${rAccounts} accounts left — risk of missing target`);
  if (weeklyProgress.cadencesLaunched === 0 && weeklyProgress.daysCompleted >= 2) riskAlerts.push('No cadences yet — pipeline at risk');

  return {
    date: today,
    floor: mult(targetTier, TIER_MULTIPLIERS.floor),
    target: targetTier,
    stretch: mult(targetTier, TIER_MULTIPLIERS.stretch),
    adjustmentReason,
    riskAlerts,
    meetingLoadHours: meetingHoursToday,
    weeklyProgress,
  };
}

// ── Tier Status ─────────────────────────────────────────────────

export function getTierStatus(actuals: DailyTargetActuals, plan: DailyProspectingPlan): {
  currentTier: TierLevel | 'none';
  overallPct: number;
} {
  const pct = (a: number, t: number) => t > 0 ? a / t : 1;
  const avg = (
    pct(actuals.accountsWorked, plan.target.accountsToWork) +
    pct(actuals.contactsAdded, plan.target.contactsToAdd) +
    pct(actuals.cadencesLaunched, plan.target.cadencesToLaunch) +
    pct(actuals.callsMade, plan.target.callsToMake)
  ) / 4;

  let currentTier: TierLevel | 'none' = 'none';
  if (avg >= TIER_MULTIPLIERS.stretch) currentTier = 'stretch';
  else if (avg >= TIER_MULTIPLIERS.target) currentTier = 'target';
  else if (avg >= TIER_MULTIPLIERS.floor) currentTier = 'floor';

  return { currentTier, overallPct: avg };
}

// ── Weekly Progress Builder ─────────────────────────────────────

export function buildWeeklyProgress(
  accounts: Array<{ createdAt: string }>,
  contacts: Array<{ created_at: string }>,
  journalEntries: Array<{ date: string; prospects_added: number; conversations: number }>,
): WeeklyProgress {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().split('T')[0];

  const weekAccounts = accounts.filter(a => a.createdAt >= mondayStr).length;
  const weekContacts = contacts.filter(c => c.created_at >= mondayStr).length;
  const weekJournal = journalEntries.filter(j => j.date >= mondayStr);

  const daysCompleted = Math.min(dow === 0 ? 5 : dow - 1, 5);

  return {
    accountsAdded: weekAccounts,
    contactsAdded: weekContacts,
    cadencesLaunched: weekJournal.reduce((s, j) => s + (j.prospects_added || 0), 0),
    callsMade: weekJournal.reduce((s, j) => s + (j.conversations || 0), 0),
    daysCompleted,
    daysRemaining: Math.max(1, 5 - daysCompleted),
    weeklyAccountTarget: BASE_WEEKLY.accounts,
    weeklyContactTarget: BASE_WEEKLY.contacts,
    weeklyCadenceTarget: BASE_WEEKLY.cadences,
    weeklyCallTarget: BASE_WEEKLY.calls,
  };
}

// ── Empty state factory ─────────────────────────────────────────

export function emptyState(date: string): ProspectingState {
  return {
    date,
    cycles: [],
    actuals: { accountsWorked: 0, contactsAdded: 0, cadencesLaunched: 0, callsMade: 0 },
    totalStepsCompleted: 0,
  };
}
