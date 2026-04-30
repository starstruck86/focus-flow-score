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

  // ── Lesson body / media / transcript extraction ─────────────────────────
  //
  // Two flavors:
  //   extractFromDoc(doc)  — pure: pulls content out of any Document
  //   extractCurrentLessonContent() — convenience for the current page

  function extractFromDoc(doc) {
    const bodyEl =
      doc.querySelector('[data-testid="post-body"]') ||
      doc.querySelector('article') ||
      doc.querySelector('.trix-content') ||
      doc.querySelector('main');
    let body_text = safeText(bodyEl);

    // Fallback: body innerText, with a best-effort strip of nav/sidebar noise.
    if (!body_text || body_text.length < 50) {
      const clone = doc.body ? doc.body.cloneNode(true) : null;
      if (clone) {
        clone.querySelectorAll(
          'nav, header, footer, aside, [role="navigation"], [data-testid*="sidebar" i], [class*="sidebar" i], [class*="navbar" i], script, style'
        ).forEach(n => n.remove());
        const fallback = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
        if (fallback && fallback.length > body_text.length) body_text = fallback;
      }
    }

    // Embedded video — iframe first, then anchors/scripts referencing known providers.
    let media_url;
    const iframe = doc.querySelector(
      'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"]'
    );
    if (iframe) media_url = iframe.getAttribute('src') || undefined;
    if (!media_url) {
      const a = doc.querySelector(
        'a[href*="wistia"], a[href*="vimeo"], a[href*="youtube"], a[href*="youtu.be"], a[href*="loom"]'
      );
      if (a) media_url = a.getAttribute('href') || undefined;
    }
    if (!media_url) {
      // Scan script tags for provider URLs (Wistia embeds via script.fast.wistia.com)
      const scripts = Array.from(doc.querySelectorAll('script[src]'));
      const hit = scripts.find(s => /wistia|vimeo|youtube|youtu\.be|loom/i.test(s.getAttribute('src') || ''));
      if (hit) media_url = hit.getAttribute('src') || undefined;
    }

    // Transcript blocks in DOM
    let transcript = '';
    doc.querySelectorAll('[id*="transcript" i], [class*="transcript" i], [class*="caption" i]').forEach(el => {
      const t = safeText(el);
      if (t.length > 50) transcript += (transcript ? '\n\n' : '') + t;
    });
    doc.querySelectorAll('track[kind="captions"], track[kind="subtitles"]').forEach(t => {
      const src = t.getAttribute('src');
      if (src) transcript += (transcript ? '\n\n' : '') + `[caption track: ${src}]`;
    });

    // Title from doc (used by deep-fetch path)
    const title = safeText(doc.querySelector('h1')) || safeText(doc.querySelector('title'));

    return {
      title: title || undefined,
      body_text: body_text || undefined,
      media_url,
      transcript: transcript || undefined,
    };
  }

  function extractCurrentLessonContent() {
    return extractFromDoc(document);
  }

  // ── Deep fetch: hydrate each lesson by fetching its URL same-origin ──────

  async function fetchLessonContent(url) {
    try {
      const resp = await fetch(url, { credentials: 'include', redirect: 'follow' });
      if (!resp.ok) return { capture_issue: 'fetch_failed', _status: resp.status };
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return extractFromDoc(doc);
    } catch (err) {
      log('lesson fetch failed', url, err);
      return { capture_issue: 'fetch_failed' };
    }
  }

  /** Run async tasks with bounded concurrency, calling onProgress(done,total). */
  async function runWithConcurrency(items, limit, worker, onProgress) {
    const total = items.length;
    let done = 0;
    let cursor = 0;
    const runners = new Array(Math.min(limit, total)).fill(0).map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= total) return;
        try { await worker(items[i], i); } catch (_) { /* swallow */ }
        done++;
        try { onProgress && onProgress(done, total); } catch (_) {}
      }
    });
    await Promise.all(runners);
  }

  async function hydrateLessons(lessons) {
    if (!lessons || lessons.length === 0) return;
    showBanner(`Capturing lesson 0 of ${lessons.length}…`, 'info');
    await runWithConcurrency(lessons, 3, async (lesson) => {
      const here = location.href.split('#')[0];
      // Skip the current page — already extracted inline.
      if (lesson.url === here && (lesson.body_text || lesson.media_url || lesson.transcript)) return;
      const got = await fetchLessonContent(lesson.url);
      if (got && got.capture_issue) {
        lesson.capture_issue = got.capture_issue;
        return;
      }
      // Merge: keep existing fields if non-empty, otherwise use fetched ones.
      if (got.title && (!lesson.title || lesson.title === lesson.url)) lesson.title = got.title.slice(0, 300);
      if (!lesson.body_text && got.body_text) lesson.body_text = got.body_text;
      if (!lesson.media_url && got.media_url) lesson.media_url = got.media_url;
      if (!lesson.transcript && got.transcript) lesson.transcript = got.transcript;
    }, (done, total) => {
      showBanner(`Capturing lesson ${done} of ${total}…`, 'info');
    });
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
    setTimeout(() => { div.remove(); }, 15000);
    return div;
  }

  /**
   * Last-resort modal: shows the JSON in a textarea + Copy button so the user
   * can manually grab it when both clipboard APIs are blocked.
   */
  function showJsonModal(text) {
    const id = '__circle_capture_modal';
    document.getElementById(id)?.remove();
    const overlay = document.createElement('div');
    overlay.id = id;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646',
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', color: '#111', borderRadius: '10px',
      width: 'min(640px, 92vw)', maxHeight: '80vh',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
    });
    const header = document.createElement('div');
    header.textContent = 'Circle Capture — copy this JSON';
    Object.assign(header.style, { padding: '12px 16px', fontWeight: '600', borderBottom: '1px solid #e5e7eb', fontSize: '14px' });
    const body = document.createElement('div');
    Object.assign(body.style, { padding: '12px 16px', fontSize: '12px', color: '#374151' });
    body.textContent = 'Clipboard access was blocked. Select all the JSON below, copy it, then paste it into Circle Import Mode in the app.';
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    Object.assign(ta.style, {
      flex: '1', margin: '0 16px', minHeight: '240px',
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      fontSize: '11px', padding: '8px', border: '1px solid #d1d5db',
      borderRadius: '6px', background: '#f9fafb',
    });
    const footer = document.createElement('div');
    Object.assign(footer.style, { padding: '12px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid #e5e7eb' });
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy JSON';
    Object.assign(copyBtn.style, {
      padding: '6px 12px', borderRadius: '6px', border: '0',
      background: '#15803d', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '12px',
    });
    copyBtn.onclick = () => {
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      copyBtn.textContent = 'Copied!';
    };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    Object.assign(closeBtn.style, {
      padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db',
      background: '#fff', color: '#111', cursor: 'pointer', fontSize: '12px',
    });
    closeBtn.onclick = () => overlay.remove();
    footer.appendChild(copyBtn);
    footer.appendChild(closeBtn);
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(ta);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    // auto-select for convenience
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  }

  // ── Page-mode detection ──────────────────────────────────────────────────
  //
  // We treat the page as an INDIVIDUAL LESSON page when:
  //   • URL path includes /lessons/ or /posts/
  //   • OR the DOM exposes a meaningful post body / article / .trix-content
  //   • OR there is a visible video embed
  //
  // Otherwise we treat it as a COURSE INDEX / curriculum page and capture
  // only the lesson list (titles + URLs).
  function detectPageMode() {
    const path = location.pathname || '';
    const urlMatch = /\/lessons\/[^/]+|\/posts\/[^/]+/i.test(path);

    const bodyEl =
      document.querySelector('[data-testid="post-body"]') ||
      document.querySelector('article') ||
      document.querySelector('.trix-content');
    const bodyText = safeText(bodyEl);
    const hasMeaningfulBody = bodyText.length > 80;

    const hasVideo = !!document.querySelector(
      'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"], video'
    );

    if (urlMatch || hasMeaningfulBody || hasVideo) return 'lesson';
    return 'index';
  }

  function buildSingleLessonPayload() {
    const inline = extractCurrentLessonContent();
    const title =
      safeText(document.querySelector('h1')) ||
      inline.title ||
      document.title ||
      'Untitled Lesson';
    const lesson = {
      url: location.href.split('#')[0],
      title: title.slice(0, 300),
      body_text: inline.body_text,
      media_url: inline.media_url,
      transcript: inline.transcript,
    };
    return {
      source_url: location.href,
      platform: 'circle',
      capture_mode: 'single_lesson',
      title: lesson.title,
      lessons: [lesson],
    };
  }

  function buildIndexPayload() {
    const title = deriveTitle();
    const lessons = collectLessonLinks();
    return {
      source_url: location.href,
      platform: 'circle',
      capture_mode: 'course_index',
      title,
      lessons,
    };
  }

  // ── Auto-walk: SPA-navigate to each lesson and extract live DOM ──────────

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /**
   * Wait until the current page's lesson body has meaningful (>100 char) text
   * or a video iframe appears. Polls every 250ms up to `timeoutMs`.
   * Also checks that location.href has changed to `expectedUrl` (if provided).
   */
  async function waitForLessonRender(expectedUrl, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // SPA may not have updated URL yet
      const urlOk = !expectedUrl || location.href.split('#')[0] === expectedUrl.split('#')[0];
      const bodyEl =
        document.querySelector('[data-testid="post-body"]') ||
        document.querySelector('article') ||
        document.querySelector('.trix-content');
      const txt = safeText(bodyEl);
      const hasVideo = !!document.querySelector(
        'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"], video'
      );
      if (urlOk && (txt.length > 100 || hasVideo)) return true;
      await sleep(250);
    }
    return false;
  }

  /** Find an in-DOM anchor whose href resolves to the lesson URL. */
  function findLessonAnchor(lessonUrl) {
    const target = lessonUrl.split('#')[0];
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const resolved = abs(href).split('#')[0];
      if (resolved === target) return a;
    }
    return null;
  }

  /**
   * Walk the lesson list by clicking each link in turn, waiting for the SPA to
   * render, and extracting live DOM content. Returns the lessons array,
   * mutated in place.
   */
  async function autoWalkLessons(lessons) {
    const startUrl = location.href;
    const total = lessons.length;
    for (let i = 0; i < total; i++) {
      const lesson = lessons[i];
      banner(`Capturing lesson ${i + 1} of ${total}…\n${lesson.title || lesson.url}`, 'info');

      // Already on this lesson? Just extract.
      const here = location.href.split('#')[0];
      if (here === lesson.url.split('#')[0]) {
        await waitForLessonRender(lesson.url, 2000);
        const got = extractCurrentLessonContent();
        if (got.body_text) lesson.body_text = got.body_text;
        if (got.media_url) lesson.media_url = got.media_url;
        if (got.transcript) lesson.transcript = got.transcript;
        if (got.title && (!lesson.title || lesson.title === lesson.url)) lesson.title = got.title.slice(0, 300);
        if (!lesson.body_text && !lesson.media_url) lesson.capture_issue = 'render_failed';
        continue;
      }

      // Try to click an in-DOM anchor first (preserves SPA routing).
      let navigated = false;
      const a = findLessonAnchor(lesson.url);
      if (a) {
        try {
          a.scrollIntoView({ block: 'center' });
          a.click();
          navigated = true;
        } catch (_) { /* fall through */ }
      }
      // Fallback: history.pushState + popstate to nudge SPA router.
      if (!navigated) {
        try {
          history.pushState({}, '', lesson.url);
          window.dispatchEvent(new PopStateEvent('popstate'));
          navigated = true;
        } catch (_) { /* fall through */ }
      }

      const ok = navigated ? await waitForLessonRender(lesson.url, 6000) : false;
      if (!ok) {
        lesson.capture_issue = 'render_failed';
        continue;
      }

      const got = extractCurrentLessonContent();
      if (got.title && (!lesson.title || lesson.title === lesson.url)) lesson.title = got.title.slice(0, 300);
      if (got.body_text) lesson.body_text = got.body_text;
      if (got.media_url) lesson.media_url = got.media_url;
      if (got.transcript) lesson.transcript = got.transcript;
      if (!lesson.body_text && !lesson.media_url && !lesson.transcript) {
        lesson.capture_issue = 'render_failed';
      }
      // Brief pacing so Circle doesn't throttle / so videos can mount
      await sleep(400);
    }

    // Try to return user to where they started
    try {
      if (location.href !== startUrl) {
        history.pushState({}, '', startUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch (_) {}
    return lessons;
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  //
  // Strategy:
  //   • LESSON page → capture this lesson's live-rendered DOM (single lesson).
  //   • INDEX page → discover all lesson links, then auto-walk by clicking
  //     each one in sequence, waiting for SPA render, and extracting live DOM.
  //     Deep-fetch is NOT used (Circle returns a JS shell).
  (async function main() {
    const mode = detectPageMode();
    log('detected page mode:', mode);

    let payload;
    try {
      payload = mode === 'lesson' ? buildSingleLessonPayload() : buildIndexPayload();
    } catch (err) {
      log('build payload failed', err);
      banner('Circle Capture failed to read this page: ' + (err?.message || err), 'error');
      return;
    }
    log('payload', payload);

    if (!payload.lessons || payload.lessons.length === 0) {
      banner(
        'Circle Capture: nothing to capture on this page. Open a lesson page and click the bookmarklet again.',
        'warn'
      );
      return;
    }

    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);

    if (mode === 'lesson') {
      const json = JSON.stringify(payload, null, 2);
      const ok = await copyToClipboard(json);
      const l = payload.lessons[0];
      const hasContent = !!(l.body_text || l.media_url || l.transcript);
      if (ok) {
        banner(
          hasContent
            ? `Lesson content copied — return to the app and paste it into Circle Import Mode.\n("${l.title}")`
            : `Lesson copied, but no body/video/transcript was found in the DOM. Return to the app and paste it anyway, or scroll the lesson into view and re-run.`,
          hasContent ? 'info' : 'warn'
        );
      } else {
        showJsonModal(json);
        banner('Clipboard blocked — copy the JSON from the dialog and paste it into Circle Import Mode.', 'warn');
      }
      return;
    }

    // Course index page → auto-walk every lesson by clicking through the SPA.
    banner(`Found ${payload.lessons.length} lessons. Starting auto-capture…`, 'info');
    try {
      await autoWalkLessons(payload.lessons);
    } catch (err) {
      log('auto-walk failed', err);
    }
    payload.capture_mode = 'auto_walk';

    const withContent = payload.lessons.filter(l => l.body_text || l.media_url || l.transcript).length;
    const failed = payload.lessons.filter(l => l.capture_issue === 'render_failed').length;

    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);

    const summary = `${withContent} of ${payload.lessons.length} lessons captured with content${failed ? ` (${failed} render-failed)` : ''} — return to the app and paste into Circle Import Mode.`;
    if (ok) {
      banner(summary, withContent === 0 ? 'warn' : 'info');
    } else {
      showJsonModal(json);
      banner('Clipboard blocked — copy the JSON from the dialog and paste it into Circle Import Mode.', 'warn');
    }
  })();
})();
