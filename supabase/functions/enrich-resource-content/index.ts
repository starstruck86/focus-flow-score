import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

const CONTENT_CAP = 60_000;
const ENRICHMENT_VERSION = 2;
const VALIDATION_VERSION = 2;

// ── Quality thresholds ──
const MIN_CONTENT_CHARS = 200;
const GOOD_CONTENT_CHARS = 1000;
const MIN_UNIQUE_WORDS = 25;
const COMPLETE_MIN_SCORE = 70;
const PARTIAL_MIN_SCORE = 35;

const BOILERPLATE_PATTERNS = [
  /cookie\s*(policy|consent|notice)/i,
  /privacy\s*policy/i,
  /terms\s*(of\s*service|and\s*conditions)/i,
  /subscribe\s*(to\s*our|now)/i,
  /sign\s*up\s*for/i,
  /all\s*rights\s*reserved/i,
  /©\s*\d{4}/,
  /skip\s*to\s*(main\s*)?content/i,
];

// ── Source classification ──────────────────────────────────
type SourceType =
  | 'webpage_static'
  | 'webpage_js'
  | 'pdf'
  | 'youtube'
  | 'google_doc'
  | 'google_sheet'
  | 'google_drive_file'
  | 'notion'
  | 'auth_gated'
  | 'social'
  | 'podcast'
  | 'direct_audio'
  | 'zoom_recording'
  | 'circle_page'
  | 'unknown';

interface SourceClassification {
  source_type: SourceType;
  platform: string;
  auth_required: boolean;
  transcript_available: boolean | null;
  downloadable: boolean;
  js_rendered: boolean;
}

const AUTH_GATED_DOMAINS: Array<{ pattern: RegExp; platform: string }> = [
  { pattern: /teachable\.com/i, platform: 'Teachable' },
  { pattern: /kajabi\.com/i, platform: 'Kajabi' },
  { pattern: /skool\.com/i, platform: 'Skool' },
  { pattern: /thinkific\.com/i, platform: 'Thinkific' },
  { pattern: /udemy\.com/i, platform: 'Udemy' },
  { pattern: /coursera\.org/i, platform: 'Coursera' },
  { pattern: /linkedin\.com\/learning/i, platform: 'LinkedIn Learning' },
  { pattern: /loom\.com/i, platform: 'Loom' },
  { pattern: /dropbox\.com/i, platform: 'Dropbox' },
  { pattern: /onedrive\.live\.com/i, platform: 'OneDrive' },
  { pattern: /sharepoint\.com/i, platform: 'SharePoint' },
  { pattern: /\.zoom\.us\//i, platform: 'Zoom' },
  { pattern: /fathom\.video/i, platform: 'Fathom' },
];

const GOOGLE_DOC_PATTERNS = [
  /docs\.google\.com/i,
  /drive\.google\.com/i,
  /sheets\.google\.com/i,
  /slides\.google\.com/i,
];

const JS_HEAVY_DOMAINS = [
  /medium\.com/i,
  /substack\.com/i,
  /hashnode\.dev/i,
  /dev\.to/i,
  /notion\.site/i,
  /webflow\.io/i,
];

function classifySource(url: string): SourceClassification {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname || '';
    const hostAndPath = `${u.hostname}${u.pathname}`;

    // ── Circle community URLs — MUST come before generic auth-gated/webpage checks ──
    if (/(^|\.)circle\.so$/i.test(host)) {
      return {
        source_type: 'circle_page',
        platform: 'Circle',
        auth_required: false,
        transcript_available: null,
        downloadable: false,
        js_rendered: true,
      };
    }

    // ── Zoom recording URLs — MUST come before generic auth-gated check ──
    if (/\.zoom\.us\/rec\/(play|share)\//i.test(url)) {
      return {
        source_type: 'zoom_recording', platform: 'Zoom', auth_required: false,
        transcript_available: null, downloadable: false, js_rendered: true,
      };
    }

    for (const ag of AUTH_GATED_DOMAINS) {
      if (ag.pattern.test(hostAndPath)) {
        return { source_type: 'auth_gated', platform: ag.platform, auth_required: true, transcript_available: null, downloadable: false, js_rendered: false };
      }
    }

    if (/docs\.google\.com\/spreadsheets/i.test(hostAndPath) || /sheets\.google\.com/i.test(hostAndPath)) {
      return { source_type: 'google_sheet', platform: 'Google Sheets', auth_required: false, transcript_available: null, downloadable: true, js_rendered: false };
    }

    if (/drive\.google\.com\/file\/d\//i.test(hostAndPath) ||
        /drive\.google\.com\/open\?/i.test(url) ||
        /drive\.google\.com\/uc\?/i.test(url)) {
      return { source_type: 'google_drive_file', platform: 'Google Drive', auth_required: false, transcript_available: null, downloadable: true, js_rendered: false };
    }

    if (/docs\.google\.com\/document/i.test(url)) {
      return { source_type: 'google_doc', platform: 'Google Docs', auth_required: false, transcript_available: null, downloadable: true, js_rendered: false };
    }

    if (GOOGLE_DOC_PATTERNS.some(p => p.test(hostAndPath))) {
      return { source_type: 'google_doc', platform: 'Google', auth_required: true, transcript_available: null, downloadable: false, js_rendered: false };
    }

    if (/notion\.so/i.test(hostAndPath)) {
      return { source_type: 'notion', platform: 'Notion', auth_required: true, transcript_available: null, downloadable: false, js_rendered: true };
    }

    if (/youtube\.com|youtu\.be/i.test(hostAndPath)) {
      return { source_type: 'youtube', platform: 'YouTube', auth_required: false, transcript_available: true, downloadable: false, js_rendered: true };
    }

    const embeddedAudio = extractEmbeddedAudioUrl(url);
    if (embeddedAudio) {
      return { source_type: 'direct_audio', platform: 'Anchor.fm (wrapped)', auth_required: false, transcript_available: null, downloadable: true, js_rendered: false };
    }

    if (/spotify\.com|podcasts\.apple\.com|anchor\.fm/i.test(hostAndPath)) {
      return { source_type: 'podcast', platform: 'Podcast', auth_required: false, transcript_available: null, downloadable: false, js_rendered: true };
    }

    if (/\.(mp3|m4a|wav|ogg|aac|flac|opus|webm)($|\?)/i.test(pathname)) {
      return { source_type: 'direct_audio', platform: 'Audio', auth_required: false, transcript_available: null, downloadable: true, js_rendered: false };
    }

    if (/twitter\.com|x\.com|threads\.net|reddit\.com/i.test(hostAndPath)) {
      return { source_type: 'social', platform: 'Social', auth_required: false, transcript_available: null, downloadable: false, js_rendered: true };
    }

    if (/\.pdf($|\?)/i.test(pathname)) {
      return { source_type: 'pdf', platform: 'Web', auth_required: false, transcript_available: null, downloadable: true, js_rendered: false };
    }

    if (JS_HEAVY_DOMAINS.some(p => p.test(hostAndPath))) {
      return { source_type: 'webpage_js', platform: u.hostname, auth_required: false, transcript_available: null, downloadable: false, js_rendered: true };
    }

    return { source_type: 'webpage_static', platform: u.hostname, auth_required: false, transcript_available: null, downloadable: false, js_rendered: false };
  } catch {
    return { source_type: 'unknown', platform: 'unknown', auth_required: false, transcript_available: null, downloadable: false, js_rendered: false };
  }
}

// ── Extraction methods ─────────────────────────────────────
interface ExtractionAttempt {
  method: string;
  duration_ms: number;
  chars_extracted: number;
  timeout_hit: boolean;
  auth_wall_detected: boolean;
  http_status: number | null;
  validation_result: 'pass' | 'fail' | 'partial';
  error_category: string | null;
  error_detail: string | null;
}

interface ExtractionResult {
  content: string | null;
  attempt: ExtractionAttempt;
}

/** Firecrawl scrape with main-content extraction */
async function firecrawlScrape(
  url: string, apiKey: string, opts: { waitFor?: number; timeout?: number } = {}
): Promise<ExtractionResult> {
  const method = 'firecrawl_main_content';
  const startMs = Date.now();
  const hardTimeout = opts.timeout || 90_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hardTimeout);

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        ...(opts.waitFor ? { waitFor: opts.waitFor } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: response.status,
          validation_result: 'fail', error_category: `http_${response.status}`,
          error_detail: `Firecrawl returned ${response.status}`,
        },
      };
    }

    const data = await response.json();
    const markdown = (data.data?.markdown || data.markdown || "").slice(0, CONTENT_CAP);

    // Detect auth walls in returned content
    const authWall = /sign.?in|log.?in|create.?account|access.?denied/i.test(markdown.slice(0, 500))
      && markdown.length < 1000;

    return {
      content: markdown || null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: markdown.length, timeout_hit: false,
        auth_wall_detected: authWall, http_status: response.status,
        validation_result: markdown.length > 0 ? (authWall ? 'fail' : 'partial') : 'fail',
        error_category: authWall ? 'auth_wall' : null,
        error_detail: authWall ? 'Login/signup wall detected in scraped content' : null,
      },
    };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: isTimeout,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail',
        error_category: isTimeout ? 'timeout' : 'network',
        error_detail: isTimeout ? `Timed out after ${hardTimeout}ms` : (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Firecrawl full-page (no onlyMainContent) for JS-heavy sites */
async function firecrawlFullPage(
  url: string, apiKey: string, opts: { waitFor?: number; timeout?: number } = {}
): Promise<ExtractionResult> {
  const method = 'firecrawl_full_page';
  const startMs = Date.now();
  const hardTimeout = opts.timeout || 90_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hardTimeout);

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: false,
        ...(opts.waitFor ? { waitFor: opts.waitFor } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: response.status,
          validation_result: 'fail', error_category: `http_${response.status}`,
          error_detail: `Full-page scrape returned ${response.status}`,
        },
      };
    }

    const data = await response.json();
    const markdown = (data.data?.markdown || data.markdown || "").slice(0, CONTENT_CAP);

    return {
      content: markdown || null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: markdown.length, timeout_hit: false,
        auth_wall_detected: false, http_status: response.status,
        validation_result: markdown.length > 0 ? 'partial' : 'fail',
        error_category: null, error_detail: null,
      },
    };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: isTimeout,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail',
        error_category: isTimeout ? 'timeout' : 'network',
        error_detail: isTimeout ? `Timed out after ${hardTimeout}ms` : (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Firecrawl with extended wait for JS-rendered content */
async function firecrawlJsRendered(url: string, apiKey: string): Promise<ExtractionResult> {
  return firecrawlScrape(url, apiKey, { waitFor: 10000, timeout: 120_000 });
}

/** YouTube: Extract captions via innertube API (no Firecrawl needed) */
async function youtubeCaption(url: string, _apiKey: string): Promise<ExtractionResult> {
  const method = 'youtube_captions';
  const startMs = Date.now();

  try {
    // Extract video ID
    const u = new URL(url);
    let videoId: string | null = null;
    if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1).split('/')[0] || null;
    else if (u.hostname.includes('youtube.com')) {
      videoId = u.searchParams.get('v');
      if (!videoId) {
        const m = u.pathname.match(/\/(embed|v)\/([\w-]{11})/);
        if (m) videoId = m[2];
      }
    }
    if (!videoId) throw new Error('Could not extract video ID');

    // Call innertube player API directly (same logic as youtube-captions function)
    const playerResp = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en' } },
          videoId,
        }),
      }
    );
    if (!playerResp.ok) throw new Error(`Innertube returned ${playerResp.status}`);
    const player = await playerResp.json();

    // Check playability
    const status = player?.playabilityStatus?.status;
    if (status === 'ERROR' || status === 'UNPLAYABLE') {
      throw new Error(player?.playabilityStatus?.reason || 'Video unavailable');
    }

    // Get caption tracks
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return {
        content: null,
        attempt: {
          method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'no_captions',
          error_detail: 'No caption tracks available for this YouTube video',
        },
      };
    }

    // Pick best track (prefer en manual, then en auto, then any)
    const pick = tracks.find((t: any) => t.languageCode?.startsWith('en') && t.kind !== 'asr')
      || tracks.find((t: any) => t.languageCode?.startsWith('en'))
      || tracks.find((t: any) => t.kind !== 'asr')
      || tracks[0];

    // Fetch captions as raw XML (default format)
    const capResp = await fetch(pick.baseUrl);
    if (!capResp.ok) throw new Error(`Caption fetch returned ${capResp.status}`);
    const capXml = await capResp.text();

    // Parse XML <text> elements to plain text
    const textMatches = capXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi);
    const lines: string[] = [];
    for (const match of textMatches) {
      const decoded = match[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '')
        .trim();
      if (decoded) lines.push(decoded);
    }
    const transcript = lines.join(' ').replace(/\s+/g, ' ').trim();
    const durationMs = Date.now() - startMs;

    if (transcript.length < 50) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: transcript.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'caption_parse_failed',
          error_detail: `Captions found but parsed to only ${transcript.length} chars`,
        },
      };
    }

    return {
      content: transcript.slice(0, CONTENT_CAP),
      attempt: {
        method, duration_ms: durationMs, chars_extracted: transcript.length, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: transcript.length >= 500 ? 'pass' : 'partial',
        error_category: null, error_detail: null,
      },
    };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail', error_category: 'youtube_caption_error',
        error_detail: (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Extract embedded audio URL from Anchor.fm / podcast play links.
 *  Handles URLs like: anchor.fm/s/.../podcast/play/12345/https%3A%2F%2Fcdn...%2Faudio.mp3
 *  Also matches any URL where the last path segment is a URL-encoded audio file URL. */
function extractEmbeddedAudioUrl(url: string): string | null {
  // Pattern 1: /podcast/play/{id}/{encoded-audio-url}
  const match = url.match(/\/podcast\/play\/\d+\/(https?%3A%2F%2F[^\s?#]+)/i);
  if (match?.[1]) {
    try {
      const decoded = decodeURIComponent(match[1]);
      // Validate it looks like an audio file or a CDN media asset
      if (/\.(mp3|m4a|wav|ogg|aac|opus|flac|webm)($|\?)/i.test(decoded)) return decoded;
      // CloudFront/CDN paths with no extension but clearly audio (staging directories etc.)
      if (/cloudfront\.net|cdn\.|media\.|audio\./i.test(decoded)) return decoded;
    } catch { /* fall through */ }
  }

  // Pattern 2: Any URL where the last path segment is a URL-encoded http(s) audio URL
  const segments = url.split('/');
  const lastSeg = segments[segments.length - 1];
  if (lastSeg && /^https?%3A%2F%2F/i.test(lastSeg)) {
    try {
      const decoded = decodeURIComponent(lastSeg);
      if (/\.(mp3|m4a|wav|ogg|aac|opus|flac|webm)($|\?)/i.test(decoded)) return decoded;
      if (/cloudfront\.net|cdn\.|media\.|audio\./i.test(decoded)) return decoded;
    } catch { /* fall through */ }
  }

  return null;
}

const CIRCLE_AUTH_PATTERNS = [
  /log\s*in\s*to\s*your\s*account/i,
  /sign\s*in\s*with\s*an\s*email/i,
  /continue\s*with\s*google/i,
  /continue\s*with\s*(twitter|facebook|apple)/i,
  /access\s*with\s*course\s*purchase/i,
  /forgot\s*your\s*password/i,
  /login\.circle\.so/i,
];

const CIRCLE_SHELL_PATTERNS = [
  /community\s*home/i,
  /member\s*directory/i,
  /search\s*posts/i,
  /join\s*the\s*community/i,
  /circle\s*community/i,
  /powered\s*by\s*circle/i,
  /log\s*in/i,
  /sign\s*up/i,
  /continue\s*with/i,
];

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\u003c/gi, '<')
    .replace(/\u003e/gi, '>')
    .replace(/\u0026/gi, '&')
    .replace(/\u002f/gi, '/')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\"/g, '"')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCircleShellOnly(text: string): boolean {
  if (!text || text.length < 80) return true;
  const sample = text.slice(0, 5000);
  const authHits = CIRCLE_AUTH_PATTERNS.filter(p => p.test(sample)).length;
  const shellHits = CIRCLE_SHELL_PATTERNS.filter(p => p.test(sample)).length;
  const lines = sample.split('
').map(l => l.trim()).filter(Boolean);
  const substantiveLines = lines.filter(l => l.length > 120);

  if (authHits >= 2 && substantiveLines.length < 3) return true;
  if (shellHits >= 4 && substantiveLines.length < 3) return true;
  return false;
}

function extractCirclePostBodyFromContent(text: string): string | null {
  if (!text) return null;

  const patterns = [
    /"post_body(?:_plain_text|_text|_html)?":\s*"([\s\S]{150,}?)"/i,
    /"trix_content":\s*"([\s\S]{150,}?)"/i,
    /"body":\s*"([\s\S]{150,}?)","(?:body_truncated|created_at|id|name|slug|post_type)"/i,
    /"content":\s*"([\s\S]{150,}?)","(?:slug|id|name|created_at|post_type)"/i,
    /<article[\s\S]*?>([\s\S]{150,}?)<\/article>/i,
    /<main[\s\S]*?>([\s\S]{150,}?)<\/main>/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const cleaned = normalizeExtractedText(match?.[1] || '');
    if (cleaned.length >= 150 && !isCircleShellOnly(cleaned)) {
      return cleaned.slice(0, CONTENT_CAP);
    }
  }

  return null;
}

// ── Zoom shell detection patterns ──
const ZOOM_SHELL_PATTERNS = [
  /sign\s*in/i,
  /download\s*(the\s*)?app/i,
  /join\s*a?\s*meeting/i,
  /host\s*a?\s*meeting/i,
  /zoom\s*workplace/i,
  /zoom\s*phone/i,
  /zoom\s*events/i,
  /request\s*a\s*demo/i,
  /contact\s*sales/i,
  /plans\s*&?\s*pricing/i,
  /zoom\s*blog/i,
  /learning\s*center/i,
  /zoom\s*community/i,
];

/** Detect whether Zoom page content is just the generic shell/nav (no recording content) */
function isZoomShellOnly(text: string): boolean {
  if (!text || text.length < 50) return true;
  const sample = text.slice(0, 3000);
  const shellHits = ZOOM_SHELL_PATTERNS.filter(p => p.test(sample)).length;
  // If >4 shell patterns match and content is short, it's just the shell
  if (shellHits >= 4 && text.length < 3000) return true;
  // If content is dominated by nav links with no substantial paragraphs
  const lines = sample.split('\n').filter(l => l.trim().length > 0);
  const substantiveLines = lines.filter(l => l.trim().length > 80);
  if (substantiveLines.length < 3 && shellHits >= 3) return true;
  return false;
}

/** Extract transcript data from Zoom recording page HTML/markdown */
function extractZoomTranscriptFromContent(text: string): string | null {
  if (!text) return null;

  // Look for VTT/SRT-style transcript segments embedded in page
  const vttMatch = text.match(/WEBVTT[\s\S]{100,}/i);
  if (vttMatch) {
    const lines = vttMatch[0].split('\n')
      .filter(l => !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/i.test(l.trim()) && l.trim().length > 0);
    const transcript = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (transcript.length >= 100) return transcript;
  }

  // Look for JSON transcript payloads in script tags or player bootstrap data
  const jsonPatterns = [
    /"transcript":\s*"([^"]{100,})"/i,
    /"captions?":\s*\[[\s\S]*?"text":\s*"([^"]{50,})"/i,
    /"cc_url":\s*"(https?:[^"]+)"/i,
  ];
  for (const pat of jsonPatterns) {
    const m = text.match(pat);
    if (m?.[1] && m[1].length >= 100) {
      // If it's a URL to captions file, return as-is for caller to fetch
      if (/^https?:/.test(m[1])) return `[CAPTION_URL:${m[1]}]`;
      return m[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return null;
}

/** Circle community extractor — inspect bootstrap/app state first, then classify explicit recovery */
async function circlePageExtract(url: string, apiKey: string): Promise<ExtractionResult> {
  const method = 'circle_handler';
  const startMs = Date.now();

  try {
    const pathname = new URL(url).pathname;
    if (!/\/c\//i.test(pathname)) {
      return {
        content: null,
        attempt: {
          method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'circle_unsupported_page_type',
          error_detail: 'Circle URL is not a supported community post/page path',
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: 8000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      const isAuthBlocked = response.status === 401 || response.status === 403;
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: isAuthBlocked, http_status: response.status,
          validation_result: 'fail',
          error_category: isAuthBlocked ? 'circle_access_blocked' : `http_${response.status}`,
          error_detail: isAuthBlocked
            ? `Circle page returned ${response.status} — access blocked`
            : `Circle handler returned ${response.status}`,
        },
      };
    }

    const data = await response.json();
    const markdown = (data.data?.markdown || data.markdown || '').slice(0, CONTENT_CAP);
    const html = data.data?.html || data.html || '';
    const shellSample = `${markdown}
${html.slice(0, 15_000)}`;

    const extractedBody = extractCirclePostBodyFromContent(html)
      || extractCirclePostBodyFromContent(markdown);

    if (extractedBody && extractedBody.length >= 150) {
      return {
        content: extractedBody,
        attempt: {
          method: 'circle_page_content', duration_ms: Date.now() - startMs,
          chars_extracted: extractedBody.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: extractedBody.length >= 1000 ? 'pass' : 'partial',
          error_category: null, error_detail: null,
        },
      };
    }

    const normalizedMarkdown = normalizeExtractedText(markdown);
    const hasAuthSignals = CIRCLE_AUTH_PATTERNS.some(p => p.test(shellSample));
    if (!hasAuthSignals && normalizedMarkdown.length >= 400 && !isCircleShellOnly(normalizedMarkdown)) {
      return {
        content: normalizedMarkdown.slice(0, CONTENT_CAP),
        attempt: {
          method: 'circle_page_markdown', duration_ms: Date.now() - startMs,
          chars_extracted: normalizedMarkdown.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: normalizedMarkdown.length >= 1000 ? 'pass' : 'partial',
          error_category: null, error_detail: null,
        },
      };
    }

    if (hasAuthSignals) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: markdown.length, timeout_hit: false,
          auth_wall_detected: true, http_status: 200,
          validation_result: 'fail', error_category: 'circle_auth_required',
          error_detail: 'Circle community page requires authentication — post body not accessible',
        },
      };
    }

    if (isCircleShellOnly(shellSample)) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: markdown.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'circle_shell_only',
          error_detail: 'Circle app shell only — no meaningful post body found',
        },
      };
    }

    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: markdown.length, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: 'fail', error_category: 'circle_post_body_not_found',
        error_detail: 'Circle page loaded but no usable post body was found in app state or rendered content',
      },
    };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: isTimeout,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail',
        error_category: isTimeout ? 'timeout' : 'circle_post_body_not_found',
        error_detail: isTimeout ? 'Circle page timed out after 120s' : (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Zoom recording extractor — attempts transcript/player data, then falls back to scraping */
async function zoomRecordingExtract(url: string, apiKey: string): Promise<ExtractionResult> {
  const method = 'zoom_recording_handler';
  const startMs = Date.now();

  try {
    // Step 1: Fetch the page via Firecrawl with JS rendering + wait for player to load
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: 8000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      const status = response.status;
      // 403/401 = auth required for this recording
      if (status === 403 || status === 401) {
        return {
          content: null,
          attempt: {
            method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
            auth_wall_detected: true, http_status: status,
            validation_result: 'fail', error_category: 'zoom_auth_required',
            error_detail: `Zoom recording returned ${status} — access requires authentication`,
          },
        };
      }
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: status,
          validation_result: 'fail', error_category: 'zoom_recording_access_blocked',
          error_detail: `Zoom recording page returned ${status}`,
        },
      };
    }

    const data = await response.json();
    const markdown = (data.data?.markdown || data.markdown || "").slice(0, CONTENT_CAP);
    const html = data.data?.html || data.html || "";

    // Step 2: Check for embedded transcript in HTML or markdown
    const transcriptFromHtml = extractZoomTranscriptFromContent(html);
    const transcriptFromMd = extractZoomTranscriptFromContent(markdown);
    const foundTranscript = transcriptFromHtml || transcriptFromMd;

    if (foundTranscript && !foundTranscript.startsWith('[CAPTION_URL:') && foundTranscript.length >= 100) {
      console.log(`[Zoom] Found embedded transcript: ${foundTranscript.length} chars`);
      return {
        content: foundTranscript.slice(0, CONTENT_CAP),
        attempt: {
          method: 'zoom_embedded_transcript', duration_ms: Date.now() - startMs,
          chars_extracted: foundTranscript.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: foundTranscript.length >= 500 ? 'pass' : 'partial',
          error_category: null, error_detail: null,
        },
      };
    }

    // Step 2b: If we found a caption URL, try to fetch it
    if (foundTranscript?.startsWith('[CAPTION_URL:')) {
      const captionUrl = foundTranscript.slice(13, -1);
      try {
        const capResp = await fetch(captionUrl);
        if (capResp.ok) {
          const capText = await capResp.text();
          // Parse VTT/SRT
          const lines = capText.split('\n')
            .filter(l => !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/i.test(l.trim()) && l.trim().length > 0);
          const transcript = lines.join(' ').replace(/\s+/g, ' ').trim();
          if (transcript.length >= 100) {
            return {
              content: transcript.slice(0, CONTENT_CAP),
              attempt: {
                method: 'zoom_caption_url', duration_ms: Date.now() - startMs,
                chars_extracted: transcript.length, timeout_hit: false,
                auth_wall_detected: false, http_status: 200,
                validation_result: transcript.length >= 500 ? 'pass' : 'partial',
                error_category: null, error_detail: null,
              },
            };
          }
        }
      } catch (e) {
        console.log(`[Zoom] Caption URL fetch failed: ${(e as Error).message}`);
      }
    }

    // Step 3: Check if we got Zoom shell only (no real content)
    if (isZoomShellOnly(markdown)) {
      console.log(`[Zoom] Shell-only content detected for ${url.slice(0, 80)}`);
      return {
        content: null,
        attempt: {
          method, duration_ms: Date.now() - startMs, chars_extracted: markdown.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'zoom_player_shell_only',
          error_detail: 'Zoom page returned generic navigation/shell — no recording content found',
        },
      };
    }

    // Step 4: If markdown has substantial content (meeting details, chat, etc.) use it
    if (markdown.length >= 200) {
      return {
        content: markdown,
        attempt: {
          method: 'zoom_page_content', duration_ms: Date.now() - startMs,
          chars_extracted: markdown.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: markdown.length >= 1000 ? 'pass' : 'partial',
          error_category: null, error_detail: null,
        },
      };
    }

    // No usable content
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: 'fail', error_category: 'zoom_transcript_not_found',
        error_detail: 'Zoom recording page loaded but no transcript, captions, or media asset found',
      },
    };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: isTimeout,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail',
        error_category: isTimeout ? 'timeout' : 'zoom_media_asset_not_resolved',
        error_detail: isTimeout ? 'Zoom recording page timed out after 120s' : (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Podcast: Resolve via resolve-podcast-episode, then transcribe if audio URL found */
async function podcastResolveAndTranscribe(url: string, _apiKey: string): Promise<ExtractionResult> {
  const method = 'podcast_resolve_transcribe';
  const startMs = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Check for embedded audio URL first (Anchor.fm play links)
    const embeddedAudio = extractEmbeddedAudioUrl(url);
    if (embeddedAudio) {
      console.log(`[Podcast] Found embedded audio URL: ${embeddedAudio.substring(0, 80)}...`);
      // Skip resolve, go straight to transcription
      const transcribeResp = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ audio_url: embeddedAudio }),
      });

      if (transcribeResp.ok) {
        const data = await transcribeResp.json();
        if (data.success && data.transcript && data.transcript.length >= 50) {
          return {
            content: data.transcript.slice(0, CONTENT_CAP),
            attempt: {
              method: 'podcast_embedded_audio_transcribe', duration_ms: Date.now() - startMs,
              chars_extracted: data.transcript.length, timeout_hit: false,
              auth_wall_detected: false, http_status: 200,
              validation_result: data.transcript.length >= 500 ? 'pass' : 'partial',
              error_category: null, error_detail: null,
            },
          };
        }
      }
      // If embedded transcription failed, fall through to normal resolve
      console.log(`[Podcast] Embedded audio transcription failed, trying resolve...`);
    }

    // Step 1: Resolve the podcast episode to get audio URL
    console.log(`[Podcast] Resolving: ${url}`);
    const resolveResp = await fetch(`${supabaseUrl}/functions/v1/resolve-podcast-episode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ url }),
    });

    if (!resolveResp.ok) {
      throw new Error(`Resolve function returned ${resolveResp.status}`);
    }

    const resolveData = await resolveResp.json();
    console.log(`[Podcast] Resolved: status=${resolveData.finalStatus}, audioUrl=${resolveData.resolution?.audioEnclosureUrl ? 'found' : 'none'}`);

    const audioUrl = resolveData.resolution?.audioEnclosureUrl;

    // If no audio URL found, return metadata as content (better than nothing)
    if (!audioUrl) {
      const metadataContent = buildPodcastMetadataContent(resolveData);
      const durationMs = Date.now() - startMs;

      if (metadataContent && metadataContent.length > 100) {
        return {
          content: metadataContent,
          attempt: {
            method, duration_ms: durationMs, chars_extracted: metadataContent.length, timeout_hit: false,
            auth_wall_detected: false, http_status: 200,
            validation_result: 'partial', error_category: 'no_audio_url',
            error_detail: resolveData.failureReason || 'No audio URL resolved — metadata only',
          },
        };
      }

      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'podcast_no_audio',
          error_detail: resolveData.failureReason || 'Could not resolve audio URL for transcription',
        },
      };
    }

    // Step 2: Send to transcribe-audio
    console.log(`[Podcast] Transcribing audio: ${audioUrl.substring(0, 80)}...`);
    const transcribeResp = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ audio_url: audioUrl }),
    });

    if (!transcribeResp.ok) {
      throw new Error(`Transcribe function returned ${transcribeResp.status}`);
    }

    const transcribeData = await transcribeResp.json();
    const durationMs = Date.now() - startMs;

    if (transcribeData.success && transcribeData.transcript && transcribeData.transcript.length >= 50) {
      // Build rich content: metadata header + transcript
      const header = resolveData.metadata?.title ? `# ${resolveData.metadata.title}\n` : '';
      const showLine = resolveData.metadata?.showName ? `**Show:** ${resolveData.metadata.showName}\n` : '';
      const transcript = `${header}${showLine}\n## Transcript\n\n${transcribeData.transcript}`;

      return {
        content: transcript.slice(0, CONTENT_CAP),
        attempt: {
          method, duration_ms: durationMs, chars_extracted: transcript.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: transcript.length >= 500 ? 'pass' : 'partial',
          error_category: null, error_detail: null,
        },
      };
    }

    // Transcription failed
    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: 'fail',
        error_category: transcribeData.failureCode || 'transcription_failed',
        error_detail: transcribeData.failureReason || 'Audio transcription produced no usable text',
      },
    };
  } catch (e) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail', error_category: 'podcast_pipeline_error',
        error_detail: (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Direct audio: Send straight to transcribe-audio */
async function directAudioTranscribe(url: string, _apiKey: string): Promise<ExtractionResult> {
  const method = 'direct_audio_transcribe';
  const startMs = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    console.log(`[DirectAudio] Transcribing: ${url.substring(0, 80)}...`);
    const transcribeResp = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ audio_url: url }),
    });

    if (!transcribeResp.ok) {
      throw new Error(`Transcribe returned ${transcribeResp.status}`);
    }

    const data = await transcribeResp.json();
    const durationMs = Date.now() - startMs;

    if (data.success && data.transcript && data.transcript.length >= 50) {
      return {
        content: data.transcript.slice(0, CONTENT_CAP),
        attempt: {
          method, duration_ms: durationMs, chars_extracted: data.transcript.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: data.transcript.length >= 500 ? 'pass' : 'partial',
          error_category: null, error_detail: null,
        },
      };
    }

    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: 'fail',
        error_category: data.failureCode || 'transcription_failed',
        error_detail: data.failureReason || 'Audio transcription produced no usable text',
      },
    };
  } catch (e) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail', error_category: 'audio_transcribe_error',
        error_detail: (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Build readable content from podcast metadata when no audio URL available */
function buildPodcastMetadataContent(resolveData: any): string | null {
  const m = resolveData?.metadata;
  if (!m) return null;
  const parts: string[] = [];
  if (m.title) parts.push(`# ${m.title}`);
  if (m.showName) parts.push(`**Show:** ${m.showName}`);
  if (m.publishDate) parts.push(`**Published:** ${m.publishDate}`);
  if (m.description) parts.push(`\n## Description\n\n${m.description}`);
  if (resolveData.failureReason) parts.push(`\n---\n*Note: ${resolveData.failureReason}*`);
  return parts.length > 0 ? parts.join('\n') : null;
}

// ── Google Sheets helpers ───────────────────────────────────
function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i);
  return m?.[1] ?? null;
}

/** Export Google Sheet as CSV (one sheet at a time), then combine all tabs */
async function googleSheetExport(url: string, _apiKey: string): Promise<ExtractionResult> {
  const method = 'google_sheet_csv_export';
  const startMs = Date.now();

  const sheetId = extractSheetId(url);
  if (!sheetId) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail', error_category: 'parse_failure',
        error_detail: 'Could not extract spreadsheet ID from Google Sheets URL',
      },
    };
  }

  try {
    // First try to get the HTML version to discover sheet/tab names
    const htmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    // Export as CSV (default first sheet)
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    const csvResp = await fetch(csvUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnrichBot/1.0)' },
    });
    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (csvResp.status === 401 || csvResp.status === 403) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: true, http_status: csvResp.status,
          validation_result: 'fail', error_category: 'auth_failure',
          error_detail: `Google Sheets returned ${csvResp.status} — file is not publicly accessible`,
        },
      };
    }

    if (!csvResp.ok) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: csvResp.status,
          validation_result: 'fail', error_category: `http_${csvResp.status}`,
          error_detail: `Google Sheets export returned ${csvResp.status}`,
        },
      };
    }

    const csvText = await csvResp.text();

    // Check if we got an HTML login page instead of CSV
    if (csvText.includes('accounts.google.com') && csvText.includes('Sign in')) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: true, http_status: 200,
          validation_result: 'fail', error_category: 'auth_failure',
          error_detail: 'Google Sheets requires sign-in — file is not publicly accessible',
        },
      };
    }

    // Convert CSV to structured markdown-like text
    const structuredContent = convertCsvToStructuredText(csvText, sheetId);

    return {
      content: structuredContent.slice(0, CONTENT_CAP),
      attempt: {
        method, duration_ms: durationMs, chars_extracted: structuredContent.length, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: structuredContent.length >= MIN_CONTENT_CHARS ? 'pass' : 'partial',
        error_category: null, error_detail: null,
      },
    };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    return {
      content: null,
      attempt: {
        method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: isTimeout,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail',
        error_category: isTimeout ? 'timeout' : 'network',
        error_detail: isTimeout ? 'Timed out fetching Google Sheet' : (e as Error).message?.slice(0, 200),
      },
    };
  }
}

/** Convert raw CSV text into structured readable text preserving headers and rows */
function convertCsvToStructuredText(csvText: string, sheetId: string): string {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return '';

  const parts: string[] = [];
  parts.push(`# Google Spreadsheet\n`);
  parts.push(`**Source:** Google Sheets (ID: ${sheetId})`);
  parts.push(`**Rows:** ${lines.length}\n`);

  // Parse CSV lines — simple parser (handles quoted fields)
  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  // First row as headers
  const headers = parseRow(lines[0]);
  const nonEmptyHeaders = headers.filter(h => h.length > 0);

  if (nonEmptyHeaders.length > 0) {
    parts.push(`## Headers\n`);
    parts.push(`| ${headers.join(' | ')} |`);
    parts.push(`| ${headers.map(() => '---').join(' | ')} |`);

    // Data rows (cap at 500 rows for content size)
    const maxRows = Math.min(lines.length, 501);
    for (let i = 1; i < maxRows; i++) {
      const fields = parseRow(lines[i]);
      // Pad or trim to match header count
      while (fields.length < headers.length) fields.push('');
      parts.push(`| ${fields.slice(0, headers.length).join(' | ')} |`);
    }

    if (lines.length > 501) {
      parts.push(`\n*... ${lines.length - 501} additional rows truncated*`);
    }
  } else {
    // No clear headers — just dump as text
    parts.push(`## Content\n`);
    for (const line of lines.slice(0, 500)) {
      parts.push(line);
    }
  }

  return parts.join('\n');
}

// ── Google Doc helpers ──────────────────────────────────────
function extractGoogleDocId(url: string): string | null {
  const m = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i);
  return m?.[1] ?? null;
}

/** Export a public Google Doc as plain text */
async function googleDocExport(url: string, _apiKey: string): Promise<ExtractionResult> {
  const method = 'google_doc_export';
  const startMs = Date.now();

  try {
    const docId = extractGoogleDocId(url);
    if (!docId) {
      return {
        content: null,
        attempt: {
          method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: 0,
          validation_result: 'fail', error_category: 'extraction_error',
          error_detail: 'Could not extract Google Doc ID from URL',
        },
      };
    }

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
    const resp = await fetch(exportUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    });

    const durationMs = Date.now() - startMs;

    if (!resp.ok) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: resp.status === 401 || resp.status === 403,
          http_status: resp.status,
          validation_result: 'fail',
          error_category: resp.status === 401 || resp.status === 403 ? 'auth_failure' : 'extraction_error',
          error_detail: `Google Doc export returned HTTP ${resp.status}`,
        },
      };
    }

    const text = await resp.text();

    // Check for auth redirect
    if (text.includes('accounts.google.com') && text.includes('Sign in')) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: true, http_status: 200,
          validation_result: 'fail', error_category: 'auth_failure',
          error_detail: 'Google Doc requires sign-in — not publicly accessible',
        },
      };
    }

    const trimmed = text.trim();
    return {
      content: trimmed.slice(0, CONTENT_CAP),
      attempt: {
        method, duration_ms: durationMs, chars_extracted: trimmed.length, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: trimmed.length >= MIN_CONTENT_CHARS ? 'pass' : 'partial',
        error_category: null, error_detail: null,
      },
    };
  } catch (e) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: 0,
        validation_result: 'fail', error_category: 'extraction_error',
        error_detail: `Google Doc export error: ${(e as Error).message}`,
      },
    };
  }
}

// ── Google Drive helpers ────────────────────────────────────
function extractDriveFileId(url: string): string | null {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/open\?.*id=([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/i,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Attempt direct download from Google Drive using the uc?export=download endpoint */
async function googleDriveDirectDownload(url: string, _apiKey: string): Promise<ExtractionResult> {
  const method = 'google_drive_direct_download';
  const startMs = Date.now();

  const fileId = extractDriveFileId(url);
  if (!fileId) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail', error_category: 'parse_failure',
        error_detail: 'Could not extract file ID from Google Drive URL',
      },
    };
  }

  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  console.log(`[GoogleDrive] Attempting direct download: fileId=${fileId}`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(directUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnrichBot/1.0)' },
    });
    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (response.status === 401 || response.status === 403) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: true, http_status: response.status,
          validation_result: 'fail', error_category: 'auth_failure',
          error_detail: `Google Drive returned ${response.status} — file permissions block download`,
        },
      };
    }

    if (!response.ok) {
      return {
        content: null,
        attempt: {
          method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: response.status,
          validation_result: 'fail', error_category: `http_${response.status}`,
          error_detail: `Google Drive returned ${response.status}`,
        },
      };
    }

    // Check content type — if binary/non-text, try Google's export-as-text fallback
    const contentType = response.headers.get('content-type') || '';
    const isTextLike = /text|html|json|xml|csv|markdown|plain|pdf/i.test(contentType);

    if (!isTextLike) {
      // Binary file — try exporting via Google Docs viewer as plain text
      console.log(`[GoogleDrive] Binary content-type "${contentType}" — trying Docs export fallback for fileId=${fileId}`);
      try {
        // Google can open most office docs; export as txt via the Docs export URL
        const docsExportUrl = `https://docs.google.com/document/d/${fileId}/export?format=txt`;
        const docsResp = await fetch(docsExportUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'follow',
        });
        if (docsResp.ok) {
          const docsText = await docsResp.text();
          const trimmed = docsText.trim();
          if (trimmed.length >= MIN_CONTENT_CHARS && !trimmed.includes('accounts.google.com')) {
            return {
              content: trimmed.slice(0, CONTENT_CAP),
              attempt: {
                method: 'google_drive_docs_export', duration_ms: Date.now() - startMs,
                chars_extracted: trimmed.length, timeout_hit: false,
                auth_wall_detected: false, http_status: 200,
                validation_result: 'pass', error_category: null, error_detail: null,
              },
            };
          }
        }
      } catch (e) {
        console.log(`[GoogleDrive] Docs export fallback failed: ${(e as Error).message}`);
      }

      // If Docs export didn't work, try Firecrawl via the preview URL
      // Return failure so the method chain continues to the next strategy (firecrawlScrape)
      return {
        content: null,
        attempt: {
          method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: response.status,
          validation_result: 'fail', error_category: 'unsupported_file_type',
          error_detail: `File type "${contentType}" — direct download binary, falling through to scraper.`,
        },
      };
    }

    const text = await response.text();
    const durationFinal = Date.now() - startMs;

    // Check for Google's HTML "download anyway" confirmation page
    if (text.includes('Google Drive - Virus scan warning') || text.includes('uc?export=download&amp;confirm=')) {
      // Large file confirmation page — try to follow confirm link
      const confirmMatch = text.match(/confirm=([a-zA-Z0-9_-]+)/);
      if (confirmMatch) {
        const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
        try {
          const confirmResp = await fetch(confirmUrl, { redirect: 'follow' });
          if (confirmResp.ok) {
            const cType = confirmResp.headers.get('content-type') || '';
            if (/text|html|json|xml|csv|plain/i.test(cType)) {
              const confirmText = await confirmResp.text();
              return {
                content: confirmText.slice(0, CONTENT_CAP),
                attempt: {
                  method: 'google_drive_direct_download_confirmed', duration_ms: Date.now() - startMs,
                  chars_extracted: confirmText.length, timeout_hit: false,
                  auth_wall_detected: false, http_status: confirmResp.status,
                  validation_result: confirmText.length >= MIN_CONTENT_CHARS ? 'pass' : 'partial',
                  error_category: null, error_detail: null,
                },
              };
            }
          }
        } catch { /* fall through */ }
      }

      return {
        content: null,
        attempt: {
          method, duration_ms: durationFinal, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'large_file_confirmation',
          error_detail: 'Google Drive requires virus scan confirmation for large files. Upload the file manually.',
        },
      };
    }

    return {
      content: text.slice(0, CONTENT_CAP),
      attempt: {
        method, duration_ms: durationFinal, chars_extracted: text.length, timeout_hit: false,
        auth_wall_detected: false, http_status: response.status,
        validation_result: text.length >= MIN_CONTENT_CHARS ? 'pass' : 'partial',
        error_category: null, error_detail: null,
      },
    };
  } catch (e) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0,
        timeout_hit: String(e).includes('abort'), auth_wall_detected: false,
        http_status: null, validation_result: 'fail',
        error_category: 'fetch_failure', error_detail: String(e),
      },
    };
  }
}

/** Scrape Google Drive preview/viewer page via Firecrawl — works for PDFs, PPTX, DOCX rendered by Google */
async function googleDrivePreviewScrape(url: string, apiKey: string): Promise<ExtractionResult> {
  const method = 'google_drive_preview_scrape';
  const startMs = Date.now();

  const fileId = extractDriveFileId(url);
  if (!fileId) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
        auth_wall_detected: false, http_status: null,
        validation_result: 'fail', error_category: 'parse_failure',
        error_detail: 'Could not extract file ID for preview scrape',
      },
    };
  }

  // Google renders most uploaded docs via this preview URL
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  console.log(`[GoogleDrive] Attempting preview scrape via Firecrawl: ${previewUrl}`);

  try {
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: previewUrl,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 5000,
      }),
    });

    if (!scrapeRes.ok) {
      return {
        content: null,
        attempt: {
          method, duration_ms: Date.now() - startMs, chars_extracted: 0, timeout_hit: false,
          auth_wall_detected: scrapeRes.status === 403, http_status: scrapeRes.status,
          validation_result: 'fail', error_category: `http_${scrapeRes.status}`,
          error_detail: `Firecrawl returned ${scrapeRes.status} for Drive preview`,
        },
      };
    }

    const data = await scrapeRes.json();
    const markdown = (data.data?.markdown || data.markdown || '').trim();

    if (markdown.length < MIN_CONTENT_CHARS) {
      return {
        content: null,
        attempt: {
          method, duration_ms: Date.now() - startMs, chars_extracted: markdown.length, timeout_hit: false,
          auth_wall_detected: false, http_status: 200,
          validation_result: 'fail', error_category: 'content_too_short',
          error_detail: `Drive preview yielded only ${markdown.length} chars`,
        },
      };
    }

    return {
      content: markdown.slice(0, CONTENT_CAP),
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: markdown.length, timeout_hit: false,
        auth_wall_detected: false, http_status: 200,
        validation_result: markdown.length >= GOOD_CONTENT_CHARS ? 'pass' : 'partial',
        error_category: null, error_detail: null,
      },
    };
  } catch (e) {
    return {
      content: null,
      attempt: {
        method, duration_ms: Date.now() - startMs, chars_extracted: 0,
        timeout_hit: String(e).includes('abort'), auth_wall_detected: false,
        http_status: null, validation_result: 'fail',
        error_category: 'fetch_failure', error_detail: String(e),
      },
    };
  }
}

// ── Method chains per source type ──────────────────────────
function getMethodChain(source: SourceClassification): Array<(url: string, apiKey: string) => Promise<ExtractionResult>> {
  switch (source.source_type) {
    case 'webpage_static':
      return [firecrawlScrape, firecrawlFullPage];
    case 'webpage_js':
      return [firecrawlJsRendered, firecrawlFullPage, firecrawlScrape];
    case 'youtube':
      return [youtubeCaption, firecrawlScrape];
    case 'pdf':
      return [firecrawlScrape, firecrawlFullPage];
    case 'podcast':
      return [podcastResolveAndTranscribe, directAudioTranscribe, firecrawlScrape];
    case 'direct_audio':
      return [directAudioTranscribe];
    case 'zoom_recording':
      return [zoomRecordingExtract];
    case 'circle_page':
      return [circlePageExtract];
    case 'social':
      return [firecrawlScrape, firecrawlFullPage];
    case 'google_drive_file':
      return [googleDriveDirectDownload, googleDrivePreviewScrape, firecrawlScrape];
    case 'google_sheet':
      return [googleSheetExport, firecrawlScrape];
    case 'google_doc':
      return [googleDocExport, firecrawlScrape];
    case 'auth_gated':
    case 'notion':
      return []; // No methods — immediately classified
    default:
      return [firecrawlScrape];
  }
}

// ── Binary content detection ───────────────────────────────

/** Audio/video magic byte signatures — these are printable ASCII but indicate binary media files */
const MEDIA_MAGIC_PATTERNS = [
  /^ftyp/i,            // M4A, MP4, MOV — ISO Base Media format
  /^ID3/,              // MP3 with ID3 tag
  /^\xff[\xfb\xf3\xf2\xe3]/, // MP3 sync bytes (MPEG audio)
  /^RIFF/,             // WAV, AVI
  /^OggS/,             // OGG Vorbis/Opus
  /^fLaC/,             // FLAC
  /^\x1aE\xdf\xa3/,   // WebM/MKV (EBML)
  /^%PDF/,             // PDF (caught separately but guard)
];

function isBinaryContent(text: string): boolean {
  if (text.length < 50) return false;

  const sample = text.slice(0, 2048);

  // 1. Check for known media file magic bytes/signatures
  for (const pattern of MEDIA_MAGIC_PATTERNS) {
    if (pattern.test(sample)) return true;
  }

  // 2. Check for ISO Base Media File container anywhere in first 64 bytes
  //    (some files have a few bytes before 'ftyp')
  if (/ftyp(M4A|mp4[12]|isom|MSNV|avc1|dash)/i.test(sample.slice(0, 64))) return true;

  // 3. Check for MP3/audio container markers
  if (sample.includes('moov') && sample.includes('trak') && sample.includes('mdia')) return true;
  if (sample.includes('SoundHandler') || sample.includes('soun')) return true;

  // 4. Low printable ASCII ratio — expanded check (use 1KB sample)
  const checkSample = sample.slice(0, 1024);
  const controlCharCount = (checkSample.match(/[\x00-\x08\x0E-\x1F\x7F]/g) || []).length;
  const ratio = controlCharCount / checkSample.length;
  if (ratio > 0.03) return true;

  // 5. High proportion of null bytes indicates binary
  const nullCount = (checkSample.match(/\x00/g) || []).length;
  if (nullCount / checkSample.length > 0.02) return true;

  return false;
}

/** Detect if content is specifically audio/video binary (for routing to transcription) */
function isAudioBinaryContent(text: string): boolean {
  if (text.length < 50) return false;
  const sample = text.slice(0, 2048);

  // M4A / MP4 container
  if (/ftyp(M4A|mp4|isom)/i.test(sample.slice(0, 64))) return true;
  if (sample.includes('moov') && sample.includes('trak') && sample.includes('SoundHandler')) return true;

  // MP3
  if (/^ID3/.test(sample)) return true;

  // WAV
  if (/^RIFF/.test(sample) && sample.includes('WAVE')) return true;

  // OGG
  if (/^OggS/.test(sample)) return true;

  // FLAC
  if (/^fLaC/.test(sample)) return true;

  // Generic audio markers
  if (sample.includes('Audition Template') && sample.includes('track')) return true;
  if (sample.includes('Speech Volume Leveler')) return true;

  return false;
}

// ── Quality validation ─────────────────────────────────────
interface QualityValidation {
  score: number;
  tier: 'complete' | 'shallow' | 'incomplete' | 'failed';
  violations: string[];
  passes: boolean;
  missing_fields: string[];
  is_binary: boolean;
}

function validateContentQuality(content: string | null, sourceType?: SourceType): QualityValidation {
  const violations: string[] = [];
  const missingFields: string[] = [];
  const text = content || '';
  const len = text.length;
  let score = 0;
  const isSpreadsheet = sourceType === 'google_sheet';

  // Binary preflight — if binary, score is 0 and route to needs_transcript
  if (len > 0 && isBinaryContent(text)) {
    violations.push('binary_content_detected');
    return {
      score: 0, tier: 'failed', violations, passes: false,
      missing_fields: ['transcript'], is_binary: true,
    };
  }

  // Content depth (0-30)
  if (len === 0) {
    violations.push('No content extracted');
    missingFields.push('body_content');
  } else if (len < MIN_CONTENT_CHARS) {
    violations.push(`Content too short: ${len} chars (min ${MIN_CONTENT_CHARS})`);
    score += Math.round((len / MIN_CONTENT_CHARS) * 15);
  } else if (len < GOOD_CONTENT_CHARS) {
    score += 20;
  } else {
    score += 30;
  }

  // Structural (0-20)
  if (len > 0) {
    score += 10;
    if (isSpreadsheet) {
      // Spreadsheets get full structural credit for having table structure
      if (/\|.*\|/.test(text) || /,/.test(text)) score += 10;
      else score += 5;
    } else if (/^#{1,3}\s/m.test(text) || /\n\n/.test(text)) {
      score += 10;
    } else {
      score += 3;
    }
  }

  // Semantic usefulness (0-30)
  if (len > 0) {
    if (text.startsWith('[External Link:') || text.startsWith('[Placeholder')) {
      violations.push('Content is a placeholder stub');
      missingFields.push('real_content');
    } else if (isSpreadsheet) {
      // Spreadsheet-aware scoring: don't penalize tabular content
      // Count non-empty cells/fields as a proxy for useful data
      const dataLines = text.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('*'));
      if (dataLines.length >= 3) {
        score += 25; // Tabular data with 3+ rows of content is useful
      } else if (dataLines.length > 0) {
        score += 15;
      } else {
        score += 5;
      }
    } else {
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const boilerplateLines = lines.filter(line => BOILERPLATE_PATTERNS.some(p => p.test(line)));
      const boilerplateRatio = lines.length > 0 ? boilerplateLines.length / lines.length : 0;
      if (boilerplateRatio > 0.5) {
        violations.push(`High boilerplate: ${Math.round(boilerplateRatio * 100)}%`);
        score += 5;
      } else {
        score += 15;
      }

      const words = new Set(text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
      if (words.size < MIN_UNIQUE_WORDS) {
        violations.push(`Low vocabulary: ${words.size} unique words`);
        score += 3;
      } else {
        score += 15;
      }
    }
  }

  // Confidence (0-20)
  if (len >= MIN_CONTENT_CHARS) score += 10;
  if (len >= GOOD_CONTENT_CHARS) score += 10;
  else if (len > 0) score += 5;

  // Tier
  let tier: QualityValidation['tier'];
  if (score >= COMPLETE_MIN_SCORE && violations.length === 0) tier = 'complete';
  else if (score >= PARTIAL_MIN_SCORE) tier = 'shallow';
  else if (score >= 10) tier = 'incomplete';
  else tier = 'failed';

  return { score, tier, violations, passes: tier === 'complete', missing_fields: missingFields, is_binary: false };
}

// ── Normalized output contract ─────────────────────────────
type FinalStatus = 'enriched' | 'partial' | 'needs_auth' | 'unsupported' | 'failed';

interface EnrichmentOutput {
  resource_id: string;
  url: string;
  source_classification: SourceClassification;
  final_status: FinalStatus;
  method_used: string | null;
  methods_attempted: ExtractionAttempt[];
  attempt_count: number;
  extracted_text_length: number;
  completeness_score: number;
  confidence_score: number;
  missing_fields: string[];
  failure_reason: string | null;
  recovery_hint: string | null;
}

async function appendEnrichmentAuditEvent(
  supabase: any,
  resourceId: string,
  entry: Record<string, any>,
) {
  try {
    const { data: current } = await supabase
      .from("resources")
      .select("enrichment_audit_log")
      .eq("id", resourceId)
      .single();

    const existingLog = Array.isArray((current as any)?.enrichment_audit_log)
      ? (current as any).enrichment_audit_log
      : [];

    const auditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    await supabase
      .from("resources")
      .update({ enrichment_audit_log: [...existingLog.slice(-19), auditEntry] })
      .eq("id", resourceId);
  } catch (error) {
    console.warn(`[Audit] Failed to append enrichment audit for ${resourceId}: ${(error as Error).message}`);
  }
}

/** Update enrichment_status with audit trail */
async function setEnrichmentStatus(
  supabase: any,
  resourceId: string,
  status: string,
  extra: Record<string, any> = {},
) {
  const now = new Date().toISOString();
  const update: Record<string, any> = {
    enrichment_status: status,
    last_status_change_at: now,
    last_enrichment_attempt_at: now,
    ...extra,
  };

  if (status === 'deep_enriched') update.content_status = 'enriched';
  else if (status === 'deep_enrich_in_progress' || status === 'reenrich_in_progress') update.content_status = 'enriching';
  else if (status === 'partial') update.content_status = 'partial';
  else if (status === 'needs_auth') update.content_status = 'needs_auth';
  else if (status === 'unsupported') update.content_status = 'unsupported';
  else if (status === 'failed' || status === 'incomplete') update.content_status = 'placeholder';
  else if (status === 'not_enriched') update.content_status = 'placeholder';

  await supabase.from("resources").update(update).eq("id", resourceId);
}

// ── Main orchestrator ──────────────────────────────────────
async function orchestrateEnrichment(
  supabase: any,
  resource: any,
  apiKey: string,
  force: boolean,
): Promise<EnrichmentOutput> {
  const url = resource.file_url;
  const resourceId = resource.id;
  const attempts: ExtractionAttempt[] = [];

  // 1. Source classification (MANDATORY FIRST STEP)
  const source = classifySource(url || '');

  console.log(`[Orchestrate] START id=${resourceId} url=${url?.slice(0, 80)} source_type=${source.source_type} platform=${source.platform}`);

  // No URL
  if (!url || !url.startsWith("http")) {
    return {
      resource_id: resourceId, url: url || '', source_classification: source,
      final_status: 'unsupported', method_used: null, methods_attempted: [],
      attempt_count: 0, extracted_text_length: 0, completeness_score: 0,
      confidence_score: 0, missing_fields: ['source_url'],
      failure_reason: 'No valid source URL', recovery_hint: 'Add a valid HTTP URL to this resource',
    };
  }

  // Auth-gated — immediate classification
  if (source.auth_required) {
    await setEnrichmentStatus(supabase, resourceId, 'needs_auth', {
      failure_reason: `Auth-gated source (${source.platform}) — requires login to access content`,
      // Persist recovery state
      recovery_status: 'auth_gated_manual_action_required',
      recovery_reason: `Auth-gated: ${source.platform}`,
      next_best_action: 'paste_content',
      manual_input_required: true,
      recovery_queue_bucket: 'needs_input',
      access_type: 'auth_gated',
    });

    return {
      resource_id: resourceId, url, source_classification: source,
      final_status: 'needs_auth', method_used: null, methods_attempted: [],
      attempt_count: 0, extracted_text_length: 0, completeness_score: 0,
      confidence_score: 0, missing_fields: ['body_content'],
      failure_reason: `Auth-gated source (${source.platform})`,
      recovery_hint: `This content requires authentication on ${source.platform}. Paste the content manually or provide a public link.`,
    };
  }

  // Pre-check: If existing content is binary audio, clear it and reroute to transcription
  const existingContent = resource.content || '';
  if (existingContent.length > 0 && isBinaryContent(existingContent)) {
    const isAudio = isAudioBinaryContent(existingContent) ||
      source.source_type === 'podcast' || source.source_type === 'direct_audio';

    console.log(`[Orchestrate] BINARY PREFLIGHT: id=${resourceId} isAudio=${isAudio} — clearing binary content from DB`);

    // Clear the binary content from the resource immediately
    await supabase.from("resources").update({
      content: '',
      content_length: 0,
    }).eq("id", resourceId);

    if (isAudio) {
      // Override source classification to route through transcription
      if (source.source_type !== 'podcast' && source.source_type !== 'direct_audio') {
        console.log(`[Orchestrate] Reclassifying ${source.source_type} → podcast for audio binary content`);
        source.source_type = 'podcast' as SourceType;
        source.platform = 'Audio (reclassified from binary)';
      }
    }
  }

  // Skip already enriched unless forced — but NOT if we just detected binary
  const hasBinaryCleared = existingContent.length > 0 && isBinaryContent(existingContent);
  if (resource.enrichment_status === "deep_enriched" && !force && !hasBinaryCleared) {
    return {
      resource_id: resourceId, url, source_classification: source,
      final_status: 'enriched', method_used: 'already_enriched', methods_attempted: [],
      attempt_count: 0, extracted_text_length: resource.content_length || 0,
      completeness_score: 100, confidence_score: 100, missing_fields: [],
      failure_reason: null, recovery_hint: null,
    };
  }

  const isReenrich = force && resource.enrichment_status === "deep_enriched";
  const inProgressStatus = isReenrich ? "reenrich_in_progress" : "deep_enrich_in_progress";
  await setEnrichmentStatus(supabase, resourceId, inProgressStatus);

  // 2. Resolve wrapped audio URLs — use decoded direct URL for all method chain calls
  let effectiveUrl = url;
  const resolvedAudioUrl = extractEmbeddedAudioUrl(url);
  if (resolvedAudioUrl && source.source_type === 'direct_audio') {
    effectiveUrl = resolvedAudioUrl;
    console.log(`[Orchestrate] WRAPPED AUDIO RESOLVED: wrapper=${url.slice(0, 80)} → resolved=${resolvedAudioUrl.slice(0, 80)}`);

    // Persist resolution metadata on the resource
    await supabase.from("resources").update({
      content_classification: 'audio',
      extraction_method: 'direct_audio_asset',
      access_type: 'public',
      recovery_status: 'pending_transcription',
      recovery_reason: 'Anchor.fm wrapped audio URL — resolved to direct MP3',
      next_best_action: 'start_transcription',
      recovery_queue_bucket: 'auto_fixable',
      manual_input_required: false,
    }).eq("id", resourceId);
  }

  // 3. Execute method chain
  const methodChain = getMethodChain(source);

  if (methodChain.length === 0) {
    await setEnrichmentStatus(supabase, resourceId, 'unsupported', {
      failure_reason: `No extraction methods available for ${source.source_type}`,
    });
    return {
      resource_id: resourceId, url, source_classification: source,
      final_status: 'unsupported', method_used: null, methods_attempted: [],
      attempt_count: 0, extracted_text_length: 0, completeness_score: 0,
      confidence_score: 0, missing_fields: ['body_content'],
      failure_reason: `Source type "${source.source_type}" has no available extraction methods`,
      recovery_hint: 'Paste content manually or provide an alternative public URL',
    };
  }

  let bestContent: string | null = null;
  let bestQuality: QualityValidation | null = null;
  let bestMethod: string | null = null;

  for (const extractionMethod of methodChain) {
    console.log(`[Orchestrate] Trying method ${extractionMethod.name || 'anonymous'} for ${resourceId}`);

    const result = await extractionMethod(effectiveUrl, apiKey);
    attempts.push(result.attempt);

    // If auth wall detected, reclassify
    if (result.attempt.auth_wall_detected) {
      console.log(`[Orchestrate] Auth wall detected for ${resourceId} (source=${source.source_type})`);

      const isZoom = source.source_type === 'zoom_recording';
      const isCircle = source.source_type === 'circle_page';
      const circleFailureCategory = isCircle ? (result.attempt.error_category || 'circle_auth_required') : null;
      const circleAccessBlocked = circleFailureCategory === 'circle_access_blocked';
      const failureReason = isZoom
        ? `Zoom recording requires authentication — ${result.attempt.error_category || 'zoom_auth_required'}`
        : isCircle
        ? `Circle page requires authentication — ${circleFailureCategory}`
        : 'Login/signup wall detected during scraping';
      const recoveryReason = isZoom
        ? 'Zoom recording access blocked — requires login or shared link permissions'
        : isCircle
        ? (circleAccessBlocked
            ? 'Circle community page access blocked — provide access or upload an export'
            : `Circle community page requires manual recovery (${circleFailureCategory})`)
        : failureReason;
      const nextAction = isZoom
        ? 'provide_access'
        : isCircle
        ? (circleAccessBlocked ? 'provide_access' : 'paste_content')
        : 'paste_content';

      await setEnrichmentStatus(supabase, resourceId, 'needs_auth', {
        failure_reason: failureReason,
        recovery_status: 'auth_gated_manual_action_required',
        recovery_reason: recoveryReason,
        next_best_action: nextAction,
        manual_input_required: true,
        recovery_queue_bucket: 'needs_input',
        access_type: 'auth_gated',
        content_classification: isZoom ? 'video' : isCircle ? 'auth_gated' : null,
        extraction_method: isZoom ? 'zoom_recording_handler' : isCircle ? 'circle_handler' : null,
      });

      if (isCircle) {
        await appendEnrichmentAuditEvent(supabase, resourceId, {
          event: 'circle_resolution',
          source_type: 'circle_page',
          platform: 'Circle',
          circle_resolution_status: circleFailureCategory,
          app_shell_detected: circleFailureCategory === 'circle_auth_required' || circleFailureCategory === 'circle_shell_only',
          access_type: 'auth_gated',
          manual_input_required: true,
          next_best_action: nextAction,
          extraction_method: 'circle_handler',
        });
      }

      return {
        resource_id: resourceId, url, source_classification: { ...source, auth_required: true },
        final_status: 'needs_auth', method_used: result.attempt.method, methods_attempted: attempts,
        attempt_count: attempts.length, extracted_text_length: 0, completeness_score: 0,
        confidence_score: 0, missing_fields: ['body_content'],
        failure_reason: failureReason,
        recovery_hint: isZoom
          ? 'This Zoom recording requires authentication. Paste the transcript, provide a public share link, or upload the recording.'
          : isCircle
          ? (circleAccessBlocked
              ? 'This Circle page is access blocked. Provide access, upload an export, or paste the post body manually.'
              : 'This Circle post requires login. Paste the post body manually or provide an export.')
          : 'Paste the content manually or provide a public link',
      };
    }

    if (result.content && result.content.length > 0) {
      const qv = validateContentQuality(result.content, source.source_type);
      result.attempt.validation_result = qv.passes ? 'pass' : (qv.score >= PARTIAL_MIN_SCORE ? 'partial' : 'fail');

      // Binary content detected — do NOT store, route to needs_transcript
      if (qv.is_binary) {
        console.log(`[Orchestrate] BINARY CONTENT detected for ${resourceId} — routing to needs_transcript`);
        await setEnrichmentStatus(supabase, resourceId, 'needs_transcript', {
          failure_reason: 'Binary/audio data detected — needs transcript extraction',
          last_quality_score: 0,
          last_quality_tier: 'failed',
          recovery_status: 'pending_transcription',
          recovery_reason: 'Binary/audio content — transcript needed',
          next_best_action: 'start_transcription',
          manual_input_required: false,
          recovery_queue_bucket: 'auto_fixable',
          content_classification: 'audio',
        });
        return {
          resource_id: resourceId, url, source_classification: source,
          final_status: 'failed', method_used: result.attempt.method, methods_attempted: attempts,
          attempt_count: attempts.length, extracted_text_length: 0, completeness_score: 0,
          confidence_score: 0, missing_fields: ['transcript'],
          failure_reason: 'Binary content detected — not text. Needs transcript extraction.',
          recovery_hint: 'This resource contains audio/binary data. Route through transcription pipeline or paste transcript manually.',
        };
      }

      console.log(`[Orchestrate] Method ${result.attempt.method}: ${result.content.length} chars, score=${qv.score}, tier=${qv.tier}`);

      // If quality passes, we're done
      if (qv.passes) {
        bestContent = result.content;
        bestQuality = qv;
        bestMethod = result.attempt.method;
        break;
      }

      // Keep track of best partial result
      if (!bestQuality || qv.score > bestQuality.score) {
        bestContent = result.content;
        bestQuality = qv;
        bestMethod = result.attempt.method;
      }
    }

    // Brief delay between attempts
    if (methodChain.indexOf(extractionMethod) < methodChain.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 3. Evaluate best result
  if (bestContent && bestQuality && bestQuality.passes) {
    // ── ZERO-TEXT GUARDRAIL ──
    // Never mark deep_enriched if usable text is effectively zero
    const usableLength = bestContent.replace(/\s+/g, ' ').trim().length;
    if (usableLength < 50) {
      console.log(`[Orchestrate] GUARDRAIL: id=${resourceId} usable text only ${usableLength} chars — refusing to mark complete`);
      await setEnrichmentStatus(supabase, resourceId, 'incomplete', {
        failure_reason: `Extracted text too short (${usableLength} chars) — does not meet minimum threshold`,
        last_quality_score: bestQuality.score,
        last_quality_tier: 'failed',
        recovery_status: 'awaiting_user_content',
        recovery_reason: 'Extraction produced insufficient text',
        next_best_action: 'paste_content',
        manual_input_required: true,
        recovery_queue_bucket: 'needs_input',
      });
      return {
        resource_id: resourceId, url, source_classification: source,
        final_status: 'failed', method_used: bestMethod, methods_attempted: attempts,
        attempt_count: attempts.length, extracted_text_length: usableLength,
        completeness_score: bestQuality.score, confidence_score: 0,
        missing_fields: ['body_content'], failure_reason: `Usable text too short: ${usableLength} chars`,
        recovery_hint: 'Paste content manually — automatic extraction did not produce enough text',
      };
    }

    // FULL SUCCESS
    const isCircleSuccess = source.source_type === 'circle_page';
    await supabase.from("resources").update({ content: bestContent }).eq("id", resourceId);
    await setEnrichmentStatus(supabase, resourceId, "deep_enriched", {
      enriched_at: new Date().toISOString(),
      content_length: bestContent.length,
      enrichment_version: ENRICHMENT_VERSION,
      validation_version: VALIDATION_VERSION,
      failure_reason: null,
      last_quality_score: bestQuality.score,
      last_quality_tier: bestQuality.tier,
      // Clear recovery state on success
      recovery_status: 'resolved_complete',
      recovery_reason: null,
      next_best_action: null,
      manual_input_required: false,
      recovery_queue_bucket: null,
      last_recovery_error: null,
      extraction_method: bestMethod,
      access_type: isCircleSuccess ? 'public' : (source.auth_required ? 'auth_gated' : 'public'),
      content_classification: source.source_type === 'direct_audio' || source.source_type === 'podcast'
        ? 'audio'
        : source.source_type === 'zoom_recording'
        ? 'video'
        : null,
    });
    if (isCircleSuccess) {
      await appendEnrichmentAuditEvent(supabase, resourceId, {
        event: 'circle_resolution',
        source_type: 'circle_page',
        platform: 'Circle',
        circle_resolution_status: 'circle_content_extracted',
        app_shell_detected: false,
        access_type: 'public',
        manual_input_required: false,
        next_best_action: null,
        extraction_method: 'circle_handler',
      });
    }
    await supabase.from("resource_digests").delete().eq("resource_id", resourceId);

    console.log(`[Orchestrate] SUCCESS id=${resourceId} chars=${bestContent.length} method=${bestMethod} attempts=${attempts.length}`);
    return {
      resource_id: resourceId, url, source_classification: source,
      final_status: 'enriched', method_used: bestMethod, methods_attempted: attempts,
      attempt_count: attempts.length, extracted_text_length: bestContent.length,
      completeness_score: bestQuality.score, confidence_score: Math.min(100, bestQuality.score + 10),
      missing_fields: [], failure_reason: null, recovery_hint: null,
    };
  }

  if (bestContent && bestQuality && bestQuality.score >= PARTIAL_MIN_SCORE) {
    // PARTIAL — save content but don't mark as fully enriched
    await supabase.from("resources").update({ content: bestContent, content_length: bestContent.length }).eq("id", resourceId);

    const failureReason = bestQuality.violations.join('; ') || `Quality score ${bestQuality.score} below threshold ${COMPLETE_MIN_SCORE}`;
    const recoveryHint = bestQuality.violations.some(v => /short/i.test(v))
      ? 'Source page may have limited content — try adding content manually'
      : bestQuality.violations.some(v => /boilerplate/i.test(v))
      ? 'Extracted content is mostly navigation/boilerplate — try a different URL'
      : 'Content was partially extracted — review and supplement manually if needed';

    await setEnrichmentStatus(supabase, resourceId, 'partial', {
      failure_reason: failureReason,
      last_quality_score: bestQuality.score,
      last_quality_tier: bestQuality.tier,
      validation_version: VALIDATION_VERSION,
      content_length: bestContent.length,
      failure_count: (resource.failure_count || 0) + 1,
    });

    console.log(`[Orchestrate] PARTIAL id=${resourceId} score=${bestQuality.score} method=${bestMethod} attempts=${attempts.length}`);
    return {
      resource_id: resourceId, url, source_classification: source,
      final_status: 'partial', method_used: bestMethod, methods_attempted: attempts,
      attempt_count: attempts.length, extracted_text_length: bestContent.length,
      completeness_score: bestQuality.score, confidence_score: Math.round(bestQuality.score * 0.7),
      missing_fields: bestQuality.missing_fields, failure_reason: failureReason,
      recovery_hint: recoveryHint,
    };
  }

  // FAILED — no usable content from any method
  if (bestContent && bestContent.length > 0) {
    await supabase.from("resources").update({ content: bestContent, content_length: bestContent.length }).eq("id", resourceId);
  }

  const failureReasons = attempts.map(a => a.error_detail || a.error_category).filter(Boolean);
  const primaryReason = failureReasons[0] || 'All extraction methods failed to produce usable content';
  const timeoutCount = attempts.filter(a => a.timeout_hit).length;

  let recoveryHint = 'Paste content manually or try a different URL';
  if (timeoutCount === attempts.length) {
    recoveryHint = 'All attempts timed out — the source may be slow. Retry later or paste content manually';
  } else if (attempts.some(a => a.http_status === 403 || a.http_status === 401)) {
    recoveryHint = 'Source returned access denied — content may require authentication';
  }

  // On re-enrich failure, preserve the existing enriched state
  const newStatus = isReenrich ? resource.enrichment_status : 'failed';
  const isRetryable = timeoutCount > 0 || attempts.some(a => a.http_status && a.http_status >= 500);
  const isAudioSource = source.source_type === 'direct_audio' || source.source_type === 'podcast';
  const isZoomSource = source.source_type === 'zoom_recording';
  const isCircleSource = source.source_type === 'circle_page';

  const zoomFailureCategory = isZoomSource
    ? (attempts.find(a => a.error_category?.startsWith('zoom_'))?.error_category || 'zoom_transcript_not_found')
    : null;
  const isZoomAuthBlocked = isZoomSource && (
    zoomFailureCategory === 'zoom_auth_required' ||
    zoomFailureCategory === 'zoom_recording_access_blocked' ||
    attempts.some(a => a.auth_wall_detected)
  );
  const isZoomShell = isZoomSource && zoomFailureCategory === 'zoom_player_shell_only';

  const circleFailureCategory = isCircleSource
    ? (attempts.find(a => a.error_category?.startsWith('circle_'))?.error_category || 'circle_post_body_not_found')
    : null;
  const isCircleAuthBlocked = isCircleSource && (
    circleFailureCategory === 'circle_auth_required' ||
    circleFailureCategory === 'circle_access_blocked' ||
    attempts.some(a => a.auth_wall_detected)
  );
  const isCircleShell = isCircleSource && circleFailureCategory === 'circle_shell_only';

  const recoveryStatus = isZoomAuthBlocked ? 'auth_gated_manual_action_required'
    : isCircleAuthBlocked ? 'auth_gated_manual_action_required'
    : isZoomShell ? 'awaiting_user_content'
    : isZoomSource ? 'awaiting_user_content'
    : isCircleSource ? 'awaiting_user_content'
    : isAudioSource ? 'pending_transcription'
    : isRetryable ? 'failed_retryable'
    : 'awaiting_user_content';
  const recoveryAction = isZoomAuthBlocked ? 'provide_access'
    : isCircleAuthBlocked ? (circleFailureCategory === 'circle_access_blocked' ? 'provide_access' : 'paste_content')
    : isZoomShell ? 'paste_transcript'
    : isZoomSource ? 'paste_transcript'
    : isCircleSource ? (circleFailureCategory === 'circle_unsupported_page_type' ? 'upload_export' : 'paste_content')
    : isAudioSource ? 'start_transcription'
    : isRetryable ? 'queue_for_retry'
    : 'paste_content';
  const recoveryBucket = isZoomAuthBlocked ? 'needs_input'
    : isCircleSource ? 'needs_input'
    : isZoomSource ? 'needs_input'
    : isAudioSource ? 'auto_fixable'
    : isRetryable ? 'retryable'
    : 'needs_input';

  const zoomRecoveryReason = isZoomAuthBlocked ? `Zoom recording requires authentication to access (${zoomFailureCategory})`
    : isZoomShell ? 'Zoom player shell only — no transcript or media found. Paste transcript manually or provide download.'
    : isZoomSource ? `Zoom recording extraction failed: ${zoomFailureCategory} — paste transcript or provide recording download`
    : null;
  const circleRecoveryReason = isCircleAuthBlocked ? `Circle page requires authentication to access (${circleFailureCategory})`
    : isCircleShell ? 'Circle app shell only — no usable post body found. Paste content manually or provide access/export.'
    : isCircleSource ? `Circle extraction failed: ${circleFailureCategory} — paste content, provide access, or upload an export`
    : null;

  await setEnrichmentStatus(supabase, resourceId, newStatus, {
    failure_reason: primaryReason,
    last_quality_score: bestQuality?.score || 0,
    last_quality_tier: bestQuality?.tier || 'failed',
    validation_version: VALIDATION_VERSION,
    failure_count: (resource.failure_count || 0) + 1,
    // Persist recovery state
    recovery_status: recoveryStatus,
    recovery_reason: circleRecoveryReason || zoomRecoveryReason || (isAudioSource ? `Audio transcription failed: ${primaryReason}` : primaryReason),
    next_best_action: recoveryAction,
    manual_input_required: isZoomSource || isCircleSource || (!isAudioSource && !isRetryable),
    recovery_queue_bucket: recoveryBucket,
    last_recovery_error: primaryReason,
    access_type: isZoomAuthBlocked ? 'auth_gated' : isCircleAuthBlocked ? 'auth_gated' : isCircleSource ? 'unknown' : (attempts.some(a => a.http_status === 403 || a.http_status === 401) ? 'auth_gated' : 'public'),
    content_classification: isAudioSource ? 'audio' : isZoomSource ? 'video' : isCircleSource ? 'auth_gated' : null,
    extraction_method: isZoomSource ? 'zoom_recording_handler' : isCircleSource ? 'circle_handler' : null,
  });

  if (isCircleSource) {
    await appendEnrichmentAuditEvent(supabase, resourceId, {
      event: 'circle_resolution',
      source_type: 'circle_page',
      platform: 'Circle',
      circle_resolution_status: circleFailureCategory,
      app_shell_detected: isCircleShell || isCircleAuthBlocked,
      access_type: isCircleAuthBlocked ? 'auth_gated' : 'unknown',
      manual_input_required: true,
      next_best_action: recoveryAction,
      extraction_method: 'circle_handler',
    });
  }

  console.log(`[Orchestrate] FAILED id=${resourceId} reason=${primaryReason} attempts=${attempts.length}`);
  return {
    resource_id: resourceId, url, source_classification: source,
    final_status: 'failed', method_used: bestMethod, methods_attempted: attempts,
    attempt_count: attempts.length, extracted_text_length: bestContent?.length || 0,
    completeness_score: bestQuality?.score || 0, confidence_score: 0,
    missing_fields: bestQuality?.missing_fields || ['body_content'],
    failure_reason: primaryReason, recovery_hint: recoveryHint,
  };
}

// ── HTTP handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Firecrawl not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { resource_id, batch, limit, force, resource_ids } = body;

    // ── Batch-by-IDs mode ──
    if (resource_ids && Array.isArray(resource_ids) && resource_ids.length > 0) {
      const { data: resources, error: qErr } = await supabase
        .from("resources")
        .select("id, file_url, content, enrichment_status, content_status, failure_count, content_length")
        .in("id", resource_ids.slice(0, 50));

      if (qErr) throw new Error("Query failed");

      const results: EnrichmentOutput[] = [];
      for (const resource of resources || []) {
        const result = await orchestrateEnrichment(supabase, resource, FIRECRAWL_API_KEY, !!force);
        results.push(result);
        await new Promise(r => setTimeout(r, 1000));
      }

      // Build trust gate summary
      const summary = {
        total: results.length,
        enriched: results.filter(r => r.final_status === 'enriched').length,
        partial: results.filter(r => r.final_status === 'partial').length,
        needs_auth: results.filter(r => r.final_status === 'needs_auth').length,
        unsupported: results.filter(r => r.final_status === 'unsupported').length,
        failed: results.filter(r => r.final_status === 'failed').length,
        fallback_rate: results.filter(r => r.attempt_count > 1).length / Math.max(results.length, 1),
        avg_attempts: results.reduce((s, r) => s + r.attempt_count, 0) / Math.max(results.length, 1),
      };

      return new Response(JSON.stringify({ success: true, results, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Single mode ──
    if (resource_id && !batch) {
      const { data: resource, error: rErr } = await supabase
        .from("resources")
        .select("id, file_url, content, enrichment_status, content_status, failure_count, content_length")
        .eq("id", resource_id)
        .single();
      if (rErr || !resource) throw new Error("Resource not found");

      const result = await orchestrateEnrichment(supabase, resource, FIRECRAWL_API_KEY, !!force);

      if (result.final_status === 'enriched') {
        return new Response(JSON.stringify({
          success: true, ...result,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Non-success statuses
      return new Response(JSON.stringify({
        error: result.failure_reason || result.final_status,
        ...result,
        skipped: result.final_status === 'needs_auth' || result.final_status === 'unsupported',
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Batch mode (all eligible) ──
    if (batch) {
      const batchLimit = Math.min(limit || 50, 50);
      const { data: placeholders, error: qErr } = await supabase
        .from("resources")
        .select("id, file_url, content, enrichment_status, failure_count, content_length")
        .in("enrichment_status", ["not_enriched", "incomplete", "partial", "failed"])
        .like("file_url", "http%")
        .limit(batchLimit);

      if (qErr) throw new Error("Query failed");

      const results: EnrichmentOutput[] = [];
      for (const resource of placeholders || []) {
        const result = await orchestrateEnrichment(supabase, resource, FIRECRAWL_API_KEY, false);
        results.push(result);
        await new Promise(r => setTimeout(r, 1000));
      }

      const summary = {
        total: results.length,
        enriched: results.filter(r => r.final_status === 'enriched').length,
        partial: results.filter(r => r.final_status === 'partial').length,
        needs_auth: results.filter(r => r.final_status === 'needs_auth').length,
        unsupported: results.filter(r => r.final_status === 'unsupported').length,
        failed: results.filter(r => r.final_status === 'failed').length,
        fallback_rate: results.filter(r => r.attempt_count > 1).length / Math.max(results.length, 1),
        avg_attempts: results.reduce((s, r) => s + r.attempt_count, 0) / Math.max(results.length, 1),
      };

      return new Response(JSON.stringify({ success: true, results, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Provide resource_id, resource_ids, or batch: true" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("enrich-resource-content error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
