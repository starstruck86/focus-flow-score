// Intelligence engine: scores every entity by urgency × impact to drive prioritized work queues
import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { differenceInDays, differenceInHours, parseISO, format, startOfDay } from 'date-fns';
import type { Account, Opportunity, Renewal } from '@/types';

export type WorkItemType = 'account' | 'opportunity' | 'renewal';
export type WorkItemUrgency = 'critical' | 'high' | 'medium' | 'low';

export interface WorkItem {
  id: string;
  type: WorkItemType;
  name: string;
  accountName?: string;
  accountId?: string;
  score: number; // 0-100 composite score
  urgency: WorkItemUrgency;
  reason: string; // Why this is prioritized
  action: string; // What to do
  arrAtStake: number;
  daysUntilDeadline?: number;
  daysSinceLastTouch?: number;
  route: string; // Where to navigate
  hasMeetingToday?: boolean;
  hasMeetingSoon?: boolean;
  isRenewalOpp?: boolean; // Whether this opportunity is linked to a renewal
}

export interface TimeAllocationTarget {
  label: string;
  targetPercent: number;
  actualPercent: number;
  status: 'over' | 'under' | 'on-track';
}

// Score an account for work priority
function scoreAccount(account: Account, calendarAccountNames: Set<string>): WorkItem | null {
  // Skip disqualified and meeting-booked (already converted)
  if (account.accountStatus === 'disqualified') return null;

  let score = 0;
  const reasons: string[] = [];
  let action = '';

  // Tier weight
  const tierWeight = account.tier === 'A' ? 30 : account.tier === 'B' ? 20 : 10;
  score += tierWeight;

  // Staleness: days since last touch
  const daysSinceTouch = account.lastTouchDate
    ? differenceInDays(new Date(), parseISO(account.lastTouchDate))
    : 999;

  if (daysSinceTouch > 14) {
    score += 25;
    reasons.push(`${daysSinceTouch}d since last touch`);
  } else if (daysSinceTouch > 7) {
    score += 15;
    reasons.push(`${daysSinceTouch}d since last touch`);
  }

  // Status-based urgency
  if (account.accountStatus === 'active' && !account.cadenceName) {
    score += 15;
    reasons.push('Active but not in cadence');
    action = 'Add to cadence';
  } else if (account.accountStatus === 'researching') {
    if (!account.website && !account.marTech) {
      score += 10;
      reasons.push('Needs research');
      action = 'Complete research';
    }
  } else if (account.accountStatus === 'prepped' && daysSinceTouch > 3) {
    score += 20;
    reasons.push('Prepped but no recent outreach');
    action = 'Start outreach';
  }

  // Meeting today boost
  const hasCalMatch = calendarAccountNames.has(account.name.toLowerCase());
  if (hasCalMatch) {
    score += 30;
    reasons.push('Meeting today/tomorrow');
    action = 'Prep for meeting';
  }

  // Contact status - incomplete contacts = opportunity to improve
  if (account.contactStatus === 'not-started') {
    score += 10;
    reasons.push('No contacts identified');
    if (!action) action = 'Find contacts';
  }

  if (score < 20) return null; // Filter low-priority noise
  if (!action) action = daysSinceTouch > 7 ? 'Follow up' : 'Continue outreach';
  if (reasons.length === 0) reasons.push('Routine follow-up');

  const urgency: WorkItemUrgency =
    score >= 70 ? 'critical' :
    score >= 50 ? 'high' :
    score >= 30 ? 'medium' : 'low';

  return {
    id: account.id,
    type: 'account',
    name: account.name,
    score: Math.min(100, score),
    urgency,
    reason: reasons[0],
    action,
    arrAtStake: 0,
    daysSinceLastTouch: daysSinceTouch < 900 ? daysSinceTouch : undefined,
    route: '/outreach',
    hasMeetingToday: hasCalMatch,
  };
}

// Score an opportunity for work priority
function scoreOpportunity(opp: Opportunity, accounts: Account[]): WorkItem | null {
  if (opp.status === 'closed-won' || opp.status === 'closed-lost') return null;

  let score = 0;
  const reasons: string[] = [];
  let action = '';

  // ARR weight (normalized: $100k+ = max 25pts)
  const arrWeight = Math.min(25, ((opp.arr || 0) / 100000) * 25);
  score += arrWeight;

  // Close date proximity
  const daysToClose = opp.closeDate
    ? differenceInDays(parseISO(opp.closeDate), new Date())
    : 999;

  if (daysToClose <= 7) {
    score += 30;
    reasons.push(`Closes in ${daysToClose}d`);
    action = 'Push to close';
  } else if (daysToClose <= 30) {
    score += 20;
    reasons.push(`Closes in ${daysToClose}d`);
  } else if (daysToClose <= 45) {
    score += 10;
  }

  // Stalled deals
  if (opp.status === 'stalled') {
    score += 20;
    reasons.push('Deal is stalled');
    action = action || 'Re-engage stakeholder';
  }

  // Missing next step
  if (!opp.nextStep) {
    score += 15;
    reasons.push('No next step defined');
    action = action || 'Define next step';
  }

  // Churn risk on renewal opps
  if (opp.churnRisk === 'high' || opp.churnRisk === 'certain') {
    score += 20;
    reasons.push(`Churn risk: ${opp.churnRisk}`);
  }

  // Days since last touch
  const daysSinceTouch = opp.lastTouchDate
    ? differenceInDays(new Date(), parseISO(opp.lastTouchDate))
    : undefined;

  if (daysSinceTouch && daysSinceTouch > 7) {
    score += 15;
    reasons.push(`${daysSinceTouch}d since last touch`);
    action = action || 'Follow up';
  }

  if (score < 15) return null;
  if (!action) action = 'Advance deal';
  if (reasons.length === 0) reasons.push('Pipeline management');

  const account = opp.accountId ? accounts.find(a => a.id === opp.accountId) : undefined;

  const urgency: WorkItemUrgency =
    score >= 65 ? 'critical' :
    score >= 45 ? 'high' :
    score >= 25 ? 'medium' : 'low';

  // Determine if this is a renewal-related opportunity
  const isRenewalOpp = opp.dealType === 'renewal' || opp.dealType === 'expansion';

  return {
    id: opp.id,
    type: 'opportunity',
    name: opp.name,
    accountName: opp.accountName || account?.name,
    accountId: opp.accountId,
    score: Math.min(100, score),
    urgency,
    reason: reasons[0],
    action,
    arrAtStake: opp.arr || 0,
    daysUntilDeadline: daysToClose < 900 ? daysToClose : undefined,
    daysSinceLastTouch: daysSinceTouch,
    route: isRenewalOpp ? '/renewals' : '/outreach',
    isRenewalOpp,
  };
}

// Score a renewal for work priority
function scoreRenewal(renewal: Renewal): WorkItem | null {
  let score = 0;
  const reasons: string[] = [];
  let action = '';

  // ARR weight
  const arrWeight = Math.min(25, (renewal.arr / 100000) * 25);
  score += arrWeight;

  // Days to renewal
  const daysToRenewal = renewal.daysToRenewal;
  if (daysToRenewal <= 14) {
    score += 35;
    reasons.push(`Renews in ${daysToRenewal}d`);
    action = 'Secure renewal';
  } else if (daysToRenewal <= 30) {
    score += 25;
    reasons.push(`Renews in ${daysToRenewal}d`);
    action = 'Finalize terms';
  } else if (daysToRenewal <= 60) {
    score += 15;
    reasons.push(`Renews in ${daysToRenewal}d`);
  } else if (daysToRenewal <= 90) {
    score += 8;
  }

  // Churn risk
  if (renewal.churnRisk === 'certain') {
    score += 30;
    reasons.push('OOB / Churning');
    action = action || 'Intervention required';
  } else if (renewal.churnRisk === 'high') {
    score += 25;
    reasons.push('High churn risk');
    action = action || 'Risk mitigation';
  } else if (renewal.churnRisk === 'medium') {
    score += 10;
  }

  // Health status
  if (renewal.healthStatus === 'red') {
    score += 15;
    reasons.push('Red health status');
  }

  // Missing critical fields
  if (!renewal.nextStep) {
    score += 10;
    reasons.push('No next step');
    action = action || 'Define next step';
  }
  if (!renewal.planhatLink) {
    score += 5;
  }
  if (!renewal.currentAgreementLink) {
    score += 5;
  }

  if (score < 15) return null;
  if (!action) action = daysToRenewal <= 90 ? 'Prepare for renewal' : 'Monitor';
  if (reasons.length === 0) reasons.push('Upcoming renewal');

  const urgency: WorkItemUrgency =
    score >= 65 ? 'critical' :
    score >= 45 ? 'high' :
    score >= 25 ? 'medium' : 'low';

  return {
    id: renewal.id,
    type: 'renewal',
    name: renewal.accountName,
    accountId: renewal.accountId,
    score: Math.min(100, score),
    urgency,
    reason: reasons[0],
    action,
    arrAtStake: renewal.arr,
    daysUntilDeadline: daysToRenewal,
    route: '/renewals',
  };
}

// Compute auto risk score for a renewal (0-100)
export function computeRenewalRiskScore(renewal: Renewal): number {
  let risk = 0;

  // Churn risk weight
  const churnWeights: Record<string, number> = { certain: 40, high: 30, medium: 15, low: 0 };
  risk += churnWeights[renewal.churnRisk || 'low'] || 0;

  // Days to renewal proximity
  if (renewal.daysToRenewal <= 14) risk += 25;
  else if (renewal.daysToRenewal <= 30) risk += 20;
  else if (renewal.daysToRenewal <= 60) risk += 12;
  else if (renewal.daysToRenewal <= 90) risk += 5;

  // Health status
  if (renewal.healthStatus === 'red') risk += 15;
  else if (renewal.healthStatus === 'yellow') risk += 8;

  // Missing fields
  if (!renewal.nextStep) risk += 8;
  if (!renewal.planhatLink) risk += 5;
  if (!renewal.currentAgreementLink) risk += 5;

  // ARR magnitude (higher ARR = more impactful risk)
  if (renewal.arr > 100000) risk += 5;
  else if (renewal.arr > 50000) risk += 3;

  return Math.min(100, risk);
}

export function useTimeAllocation() {
  const { accounts, opportunities, renewals } = useStore();
  const { data: calendarEvents } = useCalendarEvents();

  // Build set of account names that have meetings today or tomorrow
  const calendarAccountNames = useMemo(() => {
    const names = new Set<string>();
    if (!calendarEvents) return names;
    const today = startOfDay(new Date());
    const twoDaysOut = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);

    calendarEvents.forEach(evt => {
      const start = parseISO(evt.start_time);
      if (start >= today && start <= twoDaysOut) {
        // Try to match account names in event title
        accounts.forEach(acct => {
          if (evt.title.toLowerCase().includes(acct.name.toLowerCase())) {
            names.add(acct.name.toLowerCase());
          }
        });
      }
    });
    return names;
  }, [calendarEvents, accounts]);

  const workQueue = useMemo(() => {
    const items: WorkItem[] = [];

    accounts.forEach(a => {
      const item = scoreAccount(a, calendarAccountNames);
      if (item) items.push(item);
    });

    opportunities.forEach(o => {
      const item = scoreOpportunity(o, accounts);
      if (item) items.push(item);
    });

    renewals.forEach(r => {
      const item = scoreRenewal(r);
      if (item) items.push(item);
    });

    // Sort by score descending
    items.sort((a, b) => b.score - a.score);

    return items;
  }, [accounts, opportunities, renewals, calendarAccountNames]);

  // Time allocation targets vs actuals
  const timeAllocation = useMemo((): TimeAllocationTarget[] => {
    const totalActive = workQueue.length || 1;
    const accountItems = workQueue.filter(w => w.type === 'account').length;
    const oppItems = workQueue.filter(w => w.type === 'opportunity').length;
    const renewalItems = workQueue.filter(w => w.type === 'renewal').length;

    return [
      {
        label: 'New Logo Prospecting',
        targetPercent: 60,
        actualPercent: Math.round((accountItems / totalActive) * 100),
        status: Math.abs((accountItems / totalActive) * 100 - 60) < 15 ? 'on-track' : (accountItems / totalActive) * 100 > 60 ? 'over' : 'under',
      },
      {
        label: 'Pipeline Advancement',
        targetPercent: 25,
        actualPercent: Math.round((oppItems / totalActive) * 100),
        status: Math.abs((oppItems / totalActive) * 100 - 25) < 10 ? 'on-track' : (oppItems / totalActive) * 100 > 25 ? 'over' : 'under',
      },
      {
        label: 'Renewal Management',
        targetPercent: 15,
        actualPercent: Math.round((renewalItems / totalActive) * 100),
        status: Math.abs((renewalItems / totalActive) * 100 - 15) < 10 ? 'on-track' : (renewalItems / totalActive) * 100 > 15 ? 'over' : 'under',
      },
    ];
  }, [workQueue]);

  // Renewal risk scores
  const renewalRiskScores = useMemo(() => {
    return renewals.map(r => ({
      id: r.id,
      riskScore: computeRenewalRiskScore(r),
    }));
  }, [renewals]);

  // Account staleness data
  const accountStaleness = useMemo(() => {
    return accounts.map(a => {
      const days = a.lastTouchDate
        ? differenceInDays(new Date(), parseISO(a.lastTouchDate))
        : null;
      return {
        id: a.id,
        daysSinceLastTouch: days,
        staleness: days === null ? 'unknown' as const :
          days > 14 ? 'stale' as const :
          days > 7 ? 'aging' as const : 'fresh' as const,
      };
    });
  }, [accounts]);

  return {
    workQueue,
    topWorkItems: workQueue.slice(0, 7),
    timeAllocation,
    renewalRiskScores,
    accountStaleness,
    totalArrAtRisk: workQueue
      .filter(w => w.urgency === 'critical' || w.urgency === 'high')
      .reduce((sum, w) => sum + w.arrAtStake, 0),
  };
}
