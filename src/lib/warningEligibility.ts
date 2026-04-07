/**
 * Centralized predicate for determining if an entity should surface warnings/risk alerts.
 * Reuse this everywhere warnings are generated — DO NOT duplicate this logic.
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
 * Returns false for closed-lost deals, churned/inactive accounts, deleted entities, etc.
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
