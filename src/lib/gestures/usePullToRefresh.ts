/**
 * usePullToRefresh — subtle top-of-page pull-to-refresh.
 *
 * Fires when: gesture starts at page scrollTop <= 0, drags DOWN past
 * threshold, and vertical dominates horizontal. Exposes a `pull` value
 * (0..1 clamped) so callers can render a subtle top indicator (no spinner
 * overlay theatrics per §8).
 */
import { useEffect, useRef, useState } from 'react';

interface Options {
  onRefresh: () => Promise<void> | void;
  threshold?: number;   // px pull required
  maxPull?: number;     // visual cap
  disabled?: boolean;
}

export function usePullToRefresh({ onRefresh, threshold = 80, maxPull = 120, disabled }: Options) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ y: number; x: number; active: boolean } | null>(null);

  const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

  useEffect(() => {
    if (disabled) return;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (!atTop()) return;
      start.current = { y: e.clientY, x: e.clientX, active: true };
    };
    const onMove = (e: PointerEvent) => {
      const s = start.current;
      if (!s || !s.active || refreshing) return;
      const dy = e.clientY - s.y;
      const dx = e.clientX - s.x;
      if (dy <= 0 || Math.abs(dy) < Math.abs(dx)) { s.active = false; setPull(0); return; }
      if (!atTop()) { s.active = false; setPull(0); return; }
      setPull(Math.min(maxPull, dy) / maxPull);
    };
    const onUp = async () => {
      const s = start.current;
      start.current = null;
      const cur = pullRef.current;
      setPull(0);
      if (!s || refreshing) return;
      if (cur * maxPull >= threshold) {
        setRefreshing(true);
        try { await onRefresh(); } finally { setRefreshing(false); }
      }
    };

    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [disabled, onRefresh, threshold, maxPull, refreshing]);

  // keep latest pull for onUp closure
  const pullRef = useRef(0);
  useEffect(() => { pullRef.current = pull; }, [pull]);

  return { pull, refreshing };
}
