/**
 * Circle Course Capture Bookmarklet
 * --------------------------------------------------------------------------
 * Runs INSIDE the user's already-authenticated Circle browser tab.
 *
 * Strategy:
 *   • Designed to be run from an INDIVIDUAL LESSON PAGE (the screenshot:
 *     "Lesson X of Y", title, video, captions, "Show transcript", Takeaways,
 *     Resources Mentioned, sidebar with all lessons, next/prev arrows).
 *   • Auto-walks the entire course by clicking the next-lesson arrow until
 *     "Lesson X of Y" reaches Y. Falls back to clicking sidebar lesson rows.
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
        if (m === 'single' || m === 'course') return m;
      }
    } catch (_) {}
    return 'course'; // default to course for backward compat
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
      'iframe[src*="wistia"], iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="loom"]'
    );
    if (iframe) return iframe.getAttribute('src') || undefined;
    const a = document.querySelector(
      'a[href*="wistia"], a[href*="vimeo"], a[href*="youtube"], a[href*="youtu.be"], a[href*="loom"]'
    );
    if (a) return a.getAttribute('href') || undefined;
    const v = document.querySelector('video[src]');
    if (v) return v.getAttribute('src') || undefined;
    const vsrc = document.querySelector('video source[src]');
    if (vsrc) return vsrc.getAttribute('src') || undefined;
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
   * Find the visible "next lesson" arrow button. The screenshot shows two
   * round arrow buttons in the top-right of the lesson card; the right one
   * advances. We look for SVG/aria labels first, then fall back to the second
   * of two adjacent round nav buttons.
   */
  function findNextArrow() {
    const isVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[aria-disabled="true"]');
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a[href], a')).filter(el => isVisible(el) && !isDisabled(el));

    // Required selector order: explicit Next labels first.
    let hit = document.querySelector('button[aria-label*="Next" i]') || document.querySelector('[aria-label*="Next" i]');
    if (hit && isVisible(hit) && !isDisabled(hit)) return hit;

    // Button containing right-arrow-ish SVG/path/icon, excluding obvious previous arrows.
    hit = candidates.find(el => {
      const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${safeText(el)}`;
      if (/\b(prev|previous|back)\b/i.test(label)) return false;
      const svgText = Array.from(el.querySelectorAll('svg, path, use')).map(n => n.outerHTML || '').join(' ');
      return /→|›|chevron.?right|arrow.?right|M\s*9\s|right/i.test(label + ' ' + svgText);
    });
    if (hit) return hit;

    const state = getLessonState();
    const headerRect = state.indicator_el?.getBoundingClientRect();
    if (headerRect) {
      const nearHeader = candidates
        .map(el => ({ el, rect: el.getBoundingClientRect(), text: safeText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '' }))
        .filter(({ rect }) => Math.abs((rect.top + rect.bottom) / 2 - (headerRect.top + headerRect.bottom) / 2) < 140)
        .sort((a, b) => a.rect.left - b.rect.left);
      // Visible button near the Lesson X of Y heading and to the right side.
      hit = nearHeader.find(({ rect, text }) => rect.left > headerRect.right && !/\b(prev|previous|back)\b/i.test(text))?.el;
      if (hit) return hit;
      // Fallback: button whose bounding box is near the header and right of a back arrow.
      const backIdx = nearHeader.findIndex(({ text }) => /\b(prev|previous|back)\b/i.test(text));
      if (backIdx >= 0 && nearHeader[backIdx + 1]) return nearHeader[backIdx + 1].el;
      if (nearHeader.length >= 2) return nearHeader[nearHeader.length - 1].el;
    }

    return null;
  }

  /**
   * Click sidebar lesson row at 1-based index. Used as fallback when the next
   * arrow can't be found.
   */
  function findSidebarLessonByIndex(targetIndex) {
    // Sidebar lesson rows are typically links inside an aside/dialog with
    // "Lessons" as a heading.
    const containers = [
      document.querySelector('aside'),
      document.querySelector('[role="dialog"]'),
      document.querySelector('[data-testid*="sidebar"]'),
    ].filter(Boolean);
    for (const c of containers) {
      const heading = Array.from(c.querySelectorAll('h1,h2,h3')).find(h => /lessons/i.test(safeText(h)));
      if (!heading) continue;
      const links = Array.from(c.querySelectorAll('a[href], button'));
      // Filter out section headers ("Section 0: Introduction" etc.)
      const lessonLinks = links.filter(el => {
        const t = safeText(el);
        return t && t.length > 2 && !/^section\s+\w+:?/i.test(t);
      });
      if (lessonLinks[targetIndex - 1]) return lessonLinks[targetIndex - 1];
    }
    return null;
  }

  function collectLessonMetadata(total) {
    const containers = [
      document.querySelector('aside'),
      document.querySelector('[data-testid*="sidebar"]'),
      document.querySelector('[role="navigation"]'),
    ].filter(Boolean);
    const items = [];
    const seen = new Set();
    for (const c of containers) {
      const rows = Array.from(c.querySelectorAll('a[href], button, [role="button"]'));
      for (const row of rows) {
        const title = safeText(row).replace(/^Lesson\s+\d+\s*(of\s*\d+)?\s*/i, '').trim();
        if (!title || title.length < 3 || /^section\s+\w+:?/i.test(title) || /^(next|previous|back)$/i.test(title)) continue;
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ index: items.length + 1, title: title.slice(0, 300), url: row.href || '' });
        if (total && items.length >= total) break;
      }
      if (total && items.length >= total) break;
    }
    return items;
  }

  /**
   * Wait until the rendered lesson changes — either lesson_number advances,
   * the title text changes, or the URL changes.
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
        // Give content a beat to mount fully.
        await sleep(400);
        return { changed: true, lessonNumberChanged, titleChanged, urlChanged, contentHashChanged, state: getLessonState() };
      }
    }
    return { changed: false, lessonNumberChanged: false, titleChanged: false, urlChanged: false, contentHashChanged: false, state: getLessonState() };
  }

  /**
   * Walk every lesson starting from the current one. Returns array of lessons.
   *
   * Key resilience rules (React SPA):
   *   – NEVER store DOM node references across iterations
   *   – Re-query navigation controls fresh every iteration
   *   – Prefer next-arrow over sidebar clicking
   *   – Never break on individual failure — mark and continue
   */
  async function autoWalk(startIndicator) {
    const total = startIndicator.total;
    const lessonMeta = collectLessonMetadata(total);
    const lessons = [];
    const navDebug = [];

    // ── Capture the starting lesson ──
    showBanner(`Capturing lesson ${startIndicator.current} of ${total}…`, 'info', true);
    let captured;
    try { captured = await extractCurrentLesson(); } catch (e) {
      log('first lesson capture error', e);
      captured = { url: location.href.split('#')[0], lesson_number: startIndicator.current, title: `Lesson ${startIndicator.current}`, capture_issue: 'render_failed' };
    }
    lessons.push(captured);
    log('captured #' + (captured.lesson_number || 1), captured.title);

    let consecutiveNavigationFailures = 0;

    while (true) {
      const before = getLessonState();
      const currentNum = before.lesson_number || lessons[lessons.length - 1]?.lesson_number || startIndicator.current;
      if (before.total_lessons && before.lesson_number === before.total_lessons) break;
      if (currentNum >= total) break;

      const targetNum = currentNum + 1;
      const targetMeta = lessonMeta[targetNum - 1] || {};
      const targetTitle = targetMeta.title || `Lesson ${targetNum}`;
      log(`--- navigating to lesson ${targetNum} of ${total} ---`);

      const nextBtn = findNextArrow();
      const clickedElementText = nextBtn ? (safeText(nextBtn) || nextBtn.getAttribute('aria-label') || nextBtn.getAttribute('title') || '[next arrow]') : '[missing next arrow]';
      const debug = {
        target_lesson_title: targetTitle,
        current_url_before_click: before.url,
        current_title_before_click: before.title,
        clicked_element_text: clickedElementText,
        current_url_after_click: before.url,
        current_title_after_click: before.title,
        title_changed: false,
        lesson_number_changed: false,
        url_changed: false,
        content_hash_changed: false,
        body_text_length: 0,
        transcript_length: 0,
        resources_count: 0,
      };

      if (!nextBtn) {
        debug.capture_issue = 'navigation_failed';
        debug.reason = 'next_arrow_missing_or_disabled';
        log('navigation proof', debug);
        for (let n = targetNum; n <= total; n++) lessons.push({ lesson_number: n, title: lessonMeta[n - 1]?.title || `Lesson ${n}`, capture_issue: 'navigation_failed', _debug: { navigation: { ...debug, target_lesson_title: lessonMeta[n - 1]?.title || `Lesson ${n}` } } });
        break;
      }

      try { nextBtn.scrollIntoView({ block: 'center' }); await sleep(100); nextBtn.click(); } catch (e) { debug.click_error = String(e?.message || e); }

      const change = await waitForLessonChange(before, 8000);
      const after = change.state || getLessonState();
      const titleMatchesTarget = !!(targetMeta.title && after.title && after.title.toLowerCase().includes(targetMeta.title.toLowerCase().slice(0, 80)));
      const navigationProven = !!(titleMatchesTarget || change.lessonNumberChanged || change.urlChanged);
      Object.assign(debug, {
        current_url_after_click: after.url,
        current_title_after_click: after.title,
        title_changed: titleMatchesTarget || change.titleChanged,
        title_matches_target: titleMatchesTarget,
        lesson_number_changed: change.lessonNumberChanged,
        url_changed: change.urlChanged,
        content_hash_changed: change.contentHashChanged,
        navigation_proven: navigationProven,
      });

      if (!navigationProven) {
        consecutiveNavigationFailures += 1;
        debug.capture_issue = 'navigation_failed';
        log('navigation proof', debug);
        lessons.push({ lesson_number: targetNum, title: targetTitle, capture_issue: 'navigation_failed', _debug: { navigation: debug } });
        if (consecutiveNavigationFailures >= 2) {
          for (let n = targetNum + 1; n <= total; n++) lessons.push({ lesson_number: n, title: lessonMeta[n - 1]?.title || `Lesson ${n}`, capture_issue: 'navigation_failed', _debug: { navigation: { reason: 'stopped_after_two_consecutive_navigation_failures' } } });
          break;
        }
        continue;
      }

      consecutiveNavigationFailures = 0;

      // ── Step 3: Extract lesson (fresh DOM queries) ──
      let lessonData;
      try {
        lessonData = await extractCurrentLesson();
      } catch (err) {
        log('capture error on lesson ' + targetNum, err);
        lessonData = { url: location.href.split('#')[0], lesson_number: targetNum, title: targetTitle, capture_issue: 'extract_failed' };
      }
      debug.body_text_length = lessonData.body_text?.length || 0;
      debug.transcript_length = lessonData.transcript?.length || 0;
      debug.resources_count = lessonData.resources?.length || 0;
      lessonData._debug = { ...(lessonData._debug || {}), navigation: debug };
      navDebug.push(debug);
      log('navigation proof', debug);
      lessons.push(lessonData);

      const transcriptCount = lessons.filter(l => l.transcript).length;
      const resourceCount = lessons.reduce((s, l) => s + (l.resources?.length || 0), 0);
      const failCount = lessons.filter(l => l.capture_issue === 'navigation_failed').length;
      const withContentCount = lessons.filter(l => l.body_text || l.transcript || l.resources?.length).length;
      showBanner(
        `${total} discovered · ${withContentCount} captured with content · ${failCount} navigation failed\n` +
          `Current: ${lessonData.lesson_number || targetNum} of ${total}: ${lessonData.title || targetTitle}\n` +
          `Transcripts: ${transcriptCount} · Resources: ${resourceCount}`,
        'info', true
      );
      log('captured #' + (lessonData.lesson_number || targetNum), lessonData.title, lessonData._debug || '');
    }

    return lessons;
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

    let lessons;
    try {
      lessons = await autoWalk(indicator);
    } catch (err) {
      log('auto-walk failed', err);
      showBanner('Capture failed: ' + (err?.message || err), 'error');
      return;
    }

    const payload = {
      source_url: location.href,
      platform: 'circle',
      capture_mode: 'auto_walk_lesson_ui',
      title: courseTitle,
      lessons,
    };

    const discovered = indicator.total || lessons.length;
    const navigationFailed = lessons.filter(l => l.capture_issue === 'navigation_failed').length;
    const failed = lessons.filter(l => l.capture_issue && l.capture_issue !== 'navigation_failed').length;
    const transcripts = lessons.filter(l => l.transcript).length;
    const resources = lessons.reduce((s, l) => s + (l.resources?.length || 0), 0);
    const withContent = lessons.filter(l => l.body_text || l.transcript || l.resources?.length).length;

    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);

    const lines = [`${discovered} discovered, ${withContent} captured with content, ${navigationFailed} navigation failed.`];
    if (transcripts) lines.push(`✓ ${transcripts} transcript${transcripts === 1 ? '' : 's'}`);
    if (resources) lines.push(`✓ ${resources} resource${resources === 1 ? '' : 's'}`);
    if (failed) lines.push(`⚠ ${failed} failed`);
    if (!withContent) {
      lines.push('⚠ no content/transcript/resources detected — open browser console for [Circle Capture] debug logs');
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
