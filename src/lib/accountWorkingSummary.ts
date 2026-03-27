/**
 * Account Working Summary — Unified account-centric operating model
 *
 * The canonical shared object that all surfaces consume.
 * Account = primary execution object. Opportunity = state/context of that account.
 *
 * Feature-flagged via ENABLE_ACCOUNT_CENTRIC_EXECUTION.
 */

import { supabase } from '@/integrations/supabase/client';
import { todayInAppTz } from '@/lib/timeFormat';
import {
  loadAccountStates,
  getAccountState,
  buildExecutionSummary,
  type AccountExecutionEntry,
  type AccountReadiness,
  type OutcomeType,
  type PrepStatus,
  type ActionStatus,
} from '@/lib/accountExecutionState';
import { isAccountExecutionModelEnabled, isAccountCentricExecutionEnabled } from '@/lib/featureFlags';

// ── Core Model ─────────────────────────────────────────────

export interface OpportunityContext {
  opportunityId: string;
  opportunityName: string;
  stage: string | null;
  status: string | null;
  arr: number | null;
  closeDate: string | null;
  nextStep: string | null;
  dealType: string | null;
  isNewLogo: boolean;
}

export interface AccountWorkingSummary {
  // Identity
  accountId: string;
  accountName: string;
  industry: string | null;
  tier: string | null;
  motion: string | null;
  website: string | null;

  // Execution state (from account execution model)
  prepStatus: PrepStatus;
  actionStatus: ActionStatus;
  nextRecommendedAction: AccountReadiness;
  latestOutcome: OutcomeType;
  callAttemptCount: number;
  connectCount: number;
  carryForward: boolean;
  carryForwardReason: string | null;

  // Loop context
  loopId: string | null;
  loopDate: string;

  // Opportunity context (attached, not primary)
  hasOpportunity: boolean;
  opportunities: OpportunityContext[];
  primaryOpportunity: OpportunityContext | null;

  // Touch history
  lastTouchDate: string | null;
  lastTouchType: string | null;
  touchesThisWeek: number;

  // Account metadata
  outreachStatus: string | null;
  tags: string[];
  priorityScore: number | null;
  icpFitScore: number | null;

  // Source
  sourceOfTruth: 'account_execution' | 'crm_only' | 'heuristic';
  updatedAt: string;
}

// ── Builder ────────────────────────────────────────────────

export async function buildAccountWorkingSummary(
  userId: string,
  accountId: string,
  date?: string,
): Promise<AccountWorkingSummary | null> {
  const today = date || todayInAppTz();

  // Fetch account
  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!account) return null;

  // Fetch opportunities for this account
  const { data: opps } = await supabase
    .from('opportunities')
    .select('id, name, stage, status, arr, close_date, next_step, deal_type, is_new_logo')
    .eq('account_id', accountId)
    .eq('user_id', userId);

  const opportunities: OpportunityContext[] = (opps || []).map(o => ({
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

  // Get active opportunity as primary (most recent active)
  const activeOpps = opportunities.filter(o => o.status === 'active');
  const primaryOpp = activeOpps.length > 0 ? activeOpps[0] : (opportunities.length > 0 ? opportunities[0] : null);

  // Get execution state
  const execState = isAccountExecutionModelEnabled()
    ? getAccountState(today, accountId)
    : null;

  return {
    accountId: account.id,
    accountName: account.name,
    industry: account.industry,
    tier: account.tier,
    motion: account.motion,
    website: account.website,

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

    hasOpportunity: opportunities.length > 0,
    opportunities,
    primaryOpportunity: primaryOpp,

    lastTouchDate: account.last_touch_date,
    lastTouchType: account.last_touch_type,
    touchesThisWeek: account.touches_this_week || 0,

    outreachStatus: account.outreach_status,
    tags: account.tags || [],
    priorityScore: account.priority_score,
    icpFitScore: account.icp_fit_score,

    sourceOfTruth: execState ? 'account_execution' : 'crm_only',
    updatedAt: execState?.updatedAt || account.updated_at,
  };
}

/** Build summaries for all accounts with execution state today */
export async function buildAllWorkingSummaries(
  userId: string,
  date?: string,
): Promise<AccountWorkingSummary[]> {
  const today = date || todayInAppTz();
  const execStates = loadAccountStates(today);

  if (execStates.length === 0) return [];

  const accountIds = [...new Set(execStates.map(s => s.accountId))];
  const summaries: AccountWorkingSummary[] = [];

  // Batch fetch accounts
  const { data: accounts } = await supabase
    .from('accounts')
    .select('*')
    .in('id', accountIds)
    .eq('user_id', userId);

  // Batch fetch opportunities
  const { data: allOpps } = await supabase
    .from('opportunities')
    .select('id, name, stage, status, arr, close_date, next_step, deal_type, is_new_logo, account_id')
    .in('account_id', accountIds)
    .eq('user_id', userId);

  const oppsByAccount = new Map<string, OpportunityContext[]>();
  for (const o of allOpps || []) {
    const list = oppsByAccount.get(o.account_id!) || [];
    list.push({
      opportunityId: o.id,
      opportunityName: o.name,
      stage: o.stage,
      status: o.status,
      arr: o.arr,
      closeDate: o.close_date,
      nextStep: o.next_step,
      dealType: o.deal_type,
      isNewLogo: o.is_new_logo || false,
    });
    oppsByAccount.set(o.account_id!, list);
  }

  for (const acct of accounts || []) {
    const execState = getAccountState(today, acct.id);
    const opps = oppsByAccount.get(acct.id) || [];
    const activeOpps = opps.filter(o => o.status === 'active');
    const primaryOpp = activeOpps[0] || opps[0] || null;

    summaries.push({
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
      hasOpportunity: opps.length > 0,
      opportunities: opps,
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
    });
  }

  return summaries;
}

// ── Readiness Rollup ───────────────────────────────────────

export interface AccountReadinessRollup {
  readyToCall: number;
  prepNeeded: number;
  retryLater: number;
  followUpNextLoop: number;
  notActionableToday: number;
  carryForwardTomorrow: number;
  withOpportunity: number;
  withoutOpportunity: number;
  total: number;
}

export function buildReadinessRollup(summaries: AccountWorkingSummary[]): AccountReadinessRollup {
  return {
    readyToCall: summaries.filter(s => s.nextRecommendedAction === 'ready_to_call').length,
    prepNeeded: summaries.filter(s => s.nextRecommendedAction === 'prep_needed').length,
    retryLater: summaries.filter(s => s.nextRecommendedAction === 'retry_later').length,
    followUpNextLoop: summaries.filter(s => s.nextRecommendedAction === 'follow_up_next_loop').length,
    notActionableToday: summaries.filter(s => s.nextRecommendedAction === 'not_actionable_today').length,
    carryForwardTomorrow: summaries.filter(s => s.nextRecommendedAction === 'carry_forward_tomorrow').length,
    withOpportunity: summaries.filter(s => s.hasOpportunity).length,
    withoutOpportunity: summaries.filter(s => !s.hasOpportunity).length,
    total: summaries.length,
  };
}
