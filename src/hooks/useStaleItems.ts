import { useMemo } from 'react';
import { useStore } from '@/store/useStore';

export interface StaleItems {
  staleAccounts: number;   // 14+ days no touch
  oppsNoNextStep: number;  // active opps with no next step
  atRiskRenewals: number;  // <30 days out with no linked opp or high/certain churn
}

export function useStaleItems(): StaleItems {
  const { accounts, opportunities, renewals } = useStore();

  return useMemo(() => {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

    const staleAccounts = accounts.filter(a => {
      if (a.accountStatus === 'inactive' || a.accountStatus === 'disqualified') return false;
      if (!a.lastTouchDate) return true;
      return a.lastTouchDate < fourteenDaysAgoStr;
    }).length;

    const oppsNoNextStep = opportunities.filter(o =>
      o.status === 'active' && !o.nextStep && !o.nextStepDate
    ).length;

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const atRiskRenewals = renewals.filter(r => {
      if (r.daysToRenewal > 30) return false;
      const hasRiskFlag = r.churnRisk === 'high' || r.churnRisk === 'certain';
      const noLinkedOpp = !r.linkedOpportunityId;
      const noNextStep = !r.nextStep;
      return hasRiskFlag || noLinkedOpp || noNextStep;
    }).length;

    return { staleAccounts, oppsNoNextStep, atRiskRenewals };
  }, [accounts, opportunities, renewals]);
}
