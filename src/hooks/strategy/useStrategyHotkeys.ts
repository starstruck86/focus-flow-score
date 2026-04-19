/**
 * useStrategyHotkeys — keyboard verbs for the Strategy workspace.
 *   ⌘K / Ctrl+K  → toggle Switcher
 *   ⌘I / Ctrl+I  → toggle Inspector
 *   Esc          → close whichever summoned surface is open
 *   /            → focus composer (only if no input is already focused)
 *
 * The hook intentionally does nothing visual; it only flips state and
 * focuses the composer ref. All summoning is overlay-based — no layout shift.
 */
import { useEffect } from 'react';

interface Opts {
  onToggleSwitcher: () => void;
  onToggleInspector: () => void;
  onEscape: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

export function useStrategyHotkeys({ onToggleSwitcher, onToggleInspector, onEscape, composerRef }: Opts) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ⌘K / Ctrl+K
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onToggleSwitcher();
        return;
      }

      // ⌘I / Ctrl+I
      if (meta && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        onToggleInspector();
        return;
      }

      // Esc
      if (e.key === 'Escape') {
        onEscape();
        return;
      }

      // "/" focuses composer if not already typing somewhere
      if (e.key === '/' && !meta && !isEditableTarget(e.target)) {
        e.preventDefault();
        composerRef.current?.focus();
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggleSwitcher, onToggleInspector, onEscape, composerRef]);
}
