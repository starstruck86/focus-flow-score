/**
 * Circle.so detection + lesson-extraction helpers.
 *
 * SERVER-SIDE LOGIN IS NOT SUPPORTED. Circle's auth flow is React-rendered,
 * Cloudflare-protected (`__cf_bm`), and frequently fronted by MFA / SSO /
 * captcha. A stateless edge function cannot replay a real browser session.
 *
 * Instead, this module:
 *   1. Detects Circle URLs (static + redirect probe).
 *   2. Returns a `needs_browser_capture` envelope that drives the client UI to
 *      use the bookmarklet / manual-paste path (see public/circle-capture.js
 *      and supabase/functions/import-course-capture).
 *   3. Exposes `extractCircleLessons` for offline tests and any future
 *      best-effort use against publicly-served HTML.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── Detection ────────────────────────────────────────────────────────────────

/** True if the URL is hosted on a circle.so subdomain. */
export function isCircleUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return /(^|\.)circle\.so$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Probe a non-circle.so hostname to see if it redirects to login.circle.so —
 * indicates a custom-domain Circle community (e.g. learning.outboundsquad.com).
 */
export async function probeRedirectsToCircle(
  url: string,
  debug: string[],
): Promise<{ isCircle: boolean; finalUrl: string; communityHost?: string }> {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    const finalUrl = resp.url;
    await resp.body?.cancel().catch(() => {});
    debug.push(`[Circle Probe] ${url} → ${finalUrl}`);
    if (/login\.circle\.so/i.test(finalUrl)) {
      const params = new URL(finalUrl).searchParams;
      const host = params.get('request_host') || undefined;
      return { isCircle: true, finalUrl, communityHost: host };
    }
    return { isCircle: false, finalUrl };
  } catch (err) {
    debug.push(`[Circle Probe] error: ${err instanceof Error ? err.message : String(err)}`);
    return { isCircle: false, finalUrl: url };
  }
}

// ── Curriculum extraction (offline, best-effort) ─────────────────────────────

export interface CircleLessonLink {
  url: string;
  title: string;
  module?: string;
}

/**
 * Extract lesson/module links from Circle HTML. Used by offline tests and as
 * a fallback when (rarely) Circle serves curriculum in static markup. Real
 * imports go through the bookmarklet-driven `import-course-capture` path.
 */
export function extractCircleLessons(
  html: string,
  baseUrl: string,
  debug: string[],
): CircleLessonLink[] {
  const lessons: CircleLessonLink[] = [];
  const seen = new Set<string>();
  const base = new URL(baseUrl);

  const pushLink = (rawHref: string, title: string, module?: string) => {
    if (!rawHref) return;
    let absolute: string;
    try { absolute = new URL(rawHref, base).toString(); } catch { return; }
    const u = new URL(absolute);
    if (u.hostname !== base.hostname) return;
    if (!/\/c\/[^/]+\/(lessons|sections|modules)\/|\/lessons\/|\/posts\/[^/]+\/?$/i.test(u.pathname)) return;
    if (seen.has(absolute)) return;
    seen.add(absolute);
    lessons.push({ url: absolute, title: title.trim() || absolute, module });
  };

  // Anchor scan
  const anchorRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    pushLink(href, text);
  }
  debug.push(`[Circle Curriculum] anchor scan → ${lessons.length} candidates`);

  // __NEXT_DATA__ — match real Next.js tag (id + type, either order)
  const nextDataRe =
    /<script\b(?=[^>]*\bid="__NEXT_DATA__")(?=[^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/i;
  const nextDataMatch = html.match(nextDataRe);
  if (nextDataMatch) {
    try {
      const json = JSON.parse(nextDataMatch[1]);
      walkJsonForLessons(json, pushLink, debug);
    } catch (err) {
      debug.push(`[Circle Curriculum] __NEXT_DATA__ parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // window.__INITIAL_STATE__
  const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (initialStateMatch) {
    try {
      const json = JSON.parse(initialStateMatch[1]);
      walkJsonForLessons(json, pushLink, debug);
    } catch (err) {
      debug.push(`[Circle Curriculum] __INITIAL_STATE__ parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  debug.push(`[Circle Curriculum] total → ${lessons.length} unique lesson links`);
  return lessons;
}

function walkJsonForLessons(
  node: unknown,
  push: (href: string, title: string, module?: string) => void,
  debug: string[],
) {
  const stack: unknown[] = [node];
  let visited = 0;
  while (stack.length) {
    const cur = stack.pop();
    visited++;
    if (visited > 50_000) break;
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    const obj = cur as Record<string, unknown>;
    const url = (obj.url || obj.slug_url || obj.permalink || obj.path || obj.public_url) as string | undefined;
    const title = (obj.name || obj.title || obj.lesson_name) as string | undefined;
    if (typeof url === 'string' && typeof title === 'string') {
      push(url, title);
    }
    for (const k of Object.keys(obj)) stack.push(obj[k]);
  }
  debug.push(`[Circle Curriculum] JSON walk visited ${visited} nodes`);
}

// ── Browser-assisted capture envelope ────────────────────────────────────────

export interface CircleCaptureHint {
  bookmarklet_url: string;
  capture_endpoint: string;
  instructions: string[];
}

export interface CircleDiscoverResult {
  success: false;
  platform: 'circle';
  title: string;
  lessons: [];
  needs_browser_capture: true;
  capture_hint: CircleCaptureHint;
  parser_failure: true;
  parser_failure_reason: string;
  failure_type: 'needs_browser_capture';
  debug: string[];
  meta: {
    initial_url: string;
    final_url: string;
    reached_login_circle: boolean;
    auth_status: 'needs_browser_capture';
    lessons_discovered: 0;
    community_host: string;
  };
}

/**
 * Build a `needs_browser_capture` response. Intentionally never attempts auth.
 * The `appOrigin` arg is the Lovable app origin used to build the bookmarklet
 * link and capture endpoint; falls back to relative paths if unknown.
 */
export async function discoverCircleCourse(
  courseUrl: string,
  appOrigin?: string,
): Promise<CircleDiscoverResult> {
  const debug: string[] = [];
  const initialUrl = courseUrl;
  let parsed: URL;
  try { parsed = new URL(courseUrl); } catch {
    return buildNeedsCapture(courseUrl, courseUrl, parsed!?.hostname || 'unknown', false, appOrigin, debug, 'Invalid URL');
  }

  debug.push(`[Circle] platform=circle initial_url=${initialUrl}`);

  let communityHost = parsed.hostname;
  let reachedLoginCircle = false;
  let finalUrl = initialUrl;

  if (!/circle\.so$/i.test(parsed.hostname)) {
    const probe = await probeRedirectsToCircle(courseUrl, debug);
    finalUrl = probe.finalUrl;
    if (probe.isCircle) {
      reachedLoginCircle = true;
      communityHost = probe.communityHost || parsed.hostname;
    }
    // If probe says not Circle, we still treat as Circle here because the
    // caller already routed us in via static detection or earlier probing.
  } else {
    reachedLoginCircle = true;
  }

  debug.push(`[Circle] community_host=${communityHost} reached_login_circle=${reachedLoginCircle}`);

  return buildNeedsCapture(initialUrl, finalUrl, communityHost, reachedLoginCircle, appOrigin, debug);
}

function buildNeedsCapture(
  initialUrl: string,
  finalUrl: string,
  communityHost: string,
  reachedLoginCircle: boolean,
  appOrigin: string | undefined,
  debug: string[],
  reasonOverride?: string,
): CircleDiscoverResult {
  const origin = appOrigin?.replace(/\/$/, '') || '';
  const bookmarklet_url = `${origin}/circle-capture.js`;
  const capture_endpoint = `${origin}/functions/v1/import-course-capture`;
  const reason =
    reasonOverride ||
    'Circle requires browser-assisted import. Run the bookmarklet on a Circle course page where you are already signed in, or use the manual paste fallback.';

  return {
    success: false,
    platform: 'circle',
    title: 'Circle Authentication Required',
    lessons: [],
    needs_browser_capture: true,
    capture_hint: {
      bookmarklet_url,
      capture_endpoint,
      instructions: [
        'Open the Circle course in another tab where you are already signed in.',
        'Drag the “Import Circle Course” bookmarklet to your bookmarks bar (or copy it from the modal).',
        'Click the bookmarklet on the course page; it will capture lessons and POST them back to your app.',
        'If your browser blocks the POST, the bookmarklet will copy a JSON payload to your clipboard — paste it into the modal’s “Paste captured JSON” box.',
      ],
    },
    parser_failure: true,
    parser_failure_reason: reason,
    failure_type: 'needs_browser_capture',
    debug,
    meta: {
      initial_url: initialUrl,
      final_url: finalUrl,
      reached_login_circle: reachedLoginCircle,
      auth_status: 'needs_browser_capture',
      lessons_discovered: 0,
      community_host: communityHost,
    },
  };
}
