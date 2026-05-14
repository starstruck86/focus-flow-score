/**
 * Circle Course Capture Bookmarklet
 * --------------------------------------------------------------------------
 * Runs INSIDE the user's already-authenticated Circle browser tab.
 *
 * Strategy:
 *   • Designed to be run from an INDIVIDUAL LESSON PAGE (the screenshot:
 *     "Lesson X of Y", title, video, captions, "Show transcript", Takeaways,
 *     Resources Mentioned, sidebar with all lessons, next/prev arrows).
 *   • Auto-walks the course from Lesson 1 by clicking only the visible
 *     right-arrow next-lesson control until "Lesson X of Y" reaches Y.
 *   • For each lesson it captures:
 *       url, lesson_number, title, body_text (caption + Takeaways + Resources +
 *       any other lesson body text), media_url (video iframe src), transcript
 *       (auto-clicks "Show transcript" if present), resources [{title, url}].
 *   • Then copies one JSON payload to the clipboard for the user to paste
 *     into the app's Circle Import panel.
 *
 * If run from a course-index page (no "Lesson X of Y" visible), it asks the
 * user to open a lesson first.
 */
(function () {
  'use strict';

  const log = (...args) => { try { console.log('[Circle Capture]', ...args); } catch (_) {} };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const safeText = (el) => el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const abs = (url) => { try { return new URL(url, location.href).toString(); } catch (_) { return ''; } };

  // ── Read mode from script URL params ─────────────────────────────────────
  const CAPTURE_MODE = (() => {
    try {
      const scripts = document.querySelectorAll('script[src*="circle-capture"]');
      const last = scripts[scripts.length - 1];
      if (last) {
        const u = new URL(last.src);
        const m = u.searchParams.get('mode');
        if (['single','course','debug-nav','inspect','probe'].includes(m)) return m;
      }
    } catch (_) {}
    return 'course';
  })();

  log('starting, mode=' + CAPTURE_MODE);

  // ── Banner UI ────────────────────────────────────────────────────────────

  function showBanner(message, kind, persist) {
    const id = '__circle_capture_banner';
    document.getElementById(id)?.remove();
    const div = document.createElement('div');
    div.id = id;
    const bg = kind === 'error' ? '#b91c1c' : kind === 'warn' ? '#a16207' : '#15803d';
    Object.assign(div.style, {
      position: 'fixed', top: '12px', right: '12px', maxWidth: '420px',
      zIndex: '2147483647', background: bg, color: '#fff',
      padding: '12px 16px', borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px', lineHeight: '1.4',
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)', whiteSpace: 'pre-wrap',
    });
    div.textContent = message;
    document.body.appendChild(div);
    if (!persist) setTimeout(() => { if (div.parentNode) div.remove(); }, 15000);
    return div;
  }

  function showJsonModal(text) {
    const id = '__circle_capture_modal';
    document.getElementById(id)?.remove();
    const overlay = document.createElement('div');
    overlay.id = id;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646',
      background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
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
    body.textContent = 'Clipboard access was blocked. Select all the JSON below, copy it, then paste it into the Circle Import panel in the app.';
    const ta = document.createElement('textarea');
    ta.value = text; ta.readOnly = true;
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
    copyBtn.onclick = () => { ta.select(); try { document.execCommand('copy'); } catch (_) {} copyBtn.textContent = 'Copied!'; };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    Object.assign(closeBtn.style, {
      padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db',
      background: '#fff', color: '#111', cursor: 'pointer', fontSize: '12px',
    });
    closeBtn.onclick = () => overlay.remove();
    footer.appendChild(copyBtn); footer.appendChild(closeBtn);
    card.appendChild(header); card.appendChild(body); card.appendChild(ta); card.appendChild(footer);
    overlay.appendChild(card); document.body.appendChild(overlay);
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }

  // ── Lesson X of Y parsing ───────────────────────────────────────────────

  /**
   * Find the "Lesson X of Y" indicator anywhere in the live DOM.
   * Returns { current, total, el } or null.
   */
  function findLessonOfIndicator(root) {
    root = root || document;
    // Walk text nodes; cheap because Circle's main column has limited text.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    const re = /Lesson\s+(\d+)\s+of\s+(\d+)/i;
    while ((node = walker.nextNode())) {
      const m = node.nodeValue && node.nodeValue.match(re);
      if (m) {
        return {
          current: parseInt(m[1], 10),
          total: parseInt(m[2], 10),
          el: node.parentElement,
        };
      }
    }
    return null;
  }

  // ── Page-mode detection ─────────────────────────────────────────────────

  function detectPageMode() {
    const path = location.pathname || '';
    const indicator = findLessonOfIndicator();
    const hasLessonUrl = /\/lessons\/[^/?#]+|\/posts\/[^/?#]+/i.test(path);
    const hasPostBody = !!document.querySelector(
      '[data-testid="post-body"], [data-testid*="lesson-content"], [data-testid*="post-content"], .trix-content'
    );
    const hasVideo = !!document.querySelector(
      'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"], video'
    );

    const mode = (indicator || hasLessonUrl || hasPostBody || hasVideo) ? 'lesson' : 'index';
    log('mode detection', { path, indicator, hasLessonUrl, hasPostBody, hasVideo, mode });
    return { mode, indicator };
  }

  // ── Course title ─────────────────────────────────────────────────────────

  function deriveCourseTitle() {
    // Top bar of a lesson page typically shows the course name.
    // The screenshot shows "Cold Calls to President's Club" in an <h1>-ish
    // header at top-left of the lesson view.
    const header = document.querySelector(
      'header h1, [data-testid*="header"] h1, [class*="header"] h1, [class*="course-title"]'
    );
    const fromHeader = safeText(header);
    if (fromHeader && fromHeader.length < 200) return fromHeader;
    // Sidebar root title
    const sideTitle = safeText(document.querySelector('[data-testid*="sidebar"] h1, aside h1'));
    if (sideTitle) return sideTitle;
    return (document.title || 'Untitled Circle Course').slice(0, 300);
  }

  // ── Current lesson DOM extraction ───────────────────────────────────────

  /**
   * Click the "Show transcript" affordance, wait for the transcript region to
   * mount, capture its text, then collapse it again. Returns a string ('' if
   * no transcript was found).
   */
  async function captureTranscript() {
    // Look for "Show transcript" trigger.
    const all = Array.from(document.querySelectorAll('button, a, [role="button"], summary, [aria-expanded], span, div'));
    const triggers = all.filter(el => {
      const t = safeText(el);
      if (!t || t.length > 60) return false;
      return /\b(show|view|open|toggle|expand)\s+transcript\b/i.test(t) || /^transcript$/i.test(t);
    });

    let transcriptText = '';
    let transcriptModalFound = false;
    let transcriptChars = 0;

    if (triggers.length === 0) {
      log('transcript capture: no trigger found');
      return { text: '', transcript_modal_found: false, transcript_chars: 0 };
    }

    // Count existing dialogs before click so we can detect new ones.
    const dialogsBefore = document.querySelectorAll('[role="dialog"]').length;

    for (const trigger of triggers) {
      try { trigger.scrollIntoView({ block: 'center' }); } catch (_) {}
      try { trigger.click(); } catch (_) { continue; }
      await sleep(400);

      // Strategy 1: Wait for a [role="dialog"] modal to appear.
      const start = Date.now();
      let modal = null;
      while (Date.now() - start < 5000) {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        // Pick a dialog that appeared after the click.
        modal = dialogs.length > dialogsBefore ? dialogs[dialogs.length - 1] : null;
        // Also check if any dialog now has substantial text (>120 chars).
        if (!modal) {
          modal = dialogs.find(d => safeText(d).length > 120);
        }
        if (modal && safeText(modal).length > 120) break;
        modal = null;
        await sleep(200);
      }

      if (modal) {
        transcriptModalFound = true;
        transcriptText = safeText(modal);
        transcriptChars = transcriptText.length;
        log('transcript capture: modal found', { chars: transcriptChars });

        // Close the modal.
        const closeBtn = modal.querySelector('button[aria-label="Close"], button[aria-label="close"], [class*="close"]');
        if (closeBtn) {
          try { closeBtn.click(); } catch (_) {}
        } else {
          // Try pressing Escape.
          try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
        }
        await sleep(300);
        break;
      }

      // Strategy 2: Fallback — check for transcript containers that appeared inline.
      const containers = Array.from(document.querySelectorAll(
        '[id*="transcript" i], [class*="transcript" i], [data-testid*="transcript" i], [class*="caption" i]'
      ));
      for (const c of containers) {
        const t = safeText(c);
        if (t.length > 120) {
          transcriptText = t;
          transcriptChars = t.length;
          log('transcript capture: inline container found', { chars: transcriptChars });
          break;
        }
      }
      if (transcriptText) break;
    }

    log('transcript capture result', { triggersFound: triggers.length, modal: transcriptModalFound, chars: transcriptChars });
    return { text: transcriptText, transcript_modal_found: transcriptModalFound, transcript_chars: transcriptChars };
  }

  /**
   * Classify a URL into a coarse resource type used downstream.
   */
  function inferResourceType(url) {
    const u = (url || '').toLowerCase();
    if (/\.pdf(\?|#|$)/.test(u)) return 'pdf';
    if (/\.(docx?|rtf|odt)(\?|#|$)/.test(u) || /docs\.google\.com\/document/.test(u)) return 'doc';
    if (/\.(xlsx?|csv|ods)(\?|#|$)/.test(u) || /docs\.google\.com\/spreadsheets/.test(u)) return 'sheet';
    if (/\.(pptx?|key|odp)(\?|#|$)/.test(u) || /docs\.google\.com\/presentation/.test(u)) return 'slide';
    if (/\bdownload\b/.test(u) || /\.(zip|rar|7z|tar|gz)(\?|#|$)/.test(u)) return 'download';
    if (/notion\.so|notion\.site/.test(u)) return 'doc';
    if (/^https?:\/\//.test(u)) return 'link';
    return 'unknown';
  }

  /**
   * Decide whether a URL should be excluded (Circle nav, sidebar, profile,
   * lesson/section/post links inside Circle, anchors, mailto, javascript:).
   */
  function isExcludedResourceUrl(url) {
    const raw = (url || '').trim();
    if (!raw) return true;
    if (/^(mailto:|javascript:|tel:|#)/i.test(raw)) return true;
    let u;
    try { u = new URL(raw, location.href); } catch { return true; }
    // Strip pure same-page anchors (no path, no host change).
    if (!u.host) return true;
    // Exclude Circle internal navigation (lessons, posts, sections, members,
    // settings, notifications, search, etc.) — but only on the same Circle host.
    if (u.host === location.host) {
      const p = u.pathname || '';
      if (
        /\/lessons?\//i.test(p) ||
        /\/posts?\//i.test(p) ||
        /\/sections?\//i.test(p) ||
        /\/members?\//i.test(p) ||
        /\/profile/i.test(p) ||
        /\/settings/i.test(p) ||
        /\/notifications/i.test(p) ||
        /\/search/i.test(p) ||
        /\/spaces?\//i.test(p) ||
        /\/c\/[^/]+\/?$/i.test(p) ||      // course root
        p === '/' || p === ''
      ) return true;
    }
    return false;
  }

  /**
   * Collect external link from one DOM block, pushing into out & seen-set.
   */
  function collectLinksFrom(block, out, seen, sourceLabel) {
    if (!block) return '';
    const anchors = block.querySelectorAll('a[href]');
    anchors.forEach(a => {
      const href = a.getAttribute('href');
      const url = abs(href);
      if (!url || isExcludedResourceUrl(url)) return;
      const norm = url.split('#')[0].replace(/\/+$/, '').toLowerCase();
      if (seen.has(norm)) return;
      seen.add(norm);
      const title =
        safeText(a) ||
        a.getAttribute('aria-label') ||
        a.getAttribute('title') ||
        url;
      out.push({
        title: title.slice(0, 300),
        url,
        type: inferResourceType(url),
        source_section: sourceLabel,
      });
    });
    return safeText(block);
  }

  /**
   * Collect resources mentioned in the lesson:
   *   1. Explicit "Resources Mentioned" section (highest priority)
   *   2. Any other external links inside the lesson body container
   * Returns { resources, text } where `text` is the rendered "Resources Mentioned"
   * section text used for display.
   */
  function captureResources() {
    const resources = [];
    const seen = new Set();
    let text = '';

    // 1. Explicit Resources section.
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, strong, [class*="heading"]'));
    const heading = headings.find(h => /resources?\s+mentioned/i.test(safeText(h)));
    if (heading) {
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
      for (const block of collected) {
        const t = collectLinksFrom(block, resources, seen, 'resources_mentioned');
        text += (text ? '\n' : '') + t;
      }
    }

    // 2. All other in-body links — anything inside the main lesson container
    // that isn't a Circle internal nav. This catches inline links and
    // download links that aren't under a "Resources Mentioned" heading.
    const bodyEl =
      document.querySelector('[data-testid="post-body"]') ||
      document.querySelector('[data-testid*="lesson-content"]') ||
      document.querySelector('[data-testid*="post-content"]') ||
      document.querySelector('article') ||
      document.querySelector('.trix-content') ||
      document.querySelector('main');
    if (bodyEl) collectLinksFrom(bodyEl, resources, seen, 'lesson_body');

    return { resources, text };
  }

  /**
   * Find the section under a heading like "Takeaways" and return its text.
   */
  function captureSectionByHeading(headingRe) {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, strong, [class*="heading"]'));
    const heading = headings.find(h => headingRe.test(safeText(h)));
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

  function findVideoUrl() {
    const iframe = document.querySelector(
      'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"], iframe[src*="mux"], iframe[src*="stream"], iframe[src*="cloudflare"], iframe[src*="mediadelivery"], iframe[src*="bunny"], iframe[src*="sproutvideo"], iframe[src*="vidyard"]'
    );
    if (iframe) return abs(iframe.getAttribute('src')) || undefined;
    const a = document.querySelector(
      'a[href*="wistia"], a[href*="vimeo"], a[href*="youtube"], a[href*="youtu.be"], a[href*="loom"], a[href*="mux"], a[href*="stream"], a[href*="cloudflare"], a[href*="mediadelivery"], a[href*="bunny"], a[href*="sproutvideo"], a[href*="vidyard"], a[href*=".m3u8"], a[href*=".mp4"]'
    );
    if (a) return abs(a.getAttribute('href')) || undefined;
    const v = document.querySelector('video');
    const videoSrc = v && (v.currentSrc || v.getAttribute('src') || v.getAttribute('data-src') || v.getAttribute('poster'));
    if (videoSrc) return abs(videoSrc) || videoSrc;
    const vsrc = document.querySelector('video source[src], video source[data-src], source[src*=".m3u8"], source[src*=".mp4"]');
    if (vsrc) return abs(vsrc.getAttribute('src') || vsrc.getAttribute('data-src')) || undefined;
    const genericFrame = Array.from(document.querySelectorAll('iframe[src], embed[src], object[data]'))
      .map(el => el.getAttribute('src') || el.getAttribute('data') || '')
      .map(abs)
      .find(url => url && !/about:blank|recaptcha|captcha|intercom|stripe|analytics|segment|googletagmanager/i.test(url));
    if (genericFrame) return genericFrame;
    return undefined;
  }

  /**
   * Pick the lesson title from the main column (NOT the course header).
   * The screenshot shows it as a large heading directly under "Lesson X of Y".
   */
  function findLessonTitle(indicatorEl) {
    if (indicatorEl) {
      // Walk up a few levels and look for the first sibling heading.
      let cursor = indicatorEl;
      for (let i = 0; i < 5 && cursor; i++) {
        const h = cursor.parentElement?.querySelector('h1, h2, h3');
        if (h && safeText(h) && safeText(h) !== safeText(indicatorEl)) {
          return safeText(h).slice(0, 300);
        }
        cursor = cursor.parentElement;
      }
    }
    // Fallback: largest heading in <main>
    const main = document.querySelector('main') || document.body;
    const heads = Array.from(main.querySelectorAll('h1, h2'));
    for (const h of heads) {
      const t = safeText(h);
      if (t && t.length > 3 && t.length < 200) return t.slice(0, 300);
    }
    return '';
  }

  function getMainContentText() {
    const el =
      document.querySelector('[data-testid="post-body"]') ||
      document.querySelector('[data-testid*="lesson-content"]') ||
      document.querySelector('[data-testid*="post-content"]') ||
      document.querySelector('article') ||
      document.querySelector('.trix-content') ||
      document.querySelector('main') ||
      document.body;
    return safeText(el);
  }

  function textHash(text) {
    let h = 0;
    const s = text || '';
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  function getLessonState() {
    const indicator = findLessonOfIndicator();
    const title = findLessonTitle(indicator?.el);
    const mainText = getMainContentText();
    return {
      url: location.href.split('#')[0],
      title,
      lesson_number: indicator?.current,
      total_lessons: indicator?.total,
      content_hash: textHash(mainText),
      content_chars: mainText.length,
      indicator_el: indicator?.el || null,
    };
  }

  /**
   * Extract everything for the currently rendered lesson.
   */
  async function extractCurrentLesson() {
    const indicator = findLessonOfIndicator();
    const title = findLessonTitle(indicator?.el);
    const media_url = findVideoUrl();
    const selectorsMatched = [];

    const takeaways = captureSectionByHeading(/^takeaways?$/i);
    if (takeaways) selectorsMatched.push('takeaways');
    const { resources, text: resourcesText } = captureResources();
    if (resources.length) selectorsMatched.push(`resources(${resources.length})`);

    // Body region — try multiple selectors, prefer ones with the most text.
    const candidates = [
      ['[data-testid="post-body"]', document.querySelector('[data-testid="post-body"]')],
      ['[data-testid*="lesson-content"]', document.querySelector('[data-testid*="lesson-content"]')],
      ['[data-testid*="post-content"]', document.querySelector('[data-testid*="post-content"]')],
      ['article', document.querySelector('article')],
      ['.trix-content', document.querySelector('.trix-content')],
      ['main', document.querySelector('main')],
    ].filter(([, el]) => el);

    // Anchor-based fallback: section containing "Takeaways" or "Resources Mentioned".
    const anchorEl = (() => {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,strong,[class*="heading"]'));
      const h = headings.find(el => /takeaways?|resources?\s+mentioned/i.test(safeText(el)));
      if (!h) return null;
      // climb to a meaningful parent section
      let p = h.parentElement, best = h;
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
        if (safeText(p).length > safeText(best).length) best = p;
      }
      return best;
    })();
    if (anchorEl) candidates.push(['anchor:takeaways/resources', anchorEl]);

    // Pick the candidate with the most text.
    let bodyEl = null, bodyAll = '';
    for (const [name, el] of candidates) {
      const t = safeText(el);
      if (t.length > bodyAll.length) { bodyAll = t; bodyEl = el; selectorsMatched.push(`body:${name}`); }
    }

    if (takeaways) bodyAll = bodyAll.replace(takeaways, '').replace(/\s+/g, ' ').trim();
    if (resourcesText) bodyAll = bodyAll.replace(resourcesText, '').replace(/\s+/g, ' ').trim();

    const transcriptResult = await captureTranscript();
    const transcript = transcriptResult.text || '';
    if (transcript) {
      selectorsMatched.push('transcript');
      bodyAll = bodyAll.replace(transcript, '').replace(/\s+/g, ' ').trim();
    }

    const parts = [];
    if (bodyAll) parts.push(bodyAll);
    if (takeaways) parts.push(`\n\nTakeaways\n${takeaways}`);
    if (resourcesText) parts.push(`\n\nResources Mentioned\n${resourcesText}`);
    const body_text = parts.join('').trim() || undefined;

    const debugInfo = {
      hasBodyText: body_text ? body_text.length : 0,
      hasTranscript: !!transcript,
      transcript_modal_found: transcriptResult.transcript_modal_found,
      transcript_chars: transcriptResult.transcript_chars,
      resourceCount: resources.length,
      hasMedia: !!media_url,
      selectorsMatched,
    };
    log('lesson extraction', debugInfo);

    return {
      url: location.href.split('#')[0],
      lesson_number: indicator ? indicator.current : undefined,
      total_lessons: indicator ? indicator.total : undefined,
      title: title || (indicator ? `Lesson ${indicator.current}` : 'Untitled lesson'),
      body_text,
      media_url,
      transcript: transcript || undefined,
      resources: resources.length ? resources : undefined,
      _debug: debugInfo,
    };
  }

  // ── Auto-walk navigation ────────────────────────────────────────────────

  /**
   * Determine if a URL looks like the course root / index page.
   * Course roots: /c/<slug>, /c/<slug>/, /c/<slug>?..., or path ending without /lessons/ or /posts/.
   */
  function isCourseRootUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.href);
      const p = u.pathname.replace(/\/+$/, '');
      // Course root patterns: /c/<slug> with no deeper path
      if (/^\/c\/[^/]+$/.test(p)) return true;
      // No /lessons/ or /posts/ segment = likely not a lesson page
      if (!/\/(lessons?|posts?)\//.test(p)) return true;
      return false;
    } catch (_) { return false; }
  }

  function isLessonPageUrl(url) {
    try {
      const u = new URL(url, location.href);
      return u.host === location.host && /\/(lessons?|posts?)\/[^/?#]+/i.test(u.pathname || '');
    } catch (_) { return false; }
  }

  function lessonUrlKey(url) {
    try {
      const u = new URL(url, location.href);
      return `${u.origin}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
    } catch (_) { return String(url || '').split('#')[0].replace(/\/+$/, '').toLowerCase(); }
  }

  function stripLessonLinkInfo(info) {
    if (!info) return null;
    const { el, ...rest } = info;
    return rest;
  }

  function discoverLessonLinkSequence() {
    const seen = new Set();
    const links = [];
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = abs(a.getAttribute('href'));
      if (!href || !isLessonPageUrl(href) || isCourseRootUrl(href)) continue;
      if (!isVisible(a) || isDisabled(a)) continue;
      const key = lessonUrlKey(href);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        el: a,
        href,
        key,
        text: safeText(a).slice(0, 160),
        rect: rectInfo(a),
        inSidebar: !!a.closest('aside, [data-testid*="sidebar" i], [class*="sidebar" i], [aria-label*="sidebar" i]'),
        inNav: !!a.closest('nav, [role="navigation"], [role="banner"]'),
      });
    }
    log('lessonLinkSequence', links.map(stripLessonLinkInfo));
    return links;
  }

  function chooseAdjacentLessonLink(direction, before, sequence) {
    if (!sequence || sequence.length < 2) return { candidate: null, reason: 'not_enough_visible_lesson_links' };
    const currentKey = lessonUrlKey(before?.url || location.href);
    let currentIndex = sequence.findIndex(l => l.key === currentKey);
    if (currentIndex < 0 && before?.lesson_number && sequence[before.lesson_number - 1]) currentIndex = before.lesson_number - 1;
    if (currentIndex < 0) return { candidate: null, reason: 'current_lesson_not_found_in_visible_lesson_links' };
    const targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sequence.length) return { candidate: null, reason: 'no_adjacent_lesson_link' };
    const candidate = sequence[targetIndex];
    if (!candidate || candidate.key === currentKey || !isLessonPageUrl(candidate.href) || isCourseRootUrl(candidate.href)) return { candidate: null, reason: 'adjacent_link_was_not_a_lesson_url' };
    return { candidate, reason: null, currentIndex, targetIndex };
  }

  /**
   * Check if a candidate button/link should be excluded from navigation.
   * Excludes: back buttons, course title links, overview links, sidebar toggles,
   * completed buttons, section headers.
   */
  function isBadNavigationCandidate(el) {
    const text = safeText(el).toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const href = (el.getAttribute('href') || '').toLowerCase();
    const combined = `${text} ${ariaLabel} ${title}`;

    // Exclude back/overview/home links
    if (/\b(back|overview|home|all\s+lessons|course\s+home|return|go\s+back)\b/.test(combined)) return 'back/overview/home';
    // Exclude course title links (long text, not arrow-like)
    if (text.length > 40) return 'text_too_long';
    // Exclude sidebar open/close toggles
    if (/\b(menu|sidebar|hamburger|toggle\s+nav|close\s+nav|open\s+nav)\b/.test(combined)) return 'sidebar_toggle';
    // Exclude completion/mark-complete buttons
    if (/\b(complete|mark\s+as|completed|finish)\b/.test(combined)) return 'completion_button';
    // Exclude section header links
    if (/\b(section|module|chapter)\b/.test(combined) && !/lesson/i.test(combined)) return 'section_header';
    // Exclude top-nav header icons (bookmarks, table of contents, courses, etc.)
      if (/\b(bookmark|toc|contents?|curriculum|syllabus|table\s+of\s+contents?|course\s+content|courses|notification|search|profile|settings|account)\b/.test(combined)) return 'header_icon';
    // Exclude links to /courses
    if (href === '/courses' || href.startsWith('/courses?')) return 'courses_link';

    // Exclude links whose href resolves to course root
    if (href && el.tagName === 'A') {
      try {
        const resolved = new URL(href, location.href).href;
        if (isCourseRootUrl(resolved)) return 'href_is_course_root';
      } catch (_) {}
    }

    // Exclude global navigation, but allow the lesson header itself: Circle's
    // previous/next arrows may live in a semantic <header> beside "Lesson X of Y".
    const navLike = el.closest('nav, [role="navigation"], [role="banner"]');
    if (navLike) return 'global_nav';
    const headerLike = el.closest('header');
    if (headerLike && !findLessonOfIndicator(headerLike)) return 'global_header';

    return null; // Not bad
  }

  function rectInfo(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      left: Math.round(r.left),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function isDisabled(el) {
    return !!(el.disabled || el.getAttribute('disabled') != null || el.getAttribute('aria-disabled') === 'true' || el.closest('[aria-disabled="true"]'));
  }

  function clickableSelector() {
    return 'button,[role="button"],a[href],a,[onclick],[tabindex="0"],[aria-label]';
  }

  function nearestClickable(el) {
    return el?.closest?.(clickableSelector()) || el;
  }

  function activateClick(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = Math.max(1, Math.min(window.innerWidth - 1, r.left + r.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 1, r.top + r.height / 2));
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (_) { try { el.click(); } catch (__) { return false; } }
    return true;
  }

  function scanViewportEdgeArrows(direction) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const seen = new Set();
    const fromDom = Array.from(document.querySelectorAll(clickableSelector()));
    const sampleYs = [0.28, 0.38, 0.5, 0.62, 0.72].map(p => Math.round(vh * p));
    const sampleXs = direction === 'prev' ? [2, 8, 18, 32] : [vw - 2, vw - 8, vw - 18, vw - 32];
    const fromPoints = [];
    for (const x of sampleXs) for (const y of sampleYs) {
      try {
        for (const hit of document.elementsFromPoint(x, y)) {
          const clickable = nearestClickable(hit);
          if (clickable) fromPoints.push(clickable);
        }
      } catch (_) {}
    }

    const raw = fromDom.concat(fromPoints);
    const candidates = [];
    for (const el of raw) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (!isVisible(el) || isDisabled(el) || isLikelySidebarButton(el)) continue;

      const r = el.getBoundingClientRect();
      const centerX = (r.left + r.right) / 2;
      const centerY = (r.top + r.bottom) / 2;
      if (r.bottom < 48 || r.top > vh - 36) continue;
      if (r.width < 2 || r.height < 12 || r.width > 180 || r.height > 240) continue;

      const text = safeText(el).slice(0, 120);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const href = el.getAttribute('href') || '';
      const combined = `${text} ${ariaLabel} ${title}`.toLowerCase();
      if (text.length > 80) continue;
      if (/\b(course|courses|overview|home|profile|settings|search|notification|bookmark|menu|sidebar|toc|contents?|curriculum|syllabus|table\s+of\s+contents?|course\s+content|continue|complete|mark\s+as)\b/.test(combined)) continue;
      if (href) {
        try { if (isCourseRootUrl(new URL(href, location.href).href)) continue; } catch (_) {}
      }

      const style = window.getComputedStyle(el);
      let score = 0;
      const reasons = [];
      const svgDirection = detectSvgDirection(el);

      if (direction === 'next') {
        if (r.right >= vw - 6) { score += 110; reasons.push('flush_right_edge'); }
        else if (r.right >= vw - 48) { score += 85; reasons.push('near_right_edge'); }
        else if (r.left >= vw - 150) { score += 55; reasons.push('right_rail'); }
        if (centerX > vw * 0.72) { score += 20; reasons.push('right_side'); }
        if (/right|next|forward/i.test(svgDirection + ' ' + combined)) { score += 45; reasons.push('right_signal'); }
        if (/left|prev|previous|back/i.test(svgDirection + ' ' + combined)) { score -= 90; reasons.push('left_penalty'); }
      } else {
        if (r.left <= 6) { score += 110; reasons.push('flush_left_edge'); }
        else if (r.left <= 48) { score += 85; reasons.push('near_left_edge'); }
        else if (r.right <= 150) { score += 55; reasons.push('left_rail'); }
        if (centerX < vw * 0.28) { score += 20; reasons.push('left_side'); }
        if (/left|prev|previous|back/i.test(svgDirection + ' ' + combined)) { score += 45; reasons.push('left_signal'); }
        if (/right|next|forward/i.test(svgDirection + ' ' + combined)) { score -= 90; reasons.push('right_penalty'); }
      }

      if (style.position === 'fixed' || style.position === 'sticky') { score += 5; reasons.push(style.position); }
      if (!/right|next|forward/i.test(svgDirection + ' ' + combined)) { score -= 45; reasons.push('edge_requires_explicit_right_signal'); }
      if (r.height > r.width * 1.25) { score += 18; reasons.push('vertical_pill'); }
      if (!text || text.length <= 4) { score += 8; reasons.push('icon_only'); }
      if (centerY > vh * 0.18 && centerY < vh * 0.86) { score += 12; reasons.push('middle_band'); }

      candidates.push({
        el,
        text,
        ariaLabel,
        title,
        href,
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        disabled: false,
        rect: rectInfo(el),
        svgDirection,
        score,
        reasons,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    log('viewportEdgeArrowCandidates', candidates.slice(0, 8).map(stripButtonInfo));
    return candidates;
  }

  function chooseViewportEdgeArrowCandidate(direction) {
    const candidates = scanViewportEdgeArrows(direction || 'next');
    const best = candidates.find(c => hasDirectionSignal(c, direction || 'next'));
    return best && best.score >= 70 ? best : null;
  }

  function lessonLabelText(indicator) {
    if (!indicator) return '';
    const direct = safeText(indicator.el);
    const m = direct.match(/Lesson\s+\d+\s+of\s+\d+/i);
    return m ? m[0] : `Lesson ${indicator.current} of ${indicator.total}`;
  }

  function getLessonHeaderRegion() {
    const indicator = findLessonOfIndicator();
    const indicatorEl = indicator?.el || null;
    const main = document.querySelector('main') || document.body;
    const mainRect = main.getBoundingClientRect();
    let headerEl = indicatorEl;

    if (indicatorEl) {
      let cursor = indicatorEl;
      for (let i = 0; i < 8 && cursor?.parentElement; i++) {
        const parent = cursor.parentElement;
        const r = parent.getBoundingClientRect();
        const hasTitle = !!parent.querySelector('h1,h2,h3');
        const hasButton = !!parent.querySelector('button,[role="button"],a[href]');
        if (r.height >= 35 && r.height <= 420 && (hasTitle || hasButton)) headerEl = parent;
        cursor = parent;
      }
    }

    const headerRect = headerEl ? headerEl.getBoundingClientRect() : (indicatorEl ? indicatorEl.getBoundingClientRect() : mainRect);
    const indicatorRect = indicatorEl ? indicatorEl.getBoundingClientRect() : headerRect;
    const top = Math.max(0, Math.min(headerRect.top, indicatorRect.top) - 180);
    const bottom = Math.min(window.innerHeight, Math.max(headerRect.bottom, indicatorRect.bottom) + 260);
    return {
      indicator,
      lessonLabel: lessonLabelText(indicator),
      title: findLessonTitle(indicatorEl),
      headerRect: {
        top: Math.round(top),
        left: Math.round(Math.max(0, mainRect.left)),
        right: Math.round(Math.min(window.innerWidth, mainRect.right || window.innerWidth)),
        bottom: Math.round(bottom),
        width: Math.round(Math.min(window.innerWidth, mainRect.right || window.innerWidth) - Math.max(0, mainRect.left)),
        height: Math.round(bottom - top),
      },
      centerY: Math.round((indicatorRect.top + indicatorRect.bottom) / 2),
      indicatorRect: indicatorEl ? rectInfo(indicatorEl) : null,
    };
  }

  function detectSvgDirection(el) {
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${safeText(el)}`.toLowerCase();
    if (/\b(prev|previous|back|left)\b|←|‹/.test(label)) return 'left';
    if (/\b(next|forward|right)\b|→|›/.test(label)) return 'right';
    const svgText = Array.from(el.querySelectorAll('svg, path, use'))
      .map(n => `${n.getAttribute('aria-label') || ''} ${n.getAttribute('class') || ''} ${n.getAttribute('href') || ''} ${n.getAttribute('xlink:href') || ''} ${n.outerHTML || ''}`)
      .join(' ')
      .toLowerCase();
    if (/chevron[-_\s]?left|arrow[-_\s]?left|caret[-_\s]?left|lucide-chevron-left|icon-chevron-left/.test(svgText)) return 'left';
    if (/chevron[-_\s]?right|arrow[-_\s]?right|caret[-_\s]?right|lucide-chevron-right|icon-chevron-right/.test(svgText)) return 'right';
    const visualDirection = detectSvgVisualDirection(el);
    if (visualDirection) return visualDirection;
    return '';
  }

  function pathPointsFromD(d) {
    const tokens = String(d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    const points = [];
    let i = 0, cmd = '', x = 0, y = 0;
    const isCmd = v => /^[a-zA-Z]$/.test(v || '');
    const num = v => Number(v);
    while (i < tokens.length) {
      if (isCmd(tokens[i])) cmd = tokens[i++];
      if (!cmd) break;
      const lower = cmd.toLowerCase();
      const rel = cmd === lower;
      if (lower === 'm' || lower === 'l' || lower === 't') {
        while (i + 1 < tokens.length && !isCmd(tokens[i]) && !isCmd(tokens[i + 1])) {
          const nx = num(tokens[i++]);
          const ny = num(tokens[i++]);
          x = rel ? x + nx : nx;
          y = rel ? y + ny : ny;
          points.push({ x, y });
          if (lower === 'm') cmd = rel ? 'l' : 'L';
        }
      } else if (lower === 'h') {
        while (i < tokens.length && !isCmd(tokens[i])) { x = rel ? x + num(tokens[i++]) : num(tokens[i++]); points.push({ x, y }); }
      } else if (lower === 'v') {
        while (i < tokens.length && !isCmd(tokens[i])) { y = rel ? y + num(tokens[i++]) : num(tokens[i++]); points.push({ x, y }); }
      } else {
        // Curves/arcs are not needed for Circle's chevron icons; skip their numbers safely.
        while (i < tokens.length && !isCmd(tokens[i])) i++;
      }
    }
    return points;
  }

  function inferChevronDirection(points) {
    if (!points || points.length < 3) return '';
    const xs = points.map(p => p.x).filter(Number.isFinite);
    const ys = points.map(p => p.y).filter(Number.isFinite);
    if (xs.length < 3 || ys.length < 3) return '';
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX < 2 || spanY < 2) return '';
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1], mid = points[i], next = points[i + 1];
      const yMovement = Math.abs(mid.y - prev.y) + Math.abs(next.y - mid.y);
      if (yMovement < spanY * 0.45) continue;
      if (mid.x >= Math.max(prev.x, next.x) + spanX * 0.25) return 'right';
      if (mid.x <= Math.min(prev.x, next.x) - spanX * 0.25) return 'left';
    }
    return '';
  }

  function detectSvgVisualDirection(el) {
    const shapes = Array.from(el.querySelectorAll('path[d], polyline[points], polygon[points]'));
    for (const shape of shapes) {
      const rawPoints = shape.getAttribute('points');
      const points = rawPoints
        ? (rawPoints.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number).reduce((acc, n, i, arr) => {
            if (i % 2 === 0 && Number.isFinite(n) && Number.isFinite(arr[i + 1])) acc.push({ x: n, y: arr[i + 1] });
            return acc;
          }, [])
        : pathPointsFromD(shape.getAttribute('d'));
      const direction = inferChevronDirection(points);
      if (direction) return direction;
    }
    return '';
  }

  function hasDirectionSignal(info, direction) {
    const haystack = `${info?.svgDirection || ''} ${info?.ariaLabel || ''} ${info?.title || ''} ${info?.text || ''}`;
    return direction === 'prev'
      ? /\b(left|prev|previous|back)\b|←|‹/i.test(haystack)
      : /\b(right|next|forward)\b|→|›/i.test(haystack);
  }

  function isLikelySidebarButton(el) {
    if (el.closest('aside,[data-testid*="sidebar" i],[class*="sidebar" i],[aria-label*="sidebar" i]')) return true;
    const rect = el.getBoundingClientRect();
    const sidebarRects = Array.from(document.querySelectorAll('aside,[data-testid*="sidebar" i],[class*="sidebar" i]'))
      .filter(isVisible)
      .map(node => node.getBoundingClientRect());
    return sidebarRects.some(r => rect.left >= r.left - 4 && rect.right <= r.right + 4 && rect.top >= r.top - 4 && rect.bottom <= r.bottom + 4);
  }

  function stripButtonInfo(info) {
    if (!info) return null;
    const { el, ...rest } = info;
    return rest;
  }

  function scanVisibleButtonsNearHeader() {
    const header = getLessonHeaderRegion();
    const indicatorRect = header.indicatorRect;
    const video = Array.from(document.querySelectorAll('iframe, video')).find(isVisible);
    const videoTop = video ? video.getBoundingClientRect().top : null;
    // Scope search to main content area only — exclude global nav
    const mainEl = document.querySelector('main') || document.body;
    const allButtons = Array.from(mainEl.querySelectorAll('button,[role="button"],a[href],a'));
    const buttons = [];

    // Tight vertical band around the lesson indicator
    const yMin = indicatorRect ? indicatorRect.top - 30 : header.headerRect.top;
    const yMax = indicatorRect ? indicatorRect.top + 160 : header.headerRect.bottom;
    // Only buttons to the right of the indicator (for next) or left (for prev)
    const xMinForScan = indicatorRect ? indicatorRect.right - 50 : header.headerRect.left;

    for (const el of allButtons) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const centerY = (r.top + r.bottom) / 2;
      // Must be within the tight vertical band around the lesson indicator
      if (r.top < yMin || r.top > yMax) continue;
      if (videoTop != null && r.top > videoTop + 12) continue;
      if (isLikelySidebarButton(el)) continue;

      const rejectedReason = isBadNavigationCandidate(el);

      buttons.push({
        el,
        text: safeText(el).slice(0, 120),
        ariaLabel: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        href: el.getAttribute('href') || '',
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        disabled: isDisabled(el),
        rect: rectInfo(el),
        svgDirection: detectSvgDirection(el),
        smallCircular: r.width >= 20 && r.height >= 20 && r.width <= 82 && r.height <= 82 && Math.abs(r.width - r.height) <= 28,
        distanceFromLessonLabelY: Math.round(Math.abs(centerY - header.centerY)),
        rejectedReason: rejectedReason || null,
      });
    }

    const small = buttons
      .filter(b => b.smallCircular && !b.rejectedReason)
      .sort((a, b) => a.rect.left - b.rect.left);
    for (let i = 0; i < small.length - 1; i++) {
      const left = small[i];
      const right = small[i + 1];
      const gap = right.rect.left - left.rect.right;
      const yDelta = Math.abs(((right.rect.top + right.rect.bottom) / 2) - ((left.rect.top + left.rect.bottom) / 2));
      if (gap >= 0 && gap <= 96 && yDelta <= 32) {
        if (!left.svgDirection) left.svgDirection = 'left-by-geometry';
        if (!right.svgDirection) right.svgDirection = 'right-by-geometry';
      }
    }

    // Debug: log filtered candidates
    const candidatesAfterFilter = buttons.filter(b => !b.rejectedReason).map(stripButtonInfo);
    log('candidateButtonsAfterFilter', candidatesAfterFilter);

    return { header, buttons };
  }

  function scanBodyArrowCandidates(direction) {
    const header = getLessonHeaderRegion();
    const indicatorRect = header.indicatorRect;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const mainEl = document.querySelector('main') || document.body;
    const allButtons = Array.from(mainEl.querySelectorAll(clickableSelector()));
    const candidates = [];

    for (const el of allButtons) {
      if (!isVisible(el) || isDisabled(el) || isLikelySidebarButton(el)) continue;
      const rejectedReason = isBadNavigationCandidate(el);
      if (rejectedReason) continue;
      const r = el.getBoundingClientRect();
      const centerX = (r.left + r.right) / 2;
      const centerY = (r.top + r.bottom) / 2;
      if (r.bottom < 60 || r.top > vh - 40) continue;
      if (r.width < 16 || r.height < 16 || r.width > 130 || r.height > 130) continue;

      const text = safeText(el).slice(0, 120);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const href = el.getAttribute('href') || '';
      const combined = `${text} ${ariaLabel} ${title}`.toLowerCase();
      if (text.length > 60) continue;

      const svgDirection = detectSvgDirection(el);
      let score = 0;
      const reasons = [];
      if (direction === 'next') {
        if (/right|next|forward/i.test(`${svgDirection} ${combined}`)) { score += 55; reasons.push('right_signal'); }
        if (/left|prev|previous|back/i.test(`${svgDirection} ${combined}`)) { score -= 80; reasons.push('left_penalty'); }
        if (indicatorRect && centerX > indicatorRect.right) { score += 18; reasons.push('right_of_indicator'); }
        if (centerX > vw * 0.55) { score += 18; reasons.push('right_half'); }
        if (r.right >= vw - 180) { score += 22; reasons.push('near_right_side'); }
      } else {
        if (/left|prev|previous|back/i.test(`${svgDirection} ${combined}`)) { score += 55; reasons.push('left_signal'); }
        if (/right|next|forward/i.test(`${svgDirection} ${combined}`)) { score -= 80; reasons.push('right_penalty'); }
        if (indicatorRect && centerX < indicatorRect.left) { score += 18; reasons.push('left_of_indicator'); }
        if (centerX < vw * 0.45) { score += 18; reasons.push('left_half'); }
        if (r.left <= 180) { score += 22; reasons.push('near_left_side'); }
      }
      const isSmallIcon = r.width >= 20 && r.height >= 20 && r.width <= 82 && r.height <= 82 && Math.abs(r.width - r.height) <= 28;
      if (isSmallIcon) { score += 18; reasons.push('small_icon'); }
      if (indicatorRect) {
        const vDist = Math.abs(centerY - ((indicatorRect.top + indicatorRect.bottom) / 2));
        if (vDist < 80) { score += 18; reasons.push('near_indicator_v'); }
        else if (vDist < 240) { score += 8; reasons.push('moderate_indicator_v'); }
      }
      if (!text || text.length <= 6) { score += 8; reasons.push('icon_only'); }

      candidates.push({
        el,
        text,
        ariaLabel,
        title,
        href,
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        disabled: false,
        rect: rectInfo(el),
        svgDirection,
        smallCircular: isSmallIcon,
        distanceFromLessonLabelY: indicatorRect ? Math.round(Math.abs(centerY - ((indicatorRect.top + indicatorRect.bottom) / 2))) : 0,
        score,
        reasons,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    log('bodyArrowCandidates', candidates.slice(0, 8).map(stripButtonInfo));
    return candidates;
  }

  function chooseHeaderArrowCandidate(direction, scan) {
    // Filter out rejected candidates
    const active = scan.buttons.filter(b => !b.disabled && b.smallCircular && !b.rejectedReason);
    const signalActive = active.filter(b => hasDirectionSignal(b, direction));
    const sorted = signalActive.slice().sort((a, b) => a.rect.left - b.rect.left);
    const pairs = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const gap = b.rect.left - a.rect.right;
      const yDelta = Math.abs(((b.rect.top + b.rect.bottom) / 2) - ((a.rect.top + a.rect.bottom) / 2));
      if (gap < 0 || gap > 96 || yDelta > 32) continue;
      let score = 100 - Math.min(60, Math.abs(((a.rect.top + a.rect.bottom) / 2) - scan.header.centerY));
      if (/left/.test(a.svgDirection)) score += 35;
      if (/right/.test(b.svgDirection)) score += 35;
      if ((a.ariaLabel + a.title + a.text + b.ariaLabel + b.title + b.text).match(/lesson/i)) score += 10;
      pairs.push({ left: a, right: b, score });
    }

    pairs.sort((a, b) => b.score - a.score);
    if (pairs[0]) return direction === 'prev' ? pairs[0].left : pairs[0].right;

    const explicit = signalActive
      .sort((a, b) => a.distanceFromLessonLabelY - b.distanceFromLessonLabelY)[0];
    if (explicit) return explicit;

    return null;
  }

  function choosePageArrowCandidate(direction, scan) {
    const headerCandidate = chooseHeaderArrowCandidate(direction, scan);
    if (headerCandidate) return { ...headerCandidate, strategy: 'header-geometry' };

    const edge = chooseViewportEdgeArrowCandidate(direction);
    if (edge) return { ...edge, strategy: 'viewport-edge' };

    const bodyCandidate = scanBodyArrowCandidates(direction).find(c => hasDirectionSignal(c, direction));
    if (bodyCandidate && bodyCandidate.score >= 70) return { ...bodyCandidate, strategy: 'body-arrow' };

    return null;
  }

  function buildNavigationDiagnostics(direction) {
    const state = getLessonState();
    const scan = scanVisibleButtonsNearHeader();
    const candidate = choosePageArrowCandidate(direction || 'next', scan);
    return {
      lessonLabel: scan.header.lessonLabel,
      title: state.title,
      h1Title: state.title,
      urlBefore: state.url,
      titleBefore: state.title,
      visibleButtonsNearHeader: scan.buttons.map(stripButtonInfo),
      candidateButtonsAfterFilter: scan.buttons.filter(b => !b.rejectedReason).map(stripButtonInfo),
      candidateNextButton: direction === 'prev' ? null : stripButtonInfo(candidate),
      candidatePreviousButton: direction === 'prev' ? stripButtonInfo(candidate) : null,
      headerRegion: scan.header.headerRect,
      lessonIndicatorRect: scan.header.indicatorRect,
    };
  }

  async function navigateAdjacentLesson(direction, preferredMethod) {
    const before = getLessonState();
    const methods = ['geometry'];
    const attempts = [];
    let lastDiagnostics = null;

    for (const method of methods) {
      const attempt = { method, success: false };
      if (method === 'geometry') {
        const diagnostics = buildNavigationDiagnostics(direction);
        lastDiagnostics = diagnostics;
        const scan = scanVisibleButtonsNearHeader();
        const candidate = choosePageArrowCandidate(direction, scan);

        // Debug: log the candidate we're about to click
        if (candidate) {
          log('nav candidate', {
            strategy: 'geometry',
            candidateStrategy: candidate.strategy || '',
            text: candidate.text,
            href: candidate.href || '',
            ariaLabel: candidate.ariaLabel,
            svgDirection: candidate.svgDirection,
            selector: candidate.el?.tagName + (candidate.el?.className ? '.' + String(candidate.el.className).split(' ')[0] : ''),
            urlBefore: before.url,
            titleBefore: before.title,
            lessonBefore: before.lesson_number,
          });
        }

        attempt.candidateButton = stripButtonInfo(candidate);
        if (!candidate?.el) {
          attempt.reason = 'no_header_arrow_candidate';
          attempts.push(attempt);
          continue;
        }
        try {
          candidate.el.scrollIntoView({ block: 'center', inline: 'center' });
          await sleep(100);
          activateClick(candidate.el);
        } catch (e) {
          attempt.reason = 'click_error';
          attempt.error = String(e?.message || e);
          attempts.push(attempt);
          continue;
        }
      }

      const change = await waitForLessonChange(before, 8000);
      const after = change.state || getLessonState();

      // ── GUARDRAIL: detect if we navigated to course root ──
      if (isCourseRootUrl(after.url) && !isCourseRootUrl(before.url)) {
        log('GUARDRAIL: navigated to course root! Going back.', { urlBefore: before.url, urlAfter: after.url });
        try { history.back(); } catch (_) {}
        await sleep(1500);
        attempt.success = false;
        attempt.reason = 'navigated_to_course_root';
        attempt.urlBefore = before.url;
        attempt.urlAfter = after.url;
        attempt.titleBefore = before.title;
        attempt.titleAfter = after.title;
        attempts.push(attempt);
        continue;
      }

      // ── GUARDRAIL: detect if lesson indicator disappeared (course home has none) ──
      const afterIndicator = findLessonOfIndicator();
      if (!afterIndicator && before.lesson_number) {
        log('GUARDRAIL: lesson indicator disappeared after click! Going back.', { urlBefore: before.url, urlAfter: after.url });
        try { history.back(); } catch (_) {}
        await sleep(1500);
        attempt.success = false;
        attempt.reason = 'lesson_indicator_disappeared';
        attempt.urlBefore = before.url;
        attempt.urlAfter = after.url;
        attempts.push(attempt);
        continue;
      }

      const expectedLesson = before.lesson_number != null
        ? (direction === 'prev' ? before.lesson_number - 1 : before.lesson_number + 1)
        : null;
      const lessonNumberAdvanced = expectedLesson != null && after.lesson_number === expectedLesson;
      const movedInRightDirection = before.lesson_number != null && after.lesson_number != null && (
        direction === 'prev'
          ? after.lesson_number < before.lesson_number
          : after.lesson_number > before.lesson_number
      );
      const fallbackChanged = expectedLesson == null && change.changed;
      const success = !!(lessonNumberAdvanced || movedInRightDirection || fallbackChanged);

      log('nav result', {
        strategy: method,
        success,
        urlBefore: before.url,
        urlAfter: after.url,
        titleBefore: before.title,
        titleAfter: after.title,
        lessonBefore: before.lesson_number,
        lessonAfter: after.lesson_number,
      });

      Object.assign(attempt, {
        success,
        urlBefore: before.url,
        urlAfter: after.url,
        titleBefore: before.title,
        titleAfter: after.title,
        lessonBefore: before.lesson_number,
        lessonAfter: after.lesson_number,
        lessonNumberChanged: change.lessonNumberChanged,
        titleChanged: change.titleChanged,
        urlChanged: change.urlChanged,
        contentHashChanged: change.contentHashChanged,
      });
      attempts.push(attempt);
      if (success) {
        return { success: true, method, before, after, attempts, diagnostics: lastDiagnostics || buildNavigationDiagnostics(direction) };
      }
    }

    return { success: false, method: null, before, after: getLessonState(), attempts, diagnostics: lastDiagnostics || buildNavigationDiagnostics(direction) };
  }

  async function runNavigationDebugCapture() {
    const report = buildNavigationDiagnostics('next');
    log('navigation diagnostics', report);
    const result = await navigateAdjacentLesson('next', 'geometry');
    const after = result.after || getLessonState();
    Object.assign(report, {
      clickResult: {
        success: result.success,
        method: result.method,
        attempts: result.attempts,
      },
      urlAfter: after.url,
      titleAfter: after.title,
    });
    log('navigation debug report', report);
    const json = JSON.stringify(report, null, 2);
    const ok = await copyToClipboard(json);
    if (ok) {
      showBanner(result.success ? 'Circle navigation debug copied. Next navigation works.' : 'Circle navigation debug copied. Navigation failed.', result.success ? 'info' : 'error', true);
    } else {
      showJsonModal(json);
      showBanner('Clipboard blocked — copy the navigation debug JSON from the dialog.', 'warn', true);
    }
  }

  // ── Navigation Inspector (inspect mode) ─────────────────────────────────
  // Collects a comprehensive DOM inventory of ALL clickable elements.
  // Does NOT click anything. Does NOT navigate. Pure read-only inspection.

  function collectAllClickableElements() {
    const results = [];
    const allEls = Array.from(document.querySelectorAll('a[href], button, [role="button"], [onclick], [tabindex="0"]'));
    for (const el of allEls) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const parentText = (() => {
        let p = el.parentElement;
        for (let i = 0; i < 3 && p; i++) {
          const t = safeText(p);
          if (t && t !== safeText(el) && t.length < 200) return t;
          p = p.parentElement;
        }
        return '';
      })();
      results.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: safeText(el).slice(0, 200),
        ariaLabel: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        href: el.getAttribute('href') || '',
        className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 200) : '',
        dataTestId: el.getAttribute('data-testid') || '',
        rect: { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
        closestParentText: parentText.slice(0, 200),
        disabled: isDisabled(el),
        inSidebar: !!el.closest('aside, [data-testid*="sidebar" i], [class*="sidebar" i]'),
        inNav: !!el.closest('nav, header, [role="navigation"], [role="banner"]'),
        inMain: !!el.closest('main'),
        svgDirection: detectSvgDirection(el),
        _el: el, // stripped before output
      });
    }
    return results;
  }

  function collectSidebarLessonRows() {
    const sidebar = document.querySelector('aside, [data-testid*="sidebar" i], [class*="sidebar" i]');
    if (!sidebar) return [];
    // Look for lesson-like rows: links or clickable items with lesson-like text
    const rows = Array.from(sidebar.querySelectorAll('a[href], button, [role="button"], li, [role="listitem"]'));
    const seen = new Set();
    const results = [];
    for (const el of rows) {
      const text = safeText(el);
      if (!text || text.length < 3 || text.length > 300) continue;
      const key = text.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const href = el.getAttribute('href') || '';
      const isClickable = el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('tabindex') === '0';
      results.push({
        text: text.slice(0, 200),
        href,
        tag: el.tagName.toLowerCase(),
        rect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
        isClickable,
        ariaLabel: el.getAttribute('aria-label') || '',
        className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 150) : '',
        _el: el,
      });
    }
    return results;
  }

  function rankNextButtonCandidates(allClickable, indicator) {
    if (!indicator) return [];
    const indicatorEl = indicator.el;
    const indicatorRect = indicatorEl ? indicatorEl.getBoundingClientRect() : null;
    const scored = [];

    for (const item of allClickable) {
      if (item.disabled) continue;
      if (item.inNav) continue; // skip global nav
      if (!hasDirectionSignal(item, 'next')) continue;
      let score = 0;
      const reasons = [];

      // SVG direction
      if (/right|next|forward/i.test(item.svgDirection)) { score += 40; reasons.push('svg_direction_right'); }
      if (/left|prev|back/i.test(item.svgDirection)) { score -= 50; reasons.push('svg_direction_left_penalty'); }

      // Text/aria hints
      const combined = `${item.text} ${item.ariaLabel} ${item.title}`.toLowerCase();
      if (/\bnext\b/.test(combined)) { score += 30; reasons.push('text_next'); }
      if (/\bprev(ious)?\b|\bback\b/.test(combined)) { score -= 40; reasons.push('text_prev_penalty'); }
      if (/\blesson\b/.test(combined)) { score += 10; reasons.push('text_lesson'); }
      if (/\b(bookmark|search|profile|settings|notification|menu|sidebar|toc|contents?|curriculum|syllabus|table\s+of\s+contents?|course\s+content|complete|overview|home)\b/.test(combined)) { score -= 60; reasons.push('excluded_keyword'); }

      // Proximity to indicator
      if (indicatorRect && item.rect) {
        const vDist = Math.abs((item.rect.top + item.rect.bottom) / 2 - (indicatorRect.top + indicatorRect.bottom) / 2);
        if (vDist < 40) { score += 25; reasons.push('near_indicator_v'); }
        else if (vDist < 120) { score += 10; reasons.push('moderate_v_dist'); }
        // To the right of indicator = good for next
        if (item.rect.left > indicatorRect.right - 10) { score += 15; reasons.push('right_of_indicator'); }
      }

      // Small circular = likely icon button
      const w = item.rect.width, h = item.rect.height;
      if (w >= 20 && w <= 82 && h >= 20 && h <= 82 && Math.abs(w - h) <= 28) {
        score += 10; reasons.push('small_circular');
      }

      // In sidebar = less likely to be next arrow
      if (item.inSidebar) { score -= 20; reasons.push('in_sidebar'); }

      // href to course root = bad
      if (item.href) {
        try {
          if (isCourseRootUrl(new URL(item.href, location.href).href)) { score -= 50; reasons.push('href_course_root'); }
        } catch (_) {}
      }

      scored.push({
        text: item.text,
        ariaLabel: item.ariaLabel,
        title: item.title,
        tag: item.tag,
        href: item.href,
        className: item.className,
        dataTestId: item.dataTestId,
        rect: item.rect,
        svgDirection: item.svgDirection,
        score,
        reasons,
        _el: item._el,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10); // top 10
  }

  async function runInspectMode() {
    const state = getLessonState();
    const indicator = findLessonOfIndicator();
    const allClickable = collectAllClickableElements();
    const sidebarRows = collectSidebarLessonRows();
    const ranked = rankNextButtonCandidates(allClickable, indicator);

    // Strip _el from output
    const strip = (arr) => arr.map(({ _el, ...rest }) => rest);

    const report = {
      mode: 'inspect',
      timestamp: new Date().toISOString(),
      current_url: state.url,
      lesson_label: indicator ? `Lesson ${indicator.current} of ${indicator.total}` : null,
      lesson_title: state.title,
      indicator_rect: indicator?.el ? rectInfo(indicator.el) : null,
      total_clickable_elements: allClickable.length,
      clickable_in_main: allClickable.filter(e => e.inMain && !e.inNav).length,
      clickable_in_sidebar: allClickable.filter(e => e.inSidebar).length,
      clickable_in_nav: allClickable.filter(e => e.inNav).length,
      top_5_next_candidates: strip(ranked.slice(0, 5)),
      all_ranked_candidates: strip(ranked),
      sidebar_lesson_rows: strip(sidebarRows),
      all_clickable_in_main: strip(allClickable.filter(e => e.inMain && !e.inNav && !e.inSidebar)),
      all_clickable_in_sidebar: strip(allClickable.filter(e => e.inSidebar)),
    };

    log('inspect report', report);
    const json = JSON.stringify(report, null, 2);
    const ok = await copyToClipboard(json);
    if (ok) {
      showBanner(`Navigation inspector copied (${allClickable.length} elements, top 5 candidates ranked).\nPaste this into Lovable.`, 'info', true);
    } else {
      showJsonModal(json);
      showBanner('Clipboard blocked — copy from the dialog. Paste into Lovable.', 'warn', true);
    }
  }

  // ── Navigation Probe (probe mode) ───────────────────────────────────────
  // Tests candidates one at a time. After each click, checks if lesson moved
  // forward. If not, restores via history.back(). Stops when one works.

  async function runProbeMode() {
    const indicator = findLessonOfIndicator();
    if (!indicator) {
      showBanner('No "Lesson X of Y" found. Open a lesson page first.', 'warn', true);
      return;
    }

    const allClickable = collectAllClickableElements();
    const ranked = rankNextButtonCandidates(allClickable, indicator);
    const candidates = ranked.slice(0, 5); // probe top 5 only

    if (candidates.length === 0) {
      const json = JSON.stringify({ mode: 'probe', error: 'no_candidates', total_clickable: allClickable.length }, null, 2);
      await copyToClipboard(json);
      showBanner('No navigation candidates found. Run inspect mode and paste into Lovable.', 'error', true);
      return;
    }

    showBanner(`Probing ${candidates.length} candidates…`, 'info', true);
    const probeResults = [];
    let winner = null;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const el = c._el;
      if (!el || !isVisible(el)) {
        probeResults.push({ index: i, text: c.text, ariaLabel: c.ariaLabel, score: c.score, result: 'not_visible' });
        continue;
      }

      const before = getLessonState();
      showBanner(`Probing candidate ${i + 1}/${candidates.length}: "${c.text || c.ariaLabel || c.tag}"…`, 'info', true);

      try {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        await sleep(100);
        activateClick(el);
      } catch (err) {
        probeResults.push({ index: i, text: c.text, ariaLabel: c.ariaLabel, score: c.score, result: 'click_error', error: String(err) });
        continue;
      }

      const change = await waitForLessonChange(before, 6000);
      const after = change.state || getLessonState();

      // Check if we went to course root
      if (isCourseRootUrl(after.url) && !isCourseRootUrl(before.url)) {
        try { history.back(); } catch (_) {}
        await sleep(2000);
        probeResults.push({
          index: i, text: c.text, ariaLabel: c.ariaLabel, href: c.href, score: c.score,
          result: 'navigated_to_course_root',
          url_before: before.url, url_after: after.url,
        });
        continue;
      }

      // Check if indicator disappeared
      const afterIndicator = findLessonOfIndicator();
      if (!afterIndicator && before.lesson_number) {
        try { history.back(); } catch (_) {}
        await sleep(2000);
        probeResults.push({
          index: i, text: c.text, ariaLabel: c.ariaLabel, href: c.href, score: c.score,
          result: 'indicator_disappeared',
          url_before: before.url, url_after: after.url,
        });
        continue;
      }

      const moved = change.changed && afterIndicator &&
        afterIndicator.current > before.lesson_number;

      if (moved) {
        probeResults.push({
          index: i, text: c.text, ariaLabel: c.ariaLabel, href: c.href, className: c.className,
          dataTestId: c.dataTestId, tag: c.tag, rect: c.rect, svgDirection: c.svgDirection,
          score: c.score, reasons: c.reasons,
          result: 'SUCCESS',
          lesson_before: before.lesson_number, lesson_after: afterIndicator.current,
          title_before: before.title, title_after: findLessonTitle(afterIndicator.el),
          url_before: before.url, url_after: location.href.split('#')[0],
          h1_before: before.title, h1_after: findLessonTitle(afterIndicator.el),
          content_hash_before: before.content_hash, content_hash_after: getLessonState().content_hash,
        });
        winner = probeResults[probeResults.length - 1];
        // Restore to original lesson
        try { history.back(); } catch (_) {}
        await sleep(2000);
        break;
      } else {
        // Didn't move forward — restore
        if (change.changed) {
          try { history.back(); } catch (_) {}
          await sleep(2000);
        }
        probeResults.push({
          index: i, text: c.text, ariaLabel: c.ariaLabel, href: c.href, score: c.score,
          result: 'no_forward_movement',
          lesson_before: before.lesson_number, lesson_after: afterIndicator?.current,
          url_before: before.url, url_after: after.url,
          change_detected: change.changed,
        });
      }
    }

    const report = {
      mode: 'probe',
      timestamp: new Date().toISOString(),
      starting_lesson: indicator.current,
      total_lessons: indicator.total,
      candidates_tested: probeResults.length,
      winner: winner ? {
        text: winner.text,
        ariaLabel: winner.ariaLabel,
        tag: winner.tag,
        className: winner.className,
        dataTestId: winner.dataTestId,
        href: winner.href,
        svgDirection: winner.svgDirection,
        rect: winner.rect,
        lesson_before: winner.lesson_before,
        lesson_after: winner.lesson_after,
      } : null,
      probeResults,
    };

    log('probe report', report);
    const json = JSON.stringify(report, null, 2);
    const ok = await copyToClipboard(json);
    if (winner) {
      showBanner(
        `✓ Proven: "${winner.text || winner.ariaLabel || winner.tag}" moves Lesson ${winner.lesson_before} → ${winner.lesson_after}.\n` +
        `Navigation probe copied. Paste into Lovable.`,
        'info', true
      );
    } else {
      if (ok) {
        showBanner(`No working next candidate found (${probeResults.length} tested). Probe report copied.\nPaste into Lovable.`, 'error', true);
      } else {
        showJsonModal(json);
        showBanner('No working candidate. Copy from dialog and paste into Lovable.', 'error', true);
      }
    }
  }

  /**
   * Wait until the rendered lesson changes — either lesson_number advances,
   * the title text changes, the URL changes, or the main content hash changes.
   */
  async function waitForLessonChange(prev, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(250);
      const now = getLessonState();
      const lessonNumberChanged = now.lesson_number != null && prev.lesson_number != null && now.lesson_number !== prev.lesson_number;
      const titleChanged = !!(now.title && prev.title && now.title !== prev.title);
      const urlChanged = now.url !== prev.url;
      const contentHashChanged = !!(now.content_hash && prev.content_hash && now.content_hash !== prev.content_hash);
      if (lessonNumberChanged || titleChanged || urlChanged || contentHashChanged) {
        await sleep(500);
        const settled = getLessonState();
        return {
          changed: true,
          lessonNumberChanged: settled.lesson_number != null && prev.lesson_number != null && settled.lesson_number !== prev.lesson_number,
          titleChanged: !!(settled.title && prev.title && settled.title !== prev.title),
          urlChanged: settled.url !== prev.url,
          contentHashChanged: !!(settled.content_hash && prev.content_hash && settled.content_hash !== prev.content_hash),
          state: settled,
        };
      }
    }
    return { changed: false, lessonNumberChanged: false, titleChanged: false, urlChanged: false, contentHashChanged: false, state: getLessonState() };
  }

  /**
   * Walk every lesson using only the visible Previous/Next controls next to the
   * lesson header. Sidebar lesson rows are diagnostics-only and are never clicked.
   */
  async function autoWalk(startIndicator) {
    const total = startIndicator.total;
    const lessons = [];
    let navigationMethod = 'geometry';
    let fatalNavigationFailure = false;
    let fatalDebugReport = null;

    const startDiagnostics = buildNavigationDiagnostics('next');
    log('navigation diagnostics', startDiagnostics);
    if ((startIndicator.current || getLessonState().lesson_number || 1) !== 1) {
      return {
        lessons: [],
        fatalNavigationFailure: true,
        debugReport: {
          ...startDiagnostics,
          clickResult: { success: false, reason: 'start_on_lesson_1_required_for_right_arrow_only_capture' },
          urlAfter: location.href.split('#')[0],
          titleAfter: getLessonState().title,
        },
      };
    }

    showBanner(`Capturing from lesson 1 of ${total}. Advancing with the visible right arrow only…`, 'info', true);

    let consecutiveNavigationFailures = 0;
    const seenLessonNumbers = new Set();

    while (lessons.length < total) {
      const state = getLessonState();
      const lessonNum = state.lesson_number || lessons.length + 1;
      log(`capturing lesson ${lessonNum} of ${total}`, { title: state.title, url: state.url });
      showBanner(`Capturing lesson ${lessonNum} of ${total}…`, 'info', true);

      let lessonData;
      try {
        lessonData = await extractCurrentLesson();
      } catch (err) {
        log('capture error on lesson ' + lessonNum, err);
        lessonData = { url: location.href.split('#')[0], lesson_number: lessonNum, title: state.title || `Lesson ${lessonNum}`, capture_issue: 'extract_failed' };
      }
      lessons.push(lessonData);
      seenLessonNumbers.add(lessonNum);

      const transcriptCount = lessons.filter(l => l.transcript).length;
      const resourceCount = lessons.reduce((s, l) => s + (l.resources?.length || 0), 0);
      const withContentCount = lessons.filter(l => l.body_text || l.transcript || l.resources?.length || l.media_url).length;
      showBanner(
        `${total} discovered · ${withContentCount} captured with content · ${lessons.filter(l => l.capture_issue === 'navigation_failed').length} navigation failed\n` +
          `Current: ${lessonData.lesson_number || lessonNum} of ${total}: ${lessonData.title || state.title || `Lesson ${lessonNum}`}\n` +
          `Transcripts: ${transcriptCount} · Resources: ${resourceCount}`,
        'info', true
      );
      log('capture result', { index: lessonNum, total, success: !!(lessonData.body_text || lessonData.transcript || lessonData.resources?.length || lessonData.media_url), title: lessonData.title, debug: lessonData._debug || null });

      const latest = getLessonState();
      if ((latest.lesson_number || lessonNum) >= total) break;

      const nav = await navigateAdjacentLesson('next', navigationMethod);
      log('navigation proof', nav);
      if (!nav.success) {
        consecutiveNavigationFailures += 1;
        const failedFrom = (latest.lesson_number || lessonNum) + 1;
        fatalDebugReport = { ...startDiagnostics, clickResult: { success: false, reason: 'navigation_failed_during_course_capture', attempts: nav.attempts }, urlAfter: nav.after?.url, titleAfter: nav.after?.title };
        fatalNavigationFailure = true;
        lessons.push({
          lesson_number: failedFrom,
          title: `Lesson ${failedFrom}`,
          capture_issue: 'navigation_failed',
          _debug: { navigation: { attempts: nav.attempts, diagnostics: nav.diagnostics } },
        });
        for (let n = failedFrom + 1; n <= total; n++) {
          lessons.push({ lesson_number: n, title: `Lesson ${n}`, capture_issue: 'navigation_failed', _debug: { navigation: { reason: 'stopped_after_navigation_failure' } } });
        }
        break;
      } else {
        consecutiveNavigationFailures = 0;
        const afterNum = nav.after?.lesson_number;
        if (afterNum && seenLessonNumbers.has(afterNum)) {
          log('navigation loop detected', { afterNum, seen: Array.from(seenLessonNumbers) });
          fatalNavigationFailure = true;
          fatalDebugReport = { ...startDiagnostics, clickResult: { success: false, reason: 'navigation_loop_detected', attempts: nav.attempts }, urlAfter: nav.after?.url, titleAfter: nav.after?.title };
          for (let n = lessons.length + 1; n <= total; n++) lessons.push({ lesson_number: n, title: `Lesson ${n}`, capture_issue: 'navigation_failed', _debug: { navigation: { reason: 'navigation_loop_detected' } } });
          break;
        }
      }
    }

    return { lessons, fatalNavigationFailure, debugReport: fatalDebugReport || startDiagnostics };
  }

  // ── Main ─────────────────────────────────────────────────────────────────

  (async function main() {
    const { mode, indicator } = detectPageMode();

    if (mode !== 'lesson') {
      showBanner(
        'Open any lesson in this Circle course, then run the bookmarklet again.\n' +
          'Tip: click any lesson in the right-hand "Lessons" sidebar so the URL contains /lessons/ or /posts/ and "Lesson X of Y" is visible.',
        'warn'
      );
      return;
    }

    if (CAPTURE_MODE === 'inspect') {
      showBanner('Running Circle navigation inspector…', 'info', true);
      await runInspectMode();
      return;
    }

    if (CAPTURE_MODE === 'probe') {
      showBanner('Running Circle navigation probe…', 'info', true);
      await runProbeMode();
      return;
    }

    if (CAPTURE_MODE === 'debug-nav') {
      showBanner('Running Circle navigation diagnostics…', 'info', true);
      await runNavigationDebugCapture();
      return;
    }

    // ── Single-lesson mode: capture only the current page ──────────────
    if (CAPTURE_MODE === 'single') {
      showBanner('Capturing current lesson…', 'info', true);
      const courseTitle = deriveCourseTitle();
      let lesson;
      try {
        lesson = await extractCurrentLesson();
      } catch (err) {
        log('single capture failed', err);
        showBanner('Capture failed: ' + (err?.message || err), 'error');
        return;
      }
      const payload = {
        source_url: location.href,
        platform: 'circle',
        capture_mode: 'single_lesson',
        title: courseTitle,
        lessons: [lesson],
      };
      const json = JSON.stringify(payload, null, 2);
      const ok = await copyToClipboard(json);
      const hasContent = !!(lesson.body_text || lesson.transcript || lesson.resources?.length);
      const lines = ['1 lesson captured: ' + lesson.title];
      if (lesson.body_text) lines.push('✓ body text (' + lesson.body_text.length + ' chars)');
      if (lesson.transcript) lines.push('✓ transcript (' + lesson.transcript.length + ' chars)');
      if (lesson.resources?.length) lines.push('✓ ' + lesson.resources.length + ' resource(s)');
      if (!hasContent) lines.push('⚠ no content detected');
      lines.push('\nJSON copied — paste into Circle Import panel.');
      if (ok) {
        showBanner(lines.join('\n'), hasContent ? 'info' : 'warn');
      } else {
        showJsonModal(json);
        showBanner('Clipboard blocked — copy from the dialog.', 'warn');
      }
      return;
    }

    // ── Course mode: auto-walk all lessons ─────────────────────────────
    if (!indicator) {
      showBanner(
        'Could not find "Lesson X of Y" indicator. Make sure you are on a lesson page.\n' +
          'Tip: the lesson page should show "Lesson X of Y" above the lesson title.',
        'warn'
      );
      return;
    }

    const courseTitle = deriveCourseTitle();
    showBanner(`Starting auto-capture from lesson ${indicator.current} of ${indicator.total}…`, 'info', true);

    let walkResult;
    try {
      // Course capture must mirror the user's page navigation: start on
      // Lesson 1 and click only the visible right-arrow next control.
      walkResult = await autoWalk(indicator);
    } catch (err) {
      log('auto-walk failed', err);
      showBanner('Capture failed: ' + (err?.message || err), 'error');
      return;
    }
    const lessons = walkResult.lessons || [];

    if (walkResult.fatalNavigationFailure && lessons.length === 0) {
      const reason = walkResult.debugReport?.clickResult?.reason;
      const message = reason === 'start_on_lesson_1_required_for_right_arrow_only_capture'
        ? 'Open Lesson 1, then run Capture entire course again. Course capture now uses only Circle’s visible right-arrow button.'
        : 'Course capture could not start using the visible right-arrow button. Run Inspect navigation and paste the diagnostics.';
      showBanner(message, 'error', true);
      return;
    }

    const payload = {
      source_url: location.href,
      platform: 'circle',
      capture_mode: 'auto_walk_lesson_ui',
      title: courseTitle,
      navigation_debug: walkResult.debugReport,
      lessons: walkResult.fatalNavigationFailure
        ? lessons.filter(l => l && l.capture_issue !== 'navigation_failed')
        : lessons,
    };

    const importLessons = payload.lessons || [];
    const discovered = indicator.total || lessons.length || importLessons.length;
    const navigationFailed = lessons.filter(l => l.capture_issue === 'navigation_failed').length;
    const failed = importLessons.filter(l => l.capture_issue && l.capture_issue !== 'navigation_failed').length;
    const transcripts = importLessons.filter(l => l.transcript).length;
    const resources = importLessons.reduce((s, l) => s + (l.resources?.length || 0), 0);
    const media = importLessons.filter(l => l.media_url).length;
    const withContent = importLessons.filter(l => l.body_text || l.transcript || l.resources?.length || l.media_url).length;

    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);

    const lines = [`${discovered} discovered, ${withContent} captured with content, ${navigationFailed} navigation failed.`];
    if (transcripts) lines.push(`✓ ${transcripts} transcript${transcripts === 1 ? '' : 's'}`);
    if (resources) lines.push(`✓ ${resources} resource${resources === 1 ? '' : 's'}`);
    if (media) lines.push(`✓ ${media} media item${media === 1 ? '' : 's'}`);
    if (failed) lines.push(`⚠ ${failed} failed`);
    if (!withContent) {
      lines.push('⚠ no content/transcript/resources/media detected — open browser console for [Circle Capture] debug logs');
    }
    if (walkResult.fatalNavigationFailure) {
      lines.push(`⚠ course navigation failed — ${payload.lessons.length} captured lesson${payload.lessons.length === 1 ? '' : 's'} salvaged for import`);
    }
    const summary = lines.join('\n') +
      '\nJSON copied — return to the app and paste it into the Circle Import panel.';

    if (ok) {
      showBanner(summary, withContent === 0 || navigationFailed > 0 ? 'warn' : 'info');
    } else {
      showJsonModal(json);
      showBanner('Clipboard blocked — copy the JSON from the dialog and paste into Circle Import.', 'warn');
    }
  })();
})();
