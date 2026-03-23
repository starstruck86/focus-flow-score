/**
 * Weekly Research Queue — account scoring and eligibility filtering.
 * Reuses the same ICP/tier/signal model as newLogoSelection but
 * designed for weekly batching (15 accounts).
 */
import type { Account } from '@/types';

/** Check if a single account is eligible for the new-logo queue */
export function isEligibleForQueue(
  account: Account,
  activeOppAccountIds: Set<string>,
): boolean {
  if (activeOppAccountIds.has(account.id)) return false;
  if (account.motion === 'renewal') return false;
  if (account.accountStatus === 'disqualified') return false;
  if (account.outreachStatus === 'closed-won' || account.outreachStatus === 'closed-lost') return false;
  if (account.outreachStatus === 'opp-open') return false;
  return true;
}

/** Filter to eligible new-logo accounts only */
export function filterEligible(
  accounts: Account[],
  activeOppAccountIds: Set<string>,
): Account[] {
  return accounts.filter(a => isEligibleForQueue(a, activeOppAccountIds));
}

/** Score an account for weekly queue placement. Higher = better. */
export function scoreAccountForQueue(account: Account): number {
  let score = 0;

  // ICP fit (0-30)
  const icpFit = account.icpFitScore ?? account.priorityScore ?? 0;
  score += Math.min(30, Math.round(icpFit * 0.3));

  // Tier (0-20)
  if (account.tier === 'A') score += 20;
  else if (account.tier === 'B') score += 12;
  else score += 5;

  // Buying signals (0-15)
  if (account.triggeredAccount || account.highProbabilityBuyer) score += 15;
  if (account.triggerEvents?.length) score += Math.min(10, account.triggerEvents.length * 3);

  // Recency — prefer untouched or stale (0-15)
  if (account.lastTouchDate) {
    const days = Math.floor((Date.now() - new Date(account.lastTouchDate).getTime()) / 86400000);
    if (days > 14) score += 15;
    else if (days > 7) score += 10;
    else if (days > 3) score += 5;
    else score -= 5;
  } else {
    score += 12;
  }

  // Account status
  if (account.accountStatus === 'prepped') score += 10;
  else if (account.accountStatus === 'researching') score += 5;

  // Outreach status
  if (account.outreachStatus === 'not-started') score += 10;
  else if (account.outreachStatus === 'in-progress') score += 5;

  // Enrichment available
  if (account.enrichmentSourceSummary || account.lastEnrichedAt) score += 5;

  // Confidence
  if (account.confidenceScore) score += Math.min(10, Math.round(account.confidenceScore * 0.1));

  return score;
}
