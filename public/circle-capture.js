/**
 * Circle Course Capture Bookmarklet — v2 (state machine)
 * --------------------------------------------------------------------------
 * Runs INSIDE the user's already-authenticated Circle browser tab.
 *
 * Architecture: DISCOVER → BUILD_QUEUE → (NAVIGATE → AWAIT_READY → EXTRACT
 * → PERSIST) per-lesson loop → COMPLETE.
 *
 * Key contracts:
 *   • Build the full lesson queue ONCE from the right-hand sidebar (or
 *     document body fallback). Persist it.
 *   • Navigate via real anchor click (lets Next.js <Link> handle routing) or
 *     window.location.assign() as a hard-nav fallback. Never history.pushState.
 *   • A URL change alone is NOT success. Wait for: expected URL key + lesson
 *     indicator/title + DOM stability via MutationObserver + polling.
 *   • TOC/course-root landings trigger up-to-3 retries. history.back is never
 *     used as recovery.
 *   • Persist {queue, cursor, captured, status, errors, debug_logs} to
 *     localStorage after every lesson. Resume on reload.
 *   • One failed lesson is marked failed and skipped — never fatal.
 *   • Body extraction is scoped to the lesson main column; aside/nav/drawer/
 *     curriculum/sidebar subtrees are removed before reading text.
 */
(function () {
  'use strict';

  // ── Tiny helpers ─────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safeText = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const abs = (url) => { try { return new URL(url, location.href).toString(); } catch (_) { return ''; } };
  const VERSION = 'circle_bookmarklet_v2';

  // ── Mode + endpoint from script src ──────────────────────────────────────
  const SCRIPT_PARAMS = (() => {
    try {
      const scripts = document.querySelectorAll('script[src*="circle-capture"]');
      const last = scripts[scripts.length - 1];
      if (last) {
        const u = new URL(last.src);
        return {
          mode: u.searchParams.get('mode') || 'course',
          endpoint: u.searchParams.get('endpoint') || '',
          project: u.searchParams.get('project') || '',
        };
      }
    } catch (_) {}
    return { mode: 'course', endpoint: '', project: '' };
  })();
  const CAPTURE_MODE = ['single', 'course'].includes(SCRIPT_PARAMS.mode) ? SCRIPT_PARAMS.mode : 'course';

  // ── Debug log buffer ─────────────────────────────────────────────────────
  const DEBUG_LOG_MAX = 200;
  const debugLogs = [];
  function debugLog(event, payload) {
    const entry = { t: new Date().toISOString(), event, payload: payload === undefined ? null : payload };
    debugLogs.push(entry);
    if (debugLogs.length > DEBUG_LOG_MAX) debugLogs.shift();
    try { console.log('[CircleCapture]', event, payload ?? ''); } catch (_) {}
    try { renderOverlayLastEvent(entry); } catch (_) {}
  }

  // ── URL helpers ──────────────────────────────────────────────────────────
  function isCircleLessonUrl(url) {
    try {
      const u = new URL(url, location.origin);
      return u.host === location.host && /\/c\/[^/]+\/(?:sections?\/[^/]+\/)?(?:lessons|posts)\/[^/?#]+/.test(u.pathname);
    } catch (_) { return false; }
  }
  function canonicalLessonKey(url) {
    try {
      const u = new URL(url, location.origin);
      return u.pathname.replace(/\/+$/, '').toLowerCase();
    } catch (_) { return String(url || '').split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase(); }
  }
  function currentCourseSlug() {
    const m = (location.pathname || '').match(/\/c\/([^/]+)/);
    return m ? m[1] : 'unknown-course';
  }
  function isCourseRootOrSection(url) {
    try {
      const u = new URL(url, location.origin);
      const p = u.pathname.replace(/\/+$/, '');
      if (/^\/c\/[^/]+$/.test(p)) return true;
      if (/^\/c\/[^/]+\/sections?\/[^/]+$/.test(p)) return true;
      if (!/\/(lessons|posts)\//.test(p)) return true;
      return false;
    } catch (_) { return false; }
  }

  // ── Storage ──────────────────────────────────────────────────────────────
  const STORAGE_KEY = `circle_course_capture:${location.origin}:${currentCourseSlug()}`;
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && s.version === 2) return s;
      return null;
    } catch (_) { return null; }
  }
  function saveState(s) {
    try {
      s.updatedAt = new Date().toISOString();
      // Cap debug_logs in storage
      const toSave = { ...s, debug_logs: (s.debug_logs || []).slice(-DEBUG_LOG_MAX) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      debugLog('state:saved', { cursor: s.cursor, queue: s.queue?.length, captured: Object.keys(s.captured || {}).length });
    } catch (e) { debugLog('state:save_failed', { error: String(e?.message || e) }); }
  }
  function clearState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }
  function newEmptyState() {
    return {
      version: 2,
      courseSlug: currentCourseSlug(),
      courseTitle: '',
      courseUrl: location.href.split('#')[0],
      queue: [],
      cursor: 0,
      captured: {},
      status: {},
      errors: {},
      retries: {},
      debug_logs: [],
      startedAt: null,
      updatedAt: null,
      paused: false,
    };
  }

  // ── Lesson "X of Y" indicator ────────────────────────────────────────────
  function findLessonOfIndicator(root) {
    root = root || document;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const re = /Lesson\s+(\d+)\s+of\s+(\d+)/i;
      let node;
      while ((node = walker.nextNode())) {
        const m = node.nodeValue && node.nodeValue.match(re);
        if (m) return { current: parseInt(m[1], 10), total: parseInt(m[2], 10), el: node.parentElement };
      }
    } catch (_) {}
    return null;
  }

  // ── Course title ─────────────────────────────────────────────────────────
  function deriveCourseTitle() {
    const header = document.querySelector('header h1, [data-testid*="header"] h1, [class*="header"] h1, [class*="course-title"]');
    const fromHeader = safeText(header);
    if (fromHeader && fromHeader.length < 200) return fromHeader;
    const sideTitle = safeText(document.querySelector('[data-testid*="sidebar"] h1, aside h1'));
    if (sideTitle) return sideTitle;
    return (document.title || 'Untitled Circle Course').slice(0, 300);
  }

  // ── Drawer / sidebar discovery ───────────────────────────────────────────
  function isElementVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }
  function findLessonsDrawerRoot() {
    // 1) by heading text
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,[role="heading"]'));
    for (const h of headings) {
      const t = (h.textContent || '').trim().toLowerCase();
      if (/^(lessons|course content|curriculum|contents|chapters)$/.test(t)) {
        let cur = h.parentElement;
        for (let i = 0; i < 8 && cur; i++) {
          const linkCount = cur.querySelectorAll('a[href*="/lessons/"], a[href*="/posts/"]').length;
          if (linkCount >= 2) return cur;
          cur = cur.parentElement;
        }
      }
    }
    // 2) by structure: largest container of /lessons/ or /posts/ anchors that
    //    isn't the whole <body>; prefer aside or right-anchored panel.
    const containers = new Map();
    const anchors = document.querySelectorAll('a[href*="/lessons/"], a[href*="/posts/"]');
    anchors.forEach((a) => {
      let p = a.parentElement;
      for (let depth = 0; depth < 6 && p; depth++, p = p.parentElement) {
        const k = p;
        containers.set(k, (containers.get(k) || 0) + 1);
      }
    });
    let best = null;
    let bestScore = 0;
    containers.forEach((count, el) => {
      if (count < 3) return;
      if (el === document.body || el === document.documentElement) return;
      const tag = el.tagName.toLowerCase();
      const cls = (el.className || '').toString().toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const looksDrawer =
        tag === 'aside' ||
        role === 'complementary' ||
        /\b(sidebar|drawer|lessons|curriculum|outline|toc)\b/.test(cls);
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { right: 0 };
      const isRightSide = r.right > (window.innerWidth * 0.55);
      const score = count + (looksDrawer ? 50 : 0) + (isRightSide ? 10 : 0);
      if (score > bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  async function openLessonsDrawerIfNeeded() {
    if (findLessonsDrawerRoot()) return true;
    // Try clicking a button labeled "Lessons" (avoid TOC/Curriculum which can
    // route off the lesson page).
    const candidates = Array.from(document.querySelectorAll('button,[role="button"]'));
    for (const c of candidates) {
      if (!isElementVisible(c)) continue;
      const t = (safeText(c) + ' ' + (c.getAttribute('aria-label') || '') + ' ' + (c.getAttribute('title') || '')).toLowerCase();
      if (/^(lessons)$/.test(safeText(c).trim()) || /\b(open\s+lessons|view\s+lessons|all\s+lessons|show\s+lessons|toggle\s+lessons)\b/.test(t)) {
        try { c.click(); } catch (_) {}
        await sleep(400);
        if (findLessonsDrawerRoot()) return true;
      }
    }
    return !!findLessonsDrawerRoot();
  }

  // ── Build the lesson queue ───────────────────────────────────────────────
  async function buildLessonQueue() {
    debugLog('queue:building');
    await openLessonsDrawerIfNeeded();
    const drawer = findLessonsDrawerRoot();
    const source = drawer ? 'drawer' : 'body';
    debugLog('queue:source', { source, drawerTag: drawer?.tagName, drawerClass: drawer?.className?.toString?.()?.slice(0, 200) });

    const root = drawer || document.body;
    const seen = new Map();
    const items = [];

    // Walk anchors in DOM order. Track preceding section heading for grouping.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let n;
    let currentSection = '';
    while ((n = walker.nextNode())) {
      if (/^H[1-6]$/.test(n.tagName)) {
        const t = safeText(n);
        if (t && t.length < 200 && !/^(lessons|course content|curriculum|contents|chapters)$/i.test(t)) {
          currentSection = t;
        }
        continue;
      }
      if (n.tagName === 'A' && n.getAttribute('href')) {
        const href = abs(n.getAttribute('href'));
        if (!href || !isCircleLessonUrl(href)) continue;
        const key = canonicalLessonKey(href);
        if (seen.has(key)) continue;
        const title = (safeText(n) || n.getAttribute('aria-label') || n.getAttribute('title') || '').slice(0, 300);
        if (!title) continue;
        seen.set(key, true);
        items.push({
          index: items.length,
          url: href,
          urlKey: key,
          title,
          sectionTitle: currentSection || '',
        });
      }
    }

    debugLog('queue:built', { count: items.length });
    items.forEach((it) => debugLog('queue:item', { index: it.index, title: it.title, section: it.sectionTitle, urlKey: it.urlKey }));
    return items;
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  function findAnchorForUrlKey(urlKey) {
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = abs(a.getAttribute('href'));
      if (!href) continue;
      if (canonicalLessonKey(href) === urlKey && isElementVisible(a)) return a;
    }
    // Second pass without visibility check (drawer may be collapsed).
    for (const a of anchors) {
      const href = abs(a.getAttribute('href'));
      if (!href) continue;
      if (canonicalLessonKey(href) === urlKey) return a;
    }
    return null;
  }

  async function goToLesson(item) {
    debugLog('nav:intent', { toIndex: item.index, expectedUrl: item.url, expectedTitle: item.title });

    // If already on the right URL, no-op.
    if (canonicalLessonKey(location.href) === item.urlKey) {
      debugLog('nav:already_there', { urlKey: item.urlKey });
      return { method: 'already_there' };
    }

    const anchor = findAnchorForUrlKey(item.urlKey);
    if (anchor) {
      debugLog('nav:anchor_found', { tag: anchor.tagName });
      try { anchor.scrollIntoView({ block: 'center' }); } catch (_) {}
      await sleep(60);
      try {
        anchor.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window,
          metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0,
        }));
        debugLog('nav:click', { urlKey: item.urlKey });
        return { method: 'anchor_click' };
      } catch (e) {
        debugLog('nav:click_failed', { error: String(e?.message || e) });
      }
    } else {
      debugLog('nav:anchor_missing', { urlKey: item.urlKey });
    }
    debugLog('nav:hard_assign', { url: item.url });
    window.location.assign(item.url);
    return { method: 'hard_assign' };
  }

  // ── Lesson main element + readiness ──────────────────────────────────────
  function findLessonMainElement() {
    return (
      document.querySelector('[data-testid="post-body"]') ||
      document.querySelector('[data-testid*="lesson-content"]') ||
      document.querySelector('[data-testid*="post-content"]') ||
      document.querySelector('article') ||
      document.querySelector('.trix-content') ||
      document.querySelector('main') ||
      null
    );
  }

  function findLessonTitleInMain(mainEl) {
    const indicator = findLessonOfIndicator();
    if (indicator?.el) {
      let cursor = indicator.el;
      for (let i = 0; i < 6 && cursor; i++) {
        const h = cursor.parentElement?.querySelector('h1, h2, h3');
        if (h && safeText(h) && safeText(h) !== safeText(indicator.el)) {
          return safeText(h).slice(0, 300);
        }
        cursor = cursor.parentElement;
      }
    }
    const main = mainEl || findLessonMainElement() || document.body;
    const heads = Array.from(main.querySelectorAll('h1, h2'));
    for (const h of heads) {
      const t = safeText(h);
      if (t && t.length > 3 && t.length < 200) return t.slice(0, 300);
    }
    return '';
  }

  function fuzzyTitleMatch(a, b) {
    if (!a || !b) return false;
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const A = norm(a), B = norm(b);
    if (!A || !B) return false;
    if (A === B) return true;
    if (A.includes(B) || B.includes(A)) return true;
    const tokens = (s) => new Set(s.split(' ').filter((t) => t.length > 2));
    const ta = tokens(A), tb = tokens(B);
    if (!ta.size || !tb.size) return false;
    let inter = 0;
    ta.forEach((t) => { if (tb.has(t)) inter += 1; });
    const jacc = inter / (ta.size + tb.size - inter);
    return jacc >= 0.5;
  }

  function isTocOrCourseRootPage(item) {
    const url = location.href;
    if (isCourseRootOrSection(url)) return true;
    if (canonicalLessonKey(url) !== item.urlKey) {
      const indicator = findLessonOfIndicator();
      const title = findLessonTitleInMain();
      if (!indicator && !fuzzyTitleMatch(title, item.title)) return true;
    }
    return false;
  }

  function awaitLessonReady(item, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let lastHtml = '';
      let stableTicks = 0;

      const observer = new MutationObserver(check);
      try { observer.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}
      const interval = setInterval(check, 250);

      function cleanup() {
        try { clearInterval(interval); } catch (_) {}
        try { observer.disconnect(); } catch (_) {}
      }

      function check() {
        try {
          const actualKey = canonicalLessonKey(location.href);
          const main = findLessonMainElement();
          const title = findLessonTitleInMain(main);
          const indicator = findLessonOfIndicator();
          const html = main?.innerHTML || '';
          const urlMatches = actualKey === item.urlKey;
          const mainText = main ? safeText(main) : '';
          const titleMatches = fuzzyTitleMatch(title, item.title) || (mainText && mainText.toLowerCase().includes((item.title || '').toLowerCase().slice(0, 40)));
          const hasLessonSignal = !!(indicator || titleMatches);
          const stable = html && html === lastHtml ? ++stableTicks >= 2 : 0;
          if (html && html !== lastHtml) stableTicks = 0;
          lastHtml = html;

          if (urlMatches && hasLessonSignal && stable) {
            debugLog('ready:success', { urlKey: actualKey, title, indicator: !!indicator });
            cleanup();
            resolve({ title, indicator });
            return;
          }
          if (Date.now() - started > timeoutMs) {
            debugLog('ready:timeout', { expected: item.urlKey, actual: actualKey, title, hasIndicator: !!indicator });
            cleanup();
            reject(new Error(`Lesson did not become ready: expected "${item.title}" at ${item.urlKey}, got title "${title}" at ${actualKey}`));
          }
        } catch (e) {
          cleanup();
          reject(e);
        }
      }
      check();
    });
  }

  async function navigateWithRetry(item, state) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt === 2) {
          await openLessonsDrawerIfNeeded();
        }
        if (attempt === 3) {
          debugLog('nav:retry', { attempt, mode: 'hard_assign' });
          window.location.assign(item.url);
          // hard nav will reload — this promise won't resolve here
          await sleep(2000);
        } else {
          await goToLesson(item);
        }
        await awaitLessonReady(item, 12000);
        if (isTocOrCourseRootPage(item)) {
          debugLog('toc:detected', { attempt, url: location.href });
          throw new Error('Landed on TOC/course-root');
        }
        return true;
      } catch (err) {
        state.retries[item.urlKey] = (state.retries[item.urlKey] || 0) + 1;
        debugLog('nav:retry', { attempt, item: item.urlKey, error: String(err?.message || err) });
        if (attempt === maxAttempts) throw err;
        await sleep(500);
      }
    }
    return false;
  }

  // ── Resource / video / transcript helpers ────────────────────────────────
  function inferResourceType(url) {
    const u = (url || '').toLowerCase();
    if (/\.pdf(\?|#|$)/.test(u)) return 'pdf';
    if (/\.(docx?|rtf|odt)(\?|#|$)/.test(u) || /docs\.google\.com\/document/.test(u)) return 'doc';
    if (/\.(xlsx?|csv|ods)(\?|#|$)/.test(u) || /docs\.google\.com\/spreadsheets/.test(u)) return 'sheet';
    if (/\.(pptx?|key|odp)(\?|#|$)/.test(u) || /docs\.google\.com\/presentation/.test(u)) return 'slide';
    if (/\bdownload\b/.test(u) || /\.(zip|rar|7z|tar|gz)(\?|#|$)/.test(u)) return 'download';
    if (/notion\.so|notion\.site/.test(u)) return 'doc';
    if (/drive\.google\.com|docs\.google\.com/.test(u)) return 'doc';
    if (/^https?:\/\//.test(u)) return 'link';
    return 'unknown';
  }
  function isExcludedResourceUrl(url) {
    const raw = (url || '').trim();
    if (!raw) return true;
    if (/^(mailto:|javascript:|tel:|#)/i.test(raw)) return true;
    let u; try { u = new URL(raw, location.href); } catch { return true; }
    if (!u.host) return true;
    if (u.host === location.host) {
      const p = u.pathname || '';
      if (
        /\/lessons?\//i.test(p) || /\/posts?\//i.test(p) || /\/sections?\//i.test(p) ||
        /\/members?\//i.test(p) || /\/profile/i.test(p) || /\/settings/i.test(p) ||
        /\/notifications/i.test(p) || /\/search/i.test(p) || /\/spaces?\//i.test(p) ||
        /\/c\/[^/]+\/?$/i.test(p) || p === '/' || p === ''
      ) return true;
    }
    return false;
  }
  function collectLinksFrom(block, out, seen, sourceLabel) {
    if (!block) return '';
    block.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      const url = abs(href);
      if (!url || isExcludedResourceUrl(url)) return;
      const norm = url.split('#')[0].replace(/\/+$/, '').toLowerCase();
      if (seen.has(norm)) return;
      seen.add(norm);
      const title = safeText(a) || a.getAttribute('aria-label') || a.getAttribute('title') || url;
      out.push({ title: title.slice(0, 300), url, type: inferResourceType(url), source_section: sourceLabel });
    });
    return safeText(block);
  }
  function captureSectionByHeading(scope, headingRe) {
    const headings = Array.from((scope || document).querySelectorAll('h1, h2, h3, h4, h5, strong, [class*="heading"]'));
    const heading = headings.find((h) => headingRe.test(safeText(h)));
    if (!heading) return '';
    const collected = [];
    let n = heading.nextElementSibling;
    let safety = 0;
    while (n && safety++ < 50) {
      if (/^H[1-6]$/.test(n.tagName)) break;
      collected.push(n);
      n = n.nextElementSibling;
    }
    if (collected.length === 0 && heading.parentElement) {
      const sibs = Array.from(heading.parentElement.children);
      const idx = sibs.indexOf(heading);
      for (let i = idx + 1; i < sibs.length; i++) {
        if (/^H[1-6]$/.test(sibs[i].tagName)) break;
        collected.push(sibs[i]);
      }
    }
    return collected.map(safeText).filter(Boolean).join('\n');
  }
  function findVideoAssets(scope) {
    const root = scope || document;
    const out = [];
    const ifr = root.querySelector(
      'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"], iframe[src*="mux"], iframe[src*="stream"], iframe[src*="cloudflare"], iframe[src*="mediadelivery"], iframe[src*="bunny"], iframe[src*="sproutvideo"], iframe[src*="vidyard"]'
    );
    if (ifr) out.push({ kind: 'iframe', url: abs(ifr.getAttribute('src')) || '' });
    const v = root.querySelector('video');
    if (v) {
      const src = v.currentSrc || v.getAttribute('src') || v.getAttribute('data-src') || '';
      const isBlob = /^blob:/i.test(src);
      out.push({ kind: 'video', url: src, blob: isBlob, poster: v.getAttribute('poster') || '' });
    }
    const vs = root.querySelector('video source[src], video source[data-src]');
    if (vs) out.push({ kind: 'source', url: abs(vs.getAttribute('src') || vs.getAttribute('data-src')) || '' });
    const a = root.querySelector('a[href*="wistia"], a[href*="vimeo"], a[href*="youtube"], a[href*="youtu.be"], a[href*="loom"], a[href*=".m3u8"], a[href*=".mp4"]');
    if (a) out.push({ kind: 'link', url: abs(a.getAttribute('href')) || '' });
    return out;
  }

  async function captureTranscriptScoped(mainEl) {
    const scope = mainEl || document;
    const triggers = Array.from(scope.querySelectorAll('button, a, [role="button"], summary, [aria-expanded]'))
      .filter((el) => {
        const t = safeText(el);
        if (!t || t.length > 60) return false;
        return /\b(show|view|open|toggle|expand)\s+transcript\b/i.test(t) || /^transcript$/i.test(t);
      });
    if (triggers.length === 0) {
      debugLog('extract:transcript', { status: 'not_found' });
      return { text: '', status: 'not_found' };
    }
    const dialogsBefore = document.querySelectorAll('[role="dialog"]').length;
    for (const trig of triggers) {
      try { trig.scrollIntoView({ block: 'center' }); } catch (_) {}
      try { trig.click(); } catch (_) { continue; }
      await sleep(400);
      const start = Date.now();
      let modal = null;
      while (Date.now() - start < 4000) {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        modal = dialogs.length > dialogsBefore ? dialogs[dialogs.length - 1] : null;
        if (!modal) modal = dialogs.find((d) => safeText(d).length > 120);
        if (modal && safeText(modal).length > 120) break;
        modal = null;
        await sleep(200);
      }
      if (modal) {
        const text = safeText(modal);
        const closeBtn = modal.querySelector('button[aria-label="Close" i], [class*="close"]');
        try { closeBtn?.click(); } catch (_) {}
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
        debugLog('extract:transcript', { status: 'ok', chars: text.length, source: 'modal' });
        return { text, status: 'ok' };
      }
      const inline = Array.from(document.querySelectorAll('[id*="transcript" i], [class*="transcript" i], [data-testid*="transcript" i]'))
        .find((c) => safeText(c).length > 120);
      if (inline) {
        const text = safeText(inline);
        debugLog('extract:transcript', { status: 'ok', chars: text.length, source: 'inline' });
        return { text, status: 'ok' };
      }
    }
    debugLog('extract:transcript', { status: 'failed', triggersTried: triggers.length });
    return { text: '', status: 'failed' };
  }

  // ── Per-lesson extraction (scoped) ───────────────────────────────────────
  function cloneAndStripChrome(el) {
    if (!el) return null;
    const clone = el.cloneNode(true);
    const SELECTOR = 'aside, nav, [role="navigation"], [aria-label*="Lessons" i], [aria-label*="Curriculum" i], [class*="sidebar" i], [class*="drawer" i], [class*="toc" i], [class*="curriculum" i], [class*="outline" i], [data-testid*="sidebar" i]';
    clone.querySelectorAll(SELECTOR).forEach((n) => n.remove());
    return clone;
  }

  async function extractCurrentLessonScoped(item) {
    debugLog('extract:start', { item: item.urlKey, title: item.title });
    const main = findLessonMainElement();
    debugLog('extract:body_selector', {
      tag: main?.tagName,
      testid: main?.getAttribute?.('data-testid') || '',
      cls: (main?.className || '').toString().slice(0, 120),
    });
    const cleanedMain = cloneAndStripChrome(main);

    const title = findLessonTitleInMain(main) || item.title;
    const videos = findVideoAssets(main || document);
    debugLog('extract:video', { count: videos.length, samples: videos.slice(0, 2) });

    const takeaways = main ? captureSectionByHeading(main, /^takeaways?$/i) : '';

    const resources = [];
    const seen = new Set();
    if (main) {
      const headings = Array.from(main.querySelectorAll('h1, h2, h3, h4, h5, strong, [class*="heading"]'));
      const resHeading = headings.find((h) => /resources?\s+mentioned/i.test(safeText(h)));
      if (resHeading) {
        let n = resHeading.nextElementSibling;
        let safety = 0;
        while (n && safety++ < 50) {
          if (/^H[1-6]$/.test(n.tagName)) break;
          collectLinksFrom(n, resources, seen, 'resources_mentioned');
          n = n.nextElementSibling;
        }
      }
      collectLinksFrom(main, resources, seen, 'lesson_body');
    }
    debugLog('extract:resources', { count: resources.length });

    const body_text = cleanedMain ? safeText(cleanedMain) : '';
    const body_html = cleanedMain ? (cleanedMain.innerHTML || '').slice(0, 200000) : '';

    const transcript = await captureTranscriptScoped(main);

    const video_assets = videos;
    const primary_video = videos.find((v) => v.url && !v.blob) || videos[0] || null;
    const video_downloadable = !!(primary_video && primary_video.url && !primary_video.blob);

    const result = {
      course_title: '',
      course_url: '',
      section_title: item.sectionTitle || '',
      lesson_index: item.index,
      lesson_title: title,
      lesson_url: item.url,
      body_text,
      body_html,
      takeaways,
      transcript_text: transcript.text || '',
      transcript_status: transcript.status,
      video_assets,
      video_downloadable,
      media_url: primary_video?.url || '',
      resource_links: resources,
      scraped_at: new Date().toISOString(),
      capture_issue: undefined,
    };
    if (!body_text && !transcript.text && !resources.length && !primary_video) {
      result.capture_issue = 'empty_capture';
      debugLog('extract:partial', { item: item.urlKey });
    } else {
      debugLog('extract:success', { item: item.urlKey, bodyChars: body_text.length, transcriptChars: transcript.text.length, resources: resources.length, hasVideo: !!primary_video });
    }
    return result;
  }

  // ── Overlay UI ───────────────────────────────────────────────────────────
  let overlayEls = null;
  let runtimeControls = { paused: false, stopped: false };

  function buildOverlay(state) {
    const id = '__circle_capture_overlay_v2';
    document.getElementById(id)?.remove();
    const wrap = document.createElement('div');
    wrap.id = id;
    Object.assign(wrap.style, {
      position: 'fixed', top: '12px', right: '12px', width: '380px', maxHeight: '80vh',
      zIndex: '2147483647', background: '#0f172a', color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '12px',
      borderRadius: '10px', boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    });
    const header = document.createElement('div');
    Object.assign(header.style, { padding: '10px 12px', background: '#1e293b', fontWeight: '600', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    const titleEl = document.createElement('div');
    titleEl.textContent = 'Circle Capture v2';
    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    Object.assign(closeX.style, { background: 'transparent', border: '0', color: '#cbd5e1', cursor: 'pointer', fontSize: '14px' });
    closeX.onclick = () => wrap.remove();
    header.appendChild(titleEl); header.appendChild(closeX);

    const body = document.createElement('div');
    Object.assign(body.style, { padding: '10px 12px', overflowY: 'auto', flex: '1' });

    const stats = document.createElement('div');
    const current = document.createElement('div');
    Object.assign(current.style, { marginTop: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' });
    const lastEvent = document.createElement('div');
    Object.assign(lastEvent.style, { marginTop: '8px', padding: '6px 8px', background: '#0b1220', borderRadius: '6px', fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#94a3b8', minHeight: '28px', wordBreak: 'break-all' });
    body.appendChild(stats);
    body.appendChild(current);
    body.appendChild(lastEvent);

    const buttons = document.createElement('div');
    Object.assign(buttons.style, { padding: '10px 12px', borderTop: '1px solid #1e293b', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' });
    function mkBtn(label, onclick, style) {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        padding: '6px 8px', borderRadius: '6px', border: '0', cursor: 'pointer',
        background: '#334155', color: '#f8fafc', fontSize: '11px', fontWeight: '600',
      }, style || {});
      b.onclick = onclick;
      return b;
    }
    const pauseBtn = mkBtn('Pause', () => {
      runtimeControls.paused = !runtimeControls.paused;
      pauseBtn.textContent = runtimeControls.paused ? 'Resume' : 'Pause';
    });
    const stopBtn = mkBtn('Stop', () => { runtimeControls.stopped = true; }, { background: '#7f1d1d' });
    const exportBtn = mkBtn('Export JSON', () => exportCurrent());
    const clearBtn = mkBtn('Clear Saved', () => { clearState(); alert('Saved progress cleared. Run bookmarklet again to start over.'); });
    const copyDebugBtn = mkBtn('Copy Logs', async () => {
      const ok = await copyToClipboard(JSON.stringify(debugLogs, null, 2));
      copyDebugBtn.textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(() => { copyDebugBtn.textContent = 'Copy Logs'; }, 1500);
    });
    const submitBtn = mkBtn('Submit Now', () => submitCurrent(), { background: '#15803d' });

    buttons.appendChild(pauseBtn); buttons.appendChild(stopBtn); buttons.appendChild(exportBtn);
    buttons.appendChild(clearBtn); buttons.appendChild(copyDebugBtn); buttons.appendChild(submitBtn);

    wrap.appendChild(header); wrap.appendChild(body); wrap.appendChild(buttons);
    document.body.appendChild(wrap);

    overlayEls = { wrap, stats, current, lastEvent, pauseBtn };
    updateOverlay(state);
  }
  function updateOverlay(state) {
    if (!overlayEls) return;
    const total = state.queue?.length || 0;
    const captured = Object.values(state.captured || {});
    const success = Object.values(state.status || {}).filter((s) => s === 'success').length;
    const failed = Object.values(state.status || {}).filter((s) => s === 'failed').length;
    const totalRetries = Object.values(state.retries || {}).reduce((a, b) => a + (b || 0), 0);
    const cur = state.queue?.[state.cursor] || null;
    overlayEls.stats.innerHTML =
      `<div><b>${escapeHtml(state.courseTitle || 'Course')}</b></div>` +
      `<div style="margin-top:4px;color:#94a3b8">Queue: <b style="color:#e2e8f0">${total}</b> · Cursor: <b style="color:#e2e8f0">${state.cursor || 0}</b></div>` +
      `<div style="color:#94a3b8">✓ Success: <span style="color:#22c55e">${success}</span> · ✗ Failed: <span style="color:#ef4444">${failed}</span> · Retries: ${totalRetries}</div>`;
    overlayEls.current.innerHTML = cur
      ? `<div style="color:#94a3b8;font-size:10px">CURRENT (${cur.index + 1}/${total})</div><div style="margin-top:2px">${escapeHtml(cur.title)}</div><div style="color:#64748b;font-size:10px;margin-top:2px">${escapeHtml(cur.sectionTitle || '')}</div>`
      : `<div style="color:#94a3b8">${state.cursor >= total ? 'Done.' : 'Idle.'}</div>`;
  }
  function renderOverlayLastEvent(entry) {
    if (!overlayEls?.lastEvent) return;
    overlayEls.lastEvent.textContent = `${entry.event}: ${JSON.stringify(entry.payload).slice(0, 200)}`;
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ── Clipboard / submit ───────────────────────────────────────────────────
  async function copyToClipboard(text) {
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }
  function buildFinalPayload(state) {
    const lessons = (state.queue || []).map((q) => state.captured[q.urlKey] || {
      lesson_title: q.title, lesson_url: q.url, section_title: q.sectionTitle, lesson_index: q.index,
      capture_issue: 'not_captured',
    });
    return {
      source: VERSION,
      course_title: state.courseTitle,
      course_url: state.courseUrl,
      lesson_count: lessons.length,
      lessons,
      debug_logs: debugLogs,
      started_at: state.startedAt,
      completed_at: new Date().toISOString(),
      // Back-compat fields for the existing import-course-capture endpoint
      platform: 'circle',
      capture_mode: 'state_machine_v2',
      title: state.courseTitle,
      source_url: state.courseUrl,
    };
  }
  async function exportCurrent() {
    const state = loadState();
    if (!state) { alert('No saved state to export.'); return; }
    const payload = buildFinalPayload(state);
    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);
    if (ok) alert('JSON copied to clipboard.');
    else showJsonModal(json);
  }
  async function submitCurrent() {
    const state = loadState();
    if (!state) { alert('No saved state to submit.'); return; }
    const payload = buildFinalPayload(state);
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
    alert(ok
      ? 'JSON copied. Paste it into the Circle Import panel in the app.'
      : 'Could not copy. Use Export JSON.');
  }
  function showJsonModal(text) {
    const id = '__circle_capture_modal';
    document.getElementById(id)?.remove();
    const overlay = document.createElement('div'); overlay.id = id;
    Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483646', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    const card = document.createElement('div');
    Object.assign(card.style, { background: '#fff', color: '#111', borderRadius: '10px', width: 'min(640px,92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' });
    const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true;
    Object.assign(ta.style, { flex: '1', minHeight: '300px', margin: '12px', fontFamily: 'ui-monospace, monospace', fontSize: '11px' });
    const close = document.createElement('button'); close.textContent = 'Close';
    Object.assign(close.style, { margin: '0 12px 12px', padding: '6px 12px', cursor: 'pointer' });
    close.onclick = () => overlay.remove();
    card.appendChild(ta); card.appendChild(close); overlay.appendChild(card); document.body.appendChild(overlay);
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  }

  // ── Banner ───────────────────────────────────────────────────────────────
  function showBanner(message, kind) {
    const id = '__circle_capture_banner_v2';
    document.getElementById(id)?.remove();
    const div = document.createElement('div');
    div.id = id;
    const bg = kind === 'error' ? '#b91c1c' : kind === 'warn' ? '#a16207' : '#15803d';
    Object.assign(div.style, {
      position: 'fixed', top: '12px', left: '12px', maxWidth: '420px',
      zIndex: '2147483647', background: bg, color: '#fff',
      padding: '10px 14px', borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px', lineHeight: '1.4', whiteSpace: 'pre-wrap',
    });
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => { if (div.parentNode) div.remove(); }, 8000);
  }

  // ── Resume prompt ────────────────────────────────────────────────────────
  function askResume(state) {
    const remaining = (state.queue?.length || 0) - (state.cursor || 0);
    const captured = Object.keys(state.captured || {}).length;
    const msg = `Saved Circle capture found for this course.\n\n` +
      `Queue: ${state.queue?.length || 0} lessons\n` +
      `Captured so far: ${captured}\n` +
      `Cursor at: ${state.cursor}\n` +
      `Remaining: ${remaining}\n\n` +
      `OK = Resume\nCancel = Choose another action`;
    if (confirm(msg)) return 'resume';
    const choice = prompt('Type:\n  restart   – clear and rebuild queue\n  export    – copy current JSON\n  clear     – delete saved state\n  cancel    – do nothing', 'restart');
    if (!choice) return 'cancel';
    const c = choice.trim().toLowerCase();
    if (['restart', 'export', 'clear'].includes(c)) return c;
    return 'cancel';
  }

  // ── Main runner ──────────────────────────────────────────────────────────
  async function runCourseScrape() {
    debugLog('boot:start', { mode: CAPTURE_MODE, url: location.href });
    let state = loadState();
    if (state) {
      debugLog('state:loaded', { cursor: state.cursor, queue: state.queue?.length });
      const choice = askResume(state);
      if (choice === 'cancel') { return; }
      if (choice === 'export') { await exportCurrent(); return; }
      if (choice === 'clear') { clearState(); state = null; }
      if (choice === 'restart') { clearState(); state = null; }
      // 'resume' falls through with existing state
    }
    if (!state) {
      state = newEmptyState();
      state.startedAt = new Date().toISOString();
      state.courseTitle = deriveCourseTitle();
      state.courseUrl = location.href.split('#')[0];
    }

    buildOverlay(state);

    if (!state.queue?.length) {
      try {
        state.queue = await buildLessonQueue();
      } catch (e) {
        debugLog('queue:error', { error: String(e?.message || e) });
        showBanner('Could not build lesson queue: ' + (e?.message || e), 'error');
        return;
      }
      if (!state.queue || state.queue.length < 2) {
        showBanner(
          'Could not discover ≥2 lessons in the Circle sidebar.\n' +
          'Open the right-hand Lessons drawer, then run again.\n' +
          'Use “Copy Logs” for diagnostics.',
          'error'
        );
        debugLog('queue:insufficient', { count: state.queue?.length || 0 });
        // Still persist so the user can copy logs
        state.debug_logs = debugLogs.slice();
        saveState(state);
        return;
      }
      saveState(state);
    }

    updateOverlay(state);

    for (let i = state.cursor || 0; i < state.queue.length; i++) {
      if (runtimeControls.stopped) { debugLog('run:stopped_by_user', { cursor: i }); break; }
      while (runtimeControls.paused) { await sleep(400); if (runtimeControls.stopped) break; }
      if (runtimeControls.stopped) break;

      const item = state.queue[i];
      state.cursor = i;
      saveState(state);
      updateOverlay(state);

      try {
        await navigateWithRetry(item, state);
        const capture = await extractCurrentLessonScoped(item);
        capture.course_title = state.courseTitle;
        capture.course_url = state.courseUrl;
        state.captured[item.urlKey] = capture;
        state.status[item.urlKey] = capture.capture_issue ? 'partial' : 'success';
      } catch (err) {
        const msg = String(err?.message || err);
        debugLog('lesson:failed', { item: item.urlKey, error: msg });
        state.status[item.urlKey] = 'failed';
        state.errors[item.urlKey] = msg;
        state.captured[item.urlKey] = {
          lesson_title: item.title,
          lesson_url: item.url,
          section_title: item.sectionTitle,
          lesson_index: item.index,
          capture_issue: 'lesson_failed',
          error: msg,
        };
      }

      state.cursor = i + 1;
      state.debug_logs = debugLogs.slice();
      saveState(state);
      updateOverlay(state);
    }

    debugLog('run:complete', {
      total: state.queue.length,
      success: Object.values(state.status).filter((s) => s === 'success').length,
      failed: Object.values(state.status).filter((s) => s === 'failed').length,
      partial: Object.values(state.status).filter((s) => s === 'partial').length,
    });

    const payload = buildFinalPayload(state);
    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);
    if (ok) {
      showBanner(`Done. ${state.queue.length} lessons processed. JSON copied — paste into the Circle Import panel.`, 'info');
    } else {
      showJsonModal(json);
      showBanner('Done. Clipboard blocked — copy the JSON from the dialog.', 'warn');
    }
  }

  // ── Single-lesson mode ───────────────────────────────────────────────────
  async function runSingleLessonScrape() {
    debugLog('boot:start', { mode: 'single', url: location.href });
    const item = {
      index: 0,
      url: location.href.split('#')[0],
      urlKey: canonicalLessonKey(location.href),
      title: findLessonTitleInMain() || document.title,
      sectionTitle: '',
    };
    let capture;
    try {
      capture = await extractCurrentLessonScoped(item);
    } catch (e) {
      showBanner('Capture failed: ' + (e?.message || e), 'error');
      return;
    }
    capture.course_title = deriveCourseTitle();
    capture.course_url = location.href.split('#')[0];
    const payload = {
      source: VERSION,
      platform: 'circle',
      capture_mode: 'single_lesson_v2',
      title: capture.course_title,
      source_url: capture.course_url,
      course_title: capture.course_title,
      course_url: capture.course_url,
      lesson_count: 1,
      lessons: [capture],
      debug_logs: debugLogs,
    };
    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);
    if (ok) showBanner(`1 lesson captured: ${capture.lesson_title}\nJSON copied.`, capture.capture_issue ? 'warn' : 'info');
    else showJsonModal(json);
  }

  // ── Entrypoint ───────────────────────────────────────────────────────────
  (async function main() {
    try {
      if (CAPTURE_MODE === 'single') {
        await runSingleLessonScrape();
      } else {
        await runCourseScrape();
      }
    } catch (e) {
      debugLog('boot:error', { error: String(e?.message || e) });
      showBanner('Bookmarklet error: ' + (e?.message || e), 'error');
    }
  })();
})();
