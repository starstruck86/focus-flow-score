// Cost of Delay Engine — calculates urgency decay and escalation for actions
// Used by PrimaryAction to weight candidates by what happens if delayed.

export interface DelayImpact {
  decayMultiplier: number;   // 1.0 = normal, >1 = urgent, <1 = can wait
  escalationLevel: 'critical' | 'high' | 'moderate' | 'low';
  delayConsequence: string;  // human-readable consequence
}

/**
 * Calculate cost-of-delay for an opportunity with no next step.
 */
export function oppNoNextStepDelay(arrK: number, daysSinceLastTouch: number): DelayImpact {
  // High-value deals with no next step decay fast
  const valueWeight = Math.min(arrK / 50, 3); // caps at 3x for $150k+
  const stalenessFactor = Math.min(daysSinceLastTouch / 7, 4); // caps at 4x after 28 days

  const decayMultiplier = 1 + (valueWeight * 0.3) + (stalenessFactor * 0.4);

  let escalationLevel: DelayImpact['escalationLevel'] = 'low';
  if (decayMultiplier >= 3) escalationLevel = 'critical';
  else if (decayMultiplier >= 2) escalationLevel = 'high';
  else if (decayMultiplier >= 1.5) escalationLevel = 'moderate';

  const delayConsequence = daysSinceLastTouch >= 14
    ? 'Deal going cold — champion may disengage'
    : daysSinceLastTouch >= 7
      ? 'Momentum loss — competitor may fill the gap'
      : 'Minor risk — but next step prevents drift';

  return { decayMultiplier, escalationLevel, delayConsequence };
}

/**
 * Calculate cost-of-delay for a stale deal.
 */
export function staleDealDelay(arrK: number, daysSinceTouch: number, closeDate?: string): DelayImpact {
  let closeDatePressure = 0;
  if (closeDate) {
    const daysToClose = Math.ceil((new Date(closeDate).getTime() - Date.now()) / 86400000);
    if (daysToClose <= 14) closeDatePressure = 2;
    else if (daysToClose <= 30) closeDatePressure = 1;
    else if (daysToClose <= 60) closeDatePressure = 0.5;
  }

  const stalenessFactor = Math.min(daysSinceTouch / 7, 5);
  const decayMultiplier = 1 + (stalenessFactor * 0.3) + closeDatePressure + (arrK / 100);

  let escalationLevel: DelayImpact['escalationLevel'] = 'low';
  if (decayMultiplier >= 3.5) escalationLevel = 'critical';
  else if (decayMultiplier >= 2.5) escalationLevel = 'high';
  else if (decayMultiplier >= 1.5) escalationLevel = 'moderate';

  const delayConsequence = closeDatePressure >= 2
    ? 'Close date imminent — deal at risk of slipping'
    : daysSinceTouch >= 14
      ? 'Deal is going cold — re-engage before it dies'
      : 'Needs attention to maintain momentum';

  return { decayMultiplier, escalationLevel, delayConsequence };
}

/**
 * Calculate cost-of-delay for a renewal at risk.
 */
export function renewalRiskDelay(arrK: number, daysToRenewal: number, churnRisk: string): DelayImpact {
  const riskWeight = churnRisk === 'certain' ? 3 : churnRisk === 'high' ? 2 : 1;
  const urgencyFactor = daysToRenewal <= 7 ? 3 : daysToRenewal <= 14 ? 2 : daysToRenewal <= 30 ? 1.5 : 1;

  const decayMultiplier = riskWeight * urgencyFactor * (1 + arrK / 200);

  let escalationLevel: DelayImpact['escalationLevel'] = 'low';
  if (decayMultiplier >= 6) escalationLevel = 'critical';
  else if (decayMultiplier >= 3) escalationLevel = 'high';
  else if (decayMultiplier >= 1.5) escalationLevel = 'moderate';

  const delayConsequence = daysToRenewal <= 7
    ? `$${arrK.toFixed(0)}k ARR at immediate risk of churn`
    : `Renewal risk escalating — ${daysToRenewal} days to act`;

  return { decayMultiplier, escalationLevel, delayConsequence };
}

/**
 * Calculate cost-of-delay for an overdue task.
 */
export function taskOverdueDelay(priority: string, daysOverdue: number, linkedArrK?: number): DelayImpact {
  const priorityWeight = priority === 'P0' ? 4 : priority === 'P1' ? 3 : priority === 'P2' ? 1.5 : 1;
  const overdueFactor = Math.min(daysOverdue / 3, 4); // escalates every 3 days
  const arrBonus = linkedArrK ? linkedArrK / 100 : 0;

  const decayMultiplier = priorityWeight * (1 + overdueFactor * 0.3) + arrBonus;

  let escalationLevel: DelayImpact['escalationLevel'] = 'low';
  if (decayMultiplier >= 5) escalationLevel = 'critical';
  else if (decayMultiplier >= 3) escalationLevel = 'high';
  else if (decayMultiplier >= 1.5) escalationLevel = 'moderate';

  const delayConsequence = daysOverdue >= 5
    ? 'Significantly overdue — blocking downstream work'
    : daysOverdue >= 2
      ? 'Growing overdue — may impact deal timeline'
      : 'Slightly overdue — complete today';

  return { decayMultiplier, escalationLevel, delayConsequence };
}

/**
 * Pipeline creation gap delay — when no new logo activity is happening.
 */
export function pipelineGapDelay(daysSinceNewActivity: number): DelayImpact {
  const decayMultiplier = 1 + Math.min(daysSinceNewActivity / 5, 4);

  let escalationLevel: DelayImpact['escalationLevel'] = 'low';
  if (daysSinceNewActivity >= 14) escalationLevel = 'critical';
  else if (daysSinceNewActivity >= 10) escalationLevel = 'high';
  else if (daysSinceNewActivity >= 7) escalationLevel = 'moderate';

  const delayConsequence = daysSinceNewActivity >= 14
    ? 'Pipeline will dry up — future quota at risk'
    : daysSinceNewActivity >= 7
      ? 'New logo cadence broken — need to restart prospecting'
      : 'Pipeline creation slowing';

  return { decayMultiplier, escalationLevel, delayConsequence };
}
