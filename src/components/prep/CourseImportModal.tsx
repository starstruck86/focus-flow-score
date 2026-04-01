import { useState, useCallback } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, BookOpen, ExternalLink, Video, FileText, HelpCircle, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useClassifyResource, useAddUrlResource } from '@/hooks/useResourceUpload';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { validateLessonContent } from '@/lib/courseImportValidation';
import { toast } from 'sonner';

type LessonItem = {
  title: string;
  url: string;
  module: string;
  index: number;
  duration?: string;
  type?: string;
};

type LessonImportStatus = 'queued' | 'fetching_lesson' | 'validating_content' | 'saving_resource' | 'transcribing' | 'complete' | 'failed';

type LessonImportResult = {
  lessonIndex: number;
  status: LessonImportStatus;
  error?: string;
  resourceId?: string;
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

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  complete: CheckCircle2,
  failed: XCircle,
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
  const [lessonResults, setLessonResults] = useState<LessonImportResult[]>([]);

  const { user } = useAuth();
  const classify = useClassifyResource();
  const addUrl = useAddUrlResource();

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setLessons([]);
    setCourseTitle('');
    setLessonResults([]);
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

  const updateLessonResult = (lessonIndex: number, update: Partial<LessonImportResult>) => {
    setLessonResults(prev => {
      const existing = prev.find(r => r.lessonIndex === lessonIndex);
      if (existing) {
        return prev.map(r => r.lessonIndex === lessonIndex ? { ...r, ...update } : r);
      }
      return [...prev, { lessonIndex, status: 'queued', ...update } as LessonImportResult];
    });
  };

  /** Upsert a lineage row to course_lesson_imports (canonical current state) */
  const writeLineageRow = async (params: {
    resourceId: string | null;
    lesson: LessonItem;
    status: string;
    substatus?: string;
    error?: string;
    mediaUrl?: string;
    videoType?: string;
  }) => {
    if (!user) return;
    try {
      const row = {
        user_id: user.id,
        resource_id: params.resourceId,
        original_course_url: url.trim(),
        lesson_url: params.lesson.url,
        course_title: courseTitle,
        platform,
        module_name: params.lesson.module || null,
        lesson_index: params.lesson.index,
        lesson_type: params.lesson.type || 'text',
        source_lesson_title: params.lesson.title,
        import_status: params.status,
        import_substatus: params.substatus || null,
        import_error: params.error || null,
        provider_video_url: params.mediaUrl || null,
        provider_video_type: params.videoType || null,
        transcript_status: params.mediaUrl ? 'transcript_pending' : null,
      };
      await (supabase.from('course_lesson_imports' as any) as any)
        .upsert(row, { onConflict: 'user_id,lesson_url,original_course_url' });
    } catch (e) {
      console.warn('Failed to write course lineage row:', e);
    }
  };

  /** Update lineage row status by lesson_url */
  const updateLineageRow = async (lessonUrl: string, updates: Record<string, any>) => {
    if (!user) return;
    try {
      await (supabase.from('course_lesson_imports' as any) as any)
        .update(updates)
        .eq('user_id', user.id)
        .eq('lesson_url', lessonUrl)
        .eq('original_course_url', url.trim());
    } catch (e) {
      console.warn('Failed to update course lineage row:', e);
    }
  };

  const handleImport = useCallback(async () => {
    const toImport = lessons.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length, current: '' });
    setLessonResults(toImport.map((_, i) => ({ lessonIndex: i, status: 'queued' as const })));

    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      const lesson = toImport[i];

      // === FETCH LESSON ===
      updateLessonResult(i, { status: 'fetching_lesson' });
      setImportProgress({ done: i, total: toImport.length, current: `Fetching: ${lesson.title}` });

      let lessonData: any = null;
      try {
        const { data, error } = await trackedInvoke<any>('import-course', {
          body: { url: url.trim(), action: 'fetch_lesson', lesson_url: lesson.url },
          timeoutMs: 60_000,
        });
        if (error) throw error;
        lessonData = data;
      } catch (e: any) {
        const errMsg = e?.message || 'Failed to fetch lesson';
        updateLessonResult(i, { status: 'failed', error: errMsg });
        await writeLineageRow({ resourceId: null, lesson, status: 'failed', substatus: 'fetching_lesson', error: errMsg });
        setImportProgress({ done: i + 1, total: toImport.length, current: '' });
        continue;
      }

      // === VALIDATE CONTENT ===
      updateLessonResult(i, { status: 'validating_content' });
      setImportProgress({ done: i, total: toImport.length, current: `Validating: ${lesson.title}` });

      const contentToValidate = lessonData?.content || '';
      const validation = validateLessonContent(contentToValidate);

      if (!validation.valid) {
        const errMsg = validation.reason || 'Content validation failed';
        updateLessonResult(i, { status: 'failed', error: errMsg });
        await writeLineageRow({ resourceId: null, lesson, status: 'failed', substatus: 'validating_content', error: `${validation.code}: ${errMsg}` });
        setImportProgress({ done: i + 1, total: toImport.length, current: '' });
        console.warn(`Validation failed for "${lesson.title}": ${errMsg}`);
        continue;
      }

      // === CHECK FOR EXISTING RESOURCE (dedup) ===
      updateLessonResult(i, { status: 'saving_resource' });
      setImportProgress({ done: i, total: toImport.length, current: `Saving: ${lesson.title}` });

      try {
        // Look for existing resource with same user + lesson URL
        const { data: existingResources, error: dedupErr } = await supabase
          .from('resources')
          .select('id')
          .eq('file_url', lesson.url)
          .limit(1);
        
        console.log('[CourseImport] Dedup check for', lesson.url, '→ found:', existingResources?.length, 'error:', dedupErr?.message);

        let resourceId: string | null = null;

        if (existingResources && existingResources.length > 0) {
          // Reuse existing resource — update its content
          resourceId = existingResources[0].id;
          const updatePayload: Record<string, any> = {
            updated_at: new Date().toISOString(),
          };
          if (lessonData?.success && lessonData.content && lessonData.content.length > 50) {
            updatePayload.content = lessonData.content;
            updatePayload.content_status = 'enriched';
          }
          updatePayload.title = lesson.title;
          updatePayload.resource_type = lesson.type === 'video' ? 'video' : 'article';
          await supabase.from('resources').update(updatePayload as any).eq('id', resourceId);
        } else {
          // No existing resource — classify and create new
          const classification = await classify.mutateAsync({ url: lesson.url });
          if (classification.title === 'Untitled' || classification.title.length < 3) {
            classification.title = lesson.title;
          }
          if (lessonData?.success && lessonData.content && lessonData.content.length > 50) {
            classification.scraped_content = lessonData.content;
          }
          classification.resource_type = lesson.type === 'video' ? 'video' : 'article';
          classification.tags = [...(classification.tags || []), 'course', courseTitle].filter(Boolean);

          const result = await addUrl.mutateAsync({ url: lesson.url, classification });
          resourceId = result?.id || null;
        }

        // Write lineage
        await writeLineageRow({
          resourceId,
          lesson,
          status: 'complete',
          substatus: 'saved',
          mediaUrl: lessonData?.media_url || undefined,
          videoType: lessonData?.media_url ? 'wistia' : undefined,
        });

        successCount++;

        // === TRANSCRIBE (if video with media_url) ===
        if (lessonData?.media_url && resourceId) {
          updateLessonResult(i, { status: 'transcribing' });
          setImportProgress({ done: i, total: toImport.length, current: `${lesson.title} (transcribing video...)` });
          try {
            const { data: txData } = await trackedInvoke<any>('transcribe-audio', {
              body: { audio_url: lessonData.media_url, resource_id: resourceId },
              timeoutMs: 120_000,
            });
            if (txData?.success && txData.transcript) {
              const { data: existing } = await supabase
                .from('resources')
                .select('content')
                .eq('id', resourceId)
                .single();
              const updated = (existing?.content || '') + '\n\n--- Video Transcript ---\n\n' + txData.transcript;
              await supabase.from('resources').update({ content: updated } as any).eq('id', resourceId);
              await updateLineageRow(lesson.url, { transcript_status: 'transcript_complete', transcript_text: txData.transcript });
              console.log(`Transcribed video for ${lesson.title}: ${txData.transcript.length} chars`);
            } else {
              await updateLineageRow(lesson.url, { transcript_status: 'transcript_failed' });
            }
          } catch (txErr) {
            console.warn(`Video transcription failed for ${lesson.title}:`, txErr);
            await updateLineageRow(lesson.url, { transcript_status: 'transcript_failed' });
          }
        }

        updateLessonResult(i, { status: 'complete', resourceId: resourceId || undefined });
      } catch (e: any) {
        const errMsg = e?.message || 'Failed to save resource';
        updateLessonResult(i, { status: 'failed', error: errMsg });
        await writeLineageRow({ resourceId: null, lesson, status: 'failed', substatus: 'saving_resource', error: errMsg });
        console.error(`Failed to import ${lesson.title}:`, e);
      }
      setImportProgress({ done: i + 1, total: toImport.length, current: '' });
    }

    const failedCount = toImport.length - successCount;
    if (failedCount > 0) {
      toast.warning(`Imported ${successCount} of ${toImport.length} lessons (${failedCount} failed)`);
    } else {
      toast.success(`Imported ${successCount} of ${toImport.length} lessons`);
    }
    setImporting(false);
  }, [lessons, selected, classify, addUrl, url, courseTitle, platform, user]);

  const selectedCount = selected.size;
  const progressPct = importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0;

  // Group by module
  const modules = new Map<string, { lesson: LessonItem; index: number }[]>();
  lessons.forEach((lesson, i) => {
    const mod = lesson.module || 'Course Content';
    if (!modules.has(mod)) modules.set(mod, []);
    modules.get(mod)!.push({ lesson, index: i });
  });

  // Find result for a lesson by its original index in the toImport array
  const getResultForLesson = (originalIndex: number): LessonImportResult | undefined => {
    // Map original lesson index to toImport index
    const toImport = lessons.filter((_, i) => selected.has(i));
    const toImportIdx = toImport.findIndex(l => l.index === originalIndex);
    return lessonResults.find(r => r.lessonIndex === toImportIdx);
  };

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
                  {importProgress.current || 'Importing & classifying...'}
                </span>
                <span className="ml-2">{importProgress.done} / {importProgress.total}</span>
              </div>
              <Progress value={progressPct} className="h-2" />

              {/* Per-lesson status during import */}
              {lessonResults.length > 0 && (
                <ScrollArea className="max-h-32 border rounded-md mt-2">
                  <div className="p-2 space-y-1">
                    {lessonResults.map((r, idx) => {
                      const toImport = lessons.filter((_, i) => selected.has(i));
                      const lesson = toImport[r.lessonIndex];
                      if (!lesson) return null;
                      const StatusIcon = r.status === 'complete' ? CheckCircle2
                        : r.status === 'failed' ? XCircle
                        : null;
                      return (
                        <div key={idx} className="flex items-center gap-2 text-[11px]">
                          {StatusIcon ? (
                            <StatusIcon className={`h-3 w-3 flex-shrink-0 ${r.status === 'complete' ? 'text-green-500' : 'text-destructive'}`} />
                          ) : (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="truncate flex-1">{lesson.title}</span>
                          {r.status === 'failed' && r.error && (
                            <span className="text-destructive truncate max-w-[140px]" title={r.error}>{r.error}</span>
                          )}
                          {r.status !== 'complete' && r.status !== 'failed' && r.status !== 'queued' && (
                            <Badge variant="outline" className="text-[9px] h-4">{r.status.replace('_', ' ')}</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
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
