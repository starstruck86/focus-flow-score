import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useKiProficiency } from '@/hooks/useKiProficiency';

export function KiProficiencyStrip() {
  const navigate = useNavigate();
  const { data, isLoading } = useKiProficiency();
  const [drilling, setDrilling] = useState(false);

  if (isLoading || !data) return null;

  const weakest = data.weakest;
  const hasReps = data.total_reps > 0;

  const drillWeakest = async () => {
    const dim = weakest ?? data.dimensions[0];
    if (!dim) return navigate('/skills');

    setDrilling(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? '';

      const { data: masteredIds } = await supabase
        .from('ki_mastery')
        .select('ki_id')
        .eq('user_id', userId)
        .eq('spider_dimension', dim.dimension);

      const drilled = new Set((masteredIds ?? []).map((r: any) => r.ki_id));

      let query = supabase
        .from('knowledge_items')
        .select('id, chapter, spider_dimension, tactic_summary, macro_situation, micro_strategy, when_to_use, when_not_to_use, how_to_execute, example_usage, why_it_matters, what_this_unlocks, framework, who')
        .eq('spider_dimension', dim.dimension)
        .eq('is_core_ae', true)
        .limit(1);

      if (drilled.size > 0) {
        query = (query as any).not('id', 'in', `(${[...drilled].join(',')})`);
      }

      const { data: ki } = await query.maybeSingle();

      if (ki) {
        navigate('/dojo/session', { state: { kiContext: ki } });
      } else {
        navigate('/skills');
      }
    } finally {
      setDrilling(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">
              {!hasReps
                ? 'Start your first KI drill'
                : weakest
                ? `Weakest: ${weakest.label} · ${weakest.proficiency}%`
                : 'KI Library ready'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {data.total_ki_library.toLocaleString()} KIs · {data.total_reps} reps
              {data.decay_alerts > 0 && ` · ${data.decay_alerts} decaying`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {data.decay_alerts > 0 && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}
          <Button
            size="sm"
            variant={hasReps ? 'default' : 'outline'}
            className="text-xs h-7 px-3"
            disabled={drilling}
            onClick={drillWeakest}
          >
            {drilling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : hasReps ? 'Drill Weakest' : 'Start Drilling'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
