/**
 * React hook for consuming AccountWorkingSummary in components.
 * Bridges DB accounts, execution state, and timeline into the unified model.
 */

import { useMemo } from 'react';
import { useDbAccounts, useDbOpportunities } from '@/hooks/useAccountsData';
import { todayInAppTz } from '@/lib/timeFormat';
import { loadAccountStates, getAccountState, type AccountExecutionEntry } from '@/lib/accountExecutionState';
import { getRecentEvents, type AccountTimelineEvent } from '@/lib/accountTimeline';
import { getPostActionRecommendation, type PostActionRecommendation } from '@/lib/accountPostAction';
import { isAccountExecutionModelEnabled } from '@/lib/featureFlags';
import type { AccountWorkingSummary, OpportunityContext } from '@/lib/accountWorkingSummary';

export interface AccountWorkingView extends AccountWorkingSummary {
  recentEvents: AccountTimelineEvent[];
  postActionRec: PostActionRecommendation | null;
}

/**
 * Get a single account's full working view by ID.
 */
export function useAccountWorkingView(accountId: string | null): {
  data: AccountWorkingView | null;
  isLoading: boolean;
} {
  const { data: accounts, isLoading: accLoading } = useDbAccounts();
  const { data: opps, isLoading: oppLoading } = useDbOpportunities();

  const view = useMemo(() => {
    if (!accountId || !accounts) return null;
    const today = todayInAppTz();
    const acct = accounts.find(a => a.id === accountId);
    if (!acct) return null;

    const accountOpps: OpportunityContext[] = (opps || [])
      .filter(o => o.account_id === accountId)
      .map(o => ({
        opportunityId: o.id,
        opportunityName: o.name,
        stage: o.stage,
        status: o.status,
        arr: o.arr,
        closeDate: o.close_date,
        nextStep: o.next_step,
        dealType: o.deal_type,
        isNewLogo: o.is_new_logo || false,
      }));

    const activeOpps = accountOpps.filter(o => o.status === 'active');
    const primaryOpp = activeOpps[0] || accountOpps[0] || null;

    const execState = isAccountExecutionModelEnabled()
      ? getAccountState(today, accountId)
      : null;

    const summary: AccountWorkingSummary = {
      accountId: acct.id,
      accountName: acct.name,
      industry: acct.industry,
      tier: acct.tier,
      motion: acct.motion,
      website: acct.website,
      prepStatus: execState?.prepStatus || 'not_prepped',
      actionStatus: execState?.actionStatus || 'not_worked',
      nextRecommendedAction: execState?.nextRecommendedAction || 'prep_needed',
      latestOutcome: execState?.lastOutcomeType || null,
      callAttemptCount: execState?.callAttemptCount || 0,
      connectCount: execState?.connectCount || 0,
      carryForward: execState?.carryForward || false,
      carryForwardReason: execState?.carryForwardReason || null,
      loopId: execState?.loopId || null,
      loopDate: today,
      hasOpportunity: accountOpps.length > 0,
      opportunities: accountOpps,
      primaryOpportunity: primaryOpp,
      lastTouchDate: acct.last_touch_date,
      lastTouchType: acct.last_touch_type,
      touchesThisWeek: acct.touches_this_week || 0,
      outreachStatus: acct.outreach_status,
      tags: acct.tags || [],
      priorityScore: acct.priority_score,
      icpFitScore: acct.icp_fit_score,
      sourceOfTruth: execState ? 'account_execution' : 'crm_only',
      updatedAt: execState?.updatedAt || acct.updated_at,
    };

    const recentEvents = getRecentEvents(accountId, 5);
    const postActionRec = execState ? getPostActionRecommendation(execState, summary) : null;

    return { ...summary, recentEvents, postActionRec };
  }, [accountId, accounts, opps]);

  return { data: view, isLoading: accLoading || oppLoading };
}

/**
 * Get all accounts with execution state for today, as working views.
 */
export function useAllAccountWorkingViews(): {
  data: AccountWorkingView[];
  isLoading: boolean;
} {
  const { data: accounts, isLoading: accLoading } = useDbAccounts();
  const { data: opps, isLoading: oppLoading } = useDbOpportunities();

  const views = useMemo(() => {
    if (!accounts) return [];
    const today = todayInAppTz();
    const execStates = isAccountExecutionModelEnabled() ? loadAccountStates(today) : [];
    const execMap = new Map<string, AccountExecutionEntry>();
    for (const s of execStates) {
      // Keep last entry per account
      execMap.set(s.accountId, s);
    }

    if (execMap.size === 0) return [];

    return Array.from(execMap.values()).map(exec => {
      const acct = accounts.find(a => a.id === exec.accountId);
      const accountOpps: OpportunityContext[] = (opps || [])
        .filter(o => o.account_id === exec.accountId)
        .map(o => ({
          opportunityId: o.id,
          opportunityName: o.name,
          stage: o.stage,
          status: o.status,
          arr: o.arr,
          closeDate: o.close_date,
          nextStep: o.next_step,
          dealType: o.deal_type,
          isNewLogo: o.is_new_logo || false,
        }));

      const activeOpps = accountOpps.filter(o => o.status === 'active');
      const primaryOpp = activeOpps[0] || accountOpps[0] || null;

      const summary: AccountWorkingSummary = {
        accountId: exec.accountId,
        accountName: acct?.name || exec.accountName,
        industry: acct?.industry || null,
        tier: acct?.tier || null,
        motion: acct?.motion || null,
        website: acct?.website || null,
        prepStatus: exec.prepStatus,
        actionStatus: exec.actionStatus,
        nextRecommendedAction: exec.nextRecommendedAction,
        latestOutcome: exec.lastOutcomeType,
        callAttemptCount: exec.callAttemptCount,
        connectCount: exec.connectCount,
        carryForward: exec.carryForward,
        carryForwardReason: exec.carryForwardReason,
        loopId: exec.loopId,
        loopDate: today,
        hasOpportunity: accountOpps.length > 0,
        opportunities: accountOpps,
        primaryOpportunity: primaryOpp,
        lastTouchDate: acct?.last_touch_date || null,
        lastTouchType: acct?.last_touch_type || null,
        touchesThisWeek: acct?.touches_this_week || 0,
        outreachStatus: acct?.outreach_status || null,
        tags: acct?.tags || [],
        priorityScore: acct?.priority_score || null,
        icpFitScore: acct?.icp_fit_score || null,
        sourceOfTruth: 'account_execution',
        updatedAt: exec.updatedAt,
      };

      const recentEvents = getRecentEvents(exec.accountId, 5);
      const postActionRec = getPostActionRecommendation(exec, summary);

      return { ...summary, recentEvents, postActionRec };
    });
  }, [accounts, opps]);

  return { data: views, isLoading: accLoading || oppLoading };
}
