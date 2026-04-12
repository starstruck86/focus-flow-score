import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { BookOpen, ChevronRight, CheckCircle2, Circle, Loader2, TrendingUp, TrendingDown, GraduationCap } from 'lucide-react';
import { useCourses, useUserProgress } from '@/lib/learning/hooks';
import type { CourseWithModules, LearningProgress } from '@/lib/learning/types';
import { useMemo } from 'react';
import { useDailyKI } from '@/hooks/useDailyKI';
import { DailyKICard } from '@/components/learn/DailyKICard';

export default function Learn() {
  const navigate = useNavigate();
  const { data: courses, isLoading } = useCourses();
  const { data: progress } = useUserProgress();

  const progressMap = useMemo(() => {
    const map: Record<string, LearningProgress> = {};
    (progress || []).forEach(p => { map[p.lesson_id] = p; });
    return map;
  }, [progress]);

  // Compute topic mastery
  const topicMastery = useMemo(() => {
    if (!courses || !progress) return [];
    const topics: Record<string, { total: number; completed: number; totalScore: number }> = {};
    courses.forEach(c => {
      if (!topics[c.topic]) topics[c.topic] = { total: 0, completed: 0, totalScore: 0 };
      c.learning_modules.forEach(m => {
        m.learning_lessons.forEach(l => {
          topics[c.topic].total++;
          const p = progressMap[l.id];
          if (p?.status === 'completed') {
            topics[c.topic].completed++;
            topics[c.topic].totalScore += p.mastery_score ?? 0;
          }
        });
      });
    });
    return Object.entries(topics).map(([topic, data]) => ({
      topic,
      total: data.total,
      completed: data.completed,
      avgMastery: data.completed > 0 ? data.totalScore / data.completed : 0,
      pct: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
    }));
  }, [courses, progress, progressMap]);

  const strongest = topicMastery.length > 0
    ? topicMastery.reduce((a, b) => a.avgMastery > b.avgMastery ? a : b)
    : null;
  const weakest = topicMastery.length > 1
    ? topicMastery.reduce((a, b) => a.avgMastery < b.avgMastery ? a : b)
    : null;

  // Find next recommended lesson
  const nextLesson = useMemo(() => {
    if (!courses) return null;
    for (const course of courses) {
      for (const mod of course.learning_modules) {
        for (const lesson of mod.learning_lessons) {
          const p = progressMap[lesson.id];
          if (!p || p.status !== 'completed') {
            return { lesson, course };
          }
        }
      }
    }
    return null;
  }, [courses, progressMap]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-5', SHELL.main.bottomPad)}>
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">Learning Engine</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {nextLesson
                ? `Up next: ${nextLesson.lesson.title}`
                : 'All lessons completed. Review weak areas below.'}
            </p>
          </div>
        </div>

        {/* Next lesson CTA */}
        {nextLesson && (
          <button
            onClick={() => navigate(`/learn/lesson/${nextLesson.lesson.id}`)}
            className="w-full h-14 rounded-md bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 shadow-sm hover:bg-primary/85 transition-colors"
          >
            <BookOpen className="h-5 w-5" />
            Start Next Lesson
          </button>
        )}

        {/* Mastery overview */}
        {topicMastery.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Topic Mastery
            </p>
            {topicMastery.map(t => (
              <div key={t.topic} className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium capitalize">{t.topic.replace(/_/g, ' ')}</p>
                  <span className="text-xs text-muted-foreground">{t.completed}/{t.total} lessons · {t.pct}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      t.pct >= 75 ? 'bg-green-500' : t.pct >= 40 ? 'bg-amber-500' : 'bg-primary'
                    )}
                    style={{ width: `${t.pct}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {strongest && strongest.completed > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-green-500/5 border border-green-500/15">
                  <TrendingUp className="h-3 w-3 text-green-500 shrink-0" />
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-medium text-foreground">Strong:</span> {strongest.topic.replace(/_/g, ' ')}
                  </p>
                </div>
              )}
              {weakest && weakest !== strongest && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-red-500/5 border border-red-500/15">
                  <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-medium text-foreground">Needs work:</span> {weakest.topic.replace(/_/g, ' ')}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Course list */}
        {(courses || []).map(course => (
          <CourseCard
            key={course.id}
            course={course}
            progressMap={progressMap}
            onLessonClick={(id) => navigate(`/learn/lesson/${id}`)}
          />
        ))}
      </div>
    </Layout>
  );
}

function CourseCard({
  course,
  progressMap,
  onLessonClick,
}: {
  course: CourseWithModules;
  progressMap: Record<string, LearningProgress>;
  onLessonClick: (id: string) => void;
}) {
  const totalLessons = course.learning_modules.reduce((s, m) => s + m.learning_lessons.length, 0);
  const completed = course.learning_modules.reduce(
    (s, m) => s + m.learning_lessons.filter(l => progressMap[l.id]?.status === 'completed').length,
    0
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{course.title}</p>
          <p className="text-xs text-muted-foreground">{completed}/{totalLessons} lessons completed</p>
        </div>
        <Badge variant="secondary" className="text-[10px] capitalize">
          {course.difficulty_level}
        </Badge>
      </div>

      {course.learning_modules.map(mod => (
        <div key={mod.id} className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground pl-1">{mod.title}</p>
          {mod.learning_lessons.map(lesson => {
            const p = progressMap[lesson.id];
            const status = p?.status || 'not_started';
            return (
              <button
                key={lesson.id}
                onClick={() => onLessonClick(lesson.id)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card hover:bg-accent/50 transition-colors text-left"
              >
                {status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                ) : status === 'in_progress' ? (
                  <Loader2 className="h-4 w-4 text-amber-500 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{lesson.title}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{lesson.difficulty_level}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
