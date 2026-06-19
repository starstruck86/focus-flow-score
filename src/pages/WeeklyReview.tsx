import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, Target, ChevronRight, CheckCircle2 } from 'lucide-react';
import { SPIDER_DIMENSIONS } from '@/hooks/useKiProficiency';

interface WeeklyData {
  sessionsThisWeek: number;
  avgScoreThisWeek: number | null;
  avgScoreLastWeek: number | null;
  worstDimension: string | null;
  worstScore: number | null;
  callsGraded: number;
  avgCallScore: number | null;
  kisMastered: number; // ki_mastery rows with avg_score >= 70 updated this week
}

export default function WeeklyReview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [commitment, setCommitment] = useState('');
  const [focusDimension, setFocusDimension] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const startOfThisWeek = new Date();
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay()); // Sunday
  startOfThisWeek.setHours(0, 0, 0, 0);

  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const { data: weeklyData, isLoading } = useQuery<WeeklyData>({
    queryKey: ['weekly-review', user?.id, startOfThisWeek.toISOString()],
    enabled: !!user?.id,
    queryFn: async () => {
      const uid = user!.id;

      const [sessionsThis, sessionsLast, dimScores, callGrades, kiMastered] = await Promise.all([
        // Sessions this week
        (supabase as any).from('dojo_sessions')
          .select('best_score, created_at')
          .eq('user_id', uid)
          .eq('status', 'completed')
          .gte('created_at', startOfThisWeek.toISOString()),
        // Sessions last week
        (supabase as any).from('dojo_sessions')
          .select('best_score, created_at')
          .eq('user_id', uid)
          .eq('status', 'completed')
          .gte('created_at', startOfLastWeek.toISOString())
          .lt('created_at', startOfThisWeek.toISOString()),
        // KI mastery by dimension (for worst dimension)
        (supabase as any).from('ki_mastery')
          .select('spider_dimension, avg_score')
          .eq('user_id', uid)
          .gte('updated_at', startOfThisWeek.toISOString()),
        // Calls graded this week
        (supabase as any).from('transcript_grades')
          .select('overall_score')
          .eq('user_id', uid)
          .gte('created_at', startOfThisWeek.toISOString()),
        // KIs mastered (avg_score >= 70) updated this week
        (supabase as any).from('ki_mastery')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid)
          .gte('avg_score', 70)
          .gte('updated_at', startOfThisWeek.toISOString()),
      ]);

      const thisScores = (sessionsThis.data || []).map((s: any) => Number(s.best_score)).filter(Boolean);
      const lastScores = (sessionsLast.data || []).map((s: any) => Number(s.best_score)).filter(Boolean);

      // Find worst dimension by avg score this week
      const dimMap: Record<string, number[]> = {};
      (dimScores.data || []).forEach((r: any) => {
        if (r.spider_dimension && r.avg_score != null) {
          if (!dimMap[r.spider_dimension]) dimMap[r.spider_dimension] = [];
          dimMap[r.spider_dimension].push(Number(r.avg_score));
        }
      });
      let worstDim: string | null = null;
      let worstScore: number | null = null;
      Object.entries(dimMap).forEach(([dim, scores]) => {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (worstScore === null || avg < worstScore) {
          worstScore = avg;
          worstDim = dim;
        }
      });

      const callScores = (callGrades.data || []).map((g: any) => Number(g.overall_score) * 20).filter(Boolean);

      return {
        sessionsThisWeek: thisScores.length,
        avgScoreThisWeek: thisScores.length > 0 ? Math.round(thisScores.reduce((a, b) => a + b, 0) / thisScores.length) : null,
        avgScoreLastWeek: lastScores.length > 0 ? Math.round(lastScores.reduce((a, b) => a + b, 0) / lastScores.length) : null,
        worstDimension: worstDim,
        worstScore: worstScore ? Math.round(worstScore) : null,
        callsGraded: callScores.length,
        avgCallScore: callScores.length > 0 ? Math.round(callScores.reduce((a, b) => a + b, 0) / callScores.length) : null,
        kisMastered: kiMastered.count ?? 0,
      };
    },
  });

  const scoreDelta = weeklyData?.avgScoreThisWeek != null && weeklyData?.avgScoreLastWeek != null
    ? weeklyData.avgScoreThisWeek - weeklyData.avgScoreLastWeek : null;

  const worstDimLabel = SPIDER_DIMENSIONS.find(d => d.key === weeklyData?.worstDimension)?.label;

  const handleSubmit = () => {
    if (!commitment.trim() || !focusDimension) return;
    // Store commitment in localStorage for Proactive Dave to reference
    localStorage.setItem('weekly_commitment', JSON.stringify({
      text: commitment,
      dimension: focusDimension,
      setAt: new Date().toISOString(),
    }));
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Layout>
        <div className="px-4 pt-12 pb-24 flex flex-col items-center gap-6 max-w-lg mx-auto text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <div>
            <p className="text-xl font-bold">Week reviewed. Monday's locked in.</p>
            <p className="text-sm text-muted-foreground mt-1">Focus: {SPIDER_DIMENSIONS.find(d => d.key === focusDimension)?.label}</p>
          </div>
          <Card className="w-full border-primary/20 bg-primary/5">
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Your commitment</p>
              <p className="text-sm leading-relaxed">{commitment}</p>
            </CardContent>
          </Card>
          <Button className="w-full" onClick={() => navigate('/dojo')}>Back to Dojo</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 pt-4 pb-24 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold">Weekly Review</h1>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Loading your week…</div>
        ) : (
          <>
            {/* Week summary stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Sessions', value: weeklyData?.sessionsThisWeek ?? 0 },
                { label: 'Calls Graded', value: weeklyData?.callsGraded ?? 0 },
                { label: 'KIs Mastered', value: weeklyData?.kisMastered ?? 0 },
              ].map(stat => (
                <Card key={stat.label}>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold font-mono">{stat.value}</p>
                    <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Score trend */}
            {weeklyData?.avgScoreThisWeek != null && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Avg drill score this week</p>
                      <p className="text-3xl font-bold font-mono">{weeklyData.avgScoreThisWeek}</p>
                    </div>
                    {scoreDelta !== null && (
                      <div className={cn('flex items-center gap-1 text-sm font-medium',
                        scoreDelta > 0 ? 'text-green-500' : scoreDelta < 0 ? 'text-red-500' : 'text-muted-foreground'
                      )}>
                        {scoreDelta > 0 ? <TrendingUp className="h-4 w-4" /> :
                         scoreDelta < 0 ? <TrendingDown className="h-4 w-4" /> :
                         <Minus className="h-4 w-4" />}
                        {scoreDelta > 0 ? '+' : ''}{scoreDelta} vs last week
                      </div>
                    )}
                  </div>
                  {weeklyData.avgCallScore != null && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Call quality: {weeklyData.avgCallScore}/100 avg across {weeklyData.callsGraded} call{weeklyData.callsGraded !== 1 ? 's' : ''}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Worst dimension callout */}
            {worstDimLabel && weeklyData?.worstScore != null && (
              <Card className="border-red-500/20 bg-red-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Target className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">Weakest this week: {worstDimLabel}</p>
                      <p className="text-xs text-muted-foreground">{weeklyData.worstScore}/100 avg — this should be your Monday focus</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Set Monday's focus */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-sm font-semibold">Set Monday's focus</p>
                <div className="grid grid-cols-2 gap-2">
                  {SPIDER_DIMENSIONS.slice(0, 6).map(dim => (
                    <button
                      key={dim.key}
                      onClick={() => setFocusDimension(dim.key)}
                      className={cn(
                        'text-left p-2 rounded-lg border text-xs transition-all flex items-center gap-1.5',
                        focusDimension === dim.key
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ background: dim.color }} />
                      {dim.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Commitment */}
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-semibold">One specific commitment for next week</p>
                <p className="text-xs text-muted-foreground">What will you do differently on calls because of this week?</p>
                <Textarea
                  placeholder="e.g. I will ask one deepening question after every pain statement before moving on…"
                  value={commitment}
                  onChange={e => setCommitment(e.target.value)}
                  className="text-sm min-h-[80px] resize-none"
                  rows={3}
                />
              </CardContent>
            </Card>

            <Button
              className="w-full"
              disabled={!commitment.trim() || !focusDimension}
              onClick={handleSubmit}
            >
              Lock In Monday's Focus <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </>
        )}
      </div>
    </Layout>
  );
}
