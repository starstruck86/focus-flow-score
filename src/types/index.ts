// Quota Compass Type Definitions

export type FocusMode = 'new-logo' | 'expansion' | 'balanced';
export type DistractionLevel = 'low' | 'medium' | 'high';
export type ContextSwitchingLevel = 'low' | 'medium' | 'high';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type Motion = 'new-logo' | 'renewal' | 'general';
export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'done';
export type LinkedRecordType = 'account' | 'opportunity';
export type HealthStatus = 'green' | 'yellow' | 'red';
export type OutreachStatus = 
  | 'not-started' 
  | 'in-progress' 
  | 'working' 
  | 'nurture' 
  | 'meeting-set' 
  | 'opp-open' 
  | 'closed-won' 
  | 'closed-lost';
export type AccountTier = 'A' | 'B' | 'C';
export type AccountStatus = 'researching' | 'prepped' | 'active' | 'inactive' | 'disqualified' | 'meeting-booked';
export type TouchType = 'call' | 'manual-email' | 'automated-email' | 'meeting' | 'linkedin' | 'other';
export type TaskCategory = 
  | 'call' 
  | 'manual-email' 
  | 'automated-email' 
  | 'research' 
  | 'deck' 
  | 'meeting-prep' 
  | 'proposal' 
  | 'admin';
export type TimerBlockType = 'prospecting' | 'account-research' | 'deck-creation' | 'renewal-prep';

// Opportunity types
export type OpportunityStatus = 'active' | 'stalled' | 'closed-lost' | 'closed-won';
export type OpportunityStage = '' | 'Prospect' | 'Discover' | 'Demo' | 'Proposal' | 'Negotiate' | 'Closed Won' | 'Closed Lost';
export type ChurnRisk = 'certain' | 'high' | 'medium' | 'low';
export type DealType = 'new-logo' | 'expansion' | 'renewal' | 'one-time';
export type PaymentTerms = 'annual' | 'prepaid' | 'other';

// Opportunity Activity Log
export interface OpportunityActivity {
  id: string;
  type: TouchType;
  date: string;
  notes?: string;
}

// Opportunity
export interface Opportunity {
  id: string;
  name: string;
  accountId?: string;
  accountName?: string;
  salesforceLink?: string;
  salesforceId?: string;
  linkedContactIds: string[];
  status: OpportunityStatus;
  stage: OpportunityStage;
  arr?: number;
  churnRisk?: ChurnRisk;
  closeDate?: string;
  nextStep?: string;
  nextStepDate?: string;
  lastTouchDate?: string;
  notes?: string;
  activityLog: OpportunityActivity[];
  createdAt: string;
  updatedAt: string;
  // Quota/Commission fields
  dealType?: DealType;
  paymentTerms?: PaymentTerms;
  termMonths?: number;
  priorContractArr?: number; // For renewals: the baseline ARR cap
  renewalArr?: number; // For renewals: the contracted renewal ARR
  oneTimeAmount?: number; // For one-time deals
  isNewLogo?: boolean; // Account is a new logo
}

// Quota Configuration
export interface QuotaConfig {
  fiscalYearStart: string; // ISO date - start of fiscal period
  fiscalYearEnd: string; // ISO date - end of fiscal period
  newArrQuota: number; // 2H quota: 500,000
  renewalArrQuota: number; // 2H quota: 822,542
  newArrAcr: number; // Base ACR: 7.73% (0.0773)
  renewalArrAcr: number; // Base ACR: 1.57% (0.0157)
  // Overachievement accelerator thresholds
  acceleratorTiers: {
    threshold: number; // e.g., 1.0, 1.25, 1.5
    multiplier: number; // e.g., 1.0, 1.5, 1.7, 2.0
  }[];
}

// Ledger line types
export type LedgerType = 'new-arr' | 'renewal-arr' | 'one-time';

// Deals Ledger Entry (auto-generated from closed-won opportunities)
export interface DealsLedgerEntry {
  id: string;
  opportunityId: string;
  opportunityName: string;
  accountName?: string;
  closeDate: string;
  ledgerType: LedgerType;
  amount: number;
  termMonths: number;
  paymentTerms: PaymentTerms;
  isNewLogo: boolean;
  isMultiYear: boolean;
  isAnnualTerms: boolean;
  effectiveRate: number;
  commissionAmount: number;
  quotaCredit: number;
}

// Commission calculation result
export interface CommissionSummary {
  // New ARR
  newArrBooked: number;
  newArrQuota: number;
  newArrAttainment: number;
  newArrBaseCommission: number;
  newArrAcceleratorBonus: number;
  // Renewal ARR
  renewalArrBooked: number;
  renewalArrQuota: number;
  renewalArrAttainment: number;
  renewalArrBaseCommission: number;
  renewalArrAcceleratorBonus: number;
  // One-Time
  oneTimeBooked: number;
  oneTimeCommission: number;
  // Totals
  totalCommission: number;
  remainingToHundred: number;
  // Computed helpers
  newArrRemainingToHundred: number;
  renewalArrRemainingToHundred: number;
}

// Daily Entry - Raw counts user enters
export interface DailyRawInputs {
  prospectsAddedToCadence: number;
  coldCallsWithConversations: number;
  emailsInMailsToManager: number;
  initialMeetingsSet: number;
  opportunitiesCreated: number;
  personalDevelopment: 0 | 1;
}

// Additional Daily Inputs
export interface DailyActivityInputs {
  dials: number;
  emailsTotal: number;
  automatedPercent: 0 | 25 | 50 | 75 | 100;
  execManagerOutreach: number; // 0-5
  customerMeetingsHeld: number;
  accountDeepWorkMinutes: number; // 0-180
  prospectingBlockMinutes: number; // 0-180
  expansionTouchpoints: number;
  focusMode: FocusMode;
}

// Recovery Journal Inputs
export interface RecoveryInputs {
  energy: number; // 1-5
  focusQuality: number; // 1-5
  stress: number; // 1-5
  sleepHours: number;
  distractions: DistractionLevel;
  adminHeavyDay: boolean;
  travelDay: boolean;
  clarity: number; // 1-5
  contextSwitching: ContextSwitchingLevel;
  meetingMinutes?: number; // Optional, from calendar
}

// Calculated Daily Scores
export interface DailyScores {
  dailyScore: number; // Sum of daily points, goal: 8
  weeklyAverage: number;
  goalMet: boolean;
  streak: number;
  salesStrain: number; // 0-21
  strainBand: 'low' | 'moderate' | 'high' | 'very-high';
  strainContributors: Array<{ name: string; value: number }>;
  salesRecovery: number; // 0-100
  recoveryBand: 'green' | 'yellow' | 'red';
  recoveryDrivers: Array<{ name: string; value: number }>;
  salesProductivity: number; // 0-100
  effortQuality: 'low' | 'medium' | 'high';
}

// Complete Day Entry
export interface DayEntry {
  id: string;
  date: string; // ISO date string YYYY-MM-DD
  rawInputs: DailyRawInputs;
  activityInputs: DailyActivityInputs;
  recoveryInputs: RecoveryInputs;
  scores: DailyScores;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// Focus Timer Block
export interface FocusBlock {
  id: string;
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  type: TimerBlockType;
  accountId?: string;
  completed: boolean;
  notes?: string;
}

// Account Contact for nested contacts field
export interface AccountContact {
  id: string;
  name: string;
  title: string;
  notes: string;
}

// Account for Weekly Outreach
export interface Account {
  id: string;
  name: string;
  website?: string;
  industry?: string;
  priority: 'high' | 'medium' | 'low';
  tier: AccountTier;
  accountStatus: AccountStatus;
  motion: Motion | 'both';
  salesforceLink?: string;
  salesforceId?: string;
  planhatLink?: string;
  currentAgreementLink?: string;
  techStack: string[];
  techStackNotes?: string;
  techFitFlag: 'good' | 'watch' | 'disqualify';
  outreachStatus: OutreachStatus;
  cadenceName?: string;
  lastTouchDate?: string;
  lastTouchType?: TouchType;
  touchesThisWeek: number;
  nextStep?: string;
  nextTouchDue?: string;
  notes?: string;
  marTech?: string;
  ecommerce?: string;
  accountContacts?: AccountContact[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// Contact
export interface Contact {
  id: string;
  accountId: string;
  name: string;
  title?: string;
  department?: string;
  seniority?: string;
  email?: string;
  linkedInUrl?: string;
  salesforceLink?: string;
  salesforceId?: string;
  status: 'target' | 'engaged' | 'unresponsive' | 'not-fit';
  lastTouchDate?: string;
  preferredChannel?: TouchType;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// Renewal
export interface Renewal {
  id: string;
  accountId?: string;
  accountName: string;
  salesforceLink?: string;
  salesforceId?: string;
  csm?: string;
  arr: number;
  renewalDue: string; // ISO date
  daysToRenewal: number; // Calculated
  renewalQuarter: string; // e.g., "Q1 2026"
  entitlements?: string;
  usage?: string;
  term?: string;
  planhatLink?: string;
  currentAgreementLink?: string; // Link to current contract/agreement
  autoRenew: boolean;
  product?: string;
  csNotes?: string;
  nextStep?: string;
  healthStatus: HealthStatus;
  churnRisk: ChurnRisk;
  linkedOpportunityId?: string;
  riskReason?: string;
  renewalStage?: string;
  owner: string;
  notes?: string;
  accountContacts?: AccountContact[];
  createdAt: string;
  updatedAt: string;
}

// Task
export interface Task {
  id: string;
  title: string;
  priority: Priority;
  dueDate: string;
  status: TaskStatus;
  motion: Motion;
  // Linked Record - can link to Account OR Opportunity
  linkedRecordType: LinkedRecordType;
  linkedRecordId: string;
  // Auto-filled when linking to an Opportunity for rollup convenience
  linkedAccountId?: string;
  linkedContactId?: string;
  category: TaskCategory;
  estimatedMinutes?: number;
  notes?: string;
  subtasks: Array<{ id: string; title: string; completed: boolean }>;
  createdAt: string;
  updatedAt: string;
}

// Time Range for global selector
export type TimeRange = 
  | 'today'
  | 'last-7-days'
  | 'last-30-days'
  | 'mtd'
  | 'qtd'
  | 'last-6-months'
  | 'ytd'
  | 'last-12-months'
  | 'all-time'
  | { type: 'custom'; start: string; end: string };

// Timer State
export interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  totalSeconds: number;
  remainingSeconds: number;
  blockType: TimerBlockType;
  accountId?: string;
  breakMode: boolean;
  breakDuration: number;
  repeatEnabled: boolean;
}
