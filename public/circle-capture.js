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

  log('starting');

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
    // Look for "Show transcript" button/link.
    const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const trigger = all.find(el => /show transcript|view transcript|transcript/i.test(safeText(el)));
    if (!trigger) return '';

    // Snapshot existing transcript-ish containers BEFORE click so we can
    // detect new ones that appear afterward.
    const beforeIds = new Set(
      Array.from(document.querySelectorAll('[id*="transcript" i], [class*="transcript" i]')).map(el => el)
    );

    try { trigger.click(); } catch (_) { return ''; }

    // Poll for a transcript container that has substantive text.
    const start = Date.now();
    let transcriptText = '';
    while (Date.now() - start < 5000) {
      await sleep(200);
      const containers = Array.from(document.querySelectorAll(
        '[id*="transcript" i], [class*="transcript" i], [data-testid*="transcript" i]'
      ));
      for (const c of containers) {
        const t = safeText(c);
        if (t.length > 80) {
          transcriptText = t;
          break;
        }
      }
      if (transcriptText) break;
    }
    return transcriptText;
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

  /**
   * Extract everything for the currently rendered lesson.
   */
  async function extractCurrentLesson() {
    const indicator = findLessonOfIndicator();
    const title = findLessonTitle(indicator?.el);
    const media_url = findVideoUrl();

    // Caption text under video — the small text right under the video frame
    // (e.g. "Alright. This module isn't gonna teach you every last thing").
    // We grab the takeaways + resources sections explicitly and combine.
    const takeaways = captureSectionByHeading(/^takeaways?$/i);
    const { resources, text: resourcesText } = captureResources();

    // Body region for caption + everything else not already covered.
    const bodyEl =
      document.querySelector('[data-testid="post-body"]') ||
      document.querySelector('article') ||
      document.querySelector('.trix-content') ||
      document.querySelector('main');
    let bodyAll = safeText(bodyEl);

    // Strip the takeaways/resources sub-text from the bulk body to avoid dupes
    // when we re-compose body_text.
    if (takeaways) bodyAll = bodyAll.replace(takeaways, '').replace(/\s+/g, ' ').trim();
    if (resourcesText) bodyAll = bodyAll.replace(resourcesText, '').replace(/\s+/g, ' ').trim();

    const transcript = await captureTranscript();
    if (transcript) bodyAll = bodyAll.replace(transcript, '').replace(/\s+/g, ' ').trim();

    const parts = [];
    if (bodyAll) parts.push(bodyAll);
    if (takeaways) parts.push(`\n\nTakeaways\n${takeaways}`);
    if (resourcesText) parts.push(`\n\nResources Mentioned\n${resourcesText}`);
    const body_text = parts.join('').trim() || undefined;

    return {
      url: location.href.split('#')[0],
      lesson_number: indicator ? indicator.current : undefined,
      total_lessons: indicator ? indicator.total : undefined,
      title: title || (indicator ? `Lesson ${indicator.current}` : 'Untitled lesson'),
      body_text,
      media_url,
      transcript: transcript || undefined,
      resources: resources.length ? resources : undefined,
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
    const candidates = Array.from(document.querySelectorAll('button, a[role="button"], a'));
    // 1. By aria-label / title containing "next"
    let hit = candidates.find(el => /\bnext\b/i.test(el.getAttribute('aria-label') || ''));
    if (hit) return hit;
    hit = candidates.find(el => /\bnext\b/i.test(el.getAttribute('title') || ''));
    if (hit) return hit;
    // 2. Pair of nav arrows: find a "previous" then take its pair.
    const prev = candidates.find(el => /\bprev/i.test(el.getAttribute('aria-label') || el.getAttribute('title') || ''));
    if (prev && prev.parentElement) {
      const sibs = Array.from(prev.parentElement.querySelectorAll('button, a[role="button"], a'));
      const idx = sibs.indexOf(prev);
      if (idx >= 0 && sibs[idx + 1]) return sibs[idx + 1];
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

  /**
   * Wait until the rendered lesson changes — either lesson_number advances,
   * the title text changes, or the URL changes.
   */
  async function waitForLessonChange(prev, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(250);
      const ind = findLessonOfIndicator();
      const titleNow = findLessonTitle(ind?.el);
      const urlNow = location.href.split('#')[0];
      const numChanged = ind && prev.lesson_number != null && ind.current !== prev.lesson_number;
      const titleChanged = titleNow && prev.title && titleNow !== prev.title;
      const urlChanged = urlNow !== prev.url;
      if (numChanged || titleChanged || urlChanged) {
        // Give content a beat to mount fully.
        await sleep(400);
        return true;
      }
    }
    return false;
  }

  /**
   * Walk every lesson starting from the current one. Returns array of lessons.
   */
  async function autoWalk(startIndicator) {
    const total = startIndicator.total;
    const lessons = [];
    let safety = 0;

    // Capture the starting lesson first.
    showBanner(`Capturing lesson ${startIndicator.current} of ${total}…`, 'info', true);
    let current = await extractCurrentLesson();
    lessons.push(current);
    log('captured', current);

    while (current.lesson_number && current.lesson_number < total && safety++ < total + 3) {
      const targetIndex = current.lesson_number + 1;
      const next = findNextArrow();
      let navigated = false;
      if (next && !next.disabled && next.getAttribute('aria-disabled') !== 'true') {
        try { next.scrollIntoView({ block: 'center' }); next.click(); navigated = true; } catch (_) {}
      }
      if (!navigated) {
        // Sidebar fallback
        const row = findSidebarLessonByIndex(targetIndex);
        if (row) {
          try { row.scrollIntoView({ block: 'center' }); row.click(); navigated = true; } catch (_) {}
        }
      }
      if (!navigated) {
        log('could not find navigation control to advance from lesson', current.lesson_number);
        lessons.push({
          url: location.href.split('#')[0],
          lesson_number: targetIndex,
          title: `Lesson ${targetIndex}`,
          capture_issue: 'render_failed',
        });
        break;
      }

      const ok = await waitForLessonChange({
        lesson_number: current.lesson_number,
        title: current.title,
        url: current.url,
      }, 8000);

      if (!ok) {
        lessons.push({
          url: location.href.split('#')[0],
          lesson_number: targetIndex,
          title: `Lesson ${targetIndex}`,
          capture_issue: 'render_failed',
        });
        // Try to keep going — push past stuck lesson.
        current = { lesson_number: targetIndex, title: '', url: location.href.split('#')[0] };
        continue;
      }

      const captured = await extractCurrentLesson();
      lessons.push(captured);
      const transcriptCount = lessons.filter(l => l.transcript).length;
      const resourceCount = lessons.reduce((s, l) => s + (l.resources?.length || 0), 0);
      showBanner(
        `Capturing lesson ${captured.lesson_number || targetIndex} of ${total}: ${captured.title}\n` +
          `Transcripts: ${transcriptCount} · Resources: ${resourceCount}`,
        'info', true
      );
      current = {
        lesson_number: captured.lesson_number || targetIndex,
        title: captured.title,
        url: captured.url,
      };
    }

    return lessons;
  }

  // ── Main ─────────────────────────────────────────────────────────────────

  (async function main() {
    const { mode, indicator } = detectPageMode();

    if (mode !== 'lesson' || !indicator) {
      showBanner(
        'Open any lesson in this Circle course, then run the bookmarklet again.\n' +
          'Tip: click any lesson in the right-hand "Lessons" sidebar so the URL contains /lessons/ or /posts/ and "Lesson X of Y" is visible.',
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

    const captured = lessons.length;
    const failed = lessons.filter(l => l.capture_issue === 'render_failed').length;
    const transcripts = lessons.filter(l => l.transcript).length;
    const resources = lessons.reduce((s, l) => s + (l.resources?.length || 0), 0);

    const json = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(json);
    const summary =
      `${captured} lessons captured` +
      (failed ? `, ${failed} failed` : '') +
      `, ${transcripts} transcripts, ${resources} resources.\n` +
      'JSON copied — return to the app and paste it into the Circle Import panel.';

    if (ok) {
      showBanner(summary, captured === 0 ? 'warn' : 'info');
    } else {
      showJsonModal(json);
      showBanner('Clipboard blocked — copy the JSON from the dialog and paste into Circle Import.', 'warn');
    }
  })();
})();
