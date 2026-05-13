/**
 * import-circle-browserless
 *
 * Server-side Circle.so importer using Browserless (Playwright in the cloud).
 *
 * Flow:
 *   1. Verify caller JWT, load their stored Circle session cookie from
 *      `circle_credentials`.
 *   2. POST a Playwright script to Browserless `/function` that:
 *        a) Sets `_circle_session` cookie for *.circle.so
 *        b) Loads the curriculum URL, collects every lesson link
 *        c) For each lesson: navigate, expand "Show transcript", collect
 *           title, body text, transcript, video iframe src, resource links
 *      and returns the harvested array as JSON.
 *   3. POST the normalized payload to `import-course-capture`, which already
 *      handles dedupe / classification / saving.
 *
 * The user-facing UI never has to deal with the bookmarklet for this path.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-trace-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BodySchema = z.object({
  course_url: z.string().url(),
  /** Optional override; otherwise we read the stored cookie. */
  session_cookie: z.string().min(10).optional(),
  /** Optional debug-only — return the harvested array without saving. */
  dry_run: z.boolean().optional(),
});

function extractCookieValue(raw: string | undefined, preferredName = '_circle_session'): string | undefined {
  const input = (raw || '').trim();
  if (!input) return undefined;
  const cleaned = input.replace(/^cookie:\s*/i, '').trim();
  const parts = cleaned.split(';').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name === preferredName || name === '_circle_session') return value;
  }
  return cleaned;
}

// ── Playwright script that runs inside Browserless ─────────────────────────────
// IMPORTANT: This runs inside Browserless's Node + Playwright sandbox. It must
// be self-contained — no closures, no outer references — and return JSON.
// `context` is whatever we pass under `{ context: {...} }`.
const PLAYWRIGHT_SCRIPT = `
export default async function ({ page, context }) {
  const { courseUrl, sessionCookie, cookieName, platformEmail, platformPassword } = context;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. Set the session cookie for *.circle.so so we appear logged in.
  // Browserless /function runs Puppeteer — use page.setCookie.
  const u = new URL(courseUrl);
  const debug = [];
  const log = (m) => { debug.push(m); };

  if (sessionCookie) {
    const cookieDomains = Array.from(new Set([u.hostname, '.' + u.hostname, '.circle.so']));
    for (const domain of cookieDomains) {
      try {
        await page.setCookie({
          name: cookieName || '_circle_session',
          value: sessionCookie,
          domain,
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        });
        log('set session cookie for domain ' + domain);
      } catch (e) {
        log('cookie set skipped for ' + domain + ': ' + (e && e.message));
      }
    }
  }

  const isLoginPage = async () => page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    return /login\.circle\.so|\/sign_in/.test(location.href) ||
      text.includes('log in to your account') || text.includes('sign in with an email');
  });

  const tryPasswordLogin = async () => {
    if (!platformEmail || !platformPassword) {
      log('password login fallback unavailable (missing credentials)');
      return false;
    }
    try {
      log('attempting Circle password login fallback');
      await page.goto('https://login.circle.so/sign_in?request_host=' + encodeURIComponent(u.hostname) + '#email', { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(1200);
      await page.evaluate(() => {
        const clickByText = (patterns) => {
          const els = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
          for (const el of els) {
            const text = (el.textContent || '').trim().toLowerCase();
            if (patterns.some((p) => text.includes(p))) { try { el.click(); return true; } catch {} }
          }
          return false;
        };
        clickByText(['sign in with an email', 'continue with email', 'email']);
      });
      await sleep(800);

      const emailFilled = await page.evaluate((email) => {
        const input = document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
        if (!input) return false;
        input.focus();
        input.value = email;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, platformEmail);
      log('email field found: ' + emailFilled);
      if (!emailFilled) return false;
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        const btn = btns.find((b) => /continue|next|sign in|log in/i.test(b.textContent || b.value || '')) || btns[0];
        try { btn && btn.click(); } catch {}
      });
      await sleep(1800);

      const passwordFilled = await page.evaluate((password) => {
        const input = document.querySelector('input[type="password"], input[name*="password" i], input[id*="password" i]');
        if (!input) return false;
        input.focus();
        input.value = password;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, platformPassword);
      log('password field found: ' + passwordFilled);
      if (!passwordFilled) return false;
      await Promise.allSettled([
        page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          const btn = btns.find((b) => /sign in|log in|continue|submit/i.test(b.textContent || b.value || '')) || btns[0];
          try { btn && btn.click(); } catch {}
        }),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      ]);
      await sleep(1500);
      await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(2000);
      const stillLogin = await isLoginPage();
      log('password login fallback result: ' + (stillLogin ? 'still_login' : 'authenticated'));
      return !stillLogin;
    } catch (e) {
      log('password login fallback failed: ' + (e && e.message));
      return false;
    }
  };

  // 2. Load the curriculum page.
  log('navigating to ' + courseUrl);
  await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);

  if (await isLoginPage()) {
    log('login page detected after cookie navigation');
    await tryPasswordLogin();
  }

  const pageInfo = await page.evaluate(() => ({
    finalUrl: location.href,
    title: document.title,
    h1: (document.querySelector('h1')?.textContent || '').trim(),
    bodyLen: (document.body?.innerText || '').length,
    htmlSample: (document.body?.innerText || '').slice(0, 400),
    anchorCount: document.querySelectorAll('a').length,
    hrefSamples: Array.from(document.querySelectorAll('a')).slice(0, 25).map(a => a.getAttribute('href') || ''),
    hasLoginForm: !!document.querySelector('form[action*="sign_in"], input[name="user[password]"], input[name="member[password]"]'),
  }));
  log('final url: ' + pageInfo.finalUrl);
  log('page title: ' + pageInfo.title);
  log('h1: ' + pageInfo.h1);
  log('anchor count: ' + pageInfo.anchorCount);
  log('login form present: ' + pageInfo.hasLoginForm);
  log('href samples: ' + JSON.stringify(pageInfo.hrefSamples));
  log('body sample: ' + pageInfo.htmlSample.replace(/\\s+/g, ' '));

  const courseTitle = pageInfo.h1 || pageInfo.title || 'Circle Course';

  // 3. Collect every lesson link.
  const lessonLinks = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/lessons/"]'));
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      let abs;
      try { abs = new URL(href, location.href).toString(); } catch { continue; }
      if (!/\\/lessons\\//.test(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ url: abs, title: (a.textContent || '').trim().slice(0, 300) });
    }
    return out;
  });
  log('found ' + lessonLinks.length + ' lesson links');

  const sectionLinks = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/sections/"]'));
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      let abs;
      try { abs = new URL(href, location.href).toString(); } catch { continue; }
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    }
    return out;
  });

  const lessonMap = new Map();
  for (const l of lessonLinks) lessonMap.set(l.url, l);
  for (const sUrl of sectionLinks.slice(0, 30)) {
    try {
      await page.goto(sUrl, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(800);
      const more = await page.evaluate(() => {
        const out = [];
        const anchors = Array.from(document.querySelectorAll('a[href*="/lessons/"]'));
        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) continue;
          let abs;
          try { abs = new URL(href, location.href).toString(); } catch { continue; }
          out.push({ url: abs, title: (a.textContent || '').trim().slice(0, 300) });
        }
        return out;
      });
      for (const m of more) if (!lessonMap.has(m.url)) lessonMap.set(m.url, m);
    } catch (e) {
      log('section fetch failed ' + sUrl + ': ' + (e && e.message));
    }
  }

  const allLessons = Array.from(lessonMap.values());
  log('total unique lessons: ' + allLessons.length);

  // 4. Visit each lesson.
  const harvested = [];
  let idx = 0;
  for (const L of allLessons) {
    idx++;
    try {
      await page.goto(L.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(1200);

      // Click "Show transcript" / "Show more" toggles by scanning text.
      try {
        await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('button, a'));
          for (const t of all) {
            const txt = ((t.textContent) || '').trim().toLowerCase();
            if (txt === 'show transcript' || txt === 'transcript' || txt === 'view transcript' ||
                txt === 'show more' || txt === 'read more') {
              try { t.click(); } catch {}
            }
          }
        });
        await sleep(600);
      } catch (e) { /* noop */ }

      const data = await page.evaluate(() => {
        const titleEl = document.querySelector('h1, [class*="lesson-title"], [class*="LessonTitle"]');
        const title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || document.title;

        const crumb = document.querySelector('[class*="breadcrumb"], nav[aria-label*="breadcrumb" i]');
        const moduleText = crumb ? (crumb.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200) : '';

        const candidates = [
          document.querySelector('[class*="lesson-content"]'),
          document.querySelector('[class*="LessonContent"]'),
          document.querySelector('article'),
          document.querySelector('main'),
        ].filter(Boolean);
        let bodyText = '';
        if (candidates.length) {
          const node = candidates[0];
          const clone = node.cloneNode(true);
          clone.querySelectorAll('button, nav, header, footer, [class*="comments" i]').forEach((n) => n.remove());
          bodyText = (clone.innerText || clone.textContent || '').trim();
        }

        let transcript = '';
        const all = Array.from(document.querySelectorAll('div, section, article'));
        for (const el of all) {
          const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
          const cls = (el.className || '').toString().toLowerCase();
          if (lbl.includes('transcript') || cls.includes('transcript')) {
            const t = (el.innerText || el.textContent || '').trim();
            if (t.length > transcript.length) transcript = t;
          }
        }

        const iframe = document.querySelector('iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="wistia"], iframe[src*="loom"], video source, video');
        let mediaUrl = '';
        if (iframe) {
          mediaUrl = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
        }

        const resources = [];
        const seen = new Set();
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          if (!href) continue;
          let abs;
          try { abs = new URL(href, location.href).toString(); } catch { continue; }
          if (seen.has(abs)) continue;
          const lower = abs.toLowerCase();
          let type = null;
          if (/\\.pdf(\\?|$)/.test(lower)) type = 'pdf';
          else if (/\\.(docx?|rtf)(\\?|$)/.test(lower)) type = 'doc';
          else if (/\\.(xlsx?|csv)(\\?|$)/.test(lower)) type = 'sheet';
          else if (/\\.(pptx?|key)(\\?|$)/.test(lower)) type = 'slide';
          else if (/docs\\.google\\.com\\/document/.test(lower)) type = 'doc';
          else if (/docs\\.google\\.com\\/spreadsheets/.test(lower)) type = 'sheet';
          else if (/docs\\.google\\.com\\/presentation/.test(lower)) type = 'slide';
          else if (/drive\\.google\\.com|dropbox\\.com|notion\\.so|loom\\.com/.test(lower)) type = 'link';
          if (!type) continue;
          seen.add(abs);
          resources.push({
            title: (a.textContent || '').trim().slice(0, 300) || abs,
            url: abs,
            type,
            source_section: 'lesson_body',
          });
        }

        return { title, moduleText, bodyText, transcript, mediaUrl, resources };
      });

      harvested.push({
        url: L.url,
        title: (data.title || L.title || 'Lesson').slice(0, 500),
        module: data.moduleText || undefined,
        lesson_number: idx,
        total_lessons: allLessons.length,
        body_text: data.bodyText || undefined,
        media_url: data.mediaUrl || undefined,
        transcript: data.transcript || undefined,
        resources: data.resources || [],
      });
      log('lesson ' + idx + '/' + allLessons.length + ' OK (body=' + (data.bodyText || '').length + ' tx=' + (data.transcript || '').length + ' res=' + (data.resources || []).length + ')');
    } catch (e) {
      log('lesson fail ' + L.url + ': ' + (e && e.message));
      harvested.push({
        url: L.url,
        title: L.title || 'Lesson',
        capture_issue: 'fetch_failed',
      });
    }
  }

  return {
    data: { courseTitle, lessons: harvested, debug },
    type: 'application/json',
  };
}
`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json({ success: false, error: 'POST required' }, 405);
  }

  // ── Auth ──
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const browserlessKey = Deno.env.get('BROWSERLESS_API_KEY');
  if (!browserlessKey) {
    return json({ success: false, error: 'BROWSERLESS_API_KEY not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = userData.user.id;

  // ── Parse body ──
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ success: false, error: 'Invalid payload', issues: parsed.error.flatten() }, 400);
  }
  const { course_url, session_cookie, dry_run } = parsed.data;

  // ── Look up cookie if not supplied ──
  let cookieValue = extractCookieValue(session_cookie);
  let cookieName = '_circle_session';
  if (!cookieValue) {
    const { data: cred, error: credErr } = await supabase
      .from('circle_credentials')
      .select('session_cookie, cookie_name')
      .eq('user_id', userId)
      .maybeSingle();
    if (credErr) {
      return json({ success: false, error: 'Failed to load Circle credentials' }, 500);
    }
    if (!cred?.session_cookie) {
      return json({
        success: false,
        error: 'No Circle session cookie on file. Save your `_circle_session` cookie under Settings → Sales Brain → Circle, or pass session_cookie in the request.',
        code: 'no_credentials',
      }, 400);
    }
    cookieName = cred.cookie_name || '_circle_session';
    cookieValue = extractCookieValue(cred.session_cookie, cookieName);
    cookieName = cred.cookie_name || '_circle_session';
  }
  const platformEmail = Deno.env.get('COURSE_PLATFORM_EMAIL') || '';
  const platformPassword = Deno.env.get('COURSE_PLATFORM_PASSWORD') || '';

  // ── Call Browserless ──
  const blUrl = `https://production-sfo.browserless.io/function?token=${encodeURIComponent(browserlessKey)}`;
  let blResp: Response;
  try {
    blResp = await fetch(blUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: PLAYWRIGHT_SCRIPT,
        context: { courseUrl: course_url, sessionCookie: cookieValue, cookieName, platformEmail, platformPassword },
      }),
    });
  } catch (e) {
    return json({ success: false, error: 'Browserless call failed: ' + (e as Error).message }, 502);
  }

  if (!blResp.ok) {
    const text = await blResp.text().catch(() => '');
    return json({
      success: false,
      error: `Browserless ${blResp.status}: ${text.slice(0, 500)}`,
    }, 502);
  }

  let blPayload: any;
  try { blPayload = await blResp.json(); } catch (e) {
    return json({ success: false, error: 'Browserless returned non-JSON' }, 502);
  }

  // Browserless `/function` wraps our return in `data` (we returned `{ data, type }`).
  // Newer responses pass through `data` directly; older may nest. Handle both.
  const harvest = blPayload?.lessons ? blPayload : blPayload?.data ?? blPayload;
  const lessons: any[] = Array.isArray(harvest?.lessons) ? harvest.lessons : [];
  const courseTitle: string = harvest?.courseTitle || 'Circle Course';

  if (lessons.length === 0) {
    const debugArr: string[] = harvest?.debug || [];
    const redirectedToLogin = debugArr.some((d) => /login\.circle\.so|\/sign_in/i.test(d));
    return json({
      success: false,
      error: redirectedToLogin
        ? 'Circle authentication failed. The saved cookie did not open the course, and the password fallback could not complete login. Re-save a fresh `_circle_session` value from a logged-in Circle tab, or use the bookmarklet/manual capture path.'
        : 'No lessons captured. Check that the URL is the course or curriculum page.',
      code: redirectedToLogin ? 'cookie_expired' : 'no_lessons',
      debug: debugArr,
    }, 422);
  }

  // ── Update last_used_at ──
  await supabase
    .from('circle_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (dry_run) {
    return json({ success: true, dry_run: true, courseTitle, lessons, debug: harvest?.debug || [] });
  }

  // ── Hand off to existing capture pipeline ──
  const captureResp = await fetch(`${supabaseUrl}/functions/v1/import-course-capture`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      apikey: supabaseAnon,
    },
    body: JSON.stringify({
      mode: 'capture',
      capture_mode: 'browserless',
      platform: 'circle',
      source_url: course_url,
      title: courseTitle,
      lessons: lessons.map((l) => ({
        url: l.url,
        title: (l.title || 'Lesson').slice(0, 500),
        module: l.module,
        lesson_number: l.lesson_number,
        total_lessons: l.total_lessons,
        body_text: l.body_text,
        media_url: l.media_url,
        transcript: l.transcript,
        resources: l.resources,
        capture_issue: l.capture_issue,
      })),
    }),
  });

  const captureJson = await captureResp.json().catch(() => ({}));
  if (!captureResp.ok || !captureJson?.success) {
    return json({
      success: false,
      error: captureJson?.error || 'Capture pipeline rejected payload',
      capture: captureJson,
      debug: harvest?.debug || [],
    }, 502);
  }

  return json({
    success: true,
    courseTitle,
    captured: lessons.length,
    capture: captureJson,
    debug: harvest?.debug || [],
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
