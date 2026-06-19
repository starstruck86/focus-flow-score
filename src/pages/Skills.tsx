import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Target, AlertTriangle, Sparkles, Loader2, TrendingUp, TrendingDown, Minus, ChevronRight, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { selectNextKI } from '@/lib/dojo/selectNextKI';
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
  internal_prospecting: 'objection_handling',
  stakeholder_navigation: 'deal_control',
  messaging: 'objection_handling',
  deal_control: 'deal_control',
  objection_handling: 'objection_handling',
  expansion_strategy: 'deal_control',
  c_suite_engagement: 'executive_response',
  competitive: 'objection_handling',
  qualification: 'qualification',
};

export default function Skills() {
  const navigate = useNavigate();
  const { data, isLoading } = useKiProficiency();
  const [loadingDim, setLoadingDim] = useState<SpiderDimensionKey | null>(null);
  const [selectedDim, setSelectedDim] = useState<string | null>(null);

  const { data: branchReadiness } = useQuery({
    queryKey: ['branch-readiness'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await (supabase as any)
        .from('branch_readiness')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const dimensions = data?.dimensions ?? [];
  const hasReps = (data?.total_reps ?? 0) > 0;

  const chartData = dimensions.map(d => ({
    dimension: d.label,
    practice_score: hasReps ? d.proficiency : 0,
    call_score: d.call_score ?? 0,
    reps: d.total_reps,
    avg: d.avg_score,
    call_count: d.call_count,
    fullMark: 100,
  }));

  const hasCallData = !!data?.total_call_data;

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
            Real-call performance vs. practice reps
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
                  {/* Outer ring: real call performance */}
                  <Radar
                    name="Real Calls"
                    dataKey="call_score"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.08}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                  {/* Inner ring: practice performance */}
                  <Radar
                    name="Practice"
                    dataKey="practice_score"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.15}
                    strokeWidth={1.5}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: any, name: any, props: any) => {
                      if (name === 'Real Calls') {
                        return [`${value}% · ${props.payload.call_count} calls`, 'Real Calls'];
                      }
                      return [
                        `${value}% · ${props.payload.reps} reps · avg ${props.payload.avg}`,
                        'Practice',
                      ];
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
              {!hasReps && !hasCallData && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg px-4 py-2 text-center">
                    <Sparkles className="h-4 w-4 inline mr-1 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Grade a call or run your first drill to see proficiency
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0 border-t-2 border-dashed" style={{ borderColor: '#3b82f6' }} />
                <span>Real Calls (dashed)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0 border-t-2" style={{ borderColor: '#10b981' }} />
                <span>Practice</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tappable dimension list */}
        <div className="space-y-2">
          {dimensions.map(dim => (
            <button
              key={dim.dimension}
              onClick={() => setSelectedDim(dim.dimension)}
              className="w-full flex items-center justify-between p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
            >
              <div className="flex items-center gap-2.5">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dim.color }} />
                <span className="text-sm font-medium">{dim.label}</span>
              </div>
              <div className="flex items-center gap-3">
                {dim.call_score != null && (
                  <span className={cn('text-xs font-mono',
                    dim.call_score < 40 ? 'text-red-500' : dim.call_score < 60 ? 'text-amber-500' : 'text-green-500'
                  )}>{Math.round(dim.call_score)}</span>
                )}
                <span className="text-xs text-muted-foreground font-mono">{dim.total_reps}r</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>

        {dimensions.some(d => d.stagnant && (d.call_score ?? 100) < 50) && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">⚠ Regression Risk</p>
              <p className="text-xs text-muted-foreground">
                {dimensions
                  .filter(d => d.stagnant && (d.call_score ?? 100) < 50)
                  .map(d => d.label)
                  .join(', ')}{' '}
                {dimensions.filter(d => d.stagnant && (d.call_score ?? 100) < 50).length === 1 ? 'has' : 'have'} shown no improvement in 30 days and score below 50 on real calls.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Branch.io Readiness */}
        <Card className={cn(
          'border',
          (branchReadiness?.total_branch_kis ?? 0) === 0
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-blue-500/20 bg-blue-500/5'
        )}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-md bg-blue-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-xs font-bold">B</span>
                </div>
                <div>
                  <p className="text-sm font-semibold">Branch.io Readiness</p>
                  <p className="text-xs text-muted-foreground">
                    {(branchReadiness?.total_branch_kis ?? 0) === 0
                      ? 'No Branch.io KIs yet — ingest resources in PrepHub'
                      : `${branchReadiness?.drilled_branch_kis ?? 0} of ${branchReadiness?.total_branch_kis} KIs drilled`}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={cn(
                  'text-lg font-bold font-mono',
                  (branchReadiness?.total_branch_kis ?? 0) === 0 ? 'text-muted-foreground' : 'text-blue-600'
                )}>
                  {(branchReadiness?.total_branch_kis ?? 0) === 0
                    ? '—'
                    : `${branchReadiness?.coverage_pct ?? 0}%`}
                </p>
                <p className="text-[10px] text-muted-foreground">coverage</p>
              </div>
            </div>
            {(branchReadiness?.total_branch_kis ?? 0) === 0 && (
              <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Branch.io intelligence is your moat. Ingest battle cards, case studies, and persona guides before July 1.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {dimensions.some(d => d.trend !== null) && (
          <Card>
            <CardContent className="p-3">
              <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">30-Day Trend</p>
              <div className="space-y-1.5">
                {dimensions
                  .filter(d => d.trend !== null || d.stagnant)
                  .map(d => (
                    <div key={d.dimension} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{d.label}</span>
                      <div className="flex items-center gap-1.5">
                        {d.stagnant && (
                          <span className="text-[10px] text-amber-500 font-medium">STAGNANT</span>
                        )}
                        <span className={cn(
                          'font-semibold',
                          d.trend === 'up' ? 'text-green-500' :
                          d.trend === 'down' ? 'text-red-500' : 'text-muted-foreground'
                        )}>
                          {d.trend === 'up' ? '↑' : d.trend === 'down' ? '↓' : '→'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}


        <Button
          variant="outline"
          className="w-full"
          onClick={() => navigate('/progress')}
        >
          <TrendingUp className="h-4 w-4 mr-2" />
          View Progress History
        </Button>

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
                      disabled={loadingDim === d.dimension}
                      onClick={async () => {
                        setLoadingDim(d.dimension);
                        try {
                          const userId = (await supabase.auth.getUser()).data.user?.id ?? '';
                          const ki = await selectNextKI(userId, d.dimension);
                          if (ki) {
                            navigate('/dojo/session', { state: { kiContext: ki, sessionType: 'drill' } });
                          } else {
                            navigate('/dojo', {
                              state: { skillFocus: DIMENSION_TO_SKILL[d.dimension] },
                            });
                          }
                        } finally {
                          setLoadingDim(null);
                        }
                      }}
                    >
                      {loadingDim === d.dimension ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                          Loading…
                        </>
                      ) : (
                        'Train'
                      )}
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
