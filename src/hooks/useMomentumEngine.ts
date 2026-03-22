// Momentum Engine — tracks deal momentum, pipeline creation velocity, cadence progress
// Extends Operating State with momentum signals. Uses existing store data only.

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';

export interface MomentumSignals {
  // Deal momentum
  stalledDeals: number;
  movingDeals: number;
  dealMomentumLabel: 'strong' | 'steady' | 'stalling' | 'stalled';

  // Pipeline creation velocity
  newOppsLast14Days: number;
  newAccountsLast14Days: number;
  pipelineCreationLabel: 'active' | 'slowing' | 'dry';

  // New logo activity
  newLogoGap: boolean; // true if no new-logo activity in 7+ days

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

    // Pipeline creation: new opps created in last 14 days
    const newOppsLast14Days = opportunities.filter(o =>
      o.createdAt && o.createdAt >= fourteenStr
    ).length;

    // New accounts created in last 14 days
    const newAccountsLast14Days = accounts.filter(a =>
      a.createdAt && a.createdAt >= fourteenStr
    ).length;

    let pipelineCreationLabel: MomentumSignals['pipelineCreationLabel'];
    if (newOppsLast14Days >= 3 || newAccountsLast14Days >= 5) pipelineCreationLabel = 'active';
    else if (newOppsLast14Days >= 1 || newAccountsLast14Days >= 2) pipelineCreationLabel = 'slowing';
    else pipelineCreationLabel = 'dry';

    // New logo gap: any new-logo motion activity in last 7 days?
    const newLogoAccounts = accounts.filter(a => a.motion === 'new-logo');
    const recentNewLogoTouch = newLogoAccounts.some(a => a.lastTouchDate && a.lastTouchDate >= sevenStr);
    const recentNewLogoOpp = opportunities.some(o => o.dealType === 'new-logo' && o.createdAt && o.createdAt >= sevenStr);
    const newLogoGap = !recentNewLogoTouch && !recentNewLogoOpp && newLogoAccounts.length > 0;

    // Overall momentum score
    let momentumScore = 50;
    // Deal momentum
    if (dealMomentumLabel === 'strong') momentumScore += 20;
    else if (dealMomentumLabel === 'steady') momentumScore += 10;
    else if (dealMomentumLabel === 'stalling') momentumScore -= 10;
    else momentumScore -= 25;
    // Pipeline creation
    if (pipelineCreationLabel === 'active') momentumScore += 20;
    else if (pipelineCreationLabel === 'slowing') momentumScore += 5;
    else momentumScore -= 15;
    // New logo gap penalty
    if (newLogoGap) momentumScore -= 10;

    momentumScore = Math.max(0, Math.min(100, momentumScore));

    return {
      stalledDeals,
      movingDeals,
      dealMomentumLabel,
      newOppsLast14Days,
      newAccountsLast14Days,
      pipelineCreationLabel,
      newLogoGap,
      momentumScore,
    };
  }, [opportunities, accounts, tasks]);
}
