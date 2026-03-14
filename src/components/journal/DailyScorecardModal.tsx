import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import {
  Phone,
  MessageSquare,
  Users,
  Calendar,
  TrendingUp,
  Timer,
  Plus,
  Minus,
  DollarSign,
  Check,
  Sparkles,
  Flame,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Search,
  CalendarDays,
  Sun,
  Moon,
  Target,
  ArrowRight,
  Clock,
  MapPin,
  AlertTriangle,
  Zap,
  Trophy,
  PartyPopper,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useRecordCheckIn } from '@/hooks/useStreakData';
import { format, subDays, eachDayOfInterval, isToday, isSameDay, startOfDay, endOfDay, differenceInCalendarDays, startOfWeek, endOfWeek, isValid } from 'date-fns';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';

// --- Types ---
type JournalMode = 'morning' | 'evening';

interface ScorecardData {
  dials: number;
  conversations: number;
  prospectsAdded: number;
  meetingsSet: number;
  customerMeetingsHeld: number;
  opportunitiesCreated: number;
  accountsResearched: number;
  contactsPrepped: number;
  ranProspectingBlock: boolean;
  prospectingBlockMinutes: number;
  didDeepWork: boolean;
  accountDeepWorkMinutes: number;
  pipelineMoved: number;
  biggestBlocker: string | null;
  win: string;
  tomorrowPriority: string;
  dailyReflection: string;
  yesterdayCommitmentMet: boolean | null;
}

interface DailyTargets {
  dials: number;
  conversations: number;
  meetingsSet: number;
  customerMeetings: number;
  oppsCreated: number;
  prospectsAdded: number;
  accountsResearched: number;
  contactsPrepped: number;
}

const BLOCKER_OPTIONS = [
  { value: 'none', label: 'No blockers', emoji: '✅' },
  { value: 'cant_reach_dms', label: "Can't reach DMs", emoji: '🚫' },
  { value: 'stuck_deals', label: 'Stuck deals', emoji: '🧱' },
  { value: 'not_enough_at_bats', label: 'Not enough at-bats', emoji: '⚾' },
  { value: 'admin_overload', label: 'Admin overload', emoji: '📋' },
  { value: 'travel_ooo', label: 'Travel / OOO', emoji: '✈️' },
];

const TIME_CHIPS = [30, 60, 90, 120];

const DEFAULT_SCORECARD: ScorecardData = {
  dials: 0,
  conversations: 0,
  prospectsAdded: 0,
  meetingsSet: 0,
  customerMeetingsHeld: 0,
  opportunitiesCreated: 0,
  accountsResearched: 0,
  contactsPrepped: 0,
  ranProspectingBlock: false,
  prospectingBlockMinutes: 0,
  didDeepWork: false,
  accountDeepWorkMinutes: 0,
  pipelineMoved: 0,
  biggestBlocker: null,
  win: '',
  tomorrowPriority: '',
  dailyReflection: '',
  yesterdayCommitmentMet: null,
};

function getDefaultMode(): JournalMode {
  const hour = new Date().getHours();
  return hour < 14 ? 'morning' : 'evening';
}

// #10 - Streak milestone thresholds
const STREAK_MILESTONES = [7, 14, 21, 30, 50, 75, 100];

function getStreakMilestone(streak: number): number | null {
  return STREAK_MILESTONES.find(m => streak === m) || null;
}

// #4 - Confetti burst
function fireConfetti() {
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };
  confetti({ ...defaults, particleCount: 50, origin: { x: 0.3, y: 0.6 } });
  confetti({ ...defaults, particleCount: 50, origin: { x: 0.7, y: 0.6 } });
}

// --- Inline Editable Counter ---
function MetricCounter({
  label,
  value,
  target,
  onChange,
  icon: Icon,
  compact = false,
  hint,
}: {
  label: string;
  value: number;
  target: number;
  onChange: (v: number) => void;
  icon: React.ElementType;
  compact?: boolean;
  hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const atTarget = value >= target;
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;

  const startEdit = () => {
    setEditValue(value.toString());
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    const num = parseInt(editValue, 10);
    if (!isNaN(num) && num >= 0) onChange(num);
    setEditing(false);
  };

  return (
    <div className="relative overflow-hidden rounded-lg border transition-all duration-300"
      style={{
        borderColor: atTarget ? 'hsl(var(--status-green) / 0.4)' : 'hsl(var(--border))',
        background: atTarget ? 'hsl(var(--status-green) / 0.05)' : 'hsl(var(--secondary) / 0.3)',
      }}
    >
      <div
        className="absolute inset-0 transition-all duration-500 ease-out"
        style={{
          width: `${pct}%`,
          background: atTarget
            ? 'hsl(var(--status-green) / 0.08)'
            : 'hsl(var(--primary) / 0.04)',
        }}
      />
      <div className={cn("relative flex items-center justify-between", compact ? "p-2" : "p-3")}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            "rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
            compact ? "w-6 h-6" : "w-7 h-7",
            atTarget ? "bg-status-green/20" : "bg-primary/10"
          )}>
            <Icon className={cn("transition-colors", compact ? "h-3 w-3" : "h-3.5 w-3.5", atTarget ? "text-status-green" : "text-primary")} />
          </div>
          <div className="min-w-0">
            <span className={cn("font-medium block leading-tight", compact ? "text-xs" : "text-sm")}>{label}</span>
            <span className={cn(
              "text-[10px] transition-colors",
              atTarget ? "text-status-green" : "text-muted-foreground"
            )}>
              {atTarget ? '✓ Hit' : hint ? hint : `Target: ${target}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={() => onChange(Math.max(0, value - 1))}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          {editing ? (
            <input
              ref={inputRef}
              type="number"
              min={0}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
              className="w-12 text-center font-mono text-lg font-bold rounded py-0.5 bg-background border border-primary outline-none"
            />
          ) : (
            <button onClick={startEdit} className={cn("w-10 text-center font-mono text-lg font-bold rounded py-0.5 transition-colors", atTarget ? "text-status-green" : "text-foreground")}>
              {value}
            </button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={() => onChange(value + 1)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Score Ring ---
function ScoreRing({ score, total, goalMet }: { score: number; total: number; goalMet: boolean }) {
  const pct = (score / total) * 100;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative w-20 h-20 flex items-center justify-center">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="5" className="stroke-secondary" />
        <motion.circle
          cx="40" cy="40" r={radius} fill="none" strokeWidth="5"
          strokeLinecap="round"
          className={goalMet ? "stroke-status-green" : "stroke-primary"}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ strokeDasharray: circumference }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-xl font-bold font-mono leading-none", goalMet ? "text-status-green" : "text-foreground")}>{score}</span>
        <span className="text-[10px] text-muted-foreground">of {total}</span>
      </div>
    </div>
  );
}

// --- Day Strip (WHOOP-style) ---
function DayStrip({ selectedDate, onSelect }: { selectedDate: Date; onSelect: (d: Date) => void }) {
  const today = new Date();
  const days = eachDayOfInterval({ start: subDays(today, 6), end: today });

  return (
    <div className="flex gap-1 justify-between">
      {days.map(day => {
        const selected = isSameDay(day, selectedDate);
        const isCurrentDay = isToday(day);
        return (
          <button
            key={day.toISOString()}
            onClick={() => onSelect(day)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all min-w-[42px]",
              selected
                ? "bg-primary text-primary-foreground"
                : isCurrentDay
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "hover:bg-secondary/60 text-muted-foreground"
            )}
          >
            <span className="text-[10px] font-medium uppercase">{format(day, 'EEE')}</span>
            <span className={cn("text-sm font-bold", selected && "text-primary-foreground")}>{format(day, 'd')}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- Mode Toggle ---
function ModeToggle({ mode, onToggle }: { mode: JournalMode; onToggle: (m: JournalMode) => void }) {
  return (
    <div className="flex rounded-lg bg-secondary/50 p-0.5 border border-border/50">
      <button
        onClick={() => onToggle('morning')}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
          mode === 'morning'
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Sun className="h-3.5 w-3.5" />
        Morning
      </button>
      <button
        onClick={() => onToggle('evening')}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
          mode === 'evening'
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Moon className="h-3.5 w-3.5" />
        End of Day
      </button>
    </div>
  );
}

// #7 - Weekly Progress Bar
function WeeklyProgressBar({ daysLogged, totalDays }: { daysLogged: number; totalDays: number }) {
  const pct = totalDays > 0 ? Math.min(100, (daysLogged / totalDays) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
        {daysLogged}/{totalDays} logged
      </span>
    </div>
  );
}

// #10 - Streak Milestone Banner
function StreakMilestoneBanner({ streak }: { streak: number }) {
  const milestone = getStreakMilestone(streak);
  if (!milestone) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-3 rounded-xl border border-status-orange/30 bg-gradient-to-r from-status-orange/10 to-status-yellow/10"
    >
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ rotate: [0, -10, 10, -10, 0] }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="w-10 h-10 rounded-full bg-status-orange/20 flex items-center justify-center"
        >
          <Trophy className="h-5 w-5 text-status-orange" />
        </motion.div>
        <div>
          <p className="text-sm font-bold text-foreground">
            🎉 {milestone}-Day Milestone!
          </p>
          <p className="text-xs text-muted-foreground">
            {milestone >= 30
              ? "Incredible consistency! You're in the top tier."
              : milestone >= 14
                ? "Two weeks strong! This is becoming a habit."
                : "One week down! Keep the momentum going."}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ============================
// DATA HOOKS
// ============================

function usePowerHourTotals(date: string) {
  return useQuery({
    queryKey: ['power-hour-totals', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('power_hour_sessions')
        .select('dials, connects, meetings_set')
        .eq('journal_date', date)
        .eq('status', 'completed');
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return {
        dials: data.reduce((s, r) => s + (r.dials || 0), 0),
        conversations: data.reduce((s, r) => s + (r.connects || 0), 0),
        meetingsSet: data.reduce((s, r) => s + (r.meetings_set || 0), 0),
        sessionCount: data.length,
      };
    },
    staleTime: 30 * 1000,
  });
}

function useExistingEntry(date: string) {
  return useQuery({
    queryKey: ['journal-entry', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('date', date)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function useYesterdayEntry() {
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  return useQuery({
    queryKey: ['journal-entry', yesterday],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('date', yesterday)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function useCalendarMeetingCount(date: string) {
  return useQuery({
    queryKey: ['calendar-meeting-count', date],
    queryFn: async () => {
      const dayStart = startOfDay(new Date(date + 'T12:00:00')).toISOString();
      const dayEnd = endOfDay(new Date(date + 'T12:00:00')).toISOString();
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, start_time, end_time, location, all_day')
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .order('start_time', { ascending: true });
      if (error) throw error;
      const internalKeywords = ['standup', 'stand-up', '1:1', '1-1', 'team sync', 'all hands', 'sprint', 'retro', 'planning', 'internal', 'lunch', 'break'];
      const meetings = (data || []).filter((e: any) => {
        const title = (e.title || '').toLowerCase();
        return !internalKeywords.some(kw => title.includes(kw)) && !e.all_day;
      });
      return { totalEvents: data?.length || 0, customerMeetings: meetings, customerMeetingCount: meetings.length };
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useRollingAverage() {
  return useQuery({
    queryKey: ['journal-rolling-avg'],
    queryFn: async () => {
      const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('dials, conversations, prospects_added, meetings_set, customer_meetings_held, opportunities_created, accounts_researched, contacts_prepped')
        .gte('date', weekAgo)
        .eq('checked_in', true);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const n = data.length;
      return {
        dials: Math.round(data.reduce((s, r) => s + (r.dials || 0), 0) / n),
        conversations: Math.round(data.reduce((s, r) => s + (r.conversations || 0), 0) / n),
        prospectsAdded: Math.round(data.reduce((s, r) => s + (r.prospects_added || 0), 0) / n),
        meetingsSet: Math.round(data.reduce((s, r) => s + (r.meetings_set || 0), 0) / n),
        customerMeetingsHeld: Math.round(data.reduce((s, r) => s + (r.customer_meetings_held || 0), 0) / n),
        opportunitiesCreated: Math.round(data.reduce((s, r) => s + (r.opportunities_created || 0), 0) / n),
        accountsResearched: Math.round(data.reduce((s, r) => s + (r.accounts_researched || 0), 0) / n),
        contactsPrepped: Math.round(data.reduce((s, r) => s + (r.contacts_prepped || 0), 0) / n),
        dayCount: n,
      };
    },
    staleTime: 10 * 60 * 1000,
  });
}

function useTodayCalendarEvents() {
  return useQuery({
    queryKey: ['today-calendar-events'],
    queryFn: async () => {
      const dayStart = startOfDay(new Date()).toISOString();
      const dayEnd = endOfDay(new Date()).toISOString();
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, start_time, end_time, location')
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data || []) as Array<{ id: string; title: string; start_time: string; end_time: string | null; location: string | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useLastJournalEntry() {
  return useQuery({
    queryKey: ['last-journal-entry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('date, tomorrow_priority, what_worked_today, daily_score, goal_met, dials, conversations, meetings_set')
        .eq('checked_in', true)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useJournalNudge() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['journal-nudge'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('journal-nudge');
      if (error) throw error;
      return data as {
        nudge: string;
        type: string;
        yesterdayCommitment: string | null;
        yesterdayDate: string | null;
        stats: { streak: number; goalMetRate: number; topGap: string | null };
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

function useWeeklyInsights() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['weekly-patterns'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('weekly-patterns');
      if (error) throw error;
      return data as { insights: string[] } | null;
    },
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
  });
}

function useCurrentWeeklyReview() {
  return useQuery({
    queryKey: ['current-weekly-review'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_reviews')
        .select('*')
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useDailyTargets(): DailyTargets {
  const { data } = useQuery({
    queryKey: ['quota-targets-scorecard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quota_targets')
        .select('target_dials_per_day, target_connects_per_day, target_meetings_set_per_week, target_opps_created_per_week, target_customer_meetings_per_week, target_accounts_researched_per_day, target_contacts_prepped_per_day')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return {
    dials: Number(data?.target_dials_per_day ?? 60),
    conversations: Number(data?.target_connects_per_day ?? 6),
    meetingsSet: Math.ceil(Number(data?.target_meetings_set_per_week ?? 3) / 5),
    customerMeetings: Math.ceil(Number(data?.target_customer_meetings_per_week ?? 8) / 5),
    oppsCreated: Math.ceil(Number(data?.target_opps_created_per_week ?? 1) / 5),
    prospectsAdded: Number(data?.target_accounts_researched_per_day ?? 10),
    accountsResearched: Number(data?.target_accounts_researched_per_day ?? 3),
    contactsPrepped: Number(data?.target_contacts_prepped_per_day ?? 5),
  };
}

function useCurrentStreak() {
  return useQuery({
    queryKey: ['streak-summary-scorecard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streak_summary')
        .select('current_checkin_streak, current_performance_streak')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,
  });
}

function useWhoopMetrics(date: string) {
  return useQuery({
    queryKey: ['whoop-metrics-scorecard', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whoop_daily_metrics')
        .select('recovery_score, sleep_score, strain_score')
        .eq('date', date)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// #7 - Days logged this week
function useWeekDaysLogged() {
  return useQuery({
    queryKey: ['week-days-logged'],
    queryFn: async () => {
      const now = new Date();
      const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('date')
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .eq('checked_in', true);
      if (error) throw error;
      return { daysLogged: data?.length || 0, totalDays: 5 };
    },
    staleTime: 60 * 1000,
  });
}

// Streak-break notification scheduler
function useStreakBreakNotification(todayCheckedIn: boolean) {
  const scheduledRef = useRef(false);

  useEffect(() => {
    if (scheduledRef.current || todayCheckedIn) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    const now = new Date();
    const fivePM = new Date();
    fivePM.setHours(17, 0, 0, 0);
    if (now >= fivePM) return;

    const msUntil5pm = fivePM.getTime() - now.getTime();
    scheduledRef.current = true;

    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const timer = setTimeout(() => {
      if (Notification.permission === 'granted') {
        new Notification('🔥 Don\'t break your streak!', {
          body: 'Your daily journal is waiting. Quick-log your activity to keep your streak alive.',
          icon: '/pwa-192x192.png',
          tag: 'streak-break',
          requireInteraction: true,
        });
      }
    }, msUntil5pm);

    return () => clearTimeout(timer);
  }, [todayCheckedIn]);
}

// ============================
// MORNING VIEW
// ============================
function MorningView({
  yesterdayEntry,
  weeklyReview,
  nudgeData,
  whoopMetrics,
  streakData,
  data,
  update,
  onSwitchToEvening,
  todayEvents,
  lastEntry,
  weekDaysLogged,
}: {
  yesterdayEntry: any;
  weeklyReview: any;
  nudgeData: any;
  whoopMetrics: any;
  streakData: any;
  data: ScorecardData;
  update: <K extends keyof ScorecardData>(key: K, val: ScorecardData[K]) => void;
  onSwitchToEvening: () => void;
  todayEvents: Array<{ id: string; title: string; start_time: string; end_time: string | null; location: string | null }> | undefined;
  lastEntry: any;
  weekDaysLogged: { daysLogged: number; totalDays: number } | undefined;
}) {
  const weeklyGoals = weeklyReview?.key_goals ? (
    Array.isArray(weeklyReview.key_goals) ? weeklyReview.key_goals : []
  ) : [];
  const northStarGoals = weeklyReview?.north_star_goals ? (
    Array.isArray(weeklyReview.north_star_goals) ? weeklyReview.north_star_goals : []
  ) : [];

  const daysSinceLastEntry = lastEntry?.date
    ? differenceInCalendarDays(new Date(), new Date(lastEntry.date + 'T12:00:00'))
    : 0;
  const isReturningFromGap = daysSinceLastEntry >= 2 && !yesterdayEntry;
  const carryoverCommitment = lastEntry?.tomorrow_priority;

  // #10 - Check for streak milestone
  const currentStreak = streakData?.current_checkin_streak || 0;

  return (
    <div className="space-y-4">
      {/* #10 - Streak Milestone */}
      <StreakMilestoneBanner streak={currentStreak} />

      {/* #7 - Weekly Progress Bar */}
      {weekDaysLogged && (
        <WeeklyProgressBar daysLogged={weekDaysLogged.daysLogged} totalDays={weekDaysLogged.totalDays} />
      )}

      {/* PTO/Weekend Carryover Banner */}
      {isReturningFromGap && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-gradient-to-r from-accent/10 to-primary/5 border border-accent/20"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="h-3 w-3 text-accent-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground mb-1">
                Welcome back! {daysSinceLastEntry} days since your last log.
              </p>
              {lastEntry && (
                <p className="text-xs text-muted-foreground">
                  Last logged: {format(new Date(lastEntry.date + 'T12:00:00'), 'EEEE, MMM d')} — {lastEntry.goal_met ? '✓ Goal met' : '✗ Goal missed'} ({lastEntry.daily_score || 0}/6)
                </p>
              )}
              {carryoverCommitment && (
                <div className="mt-2 p-2 rounded-lg bg-background/60 border border-border/30">
                  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest">Last commitment</span>
                  <p className="text-sm text-foreground/80 mt-0.5">"{carryoverCommitment}"</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* WHOOP Recovery Banner */}
      {whoopMetrics && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl border border-border/50"
          style={{
            background: Number(whoopMetrics.recovery_score) >= 67
              ? 'hsl(var(--status-green) / 0.06)'
              : Number(whoopMetrics.recovery_score) >= 34
                ? 'hsl(var(--status-yellow) / 0.06)'
                : 'hsl(var(--status-red) / 0.06)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <div className="text-center">
                  <span className="text-lg font-bold font-mono text-foreground">{Math.round(Number(whoopMetrics.recovery_score))}%</span>
                  <p className="text-[9px] text-muted-foreground uppercase">Recovery</p>
                </div>
                <div className="text-center">
                  <span className="text-lg font-bold font-mono text-foreground">{Math.round(Number(whoopMetrics.sleep_score))}</span>
                  <p className="text-[9px] text-muted-foreground uppercase">Sleep</p>
                </div>
              </div>
            </div>
            <Badge variant="secondary" className="text-[9px] font-normal gap-1">
              <span className="text-status-green">●</span> WHOOP
            </Badge>
          </div>
        </motion.div>
      )}

      {/* Yesterday Summary */}
      {yesterdayEntry && !isReturningFromGap && (
        <div className="space-y-2">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
            <CalendarDays className="h-3 w-3" />
            Yesterday's Results
          </Label>
          <div className="p-3 rounded-xl bg-secondary/30 border border-border/40">
            <div className="flex items-center justify-between mb-3">
              <span className={cn(
                "text-sm font-semibold",
                yesterdayEntry.goal_met ? "text-status-green" : "text-muted-foreground"
              )}>
                {yesterdayEntry.goal_met ? '✓ Goal Met' : '✗ Goal Missed'} — {yesterdayEntry.daily_score || 0}/6
              </span>
              {streakData?.current_checkin_streak ? (
                <span className="inline-flex items-center gap-1 text-xs text-status-orange">
                  <Flame className="h-3 w-3" />
                  {streakData.current_checkin_streak}d
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-background/50">
                <span className="text-base font-bold font-mono">{yesterdayEntry.dials}</span>
                <p className="text-[9px] text-muted-foreground">Dials</p>
              </div>
              <div className="p-2 rounded-lg bg-background/50">
                <span className="text-base font-bold font-mono">{yesterdayEntry.conversations}</span>
                <p className="text-[9px] text-muted-foreground">Convos</p>
              </div>
              <div className="p-2 rounded-lg bg-background/50">
                <span className="text-base font-bold font-mono">{yesterdayEntry.meetings_set}</span>
                <p className="text-[9px] text-muted-foreground">Mtgs Set</p>
              </div>
            </div>
            {yesterdayEntry.what_worked_today && (
              <p className="text-xs text-foreground/70 mt-2 leading-relaxed italic">
                "{yesterdayEntry.what_worked_today}"
              </p>
            )}
          </div>
        </div>
      )}

      {/* Yesterday's Commitment Check */}
      {nudgeData?.yesterdayCommitment && !isReturningFromGap && (
        <div className="p-3 rounded-xl bg-secondary/40 border border-border/50">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Yesterday's commitment
          </span>
          <p className="text-sm mt-1.5 mb-2.5 text-foreground/80">"{nudgeData.yesterdayCommitment}"</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={data.yesterdayCommitmentMet === true ? 'default' : 'outline'}
              onClick={() => update('yesterdayCommitmentMet', true)}
              className="gap-1 text-xs h-7"
            >
              <Check className="h-3 w-3" /> Did it
            </Button>
            <Button
              size="sm"
              variant={data.yesterdayCommitmentMet === false ? 'secondary' : 'outline'}
              onClick={() => update('yesterdayCommitmentMet', false)}
              className="text-xs h-7"
            >
              Missed it
            </Button>
          </div>
        </div>
      )}

      {/* Today's Calendar */}
      {todayEvents && todayEvents.length > 0 && (
        <div className="space-y-2">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
            <Calendar className="h-3 w-3" />
            Today's Schedule ({todayEvents.length})
          </Label>
          <div className="space-y-1">
            {todayEvents.slice(0, 6).map(event => (
              <div key={event.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-secondary/20 border border-border/30">
                <div className="w-5 h-5 rounded flex items-center justify-center bg-primary/10 flex-shrink-0">
                  <Clock className="h-3 w-3 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{event.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(event.start_time), 'h:mm a')}
                    {event.end_time && ` – ${format(new Date(event.end_time), 'h:mm a')}`}
                    {event.location && (
                      <span className="inline-flex items-center gap-0.5 ml-1.5">
                        <MapPin className="h-2.5 w-2.5" />
                        {event.location.length > 20 ? event.location.slice(0, 20) + '…' : event.location}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
            {todayEvents.length > 6 && (
              <p className="text-[10px] text-muted-foreground text-center py-1">
                +{todayEvents.length - 6} more events
              </p>
            )}
          </div>
        </div>
      )}

      {/* Weekly Goals & Commitment */}
      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
          <Target className="h-3 w-3" />
          This Week's Focus
        </Label>
        <div className="p-3 rounded-xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/10 space-y-3">
          {northStarGoals.length > 0 && (
            <div>
              <span className="text-[9px] font-semibold text-primary uppercase tracking-widest">North Star</span>
              {northStarGoals.map((goal: any, i: number) => (
                <p key={i} className="text-sm text-foreground/90 mt-0.5">
                  {typeof goal === 'string' ? goal : goal?.text || goal?.goal || JSON.stringify(goal)}
                </p>
              ))}
            </div>
          )}
          
          {weeklyReview?.commitment_for_week && (
            <div>
              <span className="text-[9px] font-semibold text-primary uppercase tracking-widest">Weekly Commitment</span>
              <p className="text-sm text-foreground/90 mt-0.5">"{weeklyReview.commitment_for_week}"</p>
            </div>
          )}

          {weeklyGoals.length > 0 && (
            <div>
              <span className="text-[9px] font-semibold text-primary uppercase tracking-widest">Key Outcomes</span>
              <ul className="mt-1 space-y-1">
                {weeklyGoals.slice(0, 5).map((goal: any, i: number) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <span className="text-primary mt-0.5">•</span>
                    {typeof goal === 'string' ? goal : goal?.text || goal?.goal || JSON.stringify(goal)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!weeklyReview && (
            <p className="text-xs text-muted-foreground italic">
              No weekly review found. Complete your weekly review to see goals here.
            </p>
          )}
        </div>
      </div>

      {/* AI Nudge */}
      {nudgeData?.nudge && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/15"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkles className="h-3 w-3 text-primary" />
            </div>
            <p className="text-sm text-foreground/90 leading-relaxed">{nudgeData.nudge}</p>
          </div>
        </motion.div>
      )}

      {/* CTA to switch to EOD */}
      <Button
        onClick={onSwitchToEvening}
        variant="outline"
        className="w-full gap-2 text-xs h-9 border-dashed"
      >
        Ready to log activity? Switch to End of Day
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ============================
// EVENING VIEW
// ============================
function EveningView({
  data,
  update,
  targets,
  score,
  goalMet,
  showExtras,
  setShowExtras,
  showLeading,
  setShowLeading,
  showInsights,
  setShowInsights,
  weeklyInsights,
  rollingAvg,
  quickLogMode,
  weekDaysLogged,
  existingEntry,
}: {
  data: ScorecardData;
  update: <K extends keyof ScorecardData>(key: K, val: ScorecardData[K]) => void;
  targets: DailyTargets;
  score: number;
  goalMet: boolean;
  showExtras: boolean;
  setShowExtras: (v: boolean) => void;
  showLeading: boolean;
  setShowLeading: (v: boolean) => void;
  showInsights: boolean;
  setShowInsights: (v: boolean) => void;
  weeklyInsights: any;
  rollingAvg: any;
  quickLogMode: boolean;
  weekDaysLogged: { daysLogged: number; totalDays: number } | undefined;
  existingEntry: any;
}) {
  const avgHint = (field: string, target: number) => {
    if (!rollingAvg) return undefined;
    const avg = rollingAvg[field];
    if (avg === undefined || avg === 0) return undefined;
    return `Target: ${target} · Avg: ${avg}`;
  };

  return (
    <div className="space-y-4">
      {/* #7 - Weekly Progress Bar */}
      {weekDaysLogged && (
        <WeeklyProgressBar daysLogged={weekDaysLogged.daysLogged} totalDays={weekDaysLogged.totalDays} />
      )}

      {/* Rolling Average Banner */}
      {rollingAvg && rollingAvg.dayCount >= 3 && !quickLogMode && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20 border border-border/30">
          <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            Smart defaults from your {rollingAvg.dayCount}-day average. Adjust as needed.
          </p>
        </div>
      )}

      {/* Core Metrics */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            Activity — Actual vs Target
          </Label>
          <span className={cn(
            "text-xs font-mono font-bold",
            goalMet ? "text-status-green" : "text-muted-foreground"
          )}>
            {score}/6 hit
          </span>
        </div>
        <div className="space-y-1.5">
          <MetricCounter label="Dials" value={data.dials} target={targets.dials} onChange={v => update('dials', v)} icon={Phone} hint={avgHint('dials', targets.dials)} />
          <MetricCounter label="Conversations" value={data.conversations} target={targets.conversations} onChange={v => update('conversations', v)} icon={MessageSquare} hint={avgHint('conversations', targets.conversations)} />
          <MetricCounter label="Prospects Added" value={data.prospectsAdded} target={targets.prospectsAdded} onChange={v => update('prospectsAdded', v)} icon={Users} hint={avgHint('prospectsAdded', targets.prospectsAdded)} />
          <MetricCounter label="Meetings Set" value={data.meetingsSet} target={targets.meetingsSet} onChange={v => update('meetingsSet', v)} icon={Calendar} hint={avgHint('meetingsSet', targets.meetingsSet)} />
          <MetricCounter label="Meetings Held" value={data.customerMeetingsHeld} target={targets.customerMeetings} onChange={v => update('customerMeetingsHeld', v)} icon={Calendar} hint={avgHint('customerMeetingsHeld', targets.customerMeetings)} />
          <MetricCounter label="Opps Created" value={data.opportunitiesCreated} target={targets.oppsCreated} onChange={v => update('opportunitiesCreated', v)} icon={TrendingUp} hint={avgHint('opportunitiesCreated', targets.oppsCreated)} />
        </div>
      </div>

      {/* #6 - Quick-log mode: skip everything below counters */}
      {quickLogMode ? (
        <p className="text-[10px] text-center text-muted-foreground italic py-2">
          Quick-log mode — counters only. Toggle off for full journal.
        </p>
      ) : (
        <>
          {/* Leading Indicators */}
          <button
            onClick={() => setShowLeading(!showLeading)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showLeading ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showLeading ? 'Hide' : 'Show'} leading indicators
          </button>

          <AnimatePresence>
            {showLeading && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden space-y-1.5"
              >
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  Preparedness
                </Label>
                <MetricCounter label="Accounts Researched" value={data.accountsResearched} target={targets.accountsResearched} onChange={v => update('accountsResearched', v)} icon={Search} compact />
                <MetricCounter label="Contacts Prepped" value={data.contactsPrepped} target={targets.contactsPrepped} onChange={v => update('contactsPrepped', v)} icon={BookOpen} compact />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Expandable extras */}
          <button
            onClick={() => setShowExtras(!showExtras)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showExtras ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showExtras ? 'Hide' : 'Show'} focus time, pipeline & blockers
          </button>

          <AnimatePresence>
            {showExtras && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden space-y-3"
              >
                <div className="p-3 rounded-xl bg-secondary/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-sm">
                      <Timer className="h-4 w-4 text-primary" />
                      Prospecting block?
                    </Label>
                    <Switch checked={data.ranProspectingBlock} onCheckedChange={v => update('ranProspectingBlock', v)} />
                  </div>
                  {data.ranProspectingBlock && (
                    <div className="flex gap-1.5 pt-1">
                      {TIME_CHIPS.map(min => (
                        <Button key={min} size="sm"
                          variant={data.prospectingBlockMinutes === min ? 'default' : 'outline'}
                          onClick={() => update('prospectingBlockMinutes', min)}
                          className="text-xs h-7 flex-1"
                        >{min}m</Button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-secondary/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-sm">
                      <Timer className="h-4 w-4 text-primary" />
                      Account deep work?
                    </Label>
                    <Switch checked={data.didDeepWork} onCheckedChange={v => update('didDeepWork', v)} />
                  </div>
                  {data.didDeepWork && (
                    <div className="flex gap-1.5 pt-1">
                      {TIME_CHIPS.map(min => (
                        <Button key={min} size="sm"
                          variant={data.accountDeepWorkMinutes === min ? 'default' : 'outline'}
                          onClick={() => update('accountDeepWorkMinutes', min)}
                          className="text-xs h-7 flex-1"
                        >{min}m</Button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-secondary/30">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-primary" />
                      Pipeline moved ($)
                    </Label>
                    <Input
                      type="number" min={0}
                      value={data.pipelineMoved || ''}
                      onChange={e => update('pipelineMoved', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-28 text-right font-mono text-sm h-8"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Biggest blocker
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {BLOCKER_OPTIONS.map(opt => (
                      <Button key={opt.value} size="sm"
                        variant={data.biggestBlocker === opt.value ? 'default' : 'outline'}
                        onClick={() => update('biggestBlocker', data.biggestBlocker === opt.value ? null : opt.value)}
                        className="text-xs h-7 gap-1"
                      >
                        <span>{opt.emoji}</span> {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Weekly Insights */}
          {weeklyInsights?.insights && weeklyInsights.insights.length > 0 && (
            <>
              <button
                onClick={() => setShowInsights(!showInsights)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {showInsights ? 'Hide' : 'View'} weekly patterns
              </button>
              <AnimatePresence>
                {showInsights && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 rounded-xl bg-gradient-to-br from-primary/5 to-accent/10 border border-primary/10 space-y-2">
                      <Label className="text-[10px] uppercase tracking-widest text-primary font-semibold flex items-center gap-1.5">
                        <CalendarDays className="h-3 w-3" />
                        AI Weekly Patterns
                      </Label>
                      {weeklyInsights.insights.map((insight: string, i: number) => (
                        <p key={i} className="text-xs text-foreground/80 leading-relaxed flex items-start gap-2">
                          <span className="text-primary mt-0.5">•</span>
                          {insight}
                        </p>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* Phone Distraction Tracker (read-only, logged via Shortcut) */}
          {existingEntry && (existingEntry.distracted_minutes > 0 || existingEntry.phone_pickups > 0) && (
            <div className="p-3 rounded-xl border border-border/50 bg-secondary/20 space-y-2">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
                📱 Phone Focus
                <Badge
                  variant="secondary"
                  className={cn("text-[9px] font-normal px-1.5 py-0", {
                    'bg-status-green/20 text-status-green': existingEntry.focus_label === 'Focus Day',
                    'bg-status-yellow/20 text-status-yellow': existingEntry.focus_label === 'Normal Day',
                    'bg-destructive/20 text-destructive': existingEntry.focus_label === 'Drift Day',
                  })}
                >
                  {existingEntry.focus_label || 'No data'}
                </Badge>
              </Label>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-lg font-mono font-bold">{existingEntry.distracted_minutes}</p>
                  <p className="text-[10px] text-muted-foreground">min distracted</p>
                </div>
                <div>
                  <p className="text-lg font-mono font-bold">{existingEntry.phone_pickups}</p>
                  <p className="text-[10px] text-muted-foreground">phone pickups</p>
                </div>
                <div>
                  <p className="text-lg font-mono font-bold">{Number(existingEntry.focus_score).toFixed(1)}</p>
                  <p className="text-[10px] text-muted-foreground">focus score</p>
                </div>
              </div>
            </div>
          )}

          {/* Accountability Section */}
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                #1 Win today
              </Label>
              <Input
                value={data.win}
                onChange={e => update('win', e.target.value)}
                placeholder="Best thing that happened…"
                className="text-sm h-9 bg-secondary/20 border-border/50"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
                Reflection
                <Badge variant="secondary" className="text-[9px] font-normal px-1.5 py-0">AI analyzed</Badge>
              </Label>
              <Textarea
                value={data.dailyReflection}
                onChange={e => update('dailyReflection', e.target.value)}
                placeholder="How did today go? Be honest — this is for you..."
                rows={2}
                className="text-sm bg-secondary/20 border-border/50 resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Tomorrow's #1 commitment
              </Label>
              <Textarea
                value={data.tomorrowPriority}
                onChange={e => update('tomorrowPriority', e.target.value)}
                placeholder="What's the one thing you MUST do tomorrow?"
                rows={2}
                className="text-sm bg-secondary/20 border-border/50 resize-none"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================
// MAIN COMPONENT
// ============================
interface DailyScorecardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date?: string;
  initialData?: Partial<ScorecardData>;
  forceMode?: JournalMode;
}

export function DailyScorecardModal({
  open,
  onOpenChange,
  date,
  initialData,
  forceMode,
}: DailyScorecardModalProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(date ? new Date(date + 'T12:00:00') : new Date());
  const entryDate = format(selectedDate, 'yyyy-MM-dd');
  const [data, setData] = useState<ScorecardData>({ ...DEFAULT_SCORECARD, ...initialData });
  const [mode, setMode] = useState<JournalMode>(forceMode || getDefaultMode());
  const [saving, setSaving] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const [showLeading, setShowLeading] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [powerHourApplied, setPowerHourApplied] = useState(false);
  const [calendarApplied, setCalendarApplied] = useState(false);
  const [avgApplied, setAvgApplied] = useState(false);
  const [quickLogMode, setQuickLogMode] = useState(false);
  const savedDataRef = useRef<{ data: ScorecardData; date: string; score: number; goalMet: boolean } | null>(null);
  const queryClient = useQueryClient();
  const targets = useDailyTargets();
  const { data: nudgeData } = useJournalNudge();
  const { data: streakData } = useCurrentStreak();
  const { data: whoopMetrics } = useWhoopMetrics(entryDate);
  const { data: powerHourTotals } = usePowerHourTotals(entryDate);
  const { data: existingEntry } = useExistingEntry(entryDate);
  const { data: weeklyInsights } = useWeeklyInsights();
  const { data: yesterdayEntry } = useYesterdayEntry();
  const { data: weeklyReview } = useCurrentWeeklyReview();
  const { data: calendarData } = useCalendarMeetingCount(entryDate);
  const { data: rollingAvg } = useRollingAverage();
  const { data: todayEvents } = useTodayCalendarEvents();
  const { data: lastEntry } = useLastJournalEntry();
  const { data: weekDaysLogged } = useWeekDaysLogged();
  const recordCheckIn = useRecordCheckIn();

  // Streak-break notification
  useStreakBreakNotification(!!existingEntry?.checked_in);

  // #1 - Swipe gesture handler
  const handlePanEnd = useCallback((_: any, info: PanInfo) => {
    const threshold = 50;
    if (Math.abs(info.offset.x) > threshold) {
      if (info.offset.x < -threshold && mode === 'morning') {
        setMode('evening');
      } else if (info.offset.x > threshold && mode === 'evening') {
        setMode('morning');
      }
    }
  }, [mode]);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setSelectedDate(date ? new Date(date + 'T12:00:00') : new Date());
      setMode(forceMode || getDefaultMode());
      setPowerHourApplied(false);
      setCalendarApplied(false);
      setAvgApplied(false);
      setShowExtras(false);
      setShowLeading(false);
      setShowInsights(false);
      setQuickLogMode(false);
    }
  }, [open, date, forceMode]);

  // Load existing entry or defaults when date changes
  useEffect(() => {
    if (!open) return;
    
    if (existingEntry) {
      setData({
        dials: existingEntry.dials || 0,
        conversations: existingEntry.conversations || 0,
        prospectsAdded: existingEntry.prospects_added || 0,
        meetingsSet: existingEntry.meetings_set || 0,
        customerMeetingsHeld: existingEntry.customer_meetings_held || 0,
        opportunitiesCreated: existingEntry.opportunities_created || 0,
        accountsResearched: existingEntry.accounts_researched || 0,
        contactsPrepped: existingEntry.contacts_prepped || 0,
        ranProspectingBlock: (existingEntry.prospecting_block_minutes || 0) > 0,
        prospectingBlockMinutes: existingEntry.prospecting_block_minutes || 0,
        didDeepWork: (existingEntry.account_deep_work_minutes || 0) > 0,
        accountDeepWorkMinutes: existingEntry.account_deep_work_minutes || 0,
        pipelineMoved: Number(existingEntry.pipeline_moved) || 0,
        biggestBlocker: existingEntry.biggest_blocker,
        win: existingEntry.what_worked_today || '',
        tomorrowPriority: existingEntry.tomorrow_priority || '',
        dailyReflection: existingEntry.daily_reflection || '',
        yesterdayCommitmentMet: existingEntry.yesterday_commitment_met,
      });
      setPowerHourApplied(true);
      setCalendarApplied(true);
      setAvgApplied(true);
    } else {
      setData({ ...DEFAULT_SCORECARD, ...initialData });
      setPowerHourApplied(false);
      setCalendarApplied(false);
      setAvgApplied(false);
    }
  }, [open, existingEntry, entryDate]);

  // Auto-populate from rolling average
  useEffect(() => {
    if (open && rollingAvg && !avgApplied && !existingEntry && rollingAvg.dayCount >= 3) {
      setAvgApplied(true);
      setData(prev => ({
        ...prev,
        dials: prev.dials || rollingAvg.dials,
        conversations: prev.conversations || rollingAvg.conversations,
        prospectsAdded: prev.prospectsAdded || rollingAvg.prospectsAdded,
        meetingsSet: prev.meetingsSet || rollingAvg.meetingsSet,
        customerMeetingsHeld: prev.customerMeetingsHeld || rollingAvg.customerMeetingsHeld,
        opportunitiesCreated: prev.opportunitiesCreated || rollingAvg.opportunitiesCreated,
        accountsResearched: prev.accountsResearched || rollingAvg.accountsResearched,
        contactsPrepped: prev.contactsPrepped || rollingAvg.contactsPrepped,
      }));
    }
  }, [open, rollingAvg, avgApplied, existingEntry]);

  // Auto-populate from Power Hour sessions
  useEffect(() => {
    if (open && powerHourTotals && !powerHourApplied && !existingEntry) {
      setPowerHourApplied(true);
      setData(prev => ({
        ...prev,
        dials: prev.dials + powerHourTotals.dials,
        conversations: prev.conversations + powerHourTotals.conversations,
        meetingsSet: prev.meetingsSet + powerHourTotals.meetingsSet,
      }));
      toast.info(`Pre-filled from ${powerHourTotals.sessionCount} Power Hour session${powerHourTotals.sessionCount > 1 ? 's' : ''}`, {
        description: `+${powerHourTotals.dials} dials, +${powerHourTotals.conversations} connects, +${powerHourTotals.meetingsSet} meetings`,
      });
    }
  }, [open, powerHourTotals, powerHourApplied, existingEntry]);

  // Auto-populate customer meetings from calendar
  useEffect(() => {
    if (open && calendarData && !calendarApplied && !existingEntry && calendarData.customerMeetingCount > 0) {
      setCalendarApplied(true);
      setData(prev => ({
        ...prev,
        customerMeetingsHeld: Math.max(prev.customerMeetingsHeld, calendarData.customerMeetingCount),
      }));
      toast.info(`${calendarData.customerMeetingCount} meeting${calendarData.customerMeetingCount > 1 ? 's' : ''} detected from calendar`, {
        description: calendarData.customerMeetings.slice(0, 3).map((m: any) => m.title).join(', '),
      });
    }
  }, [open, calendarData, calendarApplied, existingEntry]);

  const update = <K extends keyof ScorecardData>(key: K, val: ScorecardData[K]) => {
    setData(prev => ({ ...prev, [key]: val }));
  };

  const score = useMemo(() => {
    let hit = 0;
    if (data.dials >= targets.dials) hit++;
    if (data.conversations >= targets.conversations) hit++;
    if (data.meetingsSet >= targets.meetingsSet) hit++;
    if (data.customerMeetingsHeld >= targets.customerMeetings) hit++;
    if (data.opportunitiesCreated >= targets.oppsCreated) hit++;
    if (data.prospectsAdded >= targets.prospectsAdded) hit++;
    return hit;
  }, [data, targets]);

  const goalMet = score >= 4;
  const isEditMode = !!existingEntry?.checked_in;

  const handleSave = async () => {
    setSaving(true);

    // #2 - Store data for undo, close immediately
    const savedSnapshot = { ...data };
    const savedDate = entryDate;
    const savedScore = score;
    const savedGoalMet = goalMet;
    savedDataRef.current = { data: savedSnapshot, date: savedDate, score: savedScore, goalMet: savedGoalMet };

    // Close modal immediately
    onOpenChange(false);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let sentimentPromise: Promise<{ sentiment_score: number | null; sentiment_label: string | null }> | null = null;
      if (data.dailyReflection.trim().length >= 5) {
        sentimentPromise = supabase.functions.invoke('analyze-sentiment', {
          body: { reflection: data.dailyReflection },
        }).then(({ data: d }) => d).catch(() => ({ sentiment_score: null, sentiment_label: null }));
      }

      const payload = {
        user_id: user.id,
        date: savedDate,
        dials: data.dials,
        conversations: data.conversations,
        prospects_added: data.prospectsAdded,
        manager_plus_messages: 0,
        manual_emails: 0,
        automated_emails: 0,
        meetings_set: data.meetingsSet,
        customer_meetings_held: data.customerMeetingsHeld,
        opportunities_created: data.opportunitiesCreated,
        personal_development: false,
        prospecting_block_minutes: data.ranProspectingBlock ? data.prospectingBlockMinutes : 0,
        account_deep_work_minutes: data.didDeepWork ? data.accountDeepWorkMinutes : 0,
        expansion_touchpoints: 0,
        focus_mode: 'balanced',
        pipeline_moved: data.pipelineMoved,
        biggest_blocker: data.biggestBlocker,
        tomorrow_priority: data.tomorrowPriority || null,
        daily_reflection: data.dailyReflection || null,
        yesterday_commitment_met: data.yesterdayCommitmentMet,
        what_worked_today: data.win || null,
        daily_score: savedScore,
        sales_productivity: Math.round((savedScore / 6) * 100),
        goal_met: savedGoalMet,
        checked_in: true,
        check_in_timestamp: new Date().toISOString(),
        accounts_researched: data.accountsResearched,
        contacts_prepped: data.contactsPrepped,
        admin_heavy_day: false,
        travel_day: data.biggestBlocker === 'travel_ooo',
        sleep_hours: whoopMetrics?.sleep_score
          ? Math.round((Number(whoopMetrics.sleep_score) / 100) * 9 * 10) / 10
          : 7,
        energy: whoopMetrics?.recovery_score
          ? Math.min(5, Math.max(1, Math.round(Number(whoopMetrics.recovery_score) / 20)))
          : 3,
        focus_quality: whoopMetrics?.recovery_score
          ? Math.min(5, Math.max(1, Math.round(Number(whoopMetrics.recovery_score) / 20)))
          : 3,
        stress: whoopMetrics?.strain_score
          ? Math.min(5, Math.max(1, Math.round(Number(whoopMetrics.strain_score) / 4.2)))
          : 3,
        clarity: whoopMetrics?.recovery_score
          ? Math.min(5, Math.max(1, Math.round(Number(whoopMetrics.recovery_score) / 20)))
          : 3,
        distractions: 'low',
        context_switching: 'low',
      };

      const { error } = await supabase
        .from('daily_journal_entries')
        .upsert(payload, { onConflict: 'user_id,date' });

      if (error) throw error;

      await recordCheckIn.mutateAsync({
        date: savedDate,
        method: isEditMode ? 'edit' : (isToday(selectedDate) ? 'scorecard' : 'backfill'),
        dailyScore: savedScore,
        productivityScore: Math.round((savedScore / 6) * 100),
        isEligible: true,
        goalMet: savedGoalMet,
      });

      if (sentimentPromise) {
        const sentiment = await sentimentPromise;
        if (sentiment?.sentiment_score !== null) {
          await supabase
            .from('daily_journal_entries')
            .update({
              sentiment_score: sentiment.sentiment_score,
              sentiment_label: sentiment.sentiment_label,
            })
            .eq('date', savedDate)
            .eq('user_id', user.id);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['journal-nudge'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entry'] });
      queryClient.invalidateQueries({ queryKey: ['streak-events'] });
      queryClient.invalidateQueries({ queryKey: ['streak-summary'] });
      queryClient.invalidateQueries({ queryKey: ['backfill-missed-days'] });
      queryClient.invalidateQueries({ queryKey: ['week-days-logged'] });

      // #4 - Fire confetti if goal met
      if (savedGoalMet && mode === 'evening') {
        setTimeout(() => fireConfetti(), 300);
      }

      // #2 - Show undo toast
      toast.success(
        mode === 'morning' ? 'Morning check-in saved!' : (isEditMode ? 'Journal updated!' : 'Daily journal saved!'),
        {
          description: mode === 'evening'
            ? (savedGoalMet ? `🔥 ${savedScore}/6 targets hit! Streak continues.` : `${savedScore}/6 targets hit. Keep pushing!`)
            : 'Your commitment has been logged.',
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                if (!isEditMode) {
                  // Delete the entry we just created
                  const { data: { user: u } } = await supabase.auth.getUser();
                  if (u) {
                    await supabase
                      .from('daily_journal_entries')
                      .delete()
                      .eq('date', savedDate)
                      .eq('user_id', u.id);
                    queryClient.invalidateQueries({ queryKey: ['journal-entry'] });
                    queryClient.invalidateQueries({ queryKey: ['streak-events'] });
                    queryClient.invalidateQueries({ queryKey: ['streak-summary'] });
                    queryClient.invalidateQueries({ queryKey: ['week-days-logged'] });
                    toast.success('Journal entry undone');
                  }
                }
              } catch {
                toast.error('Failed to undo');
              }
            },
          },
          duration: 5000,
        }
      );
    } catch (error) {
      console.error('Save failed:', error);
      toast.error('Failed to save journal entry');
      // Re-open on failure
      onOpenChange(true);
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = mode === 'morning' ? 'Morning Check-in' : 'Daily Journal';
  const HeaderIcon = mode === 'morning' ? Sun : Moon;

  // #9 - Circadian gradient accent
  const circadianGradient = mode === 'morning'
    ? 'linear-gradient(135deg, hsl(var(--circadian-morning-from) / 0.08), hsl(var(--circadian-morning-to) / 0.04))'
    : 'linear-gradient(135deg, hsl(var(--circadian-evening-from) / 0.08), hsl(var(--circadian-evening-to) / 0.04))';

  const circadianBorderColor = mode === 'morning'
    ? 'hsl(var(--circadian-morning-from) / 0.15)'
    : 'hsl(var(--circadian-evening-from) / 0.15)';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* #9 - Circadian header accent */}
        <div
          className="flex-shrink-0 px-5 pt-5 pb-3 border-b transition-all duration-500"
          style={{ background: circadianGradient, borderColor: circadianBorderColor }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <DialogTitle className="font-display text-lg mb-0.5 flex items-center gap-2">
                <HeaderIcon className="h-4 w-4" />
                {headerTitle}
                {isEditMode && (
                  <Badge variant="secondary" className="text-[9px] font-normal">Editing</Badge>
                )}
              </DialogTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {streakData?.current_checkin_streak ? (
                  <span className="inline-flex items-center gap-1 text-status-orange">
                    <Flame className="h-3 w-3" />
                    {streakData.current_checkin_streak}d streak
                  </span>
                ) : null}
                {whoopMetrics && mode === 'evening' && (
                  <Badge variant="secondary" className="text-[9px] font-normal px-1.5 py-0 gap-1">
                    <span className="text-status-green">●</span> WHOOP synced
                  </Badge>
                )}
                {powerHourTotals && mode === 'evening' && (
                  <Badge variant="secondary" className="text-[9px] font-normal px-1.5 py-0 gap-1">
                    <span className="text-status-yellow">⚡</span> Power Hour data
                  </Badge>
                )}
                {calendarData && calendarData.customerMeetingCount > 0 && mode === 'evening' && (
                  <Badge variant="secondary" className="text-[9px] font-normal px-1.5 py-0 gap-1">
                    <span className="text-primary">📅</span> {calendarData.customerMeetingCount} mtgs
                  </Badge>
                )}
              </div>
            </div>
            {mode === 'evening' ? (
              <ScoreRing score={score} total={6} goalMet={goalMet} />
            ) : (
              <ModeToggle mode={mode} onToggle={setMode} />
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <DayStrip selectedDate={selectedDate} onSelect={setSelectedDate} />
            </div>
            {mode === 'morning' ? null : (
              <ModeToggle mode={mode} onToggle={setMode} />
            )}
          </div>
        </div>

        {/* #1 - Swipeable content area */}
        <motion.div
          className="flex-1 overflow-y-auto px-5 pb-5 space-y-4 pt-4"
          onPanEnd={handlePanEnd}
          style={{ touchAction: 'pan-y' }}
        >
          <AnimatePresence mode="wait">
            {mode === 'morning' ? (
              <motion.div
                key="morning"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <MorningView
                  yesterdayEntry={yesterdayEntry}
                  weeklyReview={weeklyReview}
                  nudgeData={nudgeData}
                  whoopMetrics={whoopMetrics}
                  streakData={streakData}
                  data={data}
                  update={update}
                  onSwitchToEvening={() => setMode('evening')}
                  todayEvents={todayEvents}
                  lastEntry={lastEntry}
                  weekDaysLogged={weekDaysLogged}
                />
              </motion.div>
            ) : (
              <motion.div
                key="evening"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                <EveningView
                  data={data}
                  update={update}
                  targets={targets}
                  score={score}
                  goalMet={goalMet}
                  showExtras={showExtras}
                  setShowExtras={setShowExtras}
                  showLeading={showLeading}
                  setShowLeading={setShowLeading}
                  showInsights={showInsights}
                  setShowInsights={setShowInsights}
                  weeklyInsights={weeklyInsights}
                  rollingAvg={rollingAvg}
                  quickLogMode={quickLogMode}
                  weekDaysLogged={weekDaysLogged}
                  existingEntry={existingEntry}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Footer */}
        <div
          className="flex-shrink-0 px-5 py-3 border-t flex items-center justify-between backdrop-blur-sm transition-all duration-500"
          style={{ background: circadianGradient, borderColor: circadianBorderColor }}
        >
          <div className="flex items-center gap-2">
            {mode === 'evening' ? (
              <>
                <span className={cn(
                  "text-lg font-bold font-mono",
                  goalMet ? "text-status-green" : "text-muted-foreground"
                )}>
                  {score}/6
                </span>
                <span className="text-xs text-muted-foreground">
                  {goalMet ? '✓ Goal met' : `Need ${Math.max(0, 4 - score)} more`}
                </span>
                {/* #6 - Quick-log toggle */}
                <button
                  onClick={() => setQuickLogMode(!quickLogMode)}
                  className={cn(
                    "ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all border",
                    quickLogMode
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-secondary/50 text-muted-foreground border-border/50 hover:text-foreground"
                  )}
                >
                  <Zap className="h-3 w-3" />
                  Quick
                </button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Sun className="h-3.5 w-3.5" />
                Set your intention for the day
              </span>
            )}
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5 px-5"
            size="sm"
          >
            {saving ? 'Saving…' : mode === 'morning' ? 'Check In' : (isEditMode ? 'Update' : 'Save')}
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
