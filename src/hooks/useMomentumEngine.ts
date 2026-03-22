// Momentum Engine — tracks deal momentum, pipeline creation velocity, cadence progress
// Uses existing store data only. No parallel systems.
// Updated: tracks Target Account → Contact → Outreach → Meeting → Opportunity funnel.

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';

export interface MomentumSignals {
  // Deal momentum
  stalledDeals: number;
  movingDeals: number;
  dealMomentumLabel: 'strong' | 'steady' | 'stalling' | 'stalled';

  // Pipeline creation velocity (full funnel)
  newOppsLast14Days: number;
  targetAccountsWorked14Days: number;
  pipelineCreationLabel: 'active' | 'slowing' | 'dry';

  // Target account gap (replaces newLogoGap)
  targetAccountGap: boolean; // true if no target account activity in 7+ days

  // Funnel conversion signals
  targetAccountsTotal: number;
  accountsWithContacts: number;
  accountsWithOutreach: number;
  accountsWithMeetings: number;

  // Overall momentum score (0-100)
  momentumScore: number;
}

export function useMomentumEngine(): MomentumSignals {
  const { opportunities, accounts, tasks } = useStore();

  return useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const sevenStr = sevenDaysAgo.toISOString().split('T')[0];
    const fourteenStr = fourteenDaysAgo.toISOString().split('T')[0];

    // Deal momentum: how many active deals had a touch in last 7 days vs stalled
    const activeOpps = opportunities.filter(o => o.status === 'active');
    const movingDeals = activeOpps.filter(o => o.lastTouchDate && o.lastTouchDate >= sevenStr).length;
    const stalledDeals = activeOpps.filter(o => !o.lastTouchDate || o.lastTouchDate < sevenStr).length;

    let dealMomentumLabel: MomentumSignals['dealMomentumLabel'];
    if (activeOpps.length === 0) dealMomentumLabel = 'steady';
    else {
      const ratio = movingDeals / activeOpps.length;
      if (ratio >= 0.8) dealMomentumLabel = 'strong';
      else if (ratio >= 0.5) dealMomentumLabel = 'steady';
      else if (ratio >= 0.25) dealMomentumLabel = 'stalling';
      else dealMomentumLabel = 'stalled';
    }

    // Target accounts = accounts with motion 'new-logo' that are being worked
    const targetAccounts = accounts.filter(a => a.motion === 'new-logo');
    const targetAccountsTotal = targetAccounts.length;

    // Funnel stage tracking using outreach status
    const accountsWithContacts = targetAccounts.filter(a =>
      a.contactStatus === 'ready' || a.contactStatus === 'in-progress' ||
      (a.outreachStatus && a.outreachStatus !== 'not-started')
    ).length;

    const accountsWithOutreach = targetAccounts.filter(a =>
      a.outreachStatus && ['in-progress', 'working', 'nurture', 'meeting-set', 'opp-open', 'closed-won'].includes(a.outreachStatus)
    ).length;

    const accountsWithMeetings = targetAccounts.filter(a =>
      a.outreachStatus && ['meeting-set', 'opp-open', 'closed-won'].includes(a.outreachStatus)
    ).length;

    // Pipeline creation: target accounts worked in last 14 days
    const targetAccountsWorked14Days = targetAccounts.filter(a =>
      a.lastTouchDate && a.lastTouchDate >= fourteenStr
    ).length;

    // New opps created in last 14 days
    const newOppsLast14Days = opportunities.filter(o =>
      o.createdAt && o.createdAt >= fourteenStr
    ).length;

    let pipelineCreationLabel: MomentumSignals['pipelineCreationLabel'];
    if (targetAccountsWorked14Days >= 5 || newOppsLast14Days >= 2) pipelineCreationLabel = 'active';
    else if (targetAccountsWorked14Days >= 2 || newOppsLast14Days >= 1) pipelineCreationLabel = 'slowing';
    else pipelineCreationLabel = 'dry';

    // Target account gap: any target account activity in last 7 days?
    const recentTargetTouch = targetAccounts.some(a => a.lastTouchDate && a.lastTouchDate >= sevenStr);
    const recentNewOpp = opportunities.some(o => o.dealType === 'new-logo' && o.createdAt && o.createdAt >= sevenStr);
    const targetAccountGap = !recentTargetTouch && !recentNewOpp && targetAccountsTotal > 0;

    // Overall momentum score
    let momentumScore = 50;
    if (dealMomentumLabel === 'strong') momentumScore += 20;
    else if (dealMomentumLabel === 'steady') momentumScore += 10;
    else if (dealMomentumLabel === 'stalling') momentumScore -= 10;
    else momentumScore -= 25;

    if (pipelineCreationLabel === 'active') momentumScore += 20;
    else if (pipelineCreationLabel === 'slowing') momentumScore += 5;
    else momentumScore -= 15;

    if (targetAccountGap) momentumScore -= 10;

    momentumScore = Math.max(0, Math.min(100, momentumScore));

    return {
      stalledDeals,
      movingDeals,
      dealMomentumLabel,
      newOppsLast14Days,
      targetAccountsWorked14Days,
      pipelineCreationLabel,
      targetAccountGap,
      targetAccountsTotal,
      accountsWithContacts,
      accountsWithOutreach,
      accountsWithMeetings,
      momentumScore,
    };
  }, [opportunities, accounts, tasks]);
}
