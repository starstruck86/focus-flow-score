// Good Day Model - Point-based scoring with Day-Type Templates
// Target: 8 points per workday (40 points/week for 5 days)

export type DayTypeTemplate = 'prospecting-heavy' | 'meeting-push' | 'balanced-pd' | 'custom';

export interface GoodDayPointRules {
  prospectsPerPoint: number;     // 10 prospects = 1 point
  conversationsPerPoint: number; // 1 conversation = 1 point
  messagesPerPoint: number;      // 5 manager+ messages = 1 point
  meetingsSetPerPoint: number;   // 1 meeting set = 1 point
  oppsCreatedPerPoint: number;   // 1 opp = 1 point
  pdHoursForPoint: number;       // 1 hour = 1 point (max 1/day)
}

export const GOOD_DAY_POINT_RULES: GoodDayPointRules = {
  prospectsPerPoint: 10,
  conversationsPerPoint: 1,
  messagesPerPoint: 5,
  meetingsSetPerPoint: 1,
  oppsCreatedPerPoint: 1,
  pdHoursForPoint: 1,
};

export interface DayTypeExpectations {
  id: DayTypeTemplate;
  name: string;
  description: string;
  prospectsAdded: number;
  conversations: number;
  managerPlusMessages: number;
  meetingsSet: number;
  oppsCreated: number;
  personalDevelopmentHours: number;
  totalPoints: number;
}

// Default templates that sum to 8 points/day
export const DAY_TYPE_TEMPLATES: DayTypeExpectations[] = [
  {
    id: 'prospecting-heavy',
    name: 'Prospecting Heavy',
    description: 'Focus on high-volume outreach and conversations',
    prospectsAdded: 30,      // 3 pts
    conversations: 4,        // 4 pts
    managerPlusMessages: 5,  // 1 pt
    meetingsSet: 0,          // 0 pts
    oppsCreated: 0,          // 0 pts
    personalDevelopmentHours: 0,  // 0 pts
    totalPoints: 8,
  },
  {
    id: 'meeting-push',
    name: 'Meeting Push',
    description: 'Drive meetings and scheduling',
    prospectsAdded: 20,      // 2 pts
    conversations: 3,        // 3 pts
    managerPlusMessages: 10, // 2 pts
    meetingsSet: 1,          // 1 pt
    oppsCreated: 0,          // 0 pts
    personalDevelopmentHours: 0,  // 0 pts
    totalPoints: 8,
  },
  {
    id: 'balanced-pd',
    name: 'Balanced + PD',
    description: 'Balanced activity with personal development',
    prospectsAdded: 20,      // 2 pts
    conversations: 3,        // 3 pts
    managerPlusMessages: 5,  // 1 pt
    meetingsSet: 1,          // 1 pt (or opp created)
    oppsCreated: 0,          // 0 pts
    personalDevelopmentHours: 1,  // 1 pt
    totalPoints: 8,
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Define your own targets',
    prospectsAdded: 0,
    conversations: 0,
    managerPlusMessages: 0,
    meetingsSet: 0,
    oppsCreated: 0,
    personalDevelopmentHours: 0,
    totalPoints: 0,
  },
];

// Calculate points from activity
export function calculateGoodDayPoints(activity: {
  prospectsAdded: number;
  conversations: number;
  managerPlusMessages: number;
  meetingsSet: number;
  oppsCreated: number;
  personalDevelopment: boolean;
}): {
  total: number;
  breakdown: {
    prospects: number;
    conversations: number;
    messages: number;
    meetings: number;
    opps: number;
    pd: number;
  };
} {
  const breakdown = {
    prospects: Math.floor(activity.prospectsAdded / GOOD_DAY_POINT_RULES.prospectsPerPoint),
    conversations: activity.conversations,
    messages: Math.floor(activity.managerPlusMessages / GOOD_DAY_POINT_RULES.messagesPerPoint),
    meetings: activity.meetingsSet,
    opps: activity.oppsCreated,
    pd: activity.personalDevelopment ? 1 : 0,
  };
  
  const total = breakdown.prospects + 
                breakdown.conversations + 
                breakdown.messages + 
                breakdown.meetings + 
                breakdown.opps + 
                breakdown.pd;
  
  return { total, breakdown };
}

// Capacity Settings (guardrails for recommendations)
export interface CapacitySettings {
  // Daily capacity (normal / elite)
  dialsNormalMin: number;
  dialsNormalMax: number;
  dialsEliteMax: number;
  dialsDailyCapDefault: number;
  
  // Weekly capacity caps
  dialsWeeklyCap: number;
  powerHoursWeeklyCap: number;
  meetingsWeeklyCap: number;
  researchHoursWeeklyCap: number;
  
  // Recommendation guardrails
  maxIncreaseVs30dAvg: number;  // e.g., 1.30 = 130% of 30D average
  maxIncreaseVs6mAvg: number;   // e.g., 1.20 = 120% of 6M average
}

export const DEFAULT_CAPACITY_SETTINGS: CapacitySettings = {
  dialsNormalMin: 20,
  dialsNormalMax: 40,
  dialsEliteMax: 60,
  dialsDailyCapDefault: 50,
  
  dialsWeeklyCap: 200,
  powerHoursWeeklyCap: 3,
  meetingsWeeklyCap: 12,
  researchHoursWeeklyCap: 6,
  
  maxIncreaseVs30dAvg: 1.30,
  maxIncreaseVs6mAvg: 1.20,
};

// Calculate weekly expected metrics from day type and eligible days
export interface WeeklyExpectedMetrics {
  eligibleDays: number;
  pointsTarget: number;
  prospectsAdded: number;
  conversations: number;
  managerPlusMessages: number;
  meetingsSet: number;
  oppsCreated: number;
  personalDevelopmentHours: number;
}

export function calculateWeeklyExpectations(
  template: DayTypeExpectations,
  eligibleDays: number
): WeeklyExpectedMetrics {
  return {
    eligibleDays,
    pointsTarget: 8 * eligibleDays,
    prospectsAdded: template.prospectsAdded * eligibleDays,
    conversations: template.conversations * eligibleDays,
    managerPlusMessages: template.managerPlusMessages * eligibleDays,
    meetingsSet: template.meetingsSet * eligibleDays,
    oppsCreated: template.oppsCreated * eligibleDays,
    personalDevelopmentHours: template.personalDevelopmentHours * eligibleDays,
  };
}

// Get recommendation target capped by capacity
export function getCapacityAdjustedTarget(
  desiredTarget: number,
  rolling30dAvg: number,
  rolling6mAvg: number,
  settings: CapacitySettings = DEFAULT_CAPACITY_SETTINGS
): number {
  // Use the max of 30D or 6M average as baseline
  const baseline30d = rolling30dAvg * settings.maxIncreaseVs30dAvg;
  const baseline6m = rolling6mAvg * settings.maxIncreaseVs6mAvg;
  
  // Cap at the more generous of the two baselines
  const maxAllowed = Math.max(baseline30d, baseline6m);
  
  // Return the lower of desired vs allowed
  return Math.min(desiredTarget, maxAllowed || desiredTarget);
}

// Get template by ID
export function getTemplateById(id: DayTypeTemplate): DayTypeExpectations {
  return DAY_TYPE_TEMPLATES.find(t => t.id === id) || DAY_TYPE_TEMPLATES[2]; // default to balanced
}

// Calculate points earned vs target
export function calculatePointsVsTarget(
  pointsEarned: number,
  targetPoints: number = 8
): {
  percentage: number;
  status: 'ahead' | 'on-track' | 'behind';
  gap: number;
} {
  const percentage = targetPoints > 0 ? pointsEarned / targetPoints : 0;
  const gap = targetPoints - pointsEarned;
  
  let status: 'ahead' | 'on-track' | 'behind';
  if (percentage >= 1.0) {
    status = 'ahead';
  } else if (percentage >= 0.8) {
    status = 'on-track';
  } else {
    status = 'behind';
  }
  
  return { percentage, status, gap };
}
