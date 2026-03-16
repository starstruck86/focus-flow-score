import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { 
  Clock, Zap, Phone, Users, BookOpen, Coffee, 
  BriefcaseBusiness, Target, RefreshCw, Star,
  ChevronDown, ChevronUp, MessageSquare, Lightbulb,
  ThumbsUp, ThumbsDown, RotateCcw, CheckCircle2,
  ArrowRight, ExternalLink, Pencil, Check, X, GripVertical,
  Rocket, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface TimeBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: 'prospecting' | 'meeting' | 'research' | 'admin' | 'break' | 'pipeline' | 'prep';
  workstream?: 'new_logo' | 'renewal' | 'general';
  goals: string[];
  reasoning: string;
}

interface DailyPlan {
  id: string;
  plan_date: string;
  blocks: TimeBlock[];
  meeting_load_hours: number;
  focus_hours_available: number;
  ai_reasoning: string;
  key_metric_targets?: Record<string, number>;
  completed_goals?: string[]; // "blockIdx-goalIdx" format
  block_feedback?: { blockIdx: number; thumbs: 'up' | 'down' }[];
  feedback_rating?: number;
  feedback_text?: string;
}

const TYPE_CONFIG: Record<string, { icon: typeof Clock; color: string; bg: string }> = {
  prospecting: { icon: Phone, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20' },
  meeting: { icon: Users, color: 'text-purple-500', bg: 'bg-purple-500/10 border-purple-500/20' },
  research: { icon: BookOpen, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20' },
  admin: { icon: BriefcaseBusiness, color: 'text-muted-foreground', bg: 'bg-muted/50 border-muted-foreground/20' },
  break: { icon: Coffee, color: 'text-green-500', bg: 'bg-green-500/10 border-green-500/20' },
  pipeline: { icon: Target, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20' },
  prep: { icon: Lightbulb, color: 'text-cyan-500', bg: 'bg-cyan-500/10 border-cyan-500/20' },
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
};

const WORKSTREAM_CONFIG: Record<string, { label: string; icon: typeof Rocket; color: string }> = {
  new_logo: { label: 'New Logo', icon: Rocket, color: 'text-blue-500' },
  renewal: { label: 'Renewal', icon: Shield, color: 'text-status-green' },
  general: { label: 'General', icon: BriefcaseBusiness, color: 'text-muted-foreground' },
};

export function DailyTimeBlocks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editGoals, setEditGoals] = useState<string[]>([]);

  const { data: plan, isLoading } = useQuery({
    queryKey: ['daily-time-blocks', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_time_blocks' as any)
        .select('*')
        .eq('plan_date', todayStr)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DailyPlan | null;
    },
    enabled: !!user,
  });

  // Auto-refresh current block indicator every 60s
  useEffect(() => {
    if (!plan?.blocks) return;
    setCurrentIdx(getCurrentBlockIndex(plan.blocks));
    const interval = setInterval(() => {
      setCurrentIdx(getCurrentBlockIndex(plan.blocks));
    }, 60_000);
    return () => clearInterval(interval);
  }, [plan?.blocks]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-time-blocks', {
        body: { date: todayStr },
      });
      if (error) throw error;
      return data as DailyPlan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-time-blocks'] });
      toast.success('Daily plan generated!');
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to generate plan');
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      const { error: fbError } = await supabase
        .from('ai_feedback' as any)
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
        .from('daily_time_blocks' as any)
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
      .from('daily_time_blocks' as any)
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
      .from('daily_time_blocks' as any)
      .update({ block_feedback: updated })
      .eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Edit block inline
  const startEditBlock = useCallback((blockIdx: number) => {
    if (!plan) return;
    const block = (plan.blocks as TimeBlock[])[blockIdx];
    setEditingBlock(blockIdx);
    setEditLabel(block.label);
    setEditGoals([...block.goals]);
  }, [plan]);

  const saveEditBlock = useCallback(async () => {
    if (!plan || editingBlock === null) return;
    const blocks = [...(plan.blocks as TimeBlock[])];
    blocks[editingBlock] = { ...blocks[editingBlock], label: editLabel, goals: editGoals };
    
    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks });
    await supabase
      .from('daily_time_blocks' as any)
      .update({ blocks })
      .eq('id', plan.id);
    setEditingBlock(null);
    toast.success('Block updated');
  }, [plan, editingBlock, editLabel, editGoals, todayStr, queryClient]);

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
              <h3 className="text-sm font-semibold">Daily Game Plan</h3>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{plan.meeting_load_hours}h meetings</span>
                <span>·</span>
                <span>{plan.focus_hours_available}h focus</span>
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
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => setShowFeedback(!showFeedback)}
              title="Rate today's plan"
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              {plan.feedback_rating ? `${plan.feedback_rating}/5` : 'Rate'}
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              title="Regenerate plan"
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

      {/* Time blocks */}
      {expanded && (
        <div className="divide-y divide-border/20">
          {blocks.map((block, i) => {
            const config = TYPE_CONFIG[block.type] || TYPE_CONFIG.admin;
            const Icon = config.icon;
            const isCurrent = i === currentIdx;
            const isPast = currentIdx >= 0 && i < currentIdx;
            const duration = getBlockDurationMinutes(block);
            const blockThumb = blockFeedbackMap.get(i);
            const completedSet = new Set(plan.completed_goals as string[] || []);

            return (
              <div
                key={i}
                className={cn(
                  "px-4 py-3 flex gap-3 transition-colors group/block",
                  isCurrent && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                  isPast && "opacity-50"
                )}
              >
                {/* Time column */}
                <div className="w-[68px] shrink-0 text-[11px] text-muted-foreground pt-0.5">
                  <div className="font-medium">{formatTime(block.start_time)}</div>
                  <div>{formatTime(block.end_time)}</div>
                  <div className="text-[10px] mt-0.5">{duration}m</div>
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
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto opacity-0 group-hover/block:opacity-100" onClick={() => editingBlock === i ? setEditingBlock(null) : startEditBlock(i)}>
                      {editingBlock === i ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                    </Button>
                  </div>

                  {/* Inline edit */}
                  {editingBlock === i ? (
                    <div className="space-y-2 mt-1">
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

      {/* Metric targets footer */}
      {expanded && plan.key_metric_targets && Object.keys(plan.key_metric_targets).length > 0 && (
        <div className="px-4 py-2.5 bg-muted/20 border-t border-border/30 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Today's targets:</span>
          {plan.key_metric_targets.dials != null && <span>{plan.key_metric_targets.dials} dials</span>}
          {plan.key_metric_targets.conversations != null && <span>{plan.key_metric_targets.conversations} convos</span>}
          {plan.key_metric_targets.accounts_researched != null && <span>{plan.key_metric_targets.accounts_researched} researched</span>}
          {plan.key_metric_targets.contacts_prepped != null && <span>{plan.key_metric_targets.contacts_prepped} prepped</span>}
        </div>
      )}
    </Card>
  );
}
