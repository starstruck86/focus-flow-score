import { useState, useCallback } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, BookOpen, ExternalLink, Video, FileText, HelpCircle, CheckCircle2, XCircle, AlertTriangle, KeyRound, ChevronDown, Info, Download, Search } from 'lucide-react';
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

type LessonImportStatus = 'queued' | 'fetching_lesson' | 'validating_content' | 'saving_resource' | 'transcribing' | 'complete' | 'metadata_only' | 'failed';

type LessonQualityReport = {
  content_length: number;
  cleaned_text_length: number;
  content_type: string;
  has_login_wall: boolean;
  has_redirect: boolean;
  redirect_url?: string;
  word_count: number;
  video_embeds_found: number;
  issues: string[];
  usable_content: boolean;
};

type ExtractionTraceStep = {
  attempted: boolean;
  success: boolean;
  word_count?: number;
  detail?: string;
};

type ExtractionTrace = {
  dom_transcript: ExtractionTraceStep;
  wistia_captions: ExtractionTraceStep;
  vimeo_captions: ExtractionTraceStep;
  wistia_media: ExtractionTraceStep;
  vimeo_media: ExtractionTraceStep;
  audio_transcription: ExtractionTraceStep;
  final_source: string | null;
};

type DetectedAsset = {
  filename: string;
  url: string;
  extension: string;
  source_section: string;
};

type AssetResult = {
  filename: string;
  extension: string;
  detected: boolean;
  downloaded: boolean;
  parsed: boolean;
  text_length?: number;
  detail?: string;
};

type AssetTrace = {
  attempted: boolean;
  assets_found: number;
  assets: AssetResult[];
};

type LessonImportResult = {
  lessonIndex: number;
  status: LessonImportStatus;
  error?: string;
  resourceId?: string;
  quality?: LessonQualityReport;
  lessonUrl?: string;
  requestedUrl?: string;
  finalUrl?: string;
  metadataOnly?: boolean;
  transcriptSource?: string;
  hasVideoTranscript?: boolean;
  extractionTrace?: ExtractionTrace;
  assetTrace?: AssetTrace;
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

const VIDEO_TRANSCRIPT_MARKER = '\n\n--- Video Transcript ---\n\n';

/**
 * Basic text extraction from a base64-encoded PDF.
 * Uses stream-based extraction without a full PDF library.
 */
function extractTextFromPdfBase64(base64Data: string): string {
  try {
    const binaryStr = atob(base64Data);
    // Look for text streams in the PDF binary
    const segments: string[] = [];
    
    // Extract text between BT (begin text) and ET (end text) operators
    const btEtPattern = /BT\s([\s\S]*?)ET/g;
    let m;
    while ((m = btEtPattern.exec(binaryStr)) !== null) {
      // Extract text from Tj and TJ operators
      const tjMatches = m[1].matchAll(/\(([^)]*)\)\s*Tj/g);
      for (const tj of tjMatches) {
        const text = tj[1].replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
        if (text.trim()) segments.push(text.trim());
      }
      // TJ arrays
      const tjArrayMatches = m[1].matchAll(/\[(.*?)\]\s*TJ/g);
      for (const tja of tjArrayMatches) {
        const parts = [...tja[1].matchAll(/\(([^)]*)\)/g)].map(p => 
          p[1].replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')')
        );
        const joined = parts.join('').trim();
        if (joined) segments.push(joined);
      }
    }
    
    // Also try to find readable ASCII text runs as fallback
    if (segments.length === 0) {
      const asciiRuns = binaryStr.match(/[\x20-\x7E]{20,}/g) || [];
      for (const run of asciiRuns) {
        if (!/^[%\/\[\]{}()<>]+$/.test(run) && !/^\d+\s\d+\s(obj|R)/.test(run)) {
          segments.push(run.trim());
        }
      }
    }
    
    return segments.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return '';
  }
}

function normalizeComparableText(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTranscriptMarker(content: string) {
  return content.split(VIDEO_TRANSCRIPT_MARKER)[0].trim();
}

function looksLikeDuplicateTranscript(baseContent: string, transcript: string) {
  const normalizedBase = normalizeComparableText(baseContent);
  const normalizedTranscript = normalizeComparableText(transcript);

  if (!normalizedBase || !normalizedTranscript) return false;
  if (normalizedBase === normalizedTranscript) return true;
  if (normalizedBase.includes(normalizedTranscript)) return true;

  const transcriptPrefix = normalizedTranscript.slice(0, Math.min(300, normalizedTranscript.length));
  return transcriptPrefix.length > 80 && normalizedBase.includes(transcriptPrefix);
}

function pickLessonBody(candidates: Array<string | null | undefined>, transcript: string) {
  const cleanedCandidates = candidates
    .map(candidate => stripTranscriptMarker(candidate || ''))
    .filter(Boolean);

  const distinctCandidates = cleanedCandidates.filter(candidate => !looksLikeDuplicateTranscript(candidate, transcript));
  const pool = distinctCandidates.length > 0 ? distinctCandidates : cleanedCandidates;

  return pool.sort((a, b) => b.length - a.length)[0] || '';
}

function buildMergedLessonContent(baseContent: string, transcript: string) {
  const cleanedBase = stripTranscriptMarker(baseContent);
  const cleanedTranscript = transcript.trim();

  if (!cleanedBase) return cleanedTranscript;
  if (!cleanedTranscript) return cleanedBase;
  if (looksLikeDuplicateTranscript(cleanedBase, cleanedTranscript)) return cleanedBase;

  return `${cleanedBase}${VIDEO_TRANSCRIPT_MARKER}${cleanedTranscript}`;
}

const TRACE_LABELS: Record<string, string> = {
  dom_transcript: 'DOM transcript',
  wistia_captions: 'Wistia captions',
  vimeo_captions: 'Vimeo captions',
  wistia_media: 'Wistia media URL',
  vimeo_media: 'Vimeo media URL',
  audio_transcription: 'Audio transcription',
};

function ExtractionTraceExpander({ trace, metadataOnly }: { trace: ExtractionTrace; metadataOnly?: boolean }) {
  const [open, setOpen] = useState(false);

  const stepKeys = ['dom_transcript', 'wistia_captions', 'vimeo_captions', 'wistia_media', 'vimeo_media', 'audio_transcription'] as const;

  // Build metadata-only explanation from trace
  const metadataReason = metadataOnly
    ? stepKeys
        .filter(k => trace[k].attempted && !trace[k].success)
        .map(k => TRACE_LABELS[k] + ': ' + (trace[k].detail || 'failed'))
        .join('; ') || 'No extraction strategies succeeded'
    : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="pl-5">
      <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
        <Search className="h-2.5 w-2.5" />
        <span>Trace</span>
        {trace.final_source && (
          <Badge variant="outline" className="text-[8px] h-3.5 ml-1">{trace.final_source.replace(/_/g, ' ')}</Badge>
        )}
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5">
        {stepKeys.map(key => {
          const step = trace[key];
          const color = step.success
            ? 'text-green-600'
            : step.attempted
            ? 'text-amber-500'
            : 'text-muted-foreground/50';
          const icon = step.success ? '✓' : step.attempted ? '○' : '–';
          return (
            <div key={key} className={`flex items-start gap-1.5 text-[10px] ${color}`}>
              <span className="w-2.5 text-center flex-shrink-0">{icon}</span>
              <span className="font-medium flex-shrink-0">{TRACE_LABELS[key]}:</span>
              <span className="text-muted-foreground">{step.detail || (step.attempted ? 'no result' : 'not attempted')}</span>
              {step.word_count != null && <span className="text-muted-foreground">({step.word_count}w)</span>}
            </div>
          );
        })}
        {metadataReason && (
          <div className="text-[10px] text-amber-600 mt-1 pt-1 border-t border-border/50">
            ⚠ Metadata-only: {metadataReason}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

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

  // Per-import credentials (never persisted)
  const [credEmail, setCredEmail] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [showCreds, setShowCreds] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [discoverMeta, setDiscoverMeta] = useState<Record<string, any> | null>(null);

  const clearCredPassword = () => setCredPassword('');
  const getCredsBody = () => {
    if (credEmail.trim() && credPassword) {
      return { email: credEmail.trim(), password: credPassword };
    }
    return {};
  };

  const { user } = useAuth();
  const classify = useClassifyResource();
  const addUrl = useAddUrlResource();

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setLessons([]);
    setCourseTitle('');
    setAuthError(null);
    setDiscoverMeta(null);
    try {
      const { data, error } = await trackedInvoke<any>('import-course', {
        body: { url: url.trim(), action: 'discover', ...getCredsBody() },
        timeoutMs: 120_000,
      });
      if (error) throw error;
      if (!data?.success) {
        const errMsg = data?.error || 'Failed to fetch course';
        // Classify the error
        if (/credentials|password|email/i.test(errMsg)) {
          setAuthError('Invalid credentials — please check email and password.');
        } else if (/authentication required|login/i.test(errMsg)) {
          setAuthError('Login required — enter your course platform credentials below.');
          if (!showCreds) setShowCreds(true);
        } else if (/mfa|two.?factor|captcha|bot|recaptcha/i.test(errMsg)) {
          setAuthError('This platform uses MFA or bot protection. Automated import is blocked.');
        } else {
          setAuthError(errMsg);
        }
        throw new Error(errMsg);
      }

      // Store metadata
      if (data.meta) setDiscoverMeta(data.meta);

      // Check auth-failed state (authenticated but redirected back to login)
      if (data.meta?.auth_status === 'auth_failed') {
        setAuthError('Authentication failed — check your credentials or try entering them below.');
        if (!showCreds) setShowCreds(true);
      }
      
      const items: LessonItem[] = data.lessons || [];
      if (items.length === 0) {
        if (data.meta?.auth_status === 'auth_failed') {
          toast.error('Login failed — no lessons accessible');
        } else {
          toast.error('Authenticated but no lessons found in this course');
        }
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
  }, [url, credEmail, credPassword, showCreds]);

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
    console.log('[CourseImport][v2] handleImport started, lessons:', toImport.length);
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length, current: '' });
    setLessonResults(toImport.map((_, i) => ({ lessonIndex: i, status: 'queued' as const })));

    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      const lesson = toImport[i];
      console.log('[CourseImport][v2] Processing lesson', i, lesson.url);

      // === FETCH LESSON ===
      updateLessonResult(i, { status: 'fetching_lesson' });
      setImportProgress({ done: i, total: toImport.length, current: `Fetching: ${lesson.title}` });

      let lessonData: any = null;
      try {
        const { data, error } = await trackedInvoke<any>('import-course', {
          body: { url: url.trim(), action: 'fetch_lesson', lesson_url: lesson.url, ...getCredsBody() },
          timeoutMs: 60_000,
        });
        if (error) throw error;
        lessonData = data;
      } catch (e: any) {
        const errMsg = e?.message || 'Failed to fetch lesson';
        updateLessonResult(i, { status: 'failed', error: errMsg, lessonUrl: lesson.url });
        await writeLineageRow({ resourceId: null, lesson, status: 'failed', substatus: 'fetching_lesson', error: errMsg });
        setImportProgress({ done: i + 1, total: toImport.length, current: '' });
        continue;
      }

      // Capture server-side quality report
      const quality: LessonQualityReport | undefined = lessonData?.quality;
      const requestedUrl = lessonData?.requested_lesson_url || lesson.url;
      const finalUrl = lessonData?.final_url || lesson.url;
      const metadataOnly = lessonData?.metadata_only === true;

      // Server blocks login_page/empty/html_junk and computes usable_content
      if (!lessonData?.success || quality?.usable_content === false) {
        const errMsg = lessonData?.error || 'Lesson fetch returned failure';
        updateLessonResult(i, { status: 'failed', error: errMsg, quality, lessonUrl: lesson.url, requestedUrl, finalUrl });
        await writeLineageRow({ resourceId: null, lesson, status: 'failed', substatus: 'quality_gate', error: errMsg });
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
        updateLessonResult(i, { status: 'failed', error: errMsg, quality, lessonUrl: lesson.url, requestedUrl, finalUrl });
        await writeLineageRow({ resourceId: null, lesson, status: 'failed', substatus: 'validating_content', error: `${validation.code}: ${errMsg}` });
        setImportProgress({ done: i + 1, total: toImport.length, current: '' });
        console.warn(`Validation failed for "${lesson.title}": ${errMsg}`);
        continue;
      }

      // === CHECK FOR EXISTING RESOURCE (dedup) ===
      updateLessonResult(i, { status: 'saving_resource' });
      setImportProgress({ done: i, total: toImport.length, current: `Saving: ${lesson.title}` });

      try {
        const classification = await classify.mutateAsync({ url: lesson.url });
        // Always prefer curriculum-discovered title with course context
        const decodeEntities = (s: string) => s
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
          .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        const rawLessonTitle = (lessonData?.title && lessonData.title.length > 3 && !/on-demand|sales introverts/i.test(lessonData.title))
          ? lessonData.title
          : lesson.title;
        const lessonTitle = decodeEntities(rawLessonTitle || '');
        const cleanCourseTitle = decodeEntities(courseTitle || '');
        classification.title = cleanCourseTitle && lessonTitle
          ? `${cleanCourseTitle} > ${lessonTitle}`
          : lessonTitle || classification.title || 'Untitled Lesson';
        if (lessonData?.success && lessonData.content && lessonData.content.length > 50 && !metadataOnly) {
          classification.scraped_content = lessonData.content;
        }
        const isVideoLesson = lesson.type === 'video' || lessonData?.type === 'video' || Boolean(lessonData?.media_url);
        classification.resource_type = isVideoLesson ? 'video' : 'article';
        if (metadataOnly) {
          (classification as any).content_status = 'metadata_only';
          classification.tags = Array.from(new Set([...classification.tags, 'needs-transcript']));
        }
        classification.tags = Array.from(new Set([...(classification.tags || []), 'course', courseTitle].filter(Boolean)));

        const resource = await addUrl.mutateAsync({ url: lesson.url, classification });
        const resourceId = resource?.id || null;

        // Flag metadata-only resources so enrichment flows skip them until content arrives
        if (metadataOnly && resourceId) {
          await supabase.from('resources').update({
            enrichment_status: 'incomplete',
            content_status: 'metadata_only',
          } as any).eq('id', resourceId);
        }

        await writeLineageRow({
          resourceId,
          lesson,
          status: 'complete',
          substatus: 'saved',
          mediaUrl: lessonData?.media_url || undefined,
          videoType: lessonData?.media_url ? 'wistia' : undefined,
        });

        successCount++;

        const shouldTranscribe = Boolean(lessonData?.media_url && resourceId);

        if (shouldTranscribe) {
          updateLessonResult(i, { status: 'transcribing' });
          setImportProgress({ done: i, total: toImport.length, current: `${lesson.title} (transcribing video...)` });
          try {
            const { data: existingBeforeTx } = await supabase
              .from('resources')
              .select('content, content_status')
              .eq('id', resourceId)
              .single();

            const { data: txData } = await trackedInvoke<any>('transcribe-audio', {
              body: { audio_url: lessonData.media_url },
              timeoutMs: 120_000,
            });
            if (txData?.success && txData.transcript) {
              const transcript = txData.transcript.trim();
              const baseContent = pickLessonBody([
                lessonData?.content,
                existingBeforeTx?.content,
              ], transcript);
              const updated = buildMergedLessonContent(baseContent, transcript);

              await supabase.from('resources').update({
                content: updated,
                content_length: updated.length,
                content_status: 'transcript',
                enrichment_status: 'not_enriched',
              } as any).eq('id', resourceId);
              // Remove needs-transcript tag now that content exists
              const { data: tagRow } = await supabase.from('resources').select('tags').eq('id', resourceId).single();
              if (tagRow?.tags) {
                const cleaned = (tagRow.tags as string[]).filter(t => t !== 'needs-transcript');
                await supabase.from('resources').update({ tags: cleaned } as any).eq('id', resourceId);
              }
              const txWordCount = transcript.split(/\s+/).filter(Boolean).length;
              await updateLineageRow(lesson.url, {
                transcript_status: 'transcript_complete',
                transcript_text: txData.transcript,
                transcript_word_count: txWordCount,
                transcript_completed_at: new Date().toISOString(),
                transcript_source: 'audio_transcription',
              });
              console.log(`Transcribed video for ${lesson.title}: ${txData.transcript.length} chars`);
            } else {
              await updateLineageRow(lesson.url, { transcript_status: 'transcript_failed' });
            }
          } catch (txErr) {
            console.warn(`Video transcription failed for ${lesson.title}:`, txErr);
            await updateLineageRow(lesson.url, { transcript_status: 'transcript_failed' });
          }
        } else if (lessonData?.media_url && resourceId) {
          await updateLineageRow(lesson.url, {
            transcript_status: 'transcript_complete',
            transcript_completed_at: new Date().toISOString(),
            transcript_source: 'media_url_resolved',
          });
        }

        // === DOWNLOAD LESSON ASSETS (PDFs, worksheets, etc.) ===
        const detectedAssets: DetectedAsset[] = lessonData?.detected_assets || [];
        const assetTrace: AssetTrace = { attempted: detectedAssets.length > 0, assets_found: detectedAssets.length, assets: [] };

        if (detectedAssets.length > 0 && resourceId && user) {
          setImportProgress({ done: i, total: toImport.length, current: `${lesson.title} (downloading ${detectedAssets.length} asset${detectedAssets.length !== 1 ? 's' : ''}...)` });

          // Look up the lesson_import row id for linking
          const { data: cliRow } = await (supabase.from('course_lesson_imports' as any) as any)
            .select('id')
            .eq('user_id', user.id)
            .eq('lesson_url', lesson.url)
            .eq('original_course_url', url.trim())
            .maybeSingle();
          const lessonImportId = cliRow?.id || null;

          for (const asset of detectedAssets) {
            const ar: AssetResult = { filename: asset.filename, extension: asset.extension, detected: true, downloaded: false, parsed: false };
            try {
              // Download via edge function (authenticated)
              const { data: dlData, error: dlErr } = await trackedInvoke<any>('import-course', {
                body: { url: url.trim(), action: 'download_asset', asset_url: asset.url, ...getCredsBody() },
                timeoutMs: 60_000,
              });
              if (dlErr || !dlData?.success) {
                ar.detail = dlData?.error || dlErr?.message || 'Download failed';
                assetTrace.assets.push(ar);
                // Record failure in DB
                await (supabase.from('lesson_assets' as any) as any).insert({
                  user_id: user.id,
                  lesson_import_id: lessonImportId,
                  parent_resource_id: resourceId,
                  source_url: asset.url,
                  filename: asset.filename,
                  download_status: 'failed',
                  parse_status: 'pending',
                  error_detail: ar.detail,
                });
                continue;
              }

              ar.downloaded = true;
              const sizeBytes = dlData.size_bytes || 0;
              const contentType = dlData.content_type || 'application/octet-stream';

              // Upload to storage
              const storagePath = `lesson-assets/${user.id}/${resourceId}/${asset.filename}`;
              const binaryStr = atob(dlData.data_base64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let j = 0; j < binaryStr.length; j++) bytes[j] = binaryStr.charCodeAt(j);

              const { error: uploadErr } = await supabase.storage
                .from('resource-files')
                .upload(storagePath, bytes, { contentType, upsert: true });

              if (uploadErr) {
                ar.detail = `Upload failed: ${uploadErr.message}`;
                await (supabase.from('lesson_assets' as any) as any).insert({
                  user_id: user.id,
                  lesson_import_id: lessonImportId,
                  parent_resource_id: resourceId,
                  source_url: asset.url,
                  filename: asset.filename,
                  mime_type: contentType,
                  file_size_bytes: sizeBytes,
                  download_status: 'downloaded',
                  parse_status: 'failed',
                  error_detail: ar.detail,
                });
                assetTrace.assets.push(ar);
                continue;
              }

              // Parse PDFs for text
              let parsedTextLength = 0;
              let childResourceId: string | null = null;
              if (asset.extension === 'pdf' && dlData.data_base64) {
                try {
                  // Use basic text extraction from the PDF binary
                  const textContent = extractTextFromPdfBase64(dlData.data_base64);
                  parsedTextLength = textContent.length;
                  ar.parsed = parsedTextLength > 50;
                  ar.text_length = parsedTextLength;

                  if (parsedTextLength > 50) {
                    // Create child resource
                    const childTitle = `${courseTitle} > ${lesson.title} > ${asset.filename}`;
                    const childClassification = await classify.mutateAsync({ url: asset.url });
                    childClassification.title = childTitle;
                    childClassification.resource_type = 'document';
                    childClassification.scraped_content = textContent;
                    childClassification.tags = [...(childClassification.tags || []), 'course', 'attachment', courseTitle].filter(Boolean);
                    const childResource = await addUrl.mutateAsync({ url: asset.url, classification: childClassification });
                    childResourceId = childResource?.id || null;
                    ar.detail = `Parsed ${parsedTextLength.toLocaleString()} chars, child resource created`;
                  } else {
                    ar.detail = `PDF text too short (${parsedTextLength} chars)`;
                    ar.parsed = false;
                  }
                } catch (parseErr: any) {
                  ar.detail = `PDF parse failed: ${parseErr?.message || 'unknown'}`;
                  ar.parsed = false;
                }
              } else {
                ar.detail = `Downloaded (${(sizeBytes / 1024).toFixed(1)} KB), parse not supported for .${asset.extension}`;
              }

              // Record in lesson_assets
              await (supabase.from('lesson_assets' as any) as any).insert({
                user_id: user.id,
                lesson_import_id: lessonImportId,
                parent_resource_id: resourceId,
                source_url: asset.url,
                filename: asset.filename,
                mime_type: contentType,
                file_size_bytes: sizeBytes,
                storage_path: storagePath,
                download_status: 'downloaded',
                parse_status: ar.parsed ? 'parsed' : (asset.extension === 'pdf' ? 'failed' : 'unsupported'),
                parsed_text_length: parsedTextLength || null,
                child_resource_id: childResourceId,
                error_detail: ar.parsed ? null : ar.detail,
              });

              assetTrace.assets.push(ar);
              console.log(`[CourseImport] Asset "${asset.filename}": downloaded=${ar.downloaded}, parsed=${ar.parsed}, chars=${parsedTextLength}`);
            } catch (assetErr: any) {
              ar.detail = assetErr?.message || 'Asset processing failed';
              assetTrace.assets.push(ar);
            }
          }
        }

        const finalStatus: LessonImportStatus = metadataOnly ? 'metadata_only' : 'complete';
        updateLessonResult(i, {
          status: finalStatus,
          resourceId: resourceId || undefined,
          quality,
          lessonUrl: lesson.url,
          requestedUrl,
          finalUrl,
          metadataOnly,
          transcriptSource: lessonData?.transcript_source,
          hasVideoTranscript: lessonData?.has_video_transcript,
          extractionTrace: lessonData?.extraction_trace,
          assetTrace: assetTrace.attempted ? assetTrace : undefined,
        });
      } catch (e: any) {
        const errMsg = e?.message || 'Failed to save resource';
        updateLessonResult(i, { status: 'failed', error: errMsg, quality, lessonUrl: lesson.url, requestedUrl, finalUrl });
        await writeLineageRow({ resourceId: null, lesson, status: 'failed', substatus: 'saving_resource', error: errMsg });
        console.error(`Failed to import ${lesson.title}:`, e);
      }
      setImportProgress({ done: i + 1, total: toImport.length, current: '' });
    }

    // Compute summary counts
    const fullCount = lessonResults.filter(r => r.status === 'complete').length;
    const metaCount = lessonResults.filter(r => r.status === 'metadata_only').length;
    const failedCount = toImport.length - fullCount - metaCount;

    const parts: string[] = [];
    if (fullCount > 0) parts.push(`${fullCount} full`);
    if (metaCount > 0) parts.push(`${metaCount} metadata-only`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);

    if (failedCount > 0) {
      toast.warning(`Import complete: ${parts.join(', ')}`);
    } else {
      toast.success(`Import complete: ${parts.join(', ')}`);
    }
    setImporting(false);
    clearCredPassword();
  }, [lessons, selected, classify, addUrl, url, courseTitle, platform, user, credEmail, credPassword]);

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

          {/* Auth error banner */}
          {authError && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive flex-shrink-0">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* Optional per-import credentials */}
          <Collapsible open={showCreds} onOpenChange={setShowCreds} className="flex-shrink-0">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                <KeyRound className="h-3 w-3" />
                <span>Course platform credentials</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${showCreds ? 'rotate-180' : ''}`} />
                {credEmail && <Badge variant="outline" className="text-[9px] h-4 ml-auto">credentials set</Badge>}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground p-2 rounded bg-muted/50">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>Optional — only used for this import attempt. Not saved anywhere. Leave blank to use stored credentials.</span>
              </div>
              <Input
                type="email"
                value={credEmail}
                onChange={e => setCredEmail(e.target.value)}
                placeholder="Email for this course platform"
                disabled={fetching || importing}
                className="h-8 text-sm"
              />
              <Input
                type="password"
                value={credPassword}
                onChange={e => setCredPassword(e.target.value)}
                placeholder="Password"
                disabled={fetching || importing}
                className="h-8 text-sm"
              />
            </CollapsibleContent>
          </Collapsible>

          {/* Discovery metadata */}
          {discoverMeta && !importing && (
            <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground flex-shrink-0">
              <Badge variant="outline" className="text-[9px] h-4">{discoverMeta.domain}</Badge>
              <Badge variant={discoverMeta.auth_status === 'authenticated' ? 'default' : 'destructive'} className="text-[9px] h-4">
                {discoverMeta.auth_status === 'authenticated' ? '✓ Authenticated' : '✗ Auth failed'}
              </Badge>
              {discoverMeta.used_request_credentials && (
                <Badge variant="outline" className="text-[9px] h-4">using typed credentials</Badge>
              )}
              <span>{discoverMeta.lessons_discovered} lessons found</span>
            </div>
          )}

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
                <ScrollArea className="max-h-48 border rounded-md mt-2">
                  <div className="p-2 space-y-2">
                    {lessonResults.map((r, idx) => {
                      const toImport = lessons.filter((_, i) => selected.has(i));
                      const lesson = toImport[r.lessonIndex];
                      if (!lesson) return null;
                      const StatusIcon = r.status === 'complete' ? CheckCircle2
                        : r.status === 'metadata_only' ? Info
                        : r.status === 'failed' ? XCircle
                        : null;
                      const q = r.quality;
                      const statusColor = r.status === 'complete' ? 'text-green-500'
                        : r.status === 'metadata_only' ? 'text-amber-500'
                        : r.status === 'failed' ? 'text-destructive'
                        : 'text-muted-foreground';
                      return (
                        <div key={idx} className="space-y-0.5">
                          <div className="flex items-center gap-2 text-[11px]">
                            {StatusIcon ? (
                              <StatusIcon className={`h-3 w-3 flex-shrink-0 ${statusColor}`} />
                            ) : (
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
                            )}
                            <span className="truncate flex-1">{lesson.title}</span>
                            {r.status !== 'complete' && r.status !== 'metadata_only' && r.status !== 'failed' && r.status !== 'queued' && (
                              <Badge variant="outline" className="text-[9px] h-4">{r.status.replace('_', ' ')}</Badge>
                            )}
                          </div>
                          {/* Quality report row */}
                          {q && (r.status === 'complete' || r.status === 'metadata_only' || r.status === 'failed') && (
                            <div className="flex items-center gap-1.5 pl-5 flex-wrap text-[10px] text-muted-foreground">
                              <Badge variant={q.usable_content ? 'outline' : 'destructive'} className="text-[9px] h-4">{q.content_type}</Badge>
                              {r.metadataOnly && <Badge variant="secondary" className="text-[9px] h-4 cursor-help" title="Needs transcript or manual content before enrichment">metadata only</Badge>}
                              {r.hasVideoTranscript && (
                                <Badge variant="outline" className="text-[9px] h-4 border-green-500/30 text-green-600">
                                  {r.transcriptSource === 'dom_transcript' ? 'transcript from page'
                                    : r.transcriptSource === 'wistia_captions' ? 'Wistia captions'
                                    : r.transcriptSource === 'vimeo_captions' ? 'Vimeo captions'
                                    : 'transcribed from video'}
                                </Badge>
                              )}
                              <span>{q.content_length.toLocaleString()} chars</span>
                              <span>·</span>
                              <span>{q.cleaned_text_length.toLocaleString()} cleaned</span>
                              <span>·</span>
                              <span>{q.word_count} words</span>
                              {q.video_embeds_found > 0 && <span>· {q.video_embeds_found} video{q.video_embeds_found !== 1 ? 's' : ''}</span>}
                              {q.has_login_wall && <Badge variant="destructive" className="text-[9px] h-4">login wall</Badge>}
                              {q.has_redirect && <Badge variant="secondary" className="text-[9px] h-4">redirected</Badge>}
                              {r.finalUrl && r.requestedUrl && r.finalUrl !== r.requestedUrl && (
                                <span className="truncate max-w-[120px]" title={r.finalUrl}>→ {new URL(r.finalUrl).pathname}</span>
                              )}
                            </div>
                          )}
                          {/* Issues — rewrite video-specific ones */}
                          {q && q.issues.length > 0 && (r.status === 'complete' || r.status === 'metadata_only' || r.status === 'failed') && (
                            <div className="pl-5 text-[10px] text-destructive">
                              {q.issues.map((issue, j) => {
                                // Replace generic "Very low word count" with video-aware messages
                                let displayIssue = issue;
                                if (/very low word count/i.test(issue) && q.video_embeds_found > 0) {
                                  if (r.hasVideoTranscript) {
                                    return null; // Transcript recovered, suppress the warning
                                  } else if (r.status === 'transcribing') {
                                    displayIssue = 'Transcript missing — attempting video transcription';
                                  } else if (r.metadataOnly) {
                                    displayIssue = 'Video-only lesson — transcript required for full content';
                                  } else {
                                    displayIssue = `Video lesson with minimal text (${q.word_count} words) — check transcript`;
                                  }
                                }
                                return <div key={j}>⚠ {displayIssue}</div>;
                              }).filter(Boolean)}
                            </div>
                          )}
                          {r.status === 'failed' && r.error && !q?.issues.length && (
                            <div className="pl-5 text-[10px] text-destructive truncate" title={r.error}>⚠ {r.error}</div>
                          )}
                          {/* Extraction trace expander */}
                          {r.extractionTrace && (r.status === 'complete' || r.status === 'metadata_only' || r.status === 'failed') && (
                            <ExtractionTraceExpander trace={r.extractionTrace} metadataOnly={r.metadataOnly} />
                          )}
                          {/* Asset trace */}
                          {r.assetTrace && r.assetTrace.assets_found > 0 && (
                            <Collapsible className="pl-5">
                              <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                                <Download className="h-2.5 w-2.5" />
                                <span>{r.assetTrace.assets_found} asset{r.assetTrace.assets_found !== 1 ? 's' : ''}</span>
                                <ChevronDown className="h-2.5 w-2.5" />
                              </CollapsibleTrigger>
                              <CollapsibleContent className="mt-1 space-y-0.5">
                                {r.assetTrace.assets.map((a, ai) => {
                                  const color = a.parsed ? 'text-green-600' : a.downloaded ? 'text-amber-500' : 'text-destructive';
                                  const icon = a.parsed ? '✓' : a.downloaded ? '◎' : '✗';
                                  return (
                                    <div key={ai} className={`flex items-start gap-1.5 text-[10px] ${color}`}>
                                      <span className="w-2.5 text-center flex-shrink-0">{icon}</span>
                                      <span className="font-medium">{a.filename}</span>
                                      <span className="text-muted-foreground">
                                        — {a.downloaded ? 'downloaded' : 'failed'}
                                        {a.parsed && a.text_length != null && `, parsed (${a.text_length.toLocaleString()} chars)`}
                                        {!a.parsed && a.downloaded && ', parse ' + (a.extension === 'pdf' ? 'failed' : 'unsupported')}
                                      </span>
                                      {a.detail && <span className="text-muted-foreground/70 truncate max-w-[200px]" title={a.detail}>· {a.detail}</span>}
                                    </div>
                                  );
                                })}
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
              {/* Import summary */}
              {!importing && lessonResults.length > 0 && lessonResults.every(r => r.status === 'complete' || r.status === 'metadata_only' || r.status === 'failed') && (() => {
                const full = lessonResults.filter(r => r.status === 'complete').length;
                const meta = lessonResults.filter(r => r.status === 'metadata_only').length;
                const fail = lessonResults.filter(r => r.status === 'failed').length;
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3 text-xs p-2 rounded-md bg-muted/50">
                      {full > 0 && <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />{full} full</span>}
                      {meta > 0 && <span className="flex items-center gap-1"><Info className="h-3 w-3 text-amber-500" />{meta} metadata-only</span>}
                      {fail > 0 && <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" />{fail} failed</span>}
                    </div>
                    {fail > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => {
                          const sanitize = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
                          const toImport = lessons.filter((_, i) => selected.has(i));
                          const failedRows = lessonResults
                            .filter(r => r.status === 'failed')
                            .map(r => {
                              const lesson = toImport[r.lessonIndex];
                              return {
                                title: sanitize(lesson?.title || 'Unknown'),
                                url: sanitize(r.lessonUrl || lesson?.url || ''),
                                error: sanitize(r.error || 'Unknown error'),
                                content_type: sanitize(r.quality?.content_type || ''),
                                issues: sanitize(r.quality?.issues?.join('; ') || ''),
                              };
                            });
                          const header = 'Title\tURL\tError\tContent Type\tIssues';
                          const rows = failedRows.map(r => `${r.title}\t${r.url}\t${r.error}\t${r.content_type}\t${r.issues}`);
                          const tsv = [header, ...rows].join('\n');
                          const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          a.download = `course-import-retry-report-${new Date().toISOString().slice(0, 10)}.tsv`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                        }}
                      >
                        <Download className="h-3 w-3" />
                        Export retry report ({fail} failed)
                      </Button>
                    )}
                  </div>
                );
              })()}
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
