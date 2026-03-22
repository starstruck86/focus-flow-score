import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Settings2, Plus, X, Save, Clock, Coffee, Rocket, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PlanPreferences {
  id?: string;
  work_start_time: string;
  work_end_time: string;
  no_meetings_before: string;
  no_meetings_after: string;
  lunch_start: string;
  lunch_end: string;
  min_block_minutes: number;
  prefer_new_logo_morning: boolean;
  max_back_to_back_meetings: number;
  personal_rules: string[];
}

const DEFAULTS: PlanPreferences = {
  work_start_time: '09:00',
  work_end_time: '17:00',
  no_meetings_before: '09:00',
  no_meetings_after: '17:00',
  lunch_start: '12:00',
  lunch_end: '13:00',
  min_block_minutes: 25,
  prefer_new_logo_morning: true,
  max_back_to_back_meetings: 3,
  personal_rules: [],
};

const SUGGESTED_RULES = [
  'No prospecting calls before 9:30am',
  'Keep Fridays meeting-light for deep work',
  'Always include 5-min buffer before customer calls',
  'Batch admin tasks after 3pm',
  'No work blocks during kid pickup/dropoff windows',
  'Reserve 30 min for CRM updates before EOD',
];

export function DailyPlanPreferences({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newRule, setNewRule] = useState('');

  const { data: saved, isLoading } = useQuery({
    queryKey: ['daily-plan-preferences'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_plan_preferences' as 'daily_plan_preferences')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data as unknown as (PlanPreferences & { id: string }) | null;
    },
    enabled: !!user,
  });

  const [prefs, setPrefs] = useState<PlanPreferences>(DEFAULTS);

  useEffect(() => {
    if (saved) {
      setPrefs({
        ...DEFAULTS,
        ...saved,
        personal_rules: Array.isArray(saved.personal_rules) ? saved.personal_rules : [],
      });
    }
  }, [saved]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        user_id: user!.id,
        work_start_time: prefs.work_start_time,
        work_end_time: prefs.work_end_time,
        no_meetings_before: prefs.no_meetings_before,
        no_meetings_after: prefs.no_meetings_after,
        lunch_start: prefs.lunch_start,
        lunch_end: prefs.lunch_end,
        min_block_minutes: prefs.min_block_minutes,
        prefer_new_logo_morning: prefs.prefer_new_logo_morning,
        max_back_to_back_meetings: prefs.max_back_to_back_meetings,
        personal_rules: prefs.personal_rules,
      };

      const { error } = await supabase
        .from('daily_plan_preferences' as any)
        .upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-plan-preferences'] });
      toast.success('Preferences saved — next plan will use these rules');
      onClose();
    },
    onError: () => toast.error('Failed to save preferences'),
  });

  const addRule = (rule: string) => {
    const trimmed = rule.trim();
    if (!trimmed || prefs.personal_rules.includes(trimmed)) return;
    setPrefs(p => ({ ...p, personal_rules: [...p.personal_rules, trimmed] }));
    setNewRule('');
  };

  const removeRule = (idx: number) => {
    setPrefs(p => ({ ...p, personal_rules: p.personal_rules.filter((_, i) => i !== idx) }));
  };

  if (isLoading) return null;

  return (
    <div className="space-y-5">
      {/* Work Hours */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Work Hours</h4>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">Start</Label>
            <Input
              type="time"
              value={prefs.work_start_time}
              onChange={e => setPrefs(p => ({ ...p, work_start_time: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">End</Label>
            <Input
              type="time"
              value={prefs.work_end_time}
              onChange={e => setPrefs(p => ({ ...p, work_end_time: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          No work or meeting blocks will be scheduled outside these hours.
        </p>
      </div>

      <Separator />

      {/* Meeting Windows */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Meeting Boundaries</h4>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">No meetings before</Label>
            <Input
              type="time"
              value={prefs.no_meetings_before}
              onChange={e => setPrefs(p => ({ ...p, no_meetings_before: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">No meetings after</Label>
            <Input
              type="time"
              value={prefs.no_meetings_after}
              onChange={e => setPrefs(p => ({ ...p, no_meetings_after: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-[11px] text-muted-foreground">Max back-to-back meetings</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={prefs.max_back_to_back_meetings}
            onChange={e => setPrefs(p => ({ ...p, max_back_to_back_meetings: parseInt(e.target.value) || 3 }))}
            className="h-8 text-xs w-20"
          />
        </div>
      </div>

      <Separator />

      {/* Lunch */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Coffee className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Lunch Break</h4>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">Start</Label>
            <Input
              type="time"
              value={prefs.lunch_start}
              onChange={e => setPrefs(p => ({ ...p, lunch_start: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">End</Label>
            <Input
              type="time"
              value={prefs.lunch_end}
              onChange={e => setPrefs(p => ({ ...p, lunch_end: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Workstream Preferences */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Workstream Strategy</h4>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">New Logo work in the morning</p>
            <p className="text-[10px] text-muted-foreground">Prospecting & research before lunch, renewals after</p>
          </div>
          <Switch
            checked={prefs.prefer_new_logo_morning}
            onCheckedChange={v => setPrefs(p => ({ ...p, prefer_new_logo_morning: v }))}
          />
        </div>
        <div className="mt-3">
          <Label className="text-[11px] text-muted-foreground">Minimum block duration (minutes)</Label>
          <Input
            type="number"
            min={15}
            max={60}
            value={prefs.min_block_minutes}
            onChange={e => setPrefs(p => ({ ...p, min_block_minutes: parseInt(e.target.value) || 25 }))}
            className="h-8 text-xs w-20"
          />
        </div>
      </div>

      <Separator />

      {/* Personal Rules */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Personal Rules</h4>
          <span className="text-[10px] text-muted-foreground">(free-text — the AI will follow these)</span>
        </div>

        {prefs.personal_rules.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {prefs.personal_rules.map((rule, i) => (
              <Badge
                key={i}
                variant="secondary"
                className="text-[11px] py-1 px-2 gap-1 max-w-full"
              >
                <span className="truncate">{rule}</span>
                <button
                  onClick={() => removeRule(i)}
                  className="shrink-0 ml-0.5 hover:text-destructive transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={newRule}
            onChange={e => setNewRule(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRule(newRule)}
            placeholder="e.g., No calls before 10am on Mondays"
            className="h-8 text-xs flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs shrink-0"
            onClick={() => addRule(newRule)}
            disabled={!newRule.trim()}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>

        {/* Suggestion chips */}
        <div className="mt-2">
          <p className="text-[10px] text-muted-foreground mb-1.5">Quick add:</p>
          <div className="flex flex-wrap gap-1">
            {SUGGESTED_RULES.filter(r => !prefs.personal_rules.includes(r)).slice(0, 4).map(rule => (
              <button
                key={rule}
                onClick={() => addRule(rule)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-accent hover:bg-accent/80 text-muted-foreground transition-colors"
              >
                + {rule}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Separator />

      {/* Save */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="text-xs" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}
