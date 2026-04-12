/**
 * CourseCard — Extracted from Learn.tsx for modularity
 */

import { Badge } from '@/components/ui/badge';
import { ChevronRight, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { CourseWithModules, LearningProgress } from '@/lib/learning/types';

interface CourseCardProps {
  course: CourseWithModules;
  progressMap: Record<string, LearningProgress>;
  onLessonClick: (id: string) => void;
}

export function CourseCard({ course, progressMap, onLessonClick }: CourseCardProps) {
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
