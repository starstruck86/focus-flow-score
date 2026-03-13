import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useRecordCheckIn } from '@/hooks/useStreakData';
import { format } from 'date-fns';
import { toast } from 'sonner';

// --- Types ---
interface ScorecardData {
  dials: number;
  conversations: number;
  prospectsAdded: number;
  meetingsSet: number;
  customerMeetingsHeld: number;
  opportunitiesCreated: number;
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

// --- Inline Editable Counter ---
function MetricCounter({
  label,
  value,
  target,
  onChange,
  icon: Icon,
}: {
  label: string;
  value: number;
  target: number;
  onChange: (v: number) => void;
  icon: React.ElementType;
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
      {/* Progress bar background */}
      <div
        className="absolute inset-0 transition-all duration-500 ease-out"
        style={{
          width: `${pct}%`,
          background: atTarget
            ? 'hsl(var(--status-green) / 0.08)'
            : 'hsl(var(--primary) / 0.04)',
        }}
      />
      <div className="relative flex items-center justify-between p-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
            atTarget ? "bg-status-green/20" : "bg-primary/10"
          )}>
            <Icon className={cn("h-3.5 w-3.5 transition-colors", atTarget ? "text-status-green" : "text-primary")} />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium block leading-tight">{label}</span>
            <span className={cn(
              "text-[10px] transition-colors",
              atTarget ? "text-status-green" : "text-muted-foreground"
            )}>
              {atTarget ? '✓ Target hit' : `Target: ${target}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full"
            onClick={() => onChange(Math.max(0, value - 1))}
          >
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
            <button
              onClick={startEdit}
              className={cn(
                "w-10 text-center font-mono text-lg font-bold rounded py-0.5 transition-colors",
                atTarget ? "text-status-green" : "text-foreground"
              )}
            >
              {value}
            </button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full"
            onClick={() => onChange(value + 1)}
          >
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
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="5"
          className="stroke-secondary" />
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
        <span className={cn(
          "text-xl font-bold font-mono leading-none",
          goalMet ? "text-status-green" : "text-foreground"
        )}>
          {score}
        </span>
        <span className="text-[10px] text-muted-foreground">of {total}</span>
      </div>
    </div>
  );
}

// --- Nudge Hook ---
function useJournalNudge() {
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
    staleTime: 5 * 60 * 1000,
  });
}

// --- Targets Hook ---
function useDailyTargets(): DailyTargets {
  const { data } = useQuery({
    queryKey: ['quota-targets-scorecard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quota_targets')
        .select('target_dials_per_day, target_connects_per_day, target_meetings_set_per_week, target_opps_created_per_week, target_customer_meetings_per_week, target_accounts_researched_per_day')
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
  };
}

// --- Streak Hook ---
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

// --- WHOOP Data Hook ---
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

// --- Main Component ---
interface DailyScorecardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date?: string;
  initialData?: Partial<ScorecardData>;
}

export function DailyScorecardModal({
  open,
  onOpenChange,
  date,
  initialData,
}: DailyScorecardModalProps) {
  const entryDate = date || format(new Date(), 'yyyy-MM-dd');
  const [data, setData] = useState<ScorecardData>({ ...DEFAULT_SCORECARD, ...initialData });
  const [saving, setSaving] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const [whoopApplied, setWhoopApplied] = useState(false);
  const queryClient = useQueryClient();
  const targets = useDailyTargets();
  const { data: nudgeData } = useJournalNudge();
  const { data: streakData } = useCurrentStreak();
  const { data: whoopMetrics } = useWhoopMetrics(entryDate);
  const recordCheckIn = useRecordCheckIn();

  useEffect(() => {
    if (open) {
      setData({ ...DEFAULT_SCORECARD, ...initialData });
      setShowExtras(false);
    }
  }, [open, initialData]);

  const update = <K extends keyof ScorecardData>(key: K, val: ScorecardData[K]) => {
    setData(prev => ({ ...prev, [key]: val }));
  };

  // Calculate score: how many of 6 core metrics hit target
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

  const handleSave = async () => {
    setSaving(true);
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
        date: entryDate,
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
        daily_score: score,
        sales_productivity: Math.round((score / 6) * 100),
        goal_met: goalMet,
        checked_in: true,
        check_in_timestamp: new Date().toISOString(),
        accounts_researched: 0,
        contacts_prepped: 0,
        admin_heavy_day: false,
        travel_day: data.biggestBlocker === 'travel_ooo',
        sleep_hours: 7,
        energy: 3,
        focus_quality: 3,
        stress: 3,
        clarity: 3,
        distractions: 'low',
        context_switching: 'low',
      };

      const { error } = await supabase
        .from('daily_journal_entries')
        .upsert(payload, { onConflict: 'user_id,date' });

      if (error) throw error;

      await recordCheckIn.mutateAsync({
        date: entryDate,
        method: 'scorecard',
        dailyScore: score,
        productivityScore: Math.round((score / 6) * 100),
        isEligible: true,
        goalMet,
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
            .eq('date', entryDate)
            .eq('user_id', user.id);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['journal-nudge'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entry'] });
      queryClient.invalidateQueries({ queryKey: ['streak-events'] });
      queryClient.invalidateQueries({ queryKey: ['streak-summary'] });

      toast.success('Daily scorecard saved!', {
        description: goalMet
          ? `🔥 ${score}/6 targets hit! Streak continues.`
          : `${score}/6 targets hit. Keep pushing tomorrow!`,
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Save failed:', error);
      toast.error('Failed to save scorecard');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header with Score Ring */}
        <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="font-display text-lg mb-1">Log Your Day</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {format(new Date(entryDate), 'EEEE, MMM d')}
                {streakData?.current_checkin_streak ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-status-orange">
                    <Flame className="h-3 w-3" />
                    {streakData.current_checkin_streak}d streak
                  </span>
                ) : null}
              </p>
            </div>
            <ScoreRing score={score} total={6} goalMet={goalMet} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4 pt-4">
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

          {/* Yesterday's Commitment */}
          {nudgeData?.yesterdayCommitment && (
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
              <MetricCounter label="Dials" value={data.dials} target={targets.dials} onChange={v => update('dials', v)} icon={Phone} />
              <MetricCounter label="Conversations" value={data.conversations} target={targets.conversations} onChange={v => update('conversations', v)} icon={MessageSquare} />
              <MetricCounter label="Prospects Added" value={data.prospectsAdded} target={targets.prospectsAdded} onChange={v => update('prospectsAdded', v)} icon={Users} />
              <MetricCounter label="Meetings Set" value={data.meetingsSet} target={targets.meetingsSet} onChange={v => update('meetingsSet', v)} icon={Calendar} />
              <MetricCounter label="Meetings Held" value={data.customerMeetingsHeld} target={targets.customerMeetings} onChange={v => update('customerMeetingsHeld', v)} icon={Calendar} />
              <MetricCounter label="Opps Created" value={data.opportunitiesCreated} target={targets.oppsCreated} onChange={v => update('opportunitiesCreated', v)} icon={TrendingUp} />
            </div>
          </div>

          {/* Expandable extras */}
          <button
            onClick={() => setShowExtras(!showExtras)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                {/* Prospecting Block */}
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

                {/* Deep Work */}
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

                {/* Pipeline Moved */}
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

                {/* Biggest Blocker */}
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
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-border/50 flex items-center justify-between bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-lg font-bold font-mono",
              goalMet ? "text-status-green" : "text-muted-foreground"
            )}>
              {score}/6
            </span>
            <span className="text-xs text-muted-foreground">
              {goalMet ? '✓ Goal met' : `Need ${Math.max(0, 4 - score)} more`}
            </span>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5 px-5"
            size="sm"
          >
            {saving ? 'Saving…' : 'Save'}
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
