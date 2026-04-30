/**
 * Circle (circle.so) course/community importer.
 *
 * Circle hosts courses and communities under <community>.circle.so or custom
 * domains. Unauthenticated requests redirect to:
 *   https://login.circle.so/sign_in?request_host=<community-host>
 *
 * The login UI is a fully client-rendered React/Turbo app behind Cloudflare bot
 * management (`__cf_bm`). Reliable headless login + curriculum scraping is not
 * feasible from a stateless edge function, so this module:
 *
 *   1. Detects Circle URLs (or generic URLs that redirect to login.circle.so).
 *   2. Best-effort attempt to sign in via the Circle JSON API
 *      (`POST https://app.circle.so/api/v1/sign_in`) using a shared cookie jar
 *      across login.circle.so AND the community host.
 *   3. If sign-in succeeds, fetch the course page and extract curriculum
 *      links from embedded JSON / lesson anchors.
 *   4. Otherwise return explicit, classified errors (auth_wall, mfa, captcha,
 *      sso_only, invalid_credentials, blocked_bot) — never silent
 *      "no lessons found".
 *
 * The smallest safe contract: same response envelope as the Kajabi/Thinkific
 * importer (see index.ts) so CourseImportModal does not need a fork.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── Cookie jar (duplicated tiny helper to avoid coupling) ────────────────────

interface SimpleJar {
  cookies: Map<string, string>;
  addFromHeaders(headers: Headers): void;
  toString(): string;
}

function createJar(): SimpleJar {
  const cookies = new Map<string, string>();
  return {
    cookies,
    addFromHeaders(headers: Headers) {
      let setCookieHeaders: string[] = [];
      try {
        setCookieHeaders = headers.getSetCookie?.() || [];
      } catch { /* fall through */ }
      if (setCookieHeaders.length === 0) {
        headers.forEach((value, key) => {
          if (key.toLowerCase() === 'set-cookie') setCookieHeaders.push(value);
        });
      }
      for (const sc of setCookieHeaders) {
        const nameValue = sc.split(';')[0];
        const eq = nameValue.indexOf('=');
        if (eq <= 0) continue;
        const name = nameValue.substring(0, eq).trim();
        const value = nameValue.substring(eq + 1).trim();
        const lower = name.toLowerCase();
        if (['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly'].includes(lower)) continue;
        cookies.set(name, value);
      }
    },
    toString() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns true if the URL is hosted on Circle (circle.so subdomain) OR if a
 * HEAD/GET probe shows it redirecting to login.circle.so. The static check is
 * synchronous; callers can use `probeRedirectsToCircle` for the dynamic case.
 */
export function isCircleUrl(input: string): boolean {
  try {
    const u = new URL(input);
    if (/(^|\.)circle\.so$/i.test(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Probe a non-Circle hostname to see if it redirects to login.circle.so —
 * indicates a custom-domain Circle community.
 */
export async function probeRedirectsToCircle(url: string, debug: string[]): Promise<{ isCircle: boolean; finalUrl: string; communityHost?: string }> {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
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

// ── Login ────────────────────────────────────────────────────────────────────

export type CircleAuthFailure =
  | 'no_credentials'
  | 'invalid_credentials'
  | 'mfa_required'
  | 'captcha_required'
  | 'sso_only'
  | 'blocked_bot'
  | 'auth_wall'
  | 'unknown';

export interface CircleLoginResult {
  success: boolean;
  failure?: CircleAuthFailure;
  failureMessage?: string;
  debug: string[];
  jar: SimpleJar;
  communityHost: string;
}

/**
 * Attempt to authenticate against Circle for a given community host.
 *
 * Strategy:
 *   1. Prime cookies on community host (acquires `_circle_session`, ahoy_*).
 *   2. Prime cookies on login.circle.so/sign_in?request_host=<host>.
 *   3. POST credentials to https://app.circle.so/api/v1/sign_in (JSON).
 *   4. Inspect response — classify common failure modes.
 */
export async function circleLogin(
  communityHost: string,
  creds: { email?: string; password?: string } | undefined,
): Promise<CircleLoginResult> {
  const debug: string[] = [];
  const jar = createJar();

  const email = creds?.email || Deno.env.get('COURSE_PLATFORM_EMAIL');
  const password = creds?.password || Deno.env.get('COURSE_PLATFORM_PASSWORD');

  if (!email || !password) {
    return {
      success: false,
      failure: 'no_credentials',
      failureMessage: 'Circle login required — please enter your Circle email and password.',
      debug,
      jar,
      communityHost,
    };
  }

  try {
    // Step 1: prime community-host cookies
    const primeUrl = `https://${communityHost}/`;
    const primeResp = await fetch(primeUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      redirect: 'follow',
    });
    jar.addFromHeaders(primeResp.headers);
    await primeResp.body?.cancel().catch(() => {});
    debug.push(`[Circle Login] prime community ${primeUrl} → ${primeResp.status}, cookies=${jar.cookies.size}`);

    // Step 2: prime login.circle.so cookies
    const loginPrimeUrl = `https://login.circle.so/sign_in?request_host=${encodeURIComponent(communityHost)}`;
    const loginPrimeResp = await fetch(loginPrimeUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Cookie': jar.toString() },
    });
    jar.addFromHeaders(loginPrimeResp.headers);
    const loginPrimeHtml = await loginPrimeResp.text();
    debug.push(`[Circle Login] prime login page → ${loginPrimeResp.status}, cookies=${jar.cookies.size}, html=${loginPrimeHtml.length} chars`);

    // Detect explicit blockers in the login page HTML
    if (/cf-challenge|just a moment\.\.\./i.test(loginPrimeHtml)) {
      return { success: false, failure: 'blocked_bot', failureMessage: 'Circle login page is behind a Cloudflare bot challenge. Automated import is blocked — please paste lesson content manually.', debug, jar, communityHost };
    }

    // Step 3: POST to Circle JSON sign-in API
    // Circle's app.circle.so/api/v1/sign_in accepts JSON {email,password,request_host}
    const apiUrl = `https://app.circle.so/api/v1/sign_in`;
    const signInResp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://login.circle.so',
        'Referer': loginPrimeUrl,
        'Cookie': jar.toString(),
      },
      body: JSON.stringify({
        email,
        password,
        request_host: communityHost,
      }),
      redirect: 'manual',
    });
    jar.addFromHeaders(signInResp.headers);
    const signInBody = await signInResp.text();
    debug.push(`[Circle Login] POST ${apiUrl} → ${signInResp.status}, cookies=${jar.cookies.size}, body=${signInBody.slice(0, 300)}`);

    // Classify response
    if (signInResp.status === 200 || signInResp.status === 201 || signInResp.status === 302) {
      // Try to confirm by visiting the community host root
      const verifyResp = await fetch(`https://${communityHost}/`, {
        headers: { 'User-Agent': UA, 'Cookie': jar.toString() },
        redirect: 'follow',
      });
      jar.addFromHeaders(verifyResp.headers);
      const finalUrl = verifyResp.url;
      await verifyResp.body?.cancel().catch(() => {});
      debug.push(`[Circle Login] verify → ${verifyResp.status} ${finalUrl}`);
      if (/login\.circle\.so|\/users\/sign_in/i.test(finalUrl)) {
        return { success: false, failure: 'auth_wall', failureMessage: 'Circle accepted credentials but session did not stick (auth wall). Try again or paste lesson content manually.', debug, jar, communityHost };
      }
      return { success: true, debug, jar, communityHost };
    }

    if (signInResp.status === 401 || signInResp.status === 403) {
      let parsed: any = null;
      try { parsed = JSON.parse(signInBody); } catch { /* ignore */ }
      const msg = (parsed?.error || parsed?.message || signInBody || '').toString().toLowerCase();
      if (/mfa|two[-_ ]?factor|otp|verification code/i.test(msg)) {
        return { success: false, failure: 'mfa_required', failureMessage: 'Circle account requires MFA / 2FA — automated import cannot proceed. Please paste lesson content manually.', debug, jar, communityHost };
      }
      if (/captcha|recaptcha|challenge/i.test(msg)) {
        return { success: false, failure: 'captcha_required', failureMessage: 'Circle login is behind a captcha — automated import is blocked. Please paste lesson content manually.', debug, jar, communityHost };
      }
      if (/sso|saml|oauth|google|single.?sign.?on/i.test(msg)) {
        return { success: false, failure: 'sso_only', failureMessage: 'This Circle community uses SSO — automated email/password login is blocked. Please paste lesson content manually.', debug, jar, communityHost };
      }
      return { success: false, failure: 'invalid_credentials', failureMessage: 'Invalid Circle email or password.', debug, jar, communityHost };
    }

    if (signInResp.status === 429 || signInResp.status === 503) {
      return { success: false, failure: 'blocked_bot', failureMessage: `Circle rate-limited or blocked the request (HTTP ${signInResp.status}).`, debug, jar, communityHost };
    }

    return { success: false, failure: 'unknown', failureMessage: `Circle login failed: HTTP ${signInResp.status}`, debug, jar, communityHost };
  } catch (err) {
    debug.push(`[Circle Login] exception: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, failure: 'unknown', failureMessage: err instanceof Error ? err.message : String(err), debug, jar, communityHost };
  }
}

// ── Curriculum discovery ─────────────────────────────────────────────────────

export interface CircleLessonLink {
  url: string;
  title: string;
  module?: string;
}

/**
 * Extract lesson/module links from a Circle course page. Circle renders
 * curriculum in two ways:
 *   - Server-side anchors with `/c/<course>/` and `/lessons/` segments.
 *   - Embedded JSON inside <script id="__NEXT_DATA__"> or
 *     `window.__INITIAL_STATE__ = {...}` blobs.
 *
 * We try anchors first (cheap), then JSON blobs (resilient to client-render).
 */
export function extractCircleLessons(html: string, baseUrl: string, debug: string[]): CircleLessonLink[] {
  const lessons: CircleLessonLink[] = [];
  const seen = new Set<string>();
  const base = new URL(baseUrl);

  const pushLink = (rawHref: string, title: string, module?: string) => {
    if (!rawHref) return;
    let absolute: string;
    try { absolute = new URL(rawHref, base).toString(); } catch { return; }
    // Only keep same-host links pointing into a course/lesson
    const u = new URL(absolute);
    if (u.hostname !== base.hostname) return;
    if (!/\/c\/[^/]+\/(lessons|sections|modules)\/|\/lessons\/|\/posts\/[^/]+\/?$/i.test(u.pathname)) return;
    if (seen.has(absolute)) return;
    seen.add(absolute);
    lessons.push({ url: absolute, title: title.trim() || absolute, module });
  };

  // 1. Anchor scan
  const anchorRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    pushLink(href, text);
  }
  debug.push(`[Circle Curriculum] anchor scan → ${lessons.length} candidates`);

  // 2. Embedded JSON: __NEXT_DATA__ or initial state
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const json = JSON.parse(nextDataMatch[1]);
      walkJsonForLessons(json, pushLink, debug);
    } catch (err) {
      debug.push(`[Circle Curriculum] __NEXT_DATA__ parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
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

function walkJsonForLessons(node: unknown, push: (href: string, title: string, module?: string) => void, debug: string[]) {
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
    // Heuristic: nodes with both a slug/url and a name/title
    const url = (obj.url || obj.slug_url || obj.permalink || obj.path || obj.public_url) as string | undefined;
    const title = (obj.name || obj.title || obj.lesson_name) as string | undefined;
    if (typeof url === 'string' && typeof title === 'string') {
      push(url, title);
    }
    for (const k of Object.keys(obj)) stack.push(obj[k]);
  }
  debug.push(`[Circle Curriculum] JSON walk visited ${visited} nodes`);
}

// ── Discover & fetch ─────────────────────────────────────────────────────────

export interface CircleDiscoverResult {
  success: boolean;
  platform: 'circle';
  title: string;
  lessons: CircleLessonLink[];
  auth_failed?: boolean;
  failure?: CircleAuthFailure | 'no_lessons';
  failure_message?: string;
  debug: string[];
  meta: {
    initial_url: string;
    final_url: string;
    reached_login_circle: boolean;
    auth_status: 'authenticated' | 'auth_failed' | 'no_credentials';
    lessons_discovered: number;
    community_host: string;
  };
}

export async function discoverCircleCourse(
  courseUrl: string,
  creds?: { email?: string; password?: string },
): Promise<CircleDiscoverResult> {
  const debug: string[] = [];
  const initialUrl = courseUrl;
  let parsed: URL;
  try { parsed = new URL(courseUrl); } catch {
    return emptyResult(courseUrl, 'unknown', 'Invalid URL', debug, '');
  }

  debug.push(`[Circle] platform=circle initial_url=${initialUrl}`);

  // Resolve the community host: either *.circle.so directly, or a custom
  // domain that redirects to login.circle.so.
  let communityHost = parsed.hostname;
  let reachedLoginCircle = false;
  let finalUrl = initialUrl;

  if (!/circle\.so$/i.test(parsed.hostname)) {
    const probe = await probeRedirectsToCircle(courseUrl, debug);
    finalUrl = probe.finalUrl;
    if (probe.isCircle) {
      reachedLoginCircle = true;
      communityHost = probe.communityHost || parsed.hostname;
    } else {
      // Caller should not have routed us here — treat as not Circle.
      return {
        success: false,
        platform: 'circle',
        title: 'Not Circle',
        lessons: [],
        failure: 'unknown',
        failure_message: 'URL does not appear to be a Circle community',
        debug,
        meta: {
          initial_url: initialUrl,
          final_url: finalUrl,
          reached_login_circle: false,
          auth_status: 'auth_failed',
          lessons_discovered: 0,
          community_host: communityHost,
        },
      };
    }
  }

  debug.push(`[Circle] community_host=${communityHost}`);

  // Authenticate
  const login = await circleLogin(communityHost, creds);
  debug.push(...login.debug);
  if (!login.success) {
    return {
      success: false,
      platform: 'circle',
      title: 'Circle Authentication Required',
      lessons: [],
      auth_failed: true,
      failure: login.failure,
      failure_message: login.failureMessage,
      debug,
      meta: {
        initial_url: initialUrl,
        final_url: finalUrl,
        reached_login_circle: true,
        auth_status: login.failure === 'no_credentials' ? 'no_credentials' : 'auth_failed',
        lessons_discovered: 0,
        community_host: communityHost,
      },
    };
  }

  // Fetch course page with authenticated cookies
  const courseResp = await fetch(courseUrl, {
    headers: { 'User-Agent': UA, 'Cookie': login.jar.toString(), 'Accept': 'text/html' },
    redirect: 'follow',
  });
  login.jar.addFromHeaders(courseResp.headers);
  const courseHtml = await courseResp.text();
  finalUrl = courseResp.url;
  debug.push(`[Circle] course fetch → ${courseResp.status} ${finalUrl} (${courseHtml.length} chars)`);

  if (/login\.circle\.so|\/users\/sign_in/i.test(finalUrl)) {
    return {
      success: false,
      platform: 'circle',
      title: 'Circle Authentication Required',
      lessons: [],
      auth_failed: true,
      failure: 'auth_wall',
      failure_message: 'Circle redirected to login after authentication — session did not persist.',
      debug,
      meta: {
        initial_url: initialUrl,
        final_url: finalUrl,
        reached_login_circle: true,
        auth_status: 'auth_failed',
        lessons_discovered: 0,
        community_host: communityHost,
      },
    };
  }

  // Extract title
  const titleMatch = courseHtml.match(/<title>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] || 'Untitled Circle Course').replace(/\s+/g, ' ').trim();

  const lessons = extractCircleLessons(courseHtml, finalUrl, debug);
  if (lessons.length > 0) {
    debug.push(`[Circle] sample lessons: ${lessons.slice(0, 3).map(l => l.url).join(', ')}`);
  }

  return {
    success: true,
    platform: 'circle',
    title,
    lessons,
    failure: lessons.length === 0 ? 'no_lessons' : undefined,
    failure_message: lessons.length === 0
      ? 'Circle authentication succeeded but no curriculum links were found on this page. Try opening the course and pasting the URL from inside a lesson.'
      : undefined,
    debug,
    meta: {
      initial_url: initialUrl,
      final_url: finalUrl,
      reached_login_circle: true,
      auth_status: 'authenticated',
      lessons_discovered: lessons.length,
      community_host: communityHost,
    },
  };
}

function emptyResult(initialUrl: string, host: string, msg: string, debug: string[], finalUrl: string): CircleDiscoverResult {
  return {
    success: false,
    platform: 'circle',
    title: 'Circle',
    lessons: [],
    failure: 'unknown',
    failure_message: msg,
    debug,
    meta: {
      initial_url: initialUrl,
      final_url: finalUrl,
      reached_login_circle: false,
      auth_status: 'auth_failed',
      lessons_discovered: 0,
      community_host: host,
    },
  };
}

// ── Lesson fetch ─────────────────────────────────────────────────────────────

export interface CircleLessonContent {
  success: boolean;
  title: string;
  content: string;
  media_url?: string;
  transcript_source?: string;
  quality: {
    content_length: number;
    cleaned_text_length: number;
    word_count: number;
    content_type: 'text' | 'video_only' | 'login_page' | 'empty' | 'mixed';
    has_login_wall: boolean;
    usable_content: boolean;
    issues: string[];
  };
  debug: string[];
}

export async function fetchCircleLesson(
  courseUrl: string,
  lessonUrl: string,
  creds?: { email?: string; password?: string },
): Promise<CircleLessonContent> {
  const debug: string[] = [];
  const parsed = new URL(courseUrl);
  const communityHost = /circle\.so$/i.test(parsed.hostname)
    ? parsed.hostname
    : (await probeRedirectsToCircle(courseUrl, debug)).communityHost || parsed.hostname;

  const login = await circleLogin(communityHost, creds);
  debug.push(...login.debug);

  if (!login.success) {
    return {
      success: false,
      title: 'Circle Authentication Required',
      content: '',
      quality: {
        content_length: 0,
        cleaned_text_length: 0,
        word_count: 0,
        content_type: 'login_page',
        has_login_wall: true,
        usable_content: false,
        issues: [login.failureMessage || 'Circle authentication failed'],
      },
      debug,
    };
  }

  const resp = await fetch(lessonUrl, {
    headers: { 'User-Agent': UA, 'Cookie': login.jar.toString(), 'Accept': 'text/html' },
    redirect: 'follow',
  });
  const html = await resp.text();
  const finalUrl = resp.url;
  debug.push(`[Circle Lesson] ${lessonUrl} → ${resp.status} ${finalUrl} (${html.length} chars)`);

  if (/login\.circle\.so|\/users\/sign_in/i.test(finalUrl)) {
    return {
      success: false,
      title: 'Circle Authentication Required',
      content: '',
      quality: {
        content_length: 0,
        cleaned_text_length: 0,
        word_count: 0,
        content_type: 'login_page',
        has_login_wall: true,
        usable_content: false,
        issues: ['Lesson page redirected to Circle login'],
      },
      debug,
    };
  }

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = (titleMatch?.[1] || 'Untitled Circle Lesson').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  // Strip scripts/styles, then extract text
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = cleaned.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  // Detect embedded video (Wistia/Vimeo/YouTube/Loom)
  const videoMatch = html.match(/(?:wistia|vimeo|youtube|youtu\.be|loom\.com)[^"' \s]*/i);
  const mediaUrl = videoMatch ? videoMatch[0] : undefined;

  const wordCount = text.split(/\s+/).filter(w => w.length > 2).length;
  const contentType: CircleLessonContent['quality']['content_type'] =
    text.length === 0 ? 'empty'
      : (text.length < 100 && mediaUrl) ? 'video_only'
        : (mediaUrl && wordCount > 20) ? 'mixed'
          : 'text';

  return {
    success: true,
    title,
    content: text,
    media_url: mediaUrl,
    quality: {
      content_length: text.length,
      cleaned_text_length: text.length,
      word_count: wordCount,
      content_type: contentType,
      has_login_wall: false,
      usable_content: contentType !== 'empty' && contentType !== 'login_page' && wordCount >= 5,
      issues: [],
    },
    debug,
  };
}
