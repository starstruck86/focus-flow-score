/**
 * useSwipeTabs — horizontal-swipe tab switching for /work + /train-hub.
 *
 * Rules:
 *  • Ignore gestures starting inside a [data-swipe-exempt="true"] subtree
 *    (whitespace grid horizontal scroller, native scrollers, etc).
 *  • Ignore gestures starting within 24px of the left edge (iOS back-swipe).
 *  • Only fires when |dx| > threshold AND |dx| > |dy| * 1.5 (dominantly horizontal).
 *  • Uses passive listeners; never preventDefault — vertical scroll stays native.
 */
import { useCallback, useRef } from 'react';

interface Options {
  tabs: readonly string[];
  active: string;
  onChange: (next: string) => void;
  threshold?: number;   // px
  edgeGuard?: number;   // px from left edge to ignore
}

export function useSwipeTabs({ tabs, active, onChange, threshold = 60, edgeGuard = 24 }: Options) {
  const start = useRef<{ x: number; y: number; ok: boolean } | null>(null);

  const isExempt = (el: EventTarget | null): boolean => {
    let node = el as HTMLElement | null;
    while (node) {
      if (node.dataset && node.dataset.swipeExempt === 'true') return true;
      // native horizontal scrollers also block
      if (node instanceof HTMLElement) {
        const style = getComputedStyle(node);
        const canScrollX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth;
        if (canScrollX) return true;
      }
      node = node.parentElement;
    }
    return false;
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') { start.current = null; return; }
    if (e.clientX < edgeGuard) { start.current = null; return; }
    if (isExempt(e.target)) { start.current = null; return; }
    start.current = { x: e.clientX, y: e.clientY, ok: true };
  }, [edgeGuard]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !s.ok) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < threshold) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // vertical dominant → let scroll win
    const idx = tabs.indexOf(active);
    if (idx < 0) return;
    const nextIdx = dx < 0 ? Math.min(tabs.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (nextIdx !== idx) onChange(tabs[nextIdx]);
  }, [tabs, active, onChange, threshold]);

  const onPointerCancel = useCallback(() => { start.current = null; }, []);

  return { onPointerDown, onPointerUp, onPointerCancel };
}
