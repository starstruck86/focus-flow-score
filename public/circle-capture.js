/**
 * Circle Course Capture Bookmarklet
 * --------------------------------------------------------------------------
 * Runs INSIDE the user's already-authenticated Circle browser tab. Walks the
 * live DOM + embedded JSON to extract the course curriculum, then either:
 *   1. POSTs the payload to /functions/v1/import-course-capture using the
 *      user's Lovable Supabase auth token (read from localStorage), OR
 *   2. Falls back to copying the JSON payload to the clipboard so the user
 *      can paste it into the import modal.
 *
 * The hosting page (CircleImportPanel) injects two query params into the
 * loader URL so this script knows where to POST and what token namespace to
 * read:
 *   ?endpoint=<absolute-url-to-import-course-capture>
 *   &project=<supabase-project-ref>            (optional)
 *
 * If neither query param is present, the script falls back to clipboard mode.
 *
 * NOTE: This file is loaded via a `javascript:` bookmarklet that does:
 *   javascript:(function(){var s=document.createElement('script');
 *     s.src='https://<app>/circle-capture.js?endpoint=...';
 *     document.body.appendChild(s);})();
 * so it runs in the Circle page's origin and can read its DOM + cookies.
 */
(function () {
  'use strict';

  // ── Read loader-injected config from the <script> tag's URL ───────────────
  const currentScript =
    document.currentScript ||
    Array.from(document.scripts).reverse().find(s => /circle-capture\.js/.test(s.src || ''));
  const scriptSrc = currentScript ? currentScript.src : '';
  let endpoint = '';
  let projectRef = '';
  try {
    const u = new URL(scriptSrc);
    endpoint = u.searchParams.get('endpoint') || '';
    projectRef = u.searchParams.get('project') || '';
  } catch (_) { /* ignore */ }

  const log = (...args) => { try { console.log('[Circle Capture]', ...args); } catch (_) {} };
  const banner = (msg, kind) => showBanner(msg, kind);

  log('starting; endpoint=', endpoint, 'project=', projectRef);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function safeText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function abs(url) {
    try { return new URL(url, location.href).toString(); } catch (_) { return ''; }
  }

  function readNextData() {
    const tag = document.querySelector('script#__NEXT_DATA__[type="application/json"]');
    if (!tag) return null;
    try { return JSON.parse(tag.textContent || '{}'); } catch (_) { return null; }
  }

  function readInitialState() {
    // Some Circle pages inline `window.__INITIAL_STATE__ = { ... };`
    if (typeof window.__INITIAL_STATE__ === 'object') return window.__INITIAL_STATE__;
    return null;
  }

  function deriveTitle() {
    const next = readNextData();
    const fromNext =
      next?.props?.pageProps?.course?.name ||
      next?.props?.pageProps?.space?.name ||
      next?.props?.pageProps?.community?.name;
    const h1 = safeText(document.querySelector('h1'));
    return (fromNext || h1 || document.title || 'Untitled Circle Course').slice(0, 300);
  }

  // ── Lesson link discovery ────────────────────────────────────────────────

  function collectLessonLinks() {
    const seen = new Map(); // url -> { url, title, module }
    const here = location.host;

    const push = (url, title, module) => {
      const a = abs(url);
      if (!a) return;
      let host;
      try { host = new URL(a).host; } catch (_) { return; }
      if (host !== here) return;
      const path = new URL(a).pathname;
      // Accept lesson-like paths only
      if (!/\/c\/[^/]+\/(lessons|sections|modules)\/|\/lessons\/|\/posts\/[^/]+\/?$/i.test(path)) return;
      const key = a.split('#')[0];
      if (seen.has(key)) {
        // Upgrade title if previous was empty
        const prev = seen.get(key);
        if (!prev.title && title) prev.title = title.slice(0, 300);
        if (!prev.module && module) prev.module = module.slice(0, 200);
        return;
      }
      seen.set(key, {
        url: key,
        title: (title || key).slice(0, 300),
        module: module ? module.slice(0, 200) : undefined,
      });
    };

    // 1. Anchor scan
    document.querySelectorAll('a[href*="/lessons/"], a[href*="/posts/"], a[href*="/sections/"], a[href*="/modules/"]')
      .forEach(a => {
        const href = a.getAttribute('href') || '';
        const text = safeText(a);
        // Try to find the nearest section header for "module"
        const moduleEl = a.closest('[data-testid*="section"], [class*="section"], [class*="module"]');
        const moduleTitle = moduleEl ? safeText(moduleEl.querySelector('h2, h3, [class*="title"]')) : '';
        push(href, text, moduleTitle);
      });

    // 2. data-testid sidebar items (Circle uses these for course curriculum)
    document.querySelectorAll('[data-testid*="lesson"], [data-testid*="curriculum"] a').forEach(el => {
      const a = el.tagName === 'A' ? el : el.querySelector('a');
      if (!a) return;
      push(a.getAttribute('href') || '', safeText(el));
    });

    // 3. Walk __NEXT_DATA__
    const next = readNextData();
    if (next) walkJson(next, push);

    // 4. Walk window.__INITIAL_STATE__
    const init = readInitialState();
    if (init) walkJson(init, push);

    return Array.from(seen.values());
  }

  function walkJson(root, push) {
    const stack = [root];
    let visited = 0;
    while (stack.length && visited < 50000) {
      const cur = stack.pop();
      visited++;
      if (!cur || typeof cur !== 'object') continue;
      if (Array.isArray(cur)) { for (const x of cur) stack.push(x); continue; }
      const url = cur.url || cur.slug_url || cur.permalink || cur.path || cur.public_url;
      const title = cur.name || cur.title || cur.lesson_name;
      if (typeof url === 'string' && typeof title === 'string') push(url, title);
      for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
  }

  // ── Lesson body / media / transcript extraction (current page only) ──────

  function extractCurrentLessonContent() {
    const bodyEl =
      document.querySelector('[data-testid="post-body"]') ||
      document.querySelector('article') ||
      document.querySelector('.trix-content') ||
      document.querySelector('main');
    const body_text = safeText(bodyEl);

    // Embedded video
    let media_url;
    const iframe = document.querySelector(
      'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"]'
    );
    if (iframe) media_url = iframe.getAttribute('src') || undefined;

    // Transcript blocks in DOM
    let transcript = '';
    document.querySelectorAll('[id*="transcript" i], [class*="transcript" i], [class*="caption" i]').forEach(el => {
      const t = safeText(el);
      if (t.length > 50) transcript += (transcript ? '\n\n' : '') + t;
    });
    // <track> elements (rare to be readable but include if so)
    document.querySelectorAll('track[kind="captions"], track[kind="subtitles"]').forEach(t => {
      const src = t.getAttribute('src');
      if (src) transcript += (transcript ? '\n\n' : '') + `[caption track: ${abs(src)}]`;
    });

    return { body_text: body_text || undefined, media_url, transcript: transcript || undefined };
  }

  // ── Build payload ────────────────────────────────────────────────────────

  function buildPayload() {
    const title = deriveTitle();
    const lessons = collectLessonLinks();

    // If we appear to be on an actual lesson page (no curriculum found, but
    // body text exists), capture this single lesson.
    const onLessonPage = /\/lessons\/|\/posts\/[^/]+/i.test(location.pathname);
    if (lessons.length === 0 && onLessonPage) {
      const inline = extractCurrentLessonContent();
      lessons.push({
        url: location.href.split('#')[0],
        title: safeText(document.querySelector('h1')) || title,
        body_text: inline.body_text,
        media_url: inline.media_url,
        transcript: inline.transcript,
      });
    } else {
      // For a course page, also enrich the currently-visible lesson if any
      const inline = extractCurrentLessonContent();
      if (inline.body_text || inline.media_url || inline.transcript) {
        const here = location.href.split('#')[0];
        const existing = lessons.find(l => l.url === here);
        if (existing) {
          existing.body_text = existing.body_text || inline.body_text;
          existing.media_url = existing.media_url || inline.media_url;
          existing.transcript = existing.transcript || inline.transcript;
        }
      }
    }

    return {
      source_url: location.href,
      platform: 'circle',
      title,
      lessons,
    };
  }

  // ── Lovable / Supabase token discovery ───────────────────────────────────

  function findAuthToken() {
    // sb-<projectRef>-auth-token holds {access_token, refresh_token, ...}
    try {
      const keys = Object.keys(localStorage);
      const candidates = keys.filter(k => /^sb-[a-z0-9]+-auth-token$/i.test(k));
      const preferred = projectRef
        ? candidates.find(k => k.toLowerCase() === `sb-${projectRef.toLowerCase()}-auth-token`)
        : null;
      const key = preferred || candidates[0];
      if (!key) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { return null; }
      return parsed?.access_token || parsed?.currentSession?.access_token || null;
    } catch (_) { return null; }
  }

  // ── Transport ────────────────────────────────────────────────────────────

  async function postToBackend(payload, token) {
    if (!endpoint) throw new Error('no endpoint configured');
    if (!token) throw new Error('no auth token found in localStorage');
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (!resp.ok || !json?.success) {
      throw new Error((json && (json.error || json.message)) || `HTTP ${resp.status}`);
    }
    return json;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    // Legacy fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }

  // ── In-page banner UI ────────────────────────────────────────────────────

  function showBanner(message, kind) {
    const id = '__circle_capture_banner';
    document.getElementById(id)?.remove();
    const div = document.createElement('div');
    div.id = id;
    const bg = kind === 'error' ? '#b91c1c' : kind === 'warn' ? '#a16207' : '#15803d';
    Object.assign(div.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      maxWidth: '420px',
      zIndex: '2147483647',
      background: bg,
      color: '#fff',
      padding: '12px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      lineHeight: '1.4',
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      whiteSpace: 'pre-wrap',
    });
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => { div.remove(); }, 12000);
  }

  // ── Main ─────────────────────────────────────────────────────────────────

  (async function main() {
    let payload;
    try {
      payload = buildPayload();
    } catch (err) {
      log('build payload failed', err);
      banner('Circle Capture failed to read this page: ' + (err?.message || err), 'error');
      return;
    }

    log('payload', payload);
    if (!payload.lessons || payload.lessons.length === 0) {
      banner(
        'Circle Capture: no lessons found on this page. Open the course page (with the lesson sidebar) and click the bookmarklet again, or paste the JSON manually.',
        'warn'
      );
    }

    const token = findAuthToken();

    // Try POST first
    if (endpoint && token) {
      try {
        const result = await postToBackend(payload, token);
        banner(
          `Circle Capture: imported ${result?.lessons?.length ?? payload.lessons.length} lessons into your app. You can close this tab.`,
          'info'
        );
        log('posted ok', result);
        return;
      } catch (err) {
        log('POST failed, falling back to clipboard', err);
        banner(
          'Circle Capture: could not POST to your app (' +
            (err?.message || err) +
            '). Copying JSON to clipboard — paste it into the modal’s “Paste captured JSON” box.',
          'warn'
        );
      }
    } else {
      log('no endpoint or token; using clipboard fallback');
    }

    const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      banner(
        'Circle Capture: JSON copied to clipboard. Switch back to your app and paste it into the “Paste captured JSON” box.',
        'info'
      );
    } else {
      // Last-resort: show the JSON in a prompt for manual copy
      try { window.prompt('Copy this JSON into your app:', JSON.stringify(payload)); } catch (_) {}
      banner('Circle Capture: clipboard blocked; JSON shown in dialog.', 'warn');
    }
  })();
})();
