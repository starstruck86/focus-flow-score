// Commission Pacing Hook - Projected earnings and pace tracking
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { 
  calculateCommissionSummary, 
  calculateRequiredWeeklyRate,
  DEFAULT_QUOTA_CONFIG,
} from '@/lib/commissionCalculations';
import { 
  getCapacityAdjustedTarget,
  DEFAULT_CAPACITY_SETTINGS,
  getTemplateById,
  calculateWeeklyExpectations,
} from '@/lib/goodDayModel';
import { useQuotaTargets } from '@/hooks/useSalesAge';
import { useRollingAverages, useWeekToDateMetrics } from '@/hooks/useGoodDayMetrics';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';
import { format, subDays, differenceInWeeks } from 'date-fns';

export interface CommissionPacingData {
  // Current state
  currentCommission: number;
  projectedQuarterCommission: number;
  projectedAttainment: number;
  
  // Trends
  weeklyPaceTrend: number;
  status: 'improving' | 'stable' | 'declining';
  
  // Benchmarks
  pace30d: number;
  pace6m: number;
  paceRequired: number;
  
  // Drivers
  drivers: Array<{
    name: string;
    trend: 'up' | 'down' | 'stable';
    impact: number;
    current: number;
    target: number;
  }>;
  
  // Sensitivity
  sensitivityAnalysis: Array<{
    lever: string;
    increment: number;
    unit: string;
    commissionImpact: number;
  }>;
  
  // Action Plan
  actionPlan: Array<{
    action: string;
    target: string;
    timeframe: string;
    workflow: string;
    impact: string;
  }>;
}

export function useCommissionPacing(): {
  data: CommissionPacingData | null;
  isLoading: boolean;
} {
  const { opportunities, quotaConfig } = useStore();
  const { data: quotaTargets } = useQuotaTargets();
  const { data: rollingAvgs, isLoading: rollingLoading } = useRollingAverages();
  const { data: wtdMetrics, isLoading: wtdLoading } = useWeekToDateMetrics();
  
  const today = new Date();
  const effectiveConfig = quotaConfig || DEFAULT_QUOTA_CONFIG;
  const effectiveTargets = quotaTargets || DEFAULT_QUOTA_TARGETS;
  
  // Calculate current commission
  const fyStart = effectiveTargets.fiscalYearStart;
  const fyEnd = effectiveTargets.fiscalYearEnd;
  const dateFilter = {
    start: fyStart,
    end: format(today, 'yyyy-MM-dd'),
  };
  
  const commissionSummary = calculateCommissionSummary(opportunities, {
    ...effectiveConfig,
    newArrQuota: effectiveTargets.newArrQuota,
    renewalArrQuota: effectiveTargets.renewalArrQuota,
  }, dateFilter);
  
  // Calculate weeks remaining and pace
  const endDate = new Date(fyEnd);
  const weeksRemaining = Math.max(1, differenceInWeeks(endDate, today));
  const totalWeeks = differenceInWeeks(endDate, new Date(fyStart));
  const weeksElapsed = totalWeeks - weeksRemaining;
  
  // Required weekly pace to hit 100%
  const totalQuota = effectiveTargets.newArrQuota + effectiveTargets.renewalArrQuota;
  const totalClosed = commissionSummary.newArrBooked + commissionSummary.renewalArrBooked;
  const remaining = Math.max(0, totalQuota - totalClosed);
  const paceRequired = remaining / weeksRemaining;
  
  // Calculate weekly commission pace from activity
  const avgDealSize = totalClosed > 0 && weeksElapsed > 0 
    ? totalClosed / weeksElapsed 
    : 25000; // Default assumption
  
  // Use rolling averages to estimate pace
  const pace30d = rollingAvgs?.avg30d 
    ? estimateWeeklyCommissionFromActivity(rollingAvgs.avg30d, effectiveConfig)
    : 0;
  
  const pace6m = rollingAvgs?.avg6m 
    ? estimateWeeklyCommissionFromActivity(rollingAvgs.avg6m, effectiveConfig)
    : 0;
  
  // Projected commission = current + (best pace * weeks remaining)
  const bestPace = Math.max(pace30d, pace6m);
  const projectedNewClosings = bestPace * weeksRemaining;
  const projectedQuarterCommission = commissionSummary.totalCommission + 
    (projectedNewClosings * effectiveConfig.newArrAcr);
  
  // Projected attainment
  const projectedAttainment = totalQuota > 0 
    ? (totalClosed + projectedNewClosings) / totalQuota 
    : 0;
  
  // Weekly pace trend (compare last 2 weeks)
  const weeklyPaceTrend = pace30d - pace6m;
  
  // Determine status
  let status: 'improving' | 'stable' | 'declining';
  if (weeklyPaceTrend > paceRequired * 0.05) {
    status = 'improving';
  } else if (weeklyPaceTrend < -paceRequired * 0.05) {
    status = 'declining';
  } else {
    status = 'stable';
  }
  
  // Build drivers
  const drivers = buildDrivers(
    rollingAvgs?.avg30d,
    rollingAvgs?.avg6m,
    effectiveTargets
  );
  
  // Build sensitivity analysis
  const sensitivityAnalysis = [
    {
      lever: 'Conversations',
      increment: 5,
      unit: 'per week',
      commissionImpact: 5 * 0.15 * avgDealSize * effectiveConfig.newArrAcr, // Rough estimate
    },
    {
      lever: 'Meetings Set',
      increment: 2,
      unit: 'per week',
      commissionImpact: 2 * 0.25 * avgDealSize * effectiveConfig.newArrAcr,
    },
    {
      lever: 'Opps Created',
      increment: 1,
      unit: 'per week',
      commissionImpact: 1 * 0.35 * avgDealSize * effectiveConfig.newArrAcr,
    },
  ];
  
  // Build action plan based on gaps
  const actionPlan = buildActionPlan(
    rollingAvgs?.avg30d,
    effectiveTargets,
    DEFAULT_CAPACITY_SETTINGS,
    rollingAvgs?.avg6m
  );
  
  const isLoading = rollingLoading || wtdLoading;
  
  return {
    data: {
      currentCommission: commissionSummary.totalCommission,
      projectedQuarterCommission,
      projectedAttainment,
      weeklyPaceTrend,
      status,
      pace30d,
      pace6m,
      paceRequired,
      drivers,
      sensitivityAnalysis,
      actionPlan,
    },
    isLoading,
  };
}

function estimateWeeklyCommissionFromActivity(
  avgDaily: { dials: number; conversations: number; meetingsSet: number; oppsCreated: number },
  config: typeof DEFAULT_QUOTA_CONFIG
): number {
  // Very rough conversion: conversations -> meetings -> opps -> ARR
  const conversionRate = 0.15; // conversations to meetings
  const meetingToOppRate = 0.25;
  const oppToCloseRate = 0.35;
  const avgDealSize = 25000;
  
  // Weekly = daily * 5
  const weeklyConvos = (avgDaily.conversations || 0) * 5;
  const weeklyMeetings = (avgDaily.meetingsSet || 0) * 5;
  const weeklyOpps = (avgDaily.oppsCreated || 0) * 5;
  
  // Estimate pipeline generation
  const estimatedOpps = weeklyOpps + (weeklyMeetings * meetingToOppRate) + (weeklyConvos * conversionRate * meetingToOppRate);
  const estimatedClosings = estimatedOpps * oppToCloseRate;
  const estimatedARR = estimatedClosings * avgDealSize;
  
  return estimatedARR;
}

function buildDrivers(
  avg30d: any,
  avg6m: any,
  targets: typeof DEFAULT_QUOTA_TARGETS
): CommissionPacingData['drivers'] {
  if (!avg30d) return [];
  
  const driverConfigs = [
    { name: 'Conversations', key: 'conversations', target: targets.targetConnectsPerDay },
    { name: 'Meetings Set', key: 'meetingsSet', target: targets.targetMeetingsSetPerWeek / 5 },
    { name: 'Opps Created', key: 'oppsCreated', target: targets.targetOppsCreatedPerWeek / 5 },
    { name: 'Dials', key: 'dials', target: targets.targetDialsPerDay },
  ];
  
  return driverConfigs.map(({ name, key, target }) => {
    const current = avg30d[key] || 0;
    const prior = avg6m?.[key] || current;
    const diff = current - prior;
    
    let trend: 'up' | 'down' | 'stable';
    if (diff > target * 0.1) trend = 'up';
    else if (diff < -target * 0.1) trend = 'down';
    else trend = 'stable';
    
    // Impact = rough estimate of weekly commission impact
    const impactMultiplier = name === 'Opps Created' ? 5000 : 
                             name === 'Meetings Set' ? 2000 : 
                             name === 'Conversations' ? 500 : 100;
    const impact = diff * impactMultiplier;
    
    return {
      name,
      trend,
      impact,
      current,
      target,
    };
  });
}

function buildActionPlan(
  avg30d: any,
  targets: typeof DEFAULT_QUOTA_TARGETS,
  capacity: typeof DEFAULT_CAPACITY_SETTINGS,
  avg6m: any
): CommissionPacingData['actionPlan'] {
  const actions: CommissionPacingData['actionPlan'] = [];
  
  if (!avg30d) {
    // No data, suggest starting basics
    actions.push({
      action: 'Complete daily check-ins to build baseline',
      target: '5 days of data',
      timeframe: 'This week',
      workflow: 'Daily Check-In',
      impact: 'Enable pacing insights',
    });
    return actions;
  }
  
  // Check conversations gap
  const convoGap = targets.targetConnectsPerDay - (avg30d.conversations || 0);
  if (convoGap > 0) {
    const adjustedTarget = getCapacityAdjustedTarget(
      Math.ceil(convoGap),
      avg30d.conversations || 0,
      avg6m?.conversations || 0,
      capacity
    );
    
    actions.push({
      action: 'Add Power Hour sessions',
      target: `+${Math.ceil(adjustedTarget)} conversations/day`,
      timeframe: 'Next 7 days',
      workflow: 'Power Hour',
      impact: `+$${Math.round(adjustedTarget * 500 * 5).toLocaleString()}/wk est.`,
    });
  }
  
  // Check meetings gap
  const meetingGap = (targets.targetMeetingsSetPerWeek / 5) - (avg30d.meetingsSet || 0);
  if (meetingGap > 0 && actions.length < 3) {
    actions.push({
      action: 'Focus on meeting conversion',
      target: `+${Math.ceil(meetingGap * 5)} meetings this week`,
      timeframe: 'Next 7 days',
      workflow: 'Outreach',
      impact: `+$${Math.round(meetingGap * 2000 * 5).toLocaleString()}/wk est.`,
    });
  }
  
  // Check opps gap
  const oppsGap = (targets.targetOppsCreatedPerWeek / 5) - (avg30d.oppsCreated || 0);
  if (oppsGap > 0 && actions.length < 3) {
    actions.push({
      action: 'Convert pipeline to opportunities',
      target: `+${Math.ceil(oppsGap * 5)} opps this week`,
      timeframe: 'Next 7 days',
      workflow: 'Pipeline',
      impact: `+$${Math.round(oppsGap * 5000 * 5).toLocaleString()}/wk est.`,
    });
  }
  
  // Always have at least one action
  if (actions.length === 0) {
    actions.push({
      action: 'Maintain current momentum',
      target: 'Keep activity levels steady',
      timeframe: 'Next 7 days',
      workflow: 'Daily Check-In',
      impact: 'Sustain pace',
    });
  }
  
  return actions.slice(0, 3);
}
