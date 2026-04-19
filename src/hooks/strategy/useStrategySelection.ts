/**
 * useStrategySelection — tracks live text selection inside Strategy messages.
 *
 * Phase 2: drives the SelectionActionBar. We only surface a selection when:
 *   - the selection is non-empty
 *   - the anchor + focus both live inside an element with [data-strategy-selectable]
 *   - the trimmed text is ≥ 3 chars (avoid single-char accidents)
 *
 * The hook returns the current selection (text + anchor rect in viewport coords)
 * and a `clear()` helper. It is designed so the bar can render adjacent to the
 * selection without ever shifting the canvas.
 */
import { useEffect, useState, useCallback } from 'react';

export interface StrategySelection {
  text: string;
  rect: DOMRect;
  /** id of the source message, if available (data-message-id on container) */
  sourceMessageId: string | null;
  /** role of the source message (assistant/user/system) — purely informational */
  sourceRole: string | null;
}

function isInsideSelectable(node: Node | null): { ok: boolean; messageId: string | null; role: string | null } {
  let cur: Node | null = node;
  while (cur && cur.nodeType !== 1) cur = cur.parentNode;
  let el = cur as HTMLElement | null;
  while (el) {
    if (el.dataset && el.dataset.strategySelectable !== undefined) {
      return {
        ok: true,
        messageId: el.dataset.messageId ?? null,
        role: el.dataset.messageRole ?? null,
      };
    }
    el = el.parentElement;
  }
  return { ok: false, messageId: null, role: null };
}

export function useStrategySelection(): { selection: StrategySelection | null; clear: () => void } {
  const [selection, setSelection] = useState<StrategySelection | null>(null);

  const update = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const anchor = isInsideSelectable(range.startContainer);
    const focus = isInsideSelectable(range.endContainer);
    if (!anchor.ok || !focus.ok) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSelection(null);
      return;
    }
    setSelection({
      text,
      rect,
      sourceMessageId: anchor.messageId,
      sourceRole: anchor.role,
    });
  }, []);

  const clear = useCallback(() => {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    setSelection(null);
  }, []);

  // Dev-only: ?devSelect=<text> programmatically selects matching text inside a
  // [data-strategy-selectable] node so the SelectionActionBar can be screenshot-proven
  // by automation. No-op when the param is absent. Retries until a match is found
  // (assistant messages stream in async).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const needle = params.get('devSelect');
    if (!needle) return;
    let cancelled = false;
    let attempts = 0;
    const tryApply = () => {
      if (cancelled) return;
      attempts++;
      const containers = document.querySelectorAll<HTMLElement>('[data-strategy-selectable]');
      for (const el of Array.from(containers)) {
        const text = el.textContent ?? '';
        const idx = text.indexOf(needle);
        if (idx === -1) continue;
        // Walk text nodes to map offset
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let acc = 0;
        let startNode: Text | null = null;
        let startOffset = 0;
        let endNode: Text | null = null;
        let endOffset = 0;
        let n: Node | null = walker.nextNode();
        while (n) {
          const tn = n as Text;
          const len = tn.data.length;
          if (!startNode && acc + len > idx) {
            startNode = tn;
            startOffset = idx - acc;
          }
          if (!endNode && acc + len >= idx + needle.length) {
            endNode = tn;
            endOffset = idx + needle.length - acc;
            break;
          }
          acc += len;
          n = walker.nextNode();
        }
        if (startNode && endNode) {
          const range = document.createRange();
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
            update();
            return;
          }
        }
      }
      if (attempts < 40) setTimeout(tryApply, 250);
    };
    setTimeout(tryApply, 300);
    return () => { cancelled = true; };
  }, [update]);

  useEffect(() => {
    // selectionchange fires on every caret move; debounce to mouseup/keyup for stability
    const onMouseUp = () => setTimeout(update, 0);
    const onKeyUp = (e: KeyboardEvent) => {
      // Only update on selection-affecting keys (shift+arrow, etc.)
      if (e.shiftKey || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
        setTimeout(update, 0);
      }
    };
    const onScroll = () => {
      // If user scrolls, recompute the rect so the bar follows
      if (selection) update();
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [update, selection]);

  return { selection, clear };
}
