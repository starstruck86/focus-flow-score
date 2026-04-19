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
