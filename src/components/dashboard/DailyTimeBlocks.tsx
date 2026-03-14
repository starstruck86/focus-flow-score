import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Clock, Zap, Phone, Users, BookOpen, Coffee, 
  BriefcaseBusiness, Target, RefreshCw, Star,
  ChevronDown, ChevronUp, MessageSquare, Lightbulb
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface TimeBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: 'prospecting' | 'meeting' | 'research' | 'admin' | 'break' | 'pipeline' | 'prep';
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
  day_strategy?: string;
  key_metric_targets?: {
    dials?: number;
    conversations?: number;
    accounts_researched?: number;
    contacts_prepped?: number;
  };
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

export function DailyTimeBlocks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [expanded, setExpanded] = useState(true);

  const { data: plan, isLoading, error } = useQuery({
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
      // Save feedback to ai_feedback table
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
      // Also update the plan record
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
      toast.success('Feedback saved — I\'ll learn from this!');
    },
  });

  const currentIdx = plan?.blocks ? getCurrentBlockIndex(plan.blocks) : -1;

  // No plan yet - show generate button
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
          <p className="text-sm text-muted-foreground mb-4">
            Generate a realistic, impact-maximizing schedule based on today's meetings and priorities.
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

  const blocks = (plan.blocks || []) as TimeBlock[];

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
              <p className="text-[11px] text-muted-foreground">
                {plan.meeting_load_hours}h meetings · {plan.focus_hours_available}h focus time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs"
              onClick={() => setShowFeedback(!showFeedback)}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              {plan.feedback_rating ? `${plan.feedback_rating}/5` : 'Rate'}
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", generateMutation.isPending && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
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
                  feedbackRating >= n ? "text-amber-400" : "text-muted-foreground/30 hover:text-muted-foreground/60"
                )}
              >
                <Star className="h-5 w-5" fill={feedbackRating >= n ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
          <Textarea
            placeholder="What worked? What didn't? Be specific — I'll adjust tomorrow."
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            className="text-xs h-16 resize-none"
          />
          <Button
            size="sm" className="text-xs h-7"
            onClick={() => feedbackMutation.mutate()}
            disabled={feedbackRating === 0 || feedbackMutation.isPending}
          >
            Submit Feedback
          </Button>
        </div>
      )}

      {/* Time blocks */}
      {expanded && (
        <div className="divide-y divide-border/20">
          {blocks.map((block, i) => {
            const config = TYPE_CONFIG[block.type] || TYPE_CONFIG.admin;
            const Icon = config.icon;
            const isCurrent = i === currentIdx;
            const isPast = currentIdx > i;

            return (
              <div
                key={i}
                className={cn(
                  "px-4 py-3 flex gap-3 transition-colors",
                  isCurrent && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                  isPast && "opacity-50"
                )}
              >
                {/* Time column */}
                <div className="w-[72px] shrink-0 text-[11px] text-muted-foreground pt-0.5">
                  <div className="font-medium">{formatTime(block.start_time)}</div>
                  <div>{formatTime(block.end_time)}</div>
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
                    <span className="text-sm font-medium truncate">{block.label}</span>
                    {isCurrent && (
                      <Badge className="text-[9px] px-1.5 py-0 h-4 bg-primary/20 text-primary border-0">NOW</Badge>
                    )}
                  </div>

                  {/* Goals */}
                  <ul className="space-y-0.5">
                    {block.goals.map((goal, gi) => (
                      <li key={gi} className="text-[12px] text-muted-foreground flex items-start gap-1.5">
                        <span className="text-primary/60 mt-0.5">→</span>
                        <span>{goal}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Reasoning (subtle) */}
                  {block.reasoning && (
                    <p className="text-[10px] text-muted-foreground/60 mt-1 italic">{block.reasoning}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Metric targets footer */}
      {expanded && plan.key_metric_targets && (
        <div className="px-4 py-2.5 bg-muted/20 border-t border-border/30 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Today's realistic targets:</span>
          {plan.key_metric_targets.dials != null && <span>{plan.key_metric_targets.dials} dials</span>}
          {plan.key_metric_targets.conversations != null && <span>{plan.key_metric_targets.conversations} convos</span>}
          {plan.key_metric_targets.accounts_researched != null && <span>{plan.key_metric_targets.accounts_researched} researched</span>}
          {plan.key_metric_targets.contacts_prepped != null && <span>{plan.key_metric_targets.contacts_prepped} prepped</span>}
        </div>
      )}
    </Card>
  );
}
