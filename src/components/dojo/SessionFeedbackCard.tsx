import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, TrendingDown, ChevronRight, BookOpen, Swords,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import {
  deriveSessionInsights,
  getNextAction,
  type SessionResult,
  type NextAction,
} from '@/lib/dojo/feedbackLoop';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

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

  const insights = useMemo(() => deriveSessionInsights(sessionResult), [skillFocus, score, topMistake]);
  const nextAction = useMemo(() => getNextAction(sessionResult, insights), [sessionResult, insights]);

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
      // Fallback: go to learn page filtered
      navigate('/learn');
    } else {
      // Dojo rep
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

        {/* What needs work */}
        <div className="flex items-start gap-2">
          <TrendingDown className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">{insights.weaknessSignal}</p>
        </div>

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
