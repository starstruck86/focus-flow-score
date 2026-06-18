import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useKiProficiency } from '@/hooks/useKiProficiency';
import { selectNextKI } from '@/lib/dojo/selectNextKI';
import { useIntensiveMode } from '@/hooks/useIntensiveMode';
import { getIntensiveAnchor } from '@/lib/dojo/v3/dayAnchors';

export function KiProficiencyStrip() {
  const navigate = useNavigate();
  const { data, isLoading } = useKiProficiency();
  const [drilling, setDrilling] = useState(false);
  const intensiveMode = useIntensiveMode();

  if (isLoading || !data) return null;

  const weakest = data.weakest;
  const hasReps = data.total_reps > 0;

  const drillWeakest = async () => {
    const dim = weakest ?? data.dimensions[0];
    const dayOfWeek = new Date().getDay();
    const intensiveAnchor = intensiveMode.active ? getIntensiveAnchor(dayOfWeek) : null;
    const targetDimension = intensiveAnchor?.dimension ?? dim?.dimension;
    if (!targetDimension) return navigate('/skills');

    setDrilling(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? '';
      const ki = await selectNextKI(userId, targetDimension);
      if (ki) {
        navigate('/dojo/session', { state: { kiContext: ki, sessionType: 'drill' } });
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
