// Daily Journal Entry Types for WHOOP-like check-in system

export type FocusModeJournal = 'new-logo' | 'balanced' | 'expansion';
export type DistractionLevelJournal = 'low' | 'medium' | 'high';
export type ContextSwitchingLevelJournal = 'low' | 'medium' | 'high';

// Activity Totals (Step 1)
export interface ActivityTotals {
  dials: number;
  conversations: number;
  prospectsAdded: number;
  managerPlusMessages: number;
  manualEmails: number;
  automatedEmails: number;
  meetingsSet: number;
  customerMeetingsHeld: number;
  opportunitiesCreated: number;
  personalDevelopment: boolean;
  prospectingBlockMinutes: number;
  accountDeepWorkMinutes: number;
  expansionTouchpoints: number;
  focusMode: FocusModeJournal;
}

// Preparedness & Momentum (Step 2)
export interface PreparednessInputs {
  accountsResearched: number;
  contactsPrepped: number;
  preppedForAllCallsTomorrow: boolean | null;
  callsNeedPrepCount: number;
  callsPrepNote: string;
  meetingPrepDone: boolean | null;
  meetingsUnpreparedFor: boolean | null;
  meetingsUnpreparedNote: string;
}

// Recovery Journal (Step 3)
export interface RecoveryJournalInputs {
  sleepHours: number;
  energy: number; // 1-5
  focusQuality: number; // 1-5
  stress: number; // 1-5
  clarity: number; // 1-5
  distractions: DistractionLevelJournal;
  contextSwitching: ContextSwitchingLevelJournal;
  adminHeavyDay: boolean;
  travelDay: boolean;
  whatDrainedYou: string;
  whatWorkedToday: string;
}

// Complete Journal Entry
export interface DailyJournalEntry {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  
  // Step 1: Activity Totals
  activity: ActivityTotals;
  
  // Step 2: Preparedness
  preparedness: PreparednessInputs;
  
  // Step 3: Recovery
  recovery: RecoveryJournalInputs;
  
  // Calculated Scores
  dailyScore: number | null;
  salesStrain: number | null;
  salesRecovery: number | null;
  salesProductivity: number | null;
  goalMet: boolean;
  
  // Status Flags
  checkedIn: boolean;
  checkInTimestamp: string | null;
  confirmed: boolean;
  confirmationTimestamp: string | null;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

// Default values
export function getDefaultActivityTotals(): ActivityTotals {
  return {
    dials: 0,
    conversations: 0,
    prospectsAdded: 0,
    managerPlusMessages: 0,
    manualEmails: 0,
    automatedEmails: 0,
    meetingsSet: 0,
    customerMeetingsHeld: 0,
    opportunitiesCreated: 0,
    personalDevelopment: false,
    prospectingBlockMinutes: 0,
    accountDeepWorkMinutes: 0,
    expansionTouchpoints: 0,
    focusMode: 'balanced',
  };
}

export function getDefaultPreparednessInputs(): PreparednessInputs {
  return {
    accountsResearched: 0,
    contactsPrepped: 0,
    preppedForAllCallsTomorrow: null,
    callsNeedPrepCount: 0,
    callsPrepNote: '',
    meetingPrepDone: null,
    meetingsUnpreparedFor: null,
    meetingsUnpreparedNote: '',
  };
}

export function getDefaultRecoveryJournalInputs(): RecoveryJournalInputs {
  return {
    sleepHours: 7,
    energy: 3,
    focusQuality: 3,
    stress: 3,
    clarity: 3,
    distractions: 'medium',
    contextSwitching: 'medium',
    adminHeavyDay: false,
    travelDay: false,
    whatDrainedYou: '',
    whatWorkedToday: '',
  };
}

// Journal config fields added to work_schedule_config
export interface JournalConfig {
  eodCheckinTime: string; // HH:MM:SS
  eodReminderTime: string;
  morningConfirmTime: string;
  graceWindowEndTime: string;
}
