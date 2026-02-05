// Quota Compass - All scoring calculations
import type { 
  DailyRawInputs, 
  DailyActivityInputs, 
  RecoveryInputs, 
  DailyScores,
  FocusMode 
} from '@/types';

// ============================================================
// DAILY SCORE CALCULATION (from Good Day Tracker)
// ============================================================
export function calculateDailyPoints(inputs: DailyRawInputs): number {
  const points = {
    prospects: Math.floor(inputs.prospectsAddedToCadence / 10),
    conversations: inputs.coldCallsWithConversations,
    emails: Math.floor(inputs.emailsInMailsToManager / 5),
    meetings: inputs.initialMeetingsSet,
    opps: inputs.opportunitiesCreated,
    pd: inputs.personalDevelopment,
  };
  
  return Object.values(points).reduce((sum, val) => sum + val, 0);
}

// ============================================================
// SALES STRAIN (0-21) CALCULATION
// ============================================================
function normalize(value: number, max: number): number {
  return Math.min(value / max, 1);
}

interface NormalizedInputs {
  Cn: number;  // Conversations
  Dn: number;  // Dials
  Pn: number;  // Prospects Added
  Mn: number;  // Manager+ Messages
  Emn: number; // Manual Emails
  Ean: number; // Automated Emails
  Exn: number; // Exec Outreach
  MSn: number; // Meetings Set
  On: number;  // Opps Created
  PDn: number; // Personal Development
  PBMn: number; // Prospecting Block Minutes
  CMHn: number; // Customer Meetings Held
  ADMn: number; // Account Deep Work Minutes
  XTn: number; // Expansion Touchpoints
}

function normalizeInputs(raw: DailyRawInputs, activity: DailyActivityInputs): NormalizedInputs {
  const eManual = activity.emailsTotal * (1 - activity.automatedPercent / 100);
  const eAuto = activity.emailsTotal * (activity.automatedPercent / 100);

  return {
    Cn: normalize(raw.coldCallsWithConversations, 10),
    Dn: normalize(activity.dials, 60),
    Pn: normalize(raw.prospectsAddedToCadence, 40),
    Mn: normalize(raw.emailsInMailsToManager, 8),
    Emn: normalize(eManual, 40),
    Ean: normalize(eAuto, 200),
    Exn: normalize(activity.execManagerOutreach, 5),
    MSn: normalize(raw.initialMeetingsSet, 3),
    On: normalize(raw.opportunitiesCreated, 2),
    PDn: raw.personalDevelopment,
    PBMn: normalize(activity.prospectingBlockMinutes, 75),
    CMHn: normalize(activity.customerMeetingsHeld, 4),
    ADMn: normalize(activity.accountDeepWorkMinutes, 120),
    XTn: normalize(activity.expansionTouchpoints, 6),
  };
}

function calculateNewLogoStrainIndex(n: NormalizedInputs): number {
  return (
    0.26 * n.Cn +
    0.14 * n.Dn +
    0.16 * n.Pn +
    0.16 * n.Mn +
    0.10 * n.Emn +
    0.01 * n.Ean +
    0.05 * n.Exn +
    0.07 * n.MSn +
    0.05 * n.On +
    0.01 * n.PDn +
    0.01 * n.PBMn
  );
}

function calculateExpansionStrainIndex(n: NormalizedInputs): number {
  return (
    0.08 * n.Cn +
    0.04 * n.Dn +
    0.04 * n.Pn +
    0.10 * n.Mn +
    0.10 * n.CMHn +
    0.10 * n.XTn +
    0.28 * n.ADMn +
    0.08 * n.MSn +
    0.10 * n.Emn +
    0.01 * n.Ean +
    0.06 * n.Exn +
    0.02 * n.PDn +
    0.01 * n.PBMn
  );
}

function blendStrainIndices(nlSI: number, exSI: number, mode: FocusMode): number {
  switch (mode) {
    case 'new-logo':
      return 0.80 * nlSI + 0.20 * exSI;
    case 'expansion':
      return 0.25 * nlSI + 0.75 * exSI;
    case 'balanced':
    default:
      return 0.55 * nlSI + 0.45 * exSI;
  }
}

export function calculateSalesStrain(
  raw: DailyRawInputs,
  activity: DailyActivityInputs,
  recovery: RecoveryInputs
): { strain: number; band: 'low' | 'moderate' | 'high' | 'very-high'; contributors: Array<{ name: string; value: number }> } {
  const n = normalizeInputs(raw, activity);
  
  const nlSI = calculateNewLogoStrainIndex(n);
  const exSI = calculateExpansionStrainIndex(n);
  const blendedSI = blendStrainIndices(nlSI, exSI, activity.focusMode);
  
  // Momentum Bonus
  const momentumBonus = 
    (raw.coldCallsWithConversations >= 6 && 
     (raw.prospectsAddedToCadence >= 20 || raw.emailsInMailsToManager >= 5)) 
    ? 0.8 : 0;
  
  // Fragmentation Penalty
  const meetingMinutes = recovery.meetingMinutes || 0;
  const hasDeepBlock = activity.accountDeepWorkMinutes >= 45 || activity.prospectingBlockMinutes >= 45;
  const fragmentationPenalty = (meetingMinutes >= 270 || !hasDeepBlock) ? 0.9 : 1.0;
  
  // Final calculation
  const rawStrain = 21 * Math.pow(blendedSI, 0.85) * fragmentationPenalty + momentumBonus;
  const strain = Math.round(Math.max(0, Math.min(21, rawStrain)) * 10) / 10;
  
  // Determine band
  let band: 'low' | 'moderate' | 'high' | 'very-high';
  if (strain <= 6) band = 'low';
  else if (strain <= 11) band = 'moderate';
  else if (strain <= 16) band = 'high';
  else band = 'very-high';
  
  // Calculate top contributors
  const contributions = [
    { name: 'Conversations', value: 0.26 * n.Cn * 21 },
    { name: 'Prospects', value: 0.16 * n.Pn * 21 },
    { name: 'Manager+ Msgs', value: 0.16 * n.Mn * 21 },
    { name: 'Dials', value: 0.14 * n.Dn * 21 },
    { name: 'Manual Emails', value: 0.10 * n.Emn * 21 },
    { name: 'Deep Work', value: 0.28 * n.ADMn * 21 },
    { name: 'Customer Meetings', value: 0.10 * n.CMHn * 21 },
  ].sort((a, b) => b.value - a.value).slice(0, 3);
  
  return { strain, band, contributors: contributions };
}

// ============================================================
// SALES RECOVERY (0-100) CALCULATION
// ============================================================
export function calculateSalesRecovery(
  recovery: RecoveryInputs
): { recovery: number; band: 'green' | 'yellow' | 'red'; drivers: Array<{ name: string; value: number }> } {
  // Normalize inputs
  const En = (recovery.energy - 1) / 4;
  const Fn = (recovery.focusQuality - 1) / 4;
  const Cln = (recovery.clarity - 1) / 4;
  const StressN = 1 - ((recovery.stress - 1) / 4);
  
  // Sleep penalty
  const ideal = 7.0;
  const sleepPenalty = Math.min(Math.abs(recovery.sleepHours - ideal) / 3, 1);
  const SleepN = 1 - sleepPenalty;
  
  // Modifiers
  const distractionMod = 
    recovery.distractions === 'low' ? 1.0 :
    recovery.distractions === 'medium' ? 0.88 : 0.75;
  
  const contextMod = 
    recovery.contextSwitching === 'low' ? 1.0 :
    recovery.contextSwitching === 'medium' ? 0.90 : 0.80;
  
  const adminMod = recovery.adminHeavyDay ? 0.92 : 1.0;
  const travelMod = recovery.travelDay ? 0.92 : 1.0;
  
  // Meeting hangover
  const meetingMinutes = recovery.meetingMinutes || 0;
  const meetingMod = meetingMinutes >= 300 ? 0.88 : meetingMinutes >= 240 ? 0.92 : 1.0;
  
  // Base readiness
  const R0 = 0.28 * Fn + 0.22 * Cln + 0.18 * SleepN + 0.14 * StressN + 0.10 * En + 0.08 * Fn;
  
  // Final calculation
  const allModifiers = distractionMod * contextMod * adminMod * travelMod * meetingMod;
  const recoveryScore = Math.round(100 * R0 * allModifiers);
  
  // Determine band
  let band: 'green' | 'yellow' | 'red';
  if (recoveryScore >= 67) band = 'green';
  else if (recoveryScore >= 34) band = 'yellow';
  else band = 'red';
  
  // Calculate drivers
  const drivers = [
    { name: 'Focus', value: Fn * 100 },
    { name: 'Clarity', value: Cln * 100 },
    { name: 'Sleep', value: SleepN * 100 },
    { name: 'Stress (low)', value: StressN * 100 },
    { name: 'Energy', value: En * 100 },
  ].sort((a, b) => b.value - a.value).slice(0, 3);
  
  return { recovery: recoveryScore, band, drivers };
}

// ============================================================
// SALES PRODUCTIVITY (0-100) CALCULATION
// ============================================================
export function calculateSalesProductivity(
  raw: DailyRawInputs,
  activity: DailyActivityInputs,
  dailyScore: number
): { productivity: number; effortQuality: 'low' | 'medium' | 'high' } {
  // A) Execution (50%)
  const executionScore = Math.min(100, (dailyScore / 8) * 100);
  
  // B) Focus Fit (25%)
  let focusPenalty = 0;
  
  if (activity.focusMode === 'new-logo') {
    // New Logo anchors check
    const hasDialsOrConversations = activity.dials > 0 || raw.coldCallsWithConversations > 0;
    const hasProspects = raw.prospectsAddedToCadence > 0;
    const hasOutreach = raw.emailsInMailsToManager > 0 || activity.execManagerOutreach > 0;
    const hasBlock = activity.prospectingBlockMinutes >= 45 || activity.accountDeepWorkMinutes >= 45;
    
    if (!hasDialsOrConversations) focusPenalty += 20;
    if (!hasProspects) focusPenalty += 20;
    if (!hasOutreach) focusPenalty += 20;
    if (!hasBlock) focusPenalty += 20;
  } else if (activity.focusMode === 'expansion') {
    // Expansion anchors check
    const hasDeepWork = activity.accountDeepWorkMinutes > 0;
    const hasTouch = activity.customerMeetingsHeld > 0 || activity.expansionTouchpoints > 0;
    
    if (!hasDeepWork) focusPenalty += 30;
    if (!hasTouch) focusPenalty += 30;
  } else {
    // Balanced - at least one from each
    const hasNewLogoAnchor = activity.dials > 0 || raw.prospectsAddedToCadence > 0;
    const hasExpansionAnchor = activity.accountDeepWorkMinutes > 0 || activity.customerMeetingsHeld > 0;
    
    if (!hasNewLogoAnchor) focusPenalty += 30;
    if (!hasExpansionAnchor) focusPenalty += 30;
  }
  
  const focusFitScore = Math.max(0, 100 - Math.min(60, focusPenalty));
  
  // C) Progress (25%)
  let progressScore = 0;
  if (raw.initialMeetingsSet > 0 || activity.customerMeetingsHeld > 0) progressScore += 35;
  if (raw.opportunitiesCreated > 0) progressScore += 35;
  progressScore += 30; // Placeholder for pipeline/proposal - always give some credit for now
  progressScore = Math.min(100, progressScore);
  
  // Final
  const productivity = Math.round(0.50 * executionScore + 0.25 * focusFitScore + 0.25 * progressScore);
  
  // Effort Quality (need strain for this, but we'll approximate)
  const effortQuality = productivity >= 70 ? 'high' : productivity >= 40 ? 'medium' : 'low';
  
  return { productivity, effortQuality };
}

// ============================================================
// FULL DAILY SCORES CALCULATION
// ============================================================
export function calculateAllScores(
  raw: DailyRawInputs,
  activity: DailyActivityInputs,
  recovery: RecoveryInputs,
  previousDays: DayEntry[] = []
): DailyScores {
  const dailyScore = calculateDailyPoints(raw);
  const goalMet = dailyScore >= 8;
  
  // Calculate streak
  let streak = goalMet ? 1 : 0;
  for (const day of previousDays) {
    if (day.scores.goalMet) streak++;
    else break;
  }
  
  // Calculate weekly average (last 7 days including today)
  const recentScores = previousDays.slice(0, 6).map(d => d.scores.dailyScore);
  recentScores.unshift(dailyScore);
  const weeklyAverage = recentScores.reduce((sum, s) => sum + s, 0) / recentScores.length;
  
  // Calculate strain
  const strainResult = calculateSalesStrain(raw, activity, recovery);
  
  // Calculate recovery
  const recoveryResult = calculateSalesRecovery(recovery);
  
  // Calculate productivity
  const productivityResult = calculateSalesProductivity(raw, activity, dailyScore);
  
  return {
    dailyScore,
    weeklyAverage: Math.round(weeklyAverage * 10) / 10,
    goalMet,
    streak,
    salesStrain: strainResult.strain,
    strainBand: strainResult.band,
    strainContributors: strainResult.contributors,
    salesRecovery: recoveryResult.recovery,
    recoveryBand: recoveryResult.band,
    recoveryDrivers: recoveryResult.drivers,
    salesProductivity: productivityResult.productivity,
    effortQuality: productivityResult.effortQuality,
  };
}

// Import type for circular reference
import type { DayEntry } from '@/types';

// ============================================================
// HELPER FUNCTIONS
// ============================================================
export function getRecoveryAdvice(band: 'green' | 'yellow' | 'red'): string {
  switch (band) {
    case 'green':
      return "You're primed for high-leverage activities. Push for meetings and opps today.";
    case 'yellow':
      return "Moderate readiness. Focus on one big win and avoid distractions.";
    case 'red':
      return "Low recovery day. Prioritize admin tasks and prep work. Don't force prospecting.";
  }
}

export function getStrainLabel(band: 'low' | 'moderate' | 'high' | 'very-high'): string {
  switch (band) {
    case 'low': return 'Low';
    case 'moderate': return 'Moderate';
    case 'high': return 'High';
    case 'very-high': return 'Very High';
  }
}
