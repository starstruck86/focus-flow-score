// Commission Calculation Engine for Quota Compass
// Based on Acoustic FY26 Incentive Plan

import type { 
  Opportunity, 
  QuotaConfig, 
  DealsLedgerEntry, 
  CommissionSummary,
  LedgerType,
  PaymentTerms 
} from '@/types';

// Default quota configuration (FY26 2H - July 1 to Dec 31, 2026)
export const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  fiscalYearStart: '2026-07-01',
  fiscalYearEnd: '2026-12-31',
  newArrQuota: 500000,
  renewalArrQuota: 822542,
  newArrAcr: 0.0773, // 7.73%
  renewalArrAcr: 0.0157, // 1.57%
  acceleratorTiers: [
    { threshold: 1.0, multiplier: 1.0 },   // 0-100%: no accelerator
    { threshold: 1.25, multiplier: 1.5 },  // 100-125%: 1.5x ACR
    { threshold: 1.5, multiplier: 1.7 },   // 125-150%: 1.7x ACR
    { threshold: Infinity, multiplier: 2.0 }, // 150%+: 2.0x ACR
  ],
};

// One-time flat rate (no quota retirement)
const ONE_TIME_RATE = 0.03; // 3%

/**
 * Calculate the effective commission rate for a New ARR ledger entry
 * Kickers are cumulative:
 * - New Logo: +3%
 * - Annual Payment Terms: +2%
 * - Multi-Year (24+ months): +1%
 */
export function calculateNewArrEffectiveRate(
  baseAcr: number,
  isNewLogo: boolean,
  isAnnualTerms: boolean,
  isMultiYear: boolean
): number {
  let rate = baseAcr;
  if (isNewLogo) rate += 0.03;
  if (isAnnualTerms) rate += 0.02;
  if (isMultiYear) rate += 0.01;
  return rate;
}

/**
 * Calculate the effective commission rate for a Renewal ARR ledger entry
 * Multi-year renewal: lesser of +2% and 2.0x ACR
 */
export function calculateRenewalArrEffectiveRate(
  baseAcr: number,
  isMultiYear: boolean
): number {
  if (!isMultiYear) return baseAcr;
  
  // Lesser of +2% and 2.0x ACR
  const plusTwo = baseAcr + 0.02;
  const twoX = baseAcr * 2.0;
  return Math.min(plusTwo, twoX);
}

/**
 * Generate ledger entries from a closed-won opportunity
 * Each opportunity may generate 1-2 ledger lines depending on deal type
 */
export function generateLedgerEntries(
  opportunity: Opportunity,
  config: QuotaConfig
): DealsLedgerEntry[] {
  if (opportunity.status !== 'closed-won') return [];
  
  const entries: DealsLedgerEntry[] = [];
  const baseId = opportunity.id;
  const termMonths = opportunity.termMonths || 12;
  const paymentTerms = opportunity.paymentTerms || 'annual';
  const isMultiYear = termMonths >= 24;
  const isAnnualTerms = paymentTerms === 'annual';
  const isNewLogo = opportunity.isNewLogo || opportunity.dealType === 'new-logo';
  
  switch (opportunity.dealType) {
    case 'new-logo':
    case 'expansion': {
      // One ledger line: Bucket = New ARR
      const amount = opportunity.arr || 0;
      const effectiveRate = calculateNewArrEffectiveRate(
        config.newArrAcr,
        opportunity.dealType === 'new-logo',
        isAnnualTerms,
        isMultiYear
      );
      
      entries.push({
        id: `${baseId}-new`,
        opportunityId: opportunity.id,
        opportunityName: opportunity.name,
        accountName: opportunity.accountName,
        closeDate: opportunity.closeDate || '',
        ledgerType: 'new-arr',
        amount,
        termMonths,
        paymentTerms,
        isNewLogo: opportunity.dealType === 'new-logo',
        isMultiYear,
        isAnnualTerms,
        effectiveRate,
        commissionAmount: amount * effectiveRate,
        quotaCredit: amount, // 100% quota retirement
      });
      break;
    }
    
    case 'renewal': {
      // Two ledger lines:
      // Line A: Renewal ARR Eligible = MIN(Renewal ARR, Prior Contract ARR)
      // Line B: Expansion (Uplift) ARR = MAX(0, Renewal ARR - Prior Contract ARR)
      
      const priorArr = opportunity.priorContractArr || 0;
      const renewalArr = opportunity.renewalArr || opportunity.arr || 0;
      
      const renewalArrEligible = Math.min(renewalArr, priorArr);
      const expansionUplift = Math.max(0, renewalArr - priorArr);
      
      // Line A: Renewal ARR
      if (renewalArrEligible > 0) {
        const renewalRate = calculateRenewalArrEffectiveRate(config.renewalArrAcr, isMultiYear);
        entries.push({
          id: `${baseId}-renewal`,
          opportunityId: opportunity.id,
          opportunityName: opportunity.name,
          accountName: opportunity.accountName,
          closeDate: opportunity.closeDate || '',
          ledgerType: 'renewal-arr',
          amount: renewalArrEligible,
          termMonths,
          paymentTerms,
          isNewLogo: false,
          isMultiYear,
          isAnnualTerms,
          effectiveRate: renewalRate,
          commissionAmount: renewalArrEligible * renewalRate,
          quotaCredit: renewalArrEligible, // 100% quota retirement
        });
      }
      
      // Line B: Expansion (Uplift) as New ARR
      if (expansionUplift > 0) {
        const newArrRate = calculateNewArrEffectiveRate(
          config.newArrAcr,
          false, // Not a new logo
          isAnnualTerms,
          isMultiYear
        );
        entries.push({
          id: `${baseId}-uplift`,
          opportunityId: opportunity.id,
          opportunityName: `${opportunity.name} (Uplift)`,
          accountName: opportunity.accountName,
          closeDate: opportunity.closeDate || '',
          ledgerType: 'new-arr',
          amount: expansionUplift,
          termMonths,
          paymentTerms,
          isNewLogo: false,
          isMultiYear,
          isAnnualTerms,
          effectiveRate: newArrRate,
          commissionAmount: expansionUplift * newArrRate,
          quotaCredit: expansionUplift, // 100% quota retirement
        });
      }
      break;
    }
    
    case 'one-time': {
      // One ledger line: Bucket = One-Time (Non-Quota)
      const amount = opportunity.oneTimeAmount || opportunity.arr || 0;
      entries.push({
        id: `${baseId}-onetime`,
        opportunityId: opportunity.id,
        opportunityName: opportunity.name,
        accountName: opportunity.accountName,
        closeDate: opportunity.closeDate || '',
        ledgerType: 'one-time',
        amount,
        termMonths: 0,
        paymentTerms: 'other',
        isNewLogo: false,
        isMultiYear: false,
        isAnnualTerms: false,
        effectiveRate: ONE_TIME_RATE,
        commissionAmount: amount * ONE_TIME_RATE,
        quotaCredit: 0, // No quota retirement
      });
      break;
    }
    
    default:
      // For opportunities without a deal type set, treat as New ARR if they have ARR
      if (opportunity.arr && opportunity.arr > 0) {
        const effectiveRate = calculateNewArrEffectiveRate(
          config.newArrAcr,
          isNewLogo,
          isAnnualTerms,
          isMultiYear
        );
        entries.push({
          id: `${baseId}-default`,
          opportunityId: opportunity.id,
          opportunityName: opportunity.name,
          accountName: opportunity.accountName,
          closeDate: opportunity.closeDate || '',
          ledgerType: 'new-arr',
          amount: opportunity.arr,
          termMonths,
          paymentTerms,
          isNewLogo,
          isMultiYear,
          isAnnualTerms,
          effectiveRate,
          commissionAmount: opportunity.arr * effectiveRate,
          quotaCredit: opportunity.arr,
        });
      }
  }
  
  return entries;
}

/**
 * Calculate accelerator bonus for overachievement
 * Only applies to the portion ABOVE 100%
 */
function calculateAcceleratorBonus(
  totalBooked: number,
  quota: number,
  baseAcr: number,
  tiers: QuotaConfig['acceleratorTiers']
): number {
  const attainment = quota > 0 ? totalBooked / quota : 0;
  
  // No accelerator under 100%
  if (attainment <= 1.0) return 0;
  
  // Calculate commission on overachievement portions
  let bonus = 0;
  let previousThreshold = 1.0;
  
  for (const tier of tiers) {
    if (attainment <= previousThreshold) break;
    
    const tierStart = previousThreshold;
    const tierEnd = Math.min(attainment, tier.threshold);
    
    if (tierEnd > tierStart) {
      const tierDollars = (tierEnd - tierStart) * quota;
      // Accelerator bonus = (multiplier - 1) * base rate * dollars
      // Because base rate already paid, we only add the extra
      bonus += tierDollars * baseAcr * (tier.multiplier - 1);
    }
    
    previousThreshold = tier.threshold;
  }
  
  return bonus;
}

/**
 * Calculate full commission summary from opportunities
 */
export function calculateCommissionSummary(
  opportunities: Opportunity[],
  config: QuotaConfig,
  dateFilter?: { start: string; end: string }
): CommissionSummary {
  // Filter to closed-won only
  let closedWon = opportunities.filter(o => o.status === 'closed-won');
  
  // Apply date filter if provided
  if (dateFilter) {
    closedWon = closedWon.filter(o => {
      if (!o.closeDate) return false;
      return o.closeDate >= dateFilter.start && o.closeDate <= dateFilter.end;
    });
  }
  
  // Generate all ledger entries
  const allEntries = closedWon.flatMap(o => generateLedgerEntries(o, config));
  
  // Aggregate by ledger type
  const newArrEntries = allEntries.filter(e => e.ledgerType === 'new-arr');
  const renewalArrEntries = allEntries.filter(e => e.ledgerType === 'renewal-arr');
  const oneTimeEntries = allEntries.filter(e => e.ledgerType === 'one-time');
  
  // Calculate totals
  const newArrBooked = newArrEntries.reduce((sum, e) => sum + e.quotaCredit, 0);
  const newArrBaseCommission = newArrEntries.reduce((sum, e) => sum + e.commissionAmount, 0);
  const newArrAttainment = config.newArrQuota > 0 ? newArrBooked / config.newArrQuota : 0;
  
  const renewalArrBooked = renewalArrEntries.reduce((sum, e) => sum + e.quotaCredit, 0);
  const renewalArrBaseCommission = renewalArrEntries.reduce((sum, e) => sum + e.commissionAmount, 0);
  const renewalArrAttainment = config.renewalArrQuota > 0 ? renewalArrBooked / config.renewalArrQuota : 0;
  
  const oneTimeBooked = oneTimeEntries.reduce((sum, e) => sum + e.amount, 0);
  const oneTimeCommission = oneTimeEntries.reduce((sum, e) => sum + e.commissionAmount, 0);
  
  // Calculate accelerator bonuses (only on overachievement)
  const newArrAcceleratorBonus = calculateAcceleratorBonus(
    newArrBooked,
    config.newArrQuota,
    config.newArrAcr,
    config.acceleratorTiers
  );
  
  const renewalArrAcceleratorBonus = calculateAcceleratorBonus(
    renewalArrBooked,
    config.renewalArrQuota,
    config.renewalArrAcr,
    config.acceleratorTiers
  );
  
  // Remaining to 100%
  const newArrRemainingToHundred = Math.max(0, config.newArrQuota - newArrBooked);
  const renewalArrRemainingToHundred = Math.max(0, config.renewalArrQuota - renewalArrBooked);
  const remainingToHundred = newArrRemainingToHundred + renewalArrRemainingToHundred;
  
  // Total commission
  const totalCommission = 
    newArrBaseCommission + 
    newArrAcceleratorBonus + 
    renewalArrBaseCommission + 
    renewalArrAcceleratorBonus + 
    oneTimeCommission;
  
  return {
    newArrBooked,
    newArrQuota: config.newArrQuota,
    newArrAttainment,
    newArrBaseCommission,
    newArrAcceleratorBonus,
    renewalArrBooked,
    renewalArrQuota: config.renewalArrQuota,
    renewalArrAttainment,
    renewalArrBaseCommission,
    renewalArrAcceleratorBonus,
    oneTimeBooked,
    oneTimeCommission,
    totalCommission,
    remainingToHundred,
    newArrRemainingToHundred,
    renewalArrRemainingToHundred,
  };
}

/**
 * Calculate required weekly booking rate to hit 100% by end of period
 */
export function calculateRequiredWeeklyRate(
  remainingAmount: number,
  endDate: string
): number {
  const now = new Date();
  const end = new Date(endDate);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksRemaining = Math.max(1, (end.getTime() - now.getTime()) / msPerWeek);
  return remainingAmount / weeksRemaining;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
