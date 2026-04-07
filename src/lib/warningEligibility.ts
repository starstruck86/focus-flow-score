/**
 * ═══════════════════════════════════════════════════════════════════
 * REGRESSION-LOCKED INVARIANT: Centralized warning eligibility
 * ═══════════════════════════════════════════════════════════════════
 * This is the SINGLE source of truth for determining if an entity
 * should surface warnings, risk alerts, coaching prompts, or
 * stale-deal indicators.
 *
 * ALL warning-producing components and hooks MUST call
 * isWarningEligible() instead of reimplementing status checks.
 *
 * Current consumers (keep this list updated):
 *   - DealRiskAlerts.tsx
 *   - Next45DaysRisk.tsx
 *   - DealIntelligenceCard.tsx
 *   - CoachingFeed.tsx
 *   - usePlaybookRecommendation.ts
 *   - useTimeAllocation.ts
 *
 * If you need to add a new warning/risk surface, import and use
 * isWarningEligible(). Do NOT create local status-check logic.
 * ═══════════════════════════════════════════════════════════════════
 */

/** Statuses that should never show warnings */
const INELIGIBLE_OPP_STATUSES = new Set([
  'closed-lost',
  'closed_lost',
  'churned',
  'churning',
  'inactive',
  'dead',
]);

const INELIGIBLE_ACCOUNT_STATUSES = new Set([
  'churned',
  'churning',
  'inactive',
  'dead',
  'lost',
  'closed',
]);

export interface WarningEntity {
  status?: string | null;
  account_status?: string | null;
  accountStatus?: string | null;
  deleted_at?: string | null;
  deletedAt?: string | null;
}

/**
 * Returns true if the entity is eligible for warnings/risk alerts.
 * Returns false for closed-lost deals, churned/inactive accounts,
 * deleted entities, etc.
 *
 * This is the ONLY function that should decide warning eligibility.
 */
export function isWarningEligible(entity: WarningEntity): boolean {
  // Soft-deleted entities are never eligible
  if (entity.deleted_at || entity.deletedAt) {
    console.debug('[WarningEligibility] Excluded (deleted):', entity);
    return false;
  }

  // Check opportunity status
  const status = (entity.status || '').toLowerCase().trim();
  if (status && INELIGIBLE_OPP_STATUSES.has(status)) {
    console.debug('[WarningEligibility] Excluded (opp status):', status);
    return false;
  }

  // Check account status
  const acctStatus = (entity.account_status || entity.accountStatus || '').toLowerCase().trim();
  if (acctStatus && INELIGIBLE_ACCOUNT_STATUSES.has(acctStatus)) {
    console.debug('[WarningEligibility] Excluded (account status):', acctStatus);
    return false;
  }

  return true;
}

/**
 * Convenience: filter an array to only warning-eligible items.
 * Use this to pre-filter opportunity/account lists before computing
 * warning UI, instead of filtering inline in each component.
 */
export function filterWarningEligible<T extends WarningEntity>(items: T[]): T[] {
  return items.filter(isWarningEligible);
}
