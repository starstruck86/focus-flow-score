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

// ── Playwright script that runs inside Browserless ─────────────────────────────
// IMPORTANT: This runs inside Browserless's Node + Playwright sandbox. It must
// be self-contained — no closures, no outer references — and return JSON.
// `context` is whatever we pass under `{ context: {...} }`.
const PLAYWRIGHT_SCRIPT = `
export default async function ({ page, browser, context }) {
  const { courseUrl, sessionCookie, cookieName } = context;

  // 1. Set the session cookie for *.circle.so so we appear logged in.
  // Browserless wraps page; use browser.contexts()[0] to access the BrowserContext.
  const u = new URL(courseUrl);
  const ctx = (browser && browser.contexts && browser.contexts()[0]) || (page.context && page.context());
  await ctx.addCookies([{
    name: cookieName || '_circle_session',
    value: sessionCookie,
    domain: u.hostname,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }]);

  const debug = [];
  const log = (m) => { debug.push(m); };

  // 2. Load the curriculum page.
  log('navigating to ' + courseUrl);
  await page.goto(courseUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  const courseTitle = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return (h1 && h1.textContent && h1.textContent.trim()) || document.title || 'Circle Course';
  });

  // 3. Collect every lesson link on the curriculum/section pages.
  // Circle URL shape: /c/<community>/.../lessons/<id>
  const lessonLinks = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/lessons/"]'));
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const abs = new URL(href, location.href).toString();
      if (!/\\/lessons\\//.test(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ url: abs, title: (a.textContent || '').trim().slice(0, 300) });
    }
    return out;
  });
  log('found ' + lessonLinks.length + ' lesson links');

  // Also walk any visible "Section" sublinks; sections often expand into more
  // lesson links once visited.
  const sectionLinks = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/sections/"]'));
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const abs = new URL(href, location.href).toString();
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    }
    return out;
  });

  // Visit each section to gather lessons that aren't on the root page.
  const lessonMap = new Map();
  for (const l of lessonLinks) lessonMap.set(l.url, l);
  for (const sUrl of sectionLinks.slice(0, 30)) {
    try {
      await page.goto(sUrl, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(800);
      const more = await page.evaluate(() => {
        const out = [];
        const anchors = Array.from(document.querySelectorAll('a[href*="/lessons/"]'));
        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) continue;
          const abs = new URL(href, location.href).toString();
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

  // 4. Visit each lesson; harvest title, body, transcript, video, resources.
  const harvested = [];
  let idx = 0;
  for (const L of allLessons) {
    idx++;
    try {
      await page.goto(L.url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1200);

      // Click any "Show transcript" / "Transcript" toggles so the text is in DOM.
      try {
        const toggles = await page.$$('button, a');
        for (const t of toggles) {
          const txt = ((await t.textContent()) || '').trim().toLowerCase();
          if (/^(show |view |open )?transcript$/.test(txt) || txt === 'show transcript') {
            await t.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(400);
          }
        }
      } catch (e) { /* noop */ }
      // Expand any collapsed "Resources" / "Show more" toggles too.
      try {
        const more = await page.$$('button:has-text("Show more"), button:has-text("Read more")');
        for (const m of more) await m.click({ timeout: 1500 }).catch(() => {});
      } catch (e) {}

      const data = await page.evaluate(() => {
        const titleEl = document.querySelector('h1, [class*="lesson-title"], [class*="LessonTitle"]');
        const title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || document.title;

        // Module / section breadcrumb
        const crumb = document.querySelector('[class*="breadcrumb"], nav[aria-label*="breadcrumb" i]');
        const moduleText = crumb ? (crumb.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200) : '';

        // Body text — try the main lesson container, fallback to <article> / <main>.
        const candidates = [
          document.querySelector('[class*="lesson-content"]'),
          document.querySelector('[class*="LessonContent"]'),
          document.querySelector('article'),
          document.querySelector('main'),
        ].filter(Boolean);
        let bodyText = '';
        if (candidates.length) {
          // Use innerText (renders linebreaks); strip nav/ui buttons.
          const node = candidates[0];
          const clone = node.cloneNode(true);
          clone.querySelectorAll('button, nav, header, footer, [class*="comments" i]').forEach((n) => n.remove());
          bodyText = (clone.innerText || clone.textContent || '').trim();
        }

        // Transcript — Circle renders into a region after the toggle; look for
        // headings / divs labeled "Transcript".
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

        // Video iframe
        const iframe = document.querySelector('iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="wistia"], iframe[src*="loom"], video source, video');
        let mediaUrl = '';
        if (iframe) {
          mediaUrl = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
        }

        // Resource links — PDFs, docs, sheets, slides, generic downloads.
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
  let cookieValue = session_cookie;
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
    cookieValue = cred.session_cookie;
    cookieName = cred.cookie_name || '_circle_session';
  }

  // ── Call Browserless ──
  const blUrl = `https://production-sfo.browserless.io/function?token=${encodeURIComponent(browserlessKey)}`;
  let blResp: Response;
  try {
    blResp = await fetch(blUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: PLAYWRIGHT_SCRIPT,
        context: { courseUrl: course_url, sessionCookie: cookieValue, cookieName },
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
    return json({
      success: false,
      error: 'No lessons captured. Check that the cookie is valid and the URL is the course or curriculum page.',
      debug: harvest?.debug || [],
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
