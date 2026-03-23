/**
 * Prospecting Execution Engine — deterministic daily plan generator.
 * Breaks new-logo prospecting into atomic steps with floor/target/stretch tiers.
 * Adapts daily expectations based on meeting load and weekly progress.
 */

// ── Data Model ──────────────────────────────────────────────────

export type ProspectingStepId = 'select_account' | 'find_contacts' | 'enrich' | 'add_to_system' | 'launch_cadence';

export interface ProspectingStep {
  id: ProspectingStepId;
  label: string;
  description: string;
  order: number;
}

export const PROSPECTING_STEPS: ProspectingStep[] = [
  { id: 'select_account', label: 'Select Account', description: 'Choose a high-fit target account', order: 1 },
  { id: 'find_contacts', label: 'Find Contacts', description: 'Identify 2-3 key contacts', order: 2 },
  { id: 'enrich', label: 'Enrich', description: 'Research account & contacts', order: 3 },
  { id: 'add_to_system', label: 'Add to CRM', description: 'Create account + contacts in system', order: 4 },
  { id: 'launch_cadence', label: 'Launch Cadence', description: 'Start outreach sequence', order: 5 },
];

export type TierLevel = 'floor' | 'target' | 'stretch';

export interface DailyTierTargets {
  accountsToWork: number;
  contactsToAdd: number;
  cadencesToLaunch: number;
  callsToMake: number;
}

export interface DailyProspectingPlan {
  date: string;
  floor: DailyTierTargets;
  target: DailyTierTargets;
  stretch: DailyTierTargets;
  adjustmentReason: string | null;
  riskAlerts: string[];
  nextAction: ProspectingStep;
  meetingLoadHours: number;
  weeklyProgress: WeeklyProgress;
}

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

export interface DailyActuals {
  accountsWorked: number;
  contactsAdded: number;
  cadencesLaunched: number;
  callsMade: number;
  stepsCompleted: ProspectingStepId[];
}

// ── Constants ───────────────────────────────────────────────────

const BASE_WEEKLY = {
  accounts: 15,    // 3/day × 5 days
  contacts: 30,    // 6/day (2 per account)
  cadences: 10,    // 2/day
  calls: 50,       // 10/day
};

const TIER_MULTIPLIERS = {
  floor: 0.6,      // ~60% of target (always achievable)
  target: 1.0,
  stretch: 1.4,    // 140% of target
};

// ── Plan Generator ──────────────────────────────────────────────

export function generateDailyPlan(
  weeklyProgress: WeeklyProgress,
  meetingHoursToday: number,
  todayActuals: DailyActuals,
): DailyProspectingPlan {
  const today = new Date().toISOString().split('T')[0];
  const { daysRemaining } = weeklyProgress;
  const effectiveDays = Math.max(1, daysRemaining);

  // Calculate remaining weekly work
  const remainingAccounts = Math.max(0, weeklyProgress.weeklyAccountTarget - weeklyProgress.accountsAdded);
  const remainingContacts = Math.max(0, weeklyProgress.weeklyContactTarget - weeklyProgress.contactsAdded);
  const remainingCadences = Math.max(0, weeklyProgress.weeklyCadenceTarget - weeklyProgress.cadencesLaunched);
  const remainingCalls = Math.max(0, weeklyProgress.weeklyCallTarget - weeklyProgress.callsMade);

  // Base daily = remaining / days left
  const baseDailyAccounts = Math.ceil(remainingAccounts / effectiveDays);
  const baseDailyContacts = Math.ceil(remainingContacts / effectiveDays);
  const baseDailyCadences = Math.ceil(remainingCadences / effectiveDays);
  const baseDailyCalls = Math.ceil(remainingCalls / effectiveDays);

  // Meeting load adjustment: reduce by 15% per hour of meetings beyond 2
  const excessMeetingHours = Math.max(0, meetingHoursToday - 2);
  const loadFactor = Math.max(0.4, 1 - excessMeetingHours * 0.15);

  let adjustmentReason: string | null = null;
  if (loadFactor < 1) {
    adjustmentReason = `Reduced targets by ${Math.round((1 - loadFactor) * 100)}% — ${meetingHoursToday.toFixed(1)}h of meetings today`;
  }

  // Behind-pace boost: if we've used 60%+ of days but done <40% of work, boost 20%
  const daysPctUsed = weeklyProgress.daysCompleted / (weeklyProgress.daysCompleted + daysRemaining);
  const workPctDone = weeklyProgress.weeklyAccountTarget > 0
    ? weeklyProgress.accountsAdded / weeklyProgress.weeklyAccountTarget
    : 1;
  let paceFactor = 1;
  if (daysPctUsed > 0.6 && workPctDone < 0.4) {
    paceFactor = 1.2;
    adjustmentReason = (adjustmentReason ? adjustmentReason + '. ' : '') + 'Behind pace — daily targets increased 20%';
  }

  const adjusted = (base: number) => Math.max(1, Math.round(base * loadFactor * paceFactor));

  const targetTier: DailyTierTargets = {
    accountsToWork: adjusted(baseDailyAccounts),
    contactsToAdd: adjusted(baseDailyContacts),
    cadencesToLaunch: adjusted(baseDailyCadences),
    callsToMake: adjusted(baseDailyCalls),
  };

  const applyMultiplier = (tier: DailyTierTargets, mult: number): DailyTierTargets => ({
    accountsToWork: Math.max(1, Math.round(tier.accountsToWork * mult)),
    contactsToAdd: Math.max(1, Math.round(tier.contactsToAdd * mult)),
    cadencesToLaunch: Math.max(1, Math.round(tier.cadencesToLaunch * mult)),
    callsToMake: Math.max(1, Math.round(tier.callsToMake * mult)),
  });

  // Risk alerts
  const riskAlerts: string[] = [];
  if (remainingAccounts > effectiveDays * 5) {
    riskAlerts.push(`${remainingAccounts} accounts still needed this week — risk of missing target`);
  }
  if (weeklyProgress.cadencesLaunched === 0 && weeklyProgress.daysCompleted >= 2) {
    riskAlerts.push('No cadences launched yet — pipeline generation at risk');
  }
  if (todayActuals.accountsWorked === 0 && new Date().getHours() >= 14) {
    riskAlerts.push('No accounts worked today — start with 1 account now');
  }

  // Determine next step based on actuals
  const nextAction = determineNextStep(todayActuals);

  return {
    date: today,
    floor: applyMultiplier(targetTier, TIER_MULTIPLIERS.floor),
    target: targetTier,
    stretch: applyMultiplier(targetTier, TIER_MULTIPLIERS.stretch),
    adjustmentReason,
    riskAlerts,
    nextAction,
    meetingLoadHours: meetingHoursToday,
    weeklyProgress,
  };
}

function determineNextStep(actuals: DailyActuals): ProspectingStep {
  // Always present the smallest achievable next action
  if (actuals.accountsWorked === 0) return PROSPECTING_STEPS[0]; // select_account
  if (actuals.contactsAdded === 0) return PROSPECTING_STEPS[1]; // find_contacts
  if (!actuals.stepsCompleted.includes('enrich')) return PROSPECTING_STEPS[2]; // enrich
  if (!actuals.stepsCompleted.includes('add_to_system')) return PROSPECTING_STEPS[3]; // add_to_system
  if (actuals.cadencesLaunched === 0) return PROSPECTING_STEPS[4]; // launch_cadence
  // If all done for one cycle, restart with next account
  return PROSPECTING_STEPS[0];
}

// ── Progress Tracking ───────────────────────────────────────────

export function getTierStatus(actuals: DailyActuals, plan: DailyProspectingPlan): {
  currentTier: TierLevel | 'none';
  accountPct: number;
  contactPct: number;
  cadencePct: number;
  callPct: number;
} {
  const accountPct = plan.target.accountsToWork > 0 ? actuals.accountsWorked / plan.target.accountsToWork : 1;
  const contactPct = plan.target.contactsToAdd > 0 ? actuals.contactsAdded / plan.target.contactsToAdd : 1;
  const cadencePct = plan.target.cadencesToLaunch > 0 ? actuals.cadencesLaunched / plan.target.cadencesToLaunch : 1;
  const callPct = plan.target.callsToMake > 0 ? actuals.callsMade / plan.target.callsToMake : 1;

  const avgPct = (accountPct + contactPct + cadencePct + callPct) / 4;

  let currentTier: TierLevel | 'none' = 'none';
  if (avgPct >= TIER_MULTIPLIERS.stretch) currentTier = 'stretch';
  else if (avgPct >= TIER_MULTIPLIERS.target) currentTier = 'target';
  else if (avgPct >= TIER_MULTIPLIERS.floor) currentTier = 'floor';

  return { currentTier, accountPct, contactPct, cadencePct, callPct };
}

export function buildWeeklyProgress(
  accounts: Array<{ createdAt: string }>,
  contacts: Array<{ created_at: string }>,
  journalEntries: Array<{ date: string; prospects_added: number; conversations: number }>,
): WeeklyProgress {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().split('T')[0];

  const weekAccounts = accounts.filter(a => a.createdAt >= mondayStr).length;
  const weekContacts = contacts.filter(c => c.created_at >= mondayStr).length;

  const weekJournal = journalEntries.filter(j => j.date >= mondayStr);
  const weekProspects = weekJournal.reduce((s, j) => s + (j.prospects_added || 0), 0);
  const weekCalls = weekJournal.reduce((s, j) => s + (j.conversations || 0), 0);

  const daysCompleted = Math.min(dayOfWeek === 0 ? 5 : dayOfWeek - 1, 5);
  const daysRemaining = Math.max(1, 5 - daysCompleted);

  return {
    accountsAdded: weekAccounts,
    contactsAdded: weekContacts,
    cadencesLaunched: weekProspects,
    callsMade: weekCalls,
    daysCompleted,
    daysRemaining,
    weeklyAccountTarget: BASE_WEEKLY.accounts,
    weeklyContactTarget: BASE_WEEKLY.contacts,
    weeklyCadenceTarget: BASE_WEEKLY.cadences,
    weeklyCallTarget: BASE_WEEKLY.calls,
  };
}
