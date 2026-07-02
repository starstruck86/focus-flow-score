/**
 * TRAIN v2 — P0-3 focus chips.
 *
 * Compact row of toggle chips for the 10 spokes. Tap = toggle + persist
 * to user_train_prefs.focus_spokes. Boosts matching spokes in the daily
 * ladder (see src/lib/train/dailyLadder.ts rank table).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const SPOKES: { key: string; label: string }[] = [
  { key: 'product', label: 'Product' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'deal_control', label: 'Deal' },
  { key: 'qualification', label: 'Qual' },
  { key: 'expansion', label: 'Expansion' },
  { key: 'stakeholder_navigation', label: 'Stakeholders' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'objection_handling', label: 'Objections' },
  { key: 'competitive', label: 'Competitive' },
  { key: 'csuite', label: 'C-Suite' },
];

export function FocusSpokesChips() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: focus = [] } = useQuery<string[]>({
    queryKey: ['train', 'focus-spokes', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('user_train_prefs')
        .select('focus_spokes')
        .eq('user_id', user!.id)
        .maybeSingle();
      return (data?.focus_spokes as string[]) ?? [];
    },
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: async (next: string[]) => {
      if (!user?.id) return;
      await (supabase as any)
        .from('user_train_prefs')
        .upsert(
          { user_id: user.id, focus_spokes: next, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        );
    },
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ['train', 'focus-spokes', user?.id] });
      const prev = qc.getQueryData<string[]>(['train', 'focus-spokes', user?.id]);
      qc.setQueryData(['train', 'focus-spokes', user?.id], next);
      return { prev };
    },
    onError: (_e, _n, ctx) => {
      if (ctx?.prev) qc.setQueryData(['train', 'focus-spokes', user?.id], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['train', 'daily-ladder', user?.id] });
    },
  });

  const toggle = (key: string) => {
    const set = new Set(focus);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    save.mutate(Array.from(set));
  };

  if (!user?.id) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {SPOKES.map((s) => {
        const on = focus.includes(s.key);
        return (
          <button
            key={s.key}
            onClick={() => toggle(s.key)}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-full border transition-colors',
              on
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent text-muted-foreground border-border hover:border-primary/40',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
