import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { TrendingUp, Target, BookOpen, Dumbbell, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { SPIDER_DIMENSIONS } from '@/hooks/useKiProficiency';

function getWeekLabel(date: Date): string {
  const m = date.toLocaleString('default', { month: 'short' });
  const d = date.getDate();
  return `${m} ${d}`;
}

function groupByWeek<T extends { created_at: string }>(
  items: T[], valueFn: (item: T) => number,
): { week: string; value: number; count: number }[] {
  const map = new Map<string, { sum: number; count: number }>();
  items.forEach(item => {
    const d = new Date(item.created_at);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString();
    const existing = map.get(key) ?? { sum: 0, count: 0 };
    map.set(key, { sum: existing.sum + valueFn(item), count: existing.count + 1 });
  });
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([key, { sum, count }]) => ({
      week: getWeekLabel(new Date(key)),
      value: Math.round(sum / count),
      count,
    }));
}

export default function Progress() {
  const navigate = useNavigate();

  const { data: benchmark } = useQuery({
    queryKey: ['latest-benchmark'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await (supabase as any)
        .from('skill_benchmarks')
        .select('scores, overall_avg, run_at')
        .eq('user_id', user.id)
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: grades } = useQuery({
    queryKey: ['grades-history'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('transcript_grades')
        .select('overall_score, created_at')
        .eq('user_id', user.id)
        .gte('created_at', eightWeeksAgo)
        .order('created_at', { ascending: true });
      return data ?? [];
    },
  });

  // Phase 1: practice volume comes from user_competency (curriculum ladder).
  const { data: sessions } = useQuery({
    queryKey: ['competency-history'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await (supabase as any)
        .from('user_competency')
        .select('updated_at, reps, progress')
        .eq('user_id', user.id)
        .gte('updated_at', eightWeeksAgo)
        .order('updated_at', { ascending: true });
      // Normalise to the shape groupByWeek expects (created_at + value=1 per touch).
      return (data ?? []).map((r: any) => ({ created_at: r.updated_at }));
    },
  });

  const { data: lessonStats } = useQuery({
    queryKey: ['lesson-stats'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const [{ count: total }, { count: generated }, { count: passed }] = await Promise.all([
        supabase.from('learning_lessons').select('id', { count: 'exact', head: true }),
        supabase.from('learning_lessons').select('id', { count: 'exact', head: true }).eq('generation_status', 'complete'),
        (supabase as any).from('user_lesson_progress').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'passed'),
      ]);
      return { total: total ?? 0, generated: generated ?? 0, passed: passed ?? 0 };
    },
  });

  // Phase 1: weekly summary derives from user_competency, not dojo_sessions.
  const { data: weekSummary } = useQuery({
    queryKey: ['progress-week-summary-competency'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return null;
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await (supabase as any)
        .from('user_competency')
        .select('sub_level, reps, progress, gate_passed_at, updated_at')
        .eq('user_id', u.id)
        .gte('updated_at', weekAgo);
      const list = (rows ?? []) as Array<{ reps: number; progress: number; gate_passed_at: string | null }>;
      const sessions = list.length;                                  // distinct sub-levels advanced this week
      const reps = list.reduce((a, r) => a + (Number(r.reps) || 0), 0);
      const progresses = list.map((r) => Number(r.progress) || 0);
      const avgScore = progresses.length
        ? Math.round((progresses.reduce((a, b) => a + b, 0) / progresses.length) * 100)
        : null;
      return { sessions, reps, avgScore };
    },
  });

  const { data: dimPerf } = useQuery({
    queryKey: ['dimension-performance'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return [];
      const { data } = await (supabase as any)
        .from('dimension_scores')
        .select('spider_dimension, avg_score_100')
        .eq('user_id', u.id)
        .order('avg_score_100', { ascending: true });
      return data ?? [];
    },
  });

  const callTrend = useMemo(() =>
    grades ? groupByWeek(grades as any[], (g: any) => (g.overall_score ?? 0)) : [],
    [grades],
  );

  const repVolume = useMemo(() =>
    sessions ? groupByWeek(sessions as any[], () => 1).map(w => ({ ...w, value: w.count })) : [],
    [sessions],
  );

  const benchmarkDims = useMemo(() => {
    if (!benchmark?.scores) return [];
    return SPIDER_DIMENSIONS
      .map(d => ({ label: d.label, score: benchmark.scores[d.key] ?? 0, color: d.color }))
      .sort((a, b) => a.score - b.score);
  }, [benchmark]);

  return (
    <Layout>
      <div className="px-4 pt-4 pb-24 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h1 className="font-display text-xl font-bold">Progress</h1>
          </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>← Back</Button>
        </div>

        {weekSummary && (weekSummary.sessions > 0 || weekSummary.reps > 0) && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Sub-levels', value: weekSummary.sessions },
              { label: 'Reps', value: weekSummary.reps },
              { label: 'Avg Progress', value: weekSummary.avgScore != null ? `${weekSummary.avgScore}%` : '—' },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-bold font-mono">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label} this week</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Skill Baseline</p>
              </div>
              {benchmark ? (
                <Badge variant="outline" className="text-xs">
                  {Math.round(benchmark.overall_avg ?? 0)}/100 avg
                </Badge>
              ) : null}
            </div>

            {!benchmark ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">No benchmark taken yet. Your spider chart has no permanent baseline.</p>
                <Button size="sm" className="w-full" onClick={() => navigate('/benchmark')}>
                  Take Baseline Benchmark <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {benchmarkDims.map(d => (
                  <div key={d.label} className="flex items-center gap-3">
                    <p className="text-xs text-muted-foreground w-32 shrink-0">{d.label}</p>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${d.score}%`, background: d.color }}
                      />
                    </div>
                    <span className={cn(
                      'text-xs font-mono font-semibold w-8 text-right shrink-0',
                      d.score < 50 ? 'text-red-500' : d.score < 70 ? 'text-amber-500' : 'text-green-500',
                    )}>{d.score}</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Taken {new Date(benchmark.run_at).toLocaleDateString()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Call Quality Trend</p>
              <span className="text-xs text-muted-foreground ml-auto">8 weeks</span>
            </div>
            {callTrend.length < 2 ? (
              <div className="py-4 text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  {(grades?.length ?? 0) === 0
                    ? 'No calls graded yet — your trend lives here.'
                    : `${grades?.length} call${(grades?.length ?? 0) !== 1 ? 's' : ''} graded, but all outside the 8-week window.`}
                </p>
                <button
                  onClick={() => navigate('/grade')}
                  className="text-xs font-medium text-primary hover:text-primary/80"
                >
                  Grade a call →
                </button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={callTrend} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} ticks={[0, 25, 50, 75, 100]} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v: any) => [`${v}/100`, 'Avg score']}
                  />
                  <Line
                    type="monotone" dataKey="value"
                    stroke="hsl(var(--primary))" strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))', r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {dimPerf && dimPerf.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">Call Performance by Skill</p>
              <p className="text-[11px] text-muted-foreground">From {grades?.length ?? 0} graded calls</p>
              <div className="space-y-2">
                {dimPerf.map((d: any) => {
                  const score = Math.round(Number(d.avg_score_100));
                  const dim = SPIDER_DIMENSIONS.find(s => s.key === d.spider_dimension);
                  return (
                    <div key={d.spider_dimension} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{dim?.label ?? d.spider_dimension.replace(/_/g, ' ')}</p>
                        <p className={cn('text-xs font-mono font-semibold',
                          score < 40 ? 'text-red-500' : score < 60 ? 'text-amber-500' : 'text-green-500'
                        )}>{score}</p>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${score}%`,
                            background: score < 40 ? 'rgb(239,68,68)' : score < 60 ? 'rgb(245,158,11)' : 'rgb(34,197,94)'
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Dumbbell className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Drill Reps</p>
              <span className="text-xs text-muted-foreground ml-auto">8 weeks</span>
            </div>
            {repVolume.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No sessions yet this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={repVolume} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [v, 'Sessions']} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Learning Progress</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: 'Total Lessons', value: lessonStats?.total ?? 0 },
                { label: 'Generated', value: lessonStats?.generated ?? 0 },
                { label: 'Mastered', value: lessonStats?.passed ?? 0 },
              ].map(stat => (
                <div key={stat.label} className="space-y-1">
                  <p className="text-2xl font-bold font-mono">{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
            <Button
              variant="ghost" size="sm" className="w-full mt-3"
              onClick={() => navigate('/learn')}
            >
              Open Courses <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
            <Button
              variant="outline"
              className="w-full mt-2"
              onClick={() => navigate('/review')}
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Weekly Review
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
