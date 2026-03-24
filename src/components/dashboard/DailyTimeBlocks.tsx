import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/store/useStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Clock, Zap, Phone, Users, BookOpen, Coffee, 
  BriefcaseBusiness, Target, RefreshCw, Star,
  ChevronDown, ChevronUp, MessageSquare, Lightbulb,
  ThumbsUp, ThumbsDown, RotateCcw, CheckCircle2,
  ArrowRight, ExternalLink, Pencil, Check, X, GripVertical,
  Rocket, Shield, MoreVertical, EyeOff, Link2, Building2,
  Settings2, Hammer, AlertTriangle, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CalendarScreenshotDrop } from './CalendarScreenshotDrop';
import { DailyPlanPreferences } from './DailyPlanPreferences';
import { RustBusterQuickLinks } from './RustBusterQuickLinks';
import { isRustBusterBlock } from '@/lib/rustBusterLinks';
import { useWeeklyResearchQueue, type AccountState, type WeeklyAssignments } from '@/hooks/useWeeklyResearchQueue';
import type { CalendarScreenshotEvent } from '@/types/dashboard';
import type { Json } from '@/integrations/supabase/types';
import { generateTraceId } from '@/lib/appError';
import { buildLocalFallbackPlan, getVisiblePlanBlocks, summarizePlanDelta, type RebuildFallbackBlock, type RebuildPlanBlock } from '@/lib/dailyPlanRebuild';
import { QUEUE_CHANGED_EVENT } from '@/hooks/useWeeklyResearchQueue';
import { calculateDialCapacity, getActualDials, DAILY_DIALS_MIN, DAILY_DIALS_TARGET, BLOCK_MVPS } from '@/lib/mvpBlockModel';

/** Inline contact count for linked account pills */
const LinkedAccountContactCount = memo(function LinkedAccountContactCount({ accountId }: { accountId: string }) {
  const { contacts } = useStore();
  const count = useMemo(() => contacts.filter(c => c.accountId === accountId).length, [contacts, accountId]);
  if (count === 0) return null;
  return <span className="text-[9px] font-mono text-muted-foreground ml-0.5">({count})</span>;
});

interface TimeBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: 'prospecting' | 'meeting' | 'research' | 'admin' | 'break' | 'pipeline' | 'prep' | 'build';
  workstream?: 'new_logo' | 'renewal' | 'general';
  goals: string[];
  reasoning: string;
  actual_dials?: number;
  actual_emails?: number;
  linked_accounts?: { id: string; name: string }[];
  build_steps?: { step: string; done: boolean }[];
}

interface DailyPlan {
  id: string;
  plan_date: string;
  blocks: TimeBlock[];
  updated_at?: string;
  meeting_load_hours: number;
  focus_hours_available: number;
  ai_reasoning: string;
  key_metric_targets?: Record<string, number>;
  completed_goals?: string[]; // "blockIdx-goalIdx" format
  block_feedback?: { blockIdx: number; thumbs: 'up' | 'down' }[];
  feedback_rating?: number;
  feedback_text?: string;
  recast_at?: string | null;
  dismissed_block_indices?: number[];
}

interface RebuildDiagnostics {
  trace_id: string;
  request_source: 'generate' | 'manual_rebuild' | 'screenshot_rebuild';
  stages: Array<{ stage: string; detail: string; at: string }>;
  used_fallback: boolean;
  fallback_reason?: string | null;
  failure_stage?: string | null;
  exact_failure_reason?: string | null;
  change_summary?: string | null;
  preserved_state?: {
    dismissed_meetings: string;
    recast_state: string;
    weekly_queue_progress: string;
  };
}

interface GeneratePlanResponse extends DailyPlan {
  is_fallback?: boolean;
  rebuild_diagnostics?: RebuildDiagnostics;
}

function parseGeneratePlanResponse(rawText: string) {
  if (!rawText) return { parsed: {} as GeneratePlanResponse | { error?: string }, parseError: null };

  try {
    return {
      parsed: JSON.parse(rawText) as GeneratePlanResponse | { error?: string },
      parseError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    return {
      parsed: { error: `Planner returned invalid JSON: ${message}` },
      parseError: message,
    };
  }
}

const TYPE_CONFIG: Record<string, { icon: typeof Clock; color: string; bg: string }> = {
  prospecting: { icon: Phone, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20' },
  meeting: { icon: Users, color: 'text-purple-500', bg: 'bg-purple-500/10 border-purple-500/20' },
  research: { icon: BookOpen, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20' },
  admin: { icon: BriefcaseBusiness, color: 'text-muted-foreground', bg: 'bg-muted/50 border-muted-foreground/20' },
  break: { icon: Coffee, color: 'text-green-500', bg: 'bg-green-500/10 border-green-500/20' },
  pipeline: { icon: Target, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20' },
  prep: { icon: Lightbulb, color: 'text-cyan-500', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  build: { icon: Hammer, color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/20' },
};

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function getCurrentBlockIndex(blocks: TimeBlock[]): number {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return blocks.findIndex(b => {
    const [sh, sm] = b.start_time.split(':').map(Number);
    const [eh, em] = b.end_time.split(':').map(Number);
    return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
  });
}

function getBlockDurationMinutes(block: TimeBlock): number {
  const [sh, sm] = block.start_time.split(':').map(Number);
  const [eh, em] = block.end_time.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

// Map block types to quick actions
const BLOCK_ACTIONS: Record<string, { label: string; route?: string; dispatch?: string }> = {
  prospecting: { label: '⚡ Start Power Hour', dispatch: 'power-hour' },
  research: { label: '→ Open Accounts', route: '/outreach' },
  pipeline: { label: '→ Open Pipeline', route: '/quota' },
  prep: { label: '→ Open Accounts', route: '/outreach' },
  meeting: { label: '→ Meeting Prep', dispatch: 'scroll-meeting-prep' },
  build: { label: '→ Open Outreach', route: '/outreach' },
};

const DEFAULT_BUILD_STEPS = [
  { step: 'Select 3 target accounts', done: false },
  { step: 'Research companies', done: false },
  { step: 'Identify contacts', done: false },
  { step: 'Find emails/phone numbers', done: false },
  { step: 'Add to cadence', done: false },
];

const WORKSTREAM_CONFIG: Record<string, { label: string; icon: typeof Rocket; color: string }> = {
  new_logo: { label: 'New Logo', icon: Rocket, color: 'text-blue-500' },
  renewal: { label: 'Renewal', icon: Shield, color: 'text-status-green' },
  general: { label: 'General', icon: BriefcaseBusiness, color: 'text-muted-foreground' },
};

export function DailyTimeBlocks() {
  const { user } = useAuth();
  const { opportunities, accounts } = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    todayAccounts: queueTodayAccounts,
    todayKey: queueTodayKey,
    isEmpty: queueEmpty,
    generateQueue,
    advanceState,
    removeAccount,
    addAccount,
    dailyProgress: queueDailyProgress,
    weeklyResearched,
    weeklyAddedToCadence,
    weeklyTotal,
    assignments: queueAssignments,
    DAY_KEYS: queueDayKeys,
    loading: queueLoading,
  } = useWeeklyResearchQueue();
  const [showQueueAdd, setShowQueueAdd] = useState(false);
  const [queueAddQuery, setQueueAddQuery] = useState('');
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editGoals, setEditGoals] = useState<string[]>([]);
  const [dismissedBlocks, setDismissedBlocks] = useState<Set<number>>(() => new Set());
  const [linkOppBlockIdx, setLinkOppBlockIdx] = useState<number | null>(null);
  const [blockOppLinks, setBlockOppLinks] = useState<Map<number, { id: string; name: string }>>(new Map());
  const [showPreferences, setShowPreferences] = useState(false);
  const [accountSearchBlockIdx, setAccountSearchBlockIdx] = useState<number | null>(null);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<{
    traceId: string;
    stage: string;
    message: string;
    usedFallback?: boolean;
  } | null>(null);

  const { data: plan, isLoading } = useQuery({
    queryKey: ['daily-time-blocks', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_time_blocks' as 'daily_time_blocks')
        .select('*')
        .eq('plan_date', todayStr)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DailyPlan | null;
    },
    enabled: !!user,
  });

  // Load persisted dismissed blocks from plan data
  useEffect(() => {
    if (plan?.dismissed_block_indices?.length) {
      setDismissedBlocks(new Set(plan.dismissed_block_indices));
    } else {
      setDismissedBlocks(new Set());
    }
  }, [plan?.id]);

  // Auto-refresh current block indicator every 60s
  useEffect(() => {
    if (!plan?.blocks) return;
    setCurrentIdx(getCurrentBlockIndex(plan.blocks));
    const interval = setInterval(() => {
      setCurrentIdx(getCurrentBlockIndex(plan.blocks));
    }, 60_000);
    return () => clearInterval(interval);
  }, [plan?.blocks]);

  // ── Queue↔Block sync: prune orphaned linked_accounts when queue changes ──
  useEffect(() => {
    function handleQueueChanged(e: Event) {
      const queueIds = new Set<string>((e as CustomEvent).detail?.queueIds ?? []);
      if (!plan?.blocks || queueIds.size === 0) return;
      const blocks = plan.blocks as TimeBlock[];
      let dirty = false;
      const updated = blocks.map(block => {
        if (!block.linked_accounts?.length) return block;
        const filtered = block.linked_accounts.filter(a => queueIds.has(a.id));
        if (filtered.length !== block.linked_accounts.length) {
          dirty = true;
          return { ...block, linked_accounts: filtered };
        }
        return block;
      });
      if (dirty) {
        queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks: updated });
        // Persist pruned blocks
        supabase
          .from('daily_time_blocks' as 'daily_time_blocks')
          .update({ blocks: updated as unknown as Json })
          .eq('id', plan.id)
          .then(() => {});
      }
    }
    window.addEventListener(QUEUE_CHANGED_EVENT, handleQueueChanged);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, handleQueueChanged);
  }, [plan, todayStr, queryClient]);

  const generateMutation = useMutation({
    mutationFn: async (opts: { confirmedScreenshotEvents?: CalendarScreenshotEvent[]; source?: 'generate' | 'manual_rebuild' | 'screenshot_rebuild' } | void) => {
      const screenshotEvents = opts && 'confirmedScreenshotEvents' in opts ? opts.confirmedScreenshotEvents : undefined;
      const source = opts && 'source' in opts && opts.source ? opts.source : 'generate';
      const traceId = generateTraceId();
      const visibleBlocks = getVisiblePlanBlocks(plan?.blocks as TimeBlock[] | undefined, dismissedBlocks);
      const dismissedMeetingBlocks = Array.from(dismissedBlocks)
        .sort((a, b) => a - b)
        .map((index) => (plan?.blocks as TimeBlock[] | undefined)?.[index])
        .filter((block): block is TimeBlock => !!block && block.type === 'meeting');
      const linkedOpportunities = Array.from(blockOppLinks.entries()).map(([blockIdx, opp]) => ({
        block_index: blockIdx,
        block_label: (plan?.blocks as TimeBlock[] | undefined)?.[blockIdx]?.label ?? null,
        opportunity_id: opp.id,
        opportunity_name: opp.name,
      }));

      setRebuildStatus({
        traceId,
        stage: 'request_sent',
        message: source === 'manual_rebuild' ? 'Sending rebuild request…' : 'Generating plan…',
      });

      const requestBody = {
        date: todayStr,
        confirmedScreenshotEvents: screenshotEvents,
        rebuildContext: {
          source,
          dismissed_blocks: source === 'manual_rebuild' ? dismissedMeetingBlocks : [],
          linked_opportunities: source === 'manual_rebuild' ? linkedOpportunities : [],
          current_visible_blocks: visibleBlocks,
        },
      };

      const persistLocalFallback = async (reason: string) => {
        if (!user) throw new Error('Not authenticated');

        setRebuildStatus({
          traceId,
          stage: 'fallback_building',
          message: `Backend rebuild transport failed: ${reason}. Applying local fallback…`,
          usedFallback: true,
        });

        const fallbackPlan = buildLocalFallbackPlan({
          allBlocks: (plan?.blocks as RebuildFallbackBlock[] | undefined) || [],
          currentVisibleBlocks: visibleBlocks as RebuildFallbackBlock[],
          dismissedMeetingBlocks,
          reason,
        });

        const { data: saved, error: saveError } = await supabase
          .from('daily_time_blocks' as 'daily_time_blocks')
          .upsert({
            user_id: user.id,
            plan_date: todayStr,
            blocks: fallbackPlan.blocks as unknown as Json,
            meeting_load_hours: fallbackPlan.meeting_load_hours,
            focus_hours_available: fallbackPlan.focus_hours_available,
            ai_reasoning: `[FALLBACK] ${fallbackPlan.day_strategy}`,
            key_metric_targets: fallbackPlan.key_metric_targets as unknown as Json,
            completed_goals: [],
            block_feedback: [],
            dismissed_block_indices: [],
            recast_at: null,
          }, { onConflict: 'user_id,plan_date' })
          .select()
          .single();

        if (saveError) {
          setRebuildStatus({
            traceId,
            stage: 'failed',
            message: `Fallback save failed: ${saveError.message}`,
            usedFallback: true,
          });
          throw new Error(`Fallback save failed: ${saveError.message}`);
        }

        const changeSummary = summarizePlanDelta(visibleBlocks as RebuildPlanBlock[], fallbackPlan.blocks);

        return {
          ...(saved as unknown as DailyPlan),
          is_fallback: true,
          rebuild_diagnostics: {
            trace_id: traceId,
            request_source: source,
            stages: [
              { stage: 'button_click', detail: 'Rebuild button handler invoked', at: new Date().toISOString() },
              { stage: 'request_sent', detail: 'Browser request sent to planner', at: new Date().toISOString() },
              { stage: 'transport_failed', detail: reason, at: new Date().toISOString() },
              { stage: 'local_fallback_generated', detail: 'Local fallback plan generated', at: new Date().toISOString() },
              { stage: 'local_fallback_persisted', detail: 'Local fallback plan persisted', at: new Date().toISOString() },
            ],
            used_fallback: true,
            fallback_reason: reason,
            failure_stage: 'browser_transport',
            exact_failure_reason: reason,
            change_summary: changeSummary,
            preserved_state: {
              dismissed_meetings: 'reset_after_apply',
              recast_state: 'reset_to_null',
              weekly_queue_progress: 'preserved',
            },
          },
        } as GeneratePlanResponse;
      };

      try {
        const response = await authenticatedFetch({
          functionName: 'generate-time-blocks',
          body: requestBody,
          traceId,
          componentName: 'DailyTimeBlocks',
          retry: false,
          timeoutMs: 30_000,
        });

        const rawText = await response.text();
        const { parsed, parseError } = parseGeneratePlanResponse(rawText);

        if (!response.ok) {
          const reason = 'error' in parsed && parsed.error
            ? parsed.error
            : rawText?.trim() || `HTTP ${response.status}`;
          return await persistLocalFallback(reason);
        }

        if (parseError) {
          return await persistLocalFallback(`Planner response parsing failed: ${parseError}`);
        }

        const data = parsed as GeneratePlanResponse;
        if (!data?.blocks?.length) {
          return await persistLocalFallback('Planner returned no blocks');
        }

        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown transport failure';
        return await persistLocalFallback(message);
      }
    },
    onSuccess: (data, variables) => {
      const previousVisible = getVisiblePlanBlocks(plan?.blocks as TimeBlock[] | undefined, dismissedBlocks) as RebuildPlanBlock[];
      const changeSummary = data.rebuild_diagnostics?.change_summary || summarizePlanDelta(previousVisible, data.blocks as RebuildPlanBlock[]);

      queryClient.setQueryData(['daily-time-blocks', todayStr], data);
      queryClient.invalidateQueries({ queryKey: ['daily-time-blocks', todayStr] });
      setDismissedBlocks(new Set(data.dismissed_block_indices || []));
      setBlockOppLinks(new Map());

      const traceId = data.rebuild_diagnostics?.trace_id || rebuildStatus?.traceId || generateTraceId();
      const usedFallback = !!data?.is_fallback;
      const source = variables && 'source' in variables && variables.source ? variables.source : 'generate';
      const successPrefix = source === 'manual_rebuild' ? 'Rebuild applied' : 'Plan applied';
      const detail = usedFallback
        ? `Fallback applied: ${data.rebuild_diagnostics?.fallback_reason || 'AI rebuild was unavailable.'}`
        : `${successPrefix} — ${changeSummary}`;

      setRebuildStatus({
        traceId,
        stage: 'applied',
        message: detail,
        usedFallback,
      });

      requestAnimationFrame(() => {
        setRebuildStatus((current) => current ? { ...current, stage: 'rendered', message: `${detail} UI updated.` } : current);
      });

      if (usedFallback) {
        toast.info(`Fallback rebuild applied: ${data.rebuild_diagnostics?.fallback_reason || 'AI rebuild failed.'}`, { duration: 7000 });
      } else {
        toast.success(`${successPrefix}: ${changeSummary}`);
      }
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Failed to generate plan';
      console.error('[DailyTimeBlocks] generate error:', msg);
      toast.error(`Plan generation failed: ${msg}`);
    },
  });

  // Recast mutation — re-optimizes remaining blocks using the recast engine
  const recastMutation = useMutation({
    mutationFn: async () => {
      if (!plan) throw new Error('No plan to recast');
      const { recastDay } = await import('@/data/recast-engine');
      type RBlock = import('@/data/recast-engine').RecastBlock;
      type RInput = import('@/data/recast-engine').RecastInput;

      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
      const completedSet = new Set<string>((plan.completed_goals || []) as string[]);
      const planBlocks = (plan.blocks || []) as TimeBlock[];
      const tgts = (plan.key_metric_targets || {}) as Record<string, number>;

      const act: Record<string, number> = {};
      for (const b of planBlocks) {
        if (b.actual_dials) act.dials = (act.dials || 0) + b.actual_dials;
        if (b.actual_emails) act.emails = (act.emails || 0) + b.actual_emails;
      }
      act.completed_goals = completedSet.size;

      const input: RInput = {
        currentTimeMinutes,
        allBlocks: planBlocks as RBlock[],
        completedGoals: completedSet,
        meetingSchedule: [],
        targets: tgts,
        actuals: act,
        workEndMinutes: 17 * 60, // 5:00 PM hard boundary
      };

      const result = recastDay(input);
      const recastAt = new Date().toISOString();

      const updatedBlocks = result.remainingBlocks as unknown as Json;
      await supabase
        .from('daily_time_blocks' as 'daily_time_blocks')
        .update({
          blocks: updatedBlocks,
          recast_at: recastAt,
        })
        .eq('id', plan.id);

      return {
        result,
        nextPlan: {
          ...plan,
          blocks: result.remainingBlocks as unknown as TimeBlock[],
          recast_at: recastAt,
        },
      };
    },
    onSuccess: ({ result, nextPlan }) => {
      queryClient.setQueryData(['daily-time-blocks', todayStr], nextPlan);
      queryClient.invalidateQueries({ queryKey: ['daily-time-blocks'] });
      const msg = result.droppedBlocks.length > 0
        ? `Recast — dropped ${result.droppedBlocks.length} block(s), ${Math.round(result.minutesRemaining / 60 * 10) / 10}h left`
        : `Recast — ${Math.round(result.minutesRemaining / 60 * 10) / 10}h remaining, all blocks kept`;
      toast.success(msg);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to recast plan');
    },
  });

  // Handle confirmed screenshot events — rebuild plan with them
  const handleScreenshotEventsConfirmed = useCallback((events: CalendarScreenshotEvent[]) => {
    const traceId = generateTraceId();
    setRebuildStatus({ traceId, stage: 'button_clicked', message: 'Screenshot confirmed — rebuilding plan…' });
    generateMutation.mutate({ confirmedScreenshotEvents: events, source: 'screenshot_rebuild' });
  }, [generateMutation]);

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      const { error: fbError } = await supabase
        .from('ai_feedback' as 'ai_feedback')
        .insert({
          user_id: user!.id,
          feature: 'time_blocks',
          context_date: todayStr,
          rating: feedbackRating,
          feedback_text: feedbackText,
          ai_suggestion_summary: plan.ai_reasoning || plan.blocks?.map((b: TimeBlock) => b.label).join(', '),
        });
      if (fbError) throw fbError;
      const { error } = await supabase
        .from('daily_time_blocks' as 'daily_time_blocks')
        .update({
          feedback_rating: feedbackRating,
          feedback_text: feedbackText,
          feedback_submitted_at: new Date().toISOString(),
        })
        .eq('id', plan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-time-blocks'] });
      setShowFeedback(false);
      setFeedbackRating(0);
      setFeedbackText('');
      toast.success("Feedback saved — tomorrow's plan will be better!");
    },
  });

  // Toggle goal completion
  const toggleGoal = useCallback(async (blockIdx: number, goalIdx: number) => {
    if (!plan) return;
    const goalKey = `${blockIdx}-${goalIdx}`;
    const current = (plan.completed_goals || []) as string[];
    const updated = current.includes(goalKey)
      ? current.filter(g => g !== goalKey)
      : [...current, goalKey];

    // Optimistic update
    queryClient.setQueryData(['daily-time-blocks', todayStr], {
      ...plan,
      completed_goals: updated,
    });

    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ completed_goals: updated })
      .eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Per-block thumbs feedback
  const thumbsBlock = useCallback(async (blockIdx: number, thumbs: 'up' | 'down') => {
    if (!plan) return;
    const current = (plan.block_feedback || []) as { blockIdx: number; thumbs: string }[];
    const existing = current.findIndex(f => f.blockIdx === blockIdx);
    const updated = [...current];
    if (existing >= 0) {
      updated[existing] = { blockIdx, thumbs };
    } else {
      updated.push({ blockIdx, thumbs });
    }

    queryClient.setQueryData(['daily-time-blocks', todayStr], {
      ...plan,
      block_feedback: updated,
    });

    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ block_feedback: updated })
      .eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Edit block inline
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

  const startEditBlock = useCallback((blockIdx: number) => {
    if (!plan) return;
    const block = (plan.blocks as TimeBlock[])[blockIdx];
    setEditingBlock(blockIdx);
    setEditLabel(block.label);
    setEditGoals([...block.goals]);
    setEditStartTime(block.start_time);
    setEditEndTime(block.end_time);
  }, [plan]);

  const saveEditBlock = useCallback(async () => {
    if (!plan || editingBlock === null) return;
    const blocks = [...(plan.blocks as TimeBlock[])];
    blocks[editingBlock] = { ...blocks[editingBlock], label: editLabel, goals: editGoals, start_time: editStartTime, end_time: editEndTime };
    
    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks });
    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ blocks: blocks as unknown as Json })
      .eq('id', plan.id);
    setEditingBlock(null);
    toast.success('Block updated');
  }, [plan, editingBlock, editLabel, editGoals, editStartTime, editEndTime, todayStr, queryClient]);

  // Move block up/down
  const moveBlock = useCallback(async (blockIdx: number, direction: 'up' | 'down') => {
    if (!plan) return;
    const blocks = [...(plan.blocks as TimeBlock[])];
    const targetIdx = direction === 'up' ? blockIdx - 1 : blockIdx + 1;
    if (targetIdx < 0 || targetIdx >= blocks.length) return;

    // Swap blocks and recalculate times so they stay contiguous
    const a = blocks[blockIdx];
    const b = blocks[targetIdx];
    const aDuration = getBlockDurationMinutes(a);
    const bDuration = getBlockDurationMinutes(b);

    // The earlier block keeps its start, gets the other's duration
    const earlierIdx = Math.min(blockIdx, targetIdx);
    const laterIdx = Math.max(blockIdx, targetIdx);
    const earlierStart = blocks[earlierIdx].start_time;

    // Parse start minutes
    const [sh, sm] = earlierStart.split(':').map(Number);
    const startMins = sh * 60 + sm;

    // Swap: the block moving up gets earlier start, block moving down gets later start
    const firstDuration = direction === 'up' ? aDuration : bDuration;
    const secondDuration = direction === 'up' ? bDuration : aDuration;
    const midMins = startMins + firstDuration;
    const endMins = midMins + secondDuration;

    const toTime = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    // Swap and assign new times
    [blocks[earlierIdx], blocks[laterIdx]] = direction === 'up' ? [a, b] : [b, a];
    blocks[earlierIdx] = { ...blocks[earlierIdx], start_time: earlierStart, end_time: toTime(midMins) };
    blocks[laterIdx] = { ...blocks[laterIdx], start_time: toTime(midMins), end_time: toTime(endMins) };

    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks });
    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ blocks: blocks as unknown as Json })
      .eq('id', plan.id);
    toast.success('Block moved');
  }, [plan, todayStr, queryClient]);

  // Dismiss a block — persists to DB
  const dismissBlock = useCallback(async (blockIdx: number) => {
    if (!plan) return;
    const newDismissed = new Set([...dismissedBlocks, blockIdx]);
    setDismissedBlocks(newDismissed);
    const indices = Array.from(newDismissed);
    // Persist to DB
    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ dismissed_block_indices: indices as unknown as Json })
      .eq('id', plan.id);
    toast.success('Meeting dismissed from plan');
  }, [plan, dismissedBlocks]);

  // Update actual dials/emails on a prospecting block
  const updateBlockActual = useCallback(async (blockIdx: number, field: 'actual_dials' | 'actual_emails', value: number) => {
    if (!plan) return;
    const blocks = [...(plan.blocks as TimeBlock[])];
    blocks[blockIdx] = { ...blocks[blockIdx], [field]: value };

    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks });

    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ blocks: blocks as unknown as Json })
      .eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Update linked accounts on a prep block
  const updateBlockLinkedAccounts = useCallback(async (blockIdx: number, linkedAccounts: { id: string; name: string }[]) => {
    if (!plan) return;
    const blocks = [...(plan.blocks as TimeBlock[])];
    blocks[blockIdx] = { ...blocks[blockIdx], linked_accounts: linkedAccounts };

    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks });

    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ blocks: blocks as unknown as Json })
      .eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Toggle build step completion
  const toggleBuildStep = useCallback(async (blockIdx: number, stepIdx: number) => {
    if (!plan) return;
    const blocks = [...(plan.blocks as TimeBlock[])];
    const block = blocks[blockIdx];
    const steps = block.build_steps ? [...block.build_steps] : DEFAULT_BUILD_STEPS.map(s => ({ ...s }));
    steps[stepIdx] = { ...steps[stepIdx], done: !steps[stepIdx].done };
    blocks[blockIdx] = { ...block, build_steps: steps };

    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks });

    await supabase
      .from('daily_time_blocks' as 'daily_time_blocks')
      .update({ blocks: blocks as unknown as Json })
      .eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Link opportunity to a block
  const linkOpportunity = useCallback((blockIdx: number, opp: { id: string; name: string }) => {
    setBlockOppLinks(prev => {
      const next = new Map(prev);
      next.set(blockIdx, opp);
      return next;
    });
    setLinkOppBlockIdx(null);
    toast.success(`Linked ${opp.name}`);
  }, []);

  // Regenerate with dismissed blocks and linked opps
  const regenerateWithChanges = useCallback(() => {
    const traceId = generateTraceId();
    setRebuildStatus({ traceId, stage: 'button_clicked', message: 'Rebuild requested — applying dismissed meetings and plan changes…' });
    generateMutation.mutate({ source: 'manual_rebuild' });
  }, [generateMutation]);

  const hasChanges = dismissedBlocks.size > 0 || blockOppLinks.size > 0;

  // Calculate progress
  const blocks = (plan?.blocks || []) as TimeBlock[];
  const totalGoals = blocks.reduce((s, b) => s + b.goals.length, 0);
  const completedGoals = ((plan?.completed_goals || []) as string[]).length;
  const progressPct = totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0;

  // Visual timeline: how far through the day
  const dayProgressPct = (() => {
    if (blocks.length === 0) return 0;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const [fh, fm] = blocks[0].start_time.split(':').map(Number);
    const lastBlock = blocks[blocks.length - 1];
    const [lh, lm] = lastBlock.end_time.split(':').map(Number);
    const start = fh * 60 + fm;
    const end = lh * 60 + lm;
    if (mins <= start) return 0;
    if (mins >= end) return 100;
    return Math.round(((mins - start) / (end - start)) * 100);
  })();

  // Empty state
  if (!plan && !isLoading) {
    return (
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Clock className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Daily Game Plan</h3>
              <p className="text-[11px] text-muted-foreground">AI-powered time blocking</p>
            </div>
          </div>
        </div>
        <div className="p-6 text-center">
          <Zap className="h-8 w-8 text-primary mx-auto mb-3 opacity-60" />
          <p className="text-sm text-muted-foreground mb-1">
            Build a realistic schedule based on today's meetings &amp; priorities.
          </p>
          <p className="text-[11px] text-muted-foreground mb-4">
            Learns from your feedback to get smarter every day.
          </p>
          <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} size="sm">
            {generateMutation.isPending ? (
              <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Building plan...</>
            ) : (
              <><Zap className="h-3.5 w-3.5 mr-1.5" /> Generate Today's Plan</>
            )}
          </Button>
        </div>
        <CalendarScreenshotDrop date={todayStr} onEventsConfirmed={handleScreenshotEventsConfirmed} />
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }

  if (!plan) return null;

  const blockFeedbackMap = new Map(
    ((plan.block_feedback || []) as { blockIdx: number; thumbs: string }[]).map(f => [f.blockIdx, f.thumbs])
  );

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Clock className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Daily Game Plan</h3>
                {plan.ai_reasoning?.startsWith('[FALLBACK]') && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-muted-foreground/40 bg-muted/50 text-muted-foreground gap-1">
                    <Shield className="h-2.5 w-2.5" />
                    Fallback Plan
                  </Badge>
                )}
                {plan.recast_at && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1">
                    <RotateCcw className="h-2.5 w-2.5" />
                    Recast Active
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                <span>{plan.meeting_load_hours}h meetings</span>
                <span>·</span>
                <span>{plan.focus_hours_available}h focus</span>
                {(() => {
                  const dc = calculateDialCapacity(blocks);
                  const actualDials = getActualDials(blocks);
                  const hasActuals = actualDials > 0;
                  return (
                    <>
                      <span>·</span>
                      <span className={cn(
                        "font-medium",
                        dc.status === 'above_target' && "text-emerald-500",
                        dc.status === 'on_track' && "text-foreground",
                        dc.status === 'below_minimum' && "text-amber-500",
                      )}>
                        <Phone className="h-3 w-3 inline mr-0.5" />
                        {hasActuals
                          ? `${actualDials}/${DAILY_DIALS_MIN}–${DAILY_DIALS_TARGET}`
                          : `${dc.plannedDials}–${dc.plannedDialsTarget} / ${DAILY_DIALS_MIN}–${DAILY_DIALS_TARGET}`
                        }
                      </span>
                      {dc.status === 'below_minimum' && !hasActuals && (
                        <>
                          <span>·</span>
                          <span className="text-amber-500 font-medium">
                            <AlertTriangle className="h-3 w-3 inline mr-0.5" />
                            +{dc.suggestedAdditionalBlocks} call block{dc.suggestedAdditionalBlocks !== 1 ? 's' : ''} needed
                          </span>
                        </>
                      )}
                    </>
                  );
                })()}
                {completedGoals > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-primary font-medium">
                      <CheckCircle2 className="h-3 w-3 inline mr-0.5" />
                      {completedGoals}/{totalGoals}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm" className="h-7 w-7 p-0"
              onClick={() => setShowPreferences(true)}
              title="Plan preferences"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              onClick={() => recastMutation.mutate()}
              disabled={recastMutation.isPending}
              title="Re-optimize remaining blocks based on current progress"
            >
              <RotateCcw className={cn("h-3 w-3", recastMutation.isPending && "animate-spin")} />
              Recast
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => setShowFeedback(!showFeedback)}
              title="Rate today's plan"
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              {plan.feedback_rating ? `${plan.feedback_rating}/5` : 'Rate'}
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={regenerateWithChanges}
              disabled={generateMutation.isPending}
              title="Rebuild plan"
              data-testid="rebuild-plan-button"
            >
              <RotateCcw className={cn("h-3.5 w-3.5", generateMutation.isPending && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Day progress bar */}
        {expanded && (
          <div className="mt-2.5 space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Day progress</span>
              <span>{dayProgressPct}%</span>
            </div>
            <Progress value={dayProgressPct} className="h-1.5" />
          </div>
        )}
      </div>

      {/* Strategy banner */}
      {plan.ai_reasoning && expanded && (
        <div className="px-4 py-2.5 bg-primary/5 border-b border-border/30 text-[12px] text-muted-foreground italic">
          💡 {plan.ai_reasoning}
        </div>
      )}

      {rebuildStatus && (
        <div className="px-4 py-2 border-b border-border/30 bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between gap-3" data-testid="rebuild-plan-status">
          <span>
            <span className="font-medium text-foreground">Rebuild status:</span> {rebuildStatus.message}
          </span>
          {rebuildStatus.usedFallback && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              Fallback used
            </Badge>
          )}
        </div>
      )}

      {/* Feedback panel */}
      {showFeedback && (
        <div className="px-4 py-3 bg-muted/30 border-b border-border/30 space-y-2">
          <p className="text-xs font-medium">How was today's plan?</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setFeedbackRating(n)}
                className={cn(
                  "p-1 rounded transition-colors",
                  feedbackRating >= n ? "text-primary" : "text-muted-foreground/30 hover:text-muted-foreground/60"
                )}
              >
                <Star className="h-5 w-5" fill={feedbackRating >= n ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
          <Textarea
            placeholder="What worked? What didn't? Be specific — I'll adjust tomorrow's plan."
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            className="text-xs h-16 resize-none"
          />
          <div className="flex gap-2">
            <Button
              size="sm" className="text-xs h-7"
              onClick={() => feedbackMutation.mutate()}
              disabled={feedbackRating === 0 || feedbackMutation.isPending}
            >
              Submit Feedback
            </Button>
            <Button
              variant="ghost" size="sm" className="text-xs h-7"
              onClick={() => setShowFeedback(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Calendar screenshot drop zone */}
      {expanded && (
        <CalendarScreenshotDrop date={todayStr} onEventsConfirmed={handleScreenshotEventsConfirmed} />
      )}

      {/* Time blocks */}
      {expanded && (
        <div className="divide-y divide-border/20">
          {/* Changes pending banner */}
          {hasChanges && (
            <div className="px-4 py-2 bg-accent/50 border-b border-border/30 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {dismissedBlocks.size > 0 && `${dismissedBlocks.size} dismissed`}
                {dismissedBlocks.size > 0 && blockOppLinks.size > 0 && ' · '}
                {blockOppLinks.size > 0 && `${blockOppLinks.size} linked`}
              </span>
              <Button size="sm" className="h-6 text-[11px] gap-1" onClick={regenerateWithChanges} disabled={generateMutation.isPending} data-testid="rebuild-plan-button">
                <RotateCcw className={cn("h-3 w-3", generateMutation.isPending && "animate-spin")} />
                Rebuild Plan
              </Button>
            </div>
          )}
          {blocks.map((block, i) => {
            if (dismissedBlocks.has(i)) return null;
            const config = TYPE_CONFIG[block.type] || TYPE_CONFIG.admin;
            const Icon = config.icon;
            const isCurrent = i === currentIdx;
            const isPast = currentIdx >= 0 && i < currentIdx;
            const duration = getBlockDurationMinutes(block);
            const blockThumb = blockFeedbackMap.get(i);
            const completedSet = new Set(plan.completed_goals as string[] || []);
            const linkedOpp = blockOppLinks.get(i);
            const isMeeting = block.type === 'meeting';

             return (
              <div
                key={i}
                draggable
                onDragStart={(e) => {
                  setDragIdx(i);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverIdx(i);
                }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== i) {
                    // Perform a full reorder: remove dragIdx block, insert at i
                    const reorderedBlocks = [...(plan.blocks as TimeBlock[])];
                    const [moved] = reorderedBlocks.splice(dragIdx, 1);
                    reorderedBlocks.splice(i, 0, moved);
                    // Recalculate all times to stay contiguous
                    const origBlocks = plan.blocks as TimeBlock[];
                    const [fh, fm] = origBlocks[0].start_time.split(':').map(Number);
                    let cursor = fh * 60 + fm;
                    const toTime = (mins: number) => {
                      const h = Math.floor(mins / 60);
                      const m = mins % 60;
                      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    };
                    const fixedBlocks = reorderedBlocks.map(b => {
                      const dur = getBlockDurationMinutes(b);
                      const start = toTime(cursor);
                      cursor += dur;
                      return { ...b, start_time: start, end_time: toTime(cursor) };
                    });
                    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks: fixedBlocks });
                    supabase
                      .from('daily_time_blocks' as 'daily_time_blocks')
                      .update({ blocks: fixedBlocks as unknown as Json })
                      .eq('id', plan.id)
                      .then();
                    toast.success('Block reordered');
                  }
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
                className={cn(
                  "px-4 py-3 flex gap-3 transition-colors group/block",
                  isCurrent && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                  isPast && "opacity-50",
                  dragIdx === i && "opacity-40",
                  dragOverIdx === i && dragIdx !== i && "ring-2 ring-inset ring-primary/40 bg-primary/5"
                )}
              >
                {/* Drag handle + Time column */}
                <div className="w-[68px] shrink-0 text-[11px] text-muted-foreground pt-0.5 flex gap-1">
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab opacity-0 group-hover/block:opacity-40 transition-opacity mt-0.5" />
                  <div>
                    <div className="font-medium">{formatTime(block.start_time)}</div>
                    <div>{formatTime(block.end_time)}</div>
                    <div className="text-[10px] mt-0.5">{duration}m</div>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] px-1.5 py-0 h-5 font-normal border", config.bg)}
                    >
                      <Icon className={cn("h-3 w-3 mr-1", config.color)} />
                      {block.type}
                    </Badge>
                    {block.workstream && block.workstream !== 'general' && (
                      <Badge variant="outline" className={cn(
                        "text-[10px] px-1.5 py-0 h-5 font-normal",
                        block.workstream === 'new_logo' ? 'bg-blue-500/10 text-blue-500 border-blue-500/30' : 'bg-status-green/10 text-status-green border-status-green/30'
                      )}>
                        {WORKSTREAM_CONFIG[block.workstream]?.label || block.workstream}
                      </Badge>
                    )}
                    {editingBlock !== i ? (
                      <span className="text-sm font-medium truncate">{block.label}</span>
                    ) : null}
                    {isCurrent && (
                      <Badge className="text-[9px] px-1.5 py-0 h-4 bg-primary/20 text-primary border-0 animate-pulse">NOW</Badge>
                    )}
                    <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100">
                      {/* Move up/down buttons */}
                      {i > 0 && (
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveBlock(i, 'up')} title="Move up">
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                      )}
                      {i < blocks.length - 1 && (
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveBlock(i, 'down')} title="Move down">
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => editingBlock === i ? setEditingBlock(null) : startEditBlock(i)}>
                        {editingBlock === i ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                      </Button>
                      {isMeeting && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => setLinkOppBlockIdx(i)} className="text-xs gap-2">
                              <Link2 className="h-3.5 w-3.5" />
                              Link Opportunity
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => dismissBlock(i)} className="text-xs gap-2 text-destructive focus:text-destructive">
                              <EyeOff className="h-3.5 w-3.5" />
                              Dismiss from Plan
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* Inline edit */}
                  {editingBlock === i ? (
                    <div className="space-y-2 mt-1">
                      <div className="flex gap-2 items-center">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <Input
                            type="time"
                            className="h-7 text-xs w-28"
                            value={editStartTime}
                            onChange={e => setEditStartTime(e.target.value)}
                          />
                          <span className="text-xs text-muted-foreground">–</span>
                          <Input
                            type="time"
                            className="h-7 text-xs w-28"
                            value={editEndTime}
                            onChange={e => setEditEndTime(e.target.value)}
                          />
                        </div>
                      </div>
                      <Input
                        className="h-7 text-xs"
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        placeholder="Block label..."
                      />
                      {editGoals.map((g, gi) => (
                        <div key={gi} className="flex gap-1">
                          <Input
                            className="h-6 text-[11px] flex-1"
                            value={g}
                            onChange={e => {
                              const next = [...editGoals];
                              next[gi] = e.target.value;
                              setEditGoals(next);
                            }}
                          />
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditGoals(editGoals.filter((_, j) => j !== gi))}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEditGoals([...editGoals, ''])}>+ Goal</Button>
                        <Button size="sm" className="h-6 text-[10px] gap-1" onClick={saveEditBlock}>
                          <Check className="h-3 w-3" /> Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Goals with checkboxes */
                    <ul className="space-y-1 mt-1">
                      {block.goals.map((goal, gi) => {
                        const goalKey = `${i}-${gi}`;
                        const isCompleted = completedSet.has(goalKey);
                        return (
                          <li key={gi} className="flex items-start gap-2 group/goal">
                            <Checkbox
                              checked={isCompleted}
                              onCheckedChange={() => toggleGoal(i, gi)}
                              className="mt-0.5 h-3.5 w-3.5"
                            />
                            <span className={cn(
                              "text-[12px] text-muted-foreground transition-all",
                              isCompleted && "line-through opacity-60"
                            )}>
                              {goal}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Dial/Email actuals tracker for prospecting blocks */}
                  {editingBlock !== i && block.type === 'prospecting' && (
                    <div className="flex items-center gap-3 mt-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/30">
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3 text-blue-500" />
                        <span className="text-[10px] text-muted-foreground font-medium">Dials:</span>
                        <Input
                          type="number"
                          min={0}
                          className="h-6 w-14 text-xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="—"
                          value={block.actual_dials ?? ''}
                          onChange={e => {
                            const val = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                            if (!isNaN(val)) updateBlockActual(i, 'actual_dials', val);
                          }}
                        />
                      </div>
                      {block.label.toLowerCase().includes('email') && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground font-medium">Emails:</span>
                          <Input
                            type="number"
                            min={0}
                            className="h-6 w-14 text-xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="—"
                            value={block.actual_emails ?? ''}
                            onChange={e => {
                              const val = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                              if (!isNaN(val)) updateBlockActual(i, 'actual_emails', val);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Rust Buster quick links */}
                  {editingBlock !== i && block.type === 'prospecting' && isRustBusterBlock(block.label) && (
                    <RustBusterQuickLinks />
                  )}

                  {/* Account picker for prep blocks */}
                  {editingBlock !== i && block.type === 'prep' && block.workstream !== 'new_logo' && (
                    <div className="mt-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/30">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Target className="h-3 w-3 text-cyan-500" />
                        <span className="text-[10px] text-muted-foreground font-medium">Target Accounts:</span>
                      </div>
                      {/* Linked account pills */}
                      {(block.linked_accounts || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {(block.linked_accounts || []).map(acct => (
                            <Badge
                              key={acct.id}
                              variant="outline"
                              className="text-[10px] h-5 gap-1 bg-accent/50 pr-1 group/pill"
                            >
                              <Building2 className="h-3 w-3" />
                              {acct.name}
                              <LinkedAccountContactCount accountId={acct.id} />
                              <button
                                onClick={() => {
                                  const updated = (block.linked_accounts || []).filter(a => a.id !== acct.id);
                                  updateBlockLinkedAccounts(i, updated);
                                }}
                                className="ml-0.5 opacity-0 group-hover/pill:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                      {/* Search input */}
                      {accountSearchBlockIdx === i ? (
                        <div className="relative">
                          <Input
                            autoFocus
                            className="h-6 text-xs"
                            placeholder="Search accounts..."
                            value={accountSearchQuery}
                            onChange={e => setAccountSearchQuery(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') {
                                setAccountSearchBlockIdx(null);
                                setAccountSearchQuery('');
                              }
                            }}
                          />
                          {accountSearchQuery.length > 0 && (
                            <div className="absolute z-20 top-7 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                              {accounts
                                .filter(a => {
                                  const q = accountSearchQuery.toLowerCase();
                                  const alreadyLinked = (block.linked_accounts || []).some(la => la.id === a.id);
                                  return !alreadyLinked && a.name.toLowerCase().includes(q);
                                })
                                .slice(0, 8)
                                .map(a => (
                                  <button
                                    key={a.id}
                                    className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-xs flex items-center justify-between"
                                    onClick={() => {
                                      const updated = [...(block.linked_accounts || []), { id: a.id, name: a.name }];
                                      updateBlockLinkedAccounts(i, updated);
                                      setAccountSearchQuery('');
                                      if (updated.length >= 3) {
                                        setAccountSearchBlockIdx(null);
                                      }
                                    }}
                                  >
                                    <span>{a.name}</span>
                                    <span className="text-[10px] text-muted-foreground">Tier {a.tier}</span>
                                  </button>
                                ))}
                              {accounts.filter(a => !((block.linked_accounts || []).some(la => la.id === a.id)) && a.name.toLowerCase().includes(accountSearchQuery.toLowerCase())).length === 0 && (
                                <div className="px-3 py-2 text-[11px] text-muted-foreground">No matching accounts</div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAccountSearchBlockIdx(i);
                            setAccountSearchQuery('');
                          }}
                          className="text-[11px] text-primary hover:text-primary/80 font-medium"
                        >
                          + Add account
                        </button>
                      )}
                    </div>
                  )}

                  {/* New Logo Build step tracker — shown for both 'build' and 'prep' new_logo blocks */}
                  {editingBlock !== i && (block.type === 'build' || (block.type === 'prep' && block.workstream === 'new_logo')) && (
                    <div className="mt-2 py-2 px-2.5 rounded-md bg-orange-500/5 border border-orange-500/20">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Hammer className="h-3 w-3 text-orange-500" />
                        <span className="text-[10px] text-muted-foreground font-medium">New Logo Build</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {queueDailyProgress}/3 today · {weeklyResearched}/{weeklyTotal} week
                        </span>
                      </div>

                      {/* Weekly queue: today's 3 accounts */}
                      {queueEmpty && !queueLoading ? (
                        <Button
                          size="sm" variant="outline"
                          className="w-full h-7 text-[11px] gap-1 border-orange-500/30 text-orange-600 hover:bg-orange-500/10"
                          onClick={generateQueue}
                        >
                          <Zap className="h-3 w-3" />
                          Generate Weekly Queue (15 accounts)
                        </Button>
                      ) : queueTodayAccounts.length > 0 ? (
                        <div className="space-y-1.5 mb-2">
                          <div className="flex items-center gap-1 mb-1">
                            <Target className="h-3 w-3 text-orange-500" />
                            <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400">Today's 3 New Logo Accounts</span>
                          </div>
                          {queueTodayAccounts.map(acct => (
                            <div
                              key={acct.id}
                              className="flex items-center gap-2 py-1.5 px-2 rounded bg-orange-500/5 border border-orange-500/10 group/qacct"
                            >
                              {/* State bubble */}
                              <button
                                className={cn(
                                  "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                                  acct.state === 'not_started' && "border-muted-foreground/30 hover:border-orange-500",
                                  acct.state === 'researched' && "border-amber-500 bg-amber-500/20",
                                  acct.state === 'added_to_cadence' && "border-emerald-500 bg-emerald-500/20",
                                )}
                                title={
                                  acct.state === 'not_started' ? 'Mark as researched'
                                    : acct.state === 'researched' ? 'Mark as added to cadence'
                                    : 'Added to cadence ✓'
                                }
                                onClick={() => {
                                  if (!queueTodayKey) return;
                                  if (acct.state === 'not_started') advanceState(queueTodayKey, acct.id, 'researched');
                                  else if (acct.state === 'researched') advanceState(queueTodayKey, acct.id, 'added_to_cadence');
                                }}
                              >
                                {acct.state === 'researched' && <BookOpen className="h-3 w-3 text-amber-500" />}
                                {acct.state === 'added_to_cadence' && <Check className="h-3 w-3 text-emerald-500" />}
                              </button>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <button
                                    className="text-[11px] font-medium text-foreground hover:text-primary truncate block text-left"
                                    onClick={() => navigate(`/account/${acct.id}`)}
                                  >
                                    {acct.name}
                                  </button>
                                  <LinkedAccountContactCount accountId={acct.id} />
                                </div>
                                <span className={cn(
                                  "text-[10px]",
                                  acct.state === 'not_started' && "text-muted-foreground",
                                  acct.state === 'researched' && "text-amber-600 dark:text-amber-400",
                                  acct.state === 'added_to_cadence' && "text-emerald-600 dark:text-emerald-400",
                                )}>
                                  {acct.state === 'not_started' ? 'Not started' : acct.state === 'researched' ? 'Researched' : 'Added to cadence'}
                                  {acct.tier ? ` · Tier ${acct.tier}` : ''}
                                </span>
                              </div>

                              {/* Remove button */}
                              <button
                                className="opacity-0 group-hover/qacct:opacity-100 transition-opacity"
                                onClick={() => queueTodayKey && removeAccount(queueTodayKey, acct.id)}
                              >
                                <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                              </button>
                            </div>
                          ))}

                          {/* Add account to today */}
                          {queueTodayAccounts.length < 3 && queueTodayKey && (
                            showQueueAdd ? (
                              <div className="relative">
                                <Input
                                  autoFocus
                                  className="h-6 text-xs"
                                  placeholder="Search accounts to add..."
                                  value={queueAddQuery}
                                  onChange={e => setQueueAddQuery(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Escape') { setShowQueueAdd(false); setQueueAddQuery(''); } }}
                                />
                                {queueAddQuery.length > 0 && (
                                  <div className="absolute z-20 top-7 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                                    {accounts
                                      .filter(a => {
                                        const q = queueAddQuery.toLowerCase();
                                        if (!a.name.toLowerCase().includes(q)) return false;
                                        if (a.motion === 'renewal') return false;
                                        if (a.accountStatus === 'disqualified') return false;
                                        if (a.outreachStatus === 'closed-won' || a.outreachStatus === 'closed-lost' || a.outreachStatus === 'opp-open') return false;
                                        const allQueued = queueDayKeys.flatMap(k => queueAssignments[k].map(qa => qa.id));
                                        return !allQueued.includes(a.id);
                                      })
                                      .slice(0, 8)
                                      .map(a => (
                                        <button
                                          key={a.id}
                                          className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-xs"
                                          onClick={() => {
                                            addAccount(queueTodayKey, { id: a.id, name: a.name, tier: a.tier, industry: a.industry });
                                            setQueueAddQuery('');
                                            setShowQueueAdd(false);
                                          }}
                                        >
                                          {a.name} <span className="text-muted-foreground">Tier {a.tier}</span>
                                        </button>
                                      ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={() => setShowQueueAdd(true)}
                                className="text-[11px] text-primary hover:text-primary/80 font-medium"
                              >
                                + Add account
                              </button>
                            )
                          )}
                        </div>
                      ) : null}

                      {/* Weekly 15 Queue — collapsible */}
                      {!queueEmpty && (
                        <Collapsible defaultOpen={false}>
                          <CollapsibleTrigger className="flex items-center gap-1 w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1 mb-1">
                            <ChevronDown className="h-3 w-3 transition-transform [[data-state=open]>&]:rotate-180" />
                            <span className="font-medium">Weekly New Logo Queue ({weeklyTotal} accounts)</span>
                            <span className="ml-auto">{weeklyResearched} researched · {weeklyAddedToCadence} in cadence</span>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="space-y-2 pt-1 pb-1">
                              {queueDayKeys.map(dayKey => {
                                const dayAccts = queueAssignments[dayKey];
                                if (!dayAccts?.length) return null;
                                const isToday = dayKey === queueTodayKey;
                                return (
                                  <div key={dayKey}>
                                    <div className="flex items-center gap-1 mb-0.5">
                                      <span className={cn(
                                        "text-[10px] font-medium capitalize",
                                        isToday ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"
                                      )}>
                                        {dayKey}{isToday ? ' (today)' : ''}
                                      </span>
                                    </div>
                                    <div className="space-y-0.5 pl-2">
                                      {dayAccts.map(a => (
                                        <div key={a.id} className="flex items-center gap-1.5 text-[10px]">
                                          <span className={cn(
                                            "h-1.5 w-1.5 rounded-full shrink-0",
                                            a.state === 'not_started' && "bg-muted-foreground/30",
                                            a.state === 'researched' && "bg-amber-500",
                                            a.state === 'added_to_cadence' && "bg-emerald-500",
                                          )} />
                                          <span className={cn(
                                            "truncate",
                                            isToday ? "text-foreground" : "text-muted-foreground"
                                          )}>
                                            {a.name}
                                          </span>
                                          <LinkedAccountContactCount accountId={a.id} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}

                      {/* Build steps checklist */}
                      <div className="space-y-1">
                        {(block.build_steps || DEFAULT_BUILD_STEPS).map((step, si) => (
                          <label key={si} className="flex items-center gap-2 cursor-pointer group/step">
                            <Checkbox
                              checked={step.done}
                              onCheckedChange={() => toggleBuildStep(i, si)}
                              className="h-3.5 w-3.5"
                            />
                            <span className={cn(
                              "text-[11px] transition-all",
                              step.done ? "line-through text-muted-foreground/50" : "text-muted-foreground"
                            )}>
                              {step.step}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {linkedOpp && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-accent/50">
                        <Building2 className="h-3 w-3" />
                        {linkedOpp.name}
                      </Badge>
                    </div>
                  )}

                  {/* Per-block thumbs + reasoning */}
                   <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => thumbsBlock(i, 'up')}
                        className={cn(
                          "p-0.5 rounded transition-colors",
                          blockThumb === 'up' ? "text-status-green" : "text-muted-foreground/25 hover:text-muted-foreground/50"
                        )}
                        title="Good block suggestion"
                      >
                        <ThumbsUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => thumbsBlock(i, 'down')}
                        className={cn(
                          "p-0.5 rounded transition-colors",
                          blockThumb === 'down' ? "text-status-red" : "text-muted-foreground/25 hover:text-muted-foreground/50"
                        )}
                        title="Not useful"
                      >
                        <ThumbsDown className="h-3 w-3" />
                      </button>
                    </div>
                    {block.reasoning && (
                      <p className="text-[10px] text-muted-foreground/50 italic truncate">{block.reasoning}</p>
                    )}
                  </div>

                  {/* Contextual action button */}
                  {isCurrent && BLOCK_ACTIONS[block.type] && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-6 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                      onClick={() => {
                        const action = BLOCK_ACTIONS[block.type];
                        if (action.dispatch === 'power-hour') {
                          window.dispatchEvent(new CustomEvent('open-power-hour'));
                        } else if (action.dispatch === 'scroll-meeting-prep') {
                          document.getElementById('meeting-prep-section')?.scrollIntoView({ behavior: 'smooth' });
                        } else if (action.route) {
                          navigate(action.route);
                        }
                      }}
                    >
                      <ArrowRight className="h-3 w-3" />
                      {BLOCK_ACTIONS[block.type].label}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dial capacity + metric targets footer */}
      {expanded && plan.key_metric_targets && Object.keys(plan.key_metric_targets).length > 0 && (() => {
        const dialCapacity = calculateDialCapacity(blocks);
        const actualDialsTotal = getActualDials(blocks);
        const targetDials = plan.key_metric_targets.dials;
        const hasActuals = actualDialsTotal > 0;
        
        return (
          <div className="px-4 py-2.5 bg-muted/20 border-t border-border/30 space-y-1.5">
            {/* Dial capacity status */}
            <div className="flex items-center gap-2 text-[11px]">
              <Phone className="h-3 w-3 text-primary" />
              <span className="font-medium text-foreground">Dial capacity:</span>
              <span className={cn(
                "font-medium",
                 dialCapacity.status === 'above_target' && "text-emerald-500",
                 dialCapacity.status === 'on_track' && "text-foreground",
                 dialCapacity.status === 'below_minimum' && "text-amber-500",
               )}>
                 {hasActuals ? `${actualDialsTotal}` : `${dialCapacity.plannedDials}–${dialCapacity.plannedDialsTarget} planned`}
                 {' / '}
                 {DAILY_DIALS_MIN}–{DAILY_DIALS_TARGET} target
              </span>
              {dialCapacity.status === 'below_minimum' && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-amber-500/40 text-amber-600 gap-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Need {dialCapacity.suggestedAdditionalBlocks} more call block{dialCapacity.suggestedAdditionalBlocks !== 1 ? 's' : ''}
                </Badge>
              )}
              {dialCapacity.status === 'above_target' && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-emerald-500/40 text-emerald-600 gap-0.5">
                  <TrendingUp className="h-2.5 w-2.5" />
                  Above target
                </Badge>
              )}
            </div>
            {/* Other targets */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Targets:</span>
              {targetDials != null && (
                <span className={cn(
                  hasActuals && actualDialsTotal >= targetDials && "text-emerald-500 font-medium",
                  hasActuals && actualDialsTotal < targetDials && actualDialsTotal >= targetDials * 0.7 && "text-amber-500 font-medium",
                )}>
                  {hasActuals ? `${actualDialsTotal}/${targetDials} dials` : `${targetDials} dials`}
                  {hasActuals && actualDialsTotal >= targetDials && ' ✓'}
                </span>
              )}
              {plan.key_metric_targets.conversations != null && <span>{plan.key_metric_targets.conversations} convos</span>}
              {plan.key_metric_targets.accounts_sourced != null && (
                <span className={cn(
                  "flex items-center gap-1",
                  queueDailyProgress >= 3 && "text-emerald-500 font-medium",
                  queueDailyProgress > 0 && queueDailyProgress < 3 && "text-amber-500 font-medium",
                )}>
                  <Hammer className="h-3 w-3 text-orange-500" />
                  {queueDailyProgress}/3 today · {weeklyResearched}/{weeklyTotal} week
                  {queueDailyProgress >= 3 && ' ✓'}
                </span>
              )}
              {plan.key_metric_targets.accounts_researched != null && <span>{plan.key_metric_targets.accounts_researched} researched</span>}
              {plan.key_metric_targets.contacts_prepped != null && <span>{plan.key_metric_targets.contacts_prepped} prepped</span>}
            </div>
          </div>
        );
      })()}

      {/* Link Opportunity Dialog */}
      <Dialog open={linkOppBlockIdx !== null} onOpenChange={(open) => !open && setLinkOppBlockIdx(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Link Opportunity</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {opportunities.filter(o => o.status === 'active' || o.status === 'stalled').length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No active opportunities found.</p>
            ) : (
              opportunities
                .filter(o => o.status === 'active' || o.status === 'stalled')
                .map(opp => (
                  <button
                    key={opp.id}
                    onClick={() => linkOppBlockIdx !== null && linkOpportunity(linkOppBlockIdx, { id: opp.id, name: opp.name })}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors"
                  >
                    <div className="text-xs font-medium">{opp.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {opp.stage} · ${(opp.arr || 0).toLocaleString()} ARR
                    </div>
                  </button>
                ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Preferences Sheet */}
      <Sheet open={showPreferences} onOpenChange={setShowPreferences}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Game Plan Preferences
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <DailyPlanPreferences onClose={() => setShowPreferences(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
