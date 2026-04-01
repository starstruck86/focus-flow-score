import { useState, useCallback } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, BookOpen, ExternalLink, Video, FileText, HelpCircle } from 'lucide-react';
import { useClassifyResource, useAddUrlResource } from '@/hooks/useResourceUpload';
import { toast } from 'sonner';

type LessonItem = {
  title: string;
  url: string;
  module: string;
  index: number;
  duration?: string;
  type?: string;
};

interface CourseImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_ICONS: Record<string, typeof Video> = {
  video: Video,
  text: FileText,
  quiz: HelpCircle,
};

export function CourseImportModal({ open, onOpenChange }: CourseImportModalProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [platform, setPlatform] = useState('');
  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, current: '' });

  const classify = useClassifyResource();
  const addUrl = useAddUrlResource();

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setLessons([]);
    setCourseTitle('');
    try {
      const { data, error } = await trackedInvoke<any>('import-course', {
        body: { url: url.trim(), action: 'discover' },
        timeoutMs: 120_000,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch course');
      
      const items: LessonItem[] = data.lessons || [];
      if (items.length === 0) {
        toast.error('No lessons found in this course');
        return;
      }
      setCourseTitle(data.title || 'Untitled Course');
      setPlatform(data.platform || 'unknown');
      setLessons(items);
      setSelected(new Set(items.map((_, i) => i)));
    } catch (e: any) {
      toast.error(e.message || 'Failed to fetch course');
    } finally {
      setFetching(false);
    }
  }, [url]);

  const toggleLesson = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === lessons.length) setSelected(new Set());
    else setSelected(new Set(lessons.map((_, i) => i)));
  };

  const selectCount = (count: number) => {
    setSelected(new Set(lessons.slice(0, count).map((_, i) => i)));
  };

  const handleImport = useCallback(async () => {
    const toImport = lessons.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length, current: '' });

    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      const lesson = toImport[i];
      setImportProgress({ done: i, total: toImport.length, current: lesson.title });
      try {
        // First fetch the lesson content
        const { data: lessonData } = await trackedInvoke<any>('import-course', {
          body: { url: url.trim(), action: 'fetch_lesson', lesson_url: lesson.url },
          timeoutMs: 60_000,
        });

        // Classify and add as resource
        const classification = await classify.mutateAsync({ url: lesson.url });
        if (classification.title === 'Untitled' || classification.title.length < 3) {
          classification.title = lesson.title;
        }
        // Override with lesson content if we got it
        if (lessonData?.success && lessonData.content && lessonData.content.length > 50) {
          classification.scraped_content = lessonData.content;
        }
        classification.resource_type = lesson.type === 'video' ? 'video' : 'article';
        classification.tags = [...(classification.tags || []), 'course', courseTitle].filter(Boolean);
        
        await addUrl.mutateAsync({ url: lesson.url, classification });
        successCount++;
      } catch (e) {
        console.error(`Failed to import ${lesson.title}:`, e);
      }
      setImportProgress({ done: i + 1, total: toImport.length, current: '' });
    }

    toast.success(`Imported ${successCount} of ${toImport.length} lessons`);
    setImporting(false);
    setLessons([]);
    setUrl('');
    setSelected(new Set());
    onOpenChange(false);
  }, [lessons, selected, classify, addUrl, onOpenChange, url, courseTitle]);

  const selectedCount = selected.size;
  const progressPct = importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0;

  // Group by module
  const modules = new Map<string, { lesson: LessonItem; index: number }[]>();
  lessons.forEach((lesson, i) => {
    const mod = lesson.module || 'Course Content';
    if (!modules.has(mod)) modules.set(mod, []);
    modules.get(mod)!.push({ lesson, index: i });
  });

  return (
    <Dialog open={open} onOpenChange={importing ? undefined : onOpenChange}>
      <DialogContent className="max-w-lg flex flex-col" style={{ maxHeight: '90vh' }}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Import Course
          </DialogTitle>
          {courseTitle && (
            <div className="text-sm text-muted-foreground mt-1">
              <span className="font-medium">{courseTitle}</span>
              {platform && <Badge variant="outline" className="ml-2 text-[10px]">{platform}</Badge>}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="flex gap-2 flex-shrink-0">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://training.example.com/products/course-name"
              disabled={fetching || importing}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
            <Button onClick={handleFetch} disabled={fetching || importing || !url.trim()} size="sm">
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Scan'}
            </Button>
          </div>

          {lessons.length > 0 && !importing && (
            <>
              <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Selected: <span className="font-semibold text-foreground">{selectedCount}</span> of {lessons.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3].map(n => (
                    <Button
                      key={n}
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2"
                      onClick={() => selectCount(n)}
                      disabled={lessons.length < n}
                    >
                      {n}
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
                    {selected.size === lessons.length ? 'None' : 'All'}
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1 min-h-0 border rounded-md">
                <div className="p-2 space-y-3">
                  {[...modules.entries()].map(([mod, items]) => (
                    <div key={mod}>
                      {modules.size > 1 && (
                        <div className="px-2 py-1 mb-1">
                          <Badge variant="secondary" className="text-[10px] font-medium">{mod}</Badge>
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {items.map(({ lesson, index }) => {
                          const Icon = TYPE_ICONS[lesson.type || 'text'] || FileText;
                          return (
                            <label
                              key={index}
                              className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm transition-colors ${
                                selected.has(index)
                                  ? 'bg-primary/10 hover:bg-primary/15'
                                  : 'hover:bg-muted/50'
                              }`}
                              onClick={() => toggleLesson(index)}
                            >
                              <Checkbox
                                checked={selected.has(index)}
                                onCheckedChange={() => toggleLesson(index)}
                              />
                              <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="flex-1 truncate">{lesson.title}</span>
                              {lesson.duration && (
                                <span className="text-[10px] text-muted-foreground">{lesson.duration}</span>
                              )}
                              <a
                                href={lesson.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={e => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          {importing && (
            <div className="space-y-2 flex-shrink-0">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate flex-1">
                  {importProgress.current
                    ? `Importing: ${importProgress.current}`
                    : 'Importing & classifying...'}
                </span>
                <span className="ml-2">{importProgress.done} / {importProgress.total}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
          )}
        </div>

        {lessons.length > 0 && !importing && (
          <DialogFooter className="flex-shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={selectedCount === 0}>
              Queue {selectedCount} lesson{selectedCount !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
