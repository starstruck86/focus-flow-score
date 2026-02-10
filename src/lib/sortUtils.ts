// Sorting utilities with explicit enum ordering
import type { AccountStatus, AccountTier, ChurnRisk } from '@/types';
import type { SortConfig } from '@/components/table/SortableHeader';

// ====== STATUS SORT ORDER (with display labels) ======
// Status order: 1-Researching, 2-Prepped, 3-Active, 4-Inactive, 5-Disqualified, 6-Meeting Booked
export const ACCOUNT_STATUS_SORT_RANK: Record<AccountStatus, number> = {
  'researching': 1,
  'prepped': 2,
  'active': 3,
  'inactive': 4,
  'disqualified': 5,
  'meeting-booked': 6,
};

export const ACCOUNT_STATUS_DISPLAY_LABELS: Record<AccountStatus, string> = {
  'researching': '1 - Researching',
  'prepped': '2 - Prepped',
  'active': '3 - Active',
  'inactive': '4 - Inactive',
  'disqualified': '5 - Disqualified',
  'meeting-booked': '6 - Meeting Booked',
};

// ====== CONTACT STATUS SORT ORDER ======
export const CONTACT_STATUS_SORT_RANK: Record<string, number> = {
  'ready': 1,
  'in-progress': 2,
  'not-started': 3,
};

export const CONTACT_STATUS_DISPLAY_LABELS: Record<string, string> = {
  'ready': 'Ready',
  'in-progress': 'In-Progress',
  'not-started': 'Not Started',
};

// ====== TIER SORT ORDER ======
export const TIER_SORT_RANK: Record<AccountTier | 'D', number> = {
  'A': 1,
  'B': 2,
  'C': 3,
  'D': 4,
};

// ====== CHURN RISK SORT ORDER (with display labels) ======
// Churn Risk order: 1-Low Risk, 2-Medium Risk, 3-High Risk, 4-OOB/Churning
export const CHURN_RISK_SORT_RANK: Record<ChurnRisk, number> = {
  'low': 1,
  'medium': 2,
  'high': 3,
  'certain': 4, // "OOB / Churning"
};

export const CHURN_RISK_DISPLAY_LABELS: Record<ChurnRisk, string> = {
  'low': '1 - Low Risk',
  'medium': '2 - Medium Risk',
  'high': '3 - High Risk',
  'certain': '4 - OOB / Churning',
};

// ====== GENERIC SORT FUNCTION ======
type SortableValue = string | number | boolean | null | undefined;

export function sortByKey<T>(
  items: T[],
  key: keyof T,
  direction: 'asc' | 'desc',
  customRank?: Record<string, number>
): T[] {
  return [...items].sort((a, b) => {
    const aVal = a[key] as SortableValue;
    const bVal = b[key] as SortableValue;

    let comparison = 0;

    // Use custom rank if provided
    if (customRank) {
      const aRank = customRank[String(aVal)] ?? 999;
      const bRank = customRank[String(bVal)] ?? 999;
      comparison = aRank - bRank;
    } else if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else if (aVal == null && bVal != null) {
      comparison = 1;
    } else if (aVal != null && bVal == null) {
      comparison = -1;
    }

    return direction === 'desc' ? -comparison : comparison;
  });
}

// ====== MULTI-KEY SORT ======
interface SortStep<T> {
  key: keyof T;
  direction: 'asc' | 'desc';
  customRank?: Record<string, number>;
}

export function multiSort<T>(items: T[], steps: SortStep<T>[]): T[] {
  return [...items].sort((a, b) => {
    for (const step of steps) {
      const aVal = a[step.key] as SortableValue;
      const bVal = b[step.key] as SortableValue;

      let comparison = 0;

      if (step.customRank) {
        const aRank = step.customRank[String(aVal)] ?? 999;
        const bRank = step.customRank[String(bVal)] ?? 999;
        comparison = aRank - bRank;
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (aVal == null && bVal != null) {
        comparison = 1;
      } else if (aVal != null && bVal == null) {
        comparison = -1;
      }

      if (comparison !== 0) {
        return step.direction === 'desc' ? -comparison : comparison;
      }
    }
    return 0;
  });
}

// ====== ACCOUNT DEFAULT SORT ======
// Primary: Tier (A→B→C→D), Secondary: Status (1-Active→5-Meeting Booked), Tertiary: Name A→Z
export function sortAccountsDefault<T extends { tier?: string; accountStatus?: string; name: string }>(
  items: T[]
): T[] {
  return multiSort(items, [
    { key: 'tier' as keyof T, direction: 'asc', customRank: TIER_SORT_RANK },
    { key: 'accountStatus' as keyof T, direction: 'asc', customRank: ACCOUNT_STATUS_SORT_RANK },
    { key: 'name' as keyof T, direction: 'asc' },
  ]);
}

// ====== RENEWALS DEFAULT SORT ======
// Primary: Renewal Date (soonest first), Secondary: Churn Risk (Low→OOB), Tertiary: ARR desc, Quaternary: Name A→Z
export function sortRenewalsDefault<T extends { 
  renewalDue?: string; 
  churnRisk?: string; 
  arr?: number; 
  accountName: string 
}>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    // Primary: Renewal date ascending
    const dateA = a.renewalDue ? new Date(a.renewalDue).getTime() : Infinity;
    const dateB = b.renewalDue ? new Date(b.renewalDue).getTime() : Infinity;
    if (dateA !== dateB) return dateA - dateB;

    // Secondary: Churn risk by rank
    const riskA = CHURN_RISK_SORT_RANK[(a.churnRisk || 'low') as ChurnRisk] ?? 999;
    const riskB = CHURN_RISK_SORT_RANK[(b.churnRisk || 'low') as ChurnRisk] ?? 999;
    if (riskA !== riskB) return riskA - riskB;

    // Tertiary: ARR descending (largest first)
    const arrA = a.arr ?? 0;
    const arrB = b.arr ?? 0;
    if (arrA !== arrB) return arrB - arrA;

    // Quaternary: Name ascending
    return a.accountName.localeCompare(b.accountName);
  });
}

// ====== APPLY USER SORT WITH FALLBACK ======
export function applySortWithFallback<T>(
  items: T[],
  sortConfig: SortConfig | null,
  defaultSortFn: (items: T[]) => T[],
  sortKeyMap?: Partial<Record<string, { key: keyof T; customRank?: Record<string, number> }>>
): T[] {
  if (!sortConfig) {
    return defaultSortFn(items);
  }

  const mapping = sortKeyMap?.[sortConfig.key];
  if (mapping) {
    return sortByKey(items, mapping.key, sortConfig.direction!, mapping.customRank);
  }

  // Try to use sortConfig.key directly as keyof T
  return sortByKey(items, sortConfig.key as keyof T, sortConfig.direction!);
}
