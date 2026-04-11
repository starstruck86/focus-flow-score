import { useMemo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, TrendingDown, BookOpen, Swords,
  ArrowRight, AlertTriangle, Lightbulb,
} from 'lucide-react';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import {
  deriveSessionInsights,
  getNextAction,
  type SessionResult,
  type RecentSessionSummary,
} from '@/lib/dojo/feedbackLoop';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

interface SessionFeedbackCardProps {
  skillFocus: SkillFocus;
  score: number;
  topMistake?: string;
  focusPattern?: string;
  practiceCue?: string;
  retryCount: number;
  sessionType: string;
  fromLessonId?: string;
}

export function SessionFeedbackCard({
  skillFocus,
  score,
  topMistake,
  focusPattern,
  practiceCue,
  retryCount,
  sessionType,
  fromLessonId,
}: SessionFeedbackCardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const sessionResult: SessionResult = {
    skillFocus,
    score,
    topMistake,
    focusPattern,
    practiceCue,
    retryCount,
    sessionType,
    fromLessonId,
  };

  // Fetch recent sessions for pattern-aware recommendations
  const { data: recentSessions } = useQuery({
    queryKey: ['recent-dojo-sessions', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('dojo_session_turns')
        .select('score, score_json, session_id, created_at')
        .eq('user_id', user!.id)
        .eq('turn_index', 0) // first attempts only
        .order('created_at', { ascending: false })
        .limit(10);

      if (!data?.length) return [];

      // Get session skill mappings
      const sessionIds = [...new Set(data.map(d => d.session_id))];
      const { data: sessions } = await supabase
        .from('dojo_sessions')
        .select('id, skill_focus')
        .in('id', sessionIds);

      const skillMap = new Map<string, SkillFocus>();
      for (const s of sessions ?? []) {
        skillMap.set(s.id, s.skill_focus as SkillFocus);
      }

      return data.map(d => {
        const sj = d.score_json as Record<string, unknown> | null;
        return {
          skillFocus: skillMap.get(d.session_id) ?? 'objection_handling' as SkillFocus,
          score: d.score ?? 0,
          topMistake: typeof sj?.topMistake === 'string' ? sj.topMistake : undefined,
          createdAt: d.created_at,
        } satisfies RecentSessionSummary;
      });
    },
    staleTime: 30_000,
  });

  const insights = useMemo(() => deriveSessionInsights(sessionResult), [skillFocus, score, topMistake]);
  const nextAction = useMemo(
    () => getNextAction(sessionResult, insights, recentSessions ?? undefined),
    [sessionResult, insights, recentSessions],
  );

  // If next action is lesson, find a matching lesson by topic
  const { data: matchingLesson } = useQuery({
    queryKey: ['lesson-by-topic', nextAction.lessonTopic],
    enabled: nextAction.type === 'lesson' && !!nextAction.lessonTopic,
    queryFn: async () => {
      const { data } = await supabase
        .from('learning_lessons')
        .select('id, title')
        .eq('topic', nextAction.lessonTopic!)
        .limit(1)
        .single();
      return data;
    },
    staleTime: 60_000,
  });

  const handleNextAction = () => {
    if (nextAction.type === 'lesson' && matchingLesson) {
      navigate(`/learn/lesson/${matchingLesson.id}`);
    } else if (nextAction.type === 'lesson') {
      navigate('/learn');
    } else {
      navigate('/dojo/session', {
        state: {
          skillFocus: nextAction.targetTopic,
          mode: 'custom',
          sessionType: nextAction.suggestedMode === 'roleplay' ? 'roleplay' : 'drill',
        },
      });
    }
  };

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4 space-y-3">
        {/* What went well */}
        {insights.strengthSignal && (
          <div className="flex items-start gap-2">
            <TrendingUp className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">{insights.strengthSignal}</p>
          </div>
        )}

        {/* What needs work — enriched with taxonomy */}
        <div className="flex items-start gap-2">
          <TrendingDown className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div className="space-y-1">
            {insights.mistakeDetail && (
              <p className="text-xs font-semibold text-destructive">
                {insights.mistakeDetail.label}
              </p>
            )}
            <p className="text-sm text-muted-foreground">{insights.weaknessSignal}</p>
          </div>
        </div>

        {/* What good looks like */}
        {insights.actionableFix && (
          <div className="flex items-start gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                What good looks like
              </p>
              <p className="text-sm text-foreground">{insights.actionableFix}</p>
            </div>
          </div>
        )}

        {/* Coaching direction */}
        <div className="border-t border-border/40 pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            What to do next
          </p>
          <p className="text-sm font-medium text-foreground leading-relaxed">
            {nextAction.message}
          </p>
        </div>

        {/* CTA */}
        <Button
          className="w-full gap-2"
          onClick={handleNextAction}
        >
          {nextAction.type === 'lesson' ? (
            <BookOpen className="h-4 w-4" />
          ) : (
            <Swords className="h-4 w-4" />
          )}
          {nextAction.ctaLabel}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
