import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Target, AlertTriangle, Sparkles } from 'lucide-react';
import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
} from 'recharts';
import { useKiProficiency, type SpiderDimensionKey } from '@/hooks/useKiProficiency';
import { cn } from '@/lib/utils';

const DIMENSION_TO_SKILL: Record<SpiderDimensionKey, string> = {
  discovery: 'discovery',
  cold_outreach: 'objection_handling',
  stakeholder_navigation: 'deal_control',
  messaging: 'objection_handling',
  deal_control: 'deal_control',
  objection_handling: 'objection_handling',
  coaching: 'discovery',
  account_strategy: 'deal_control',
};

export default function Skills() {
  const navigate = useNavigate();
  const { data, isLoading } = useKiProficiency();

  const dimensions = data?.dimensions ?? [];
  const hasReps = (data?.total_reps ?? 0) > 0;

  const chartData = dimensions.map(d => ({
    dimension: d.label,
    proficiency: hasReps ? d.proficiency : 0,
    reps: d.total_reps,
    avg: d.avg_score,
    fullMark: 100,
  }));

  return (
    <Layout>
      <div data-testid="skills-page" className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Proficiency Map
          </h1>
          <p className="text-sm text-muted-foreground">
            Based on your KI library &amp; drill history
          </p>
        </div>

        {/* Stats chips */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-xs">
            {(data?.total_ki_library ?? 0).toLocaleString()} KIs
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {(data?.total_reps ?? 0).toLocaleString()} Reps
          </Badge>
          <Badge
            variant="secondary"
            className={cn(
              'text-xs',
              (data?.decay_alerts ?? 0) > 0 && 'bg-amber-500/15 text-amber-500 border-amber-500/30'
            )}
          >
            {data?.decay_alerts ?? 0} Decaying
          </Badge>
        </div>

        {/* Spider chart */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="relative h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={chartData} margin={{ top: 16, right: 24, bottom: 16, left: 24 }}>
                  <PolarGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <PolarAngleAxis
                    dataKey="dimension"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar
                    name="Proficiency"
                    dataKey="proficiency"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={hasReps ? 0.4 : 0.05}
                    strokeWidth={2}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: any, _name: any, props: any) => [
                      `${value}% · ${props.payload.reps} reps · avg ${props.payload.avg}`,
                      props.payload.dimension,
                    ]}
                  />
                </RadarChart>
              </ResponsiveContainer>
              {!hasReps && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg px-4 py-2 text-center">
                    <Sparkles className="h-4 w-4 inline mr-1 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Complete your first drill to see proficiency
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dimension Breakdown */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">Dimension Breakdown</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {dimensions.map(d => {
              const isUnDrilled = d.proficiency === 0;
              return (
                <Card key={d.dimension} className="overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{d.label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {d.library_count.toLocaleString()} KIs in library
                        </div>
                      </div>
                      <div
                        className="flex items-center justify-center h-12 w-12 rounded-full border-2 shrink-0"
                        style={{
                          borderColor: isUnDrilled ? 'hsl(var(--border))' : d.color,
                          color: isUnDrilled ? 'hsl(var(--muted-foreground))' : d.color,
                        }}
                      >
                        <span className="text-sm font-bold">
                          {isUnDrilled ? '—' : `${d.proficiency}%`}
                        </span>
                      </div>
                    </div>

                    {isUnDrilled ? (
                      <div className="text-xs text-muted-foreground italic">Not yet drilled</div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {d.total_reps} reps · avg {d.avg_score}
                      </div>
                    )}

                    {d.decay_risk_count > 0 && (
                      <Badge
                        variant="outline"
                        className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-[10px]"
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {d.decay_risk_count} decaying
                      </Badge>
                    )}

                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() =>
                        navigate('/dojo', {
                          state: { skillFocus: DIMENSION_TO_SKILL[d.dimension] },
                        })
                      }
                    >
                      Train
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}
