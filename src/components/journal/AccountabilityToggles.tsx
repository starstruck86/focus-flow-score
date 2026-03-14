import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface HabitDefinition {
  key: string;
  label: string;
  emoji: string;
}

export const DEFAULT_HABITS: HabitDefinition[] = [
  { key: 'prospecting_block_first', label: 'Prospecting block first', emoji: '🎯' },
  { key: 'hit_dial_goal', label: 'Hit dial goal', emoji: '📞' },
  { key: 'power_hour_done', label: 'Power hour done', emoji: '⚡' },
  { key: 'pipeline_reviewed', label: 'Pipeline reviewed', emoji: '📊' },
  { key: 'prepped_tomorrow', label: 'Prepped for tomorrow', emoji: '📋' },
  { key: 'personal_development', label: 'Personal development', emoji: '📚' },
];

interface AccountabilityTogglesProps {
  date: string;
  habits: Record<string, boolean>;
  readOnly?: boolean;
}

export function AccountabilityToggles({ date, habits, readOnly }: AccountabilityTogglesProps) {
  const [localHabits, setLocalHabits] = useState<Record<string, boolean>>(habits);
  const queryClient = useQueryClient();

  useEffect(() => {
    setLocalHabits(habits);
  }, [habits, date]);

  const completedCount = DEFAULT_HABITS.filter(h => localHabits[h.key]).length;

  const toggle = async (key: string) => {
    if (readOnly) return;
    const updated = { ...localHabits, [key]: !localHabits[key] };
    setLocalHabits(updated);

    try {
      const { error } = await supabase
        .from('daily_journal_entries')
        .update({ accountability_habits: updated } as any)
        .eq('date', date);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['journal-week'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entry', date] });
    } catch {
      setLocalHabits(habits); // revert
      toast.error('Failed to save');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Habits
        </span>
        <span className={cn(
          'text-xs font-bold px-2 py-0.5 rounded-full',
          completedCount === DEFAULT_HABITS.length
            ? 'bg-status-green/15 text-status-green'
            : completedCount > 0
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
        )}>
          {completedCount}/{DEFAULT_HABITS.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {DEFAULT_HABITS.map((habit) => {
          const done = localHabits[habit.key] || false;
          return (
            <button
              key={habit.key}
              onClick={() => toggle(habit.key)}
              disabled={readOnly}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left',
                done
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-muted/50 text-muted-foreground border border-transparent hover:border-border',
                readOnly && 'cursor-default'
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors',
                done
                  ? 'bg-primary border-primary'
                  : 'border-muted-foreground/30'
              )}>
                {done && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
              <span className="truncate">{habit.emoji} {habit.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
