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

const ResourceSchema = z.object({
  title: z.string().trim().max(500).optional(),
  url: z.string().trim().min(1).max(2048),
  type: z.enum(['link', 'pdf', 'doc', 'sheet', 'slide', 'download', 'unknown']).optional(),
  source_section: z.string().trim().max(100).optional(),
});

export type CapturedResource = {
  title?: string;
  url: string;
  type?: 'link' | 'pdf' | 'doc' | 'sheet' | 'slide' | 'download' | 'unknown';
  source_section?: string;
  parent_lesson_url?: string;
  parent_lesson_title?: string;
};

const LessonSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(500),
  module: z.string().trim().max(300).optional(),
  lesson_number: z.number().int().nonnegative().optional(),
  total_lessons: z.number().int().nonnegative().optional(),
  body_text: z.string().max(500_000).optional(),
  media_url: z.string().trim().max(2048).optional(),
  transcript: z.string().max(500_000).optional(),
  resources: z.array(ResourceSchema).max(100).optional(),
  capture_issue: z.string().max(100).optional(),
});

const PayloadSchema = z.object({
  mode: z.enum(['capture', 'manual']).optional().default('capture'),
  capture_mode: z.string().max(100).optional(),
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
  // A video lesson is usable as full content if we recovered a transcript OR
  // substantive body text (e.g. Takeaways/Resources captured from the DOM).
  const videoOnlyHasContent =
    contentType === 'video_only' && ((transcript.length > 0 && wordCount >= 50) || wordCount >= 30);
  const usable =
    !blocked.has(contentType) &&
    !hasLoginWall &&
    (wordCount >= 5 || videoOnlyHasContent || contentType === 'mixed');

  return {
    content_length: combined.length,
    cleaned_text_length: cleaned.length,
    word_count: wordCount,
    content_type: contentType,
    has_login_wall: hasLoginWall,
    usable_content: usable,
    metadata_only: contentType === 'video_only' && !videoOnlyHasContent,
    issues,
  };
}

// ── Normalizer ────────────────────────────────────────────────────────────────

export interface NormalizedLesson {
  url: string;
  title: string;
  module?: string;
  lesson_number?: number;
  content: string;
  media_url?: string;
  transcript_source?: 'dom' | 'caption_track';
  resources?: Array<{ title?: string; url: string }>;
  capture_issue?: string;
  quality: LessonQuality;
  imported: boolean;
  reject_reason?: string;
  import_source: 'circle_browser_capture';
}

/**
 * Normalize a lesson URL for dedupe purposes:
 *   - lowercase host
 *   - strip hash fragment
 *   - strip trailing slash (except root)
 * Query string is preserved (Circle sometimes uses it for lesson IDs).
 */
export function normalizeLessonUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    u.hash = '';
    u.host = u.host.toLowerCase();
    let path = u.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    u.pathname = path;
    return u.toString();
  } catch {
    // Not an absolute URL — best-effort string normalization.
    return trimmed.split('#')[0].replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Richness score for dedupe tie-breaking.
 * Higher wins. transcript > body_text > media_url-only > title-only.
 */
function lessonRichness(l: { body_text?: string; transcript?: string; media_url?: string; title?: string }): number {
  let score = 0;
  if (l.transcript && l.transcript.trim().length > 0) score += 1000 + Math.min(l.transcript.length, 100_000) / 1000;
  if (l.body_text && l.body_text.trim().length > 0) score += 100 + Math.min(l.body_text.length, 100_000) / 1000;
  if (l.media_url && l.media_url.trim().length > 0) score += 10;
  if (l.title && l.title.trim().length > 0) score += 1;
  return score;
}

/**
 * Merge two duplicate lessons, preferring richer fields. Title prefers the
 * non-empty / longer one; module prefers existing then incoming.
 */
function mergeLessons<T extends {
  url: string; title: string; module?: string;
  body_text?: string; transcript?: string; media_url?: string;
}>(a: T, b: T): T {
  const pick = (x?: string, y?: string) => {
    const xs = (x || '').trim();
    const ys = (y || '').trim();
    if (xs && ys) return xs.length >= ys.length ? xs : ys;
    return xs || ys || undefined;
  };
  return {
    ...a,
    title: pick(a.title, b.title) || a.title,
    module: pick(a.module, b.module),
    body_text: pick(a.body_text, b.body_text),
    transcript: pick(a.transcript, b.transcript),
    media_url: pick(a.media_url, b.media_url),
  };
}

/**
 * Dedupe lessons by normalized URL. Keeps the richer version when duplicates
 * are found (transcript > body_text > media_url-only > title-only), merging
 * non-empty fields from the loser.
 */
export function dedupeLessons<T extends {
  url: string; title: string; module?: string;
  body_text?: string; transcript?: string; media_url?: string;
}>(lessons: T[], debug?: string[]): T[] {
  const byKey = new Map<string, T>();
  let collisions = 0;
  for (const lesson of lessons) {
    const key = normalizeLessonUrl(lesson.url);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...lesson, url: key });
      continue;
    }
    collisions++;
    const winner = lessonRichness(lesson) > lessonRichness(existing) ? lesson : existing;
    const loser = winner === lesson ? existing : lesson;
    byKey.set(key, { ...mergeLessons(winner, loser), url: key });
  }
  if (debug && collisions > 0) {
    debug.push(`[Capture] dedupe collapsed ${collisions} duplicate lesson URL${collisions === 1 ? '' : 's'}`);
  }
  return Array.from(byKey.values());
}

export function normalizeLessons(payload: CapturePayload, debug: string[]): NormalizedLesson[] {
  const deduped = dedupeLessons(payload.lessons, debug);
  const out: NormalizedLesson[] = [];
  for (const lesson of deduped) {
    const resources = (lesson as any).resources as Array<{ title?: string; url: string }> | undefined;

    // Compose body_text used for classification: include resources text so a
    // video-only lesson with rich Resources/Takeaways still classifies as
    // having usable content.
    let composedBody = (lesson.body_text || '').trim();
    if (resources && resources.length) {
      const resText = resources
        .map(r => `${(r.title || r.url).trim()} — ${r.url}`)
        .join('\n');
      composedBody = composedBody
        ? `${composedBody}\n\n[Resources]\n${resText}`
        : `[Resources]\n${resText}`;
    }

    const quality = classifyLessonContent({
      body_text: composedBody,
      transcript: lesson.transcript,
      media_url: lesson.media_url,
    });

    // Final saved content: body + transcript section.
    const parts: string[] = [];
    if (composedBody) parts.push(composedBody);
    if (lesson.transcript) parts.push(`\n\n[Transcript]\n${lesson.transcript.trim()}`);
    const content = parts.join('').trim();

    const blocked = new Set<ContentType>(['login_page', 'empty', 'html_junk']);
    const imported =
      !blocked.has(quality.content_type) &&
      (quality.usable_content || quality.metadata_only || quality.content_type === 'mixed');

    out.push({
      url: lesson.url,
      title: lesson.title,
      module: lesson.module,
      lesson_number: (lesson as any).lesson_number,
      content,
      media_url: lesson.media_url,
      transcript_source: lesson.transcript ? 'dom' : undefined,
      resources: resources && resources.length ? resources : undefined,
      capture_issue: (lesson as any).capture_issue,
      quality,
      imported,
      reject_reason: imported ? undefined : (quality.issues[0] || quality.content_type),
      import_source: 'circle_browser_capture',
    });
  }
  debug.push(
    `[Capture] normalized ${out.length} lessons; ` +
      `imported=${out.filter(l => l.imported).length}, ` +
      `metadata_only=${out.filter(l => l.quality.metadata_only).length}, ` +
      `rejected=${out.filter(l => !l.imported).length}, ` +
      `transcripts=${out.filter(l => l.transcript_source).length}, ` +
      `resources=${out.reduce((s, l) => s + (l.resources?.length || 0), 0)}`
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

  // Detect "lesson list only" payloads — the bookmarklet ran on a curriculum
  // page and we never got body/media/transcript for any lesson. We do NOT
  // call this an auth failure; we surface a friendlier hint upstream.
  const fullContentCount = normalized.filter(
    l => l.imported && l.quality.content_type !== 'video_only' && l.content.trim().length > 0
  ).length;
  const metadataOnlyCount = normalized.filter(l => l.quality.metadata_only).length;
  const rejectedCount = normalized.filter(l => !l.imported).length;
  const fetchFailedCount = normalized.filter(l => l.capture_issue === 'fetch_failed').length;
  const renderFailedCount = normalized.filter(l => l.capture_issue === 'render_failed').length;
  const transcriptCount = normalized.filter(l => l.transcript_source).length;
  const resourceCount = normalized.reduce((s, l) => s + (l.resources?.length || 0), 0);
  const listOnly =
    fullContentCount === 0 &&
    metadataOnlyCount === 0 &&
    normalized.length > 0;

  const warning = listOnly
    ? 'Captured lesson list only. No lesson content was found. Open an individual lesson and run the bookmarklet there.'
    : undefined;

  return new Response(
    JSON.stringify({
      success: true,
      platform: 'circle',
      title: payload.title,
      lessons: normalized,
      warning,
      meta: {
        platform: 'circle',
        mode: payload.mode,
        capture_mode: payload.capture_mode,
        source_url: payload.source_url,
        lessons_received: payload.lessons.length,
        lessons_imported: normalized.filter(l => l.imported).length,
        lessons_full_content: fullContentCount,
        lessons_metadata_only: metadataOnlyCount,
        lessons_rejected: rejectedCount,
        lessons_fetch_failed: fetchFailedCount,
        lessons_render_failed: renderFailedCount,
        lessons_with_transcript: transcriptCount,
        resources_captured: resourceCount,
        lessons_list_only: listOnly,
        auth_status: 'browser_captured',
      },
      debug,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
