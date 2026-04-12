import { BookOpen } from 'lucide-react';

interface Props {
  lessons: Array<{ lessonId: string; title: string; reason: string }>;
}

export function RecommendedLessonListCard({ lessons }: Props) {
  if (lessons.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Best lessons for this
      </p>
      {lessons.map((lesson) => (
        <div
          key={lesson.lessonId}
          className="flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-muted/30 border border-border/30"
        >
          <BookOpen className="h-3 w-3 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{lesson.title}</p>
            <p className="text-[10px] text-muted-foreground">{lesson.reason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
