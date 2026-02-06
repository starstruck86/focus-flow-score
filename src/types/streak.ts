// Streak & Gamification Types

export type CheckInMethod = 'daily_input' | 'task_complete' | 'focus_timer' | 'manual';

export type BadgeType = 
  | 'first_week'
  | 'two_week_lock'
  | 'thirty_day_habit'
  | 'perfect_week'
  | 'bounce_back'
  | 'consistency_king';

export interface WorkScheduleConfig {
  id: string;
  workingDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  reminderEnabled: boolean;
  reminderTime: string; // HH:mm:ss
  graceWindowHours: number;
  goalDailyScoreThreshold: number;
  goalProductivityThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  createdAt: string;
}

export interface PtoDay {
  id: string;
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
}

export interface WorkdayOverride {
  id: string;
  date: string; // YYYY-MM-DD
  isWorkday: boolean;
  reason?: string;
  createdAt: string;
}

export interface StreakEvent {
  id: string;
  date: string; // YYYY-MM-DD
  isEligibleDay: boolean;
  checkedIn: boolean;
  checkInMethod?: CheckInMethod;
  checkInTime?: string;
  goalMet: boolean;
  dailyScore?: number;
  productivityScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BadgeEarned {
  id: string;
  badgeType: BadgeType;
  badgeName: string;
  earnedAt: string;
  metadata?: Record<string, unknown>;
}

export interface StreakSummary {
  id: string;
  currentCheckinStreak: number;
  currentPerformanceStreak: number;
  longestCheckinStreak: number;
  longestPerformanceStreak: number;
  totalEligibleDays: number;
  totalCheckins: number;
  totalGoalsMet: number;
  checkinLevel: number;
  performanceLevel: number;
  updatedAt: string;
}

// Level thresholds (in eligible days)
export const LEVEL_THRESHOLDS: number[] = [
  0,   // Level 0
  3,   // Level 1
  5,   // Level 2
  10,  // Level 3
  20,  // Level 4
  30,  // Level 5
  45,  // Level 6
  60,  // Level 7
  90,  // Level 8
  120, // Level 9
  180, // Level 10
];

export const BADGE_DEFINITIONS: Record<BadgeType, { name: string; description: string; icon: string }> = {
  first_week: { 
    name: 'First Week', 
    description: '5 eligible-day check-ins',
    icon: '🌱' 
  },
  two_week_lock: { 
    name: 'Two Week Lock', 
    description: '10 eligible-day check-ins',
    icon: '🔒' 
  },
  thirty_day_habit: { 
    name: '30-Day Habit', 
    description: '30 eligible-day check-ins',
    icon: '💪' 
  },
  perfect_week: { 
    name: 'Perfect Week', 
    description: 'Goal met on all eligible days in a week',
    icon: '⭐' 
  },
  bounce_back: { 
    name: 'Bounce Back', 
    description: 'Started a new 3-day streak after breaking one',
    icon: '🔄' 
  },
  consistency_king: { 
    name: 'Consistency King', 
    description: '30 eligible days with low score volatility',
    icon: '👑' 
  },
};

export function getLevelFromStreak(streak: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (streak >= LEVEL_THRESHOLDS[i]) {
      return i;
    }
  }
  return 0;
}

export function getProgressToNextLevel(streak: number): { current: number; next: number; progress: number; remaining: number } {
  const level = getLevelFromStreak(streak);
  const current = LEVEL_THRESHOLDS[level] || 0;
  const next = LEVEL_THRESHOLDS[level + 1] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const progress = next > current ? ((streak - current) / (next - current)) * 100 : 100;
  const remaining = Math.max(0, next - streak);
  
  return { current, next, progress, remaining };
}

export function getLevelTitle(level: number): string {
  const titles = [
    'Starting Out',
    'Building Momentum',
    'Finding Rhythm',
    'Getting Consistent',
    'Forming Habits',
    'In The Zone',
    'Discipline Mode',
    'Peak Performer',
    'Elite Status',
    'Legend',
    'Hall of Fame',
  ];
  return titles[level] || titles[0];
}
