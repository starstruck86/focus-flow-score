import { useState, useCallback } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Target, Brain, Crosshair, Plus, X, Sparkles, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useOpportunityMethodology, type CallGoal } from '@/hooks/useOpportunityMethodology';
import { toast } from 'sonner';

interface Props {
  opportunityId: string;
  opportunityName?: string;
  stage?: string;
}

const MEDDICC_FIELDS = [
  { key: 'metrics', label: 'Metrics', hint: 'Quantified business value / ROI the customer expects' },
  { key: 'economic_buyer', label: 'Economic Buyer', hint: 'Person with authority to approve the budget' },
  { key: 'decision_criteria', label: 'Decision Criteria', hint: 'How the customer will evaluate and choose a solution' },
  { key: 'decision_process', label: 'Decision Process', hint: 'Steps, timeline, and stakeholders involved in deciding' },
  { key: 'identify_pain', label: 'Identify Pain', hint: 'The core business pain driving the initiative' },
  { key: 'champion', label: 'Champion', hint: 'Internal advocate who is selling on your behalf' },
  { key: 'competition', label: 'Competition', hint: 'Competitors being evaluated and differentiation strategy' },
] as const;

const COTM_FIELDS = [
  { key: 'before_state', label: 'Before State', hint: 'Current state — what does the world look like today?' },
  { key: 'negative_consequences', label: 'Negative Consequences', hint: 'What happens if they do nothing? Cost of inaction.' },
  { key: 'after_state', label: 'After State', hint: 'What does the future look like with your solution?' },
  { key: 'positive_business_outcomes', label: 'Positive Business Outcomes', hint: 'Measurable outcomes tied to the After State' },
  { key: 'required_capabilities', label: 'Required Capabilities', hint: 'Capabilities needed to achieve the After State' },
  { key: 'metrics_value', label: 'Metrics & Value', hint: 'Quantified value tied to business outcomes' },
] as const;

export function MethodologyTracker({ opportunityId, opportunityName, stage }: Props) {
  const { data, isLoading, upsert } = useOpportunityMethodology(opportunityId);
  const [expandedSection, setExpandedSection] = useState<'meddicc' | 'cotm' | 'goals' | null>('meddicc');
  const [newGoal, setNewGoal] = useState('');
  const [generating, setGenerating] = useState(false);

  const confirmedCount = MEDDICC_FIELDS.filter(f => data?.[`${f.key}_confirmed` as keyof typeof data]).length;
  const cotmFilledCount = COTM_FIELDS.filter(f => {
    const val = data?.[`${f.key}_notes` as keyof typeof data];
    return val && typeof val === 'string' && val.trim().length > 0;
  }).length;

  const handleToggle = useCallback((field: string, current: boolean) => {
    upsert.mutate({ [`${field}_confirmed`]: !current } as any);
  }, [upsert]);

  const handleNotesChange = useCallback((field: string, value: string) => {
    upsert.mutate({ [`${field}_notes`]: value } as any);
  }, [upsert]);

  const handleAddGoal = useCallback(() => {
    if (!newGoal.trim()) return;
    const goals: CallGoal[] = [...(data?.call_goals || []), {
      id: crypto.randomUUID(),
      text: newGoal.trim(),
      completed: false,
    }];
    upsert.mutate({ call_goals: goals } as any);
    setNewGoal('');
    toast.success('Goal added');
  }, [newGoal, data?.call_goals, upsert]);

  const handleToggleGoal = useCallback((goalId: string) => {
    const goals = (data?.call_goals || []).map((g: CallGoal) =>
      g.id === goalId ? { ...g, completed: !g.completed } : g
    );
    upsert.mutate({ call_goals: goals } as any);
  }, [data?.call_goals, upsert]);

  const handleRemoveGoal = useCallback((goalId: string) => {
    const goals = (data?.call_goals || []).filter((g: CallGoal) => g.id !== goalId);
    upsert.mutate({ call_goals: goals } as any);
  }, [data?.call_goals, upsert]);

  const toggleSection = (section: 'meddicc' | 'cotm' | 'goals') => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  if (isLoading) return null;

  return (
    <div className="space-y-2">
      {/* MEDDICC Score Summary */}
      <div className="flex items-center gap-3 mb-1">
        <div className="flex gap-1">
          {MEDDICC_FIELDS.map(f => {
            const confirmed = data?.[`${f.key}_confirmed` as keyof typeof data] as boolean;
            return (
              <div
                key={f.key}
                className={cn(
                  'w-6 h-6 rounded text-[9px] font-bold flex items-center justify-center border transition-colors',
                  confirmed
                    ? 'bg-primary/20 border-primary/40 text-primary'
                    : 'bg-muted/30 border-border/50 text-muted-foreground'
                )}
                title={f.label}
              >
                {f.label[0]}
              </div>
            );
          })}
        </div>
        <span className="text-xs text-muted-foreground">
          {confirmedCount}/7 confirmed
        </span>
        <span className="text-xs text-muted-foreground">•</span>
        <span className="text-xs text-muted-foreground">
          CotM {cotmFilledCount}/6
        </span>
      </div>

      {/* MEDDICC Section */}
      <button
        onClick={() => toggleSection('meddicc')}
        className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded hover:bg-muted/30 transition-colors"
      >
        {expandedSection === 'meddicc' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Brain className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">MEDDICC</span>
        <Badge variant="outline" className="text-[10px] ml-auto">{confirmedCount}/7</Badge>
      </button>

      {expandedSection === 'meddicc' && (
        <div className="space-y-2 pl-2">
          {MEDDICC_FIELDS.map(f => {
            const confirmed = data?.[`${f.key}_confirmed` as keyof typeof data] as boolean;
            const notes = (data?.[`${f.key}_notes` as keyof typeof data] as string) || '';
            return (
              <div key={f.key} className={cn(
                'p-2.5 rounded-lg border transition-colors',
                confirmed ? 'border-primary/30 bg-primary/[0.03]' : 'border-border/50 bg-muted/20'
              )}>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleToggle(f.key, confirmed)} className="flex-shrink-0">
                    {confirmed
                      ? <CheckCircle2 className="h-4 w-4 text-primary" />
                      : <Circle className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                    }
                  </button>
                  <span className={cn('text-xs font-semibold', confirmed && 'text-primary')}>{f.label}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">{f.hint}</p>
                <Textarea
                  className="mt-1.5 ml-6 text-xs min-h-[40px] bg-background/50 border-border/30 resize-none w-[calc(100%-1.5rem)]"
                  placeholder={`Notes on ${f.label.toLowerCase()}...`}
                  defaultValue={notes}
                  onBlur={e => {
                    if (e.target.value !== notes) handleNotesChange(f.key, e.target.value);
                  }}
                  rows={2}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Command of the Message Section */}
      <button
        onClick={() => toggleSection('cotm')}
        className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded hover:bg-muted/30 transition-colors"
      >
        {expandedSection === 'cotm' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Target className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Command of the Message</span>
        <Badge variant="outline" className="text-[10px] ml-auto">{cotmFilledCount}/6</Badge>
      </button>

      {expandedSection === 'cotm' && (
        <div className="space-y-2 pl-2">
          {COTM_FIELDS.map(f => {
            const notes = (data?.[`${f.key}_notes` as keyof typeof data] as string) || '';
            const filled = notes.trim().length > 0;
            return (
              <div key={f.key} className={cn(
                'p-2.5 rounded-lg border transition-colors',
                filled ? 'border-primary/30 bg-primary/[0.03]' : 'border-border/50 bg-muted/20'
              )}>
                <div className="flex items-center gap-2">
                  {filled
                    ? <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                    : <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  }
                  <span className={cn('text-xs font-semibold', filled && 'text-primary')}>{f.label}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">{f.hint}</p>
                <Textarea
                  className="mt-1.5 ml-6 text-xs min-h-[40px] bg-background/50 border-border/30 resize-none w-[calc(100%-1.5rem)]"
                  placeholder={`Describe the ${f.label.toLowerCase()}...`}
                  defaultValue={notes}
                  onBlur={e => {
                    if (e.target.value !== notes) handleNotesChange(f.key, e.target.value);
                  }}
                  rows={2}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Call Goals Section */}
      <button
        onClick={() => toggleSection('goals')}
        className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded hover:bg-muted/30 transition-colors"
      >
        {expandedSection === 'goals' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Crosshair className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Call Goal Outcomes</span>
        {(data?.call_goals || []).length > 0 && (
          <Badge variant="outline" className="text-[10px] ml-auto">
            {(data?.call_goals || []).filter((g: CallGoal) => g.completed).length}/{(data?.call_goals || []).length}
          </Badge>
        )}
      </button>

      {expandedSection === 'goals' && (
        <div className="space-y-2 pl-2">
          <div className="flex items-center justify-between px-2">
            <p className="text-[10px] text-muted-foreground">
              Define specific outcomes you need from the next call. These inform call scoring and pre-call coaching.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] gap-1 shrink-0"
              onClick={async () => {
                setGenerating(true);
                try {
                  const { data: result, error } = await trackedInvoke('generate-call-goals', {
                    body: { opportunity_id: opportunityId },
                  });
                  if (error) throw error;
                  if (result?.error) throw new Error(result.error);
                  toast.success(`${result.goals?.length || 0} goals generated`);
                  // Refresh data
                  upsert.mutate({} as any);
                } catch (err: any) {
                  toast.error('Goal generation failed', { description: err.message });
                } finally {
                  setGenerating(false);
                }
              }}
              disabled={generating}
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {generating ? 'Generating...' : 'AI Generate'}
            </Button>
          </div>
          {(data?.call_goals || []).map((goal: any) => (
            <div key={goal.id} className="p-2 rounded-lg border border-border/50 bg-muted/20">
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggleGoal(goal.id)} className="flex-shrink-0">
                  {goal.completed
                    ? <CheckCircle2 className="h-4 w-4 text-primary" />
                    : <Circle className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                  }
                </button>
                <span className={cn('text-xs flex-1', goal.completed && 'line-through text-muted-foreground')}>
                  {goal.text}
                </span>
                {goal.framework && (
                  <Badge variant="outline" className="text-[9px] shrink-0">{goal.framework}</Badge>
                )}
                <button onClick={() => handleRemoveGoal(goal.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {goal.rationale && (
                <p className="text-[10px] text-muted-foreground ml-6 mt-0.5">{goal.rationale}</p>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              className="h-7 text-xs flex-1"
              placeholder="e.g. Confirm Economic Buyer identity..."
              value={newGoal}
              onChange={e => setNewGoal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddGoal()}
            />
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleAddGoal} disabled={!newGoal.trim()}>
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
