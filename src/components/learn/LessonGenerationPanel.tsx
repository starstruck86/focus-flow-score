import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Sparkles, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Lesson {
  id: string;
  title: string;
  generation_status: string | null;
}

interface LessonGenerationPanelProps {
  lessons: Lesson[];
  onComplete?: () => void;
}

const CHECKPOINT_KEY = 'lesson_generation_checkpoint';

type LessonStatus = 'pending' | 'generating' | 'done' | 'failed' | 'skipped';

export function LessonGenerationPanel({ lessons, onComplete }: LessonGenerationPanelProps) {
  const needsGeneration = lessons.filter(l => !l.generation_status || l.generation_status === 'not_started' || l.generation_status === 'failed');
  
  const [isRunning, setIsRunning] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, LessonStatus>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Load checkpoint from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHECKPOINT_KEY);
      if (saved) {
        const { completed = [] } = JSON.parse(saved);
        const initial: Record<string, LessonStatus> = {};
        needsGeneration.forEach(l => {
          initial[l.id] = completed.includes(l.id) ? 'done' : 'pending';
        });
        setStatusMap(initial);
        setCurrentIndex(completed.length);
      }
    } catch {}
  }, []);

  const saveCheckpoint = useCallback((completedIds: string[]) => {
    try {
      localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ completed: completedIds }));
    } catch {}
  }, []);

  const runGeneration = useCallback(async () => {
    setIsRunning(true);
    setExpanded(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setIsRunning(false);
      return;
    }

    const supabaseUrl = (supabase as any).supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
    const completedIds: string[] = [];

    // Resume from checkpoint  checkpoint
    try {
      const saved = localStorage.getItem(CHECKPOINT_KEY);
      if (saved) {
        const { completed = [] } = JSON.parse(saved);
        completedIds.push(...completed);
      }
    } catch {}

    for (let i = 0; i < needsGeneration.length; i++) {
      const lesson = needsGeneration[i];
      setCurrentIndex(i);

      // Skip already completed in this run
      if (completedIds.includes(lesson.id)) {
        setStatusMap(prev => ({ ...prev, [lesson.id]: 'done' }));
        continue;
      }

      setStatusMap(prev => ({ ...prev, [lesson.id]: 'generating' }));

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/generate-lesson-content`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ lessonId: lesson.id }),
        });

        if (res.ok) {
          const json = await res.json();
          if (json.status === 'complete' || json.status === 'already_generated') {
            setStatusMap(prev => ({ ...prev, [lesson.id]: 'done' }));
            completedIds.push(lesson.id);
            saveCheckpoint(completedIds);
          } else {
            setStatusMap(prev => ({ ...prev, [lesson.id]: 'failed' }));
          }
        } else {
          setStatusMap(prev => ({ ...prev, [lesson.id]: 'failed' }));
        }
      } catch {
        setStatusMap(prev => ({ ...prev, [lesson.id]: 'failed' }));
      }

      // Brief pause between requests
      await new Promise(r => setTimeout(r, 500));
    }

    setIsRunning(false);
    localStorage.removeItem(CHECKPOINT_KEY);
    onComplete?.();
  }, [needsGeneration, saveCheckpoint, onComplete]);

  const resetCheckpoint = useCallback(() => {
    localStorage.removeItem(CHECKPOINT_KEY);
    setStatusMap({});
    setCurrentIndex(0);
  }, []);

  if (needsGeneration.length === 0) return null;

  const doneCount = Object.values(statusMap).filter(s => s === 'done').length;
  const failedCount = Object.values(statusMap).filter(s => s === 'failed').length;
  const hasCheckpoint = doneCount > 0 && !isRunning;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-sm font-semibold text-foreground">
                {isRunning
                  ? `Generating lesson ${currentIndex + 1} of ${needsGeneration.length}…`
                  : hasCheckpoint
                  ? `${doneCount} of ${needsGeneration.length} generated`
                  : `${needsGeneration.length} lessons need generation`}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 ml-6">
              {isRunning ? 'Keep this screen open' : 'Calibrated for Strategic AE · enterprise scenarios'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasCheckpoint && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={resetCheckpoint}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={isRunning}
              onClick={isRunning ? undefined : runGeneration}
            >
              {isRunning ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Running</>
              ) : hasCheckpoint ? 'Resume' : 'Generate All'}
            </Button>
          </div>
        </div>

        {/* Progress list — shown when running or expanded */}
        {(isRunning || expanded) && needsGeneration.length > 0 && (
          <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
            {needsGeneration.map((lesson, _i) => {
              const status = statusMap[lesson.id] ?? 'pending';
              return (
                <div key={lesson.id} className="flex items-center gap-2 text-xs">
                  {status === 'generating' && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
                  {status === 'done' && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
                  {status === 'failed' && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                  {(status === 'pending' || status === 'skipped') && (
                    <div className="h-3 w-3 rounded-full border border-border shrink-0" />
                  )}
                  <span className={status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                    {lesson.title}
                  </span>
                  {status === 'generating' && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1">generating</Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {failedCount > 0 && !isRunning && (
          <p className="text-xs text-red-500 mt-2 ml-6">{failedCount} failed — tap Resume to retry</p>
        )}
      </CardContent>
    </Card>
  );
}
