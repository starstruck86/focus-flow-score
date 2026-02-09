// Recurring Task Types

import type { Priority, Workstream } from './index';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export type MonthlyMode = 'day-of-month' | 'first-business-day' | 'last-business-day';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  // Daily
  includeWeekends?: boolean; // default false (weekdays only)
  // Weekly
  daysOfWeek?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  // Monthly
  dayOfMonth?: number; // 1-31
  monthlyMode?: MonthlyMode;
}

export type RecurrenceEndType = 'never' | 'on-date' | 'after-count';

export interface RecurrenceEnd {
  type: RecurrenceEndType;
  endDate?: string; // ISO date
  maxOccurrences?: number;
  completedOccurrences?: number;
}

export interface RecurringTaskTemplate {
  id: string;
  title: string;
  workstream: Workstream;
  priority: Priority;
  linkedAccountId?: string;
  linkedOpportunityId?: string;
  notes?: string;
  rule: RecurrenceRule;
  end: RecurrenceEnd;
  paused: boolean;
  // Track last generated instance date to avoid duplicates
  lastGeneratedDate?: string;
  // ID of the currently active (non-done) instance
  activeInstanceId?: string;
  createdAt: string;
  updatedAt: string;
}
