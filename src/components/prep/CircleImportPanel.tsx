/**
 * CircleImportPanel
 * --------------------------------------------------------------------------
 * Rendered by CourseImportModal when discover returns
 * `{ platform: 'circle', needs_browser_capture: true }`.
 *
 * Provides two paths to get Circle lessons into the normal import pipeline
 * WITHOUT relying on server-side login (which Circle blocks):
 *
 *   Tab A — Browser-assisted capture
 *     • Drag the bookmarklet to the bookmarks bar (or copy the snippet).
 *     • Open the Circle course in a tab where the user is already signed in.
 *     • Click the bookmarklet → it POSTs lessons directly to
 *       import-course-capture, OR copies a JSON payload.
 *     • If the direct POST is blocked, paste the JSON here.
 *
 *   Tab B — Manual paste / import
 *     • User types one or more lessons (title + url + body + optional
 *       transcript) and submits as `mode: 'manual'`.
 *
 * Both tabs hand a normalized lesson list back to the parent modal via
 * `onLessons`, which feeds the existing import flow.
 */
import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Bookmark, Copy, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export interface CircleCaptureHint {
  bookmarklet_url: string;
  capture_endpoint: string;
  instructions?: string[];
}

export interface CircleNormalizedLesson {
  url: string;
  title: string;
  module?: string;
  content: string;
  media_url?: string;
  quality?: { metadata_only?: boolean; content_type?: string };
  imported?: boolean;
  reject_reason?: string;
}

interface Props {
  sourceUrl: string;
  captureHint: CircleCaptureHint;
  /** Called with the normalized lesson list returned by import-course-capture. */
  onLessons: (args: {
    title: string;
    lessons: CircleNormalizedLesson[];
    meta?: Record<string, any>;
  }) => void;
}

type ManualLesson = {
  title: string;
  url: string;
  body_text: string;
  transcript: string;
  media_url: string;
};

const projectRef = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID || '';

function buildBookmarkletHref(loaderUrl: string, captureEndpoint: string): string {
  // Build absolute capture endpoint param so the loader script can post even
  // when running on a different origin (Circle).
  const loaderWithParams = (() => {
    try {
      const u = new URL(loaderUrl, window.location.origin);
      u.searchParams.set('endpoint', new URL(captureEndpoint, window.location.origin).toString());
      if (projectRef) u.searchParams.set('project', projectRef);
      return u.toString();
    } catch {
      return loaderUrl;
    }
  })();
  // javascript: bookmarklet that injects the loader script into the current page.
  const code =
    `(function(){var s=document.createElement('script');` +
    `s.src=${JSON.stringify(loaderWithParams)};` +
    `s.onerror=function(){alert('Could not load Circle capture script. Check your network.');};` +
    `document.body.appendChild(s);})();`;
  return `javascript:${encodeURI(code)}`;
}

type CapturePhase = 'idle' | 'validating' | 'normalizing' | 'done';

interface CaptureStats {
  imported: number;
  rejected: number;
  metadata_only: number;
  full_content: number;
  fetch_failed: number;
}

/**
 * Client-side schema check that runs BEFORE we hit the edge function. Returns
 * a friendly error string when the payload is unusable.
 */
type ValidationResult = { ok: true; payload: any } | { ok: false; error: string };
function validateCapturePayload(input: any, fallbackSourceUrl: string): ValidationResult {
  // Allow a bare lessons array too.
  const obj = Array.isArray(input)
    ? { mode: 'capture', source_url: fallbackSourceUrl, platform: 'circle', title: 'Circle Course', lessons: input }
    : (input && typeof input === 'object' ? { mode: 'capture', source_url: fallbackSourceUrl, platform: 'circle', ...input } : null);

  if (!obj) return { ok: false, error: 'Pasted JSON must be an object or an array of lessons.' };
  if (obj.platform !== 'circle') return { ok: false, error: `platform must be "circle" (got "${obj.platform ?? 'missing'}").` };
  if (typeof obj.source_url !== 'string' || !obj.source_url.trim()) return { ok: false, error: 'source_url is required.' };
  if (!Array.isArray(obj.lessons)) return { ok: false, error: 'lessons must be an array.' };
  if (obj.lessons.length === 0) return { ok: false, error: 'lessons array is empty — nothing to import.' };

  for (let i = 0; i < obj.lessons.length; i++) {
    const l = obj.lessons[i];
    if (!l || typeof l !== 'object') return { ok: false, error: `lesson #${i + 1} is not an object.` };
    if (typeof l.title !== 'string' || !l.title.trim()) return { ok: false, error: `lesson #${i + 1} is missing "title".` };
    if (typeof l.url !== 'string' || !l.url.trim()) return { ok: false, error: `lesson #${i + 1} is missing "url".` };
  }
  return { ok: true, payload: obj };
}

export function CircleImportPanel({ sourceUrl, captureHint, onLessons }: Props) {
  const [pastedJson, setPastedJson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [stats, setStats] = useState<CaptureStats | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualLessons, setManualLessons] = useState<ManualLesson[]>([
    { title: '', url: '', body_text: '', transcript: '', media_url: '' },
  ]);

  const absoluteEndpoint = useMemo(() => {
    try {
      return new URL(captureHint.capture_endpoint, window.location.origin).toString();
    } catch {
      return captureHint.capture_endpoint;
    }
  }, [captureHint.capture_endpoint]);

  const bookmarkletHref = useMemo(
    () => buildBookmarkletHref(captureHint.bookmarklet_url, captureHint.capture_endpoint),
    [captureHint.bookmarklet_url, captureHint.capture_endpoint],
  );

  // ── Direct POST helper (used by both pasted JSON + manual tab) ──────────
  const postCapture = async (payload: any) => {
    setSubmitting(true);
    setStats(null);
    setPhase('normalizing');
    try {
      const { data, error } = await supabase.functions.invoke('import-course-capture', {
        body: payload,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Capture failed');
      const lessons = (data.lessons || []) as CircleNormalizedLesson[];
      const importable = lessons.filter(l => l.imported);
      const metadataOnly = lessons.filter(l => l.quality?.metadata_only).length;
      const rejected = lessons.length - importable.length;
      setStats({ imported: importable.length, rejected, metadata_only: metadataOnly });
      setPhase('done');
      if (importable.length === 0) {
        toast.error('No usable lessons found in capture payload.');
      } else {
        toast.success(`Captured ${importable.length} lesson${importable.length === 1 ? '' : 's'}.`);
      }
      onLessons({ title: data.title || 'Circle Course', lessons, meta: data.meta });
    } catch (e: any) {
      setPhase('idle');
      toast.error(e?.message || 'Capture failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitPasted = async () => {
    setValidationError(null);
    setPhase('validating');
    let parsed: any;
    try {
      parsed = JSON.parse(pastedJson);
    } catch {
      setPhase('idle');
      setValidationError('Pasted text is not valid JSON.');
      return;
    }
    const result: ValidationResult = validateCapturePayload(parsed, sourceUrl);
    if (result.ok === false) {
      setPhase('idle');
      setValidationError(result.error);
      return;
    }
    await postCapture(result.payload);
  };

  const handleSubmitManual = async () => {
    const cleaned = manualLessons
      .map(l => ({
        title: l.title.trim(),
        url: l.url.trim(),
        body_text: l.body_text.trim(),
        transcript: l.transcript.trim(),
        media_url: l.media_url.trim(),
      }))
      .filter(l => l.title && l.url);
    if (cleaned.length === 0) {
      toast.error('Add at least one lesson with a title and URL.');
      return;
    }
    await postCapture({
      mode: 'manual',
      source_url: sourceUrl,
      platform: 'circle',
      title: manualTitle.trim() || 'Circle Course (manual)',
      lessons: cleaned,
    });
  };

  const updateManual = (i: number, patch: Partial<ManualLesson>) =>
    setManualLessons(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addManual = () =>
    setManualLessons(prev => [...prev, { title: '', url: '', body_text: '', transcript: '', media_url: '' }]);
  const removeManual = (i: number) => setManualLessons(prev => prev.filter((_, idx) => idx !== i));

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletHref);
      toast.success('Bookmarklet copied. Create a new bookmark and paste this as the URL.');
    } catch {
      toast.error('Clipboard copy blocked — drag the link to your bookmarks bar instead.');
    }
  };

  const phaseLabel: Record<CapturePhase, string | null> = {
    idle: null,
    validating: 'Validating JSON…',
    normalizing: 'Normalizing lessons…',
    done: 'Done',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-sm">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="text-muted-foreground space-y-0.5">
          <div>
            <span className="font-medium text-foreground">Circle login required.</span> Server-side
            sign-in is blocked by Circle's bot protection.
          </div>
          <div>Use the browser-assisted capture below — it runs in your already-signed-in tab.</div>
        </div>
      </div>

      <Tabs defaultValue="capture" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="capture">Browser-assisted</TabsTrigger>
          <TabsTrigger value="manual">Manual paste</TabsTrigger>
        </TabsList>

        {/* ── Tab A: Browser-assisted capture ───────────────────────── */}
        <TabsContent value="capture" className="space-y-3 pt-3">
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
            <li>Drag the bookmarklet to your bookmarks bar (or copy it).</li>
            <li>Open the Circle course in a tab where you’re already signed in.</li>
            <li>Click the bookmarklet — it will copy the lesson JSON to your clipboard.</li>
            <li>Return here and paste it into the box below, then click <em>Import pasted JSON</em>.</li>
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={bookmarkletHref}
              draggable
              onClick={e => e.preventDefault()}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
              title="Drag me to your bookmarks bar"
            >
              <Bookmark className="h-3.5 w-3.5" />
              Import Circle Course
            </a>
            <Button variant="outline" size="sm" onClick={copyBookmarklet}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy bookmarklet
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open Circle course
              </a>
            </Button>
          </div>

          <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] h-4">endpoint</Badge>
            <code className="break-all">{absoluteEndpoint}</code>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Paste captured JSON
              <span className="text-muted-foreground font-normal"> (primary path — clipboard from bookmarklet)</span>
            </label>
            <Textarea
              value={pastedJson}
              onChange={e => { setPastedJson(e.target.value); if (validationError) setValidationError(null); }}
              placeholder='Paste the JSON the bookmarklet copied to your clipboard…'
              className="min-h-[120px] font-mono text-[11px]"
              disabled={submitting}
            />
            {validationError && (
              <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>{validationError}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] text-muted-foreground flex items-center gap-2 min-h-[16px]">
                {phaseLabel[phase] && (
                  <span className="flex items-center gap-1">
                    {(phase === 'validating' || phase === 'normalizing') && <Loader2 className="h-3 w-3 animate-spin" />}
                    {phaseLabel[phase]}
                  </span>
                )}
                {stats && phase === 'done' && (
                  <span className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] h-4">imported {stats.imported}</Badge>
                    {stats.metadata_only > 0 && (
                      <Badge variant="outline" className="text-[9px] h-4">metadata-only {stats.metadata_only}</Badge>
                    )}
                    {stats.rejected > 0 && (
                      <Badge variant="outline" className="text-[9px] h-4">rejected {stats.rejected}</Badge>
                    )}
                  </span>
                )}
              </div>
              <Button onClick={handleSubmitPasted} disabled={submitting || !pastedJson.trim()} size="sm">
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Import pasted JSON
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab B: Manual paste ───────────────────────────────────── */}
        <TabsContent value="manual" className="space-y-3 pt-3">
          <div className="text-xs text-muted-foreground">
            Type each lesson by hand. Useful when the bookmarklet can’t reach hidden lessons.
          </div>

          <Input
            value={manualTitle}
            onChange={e => setManualTitle(e.target.value)}
            placeholder="Course title"
            className="h-8 text-sm"
            disabled={submitting}
          />

          <div className="space-y-3">
            {manualLessons.map((l, i) => (
              <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-muted-foreground">Lesson {i + 1}</span>
                  {manualLessons.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-muted-foreground"
                      onClick={() => removeManual(i)}
                      disabled={submitting}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <Input
                  value={l.title}
                  onChange={e => updateManual(i, { title: e.target.value })}
                  placeholder="Lesson title"
                  className="h-8 text-sm"
                  disabled={submitting}
                />
                <Input
                  value={l.url}
                  onChange={e => updateManual(i, { url: e.target.value })}
                  placeholder="Lesson URL (https://…)"
                  className="h-8 text-sm"
                  disabled={submitting}
                />
                <Textarea
                  value={l.body_text}
                  onChange={e => updateManual(i, { body_text: e.target.value })}
                  placeholder="Lesson body / notes"
                  className="min-h-[70px] text-xs"
                  disabled={submitting}
                />
                <Textarea
                  value={l.transcript}
                  onChange={e => updateManual(i, { transcript: e.target.value })}
                  placeholder="Transcript (optional)"
                  className="min-h-[60px] text-xs"
                  disabled={submitting}
                />
                <Input
                  value={l.media_url}
                  onChange={e => updateManual(i, { media_url: e.target.value })}
                  placeholder="Media URL (optional, e.g. video link)"
                  className="h-8 text-xs"
                  disabled={submitting}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addManual} disabled={submitting}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add lesson
            </Button>
            <Button onClick={handleSubmitManual} disabled={submitting} size="sm">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Import manual lessons
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CircleImportPanel;
