// Sales Age & Quota Pace Index (QPI) Calculation Engine
// WHOOP-like "Sales Age" derived from activity pace vs quota-required pace

import { 
  differenceInBusinessDays, 
  addDays, 
  subDays,
  startOfWeek,
  endOfWeek,
  format,
  parseISO,
  isAfter,
  isBefore,
  startOfMonth,
  startOfQuarter,
} from 'date-fns';

// Types
export interface QuotaTargets {
  fiscalYearStart: string;
  fiscalYearEnd: string;
  newArrQuota: number;
  renewalArrQuota: number;
  newArrAcr: number;
  renewalArrAcr: number;
  targetDialsPerDay: number;
  targetConnectsPerDay: number;
  targetMeetingsSetPerWeek: number;
  targetOppsCreatedPerWeek: number;
  targetCustomerMeetingsPerWeek: number;
  targetAccountsResearchedPerDay: number;
  targetContactsPreppedPerDay: number;
  qpiNewLogoWeight: number;
  qpiRenewalWeight: number;
}

export interface DailyMetrics {
  date: string;
  dials: number;
  conversations: number;
  meetingsSet: number;
  opportunitiesCreated: number;
  customerMeetingsHeld: number;
  accountsResearched: number;
  contactsPrepped: number;
  prospectsAdded: number;
}

export interface DriverContribution {
  name: string;
  key: string;
  value: number;
  target: number;
  normalizedScore: number;
  contribution: number;
  direction: 'up' | 'down' | 'stable';
  priorValue: number;
}

export interface QPIResult {
  qpiNewLogo: number;
  qpiRenewal: number;
  qpiCombined: number;
  drivers: DriverContribution[];
}

export interface SalesAgeResult {
  salesAge: number;
  paceOfAging: number;
  status: 'improving' | 'stable' | 'declining';
  qpi: QPIResult;
  benchmark30d: number;
  benchmark6m: number;
  projectedFinish30d: number;
  projectedFinish6m: number;
  requiredPerWeek: {
    newArr: number;
    renewalArr: number;
  };
  paceStatus: {
    newArr: 'ahead' | 'on-track' | 'behind';
    renewalArr: 'ahead' | 'on-track' | 'behind';
  };
}

export interface PaceToQuota {
  newArr: {
    closed: number;
    quota: number;
    attainment: number;
    paceExpected: number;
    paceDelta: number;
    neededPerWeek: number;
    status: 'ahead' | 'on-track' | 'behind';
  };
  renewalArr: {
    closed: number;
    quota: number;
    attainment: number;
    paceExpected: number;
    paceDelta: number;
    neededPerWeek: number;
    status: 'ahead' | 'on-track' | 'behind';
  };
  bizDaysElapsed: number;
  bizDaysTotal: number;
  bizDaysRemaining: number;
  weeksRemaining: number;
}

export interface ActionRecommendation {
  id: string;
  action: string;
  target: string;
  timeframe: string;
  workflow: 'power-hour' | 'tasks' | 'renewals' | 'outreach';
  why: string;
  impact: string;
  qpiImpact: number;
  priority: number;
}

// Default quota targets
export const DEFAULT_QUOTA_TARGETS: QuotaTargets = {
  fiscalYearStart: '2026-07-01',
  fiscalYearEnd: '2026-12-31',
  newArrQuota: 500000,
  renewalArrQuota: 822542,
  newArrAcr: 0.0773,
  renewalArrAcr: 0.0157,
  targetDialsPerDay: 60,
  targetConnectsPerDay: 6,
  targetMeetingsSetPerWeek: 3,
  targetOppsCreatedPerWeek: 1,
  targetCustomerMeetingsPerWeek: 8,
  targetAccountsResearchedPerDay: 3,
  targetContactsPreppedPerDay: 5,
  qpiNewLogoWeight: 0.60,
  qpiRenewalWeight: 0.40,
};

/**
 * Calculate business days between two dates (Mon-Fri)
 */
export function getBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  
  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

/**
 * Normalize a value vs target, clamped between 0 and 1.5
 */
function normalize(value: number, target: number): number {
  if (target === 0) return value > 0 ? 1.5 : 0;
  return Math.min(1.5, Math.max(0, value / target));
}

/**
 * Calculate required daily/weekly targets based on quota-required pace
 * Uses historical conversion ratios when available
 */
export function calculateRequiredTargets(
  targets: QuotaTargets,
  historicalMetrics: DailyMetrics[],
  closedWonNewArr: number,
  closedWonRenewalArr: number
): {
  requiredDials: number;
  requiredConnects: number;
  requiredMeetingsSet: number;
  requiredNewOpps: number;
  requiredCustomerMeetings: number;
  requiredAccountsResearched: number;
  requiredContactsPrepped: number;
} {
  const now = new Date();
  const fyStart = parseISO(targets.fiscalYearStart);
  const fyEnd = parseISO(targets.fiscalYearEnd);
  
  const bizDaysTotal = getBusinessDays(fyStart, fyEnd);
  const bizDaysRemaining = getBusinessDays(now, fyEnd);
  const weeksRemaining = Math.max(1, bizDaysRemaining / 5);
  
  // Remaining quota
  const newArrRemaining = Math.max(0, targets.newArrQuota - closedWonNewArr);
  const renewalArrRemaining = Math.max(0, targets.renewalArrQuota - closedWonRenewalArr);
  
  // Calculate historical conversion ratios from 6M data
  let dialToConnectRatio = 0.10; // 10% default
  let connectToMeetingRatio = 0.33; // 33% default
  let meetingToOppRatio = 0.33; // 33% default
  let oppToCloseRatio = 0.25; // 25% default
  let avgDealSize = 50000; // $50k default
  
  if (historicalMetrics.length >= 30) {
    const totalDials = historicalMetrics.reduce((s, m) => s + m.dials, 0);
    const totalConnects = historicalMetrics.reduce((s, m) => s + m.conversations, 0);
    const totalMeetings = historicalMetrics.reduce((s, m) => s + m.meetingsSet, 0);
    const totalOpps = historicalMetrics.reduce((s, m) => s + m.opportunitiesCreated, 0);
    
    if (totalDials > 0) dialToConnectRatio = totalConnects / totalDials;
    if (totalConnects > 0) connectToMeetingRatio = totalMeetings / totalConnects;
    if (totalMeetings > 0) meetingToOppRatio = totalOpps / totalMeetings;
  }
  
  // Work backwards from quota to required activities
  const newOppsNeededPerWeek = (newArrRemaining / avgDealSize / oppToCloseRatio) / weeksRemaining;
  const meetingsNeededPerWeek = newOppsNeededPerWeek / meetingToOppRatio;
  const connectsNeededPerDay = (meetingsNeededPerWeek / connectToMeetingRatio) / 5;
  const dialsNeededPerDay = connectsNeededPerDay / dialToConnectRatio;
  
  return {
    requiredDials: Math.max(targets.targetDialsPerDay, dialsNeededPerDay),
    requiredConnects: Math.max(targets.targetConnectsPerDay, connectsNeededPerDay),
    requiredMeetingsSet: Math.max(targets.targetMeetingsSetPerWeek, meetingsNeededPerWeek) / 5,
    requiredNewOpps: Math.max(targets.targetOppsCreatedPerWeek, newOppsNeededPerWeek) / 5,
    requiredCustomerMeetings: targets.targetCustomerMeetingsPerWeek / 5,
    requiredAccountsResearched: targets.targetAccountsResearchedPerDay,
    requiredContactsPrepped: targets.targetContactsPreppedPerDay,
  };
}

/**
 * Calculate QPI (Quota Pace Index) from daily check-in metrics
 */
export function calculateQPI(
  recentMetrics: DailyMetrics[],
  priorMetrics: DailyMetrics[],
  targets: QuotaTargets,
  closedWonNewArr: number,
  closedWonRenewalArr: number
): QPIResult {
  if (recentMetrics.length === 0) {
    return {
      qpiNewLogo: 0,
      qpiRenewal: 0,
      qpiCombined: 0,
      drivers: [],
    };
  }
  
  const allMetrics = [...recentMetrics, ...priorMetrics];
  const required = calculateRequiredTargets(targets, allMetrics, closedWonNewArr, closedWonRenewalArr);
  
  // Calculate averages from recent period
  const days = recentMetrics.length;
  const avgDials = recentMetrics.reduce((s, m) => s + m.dials, 0) / days;
  const avgConnects = recentMetrics.reduce((s, m) => s + m.conversations, 0) / days;
  const avgMeetingsSet = recentMetrics.reduce((s, m) => s + m.meetingsSet, 0) / days;
  const avgOppsCreated = recentMetrics.reduce((s, m) => s + m.opportunitiesCreated, 0) / days;
  const avgCustomerMeetings = recentMetrics.reduce((s, m) => s + m.customerMeetingsHeld, 0) / days;
  const avgAccountsResearched = recentMetrics.reduce((s, m) => s + m.accountsResearched, 0) / days;
  const avgContactsPrepped = recentMetrics.reduce((s, m) => s + m.contactsPrepped, 0) / days;
  
  // Calculate prior averages for direction
  const priorDays = priorMetrics.length || 1;
  const priorAvgDials = priorMetrics.length > 0 ? priorMetrics.reduce((s, m) => s + m.dials, 0) / priorDays : avgDials;
  const priorAvgConnects = priorMetrics.length > 0 ? priorMetrics.reduce((s, m) => s + m.conversations, 0) / priorDays : avgConnects;
  const priorAvgMeetingsSet = priorMetrics.length > 0 ? priorMetrics.reduce((s, m) => s + m.meetingsSet, 0) / priorDays : avgMeetingsSet;
  const priorAvgOppsCreated = priorMetrics.length > 0 ? priorMetrics.reduce((s, m) => s + m.opportunitiesCreated, 0) / priorDays : avgOppsCreated;
  const priorAvgCustomerMeetings = priorMetrics.length > 0 ? priorMetrics.reduce((s, m) => s + m.customerMeetingsHeld, 0) / priorDays : avgCustomerMeetings;
  const priorAvgAccountsResearched = priorMetrics.length > 0 ? priorMetrics.reduce((s, m) => s + m.accountsResearched, 0) / priorDays : avgAccountsResearched;
  const priorAvgContactsPrepped = priorMetrics.length > 0 ? priorMetrics.reduce((s, m) => s + m.contactsPrepped, 0) / priorDays : avgContactsPrepped;
  
  // Helper to determine direction
  const getDirection = (current: number, prior: number): 'up' | 'down' | 'stable' => {
    const delta = current - prior;
    if (Math.abs(delta) < 0.1 * prior) return 'stable';
    return delta > 0 ? 'up' : 'down';
  };
  
  // Normalize each driver
  const normDials = normalize(avgDials, required.requiredDials);
  const normConnects = normalize(avgConnects, required.requiredConnects);
  const normMeetingsSet = normalize(avgMeetingsSet, required.requiredMeetingsSet);
  const normOppsCreated = normalize(avgOppsCreated, required.requiredNewOpps);
  const normCustomerMeetings = normalize(avgCustomerMeetings, required.requiredCustomerMeetings);
  const normAccountsResearched = normalize(avgAccountsResearched, required.requiredAccountsResearched);
  const normContactsPrepped = normalize(avgContactsPrepped, required.requiredContactsPrepped);
  
  // New Logo Pace Score (weighted)
  const newLogoPaceScore = 
    0.25 * normDials +
    0.25 * normConnects +
    0.20 * normMeetingsSet +
    0.20 * normOppsCreated +
    0.05 * normAccountsResearched +
    0.05 * normContactsPrepped;
  
  // Renewal Pace Score (weighted)
  const renewalPaceScore = 
    0.40 * normCustomerMeetings +
    0.25 * normConnects +
    0.15 * normAccountsResearched +
    0.10 * normContactsPrepped +
    0.10 * normMeetingsSet;
  
  // Combined QPI
  const qpiCombined = 
    targets.qpiNewLogoWeight * newLogoPaceScore +
    targets.qpiRenewalWeight * renewalPaceScore;
  
  // Build drivers array with contributions
  const drivers: DriverContribution[] = [
    {
      name: 'Dials',
      key: 'dials',
      value: avgDials,
      target: required.requiredDials,
      normalizedScore: normDials,
      contribution: 0.25 * normDials * targets.qpiNewLogoWeight,
      direction: getDirection(avgDials, priorAvgDials),
      priorValue: priorAvgDials,
    },
    {
      name: 'Connects',
      key: 'connects',
      value: avgConnects,
      target: required.requiredConnects,
      normalizedScore: normConnects,
      contribution: (0.25 * targets.qpiNewLogoWeight + 0.25 * targets.qpiRenewalWeight) * normConnects,
      direction: getDirection(avgConnects, priorAvgConnects),
      priorValue: priorAvgConnects,
    },
    {
      name: 'Meetings Set',
      key: 'meetingsSet',
      value: avgMeetingsSet,
      target: required.requiredMeetingsSet,
      normalizedScore: normMeetingsSet,
      contribution: (0.20 * targets.qpiNewLogoWeight + 0.10 * targets.qpiRenewalWeight) * normMeetingsSet,
      direction: getDirection(avgMeetingsSet, priorAvgMeetingsSet),
      priorValue: priorAvgMeetingsSet,
    },
    {
      name: 'Opps Created',
      key: 'oppsCreated',
      value: avgOppsCreated,
      target: required.requiredNewOpps,
      normalizedScore: normOppsCreated,
      contribution: 0.20 * normOppsCreated * targets.qpiNewLogoWeight,
      direction: getDirection(avgOppsCreated, priorAvgOppsCreated),
      priorValue: priorAvgOppsCreated,
    },
    {
      name: 'Customer Meetings',
      key: 'customerMeetings',
      value: avgCustomerMeetings,
      target: required.requiredCustomerMeetings,
      normalizedScore: normCustomerMeetings,
      contribution: 0.40 * normCustomerMeetings * targets.qpiRenewalWeight,
      direction: getDirection(avgCustomerMeetings, priorAvgCustomerMeetings),
      priorValue: priorAvgCustomerMeetings,
    },
    {
      name: 'Accounts Researched',
      key: 'accountsResearched',
      value: avgAccountsResearched,
      target: required.requiredAccountsResearched,
      normalizedScore: normAccountsResearched,
      contribution: (0.05 * targets.qpiNewLogoWeight + 0.15 * targets.qpiRenewalWeight) * normAccountsResearched,
      direction: getDirection(avgAccountsResearched, priorAvgAccountsResearched),
      priorValue: priorAvgAccountsResearched,
    },
    {
      name: 'Contacts Prepped',
      key: 'contactsPrepped',
      value: avgContactsPrepped,
      target: required.requiredContactsPrepped,
      normalizedScore: normContactsPrepped,
      contribution: (0.05 * targets.qpiNewLogoWeight + 0.10 * targets.qpiRenewalWeight) * normContactsPrepped,
      direction: getDirection(avgContactsPrepped, priorAvgContactsPrepped),
      priorValue: priorAvgContactsPrepped,
    },
  ];
  
  // Sort by contribution descending
  drivers.sort((a, b) => b.contribution - a.contribution);
  
  return {
    qpiNewLogo: newLogoPaceScore,
    qpiRenewal: renewalPaceScore,
    qpiCombined,
    drivers,
  };
}

/**
 * Calculate Sales Age from QPI
 * Lower is better (like WHOOP body age)
 */
export function calculateSalesAge(qpi: number): number {
  // At QPI = 1.0 (on pace), Sales Age = 45
  // At QPI > 1.0 (ahead), Sales Age < 45 (younger)
  // At QPI < 1.0 (behind), Sales Age > 45 (older)
  if (qpi <= 0) return 99;
  return Math.round(45 / qpi);
}

/**
 * Calculate Pace to Quota metrics
 */
export function calculatePaceToQuota(
  closedWonNewArr: number,
  closedWonRenewalArr: number,
  targets: QuotaTargets
): PaceToQuota {
  const now = new Date();
  const fyStart = parseISO(targets.fiscalYearStart);
  const fyEnd = parseISO(targets.fiscalYearEnd);
  
  const bizDaysTotal = getBusinessDays(fyStart, fyEnd);
  const bizDaysElapsed = getBusinessDays(fyStart, now);
  const bizDaysRemaining = Math.max(1, getBusinessDays(now, fyEnd));
  const weeksRemaining = bizDaysRemaining / 5;
  
  // Expected pace
  const paceRatio = bizDaysElapsed / bizDaysTotal;
  const newArrExpected = targets.newArrQuota * paceRatio;
  const renewalArrExpected = targets.renewalArrQuota * paceRatio;
  
  // Deltas
  const newArrDelta = closedWonNewArr - newArrExpected;
  const renewalArrDelta = closedWonRenewalArr - renewalArrExpected;
  
  // Needed per week
  const newArrRemaining = Math.max(0, targets.newArrQuota - closedWonNewArr);
  const renewalArrRemaining = Math.max(0, targets.renewalArrQuota - closedWonRenewalArr);
  const newArrPerWeek = newArrRemaining / weeksRemaining;
  const renewalArrPerWeek = renewalArrRemaining / weeksRemaining;
  
  // Status
  const getStatus = (delta: number, quota: number): 'ahead' | 'on-track' | 'behind' => {
    const threshold = quota * 0.05; // 5% tolerance
    if (delta > threshold) return 'ahead';
    if (delta < -threshold) return 'behind';
    return 'on-track';
  };
  
  return {
    newArr: {
      closed: closedWonNewArr,
      quota: targets.newArrQuota,
      attainment: targets.newArrQuota > 0 ? closedWonNewArr / targets.newArrQuota : 0,
      paceExpected: newArrExpected,
      paceDelta: newArrDelta,
      neededPerWeek: newArrPerWeek,
      status: getStatus(newArrDelta, targets.newArrQuota),
    },
    renewalArr: {
      closed: closedWonRenewalArr,
      quota: targets.renewalArrQuota,
      attainment: targets.renewalArrQuota > 0 ? closedWonRenewalArr / targets.renewalArrQuota : 0,
      paceExpected: renewalArrExpected,
      paceDelta: renewalArrDelta,
      neededPerWeek: renewalArrPerWeek,
      status: getStatus(renewalArrDelta, targets.renewalArrQuota),
    },
    bizDaysElapsed,
    bizDaysTotal,
    bizDaysRemaining,
    weeksRemaining,
  };
}

/**
 * Generate actionable recommendations based on drivers and pace
 */
export function generateRecommendations(
  qpi: QPIResult,
  paceToQuota: PaceToQuota,
  oppsNext45Days: number,
  renewalsNext45Days: number,
  targets: QuotaTargets
): ActionRecommendation[] {
  const recommendations: ActionRecommendation[] = [];
  
  // Find lowest performing drivers
  const underperformingDrivers = qpi.drivers.filter(d => d.normalizedScore < 1.0);
  
  // Priority 1: Address biggest pace gaps
  if (paceToQuota.newArr.status === 'behind') {
    const gapPerWeek = Math.abs(paceToQuota.newArr.paceDelta) / paceToQuota.weeksRemaining;
    const dialsDriver = qpi.drivers.find(d => d.key === 'dials');
    
    if (dialsDriver && dialsDriver.normalizedScore < 1.0) {
      const additionalDials = Math.ceil((dialsDriver.target - dialsDriver.value) * 5);
      recommendations.push({
        id: 'increase-dials',
        action: `Add 2 Power Hours this week`,
        target: `+${additionalDials} dials, +${Math.ceil(additionalDials * 0.1)} connects`,
        timeframe: 'Next 7 days',
        workflow: 'power-hour',
        why: `Dials are ${Math.round((1 - dialsDriver.normalizedScore) * 100)}% below quota-required pace`,
        impact: `Improves QPI by ~${(0.25 * targets.qpiNewLogoWeight * 0.3).toFixed(2)}, closes gap by ~$${Math.round(gapPerWeek * 0.1).toLocaleString()}/week`,
        qpiImpact: 0.08,
        priority: 1,
      });
    }
  }
  
  // Priority 2: Meetings set gap
  const meetingsDriver = qpi.drivers.find(d => d.key === 'meetingsSet');
  if (meetingsDriver && meetingsDriver.normalizedScore < 0.8) {
    recommendations.push({
      id: 'increase-meetings',
      action: 'Focus on meeting conversion from connects',
      target: `+${Math.ceil(meetingsDriver.target * 5 - meetingsDriver.value * 5)} meetings this week`,
      timeframe: 'Next 7 days',
      workflow: 'outreach',
      why: `Meeting set rate is ${Math.round((1 - meetingsDriver.normalizedScore) * 100)}% below target`,
      impact: `Each meeting = ~$${Math.round(targets.newArrQuota / 40 / 4).toLocaleString()} pipeline potential`,
      qpiImpact: 0.06,
      priority: 2,
    });
  }
  
  // Priority 3: Customer meetings for renewals
  if (paceToQuota.renewalArr.status === 'behind') {
    const customerMeetingsDriver = qpi.drivers.find(d => d.key === 'customerMeetings');
    if (customerMeetingsDriver && customerMeetingsDriver.normalizedScore < 1.0) {
      recommendations.push({
        id: 'customer-meetings',
        action: 'Schedule customer check-ins for renewals',
        target: `+${Math.ceil(customerMeetingsDriver.target * 5 - customerMeetingsDriver.value * 5)} customer meetings this week`,
        timeframe: 'Next 7 days',
        workflow: 'renewals',
        why: `Customer meetings are ${Math.round((1 - customerMeetingsDriver.normalizedScore) * 100)}% below renewal-required pace`,
        impact: `Protects ${Math.round(paceToQuota.renewalArr.neededPerWeek).toLocaleString()} renewal ARR/week`,
        qpiImpact: 0.12,
        priority: 2,
      });
    }
  }
  
  // Priority 4: Next 45 days risk
  if (oppsNext45Days > 0 || renewalsNext45Days > 0) {
    if (oppsNext45Days > 0) {
      recommendations.push({
        id: 'next-steps-opps',
        action: 'Update next steps on close-date opps',
        target: `Review and update ${oppsNext45Days} opportunities closing in 45 days`,
        timeframe: 'Next 7 days',
        workflow: 'tasks',
        why: `${oppsNext45Days} deals need active next steps to close on time`,
        impact: 'Prevents slippage, maintains pipeline velocity',
        qpiImpact: 0.02,
        priority: 3,
      });
    }
    
    if (renewalsNext45Days > 0) {
      recommendations.push({
        id: 'next-steps-renewals',
        action: 'Schedule renewal calls for upcoming renewals',
        target: `Touch ${renewalsNext45Days} renewals due in 45 days`,
        timeframe: 'Next 7 days',
        workflow: 'renewals',
        why: `${renewalsNext45Days} renewals need attention before due date`,
        impact: 'Protects baseline ARR, prevents churn',
        qpiImpact: 0.03,
        priority: 3,
      });
    }
  }
  
  // Sort by priority and return top 3
  recommendations.sort((a, b) => a.priority - b.priority);
  return recommendations.slice(0, 3);
}

/**
 * Get the current week's Sunday for snapshot purposes
 */
export function getCurrentWeekEnding(): string {
  const now = new Date();
  const endOfCurrentWeek = endOfWeek(now, { weekStartsOn: 1 }); // Monday start
  return format(endOfCurrentWeek, 'yyyy-MM-dd');
}

/**
 * Calculate full Sales Age result
 */
export function calculateSalesAgeResult(
  metrics30d: DailyMetrics[],
  metrics6m: DailyMetrics[],
  priorMetrics: DailyMetrics[],
  closedWonNewArr: number,
  closedWonRenewalArr: number,
  targets: QuotaTargets,
  priorSnapshot?: { salesAge: number; qpiCombined: number }
): SalesAgeResult {
  // Calculate QPI for 30D window
  const qpi30d = calculateQPI(metrics30d, priorMetrics, targets, closedWonNewArr, closedWonRenewalArr);
  
  // Calculate QPI for 6M window
  const qpi6m = calculateQPI(metrics6m, [], targets, closedWonNewArr, closedWonRenewalArr);
  
  // Use 30D as primary QPI
  const salesAge = calculateSalesAge(qpi30d.qpiCombined);
  
  // Pace of aging (weekly change)
  const paceOfAging = priorSnapshot 
    ? salesAge - priorSnapshot.salesAge 
    : 0;
  
  // Status
  let status: 'improving' | 'stable' | 'declining' = 'stable';
  if (paceOfAging < -2) status = 'improving';
  else if (paceOfAging > 2) status = 'declining';
  
  // Pace to quota
  const paceToQuota = calculatePaceToQuota(closedWonNewArr, closedWonRenewalArr, targets);
  
  // Projections
  const projectedFinish30d = qpi30d.qpiCombined > 0 
    ? Math.min(200, qpi30d.qpiCombined * 100) 
    : 0;
  const projectedFinish6m = qpi6m.qpiCombined > 0 
    ? Math.min(200, qpi6m.qpiCombined * 100) 
    : 0;
  
  return {
    salesAge,
    paceOfAging,
    status,
    qpi: qpi30d,
    benchmark30d: qpi30d.qpiCombined,
    benchmark6m: qpi6m.qpiCombined,
    projectedFinish30d,
    projectedFinish6m,
    requiredPerWeek: {
      newArr: paceToQuota.newArr.neededPerWeek,
      renewalArr: paceToQuota.renewalArr.neededPerWeek,
    },
    paceStatus: {
      newArr: paceToQuota.newArr.status,
      renewalArr: paceToQuota.renewalArr.status,
    },
  };
}
