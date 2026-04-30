/**
 * import-course-capture
 *
 * Receives a JSON payload captured from the user's authenticated browser tab
 * by the Circle bookmarklet (public/circle-capture.js) — or any future
 * browser-assisted capture — and normalizes it into the same lesson envelope
 * the rest of the import pipeline already consumes.
 *
 * Authenticated via the user's Lovable Supabase JWT. Validated with Zod.
 * Applies the same quality gates as import-course:
 *   - block login_page / empty / html_junk
 *   - mark video_only lessons as metadata_only unless transcript present
 *
 * Modes:
 *   { mode?: 'capture' }  — default; full payload from bookmarklet
 *   { mode: 'manual' }    — user-pasted lesson(s); same shape, looser limits
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Schema ────────────────────────────────────────────────────────────────────

const LessonSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(500),
  module: z.string().trim().max(300).optional(),
  body_text: z.string().max(500_000).optional(),
  media_url: z.string().trim().max(2048).optional(),
  transcript: z.string().max(500_000).optional(),
});

const PayloadSchema = z.object({
  mode: z.enum(['capture', 'manual']).optional().default('capture'),
  source_url: z.string().trim().min(1).max(2048),
  platform: z.enum(['circle']),
  title: z.string().trim().min(1).max(500),
  lessons: z.array(LessonSchema).min(1).max(500),
});

export type CapturePayload = z.infer<typeof PayloadSchema>;

// ── Quality gate ──────────────────────────────────────────────────────────────

export type ContentType = 'text' | 'video_only' | 'login_page' | 'empty' | 'html_junk' | 'mixed';

export interface LessonQuality {
  content_length: number;
  cleaned_text_length: number;
  word_count: number;
  content_type: ContentType;
  has_login_wall: boolean;
  usable_content: boolean;
  metadata_only: boolean;
  issues: string[];
}

const LOGIN_PATTERNS = [
  /sign[\s_-]?in to (?:continue|access|view)/i,
  /you must (?:log|sign) in/i,
  /please (?:log|sign) in/i,
  /authentication required/i,
  /login to (?:continue|view|access)/i,
  /<input[^>]+name="(?:user|member)\[(?:email|password)\]"/i,
];

export function classifyLessonContent(args: {
  body_text?: string;
  transcript?: string;
  media_url?: string;
}): LessonQuality {
  const issues: string[] = [];
  const body = (args.body_text || '').trim();
  const transcript = (args.transcript || '').trim();
  const mediaUrl = (args.media_url || '').trim();

  // Combine for word counts; transcript counts as content.
  const combined = [body, transcript].filter(Boolean).join('\n\n');
  const cleaned = combined.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = cleaned ? cleaned.split(/\s+/).filter(w => w.length > 2).length : 0;

  const hasLoginWall = LOGIN_PATTERNS.some(p => p.test(body));
  if (hasLoginWall) issues.push('Login/auth wall detected');

  let contentType: ContentType = 'text';
  if (hasLoginWall) {
    contentType = 'login_page';
  } else if (combined.length === 0 && !mediaUrl) {
    contentType = 'empty';
    issues.push('No content captured');
  } else if (combined.length < 100 && mediaUrl) {
    contentType = 'video_only';
  } else if (mediaUrl && wordCount > 20) {
    contentType = 'mixed';
  } else {
    // html_junk heuristic on body only
    const tagCount = (body.match(/<[a-z]+[\s>]/gi) || []).length;
    const ratio = body.length > 0 ? cleaned.length / body.length : 1;
    if (tagCount > 30 && ratio < 0.3 && cleaned.length < 300) {
      contentType = 'html_junk';
      issues.push('Extreme tag density');
    }
  }

  if (contentType === 'text' && wordCount < 15) {
    issues.push(`Low word count (${wordCount})`);
  }

  const blocked = new Set<ContentType>(['login_page', 'empty', 'html_junk']);
  // video_only is NOT usable as full content unless we recovered a transcript
  const videoOnlyHasTranscript = contentType === 'video_only' && transcript.length > 0 && wordCount >= 50;
  const usable =
    !blocked.has(contentType) &&
    !hasLoginWall &&
    (wordCount >= 5 || videoOnlyHasTranscript || contentType === 'mixed');

  return {
    content_length: combined.length,
    cleaned_text_length: cleaned.length,
    word_count: wordCount,
    content_type: contentType,
    has_login_wall: hasLoginWall,
    usable_content: usable,
    metadata_only: contentType === 'video_only' && !videoOnlyHasTranscript,
    issues,
  };
}

// ── Normalizer ────────────────────────────────────────────────────────────────

export interface NormalizedLesson {
  url: string;
  title: string;
  module?: string;
  content: string;
  media_url?: string;
  transcript_source?: 'dom' | 'caption_track';
  quality: LessonQuality;
  imported: boolean;
  reject_reason?: string;
}

export function normalizeLessons(payload: CapturePayload, debug: string[]): NormalizedLesson[] {
  const out: NormalizedLesson[] = [];
  for (const lesson of payload.lessons) {
    const quality = classifyLessonContent({
      body_text: lesson.body_text,
      transcript: lesson.transcript,
      media_url: lesson.media_url,
    });

    // Build content: prefer body, append transcript if present
    const parts: string[] = [];
    if (lesson.body_text) parts.push(lesson.body_text.trim());
    if (lesson.transcript) parts.push(`\n\n[Transcript]\n${lesson.transcript.trim()}`);
    const content = parts.join('').trim();

    const blocked = new Set<ContentType>(['login_page', 'empty', 'html_junk']);
    const imported =
      !blocked.has(quality.content_type) &&
      // Allow lesson rows to be created even if metadata_only — caller may
      // still want them as stubs; classifier flags them appropriately.
      (quality.usable_content || quality.metadata_only || quality.content_type === 'mixed');

    out.push({
      url: lesson.url,
      title: lesson.title,
      module: lesson.module,
      content,
      media_url: lesson.media_url,
      transcript_source: lesson.transcript ? 'dom' : undefined,
      quality,
      imported,
      reject_reason: imported ? undefined : (quality.issues[0] || quality.content_type),
    });
  }
  debug.push(
    `[Capture] normalized ${out.length} lessons; ` +
      `imported=${out.filter(l => l.imported).length}, ` +
      `metadata_only=${out.filter(l => l.quality.metadata_only).length}, ` +
      `rejected=${out.filter(l => !l.imported).length}`
  );
  return out;
}

// ── Server ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'POST required' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Auth ──
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnon) {
    return new Response(JSON.stringify({ success: false, error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const userId = userData.user.id;

  // ── Parse + validate ──
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid payload', issues: parsed.error.flatten() }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const payload = parsed.data;

  // ── Normalize ──
  const debug: string[] = [
    `[Capture] user=${userId.slice(0, 8)}… platform=${payload.platform} mode=${payload.mode}`,
    `[Capture] source_url=${payload.source_url} title="${payload.title}" lessons_in=${payload.lessons.length}`,
  ];
  const normalized = normalizeLessons(payload, debug);

  // The function intentionally does NOT write to `resources` directly here.
  // It returns a normalized envelope that the existing CourseImportModal flow
  // (which already creates resources from `lessons[]`) consumes. This keeps
  // one ingestion path and avoids drift.
  return new Response(
    JSON.stringify({
      success: true,
      platform: 'circle',
      title: payload.title,
      lessons: normalized,
      meta: {
        platform: 'circle',
        mode: payload.mode,
        source_url: payload.source_url,
        lessons_received: payload.lessons.length,
        lessons_imported: normalized.filter(l => l.imported).length,
        lessons_metadata_only: normalized.filter(l => l.quality.metadata_only).length,
        lessons_rejected: normalized.filter(l => !l.imported).length,
        auth_status: 'browser_captured',
      },
      debug,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
