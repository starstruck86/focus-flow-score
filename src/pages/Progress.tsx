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

  const { data: sessions } = useQuery({
    queryKey: ['sessions-history'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await (supabase as any)
        .from('dojo_sessions')
        .select('created_at')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('created_at', eightWeeksAgo)
        .order('created_at', { ascending: true });
      return data ?? [];
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

  const { data: weekSummary } = useQuery({
    queryKey: ['progress-week-summary'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return null;
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [{ count: sessions }, { data: turns }] = await Promise.all([
        (supabase as any).from('dojo_sessions').select('id', { count: 'exact', head: true }).eq('user_id', u.id).eq('status', 'completed').gte('completed_at', weekAgo),
        (supabase as any).from('dojo_session_turns').select('score').eq('user_id', u.id).gte('created_at', weekAgo),
      ]);
      const scores = (turns ?? []).map((t: any) => Number(t.score)).filter(Boolean);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;
      return { sessions: sessions ?? 0, reps: scores.length, avgScore };
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
              <p className="text-xs text-muted-foreground py-4 text-center">
                Grade more calls to see your trend. {grades?.length ?? 0} call{(grades?.length ?? 0) !== 1 ? 's' : ''} graded.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={callTrend} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickCount={5} />
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
