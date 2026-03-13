import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
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
  ChevronRight,
  Check,
  Lightbulb,
  AlertCircle,
  Sparkles,
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
import { useSaveJournalEntry } from '@/hooks/useDailyJournal';
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
  focusMode: 'new-logo' | 'balanced' | 'expansion';
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
  { value: 'none', label: 'No blockers' },
  { value: 'cant_reach_dms', label: "Can't reach DMs" },
  { value: 'stuck_deals', label: 'Stuck deals' },
  { value: 'not_enough_at_bats', label: 'Not enough at-bats' },
  { value: 'admin_overload', label: 'Admin overload' },
  { value: 'travel_ooo', label: 'Travel / OOO' },
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
  focusMode: 'balanced',
  win: '',
  tomorrowPriority: '',
  dailyReflection: '',
  yesterdayCommitmentMet: null,
};

// --- Counter Component ---
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
  const atTarget = value >= target;
  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg border transition-colors",
      atTarget ? "bg-status-green/5 border-status-green/30" : "bg-secondary/30 border-transparent"
    )}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={cn(
          "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0",
          atTarget ? "bg-status-green/20" : "bg-primary/10"
        )}>
          <Icon className={cn("h-3.5 w-3.5", atTarget ? "text-status-green" : "text-primary")} />
        </div>
        <div className="min-w-0">
          <span className="text-sm font-medium block">{label}</span>
          <span className={cn(
            "text-[10px]",
            atTarget ? "text-status-green" : "text-muted-foreground"
          )}>
            Target: {target}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <button
          onClick={() => {
            const input = prompt(`Enter ${label}:`, value.toString());
            if (input !== null) {
              const num = parseInt(input, 10);
              if (!isNaN(num) && num >= 0) onChange(num);
            }
          }}
          className={cn(
            "w-10 text-center font-mono text-lg font-bold rounded py-0.5",
            atTarget ? "text-status-green" : "text-foreground"
          )}
        >
          {value}
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
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
    dials: parseFloat(data?.target_dials_per_day ?? '60'),
    conversations: parseFloat(data?.target_connects_per_day ?? '6'),
    meetingsSet: Math.ceil(parseFloat(data?.target_meetings_set_per_week ?? '3') / 5),
    customerMeetings: Math.ceil(parseFloat(data?.target_customer_meetings_per_week ?? '8') / 5),
    oppsCreated: Math.ceil(parseFloat(data?.target_opps_created_per_week ?? '1') / 5),
    prospectsAdded: parseFloat(data?.target_accounts_researched_per_day ?? '10'),
  };
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
  const [analyzingSentiment, setAnalyzingSentiment] = useState(false);
  const queryClient = useQueryClient();
  const targets = useDailyTargets();
  const { data: nudgeData, isLoading: nudgeLoading } = useJournalNudge();
  const saveJournal = useSaveJournalEntry();
  const recordCheckIn = useRecordCheckIn();

  useEffect(() => {
    if (open) {
      setData({ ...DEFAULT_SCORECARD, ...initialData });
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
      // Analyze sentiment if reflection provided
      let sentimentScore: number | null = null;
      let sentimentLabel: string | null = null;

      if (data.dailyReflection.trim().length >= 5) {
        setAnalyzingSentiment(true);
        try {
          const { data: sentimentData, error: sentimentError } = await supabase.functions.invoke(
            'analyze-sentiment',
            { body: { reflection: data.dailyReflection } }
          );
          if (!sentimentError && sentimentData) {
            sentimentScore = sentimentData.sentiment_score;
            sentimentLabel = sentimentData.sentiment_label;
          }
        } catch {
          // Non-blocking — proceed without sentiment
        }
        setAnalyzingSentiment(false);
      }

      // Save via existing hook (maps to the existing DB structure)
      await saveJournal.mutateAsync({
        date: entryDate,
        activity: {
          dials: data.dials,
          conversations: data.conversations,
          prospectsAdded: data.prospectsAdded,
          managerPlusMessages: 0,
          manualEmails: 0,
          automatedEmails: 0,
          meetingsSet: data.meetingsSet,
          customerMeetingsHeld: data.customerMeetingsHeld,
          opportunitiesCreated: data.opportunitiesCreated,
          personalDevelopment: false,
          prospectingBlockMinutes: data.ranProspectingBlock ? data.prospectingBlockMinutes : 0,
          accountDeepWorkMinutes: data.didDeepWork ? data.accountDeepWorkMinutes : 0,
          expansionTouchpoints: 0,
          focusMode: data.focusMode,
        },
        preparedness: {
          accountsResearched: 0,
          contactsPrepped: 0,
          preppedForAllCallsTomorrow: null,
          callsNeedPrepCount: 0,
          callsPrepNote: '',
          meetingPrepDone: null,
          meetingsUnpreparedFor: null,
          meetingsUnpreparedNote: '',
        },
        recovery: {
          sleepHours: 7,
          energy: 3,
          focusQuality: 3,
          stress: 3,
          clarity: 3,
          distractions: 'low',
          contextSwitching: 'low',
          adminHeavyDay: false,
          travelDay: data.biggestBlocker === 'travel_ooo',
          whatDrainedYou: '',
          whatWorkedToday: data.win,
        },
        markAsCheckedIn: true,
      });

      // Update new columns directly
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('daily_journal_entries')
          .update({
            pipeline_moved: data.pipelineMoved,
            biggest_blocker: data.biggestBlocker,
            tomorrow_priority: data.tomorrowPriority || null,
            daily_reflection: data.dailyReflection || null,
            sentiment_score: sentimentScore,
            sentiment_label: sentimentLabel,
            yesterday_commitment_met: data.yesterdayCommitmentMet,
          } as any)
          .eq('date', entryDate)
          .eq('user_id', user.id);
      }

      // Record for streak
      await recordCheckIn.mutateAsync({
        date: entryDate,
        method: 'scorecard',
        dailyScore: score,
        productivityScore: Math.round((score / 6) * 100),
        isEligible: true,
        goalMet,
      });

      queryClient.invalidateQueries({ queryKey: ['journal-nudge'] });

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
      setAnalyzingSentiment(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center justify-between">
            <span className="font-display text-lg">Daily Scorecard</span>
            <Badge
              variant="outline"
              className={cn(
                "text-sm font-mono font-bold px-3 py-1",
                goalMet
                  ? "border-status-green text-status-green bg-status-green/10"
                  : "border-muted-foreground"
              )}
            >
              {score}/6
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">
          {/* AI Nudge */}
          {nudgeData?.nudge && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-lg bg-primary/5 border border-primary/20"
            >
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-foreground leading-snug">{nudgeData.nudge}</p>
              </div>
            </motion.div>
          )}

          {/* Yesterday's Commitment */}
          {nudgeData?.yesterdayCommitment && (
            <div className="p-3 rounded-lg bg-secondary/50 border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Yesterday's commitment
                </span>
              </div>
              <p className="text-sm mb-2">"{nudgeData.yesterdayCommitment}"</p>
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

          {/* Focus Mode */}
          <div className="flex gap-2">
            {(['new-logo', 'balanced', 'expansion'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={data.focusMode === mode ? 'default' : 'secondary'}
                onClick={() => update('focusMode', mode)}
                className="flex-1 text-xs h-8"
              >
                {mode === 'new-logo' ? '🎯 Hunt' : mode === 'expansion' ? '📈 Expand' : '⚖️ Balanced'}
              </Button>
            ))}
          </div>

          {/* Core Metrics */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Activity — Actual vs Target
            </Label>
            <div className="space-y-1.5">
              <MetricCounter label="Dials" value={data.dials} target={targets.dials} onChange={v => update('dials', v)} icon={Phone} />
              <MetricCounter label="Conversations" value={data.conversations} target={targets.conversations} onChange={v => update('conversations', v)} icon={MessageSquare} />
              <MetricCounter label="Prospects Added" value={data.prospectsAdded} target={targets.prospectsAdded} onChange={v => update('prospectsAdded', v)} icon={Users} />
              <MetricCounter label="Meetings Set" value={data.meetingsSet} target={targets.meetingsSet} onChange={v => update('meetingsSet', v)} icon={Calendar} />
              <MetricCounter label="Meetings Held" value={data.customerMeetingsHeld} target={targets.customerMeetings} onChange={v => update('customerMeetingsHeld', v)} icon={Calendar} />
              <MetricCounter label="Opps Created" value={data.opportunitiesCreated} target={targets.oppsCreated} onChange={v => update('opportunitiesCreated', v)} icon={TrendingUp} />
            </div>
          </div>

          {/* Binary Toggles */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Did you…
            </Label>

            {/* Prospecting Block */}
            <div className="p-3 rounded-lg bg-secondary/30 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm">
                  <Timer className="h-4 w-4 text-primary" />
                  Run a prospecting block?
                </Label>
                <Switch
                  checked={data.ranProspectingBlock}
                  onCheckedChange={v => update('ranProspectingBlock', v)}
                />
              </div>
              {data.ranProspectingBlock && (
                <div className="flex gap-2 pt-1">
                  {TIME_CHIPS.map(min => (
                    <Button
                      key={min}
                      size="sm"
                      variant={data.prospectingBlockMinutes === min ? 'default' : 'outline'}
                      onClick={() => update('prospectingBlockMinutes', min)}
                      className="text-xs h-7 flex-1"
                    >
                      {min}m
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* Deep Work */}
            <div className="p-3 rounded-lg bg-secondary/30 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm">
                  <Timer className="h-4 w-4 text-primary" />
                  Account deep work?
                </Label>
                <Switch
                  checked={data.didDeepWork}
                  onCheckedChange={v => update('didDeepWork', v)}
                />
              </div>
              {data.didDeepWork && (
                <div className="flex gap-2 pt-1">
                  {TIME_CHIPS.map(min => (
                    <Button
                      key={min}
                      size="sm"
                      variant={data.accountDeepWorkMinutes === min ? 'default' : 'outline'}
                      onClick={() => update('accountDeepWorkMinutes', min)}
                      className="text-xs h-7 flex-1"
                    >
                      {min}m
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* Pipeline Moved */}
            <div className="p-3 rounded-lg bg-secondary/30">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Pipeline moved ($)
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={data.pipelineMoved || ''}
                  onChange={e => update('pipelineMoved', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-28 text-right font-mono text-sm h-8"
                />
              </div>
            </div>
          </div>

          {/* Biggest Blocker */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Biggest blocker today
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {BLOCKER_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={data.biggestBlocker === opt.value ? 'default' : 'outline'}
                  onClick={() => update('biggestBlocker', data.biggestBlocker === opt.value ? null : opt.value)}
                  className="text-xs h-7"
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* #1 Win */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              #1 Win today (optional)
            </Label>
            <Input
              value={data.win}
              onChange={e => update('win', e.target.value)}
              placeholder="Best thing that happened…"
              className="text-sm h-9"
            />
          </div>

          {/* Daily Reflection */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
              Daily Reflection
              <Badge variant="secondary" className="text-[9px] font-normal">sentiment analyzed</Badge>
            </Label>
            <Textarea
              value={data.dailyReflection}
              onChange={e => update('dailyReflection', e.target.value)}
              placeholder="How did today go? What's on your mind? Be honest — this is for you..."
              rows={3}
              className="text-sm"
            />
          </div>

          {/* Tomorrow's Commitment */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Tomorrow's #1 commitment
            </Label>
            <Textarea
              value={data.tomorrowPriority}
              onChange={e => update('tomorrowPriority', e.target.value)}
              placeholder="What's the one thing you MUST do tomorrow?"
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-3 border-t flex items-center justify-between bg-background">
          <div className="text-sm">
            <span className={cn(
              "font-bold font-mono",
              goalMet ? "text-status-green" : "text-muted-foreground"
            )}>
              {score}/6
            </span>
            <span className="text-muted-foreground ml-1.5 text-xs">
              {goalMet ? '✓ Goal met' : `Need ${4 - score} more`}
            </span>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5"
          >
            {analyzingSentiment ? 'Analyzing…' : saving ? 'Saving…' : 'Save Scorecard'}
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
