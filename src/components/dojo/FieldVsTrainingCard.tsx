import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';

interface EfficacyRow {
  user_id: string;
  week_start: string;
  spoke: string | null;
  drills_touched: number;
  training_avg_score: number | null;
  training_best_score: number | null;
  total_drills: number;
  calls_graded: number;
  field_overall_score: number | null;
  field_granularity: string;
}

export function FieldVsTrainingCard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['training-field-efficacy', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('training_field_efficacy')
        .select('*')
        .eq('user_id', user!.id)
        .order('week_start', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as EfficacyRow[];
    },
  });

  const hasField = (data || []).some(r => r.calls_graded > 0);
  const trainingRows = (data || []).filter(r => r.drills_touched > 0);

  return (
    <Card className="border-border/60">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            Field vs Training
          </p>
          <span className="text-[10px] text-muted-foreground/60">read-only</span>
        </div>

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !hasField ? (
          <div className="space-y-1.5">
            <p className="text-sm text-foreground/80">
              Correlations appear once real calls are scored — Day 1 <span className="font-semibold">Jul 13</span>.
            </p>
            {trainingRows.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Training baseline is accumulating: {trainingRows.length} spoke-week
                {trainingRows.length === 1 ? '' : 's'} of drill activity tracked.
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/70">
              Weekly overall coach score will join per-spoke training here.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {(data || []).slice(0, 6).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {r.week_start} · {r.spoke ?? '—'}
                </span>
                <span className="font-mono">
                  train {r.training_avg_score ?? '·'} / field {r.field_overall_score ?? '·'}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
